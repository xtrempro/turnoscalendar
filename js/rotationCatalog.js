import { TURNO } from "./constants.js";
import { getRaw, setJSON } from "./persistence.js";

export const ROTATION_CATALOG_KEY = "rotationCatalog";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_SHIFTS = Object.freeze([
    { id: "libre", name: "Libre", turn: TURNO.LIBRE, start: "", end: "", nextDay: false, active: true, builtin: true },
    { id: "larga", name: "Larga", turn: TURNO.LARGA, start: "08:00", end: "20:00", nextDay: false, active: true, builtin: true },
    { id: "noche", name: "Noche", turn: TURNO.NOCHE, start: "20:00", end: "08:00", nextDay: true, active: true, builtin: true },
    { id: "diurno", name: "Diurno", turn: TURNO.DIURNO, start: "08:00", end: "17:00", fridayEnd: "16:00", nextDay: false, active: true, builtin: true },
    { id: "turno24", name: "24 horas", turn: TURNO.TURNO24, start: "08:00", end: "08:00", nextDay: true, active: true, builtin: true },
    { id: "turno18", name: "18 horas", turn: TURNO.TURNO18, start: "14:00", end: "08:00", nextDay: true, active: true, builtin: true }
]);

const DEFAULT_ROTATIONS = Object.freeze([
    {
        id: "diurno",
        name: "Diurno",
        mode: "businessDays",
        pattern: ["diurno"],
        active: true,
        builtin: true
    },
    {
        id: "3turno",
        name: "3er Turno",
        mode: "sequence",
        pattern: ["larga", "larga", "noche", "noche", "libre", "libre"],
        active: true,
        builtin: true
    },
    {
        id: "4turno",
        name: "4to Turno",
        mode: "sequence",
        pattern: ["larga", "noche", "libre", "libre"],
        active: true,
        builtin: true
    }
]);

let catalogCacheRaw = null;
let catalogCache = null;

function cleanId(value, fallback = "") {
    const normalized = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);

    return normalized || fallback;
}

function cleanTime(value, fallback = "") {
    const time = String(value || "").trim();
    return TIME_RE.test(time) ? time : fallback;
}

function cloneDefaults() {
    return {
        version: 1,
        shifts: DEFAULT_SHIFTS.map(item => ({ ...item })),
        rotations: DEFAULT_ROTATIONS.map(item => ({
            ...item,
            pattern: [...item.pattern]
        }))
    };
}

function normalizeShift(raw, index) {
    const turn = Number(raw?.turn);
    const validTurn = [
        TURNO.LIBRE,
        TURNO.LARGA,
        TURNO.NOCHE,
        TURNO.TURNO24,
        TURNO.DIURNO,
        TURNO.TURNO18
    ].includes(turn) ? turn : TURNO.LIBRE;
    const id = cleanId(raw?.id, `turno-${index + 1}`);
    const isFree = validTurn === TURNO.LIBRE;

    return {
        id,
        name: String(raw?.name || `Turno ${index + 1}`).trim().slice(0, 60),
        turn: validTurn,
        start: isFree ? "" : cleanTime(raw?.start, "08:00"),
        end: isFree ? "" : cleanTime(raw?.end, "20:00"),
        fridayEnd: validTurn === TURNO.DIURNO
            ? cleanTime(raw?.fridayEnd, cleanTime(raw?.end, "17:00"))
            : "",
        nextDay: isFree ? false : Boolean(raw?.nextDay),
        active: raw?.active !== false,
        builtin: Boolean(raw?.builtin)
    };
}

function protectedShift(raw, fallback) {
    return {
        ...fallback,
        active: true,
        builtin: true
    };
}

function normalizeRotation(raw, index, shiftIds) {
    const id = cleanId(raw?.id, `rotativa-${index + 1}`);
    const pattern = (Array.isArray(raw?.pattern) ? raw.pattern : [])
        .map(value => String(value || ""))
        .filter(value => shiftIds.has(value))
        .slice(0, 62);

    return {
        id,
        name: String(raw?.name || `Rotativa ${index + 1}`).trim().slice(0, 60),
        mode: raw?.mode === "businessDays" ? "businessDays" : "sequence",
        pattern: pattern.length ? pattern : ["libre"],
        active: raw?.active !== false,
        builtin: Boolean(raw?.builtin)
    };
}

function protectedRotation(raw, fallback) {
    return {
        ...fallback,
        pattern: [...fallback.pattern],
        active: raw?.active !== false,
        builtin: true
    };
}

