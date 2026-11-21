// Forma de una informacion: categorias, destinatarios y ciclo de vida.
//
// Vive aparte de informations.js -que es el panel- porque estas reglas las
// necesitan tres lados que no comparten entorno: el panel del supervisor, lo
// que se publica a la PWA, y las pruebas, que solo quieren dar un objeto y
// mirar como queda. Aqui no hay DOM, ni Firestore, ni localStorage.
//
// DOS COSAS QUE NO SON UNA BARRERA DE SEGURIDAD, y conviene tenerlas claras:
//
//   - Los DESTINATARIOS dicen a quien le sirve la informacion, no quien puede
//     leerla. La programacion semanal y las informaciones viajan en UN
//     documento compartido del workspace (`published/informations`), asi que
//     el contenido llega al telefono de todos los enlazados y es la PWA la que
//     oculta lo que no le toca. Sirve para no llenar de ruido a quien no le
//     interesa; no sirve para mandar algo confidencial a una persona.
//   - Lo PROGRAMADO viaja igual, con su fecha, y la PWA lo esconde hasta que
//     llega el dia. Es un embargo de pantalla, no un envio diferido.
//
// Se hizo asi a proposito: la alternativa -un documento por trabajador, o una
// Cloud Function que publique a la hora- multiplica escrituras y agrega un
// temporizador de servidor para un tablero de anuncios. Si algun dia hace falta
// mandar algo reservado, eso es un mensaje al trabajador (workerMessages), que
// ya va por su hilo privado.

export const INFORMATION_CATEGORIES = [
    { id: "protocolo", label: "Protocolo" },
    { id: "turnos", label: "Turnos" },
    { id: "urgente", label: "Urgente" },
    { id: "capacitacion", label: "Capacitacion" },
    { id: "general", label: "General" }
];

// Los PROTOCOLOS tienen su propio menu (aqui y en la PWA), pero son
// informaciones de categoria "protocolo": viajan en el mismo documento
// publicado, con los mismos destinatarios, confirmaciones de lectura, archivos
// y programacion. Lo unico propio es la SUBCATEGORIA, un texto libre
// ("Radioproteccion", "Equipos", "Urgencias") que agrupa los protocolos.
export const PROTOCOL_CATEGORY = "protocolo";
const MAX_SUBCATEGORY_LENGTH = 60;

export function isProtocol(item = {}) {
    return normalizeCategory(item?.category) === PROTOCOL_CATEGORY;
}

export function normalizeSubcategory(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_SUBCATEGORY_LENGTH);
}

// Las subcategorias en uso, sin repetir (sin distinguir mayusculas), en orden
// alfabetico. Es la lista que se ofrece al escribir una nueva.
export function protocolSubcategories(items = []) {
    const byKey = new Map();

    (Array.isArray(items) ? items : []).forEach(item => {
        if (!isProtocol(item)) return;

        const label = normalizeSubcategory(item.subcategory);

        if (label && !byKey.has(label.toLowerCase())) {
            byKey.set(label.toLowerCase(), label);
        }
    });

    return [...byKey.values()].sort((a, b) => a.localeCompare(b, "es"));
}

// El tope descarta solo informaciones: un protocolo es documentacion que se
// consulta, no una noticia que envejece, y nunca se pierde por llegar otras.
// Respeta el orden recibido (ya ordenado, lo mas nuevo primero).
export function capInformationItems(items = [], max = 200) {
    let kept = 0;

    return (Array.isArray(items) ? items : []).filter(item => {
        if (isProtocol(item)) return true;
        kept += 1;
        return kept <= max;
    });
}

// Se reparte por lo que NO cambia de un dia a otro. El turno queda fuera a
// proposito: una persona esta de noche el martes y libre el jueves, asi que
// "el turno de noche" no es un grupo al que se le pueda escribir, es el estado
// de un dia. Para eso estan las personas, una por una.
export const AUDIENCE_MODES = ["all", "estamento", "profession", "people"];

export const INFORMATION_STATUSES = ["draft", "scheduled", "published", "archived"];

const DEFAULT_CATEGORY = "general";

export function normalizeCategory(value) {
    const id = String(value || "").trim().toLowerCase();

    return INFORMATION_CATEGORIES.some(item => item.id === id)
        ? id
        : DEFAULT_CATEGORY;
}

