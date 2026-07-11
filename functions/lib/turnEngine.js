"use strict";

// Motor de turnos server-side. Reproduce el cálculo del cliente
// (js/turnEngine.js: getTurnoBase / getTurnoProgramado / aplicarCambiosTurno)
// leyendo el estado reconstruido por stateReader. Los turnos se representan con
// los mismos códigos numéricos que el cliente (TURNO.*).

const { normalizeText } = require("./text");
const { storageValue } = require("./stateReader");

const TURN = Object.freeze({
  FREE: 0,
  LONG: 1,
  NIGHT: 2,
  TWENTY_FOUR: 3,
  DAY: 4,
  DAY_NIGHT: 5,
  HALF_MORNING: 6,
  HALF_AFTERNOON: 7,
  EIGHTEEN: 8
});

const TURN_BY_CODE = Object.freeze({
  L: TURN.LONG,
  N: TURN.NIGHT,
  "24": TURN.TWENTY_FOUR,
  D: TURN.DAY,
  "D+N": TURN.DAY_NIGHT,
  HM: TURN.HALF_MORNING,
  HT: TURN.HALF_AFTERNOON,
  "18": TURN.EIGHTEEN
});

function coverageKey(profile = {}) {
  const estamento = normalizeText(profile.estamento);
  const profession = normalizeText(profile.profession);
  const usesProfession = estamento === "profesional" || estamento === "tecnico";

  if (!usesProfession) return `role:${estamento}`;
  if (!profession || profession === "sin informacion") {
    return `profession:${estamento}:sin informacion`;
  }

  return `profession:${profession}`;
}

function profilesAreCompatible(candidate, target) {
  return Boolean(candidate && target) && coverageKey(candidate) === coverageKey(target);
}

function keyFromISO(dateISO) {
  const [year, month, day] = String(dateISO || "").split("-").map(Number);
  return `${year}-${month - 1}-${day}`;
}

function rotationSequence(type, firstTurn) {
  const normalized = normalizeText(firstTurn);
  let sequence = [];
  let startIndex = 0;

  if (type === "3turno") {
    sequence = [TURN.LONG, TURN.LONG, TURN.NIGHT, TURN.NIGHT, TURN.FREE, TURN.FREE];
    startIndex = ({
      larga2: 1,
      "segunda larga": 1,
      noche: 2,
      noche2: 3,
      "segunda noche": 3,
      libre: 4,
      libre1: 4,
      libre2: 5
    })[normalized] || 0;
  } else if (type === "4turno") {
    sequence = [TURN.LONG, TURN.NIGHT, TURN.FREE, TURN.FREE];
    startIndex = ({ noche: 1, libre: 2, libre1: 2, libre2: 3 })[normalized] || 0;
  }

  return sequence.length
    ? [...sequence.slice(startIndex), ...sequence.slice(0, startIndex)]
    : [];
}

function calendarDayDifference(start, current) {
  return Math.floor((Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate()
  ) - Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  )) / 86400000);
}

