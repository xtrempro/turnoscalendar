import { parseKeyParts as parseKey } from "./dateUtils.js";
import { normalizeText } from "./stringUtils.js";
import {
    getProfiles,
    getProfileData,
    getReplacementContracts,
    saveReplacementContracts,
    getHonorariaContracts,
    saveHonorariaContracts,
    hasHonorariaContractsStored,
    getRotativa,
    getContractTypeAt
} from "./storage.js";
import { TURNO } from "./constants.js";
import { getJSON } from "./persistence.js";
import {
    REPLACEMENT_ROTATION_MODE,
    normalizeReplacementRotationMode
} from "./replacementRotation.js";

function addDaysISO(iso, offset) {
    const parts = String(iso || "").split("-").map(Number);
    const date = new Date(
        Number(parts[0]) || 0,
        (Number(parts[1]) || 1) - 1,
        Number(parts[2]) || 1
    );

    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() + Number(offset || 0));

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

// Ajusta [start, end] (ISO) para que un nuevo contrato no se superponga con los
// contratos existentes del mismo trabajador (por otro justificativo): si un
// contrato ya cubre el inicio, el nuevo empieza el dia inmediatamente posterior
// a aquel; si otro contrato empieza dentro del rango, el nuevo termina el dia
// inmediatamente anterior. Devuelve null si no queda ningun dia libre.
export function clampContractRange(start, end, existingContracts = []) {
    if (!start || !end) return null;

    const existing = (existingContracts || [])
        .filter(contract => contract && contract.start && contract.end)
        .sort((a, b) => a.start.localeCompare(b.start));
    let s = start;
    let e = end;

    for (const contract of existing) {
        if (contract.end < s || contract.start > e) continue;

        if (contract.start <= s) {
            s = addDaysISO(contract.end, 1);
        } else {
            e = addDaysISO(contract.start, -1);
            break;
        }

        if (!s || s > e) break;
    }

    if (!s || !e || s > e) return null;

    return { start: s, end: e };
}

