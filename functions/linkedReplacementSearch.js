"use strict";

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

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeText(value) {
  return cleanText(value, 240)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseStoredJSON(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function entryDocId(storageKey) {
  return encodeURIComponent(String(storageKey || ""));
}

function decodeItemKey(itemKey) {
  try {
    return decodeURIComponent(String(itemKey || ""));
  } catch {
    return String(itemKey || "");
  }
}

function applyEntry(state, entry = {}) {
  const storageKey = cleanText(entry.storageKey, 260);
  if (!storageKey) return state;

  if (entry.items && typeof entry.items === "object") {
    const current = parseStoredJSON(state[storageKey], {});
    const next = current && typeof current === "object" && !Array.isArray(current)
      ? { ...current }
      : {};
    const deletedItems = entry.deletedItems || {};
    const itemKeys = new Set([
      ...Object.keys(entry.items),
      ...Object.keys(deletedItems)
    ]);

    itemKeys.forEach(encodedKey => {
      const itemKey = decodeItemKey(encodedKey);

      if (deletedItems[encodedKey] === true) {
        delete next[itemKey];
        return;
      }

      if (Object.prototype.hasOwnProperty.call(entry.items, encodedKey)) {
        next[itemKey] = parseStoredJSON(
          entry.items[encodedKey],
          entry.items[encodedKey]
        );
      }
    });

    state[storageKey] = JSON.stringify(next);
    return state;
  }

  if (entry.deleted === true) {
    delete state[storageKey];
  } else {
    state[storageKey] = entry.value;
  }

  return state;
}

async function readModuleBase(db, workspaceId, moduleId) {
  const snap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("stateModules")
    .doc(moduleId)
    .collection("chunks")
    .get();
  const text = snap.docs
    .map(docSnap => ({
      id: docSnap.id,
      index: Number(docSnap.data()?.index) || 0,
      text: String(docSnap.data()?.text || "")
    }))
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
    .map(chunk => chunk.text)
    .join("");

  return parseStoredJSON(text, {});
}

async function applyExactEntries(
  db,
  workspaceId,
  state,
  keysByModule = {}
) {
  const refs = [];

  Object.entries(keysByModule).forEach(([moduleId, keys]) => {
    [...new Set(keys || [])].forEach(storageKey => {
      refs.push(db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("stateModules")
        .doc(moduleId)
        .collection("entries")
        .doc(entryDocId(storageKey)));
    });
  });

  if (!refs.length) return state;

  for (let index = 0; index < refs.length; index += 200) {
    const docs = await db.getAll(...refs.slice(index, index + 200));
    docs.forEach(docSnap => {
      if (docSnap.exists) applyEntry(state, docSnap.data() || {});
    });
  }
  return state;
}

function storageValue(state, key, fallback) {
  return parseStoredJSON(state[key], fallback);
}

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
  const start = new Date(`${cleanText(rotation.start, 10)}T12:00:00Z`);
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

async function loadSearchState(db, workspaceId, targetProfile) {
  const [profileState, turnState, swapState] = await Promise.all([
    readModuleBase(db, workspaceId, "profile"),
    readModuleBase(db, workspaceId, "turnos"),
    readModuleBase(db, workspaceId, "swap")
  ]);
  const state = { ...profileState, ...turnState, ...swapState };

  await applyExactEntries(db, workspaceId, state, {
    profile: ["profiles"],
    turnos: ["replacements"],
    swap: ["swaps", "turnChangeConfig"]
  });

  const profiles = storageValue(state, "profiles", [])
    .filter(profile => profile && profile.active !== false && profile.name);
  // Los deltas por trabajador se leen solo para perfiles que realmente pueden
  // cubrir al solicitante. Así una búsqueda de Enfermería no abre calendarios
  // de administrativos, auxiliares u otras profesiones.
  const compatibleProfiles = profiles.filter(profile =>
    profilesAreCompatible(profile, targetProfile)
  );
  const profileKeys = [];
  const turnKeys = [];

  compatibleProfiles.forEach(profile => {
    const name = profile.name;
    profileKeys.push(`rotativa_${name}`, `baseData_${name}`);
    turnKeys.push(
      `data_${name}`,
      `admin_${name}`,
      `legal_${name}`,
      `comp_${name}`,
      `absences_${name}`
    );
  });

  await applyExactEntries(db, workspaceId, state, {
    profile: profileKeys,
    turnos: turnKeys
  });

  return { state, profiles, compatibleProfiles };
}

async function loadDateOperationalState(db, workspaceId, dateISO) {
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const [blockedSnap, loanSnap] = await Promise.all([
    workspaceRef.collection("workerBlockedDays").where("date", "==", dateISO).get(),
    workspaceRef.collection("loanAssignments").where("date", "==", dateISO).get()
  ]);
  const blockedNames = new Set();
  const loanTurns = new Map();

  blockedSnap.docs.forEach(docSnap => {
    const item = docSnap.data() || {};
    if (item.status !== "canceled" && item.profileName) {
      blockedNames.add(normalizeText(item.profileName));
    }
  });
  loanSnap.docs.forEach(docSnap => {
    const item = docSnap.data() || {};
    if (item.status !== "active" || !item.workerName) return;
    loanTurns.set(
      item.workerName,
      mergeTurns(
        loanTurns.get(item.workerName) || TURN.FREE,
        TURN_BY_CODE[item.turnCode] || TURN.FREE
      )
    );
  });

  return { blockedNames, loanTurns };
}

async function searchWorkspaceCandidates({
  db,
  workspace,
  targetProfile,
  dateISO,
  turnCode
}) {
  const neededTurn = TURN_BY_CODE[turnCode] || TURN.FREE;
  const [{ state, profiles, compatibleProfiles }, operational] = await Promise.all([
    loadSearchState(db, workspace.id, targetProfile),
    loadDateOperationalState(db, workspace.id, dateISO)
  ]);
  const config = storageValue(state, "turnChangeConfig", {});
  const candidates = compatibleProfiles.flatMap(profile => {
    const currentTurn = actualTurn(
      state,
      profile.name,
      dateISO,
      operational.loanTurns
    );
    const absent = hasAbsence(state, profile.name, dateISO);
    const ceded = cededSwapBlocks(
      state,
      profile.name,
      dateISO,
      neededTurn
    );
    const available = !absent && !ceded && canCover(
      currentTurn,
      neededTurn,
      config.allowTwentyFourHourShifts
    );

    if (!available) return [];

    return [{
      workerId: cleanText(profile.id, 120),
      name: cleanText(profile.name),
      estamento: cleanText(profile.estamento, 100),
      profession: cleanText(profile.profession),
      role: cleanText(profile.role || profile.position || profile.cargo || profile.profession),
      workspaceId: workspace.id,
      workspaceName: workspace.name || workspace.id,
      linkId: workspace.linkId,
      availability: {
        date: dateISO,
        available: true,
        currentTurn,
        blocked: operational.blockedNames.has(normalizeText(profile.name))
      }
    }];
  });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name || workspace.id,
    totalProfiles: profiles.length,
    compatibleProfiles: compatibleProfiles.length,
    candidates
  };
}

async function listAcceptedLinks(db, requesterWorkspaceId) {
  const links = db.collection("workspaceLinks");
  const [fromSnap, toSnap] = await Promise.all([
    links.where("fromWorkspaceId", "==", requesterWorkspaceId).get(),
    links.where("toWorkspaceId", "==", requesterWorkspaceId).get()
  ]);
  const unique = new Map();

  [...fromSnap.docs, ...toSnap.docs].forEach(docSnap => {
    const link = docSnap.data() || {};
    if (link.status !== "accepted") return;
    const requesterIsFrom = link.fromWorkspaceId === requesterWorkspaceId;
    const id = requesterIsFrom ? link.toWorkspaceId : link.fromWorkspaceId;
    if (!id || id === requesterWorkspaceId) return;

    unique.set(docSnap.id, {
      id,
      name: cleanText(
        requesterIsFrom ? link.toWorkspaceName : link.fromWorkspaceName
      ) || id,
      linkId: docSnap.id
    });
  });

  return [...unique.values()];
}

async function findCompatibleReplacementCandidates({
  db,
  requesterWorkspaceId,
  targetProfile,
  dateISO,
  turnCode,
  sourceWorkspaceId = "",
  linkId = ""
}) {
  let workspaces = await listAcceptedLinks(db, requesterWorkspaceId);

  if (sourceWorkspaceId) {
    workspaces = workspaces.filter(workspace =>
      workspace.id === sourceWorkspaceId && (!linkId || workspace.linkId === linkId)
    );
  }

  const settled = await Promise.allSettled(workspaces.map(workspace =>
    searchWorkspaceCandidates({
      db,
      workspace,
      targetProfile,
      dateISO,
      turnCode
    })
  ));
  const units = [];
  const failedUnits = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      units.push(result.value);
    } else {
      failedUnits.push(workspaces[index]?.name || workspaces[index]?.id || "Unidad enlazada");
    }
  });

  return {
    units,
    failedUnits,
    candidates: units.flatMap(unit => unit.candidates)
  };
}

module.exports = {
  TURN,
  actualTurn,
  applyEntry,
  canCover,
  findCompatibleReplacementCandidates,
  profilesAreCompatible,
  searchWorkspaceCandidates
};
