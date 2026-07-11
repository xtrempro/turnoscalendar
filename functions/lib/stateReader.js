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

module.exports = {
  parseStoredJSON,
  entryDocId,
  decodeItemKey,
  applyEntry,
  readModuleBase,
  applyExactEntries,
  storageValue
};
