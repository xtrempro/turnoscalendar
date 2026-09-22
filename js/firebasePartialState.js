const PARTIAL_MAP_PREFIXES = [
    "data_",
    "baseData_",
    "blocked_",
    "contingency_",
    "admin_",
    "legal_",
    "comp_",
    "absences_",
    "hourReturns_",
    "clockMarks_",
    "shiftAssignmentHistory_",
    "leaveBalances_",
    "hheeReturnTransfers_"
];

// Listas compartidas de toda la unidad -reemplazos, cambios de turno,
// preasignaciones, memos, bitacora- que viajaban como UN solo valor: el ultimo
// que escribia pisaba la lista entera, asi que dos supervisores registrando
// cosas DISTINTAS al mismo tiempo perdian una de las dos.
//
// No hay lista blanca de claves: se detecta en tiempo de ejecucion. Una lista se
// parte por elemento solo si TODOS sus elementos son objetos con un `id` unico y
// no vacio. Si no lo son -o si la clave no es una lista- se sigue mandando
// entera, exactamente como antes. Esa es la red de seguridad: ante una forma que
// no se reconoce, el comportamiento no cambia.
export const PARTIAL_LIST_CONTAINER = "array";

function parseArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw === null || raw === undefined || raw === "") return [];

    try {
        const value = JSON.parse(raw);

        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

function parseStored(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw !== "string") return raw;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function listItemId(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";

    return String(item.id ?? "").trim();
}

/**
 * Indexa una lista por el `id` de sus elementos, o devuelve null si no se puede
 * partir con seguridad (algun elemento sin id, o dos con el mismo).
 */
export function indexListById(value) {
    if (!Array.isArray(value)) return null;

    const byId = new Map();

    for (const item of value) {
        const id = listItemId(item);

        if (!id || byId.has(id)) return null;

        byId.set(id, item);
    }

    return byId;
}

export function isSplittableList(raw) {
    if (raw === null || raw === undefined || raw === "") return false;

    let value = raw;

    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw);
        } catch {
            return false;
        }
    }

    if (!Array.isArray(value) || !value.length) return false;

    return indexListById(value) !== null;
}

function isPlainObject(raw) {
    let value = raw;

    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw);
        } catch {
            return false;
        }
    }

    return Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function parseObject(raw) {
    if (raw === null || raw === undefined || raw === "") return {};

    try {
        const value = JSON.parse(raw);
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : {};
    } catch {
        return {};
    }
}

export function isPartialStateMapKey(key) {
    const value = String(key || "");
    return PARTIAL_MAP_PREFIXES.some(prefix => value.startsWith(prefix));
}

export function encodePartialStateItemKey(itemKey) {
    return encodeURIComponent(String(itemKey || ""))
        .replace(/\./g, "%2E");
}

export function decodePartialStateItemKey(itemKey) {
    try {
        return decodeURIComponent(String(itemKey || ""));
    } catch {
        return String(itemKey || "");
    }
}

export function groupPartialStateEntries(entries = []) {
    const grouped = new Map();

    entries.forEach(entry => {
        const id = `${entry.moduleId}\u001e${entry.storageKey}`;
        const group = grouped.get(id) || {
            moduleId: entry.moduleId,
            storageKey: entry.storageKey,
            items: {},
            deletedItems: {}
        };

        if (entry.itemKey) {
            const itemKey = encodePartialStateItemKey(entry.itemKey);

            if (entry.container) group.container = entry.container;

            group.items[itemKey] = entry.deleted
                ? "null"
                : String(entry.value ?? "");
            group.deletedItems[itemKey] = entry.deleted === true;
        } else {
            group.value = entry.deleted
                ? null
                : String(entry.value ?? "");
            group.deleted = entry.deleted === true;
        }

        grouped.set(id, group);
    });

    return [...grouped.values()];
}

