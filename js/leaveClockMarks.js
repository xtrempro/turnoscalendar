import { getJSON, setJSON } from "./persistence.js";
import { getClockMarks, saveClockMarks } from "./clockMarks.js";

const backupKey = profile => `leaveClockMarks_${profile}`;
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Respaldo por dia, en el modulo de marcajes (incluye documentos privados).
// La bitacora lleva solo su referencia, nunca copia archivos ni data URLs.
export function suspendClockMarksForLeave(profile, keys, logId) {
    const marks = getClockMarks(profile);
    const backups = getJSON(backupKey(profile), {});
    const absences = getJSON(`absences_${profile}`, {});
    const cleared = [];
    let backedUp = false;
    keys.forEach(key => {
        if (owns(marks, key)) {
            backups[key] = { logIds: [logId], mark: marks[key] };
            delete marks[key];
            cleared.push(key);
            backedUp = true;
        } else if (backups[key] &&
            ["license", "professional_license"].includes(absences[key]?.type)) {
            // Una licencia que sustituye otra hereda su horario suspendido.
            backups[key].logIds = [...new Set([...backups[key].logIds, logId])];
            backedUp = true;
        }
    });
    if (backedUp) setJSON(backupKey(profile), backups);
    if (cleared.length) saveClockMarks(profile, marks);
    return cleared;
}

export function restoreClockMarksForLeave(profile, keys, logId) {
    const backups = getJSON(backupKey(profile), {});
    const marks = getClockMarks(profile);
    const restored = [];
    let consumed = false;
    keys.forEach(key => {
        const backup = backups[key];
        if (!backup?.logIds?.includes(logId)) return;
        // Un ajuste creado despues de aplicar la licencia tiene prioridad.
        if (!owns(marks, key)) {
            marks[key] = backup.mark;
            restored.push(key);
        }
        delete backups[key];
        consumed = true;
    });
    if (restored.length) saveClockMarks(profile, marks);
    if (consumed) setJSON(backupKey(profile), backups);
    return restored;
}