function rotationTurn(rotation = {}, dateISO) {
  const type = normalizeText(rotation.type).replace(/\s+/g, "");
  if (!type || type === "libre" || type === "reemplazo") return TURN.FREE;

  const current = new Date(`${dateISO}T12:00:00Z`);
  const start = new Date(`${String(rotation.start || "").trim().slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(start.getTime()) || current < start) {
    return TURN.FREE;
  }

  if (type === "diurno") {
    const weekday = current.getUTCDay();
    return weekday > 0 && weekday < 6 ? TURN.DAY : TURN.FREE;
  }

  const sequence = rotationSequence(type, rotation.firstTurn);
  if (!sequence.length) return TURN.FREE;
  const offset = calendarDayDifference(start, current);
  return sequence[((offset % sequence.length) + sequence.length) % sequence.length] || TURN.FREE;
}

function components(turn) {
  const value = Number(turn) || TURN.FREE;
  if (value === TURN.LONG) return ["L"];
  if (value === TURN.NIGHT) return ["N"];
  if (value === TURN.DAY) return ["D"];
  if (value === TURN.TWENTY_FOUR) return ["L", "N"];
  if (value === TURN.DAY_NIGHT) return ["D", "N"];
  if (value === TURN.HALF_MORNING) return ["HM"];
  if (value === TURN.HALF_AFTERNOON) return ["HT"];
  if (value === TURN.EIGHTEEN) return ["HT", "N"];
  return [];
}

function turnFromComponents(values) {
  const set = new Set(values || []);
  if (set.has("D") && set.has("N")) return TURN.DAY_NIGHT;
  if (set.has("L") && set.has("N")) return TURN.TWENTY_FOUR;
  if (set.has("HM") && set.has("HT") && set.has("N")) return TURN.TWENTY_FOUR;
  if (set.has("HT") && set.has("N")) return TURN.EIGHTEEN;
  if (set.has("HM") && set.has("HT")) return TURN.LONG;
  if (set.has("D")) return TURN.DAY;
  if (set.has("L")) return TURN.LONG;
  if (set.has("N")) return TURN.NIGHT;
  if (set.has("HM")) return TURN.HALF_MORNING;
  if (set.has("HT")) return TURN.HALF_AFTERNOON;
  return TURN.FREE;
}

function mergeTurns(current, incoming) {
  return turnFromComponents([...components(current), ...components(incoming)]);
}

function swapCanceled(swap = {}) {
  return Boolean(
    swap.canceled ||
    swap.anulado ||
    swap.status === "canceled" ||
    swap.status === "anulado"
  );
}

function swapTurn(code) {
  if (code === "N") return TURN.NIGHT;
  if (code === "D") return TURN.DAY;
  return TURN.LONG;
}

function replacementTurn(state, profileName, dateISO) {
  return storageValue(state, "replacements", [])
    .filter(item =>
      item &&
      !item.canceled &&
      item.addsShift !== false &&
      item.worker === profileName &&
      item.date === dateISO
    )
    .reduce((turn, item) => mergeTurns(turn, TURN_BY_CODE[item.turno] || 0), 0);
}

function applySwaps(
  state,
  profileName,
  dateISO,
  baseTurn,
  initialReplacementTurn = TURN.FREE
) {
  return storageValue(state, "swaps", []).reduce((result, swap) => {
    if (!swap || swapCanceled(swap)) return result;
    let next = result.turn;
    let extra = result.replacementTurn;
    const consumeDiurnoExtra = delivered => {
      const deliveredParts = components(delivered);
      const extraParts = components(extra);
      const covered = deliveredParts.length > 0 && deliveredParts.every(part =>
        extraParts.includes(part)
      );

      if (next !== TURN.DAY || !covered) return false;
      extra = turnFromComponents(
        extraParts.filter(part => !deliveredParts.includes(part))
      );
      return true;
    };

    if (!swap.skipFecha && swap.fecha === dateISO) {
      if (
        swap.from === profileName &&
        !consumeDiurnoExtra(swapTurn(swap.turno))
      ) {
        next = TURN.FREE;
      }
      if (swap.to === profileName) next = mergeTurns(next, swapTurn(swap.turno));
    }

    if (!swap.skipDevolucion && swap.devolucion === dateISO) {
      const returned = swapTurn(swap.turnoDevuelto);
      if (swap.to === profileName) {
        if (!consumeDiurnoExtra(returned)) {
          const remaining = components(next)
            .filter(item => !components(returned).includes(item));
          next = turnFromComponents(remaining);
        }
      }
      if (swap.from === profileName) next = mergeTurns(next, returned);
    }

    return { turn: next, replacementTurn: extra };
  }, {
    turn: baseTurn,
    replacementTurn: initialReplacementTurn
  });
}

function cededSwapBlocks(state, profileName, dateISO, neededTurn) {
  const needed = components(neededTurn);
  return storageValue(state, "swaps", []).some(swap => {
    if (!swap || swapCanceled(swap)) return false;
    let ceded = 0;

    if (!swap.skipFecha && swap.fecha === dateISO && swap.from === profileName) {
      ceded = swapTurn(swap.turno);
    } else if (
      !swap.skipDevolucion &&
      swap.devolucion === dateISO &&
      swap.to === profileName
    ) {
      ceded = swapTurn(swap.turnoDevuelto);
    }

    const cededParts = components(ceded);
    return (
      cededParts.some(item => ["L", "D", "HM", "HT"].includes(item)) &&
      needed.some(item => ["L", "D", "HM", "HT"].includes(item))
    ) || (cededParts.includes("N") && needed.includes("N"));
  });
}

function scheduledTurn(state, profileName, dateISO) {
  const keyDay = keyFromISO(dateISO);
  const data = storageValue(state, `data_${profileName}`, {});
  if (Object.prototype.hasOwnProperty.call(data, keyDay)) {
    return Number(data[keyDay]) || TURN.FREE;
  }

  const baseData = storageValue(state, `baseData_${profileName}`, {});
  if (Object.prototype.hasOwnProperty.call(baseData, keyDay)) {
    return Number(baseData[keyDay]) || TURN.FREE;
  }

  return rotationTurn(
    storageValue(state, `rotativa_${profileName}`, {}),
    dateISO
  );
}

function actualTurn(state, profileName, dateISO, loanTurns = new Map()) {
  let turn = scheduledTurn(state, profileName, dateISO);
  const swapped = applySwaps(
    state,
    profileName,
    dateISO,
    turn,
    replacementTurn(state, profileName, dateISO)
  );
  turn = mergeTurns(swapped.turn, swapped.replacementTurn);
  turn = mergeTurns(turn, loanTurns.get(profileName) || TURN.FREE);
  return turn;
}

function hasAbsence(state, profileName, dateISO) {
  const keyDay = keyFromISO(dateISO);
  return ["admin_", "legal_", "comp_", "absences_"]
    .some(prefix => Boolean(storageValue(state, `${prefix}${profileName}`, {})[keyDay]));
}

function canCover(currentTurn, neededTurn, allowTwentyFourHourShifts) {
  if (!neededTurn) return false;
  if (!currentTurn) return true;
  return allowTwentyFourHourShifts !== false && (
    (currentTurn === TURN.LONG && neededTurn === TURN.NIGHT) ||
    (currentTurn === TURN.NIGHT && neededTurn === TURN.LONG)
  );
}

module.exports = {
  TURN,
  TURN_BY_CODE,
  coverageKey,
  profilesAreCompatible,
  keyFromISO,
  rotationSequence,
  calendarDayDifference,
  rotationTurn,
  components,
  turnFromComponents,
  mergeTurns,
  swapCanceled,
  swapTurn,
  replacementTurn,
  applySwaps,
  cededSwapBlocks,
  scheduledTurn,
  actualTurn,
  hasAbsence,
  canCover
};
