"use strict";

// Busca AUSENCIAS en las unidades enlazadas.
//
// Sirven para respaldar el contrato de un trabajador a reemplazo: la ausencia
// de alguien es lo que justifica contratar a quien lo cubre. Hasta ahora solo
// se podian usar las ausencias de la propia unidad.
//
// DEVUELVE LOS DIAS CRUDOS, SIN AGRUPAR EN RANGOS, A PROPOSITO. El cliente los
// agrupa con js/replacementLeaveGrouping.js, el MISMO modulo que ya usa para
// las ausencias propias. Agrupar aqui obligaria a replicar la continuidad
// habil, que depende de los feriados del año, y dos implementaciones del mismo
// criterio derivan en silencio: la misma ausencia daria otro rango, otro id, y
// el control de "esta ausencia ya esta ocupada" dejaria de calzar sin que nadie
// lo note. Agrupando en el cliente, los ids salen identicos por construccion.
//
// Tampoco filtra las ya ocupadas: eso tambien se decide con los ids, o sea
// despues de agrupar.

const {
  readModuleBase,
  applyExactEntries,
  storageValue
} = require("./lib/stateReader");
const { listAcceptedLinks } = require("./linkedReplacementSearch");

// Los mismos tipos que ofrece el editor de contrato (ver
// REPLACEMENT_CONTRACT_LEAVE_TYPES en js/main.js). `legal` y `comp` viven en
// sus propios mapas; el resto son ausencias con tipo.
const LEAVE_MAP_TYPES = ["legal", "comp"];
const ABSENCE_TYPES = ["license", "professional_license", "unpaid_leave"];

function cleanText(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

/** El tipo de una ausencia, que puede venir como objeto o como texto. */
function absenceTypeOf(value) {
  if (!value) return "";

  if (typeof value === "object") return cleanText(value.type, 60);

  return cleanText(value, 60);
}

/**
 * Una clave de calendario ("2026-8-1", mes 0) a fecha comparable.
 *
 * Es el MISMO formato que usa el navegador. Ojo: el mes va en base 0, asi que
 * no se puede comparar como texto con una fecha ISO.
 */
function dateFromCalendarKey(key) {
  const [year, month, day] = String(key || "").split("-").map(Number);

  if (!year || !Number.isInteger(month) || !day) return null;

  const date = new Date(year, month, day);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** Descarta lo anterior al corte que fija el cliente. */
function keyOnOrAfter(key, fromDate) {
  if (!fromDate) return true;

  const date = dateFromCalendarKey(key);

  return Boolean(date) && date >= fromDate;
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value, 10));

  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Carga lo justo de una unidad: sus perfiles y, de cada uno, sus tres mapas de
 * ausencias.
 *
 * Se apoya en lib/stateReader, que es quien sabe que una entrada tiene tres
 * caras (`value`, `items`, `deletedItems`) y que manda `items`. Leer Firestore
 * de frente aqui daria datos viejos.
 */
async function loadAbsenceState(db, workspaceId) {
  const [profileState, turnState] = await Promise.all([
    readModuleBase(db, workspaceId, "profile"),
    readModuleBase(db, workspaceId, "turnos")
  ]);
  const state = { ...profileState, ...turnState };

  await applyExactEntries(db, workspaceId, state, {
    profile: ["profiles"]
  });

  const profiles = storageValue(state, "profiles", [])
    .filter(profile => profile && profile.active !== false && profile.name);
  const turnKeys = [];

  profiles.forEach(profile => {
    turnKeys.push(
      `legal_${profile.name}`,
      `comp_${profile.name}`,
      `absences_${profile.name}`
    );
  });

  await applyExactEntries(db, workspaceId, state, { turnos: turnKeys });

  return { state, profiles };
}

/** Los dias de ausencia de un trabajador, por tipo. */
function leaveKeysForProfile(state, profileName, fromDate) {
  const byType = {};

  LEAVE_MAP_TYPES.forEach(type => {
    const map = storageValue(state, `${type}_${profileName}`, {});
    const keys = Object.keys(map || {})
      .filter(key => map[key])
      .filter(key => keyOnOrAfter(key, fromDate));

    if (keys.length) byType[type] = keys;
  });

  const absences = storageValue(state, `absences_${profileName}`, {});

  ABSENCE_TYPES.forEach(type => {
    const keys = Object.keys(absences || {})
      .filter(key => absenceTypeOf(absences[key]) === type)
      .filter(key => keyOnOrAfter(key, fromDate));

    if (keys.length) byType[type] = keys;
  });

  return byType;
}

/** Las ausencias de UNA unidad enlazada. */
async function searchWorkspaceAbsences({ db, workspace, fromISO }) {
  const { state, profiles } = await loadAbsenceState(db, workspace.id);
  const fromDate = parseISODate(fromISO);
  const workers = [];

  profiles.forEach(profile => {
    const leaveKeys = leaveKeysForProfile(state, profile.name, fromDate);

    if (!Object.keys(leaveKeys).length) return;

    workers.push({
      name: cleanText(profile.name),
      estamento: cleanText(profile.estamento, 100),
      profession: cleanText(profile.profession),
      leaveKeys
    });
  });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name || workspace.id,
    linkId: workspace.linkId,
    workers
  };
}

/**
 * Las ausencias de TODAS las unidades enlazadas aceptadas.
 *
 * Una unidad que falle no hunde al resto: se informa aparte, igual que en la
 * busqueda de reemplazos.
 */
async function findLinkedUnitAbsences({
  db,
  requesterWorkspaceId,
  fromISO,
  sourceWorkspaceId = ""
}) {
  let workspaces = await listAcceptedLinks(db, requesterWorkspaceId);

  if (sourceWorkspaceId) {
    workspaces = workspaces.filter(workspace =>
      workspace.id === sourceWorkspaceId
    );
  }

  const settled = await Promise.allSettled(workspaces.map(workspace =>
    searchWorkspaceAbsences({ db, workspace, fromISO })
  ));
  const units = [];
  const failedUnits = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      units.push(result.value);
    } else {
      failedUnits.push(
        workspaces[index]?.name ||
        workspaces[index]?.id ||
        "Unidad enlazada"
      );
    }
  });

  return { units, failedUnits };
}

module.exports = {
  absenceTypeOf,
  dateFromCalendarKey,
  findLinkedUnitAbsences,
  keyOnOrAfter,
  leaveKeysForProfile,
  loadAbsenceState,
  searchWorkspaceAbsences
};
