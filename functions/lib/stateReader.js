"use strict";

// Lector del estado sincronizado del workspace. El cliente espeja cada clave de
// localStorage a workspaces/{wsId}/stateModules/{moduleId}/{chunks|entries}
// (ver js/firebaseAppState.js y js/firebaseStateModules.js). Aquí reconstruimos
// esos mapas en memoria para computar en el servidor exactamente lo mismo que el
// cliente calcularía desde localStorage.
//
// - readModuleBase: base compacta del módulo (colección "chunks", un JSON partido).
// - applyExactEntries: deltas por clave (colección "entries"), que pisan la base.

const { cleanText } = require("./text");

// Claves que pueden vivir en varios documentos (un documento por mes).
const SHARDED_STORAGE_KEYS = new Set(["replacements"]);

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

// Espejo de applyListStateEntry (js/firebasePartialState.js). Las listas
// compartidas -reemplazos, cambios de turno, preasignaciones- se sincronizan
// elemento por elemento para que dos supervisores no se pisen; el servidor tiene
// que reconstruirlas igual que el navegador o leeria una lista incompleta.
// Cualquier cambio alla va aqui.
function parseStoredArray(value) {
  if (Array.isArray(value)) return value;

  const parsed = parseStoredJSON(value, []);

  return Array.isArray(parsed) ? parsed : [];
}

function listItemId(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";

  return String(item.id ?? "").trim();
}

function applyListEntry(state, storageKey, entry) {
  const list = parseStoredArray(state[storageKey]);
  const deletedItems = entry.deletedItems || {};
  const itemKeys = new Set([
    ...Object.keys(entry.items || {}),
    ...Object.keys(deletedItems)
  ]);

  itemKeys.forEach((encodedKey) => {
    const itemKey = decodeItemKey(encodedKey);
    const index = list.findIndex((item) => listItemId(item) === itemKey);

    if (deletedItems[encodedKey] === true) {
      if (index >= 0) list.splice(index, 1);
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(entry.items || {}, encodedKey)) {
      return;
    }

    const parsed = parseStoredJSON(entry.items[encodedKey], null);

    if (!parsed || typeof parsed !== "object") return;

    if (index >= 0) {
      list[index] = parsed;
    } else {
      list.push(parsed);
    }
  });

  state[storageKey] = JSON.stringify(list);

  return state;
}

function applyEntry(state, entry = {}) {
  const storageKey = cleanText(entry.storageKey, 260);
  if (!storageKey) return state;

  // Una clave que antes viajaba entera deja su `value` viejo en el documento
  // (merge no borra campos). Es una foto anterior a los items, asi que se
  // aplica primero y los items la parchean encima.
  if (
    entry.items &&
    typeof entry.items === "object" &&
    Object.prototype.hasOwnProperty.call(entry, "value")
  ) {
    if (entry.deleted === true) {
      delete state[storageKey];
    } else {
      state[storageKey] = entry.value;
    }
  }

  if (entry.container === "array" && entry.items) {
    return applyListEntry(state, storageKey, entry);
  }

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
  const shardedQueries = [];

  Object.entries(keysByModule).forEach(([moduleId, keys]) => {
    [...new Set(keys || [])].forEach(storageKey => {
      // Los reemplazos pueden estar repartidos por mes (`replacements__AAAA-MM`,
      // js/replacementShards.js): todos llevan el mismo storageKey, asi que se
      // piden por ese campo y no por un solo id de documento.
      if (SHARDED_STORAGE_KEYS.has(storageKey)) {
        shardedQueries.push(db
          .collection("workspaces")
          .doc(workspaceId)
          .collection("stateModules")
          .doc(moduleId)
          .collection("entries")
          .where("storageKey", "==", storageKey)
          .get());
        return;
      }
      refs.push(db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("stateModules")
        .doc(moduleId)
        .collection("entries")
        .doc(entryDocId(storageKey)));
    });
  });

  // Por id de documento: el antiguo `replacements` primero y despues los meses,
  // igual que en loadWorkspaceState (la coleccion completa viene ordenada asi).
  for (const snap of await Promise.all(shardedQueries)) {
    [...snap.docs]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .forEach(docSnap => applyEntry(state, docSnap.data() || {}));
  }

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

module.exports = {
  parseStoredJSON,
  entryDocId,
  decodeItemKey,
  applyEntry,
  readModuleBase,
  applyExactEntries,
  storageValue
};
