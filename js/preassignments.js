// Preasignaciones: cobertura TENTATIVA de un turno con permiso. Es un paso
// intermedio entre "pendiente (!)" y "asignado": el supervisor le pregunta a un
// trabajador si puede cubrir y este dice "te confirmo". Se guarda aparte de los
// reemplazos (getReplacements) a proposito: asi el motor de horas y la proyeccion
// NUNCA la ven (no proyecta turno ni suma HH.EE) hasta que se confirma y se
// convierte en un reemplazo real via saveReplacement.
import { getJSON, setJSON } from "./persistence.js";
import { isoFromKey } from "./dateUtils.js";
import { getTurnoComponentes, turnoDesdeComponentes } from "./rulesEngine.js";
import { TURNO } from "./constants.js";
import { asRecordList, getReplacements } from "./storage.js";
import { motiveToSave } from "./motives.js";

const STORAGE_KEY = "preassignments";

export function getPreassignments() {
    return asRecordList(getJSON(STORAGE_KEY, []));
}

export function savePreassignments(list) {
    setJSON(STORAGE_KEY, Array.isArray(list) ? list : []);
}

// Crea (o reemplaza) la preasignacion de la cobertura de un ausente en un dia.
// La forma del registro coincide con lo que espera saveReplacement, para poder
// convertirla 1:1 al confirmar.
export function addPreassignment(data = {}) {
    const date = data.date || (data.keyDay ? isoFromKey(data.keyDay) : "");
    const record = {
        id: data.id ||
            `pre_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        worker: data.worker || "",
        replaced: data.replaced || "",
        date,
        turno: Number(data.turno) || TURNO.LIBRE,
        // Motivo de horas extra de una reserva sin ausente. Vive AQUI y no como
        // respaldo (`manual_extra`) porque el respaldo es de un turno que
        // todavia no existe: se convierte en respaldo al confirmar. Puede
        // quedar vacio y definirse despues.
        // Con la forma que ya existe si es un motivo escrito distinto.
        reason: data.replaced
            ? String(data.reason || "").trim()
            : motiveToSave(data.reason, getReplacements(), getPreassignments()),
        // Comentario de un cupo de la Brecha RRHH (ver saveReplacement); pasa
        // al respaldo al confirmar.
        comment: String(data.comment || "").trim(),
        // Horario personalizado de un apoyo con motivo (Calendario Mensual):
        // pasa al respaldo y al marcaje al confirmar.
        ...(data.coverFrom && data.coverUntil
            ? { coverFrom: String(data.coverFrom), coverUntil: String(data.coverUntil) }
            : {}),
        absenceType: data.absenceType || "",
        overtimeHours: data.overtimeHours || null,
        diurnoLongCoverage: Boolean(data.diurnoLongCoverage),
        at: data.at || new Date().toISOString(),
        by: data.by || ""
    };
    // Una cobertura por ausente/dia: reemplaza cualquier preasignacion previa de
    // ese mismo turno del ausente.
    //
    // Sin ausente a quien cubrir -un turno preasignado desde el boton- no hay
    // cobertura que reemplazar, y filtrar por `replaced` vacio borraria la
    // preasignacion de OTRO trabajador del mismo dia. Ahi lo unico que no puede
    // repetirse es el mismo turno del mismo trabajador: dos turnos distintos si
    // conviven, y se suman (ver getPreassignmentTurnForWorker).
    const list = getPreassignments().filter(item => record.replaced
        ? !(item?.replaced === record.replaced && item?.date === date)
        : !(
            !item?.replaced &&
            item?.worker === record.worker &&
            item?.date === date &&
            (Number(item?.turno) || TURNO.LIBRE) === record.turno
        )
    );

    list.push(record);
    savePreassignments(list);

    return record;
}

/**
 * Anota -o corrige- el motivo de una reserva ya creada.
 *
 * Es la via de "definirlo despues": al preasignar se puede saltar el motivo, y
 * la casilla queda con su insignia para volver a el.
 */
export function setPreassignmentReason(id, reason) {
    if (!id) return false;

    const list = getPreassignments();
    const item = list.find(record => String(record?.id) === String(id));

    if (!item) return false;

    item.reason = item.replaced
        ? String(reason || "").trim()
        : motiveToSave(reason, getReplacements(), list);
    savePreassignments(list);

    return true;
}

export function removePreassignment(id) {
    if (!id) return;

    savePreassignments(
        getPreassignments().filter(item => String(item?.id) !== String(id))
    );
}

// Preasignacion que cubre el turno de un AUSENTE en un dia (para el badge y el
// modal del ausente).
export function getPreassignmentForCoveredShift(replaced, keyDay) {
    const iso = isoFromKey(keyDay);

    return getPreassignments().find(item =>
        item?.replaced === replaced && item?.date === iso
    ) || null;
}

// Preasignacion que un REEMPLAZANTE tiene ese dia (para pintar el turno tentativo
// en su calendario y para las reglas de compatibilidad).
export function getPreassignmentForWorker(worker, keyDay) {
    const iso = isoFromKey(keyDay);

    return getPreassignments().find(item =>
        item?.worker === worker && item?.date === iso
    ) || null;
}

export function hasPreassignment(worker, keyDay) {
    return Boolean(getPreassignmentForWorker(worker, keyDay));
}

// Turno tentativo que el reemplazante tomaria ese dia (fusion de sus
// preasignaciones). Display-only: no altera getTurnoReal ni las horas.
export function getPreassignmentTurnForWorker(worker, keyDay) {
    const iso = isoFromKey(keyDay);

    return getPreassignments()
        .filter(item => item?.worker === worker && item?.date === iso)
        .reduce(
            (turno, item) => turnoDesdeComponentes([
                ...getTurnoComponentes(turno),
                ...getTurnoComponentes(Number(item?.turno) || TURNO.LIBRE)
            ]),
            TURNO.LIBRE
        );
}
