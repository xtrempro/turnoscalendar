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
    // El tope de horas puede ser semanal o mensual segun el contrato. maxHours es
    // el valor generico; limitPeriod indica el periodo del tope.
    const limitPeriod =
        String(contract.limitPeriod || "").trim().toLowerCase() === "monthly"
            ? "monthly"
            : "weekly";
    const maxHours = Math.max(
        0,
        Number(contract.maxHours) ||
            Number(contract.maxWeeklyHours) ||
            Number(contract.maxMonthlyHours) ||
            0
    );

    return {
        id: String(contract.id || Date.now()),
        start: String(contract.start || "").trim(),
        end: String(contract.end || "").trim(),
        hourlyRate: Math.max(0, Number(contract.hourlyRate) || 0),
        maxHours,
        limitPeriod,
        // Alias de compatibilidad: reflejan el tope segun su periodo. El consumidor
        // nuevo usa maxHours + limitPeriod.
        maxWeeklyHours: limitPeriod === "weekly" ? maxHours : 0,
        maxMonthlyHours: limitPeriod === "monthly" ? maxHours : 0,
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
        maxWeeklyHours:
            profile.honorariaMaxWeeklyHours ||
            profile.honorariaMaxMonthlyHours
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
    if (!isReplacementProfile(profileName, keyDay)) return null;

    const iso = keyToISO(keyDay);

    if (!iso) return null;

    return getContractsForProfile(profileName)
        .find(contract =>
            contract.start <= iso &&
            contract.end >= iso
        ) || null;
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
    return getProfiles()
        .filter(profile => isReplacementProfile(profile.name))
        .flatMap(profile =>
            getContractsForProfile(profile.name)
                .map(contract => ({
                    ...contract,
                    worker: profile.name,
                    estamento: profile.estamento
                }))
        )
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

    return getAllReplacementContracts()
        .find(contract =>
            contract.bridgeProfile === worker &&
            normalizeReplacementRotationMode(
                contract.rotationMode,
                REPLACEMENT_ROTATION_MODE.INHERIT
            ) === REPLACEMENT_ROTATION_MODE.DIURNO_BRIDGE &&
            replacementContractCoversCoveredShift(contract, keyDay)
        ) || null;
}

export function getInheritedReplacementContractForCoveredShift(
    profileName,
    keyDay
) {
    if (!profileName || !keyToISO(keyDay)) return null;

    return getAllReplacementContracts()
        .find(contract =>
            contract.replaces === profileName &&
            replacementContractCoversCoveredShift(
                contract,
                keyDay
            )
        ) || null;
}
