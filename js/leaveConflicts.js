// Dos permisos distintos sobre el mismo dia del mismo trabajador.
//
// Cada pestana valida un permiso contra lo que tiene cargado. Si dos
// supervisores aplican permisos distintos casi a la vez (paso el 2026-10-01: un
// F. Legal y un F. Compensatorio a Amanda con 0,6 s de diferencia), ninguna ve
// todavia el de la otra y los dos se guardan: cada tipo vive en su propio mapa
// (legal_, comp_, admin_, absences_), asi que no se pisan, se SUMAN.
//
// Regla: prevalece el que se aplico primero (hora de su registro en la
// bitacora). El segundo lo anula SOLO la sesion que lo aplico, por la via normal
// (undoAuditLogEntry: devuelve el saldo y anula reemplazos, contrato y
// memorandum). Asi nunca hay dos sesiones anulando a la vez.
//
// Respaldo: si esa sesion se cerro antes de enterarse, cualquier supervisor que
// vea el choque recibe un aviso para anular uno a mano.
//
// Solo cuenta como choque lo que se aplico dentro de RACE_WINDOW_MS: un permiso
// puesto encima de otro mucho despues paso por las reglas de la pestana, que si
// veia el primero; eso no es una carrera y no se toca.

import { getJSON } from "./persistence.js";
import { getProfiles } from "./storage.js";
import { getAbsenceType } from "./rulesEngine.js";
import {
    forgetSessionLeaveLog,
    getLeaveApplicationInfo,
    leaveLogsAppliedInThisSession,
    leaveLogUndoInfo,
    undoAuditLogEntry
} from "./auditLog.js";

export const RACE_WINDOW_MS = 2 * 60 * 1000;
const FALLBACK_DELAY_MS = 90 * 1000;
const RESOLVE_DEBOUNCE_MS = 1500;

const LEAVE_PREFIXES = ["admin", "legal", "comp", "absences"];
const TYPE_LABELS = {
    admin: "P. Administrativo",
    half_admin: "1/2 ADM",
    half_admin_morning: "1/2 ADM Mañana",
    half_admin_afternoon: "1/2 ADM Tarde",
    legal: "F. Legal",
    comp: "F. Compensatorio",
    license: "Licencia Médica",
    professional_license: "LM Profesional",
    union_leave: "Permiso Gremial",
    unpaid_leave: "Permiso sin Goce",
    training: "Capacitación",
    unjustified_absence: "Ausencia Injustificada"
};

export function leavePrefixForType(type) {
    const value = String(type || "");

    if (value === "legal" || value === "comp") return value;
    if (value === "admin" || value.startsWith("half_admin")) return "admin";

    return "absences";
}

// El tipo de permiso (el mismo nombre que usa la bitacora) que guarda un mapa
// en un dia.
function typeFromMapValue(prefix, value) {
    if (!value) return "";
    if (prefix === "legal" || prefix === "comp") return prefix;

    if (prefix === "admin") {
        if (value === "0.5M") return "half_admin_morning";
        if (value === "0.5T") return "half_admin_afternoon";
        if (Number(value) === 0.5) return "half_admin";

        return "admin";
    }

    return getAbsenceType(value) || "absence";
}

function leaveMaps(profile) {
    return Object.fromEntries(
        LEAVE_PREFIXES.map(prefix => [prefix, getJSON(`${prefix}_${profile}`, {}) || {}])
    );
}

/**
 * Los permisos de un dia que NO son del mapa de `ownType`.
 * @returns {string[]} sus tipos
 */
export function otherLeaveTypesOnDay(maps, keyDay, ownType) {
    const own = leavePrefixForType(ownType);

    return LEAVE_PREFIXES
        .filter(prefix => prefix !== own && maps[prefix]?.[keyDay])
        .map(prefix => typeFromMapValue(prefix, maps[prefix][keyDay]))
        .filter(Boolean);
}

/**
 * Quien prevalece entre dos permisos que chocan. Gana el aplicado primero; si
 * fueron en el mismo milisegundo, el de id menor (las dos pestanas llegan a la
 * misma respuesta sin hablarse).
 *
 * @returns {"mine"|"other"|"none"} "none": no es una carrera (fuera de la
 *   ventana), no se toca
 */
export function leaveConflictWinner(mine, other) {
    const mineAt = Date.parse(mine?.createdAt || "");
    const otherAt = Date.parse(other?.createdAt || "");

    if (!Number.isFinite(mineAt) || !Number.isFinite(otherAt)) return "none";
    if (Math.abs(mineAt - otherAt) > RACE_WINDOW_MS) return "none";
    if (otherAt < mineAt) return "other";
    if (mineAt < otherAt) return "mine";

    return String(other.id || other.logId || "") < String(mine.id || "")
        ? "other"
        : "mine";
}

function dayLabel(keyDay) {
    const [year, month, day] = String(keyDay || "").split("-").map(Number);
    const date = new Date(year, month, day);

    return Number.isNaN(date.getTime())
        ? String(keyDay || "")
        : date.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
}