export function normalizeRotationCatalog(raw) {
    if (!raw || !Array.isArray(raw.shifts) || !Array.isArray(raw.rotations)) {
        return cloneDefaults();
    }

    const defaultShiftIds = new Set(DEFAULT_SHIFTS.map(item => item.id));
    const shifts = [
        ...DEFAULT_SHIFTS.map(item => protectedShift(
            raw.shifts.find(candidate => candidate?.id === item.id),
            item
        )),
        ...raw.shifts
            .filter(item => !defaultShiftIds.has(String(item?.id || "")))
            .map(normalizeShift)
    ];
    const seenShifts = new Set();
    const uniqueShifts = shifts.filter(item => {
        if (seenShifts.has(item.id)) return false;
        seenShifts.add(item.id);
        return true;
    });

    const shiftIds = new Set(uniqueShifts.map(item => item.id));
    const defaultRotationIds = new Set(DEFAULT_ROTATIONS.map(item => item.id));
    const rotations = [
        ...DEFAULT_ROTATIONS.map(item => protectedRotation(
            raw.rotations.find(candidate => candidate?.id === item.id),
            item
        )),
        ...raw.rotations
            .filter(item => !defaultRotationIds.has(String(item?.id || "")))
            .map((item, index) => normalizeRotation(item, index, shiftIds))
    ];
    const seenRotations = new Set();

    return {
        version: 1,
        shifts: uniqueShifts,
        rotations: rotations.filter(item => {
            if (seenRotations.has(item.id)) return false;
            seenRotations.add(item.id);
            return true;
        })
    };
}

export function getRotationCatalog() {
    const raw = getRaw(ROTATION_CATALOG_KEY, "");
    if (catalogCache && raw === catalogCacheRaw) return catalogCache;

    let parsed = null;
    try {
        parsed = raw ? JSON.parse(raw) : null;
    } catch {
        parsed = null;
    }

    catalogCacheRaw = raw;
    catalogCache = normalizeRotationCatalog(parsed);
    return catalogCache;
}

export function saveRotationCatalog(catalog) {
    const normalized = normalizeRotationCatalog(catalog);
    setJSON(ROTATION_CATALOG_KEY, normalized);
    catalogCacheRaw = getRaw(ROTATION_CATALOG_KEY, "");
    catalogCache = normalized;
    return normalized;
}

function catalogView(catalog) {
    return catalog?.version === 1 &&
        Array.isArray(catalog.shifts) &&
        Array.isArray(catalog.rotations)
        ? catalog
        : normalizeRotationCatalog(catalog);
}

export function getShiftDefinitions(catalog = getRotationCatalog(), options = {}) {
    return catalogView(catalog).shifts.filter(item => options.includeInactive || item.active);
}

export function getRotationDefinitions(catalog = getRotationCatalog(), options = {}) {
    return catalogView(catalog).rotations.filter(item => options.includeInactive || item.active);
}

export function getShiftDefinition(id, catalog = getRotationCatalog()) {
    return catalogView(catalog).shifts.find(item =>
        item.id === String(id || "")
    ) || null;
}

export function getRotationDefinition(id, catalog = getRotationCatalog()) {
    return catalogView(catalog).rotations.find(item =>
        item.id === String(id || "")
    ) || null;
}

export function normalizeRotationTypeId(value, catalog = getRotationCatalog()) {
    const source = String(value || "").trim();
    const aliases = {
        "3 turno": "3turno",
        "3er turno": "3turno",
        "tercer turno": "3turno",
        "4 turno": "4turno",
        "4oturno": "4turno",
        "cuarto turno": "4turno"
    };
    const plain = source
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const candidate = aliases[plain] || source;

    if (["libre", "reemplazo"].includes(candidate)) return candidate;

    return getRotationDefinition(candidate, catalog)?.id || "";
}

export function rotationStartIndex(type, firstTurn, catalog = getRotationCatalog()) {
    const definition = getRotationDefinition(type, catalog);
    if (!definition || definition.mode !== "sequence") return 0;

    const raw = String(firstTurn || "");
    const normalized = raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    if (/^position:\d+$/.test(normalized)) {
        const index = Number(normalized.split(":")[1]);
        return Math.max(0, Math.min(definition.pattern.length - 1, index));
    }

    let legacyValue = "larga";
    if (["larga2", "largo2", "segunda larga", "segundo largo", "2 larga", "2 largo"].includes(normalized)) {
        legacyValue = "larga2";
    } else if (["noche2", "segunda noche", "2 noche"].includes(normalized)) {
        legacyValue = "noche2";
    } else if (["libre2", "segundo libre", "segunda libre", "2 libre"].includes(normalized)) {
        legacyValue = "libre2";
    } else if (["libre", "libre1", "primer libre", "primera libre", "1 libre"].includes(normalized)) {
        legacyValue = "libre1";
    } else if (normalized === "noche") {
        legacyValue = "noche";
    }

    const legacy = {
        larga: 0,
        larga2: 1,
        noche: type === "3turno" ? 2 : 1,
        noche2: 3,
        libre1: type === "3turno" ? 4 : 2,
        libre2: type === "3turno" ? 5 : 3
    };

    return Math.max(0, Math.min(
        definition.pattern.length - 1,
        Number(legacy[legacyValue]) || 0
    ));
}

