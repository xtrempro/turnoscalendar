import { getJSON, setJSON } from "./persistence.js";

/* ======================================================
   Turnos de la rotativa base quitados con el boton QUITAR TURNO

   `baseShiftRemovals_<nombre>` = { keyDay: { turn, removedAt, removedBy } }

   El calendario deja el dia libre (data_), pero eso solo no basta: en los
   modos "assigned" y "diurno" las horas extras se miden contra la rotativa
   base, y un dia base que no se trabaja simplemente no suma. Esta anotacion
   le dice al motor de horas (js/hoursEngine.js) que ese turno se QUITO a
   proposito y que sus horas se descuentan de las extras del mes.

   El motor descuenta solo lo que del turno base no se trabajo ese dia: si el
   supervisor vuelve a poner el turno, el descuento desaparece solo.
====================================================== */

function storageKey(profileName) {
    return `baseShiftRemovals_${profileName}`;
}

export function getBaseShiftRemovals(profileName) {
    if (!profileName) return {};

    const removals = getJSON(storageKey(profileName), {});

    return removals && typeof removals === "object" ? removals : {};
}

export function getBaseShiftRemoval(profileName, keyDay) {
    return getBaseShiftRemovals(profileName)[keyDay] || null;
}

export function getEditableBaseShift(profileName, keyDay, baseShift) {
    if (getBaseShiftRemoval(profileName, keyDay)) return 0;

    return Number(baseShift) || 0;
}

export function recordBaseShiftRemoval(
    profileName,
    keyDay,
    turn,
    { removedBy = "" } = {}
) {
    if (!profileName || !keyDay || !Number(turn)) return null;

    const record = {
        turn: Number(turn),
        removedAt: new Date().toISOString(),
        removedBy: String(removedBy || "")
    };

    setJSON(storageKey(profileName), {
        ...getBaseShiftRemovals(profileName),
        [keyDay]: record
    });

    return record;
}

export function clearBaseShiftRemoval(profileName, keyDay) {
    const removals = getBaseShiftRemovals(profileName);

    if (!removals[keyDay]) return false;

    const next = { ...removals };

    delete next[keyDay];
    setJSON(storageKey(profileName), next);

    return true;
}