export function planPartialStateEntries({
    keys = [],
    changes = {},
    readRaw = () => null,
    moduleForKey = () => ""
} = {}) {
    const entries = [];

    keys.forEach(storageKey => {
        const change = changes?.[storageKey] || {};
        const previousRaw = Object.prototype.hasOwnProperty.call(change, "previous")
            ? change.previous
            : null;
        const nextRaw = Object.prototype.hasOwnProperty.call(change, "next")
            ? change.next
            : readRaw(storageKey);
        const moduleId = moduleForKey(storageKey);

        if (!moduleId) return;

        // Que esta sesion NO TENGA la clave no significa que haya que borrarla
        // para todos.
        //
        // `nextRaw` sale de leer el almacenamiento local, y ahi un `null` puede
        // ser cualquier cosa menos una decision: la sesion todavia no hidrato
        // ese modulo, se acaba de cambiar de unidad, el navegador desalojo la
        // clave. Publicar eso como `deleted` convierte una ausencia local en
        // una destruccion remota: el 2026-09-03 una sesion borro asi el
        // catalogo entero de tareas de Imagenologia, y de rebote se perdieron
        // 298 asignaciones.
        //
        // Un borrado de VERDAD siempre llega marcado: removeKey() emite el
        // cambio con `removed: true`. Sin esa marca, no hay nada que publicar.
        if (nextRaw === null && change.removed !== true) return;

        if (!isPartialStateMapKey(storageKey)) {
            const listEntries = planListStateEntries({
                moduleId,
                storageKey,
                previousRaw,
                nextRaw,
                removed: change.removed === true
            });

            if (listEntries) {
                entries.push(...listEntries);
                return;
            }

            // Un objeto tambien se parte por sus claves de primer nivel. Es el
            // mismo mecanismo de los calendarios, pero decidido por la FORMA del
            // valor y no por una lista de prefijos: asi quedan cubiertas las
            // areas que guardan un objeto -la asignacion de tareas, por
            // ejemplo- sin tener que ir anotandolas una por una.
            const objectEntries = planObjectStateEntries({
                moduleId,
                storageKey,
                previousRaw,
                nextRaw,
                removed: change.removed === true
            });

            if (objectEntries) {
                entries.push(...objectEntries);
                return;
            }

            entries.push({
                moduleId,
                storageKey,
                itemKey: "",
                value: nextRaw,
                deleted: change.removed === true || nextRaw === null
            });
            return;
        }

        const previous = parseObject(previousRaw);
        const next = parseObject(nextRaw);
        const itemKeys = new Set([
            ...Object.keys(previous),
            ...Object.keys(next)
        ]);

        itemKeys.forEach(itemKey => {
            const previousValue = previous[itemKey];
            const nextHasValue = Object.prototype.hasOwnProperty.call(
                next,
                itemKey
            );
            const nextValue = next[itemKey];

            if (
                nextHasValue &&
                JSON.stringify(previousValue) === JSON.stringify(nextValue)
            ) return;

            entries.push({
                moduleId,
                storageKey,
                itemKey,
                value: nextHasValue ? JSON.stringify(nextValue) : null,
                deleted: !nextHasValue
            });
        });
    });

    return entries;
}

/**
 * Diferencia dos versiones de una lista, elemento por elemento. Devuelve null
 * cuando la clave no es una lista partible: ahi el llamador vuelve al valor
 * entero de siempre.
 *
 * Una lista cuyos elementos tienen id viaja SIEMPRE por elemento, aunque no
 * haya version anterior o la anterior este vacia: cada elemento es un alta y no
 * se borra nada. Mandarla entera pisa el `value` de la nube con la copia local,
 * y una copia local incompleta borra todo lo que no traiga: el 2026-09-15 una
 * sesion con la lista de reemplazos vacia dejo 1 registro donde habia 492.
 *
 * Solo viaja entera si no se puede partir: algun elemento sin id o repetido, en
 * la version nueva o en la anterior.
 */
export function planListStateEntries({
    moduleId,
    storageKey,
    previousRaw,
    nextRaw,
    removed = false
} = {}) {
    if (removed || nextRaw === null || nextRaw === undefined) return null;

    const nextList = parseStored(nextRaw);

    if (!Array.isArray(nextList)) return null;

    const next = indexListById(nextList);
    const previousList = parseStored(previousRaw);
    let previous = null;

    if (previousList === null) {
        previous = new Map();
    } else if (Array.isArray(previousList)) {
        previous = indexListById(previousList);
    }

    if (!previous || !next) return null;

    const entries = [];
    const ids = new Set([...previous.keys(), ...next.keys()]);

    ids.forEach(id => {
        const previousValue = previous.get(id);
        const nextHasValue = next.has(id);
        const nextValue = next.get(id);

        if (
            nextHasValue &&
            JSON.stringify(previousValue) === JSON.stringify(nextValue)
        ) return;

        entries.push({
            moduleId,
            storageKey,
            itemKey: id,
            container: PARTIAL_LIST_CONTAINER,
            value: nextHasValue ? JSON.stringify(nextValue) : null,
            deleted: !nextHasValue
        });
    });

    return entries;
}

/**
 * Aplica el cambio de UN elemento sobre la lista que ya hay.
 *
 * Se parchea la lista existente en vez de reconstruirla: asi el elemento que
 * cambio se actualiza en su sitio, el que llega nuevo se agrega al final y el
 * orden de los demas no se toca. Reconstruirla desde los items habria barajado
 * listas donde el orden importa.
 */