export function categoryLabel(value) {
    const id = normalizeCategory(value);

    return (INFORMATION_CATEGORIES.find(item => item.id === id) || {}).label ||
        "General";
}

function cleanList(value) {
    return [...new Set(
        (Array.isArray(value) ? value : [])
            .map(entry => String(entry || "").trim())
            .filter(Boolean)
    )];
}

export function normalizeAudience(value = {}) {
    const raw = value && typeof value === "object" ? value : {};
    const mode = AUDIENCE_MODES.includes(raw.mode) ? raw.mode : "all";
    const audience = {
        mode,
        groups: cleanList(raw.groups),
        people: cleanList(raw.people)
    };

    // Un modo por grupos sin ningun grupo elegido no le llega a nadie, y eso
    // casi siempre es un descuido, no una decision. Se guarda tal cual -no se
    // corrige solo a "todos", que seria mandarselo a gente que no se eligio-
    // pero el panel lo marca en rojo antes de publicar.
    return audience;
}

export function audienceIsEmpty(audience) {
    const clean = normalizeAudience(audience);

    if (clean.mode === "all") return false;
    if (clean.mode === "people") return clean.people.length === 0;

    return clean.groups.length === 0;
}

function profileGroupValue(profile, mode) {
    if (mode === "estamento") {
        return String(profile?.estamento || "").trim() || "Sin estamento";
    }

    return String(profile?.profession || "").trim() || "Sin informacion";
}

/**
 * Si a esta persona le toca esta informacion.
 *
 * @param {Object} audience destinatarios ya normalizados o crudos.
 * @param {Object} profile `{ name, estamento, profession }`. Sirve tanto el
 *   perfil del supervisor como el `worker` que la PWA recibe publicado, porque
 *   los dos traen esos tres campos con el mismo nombre.
 */
export function audienceIncludes(audience, profile) {
    const clean = normalizeAudience(audience);

    if (clean.mode === "all") return true;

    if (clean.mode === "people") {
        const name = String(profile?.name || "").trim().toLowerCase();

        return clean.people.some(entry => entry.toLowerCase() === name);
    }

    const value = profileGroupValue(profile, clean.mode).toLowerCase();

    return clean.groups.some(entry => entry.trim().toLowerCase() === value);
}

export function audienceSummary(audience, total = 0) {
    const clean = normalizeAudience(audience);

    if (clean.mode === "all") {
        return total ? `Toda la unidad - ${total} personas` : "Toda la unidad";
    }

    if (clean.mode === "people") {
        if (!clean.people.length) return "Sin destinatarios elegidos";

        return clean.people.length === 1
            ? clean.people[0]
            : `${clean.people.length} personas elegidas`;
    }

    if (!clean.groups.length) return "Sin destinatarios elegidos";

    const head = clean.groups.slice(0, 2).join(" y ");
    const rest = clean.groups.length > 2
        ? ` y ${clean.groups.length - 2} mas`
        : "";

    return total ? `${head}${rest} - ${total} personas` : `${head}${rest}`;
}

function toTime(value) {
    const time = Date.parse(String(value || ""));

    return Number.isNaN(time) ? 0 : time;
}

export function normalizeStatus(value) {
    const status = String(value || "").trim().toLowerCase();

    return INFORMATION_STATUSES.includes(status) ? status : "published";
}

/**
 * En que esta HOY una informacion, cruzando su estado guardado con el reloj.
 *
 * La programacion y el vencimiento no los mueve ningun proceso: se calculan
 * cada vez que se miran. Una programada cuya hora ya paso se lee como
 * publicada, y una publicada cuya fecha de archivo ya paso se lee como
 * archivada, sin que nadie haya tenido que abrir la aplicacion a esa hora.
 */
export function effectiveStatus(item = {}, now = Date.now()) {
    const stored = normalizeStatus(item.status);

    if (stored === "draft" || stored === "archived") return stored;

    const publishAt = toTime(item.publishAt);
    const expiresAt = toTime(item.expiresAt);

    if (stored === "scheduled" && publishAt && publishAt > now) return "scheduled";
    if (expiresAt && expiresAt <= now) return "archived";

    return "published";
}

export function isVisibleToWorkers(item = {}, now = Date.now()) {
    return effectiveStatus(item, now) === "published";
}
