"use strict";

// Búsqueda de reemplazos compatibles en unidades enlazadas. El cómputo de turnos
// y la lectura del estado del workspace ahora viven en functions/lib/* (reusados
// también por la proyección del worker-app).

const { cleanText, normalizeText } = require("./lib/text");
const {
  applyEntry,
  readModuleBase,
  applyExactEntries,
  storageValue
} = require("./lib/stateReader");
const {
  TURN,
  TURN_BY_CODE,
  profilesAreCompatible,
  mergeTurns,
  actualTurn,
  hasAbsence,
  cededSwapBlocks,
  canCover
} = require("./lib/turnEngine");

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