function applyListStateEntries(snapshot, storageKey, entries, start, end) {
    const list = parseArray(snapshot[storageKey]);
    let serialized = false;

    for (let position = start; position < end; position++) {
        const entry = entries[position];
        const itemKey = String(entry.itemKey || "");
        const index = list.findIndex(item => listItemId(item) === itemKey);

        if (entry.deleted) {
            if (index >= 0) list.splice(index, 1);
        } else {
            let parsed = null;

            try {
                parsed = JSON.parse(String(entry.value ?? "null"));
            } catch {
                continue;
            }

            if (!parsed || typeof parsed !== "object") continue;

            if (index >= 0) {
                list[index] = parsed;
            } else {
                list.push(parsed);
            }
        }

        serialized = true;
    }

    if (serialized) snapshot[storageKey] = JSON.stringify(list);
    return snapshot;
}

function applyListStateEntry(snapshot, storageKey, entry) {
    return applyListStateEntries(snapshot, storageKey, [entry], 0, 1);
}

function applyMapStateEntries(snapshot, storageKey, entries, start, end) {
    const map = parseObject(snapshot[storageKey]);

    for (let position = start; position < end; position++) {
        const entry = entries[position];
        const itemKey = String(entry.itemKey || "");

        if (entry.deleted) {
            delete map[itemKey];
        } else {
            try {
                map[itemKey] = JSON.parse(String(entry.value ?? "null"));
            } catch {
                map[itemKey] = entry.value;
            }
        }
    }

    snapshot[storageKey] = JSON.stringify(map);
    return snapshot;
}

/**
 * Diferencia dos versiones de un objeto por sus claves de primer nivel.
 * Devuelve null si no es un objeto plano no vacio: ahi vuelve el valor entero.
 *
 * Un valor escalar -una fecha, un numero- no tiene nada que partir, y un objeto
 * vacio tampoco: mandarlo entero es mas barato y significa lo mismo.
 */
export function planObjectStateEntries({
    moduleId,
    storageKey,
    previousRaw,
    nextRaw,
    removed = false
} = {}) {
    if (removed || nextRaw === null || nextRaw === undefined) return null;

    const previous = parseObject(previousRaw);
    const next = parseObject(nextRaw);

    if (!Object.keys(next).length && !Object.keys(previous).length) return null;
    // parseObject devuelve {} tanto para un objeto vacio como para algo que no
    // es objeto: hay que distinguirlos o un escalar se mandaria como si fuera un
    // objeto y se perderia.
    if (!isPlainObject(nextRaw)) return null;

    const entries = [];
    const keys = new Set([
        ...Object.keys(previous),
        ...Object.keys(next)
    ]);

    keys.forEach(itemKey => {
        const previousValue = previous[itemKey];
        const nextHasValue = Object.prototype.hasOwnProperty.call(next, itemKey);
        const nextValue = next[itemKey];

        if (
            nextHasValue &&
            JSON.stringify(previousValue) === JSON.stringify(nextValue)
        ) return;

        entries.push({
            moduleId,
            storageKey,
            itemKey,
            value: nextHasValue ? JSON.stringify(nextValue) : null,
            deleted: !nextHasValue
        });
    });

    return entries;
}

export function applyPartialStateEntry(snapshot = {}, entry = {}) {
    const storageKey = String(entry.storageKey || "");
    const itemKey = String(entry.itemKey || "");

    if (!storageKey) return snapshot;

    if (!itemKey) {
        if (entry.deleted) {
            delete snapshot[storageKey];
        } else {
            snapshot[storageKey] = String(entry.value ?? "");
        }
        return snapshot;
    }

    // El marcador dice como parchear, pero no se depende solo de el: si lo que
    // hay guardado YA es una lista, tratarla como mapa la convertiria en objeto
    // y reventaria todo lo que la recorre. Ante la duda manda la forma real del
    // dato, que es la que el resto del programa va a leer.
    if (
        entry.container === PARTIAL_LIST_CONTAINER ||
        Array.isArray(parseStored(snapshot[storageKey]))
    ) {
        return applyListStateEntry(snapshot, storageKey, entry);
    }

    return applyMapStateEntries(snapshot, storageKey, [entry], 0, 1);
}

export function mergePartialStateEntries(snapshot = {}, entries = []) {
    for (let index = 0; index < entries.length;) {
        const entry = entries[index];
        const storageKey = String(entry.storageKey || "");
        const isList = Boolean(storageKey && entry.itemKey) && (
            entry.container === PARTIAL_LIST_CONTAINER ||
            Array.isArray(parseStored(snapshot[storageKey]))
        );

        if (!storageKey || !entry.itemKey) {
            applyPartialStateEntry(snapshot, entry);
            index++;
            continue;
        }

        let end = index + 1;
        while (
            end < entries.length &&
            entries[end].storageKey === storageKey &&
            entries[end].itemKey &&
            (isList || entries[end].container !== PARTIAL_LIST_CONTAINER)
        ) {
            end++;
        }

        if (isList) {
            applyListStateEntries(snapshot, storageKey, entries, index, end);
        } else {
            applyMapStateEntries(snapshot, storageKey, entries, index, end);
        }
        index = end;
    }

    return snapshot;
}