function timeLabel(iso) {
    const date = new Date(iso);

    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function typeLabel(type) {
    return TYPE_LABELS[type] || "otro permiso";
}

// Los dias de un registro propio. Si el registro no los trae, se buscan en su
// mapa los dias que la bitacora le atribuye.
function ownLogKeys(log, profile, type, maps) {
    const { keys } = leaveLogUndoInfo(log);

    if (keys.length) return keys;

    const map = maps[leavePrefixForType(type)] || {};

    return Object.keys(map).filter(keyDay =>
        getLeaveApplicationInfo({ profile, keyDay, type, sourceMap: map })?.logId === log.id
    );
}

let resolving = false;
let pendingTimer = null;
const alerted = new Set();

/**
 * Revisa los permisos que aplico ESTA sesion: si alguno choca con uno ajeno
 * aplicado antes, lo anula. Devuelve los que anulo.
 */
export async function resolveOwnLeaveConflicts() {
    const undone = [];

    for (const log of leaveLogsAppliedInThisSession()) {
        const { type } = leaveLogUndoInfo(log);
        const profile = String(log.profile || log.meta?.profile || "").trim();

        if (!profile || !type) continue;

        const maps = leaveMaps(profile);
        let loser = null;
        let waiting = false;

        for (const keyDay of ownLogKeys(log, profile, type, maps)) {
            for (const otherType of otherLeaveTypesOnDay(maps, keyDay, type)) {
                const other = getLeaveApplicationInfo({ profile, keyDay, type: otherType });

                // El registro ajeno puede no haber llegado todavia: la bitacora
                // se sincroniza aparte. Se vuelve a mirar cuando llegue.
                if (!other) {
                    waiting = true;
                    continue;
                }

                if (leaveConflictWinner(log, { ...other, id: other.logId }) === "other") {
                    loser = { keyDay, otherType, other };
                    break;
                }
            }

            if (loser) break;
        }

        if (!loser) {
            // Pasada la ventana ya no puede aparecer una carrera con este.
            if (!waiting && Date.now() - Date.parse(log.createdAt) > RACE_WINDOW_MS) {
                forgetSessionLeaveLog(log.id);
            }
            continue;
        }

        const result = await undoAuditLogEntry(log.id, { source: "calendar" });

        forgetSessionLeaveLog(log.id);

        if (!result?.ok) continue;

        undone.push({ log, ...loser });
        alert(
            `Otro supervisor aplicó ${typeLabel(loser.otherType)} a ${profile} el ` +
            `${dayLabel(loser.keyDay)} antes que tú (${timeLabel(loser.other.createdAt)}). ` +
            `Para que quede uno solo, se anuló tu ${String(log.action || "permiso").replace(/^Aplic[oó]\s+/i, "")}.`
        );
    }

    return undone;
}

/**
 * Respaldo: choques entre permisos ajenos que nadie resolvio. Se avisa una vez
 * por choque, pasado un margen para que la sesion que lo aplico lo anule sola.
 */
export function findUnresolvedLeaveConflicts(now = Date.now()) {
    const found = [];

    getProfiles().forEach(({ name: profile }) => {
        if (!profile) return;

        const maps = leaveMaps(profile);
        const days = new Set(LEAVE_PREFIXES.flatMap(prefix => Object.keys(maps[prefix])));

        days.forEach(keyDay => {
            const types = LEAVE_PREFIXES
                .filter(prefix => maps[prefix][keyDay])
                .map(prefix => typeFromMapValue(prefix, maps[prefix][keyDay]));

            if (types.length < 2) return;

            const infos = types
                .map(type => getLeaveApplicationInfo({ profile, keyDay, type }))
                .filter(Boolean);

            if (infos.length < 2) return;

            const times = infos.map(info => Date.parse(info.createdAt)).filter(Number.isFinite);

            if (times.length < 2) return;
            if (Math.max(...times) - Math.min(...times) > RACE_WINDOW_MS) return;
            if (now - Math.max(...times) < FALLBACK_DELAY_MS) return;

            found.push({ profile, keyDay, types, logIds: infos.map(info => info.logId) });
        });
    });

    return found;
}

async function resolveNow() {
    if (resolving) return;

    resolving = true;

    try {
        await resolveOwnLeaveConflicts();

        // Un choque por perfil y bloque de permisos: un F. Legal de 10 dias que
        // choca entero es UN aviso, no diez.
        const byLogs = new Map();

        findUnresolvedLeaveConflicts().forEach(conflict => {
            const signature = [...conflict.logIds].sort().join("|");

            if (alerted.has(signature) || byLogs.has(signature)) return;
            byLogs.set(signature, conflict);
        });

        byLogs.forEach((conflict, signature) => {
            alerted.add(signature);
            alert(
                `${conflict.profile} quedó con dos permisos el mismo día (${dayLabel(conflict.keyDay)}): ` +
                `${conflict.types.map(typeLabel).join(" y ")}. Se aplicaron casi a la vez desde dos sesiones. ` +
                "Anula uno desde el calendario para que quede uno solo."
            );
        });
    } catch (error) {
        console.warn("No se pudieron revisar los permisos que chocan.", error);
    } finally {
        resolving = false;
    }
}

export function scheduleLeaveConflictCheck(delay = RESOLVE_DEBOUNCE_MS) {
    if (pendingTimer) clearTimeout(pendingTimer);

    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        void resolveNow();
    }, delay);
}

const WATCHED_KEY = /^(admin|legal|comp|absences)_|^auditLog$/;

export function startLeaveConflictWatch() {
    if (typeof window === "undefined") return;

    window.addEventListener("proturnos:firebaseAppState", event => {
        const detail = event?.detail || {};

        if (
            detail.type !== "app-state-entries-applied" ||
            !(detail.keys || []).some(key => WATCHED_KEY.test(String(key)))
        ) {
            return;
        }

        scheduleLeaveConflictCheck();
        // Y otra vez pasado el margen del respaldo: si la otra sesion no lo
        // resolvio, aqui se avisa.
        setTimeout(() => scheduleLeaveConflictCheck(0), FALLBACK_DELAY_MS + 2000);
    });
}