export function keyToISO(keyDay) {
    const { year, month, day } = parseKey(keyDay);

    if (!year || month < 0 || !day) return "";

    return [
        year,
        String(month + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

function contractDateToISO(value) {
    const source = String(value || "").trim();

    if (!source) return "";

    if (/^\d{4}-\d{2}-\d{2}/.test(source)) {
        return source.slice(0, 10);
    }

    return keyToISO(source);
}

export function formatContractDate(value) {
    const parts = String(value || "").split("-");

    if (parts.length !== 3) return value || "";

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function normalizeContract(contract = {}) {
    return {
        id: String(contract.id || Date.now()),
        start: String(contract.start || ""),
        end: String(contract.end || ""),
        replaces: String(contract.replaces || "").trim(),
        reason: String(contract.reason || "").trim(),
        leaveRef: String(contract.leaveRef || "").trim(),
        leaveType: String(contract.leaveType || "").trim(),
        leaveStart: String(contract.leaveStart || "").trim(),
        leaveEnd: String(contract.leaveEnd || "").trim(),
        rotationMode: normalizeReplacementRotationMode(
            contract.rotationMode,
            REPLACEMENT_ROTATION_MODE.INHERIT
        ),
        bridgeProfile: String(
            contract.bridgeProfile ||
            contract.diurnoBridgeProfile ||
            contract.diurnoCoverageProfile ||
            ""
        ).trim(),
        excludedDates: Array.from(new Set(
            (Array.isArray(contract.excludedDates)
                ? contract.excludedDates
                : [])
                .map(value => String(value || "").slice(0, 10))
                .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
        )).sort(),
        createdAt:
            contract.createdAt ||
            new Date().toISOString()
    };
}

export function getContractsForProfile(profileName) {
    return getReplacementContracts(profileName)
        .map(normalizeContract)
        .filter(contract =>
            contract.start &&
            contract.end &&
            contract.replaces
        )
        .sort((a, b) =>
            a.start.localeCompare(b.start) ||
            a.end.localeCompare(b.end)
        );
}

export function saveContractsForProfile(profileName, contracts) {
    saveReplacementContracts(
        (contracts || []).map(normalizeContract),
        profileName
    );
}

/**
 * Quita UN dia de un contrato de reemplazo, sin tocar el resto: el reemplazante
 * deja de heredar ese turno (el motor lo da Libre, ver rotativaTurnoBase) y el
 * turno del ausente vuelve a quedar pendiente de cobertura.
 *
 * Trabaja sobre la lista GUARDADA, no sobre getContractsForProfile: esa filtra
 * los contratos incompletos y fabrica ids con la hora, y volver a guardarla
 * perderia contratos. El contrato se reconoce por su id o, si no tiene, por
 * inicio, fin y ausente.
 *
 * @returns {boolean} si se excluyo el dia
 */
export function excludeReplacementContractDate(contract, iso) {
    const worker = String(contract?.worker || "").trim();
    const day = String(iso || "").slice(0, 10);

    if (!worker || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;

    const sameContract = item =>
        (item?.id && contract.id && String(item.id) === String(contract.id)) ||
        (
            String(item?.start || "") === String(contract.start || "") &&
            String(item?.end || "") === String(contract.end || "") &&
            String(item?.replaces || "").trim() === String(contract.replaces || "").trim()
        );
    let changed = false;
    const next = getReplacementContracts(worker).map(item => {
        if (changed || !sameContract(item)) return item;

        changed = true;

        return {
            ...item,
            excludedDates: Array.from(new Set([
                ...(Array.isArray(item.excludedDates) ? item.excludedDates : []),
                day
            ])).sort()
        };
    });

    if (changed) saveContractsForProfile(worker, next);

    return changed;
}

function isoDaysBetween(startISO, endISO) {
    const days = [];
    const start = new Date(`${startISO}T12:00:00`);
    const end = new Date(`${endISO}T12:00:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return days;

    for (const day = start; day <= end; day.setDate(day.getDate() + 1)) {
        days.push([
            day.getFullYear(),
            String(day.getMonth() + 1).padStart(2, "0"),
            String(day.getDate()).padStart(2, "0")
        ].join("-"));
    }

    return days;
}

function isoToCalendarKey(iso) {
    const [year, month, day] = String(iso || "").split("-").map(Number);

    return year && month && day ? `${year}-${month - 1}-${day}` : "";
}

function absenceTypeOf(value) {
    if (value && typeof value === "object") return String(value.type || "");

    return String(value || "");
}

// Si al ausente le queda, en esos dias, un permiso DEL MISMO TIPO que origino el
// contrato. Otro permiso (un P. Administrativo puesto despues) no lo mantiene:
// ese necesita su propia cobertura. Se lee de los mapas guardados -no del perfil
// abierto: el ausente casi nunca es el perfil que se esta mirando-.
function hasLeaveOfTypeOnAnyDay(profile, isoDays, leaveType) {
    const type = String(leaveType || "").trim();
    const map = getJSON(
        `${type === "legal" || type === "comp" ? type : "absences"}_${profile}`,
        {}
    ) || {};

    return isoDays.some(iso => {
        const value = map[isoToCalendarKey(iso)];

        if (!value) return false;
        if (type === "legal" || type === "comp" || !type) return true;

        return absenceTypeOf(value) === type;
    });
}

/**
 * Anular un permiso anula tambien el CONTRATO de reemplazo que nacio de el.
 *
 * El contrato hereda los turnos del ausente en todo su rango, sin preguntar si
 * el ausente sigue ausente: al anular el permiso se cancelaban los reemplazos
 * por dia, pero el contrato seguia vigente, y un permiso nuevo esos mismos dias
 * salia "cubierto" por el contrato viejo sin preguntar quien cubre (paso el
 * 2026-10-01 con un F. Legal anulado y un P. Administrativo puesto despues).
 *
 * Solo se tocan los contratos que vienen de un permiso (`leaveType` o
 * `leaveRef`): uno hecho a mano por una vacante no depende de ningun permiso.
 * Se llama DESPUES de quitar el permiso de los mapas. Si al ausente ya no le
 * queda ningun permiso dentro del rango del contrato, el contrato se elimina
 * (un F. Legal cuenta dias habiles y el contrato corre seguido: los fines de
 * semana no vienen en los dias anulados, pero tampoco tienen razon de seguir).
 * Si le queda alguno, solo se excluyen los dias anulados (igual que "Quitar
 * reemplazo" de un dia).
 *
 * Trabaja sobre la lista GUARDADA (ver excludeReplacementContractDate).
 *
 * @param {{profile: string, leaveType?: string, keys: string[]}} leave el
 *   permiso anulado: el ausente, su tipo y los dias (claves del calendario)
 * @returns {Array<{worker: string, contract: Object, action: "removed"|"excluded", dates: string[]}>}
 */
export function cancelReplacementContractsForLeave({
    profile,
    leaveType = "",
    keys = []
} = {}) {
    const replaced = String(profile || "").trim();
    const canceled = new Set(
        (Array.isArray(keys) ? keys : []).map(keyToISO).filter(Boolean)
    );
    const type = String(leaveType || "").trim();
    const results = [];

    if (!replaced || !canceled.size) return results;

    getProfiles().forEach(({ name: worker }) => {
        if (!worker) return;

        const stored = getReplacementContracts(worker);
        let changed = false;
        const next = [];

        stored.forEach(contract => {
            const fromLeave = Boolean(
                String(contract?.leaveType || "").trim() ||
                String(contract?.leaveRef || "").trim()
            );
            const sameType = !type ||
                !String(contract?.leaveType || "").trim() ||
                String(contract.leaveType).trim() === type;

            if (
                String(contract?.replaces || "").trim() !== replaced ||
                !fromLeave ||
                !sameType ||
                !contract.start ||
                !contract.end
            ) {
                next.push(contract);
                return;
            }

            const excluded = new Set(
                Array.isArray(contract.excludedDates) ? contract.excludedDates : []
            );
            const contractDays = isoDaysBetween(contract.start, contract.end)
                .filter(day => !excluded.has(day));
            const hit = contractDays.filter(day => canceled.has(day));

            if (!hit.length) {
                next.push(contract);
                return;
            }

            changed = true;

            if (
                !hasLeaveOfTypeOnAnyDay(
                    replaced,
                    contractDays,
                    contract.leaveType || type
                )
            ) {
                results.push({ worker, contract, action: "removed", dates: hit });
                return;
            }

            next.push({
                ...contract,
                excludedDates: Array.from(new Set([...excluded, ...hit])).sort()
            });
            results.push({ worker, contract, action: "excluded", dates: hit });
        });

        if (changed) saveContractsForProfile(worker, next);
    });

    return results;
}

export function addReplacementContract(profileName, contract) {
    const nextContract = normalizeContract({
        ...contract,
        id:
            contract.id ||
            `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
    const contracts = getContractsForProfile(profileName);

    saveContractsForProfile(
        profileName,
        [...contracts, nextContract]
    );

    return nextContract;
}

export function isReplacementContractType(value) {
    return normalizeText(value) === "reemplazo";
}

export function isHonorariaContractType(value) {
    return normalizeText(value) === "honorarios";
}

export function isOtherContractType(value) {
    return normalizeText(value) === "otros";
}

export function normalizeHonorariaContract(contract = {}) {
    // Desde ahora el tope de Honorarios es siempre mensual. Los aliases antiguos
    // se siguen leyendo para que un contrato guardado como semanal no pierda su
    // valor, pero hacia el resto de la aplicacion sale canonizado como mensual.
    const maxHours = Math.max(
        0,
        Number(contract.maxHours) ||
            Number(contract.maxMonthlyHours) ||
            Number(contract.maxWeeklyHours) ||
            0
    );

    return {
        id: String(contract.id || Date.now()),
        start: String(contract.start || "").trim(),
        end: String(contract.end || "").trim(),
        hourlyRate: Math.max(0, Number(contract.hourlyRate) || 0),
        maxHours,
        limitPeriod: "monthly",
        maxWeeklyHours: 0,
        maxMonthlyHours: maxHours,
        createdAt: contract.createdAt || new Date().toISOString()
    };
}

function resolveHonorariaProfile(profileOrName) {
    return typeof profileOrName === "string"
        ? getProfiles().find(item => item.name === profileOrName)
        : profileOrName;
}

// Contrato "legado": mientras un trabajador de Honorarios no tenga contratos en
// el arreglo, se sintetiza uno con los campos antiguos del perfil (migracion de
// solo lectura, para no romper datos existentes).
function legacyHonorariaContract(profile) {
    if (!profile?.honorariaStart || !profile?.honorariaEnd) return null;

    return normalizeHonorariaContract({
        id: "legacy",
        start: profile.honorariaStart,
        end: profile.honorariaEnd,
        hourlyRate: profile.honorariaHourlyRate,
        maxMonthlyHours:
            profile.honorariaMaxMonthlyHours ||
            profile.honorariaMaxWeeklyHours
    });
}

export function getHonorariaContractsForProfile(profileOrName) {
    const profile = resolveHonorariaProfile(profileOrName);
    // El nombre puede venir directo (perfil aun no guardado, p.ej. al crear): los
    // contratos se guardan por nombre en honorariaContracts_{nombre}, asi que se
    // leen aunque el perfil todavia no exista en getProfiles().
    const name = typeof profileOrName === "string"
        ? profileOrName
        : (profile?.name || "");

    if (!name) return [];

    const stored = getHonorariaContracts(name)
        .map(normalizeHonorariaContract)
        .filter(contract => contract.start && contract.end);

    if (stored.length) {
        return stored.sort((a, b) =>
            a.start.localeCompare(b.start) ||
            a.end.localeCompare(b.end)
        );
    }

    // Una vez que el trabajador paso a la lista, no se re-migra el contrato
    // legado (aunque haya borrado todos sus contratos).
    if (hasHonorariaContractsStored(name)) return [];

    // La migracion del contrato legado (campos antiguos del perfil) si requiere un
    // perfil guardado de tipo Honorarios.
    if (!isHonorariaContractType(profile?.contractType)) return [];

    const legacy = legacyHonorariaContract(profile);

    return legacy ? [legacy] : [];
}

export function saveHonorariaContractsForProfile(profileName, contracts) {
    saveHonorariaContracts(
        (contracts || []).map(normalizeHonorariaContract),
        profileName
    );
}

export function addHonorariaContract(profileName, contract) {
    const nextContract = normalizeHonorariaContract({
        ...contract,
        id:
            contract.id ||
            `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
    // Materializa el contrato legado (campos antiguos del perfil) al arreglo con
    // un id real, para no perderlo al pasar del campo unico a la lista.
    const contracts = getHonorariaContractsForProfile(profileName)
        .map(existing => existing.id === "legacy"
            ? { ...existing, id: `${Date.now()}_leg` }
            : existing
        );

    saveHonorariaContractsForProfile(
        profileName,
        [...contracts, nextContract]
    );

    return nextContract;
}

// Actualiza un contrato existente (por id) aplicando un parche. Conserva el resto
// de sus campos —tarifa y tope incluidos— salvo lo que traiga el parche, y
// materializa el contrato legado si fuera el afectado. Devuelve el contrato
// actualizado, o null si no existe. Se usa al "extender" un contrato desde el
// calendario: solo cambian sus fechas, manteniendo su valor hora y tope.
export function updateHonorariaContract(profileName, contractId, patch = {}) {
    let updated = null;
    const next = getHonorariaContractsForProfile(profileName).map(existing => {
        const isTarget = existing.id === contractId;
        const base = existing.id === "legacy"
            ? { ...existing, id: `${Date.now()}_leg` }
            : existing;

        if (isTarget) {
            updated = normalizeHonorariaContract({
                ...base,
                ...patch,
                id: base.id
            });

            return updated;
        }

        return base;
    });

    if (!updated) return null;

    saveHonorariaContractsForProfile(profileName, next);

    return updated;
}

// Elimina un contrato del arreglo. Como puede haber un contrato legado (solo en
// los campos del perfil), primero se materializa la lista actual y luego se filtra.
export function removeHonorariaContract(profileName, contractId) {
    const contracts = getHonorariaContractsForProfile(profileName)
        .map(existing => existing.id === "legacy"
            ? { ...existing, id: `${Date.now()}_leg` }
            : existing
        )
        .filter(existing => existing.id !== contractId);

    saveHonorariaContractsForProfile(profileName, contracts);
}

// Inicio (ISO) del primer contrato de Honorarios del trabajador, o "" si no hay.
// La rotativa de honorarios se ancla aqui para cubrir los contratos aunque se
// elimine uno o el start quede desalineado.
export function earliestHonorariaContractStart(profileName) {
    const contracts = getHonorariaContractsForProfile(profileName);

    return contracts.length ? contracts[0].start : "";
}

export function getHonorariaContractForDate(profileName, keyDay) {
    const iso = contractDateToISO(keyDay);

    if (!iso) return null;
    if (
        !isHonorariaContractType(
            getContractTypeAt(profileName, iso)
        )
    ) {
        return null;
    }

    const contract = getHonorariaContractsForProfile(profileName)
        .find(contract =>
            contract.start <= iso &&
            contract.end >= iso
        );

    if (contract) return contract;

    const profile = resolveHonorariaProfile(profileName);
    const legacy = legacyHonorariaContract(profile);

    return legacy &&
        legacy.start <= iso &&
        legacy.end >= iso
        ? legacy
        : null;
}

// Contrato "vigente" de referencia (para consumidores sin fecha): el activo hoy,
// o el mas reciente. Mantiene la firma anterior.
export function getHonorariaContract(profileOrName) {
    const profile = resolveHonorariaProfile(profileOrName);

    const name = typeof profileOrName === "string"
        ? profileOrName
        : profile?.name;

    if (
        !isHonorariaContractType(
            getContractTypeAt(name, new Date())
        )
    ) {
        return null;
    }

    const contracts = getHonorariaContractsForProfile(profile);

    if (!contracts.length) return null;

    const todayISO = keyToISO(
        `${new Date().getFullYear()}-${new Date().getMonth()}-${new Date().getDate()}`
    );
    const active = todayISO
        ? contracts.find(contract =>
            contract.start <= todayISO && contract.end >= todayISO
        )
        : null;

    return active || contracts[contracts.length - 1];
}

// Es de Honorarios por su TIPO de contrato (aunque aun no tenga contratos
// cargados): sus dias sin contrato vigente quedan libres hasta agregar uno.
export function isHonorariaProfile(profileName, keyDay = "") {
    const profile = resolveHonorariaProfile(profileName);
    const iso = keyDay ? contractDateToISO(keyDay) : "";

    return isHonorariaContractType(
        iso
            ? getContractTypeAt(profileName, iso)
            : getContractTypeAt(
                typeof profileName === "string"
                    ? profileName
                    : profile?.name,
                new Date()
            ) || profile?.contractType
    );
}

export function hasHonorariaContractForDate(profileName, keyDay) {
    return Boolean(getHonorariaContractForDate(profileName, keyDay));
}

export function isReplacementProfile(profileName, keyDay = "") {
    const profile = getProfiles().find(item =>
        item.name === profileName
    );
    const iso = keyDay ? contractDateToISO(keyDay) : "";
    const contractType = iso
        ? getContractTypeAt(profileName, iso)
        : getContractTypeAt(profileName, new Date()) ||
            profile?.contractType;

    if (isReplacementContractType(contractType)) return true;
    if (String(contractType || "").trim()) return false;

    return getRotativa(profileName).type === "reemplazo";
}

export function getContractForDate(profileName, keyDay) {
    return getReplacementContractsForDate(profileName, keyDay)[0] || null;
}

export function replacementContractExcludesDate(contract, keyDay) {
    const iso = keyToISO(keyDay);

    return Boolean(
        iso &&
        Array.isArray(contract?.excludedDates) &&
        contract.excludedDates.includes(iso)
    );
}

// Puede haber mas de un contrato vigente el mismo dia. El primero sigue
// definiendo la proyeccion historica del turno, pero la interfaz necesita todos
// para explicar a quienes cubre el reemplazante en esa casilla.
export function getReplacementContractsForDate(profileName, keyDay) {
    if (!isReplacementProfile(profileName, keyDay)) return [];

    const iso = keyToISO(keyDay);

    if (!iso) return [];

    return getContractsForProfile(profileName)
        .filter(contract =>
            contract.start <= iso &&
            contract.end >= iso
        );
}

export function getReplacementRotationModeForDate(
    profileName,
    keyDay
) {
    const contract = getContractForDate(profileName, keyDay);

    if (!contract) return "";

    return normalizeReplacementRotationMode(
        contract.rotationMode,
        REPLACEMENT_ROTATION_MODE.INHERIT
    );
}

export function hasContractForDate(profileName, keyDay) {
    return Boolean(getContractForDate(profileName, keyDay));
}

export function getReplacedProfileForDate(profileName, keyDay) {
    return getContractForDate(profileName, keyDay)?.replaces || "";
}

export function getReplacementBridgeProfileForDate(
    profileName,
    keyDay
) {
    return getContractForDate(profileName, keyDay)?.bridgeProfile || "";
}

export function getAllReplacementContracts() {
    return replacementContractsWhere(() => true);
}

// Lo mismo que getAllReplacementContracts, pero filtrando ANTES de preguntar a
// cada perfil si es de reemplazo (lo caro: recorre su historial de contrato).
// El motor de turnos busca por cada dia-persona el contrato que lo tiene de
// puente o de reemplazado, que casi nunca existe; recorrer primero toda la
// unidad hacia que armar un mes tardara segundos.
function replacementContractsWhere(matches) {
    return getProfiles()
        .flatMap(profile => {
            const contracts = getContractsForProfile(profile.name)
                .map(contract => ({
                    ...contract,
                    worker: profile.name,
                    estamento: profile.estamento
                }))
                .filter(matches);

            return contracts.length && isReplacementProfile(profile.name)
                ? contracts
                : [];
        })
        .sort((a, b) =>
            a.start.localeCompare(b.start) ||
            a.worker.localeCompare(b.worker)
        );
}

export function replacementContractCoversCoveredShift(
    contract,
    keyDay
) {
    const iso = keyToISO(keyDay);
    const mode = normalizeReplacementRotationMode(
        contract?.rotationMode,
        REPLACEMENT_ROTATION_MODE.INHERIT
    );
    const coverageWorker =
        mode === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
            ? contract?.bridgeProfile
            : contract?.worker;

    if (
        !coverageWorker ||
        !contract?.replaces ||
        !iso ||
        replacementContractExcludesDate(contract, keyDay) ||
        contract.start > iso ||
        contract.end < iso ||
        ![
            REPLACEMENT_ROTATION_MODE.INHERIT,
            REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
        ].includes(mode)
    ) {
        return false;
    }

    const data = getProfileData(coverageWorker);

    if (
        Object.prototype.hasOwnProperty.call(data, keyDay) &&
        Number(data[keyDay]) <= TURNO.LIBRE
    ) {
        return false;
    }

    return true;
}

export function getReplacementContractCoverageWorker(contract) {
    const mode = normalizeReplacementRotationMode(
        contract?.rotationMode,
        REPLACEMENT_ROTATION_MODE.INHERIT
    );

    return mode === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
        ? String(contract?.bridgeProfile || "").trim()
        : String(contract?.worker || "").trim();
}

export function getDiurnoBridgeContractForProfile(profileName, keyDay) {
    const worker = String(profileName || "").trim();

    if (!worker || !keyToISO(keyDay)) return null;

    return replacementContractsWhere(contract =>
        contract.bridgeProfile === worker &&
        normalizeReplacementRotationMode(
            contract.rotationMode,
            REPLACEMENT_ROTATION_MODE.INHERIT
        ) === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE
    )
        .find(contract =>
            replacementContractCoversCoveredShift(contract, keyDay)
        ) || null;
}

export function getInheritedReplacementContractForCoveredShift(
    profileName,
    keyDay
) {
    if (!profileName || !keyToISO(keyDay)) return null;

    return replacementContractsWhere(contract =>
        contract.replaces === profileName
    )
        .find(contract =>
            replacementContractCoversCoveredShift(
                contract,
                keyDay
            )
        ) || null;
}