export function rotationTurnSequence(type, firstTurn, catalog = getRotationCatalog()) {
    const definition = getRotationDefinition(type, catalog);
    if (!definition || definition.mode !== "sequence") return [];
    const shifts = new Map(catalogView(catalog).shifts.map(item => [item.id, item]));
    const turns = definition.pattern.map(id =>
        Number(shifts.get(id)?.turn) || TURNO.LIBRE
    );
    const start = rotationStartIndex(type, firstTurn, catalog);

    return [...turns.slice(start), ...turns.slice(0, start)];
}

export function rotationShiftSequence(type, firstTurn, catalog = getRotationCatalog()) {
    const definition = getRotationDefinition(type, catalog);
    if (!definition || definition.mode !== "sequence") return [];
    const start = rotationStartIndex(type, firstTurn, catalog);

    return [
        ...definition.pattern.slice(start),
        ...definition.pattern.slice(0, start)
    ];
}

export function rotationUsesBusinessDays(type, catalog = getRotationCatalog()) {
    return getRotationDefinition(type, catalog)?.mode === "businessDays";
}

export function rotationUsesCustomSchedule(type, catalog = getRotationCatalog()) {
    const definition = getRotationDefinition(type, catalog);
    return Boolean(definition && !definition.builtin);
}

export function rotationBusinessDayTurn(type, catalog = getRotationCatalog()) {
    const definition = getRotationDefinition(type, catalog);
    if (!definition || definition.mode !== "businessDays") return TURNO.LIBRE;
    return Number(getShiftDefinition(definition.pattern[0], catalog)?.turn) || TURNO.LIBRE;
}

export function rotationProducesTurns(type, catalog = getRotationCatalog()) {
    const definition = getRotationDefinition(type, catalog);
    if (!definition) return false;
    const shifts = new Map(catalogView(catalog).shifts.map(item => [item.id, item]));
    return definition.pattern.some(id => Number(shifts.get(id)?.turn) !== TURNO.LIBRE);
}

export function rotationStartOptions(type, catalog = getRotationCatalog()) {
    const definition = getRotationDefinition(type, catalog);
    if (!definition || definition.mode !== "sequence" || definition.pattern.length < 2) {
        return [];
    }

    const shifts = new Map(catalogView(catalog).shifts.map(item => [item.id, item]));
    return definition.pattern.map((shiftId, index) => {
        const name = shifts.get(shiftId)?.name || "Libre";
        return {
            value: `position:${index}`,
            label: `Iniciar en dia ${index + 1}: ${name}`,
            summary: `${name} (dia ${index + 1})`,
            detail: `Comenzar en la posicion ${index + 1} del patron`
        };
    });
}

export function rotationShiftForDate(rotativa, date, options = {}) {
    const catalog = options.catalog || getRotationCatalog();
    const definition = getRotationDefinition(rotativa?.type, catalog);
    if (!definition || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;

    const start = new Date(`${rotativa?.start || ""}T00:00:00`);
    if (Number.isNaN(start.getTime()) || date < start) {
        return getShiftDefinition("libre", catalog);
    }

    if (definition.mode === "businessDays") {
        return options.isBusinessDay === false
            ? getShiftDefinition("libre", catalog)
            : getShiftDefinition(definition.pattern[0], catalog);
    }

    const difference = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
    const sequence = rotationShiftSequence(rotativa.type, rotativa.firstTurn, catalog);
    if (!sequence.length) return null;
    const shiftId = sequence[((difference % sequence.length) + sequence.length) % sequence.length];
    return getShiftDefinition(shiftId, catalog);
}

export function createCatalogId(name, existingIds = []) {
    const root = cleanId(name, "nueva-rotativa");
    const used = new Set(existingIds);
    let candidate = root;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${root}-${suffix++}`;
    return candidate;
}

export function detectRotationPattern(values) {
    const sequence = Array.isArray(values) ? values.map(value => String(value || "")) : [];
    let length = 0;
    while (length < sequence.length && sequence[length]) length += 1;
    if (length < 2) return [];

    for (let period = 1; period <= Math.floor(length / 2); period += 1) {
        let matches = true;
        for (let index = period; index < length; index += 1) {
            if (sequence[index] !== sequence[index % period]) {
                matches = false;
                break;
            }
        }
        if (matches && length >= period * 2) return sequence.slice(0, period);
    }
    return [];
}
