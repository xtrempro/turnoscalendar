"use strict";

// Corre el motor de proyección REAL del cliente (bundle functions/engine/
// engine.mjs) dentro de la Cloud Function. Reconstruye el estado del workspace
// desde stateModules, lo expone vía un shim de localStorage/window/document, y
// llama buildFullProjection por trabajador. Así el servidor produce EXACTAMENTE
// la misma proyección que producía el navegador, sin reescribir el motor.

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { readModuleBase, applyEntry } = require("./stateReader");

const ENGINE_PATH = path.join(__dirname, "..", "engine", "engine.mjs");

// Módulos de estado necesarios para el cómputo de turnos + horas + saldos +
// recordatorios (ver js/firebaseStateModules.js).
const STATE_MODULES = ["profile", "turnos", "swap", "clockmarks", "hours", "weekly"];

// ───────── Shim de globales del navegador (una sola vez por proceso) ─────────

let globalsReady = false;

function ensureEngineGlobals() {
    if (globalsReady) return;

    const noopEl = {
        addEventListener() {}, removeEventListener() {}, appendChild() {},
        setAttribute() {}, style: {}, classList: { add() {}, remove() {} },
        click() {}, remove() {}
    };

    globalThis.window = globalThis.window || {
        dispatchEvent: () => true,
        addEventListener() {},
        removeEventListener() {}
    };
    globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent {
        constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    };
    globalThis.document = globalThis.document || {
        addEventListener() {}, removeEventListener() {},
        visibilityState: "hidden", hidden: true,
        body: noopEl, documentElement: noopEl,
        createElement: () => ({ ...noopEl }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
    globalThis.window.document = globalThis.document;

    globalsReady = true;
}

function makeMemoryStorage(seed = {}) {
    const map = new Map();

    Object.entries(seed).forEach(([key, value]) => {
        map.set(key, typeof value === "string" ? value : JSON.stringify(value));
    });

    return {
        get length() { return map.size; },
        clear() { map.clear(); },
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        key(index) { return [...map.keys()][index] ?? null; },
        removeItem(key) { map.delete(key); },
        setItem(key, value) { map.set(key, String(value)); }
    };
}

// ───────── Reconstrucción del estado del workspace ─────────

async function readModuleState(db, workspaceId, moduleId) {
    const state = {};
    const base = await readModuleBase(db, workspaceId, moduleId);

    if (base && typeof base === "object") {
        Object.assign(state, base);
    }

    const entriesSnap = await db
        .collection("workspaces")
        .doc(workspaceId)
        .collection("stateModules")
        .doc(moduleId)
        .collection("entries")
        .get();

    entriesSnap.docs.forEach(docSnap => applyEntry(state, docSnap.data() || {}));

    return state;
}

async function loadWorkspaceState(db, workspaceId) {
    const modules = await Promise.all(
        STATE_MODULES.map(moduleId => readModuleState(db, workspaceId, moduleId))
    );

    return Object.assign({}, ...modules);
}

// ───────── Siembra de feriados (getCachedHolidays es síncrono) ─────────

async function fetchOfficialHolidays(year) {
    try {
        const response = await fetch(
            `https://date.nager.at/api/v3/PublicHolidays/${year}/CL`
        );
        const data = await response.json();
        const official = {};

        (Array.isArray(data) ? data : []).forEach(item => {
            const [y, m, d] = String(item.date || "").split("-").map(Number);

            if (y && m && d) {
                official[`${y}-${m - 1}-${d}`] = item.localName || true;
            }
        });

        return official;
    } catch {
        return {};
    }
}

async function seedHolidays(state, years) {
    await Promise.all([...new Set(years)].map(async year => {
        const key = `holidaysCache_${year}`;

        if (state[key]) return;

        const official = await fetchOfficialHolidays(year);

        if (Object.keys(official).length) {
            state[key] = JSON.stringify(official);
        }
    }));
}

function relevantHolidayYears(today = new Date()) {
    const year = today.getFullYear();
    return [year - 1, year, year + 1, year + 2];
}

// ───────── Carga del motor (una sola vez por proceso; NO cache-bust para no
// filtrar módulos en el registro ESM). El aislamiento entre invocaciones se
// logra reseteando la única cache mutable del motor: los feriados. ─────────

let enginePromise = null;

function loadEngine() {
    if (!enginePromise) {
        enginePromise = import(pathToFileURL(ENGINE_PATH).href);
    }
    return enginePromise;
}

// ───────── API pública ─────────

// Computa la proyección de una lista de trabajadores de un workspace. Devuelve
// un array de { profileName, link, payload }. `linksByProfile` mapea nombre de
// perfil -> objeto link (uid, workspaceName...). `workspace` = { id, name }.
async function computeProjectionsForProfiles(db, {
    workspace,
    profileNames = [],
    linksByProfile = new Map(),
    today = new Date()
}) {
    ensureEngineGlobals();

    const state = await loadWorkspaceState(db, workspace.id);
    await seedHolidays(state, relevantHolidayYears(today));

    globalThis.localStorage = makeMemoryStorage(state);

    const engine = await loadEngine();

    // Resetea la cache de feriados de módulo para no arrastrar feriados manuales
    // de un workspace anterior si la instancia está caliente.
    if (typeof engine.clearHolidaysCache === "function") {
        engine.clearHolidaysCache();
    }

    const results = [];

    for (const profileName of profileNames) {
        const link = linksByProfile.get(profileName) || {};
        const payload = await engine.buildFullProjection(
            profileName,
            { link, workspace },
            today
        );

        results.push({ profileName, link, payload });
    }

    return results;
}

module.exports = {
    computeProjectionsForProfiles,
    loadWorkspaceState,
    makeMemoryStorage,
    ensureEngineGlobals,
    seedHolidays,
    relevantHolidayYears,
    loadEngine
};
