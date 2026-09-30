// Historial de turnos aceptados: lo que el supervisor deja anotado cuando quita
// a un trabajador de un turno que habia aceptado (un reemplazo o un apoyo
// extra) cuando el turno ya estaba por empezar, en curso o terminado. Tipico:
// "El funcionario no se presenta a trabajar".
//
// Se guarda por trabajador en `shiftAttendance_<nombre>` (modulo "profile", el
// mismo de `hrLogs_`: no necesita reglas nuevas en Firestore) y no dentro de
// `hrLogs_`, porque el panel de Registros RRHH reescribe esa clave solo con los
// tipos que conoce y borraria este.
//
// Lo leen el perfil (bajo Historial RRHH) y la calificacion, como antecedente de
// Comportamiento funcionario -> Asistencia y puntualidad (art. 16, 3 b del
// Reglamento General de Calificaciones).

import { getJSON, setJSON } from "./persistence.js";
import { asRecordList } from "./storage.js";

export const SHIFT_ATTENDANCE_PREFIX = "shiftAttendance_";

// Horas antes del inicio del turno desde las que quitar a alguien ya cuenta
// como asunto de asistencia (antes es solo reprogramar).
export const SHIFT_ATTENDANCE_WINDOW_HOURS = 6;

export function getShiftAttendance(profileName) {
    if (!profileName) return [];

    return asRecordList(getJSON(`${SHIFT_ATTENDANCE_PREFIX}${profileName}`, []))
        .filter(entry => entry && entry.id && !entry.deleted);
}

function saveShiftAttendance(profileName, list) {
    setJSON(`${SHIFT_ATTENDANCE_PREFIX}${profileName}`, list);
}

/**
 * @param {{date: string, turno?: string, turnoLabel?: string, comment: string,
 *   replaced?: string, reason?: string, source?: string, by?: string}} entry
 */
export function addShiftAttendanceEntry(profileName, entry = {}) {
    const comment = String(entry.comment || "").trim();

    if (!profileName || !entry.date || !comment) return null;

    const record = {
        id: `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        date: String(entry.date),
        turno: String(entry.turno || ""),
        turnoLabel: String(entry.turnoLabel || ""),
        comment,
        replaced: String(entry.replaced || ""),
        reason: String(entry.reason || ""),
        source: String(entry.source || ""),
        by: String(entry.by || ""),
        createdAt: new Date().toISOString()
    };

    saveShiftAttendance(profileName, [
        ...asRecordList(getJSON(`${SHIFT_ATTENDANCE_PREFIX}${profileName}`, [])),
        record
    ]);

    return record;
}

export function removeShiftAttendanceEntry(profileName, id) {
    if (!profileName || !id) return false;

    const list = asRecordList(getJSON(`${SHIFT_ATTENDANCE_PREFIX}${profileName}`, []));
    const next = list.filter(entry => String(entry?.id) !== String(id));

    if (next.length === list.length) return false;

    saveShiftAttendance(profileName, next);

    return true;
}

/**
 * ¿Quitar a alguien de este turno ahora amerita el registro? Desde 6 horas
 * antes de que empiece, mientras dura y en cualquier momento despues.
 */
export function shiftAttendanceWindowOpen(shiftStart, now = new Date()) {
    if (!(shiftStart instanceof Date) || Number.isNaN(shiftStart.getTime())) {
        return false;
    }

    return now.getTime() >= shiftStart.getTime() -
        SHIFT_ATTENDANCE_WINDOW_HOURS * 60 * 60 * 1000;
}

/** "Turno Larga del 22/09/2026: X no se presenta a turno: "..."" */
export function shiftAttendanceText(profileName, entry) {
    const [year, month, day] = String(entry?.date || "").split("-");
    const date = day ? `${day}/${month}/${year}` : String(entry?.date || "");
    const turno = entry?.turnoLabel ? `Turno ${entry.turnoLabel}` : "Turno";

    return `${turno} del ${date}: ${profileName} — "${entry?.comment || ""}"`;
}
