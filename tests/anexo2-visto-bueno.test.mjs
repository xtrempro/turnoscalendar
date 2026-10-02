// Anexo 2 en la PWA y visto bueno de horas.
//
// - El Anexo 2 del trabajador (PWA) y el del supervisor salen del MISMO calculo
//   (coverageAuthorizationRows.js), con los motores reales.
// - La huella de horas cambia solo si cambian las horas, y con ella el estado
//   del visto bueno: validado / cambio despues de validar / pendiente.
// - El listado del menu Horas extras: solo no honorarios con horas extras.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: "hidden", hidden: true,
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.alert = () => {};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const rows = await import("../js/coverageAuthorizationRows.js");
const panel = await import("../js/hoursValidationPanel.js");
const { TURNO } = await import("../js/constants.js");

const YEAR = 2026;
const MONTH = 7;
const MONTH_DATE = new Date(YEAR, MONTH, 1);
const dayKey = (name, day) => [name, `${YEAR}-${MONTH}-${day}`];

const ANA = { id: "p-ana", name: "Ana Perez", rut: "11.111.111-1", estamento: "Profesional", active: true, contractType: "Titular" };
const BETO = { id: "p-beto", name: "Beto Soto", rut: "22.222.222-2", estamento: "Profesional", active: true, contractType: "Titular" };
const CARLA = { id: "p-carla", name: "Carla Rios", rut: "33.333.333-3", estamento: "Profesional", active: true, contractType: "Honorarios" };

function set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

// Ana y Carla con un turno extra (Larga sobre libre el 18); Beto sin extras.
function seed({ anaExtraDays = [18] } = {}) {
    localStorage.clear();
    set("profiles", [ANA, BETO, CARLA]);

    for (const profile of [ANA, BETO, CARLA]) {
        set(`shift_${profile.name}`, true);
        set(`rotativa_${profile.name}`, { type: "4turno", start: "", firstTurn: "larga" });
    }

    const base = (name, extras) => {
        const baseData = {};
        const data = {};

        baseData[dayKey(name, 17)[1]] = TURNO.LARGA;
        data[dayKey(name, 17)[1]] = TURNO.LARGA;
        extras.forEach(day => {
            baseData[dayKey(name, day)[1]] = TURNO.LIBRE;
            data[dayKey(name, day)[1]] = TURNO.LARGA;
        });
        set(`baseData_${name}`, baseData);
        set(`data_${name}`, data);
    };

    base(ANA.name, anaExtraDays);
    base(BETO.name, []);
    base(CARLA.name, [18]);
}

beforeEach(() => seed());

test("Anexo 2 de un trabajador: sus turnos extra con horas, y la huella de esas horas", async () => {
    const row = await rows.buildCoverageAuthorizationRow(ANA, MONTH_DATE, { workspaceName: "Imagenologia" });

    assert.equal(row.name, ANA.name);
    assert.equal(row.rut, ANA.rut);
    assert.equal(row.unit, "Imagenologia");
    assert.ok(row.days.some(day => day.iso === "2026-08-18" && day.dayHours > 0));
    assert.deepEqual(rows.coverageAuthorizationTotals(row), { day: 12, festive: 0 });
    assert.match(rows.coverageAuthorizationSignature(row), /^v1-[0-9a-f]{8}$/);
});

test("la huella cambia si cambian las horas, no si cambia un texto", async () => {
    const before = rows.coverageAuthorizationSignature(await rows.buildCoverageAuthorizationRow(ANA, MONTH_DATE));
    const sameHours = rows.coverageAuthorizationSignature({
        days: [{ iso: "2026-08-18", dayHours: 12, festiveHours: 0, motive: "otro texto" }]
    });

    assert.equal(before, sameHours, "solo cuentan dia y horas");

    seed({ anaExtraDays: [18, 19] });

    const after = rows.coverageAuthorizationSignature(await rows.buildCoverageAuthorizationRow(ANA, MONTH_DATE));

    assert.notEqual(after, before, "un turno extra mas cambia la huella");
});

test("PWA: el no honorario recibe el Anexo 2 con su huella; el honorario, su reporte de siempre", async () => {
    const ana = await rows.buildWorkerMonthlyReport(ANA, MONTH_DATE, { workspaceName: "Imagenologia" });

    assert.equal(ana.kind, "anexo2");
    assert.match(ana.html, /AUTORIZACION PARA CUBRIR TURNOS/);
    assert.match(ana.html, /Ana Perez/);
    assert.match(ana.html, /Imagenologia/);
    assert.deepEqual(
        { hasOvertime: ana.validation.hasOvertime, totalDay: ana.validation.totalDay },
        { hasOvertime: true, totalDay: 12 }
    );

    // Sin horas extras igual ve su hoja (vacia) y no tiene nada que validar.
    const beto = await rows.buildWorkerMonthlyReport(BETO, MONTH_DATE);

    assert.equal(beto.kind, "anexo2");
    assert.match(beto.html, /coverage-annex/);
    assert.equal(beto.validation.hasOvertime, false);

    const carla = await rows.buildWorkerMonthlyReport(CARLA, MONTH_DATE);

    assert.equal(carla.kind, "hours");
    assert.equal(carla.validation, null);
    assert.doesNotMatch(carla.html, /AUTORIZACION PARA CUBRIR TURNOS/);
});

test("estado del visto bueno: pendiente, validado y cambio despues de validar (manda la hora del SERVIDOR)", () => {
    assert.equal(rows.hoursValidationState([], "v1-a").status, "pending");
    assert.equal(rows.hoursValidationState([{ signature: "v1-a", validatedAtMillis: 10 }], "v1-a").status, "validated");
    assert.equal(rows.hoursValidationState([{ signature: "v1-a", validatedAtMillis: 10 }], "v1-b").status, "changed");
    // Dos enlaces del mismo perfil: manda el de fecha de servidor mas reciente,
    // nunca un texto de fecha del telefono.
    assert.equal(rows.hoursValidationState([
        { signature: "v1-a", validatedAtMillis: 10, validatedAt: "2099-01-01T00:00:00Z" },
        { signature: "v1-b", validatedAtMillis: 20 }
    ], "v1-b").status, "validated");
});

test("listado del menu Horas extras: solo no honorarios con horas extras, cruzado por el uid del enlace", async () => {
    const linkUidsForProfile = profile => (profile.name === "Ana Perez" ? ["uid-ana"] : []);
    const pending = await panel.buildHoursValidationRows(MONTH_DATE, { validations: [], linkUidsForProfile });

    assert.deepEqual(pending.map(row => [row.name, row.status]), [["Ana Perez", "pending"]], "Beto no tiene HHEE y Carla es honorario");
    assert.equal(panel.hoursValidationMonthKey(MONTH_DATE), "2026-08");

    const signature = pending[0].signature;
    // Lo que escribe approveMonthlyHours (nombre y uid tomados del enlace).
    const validation = { uid: "uid-ana", profileName: "Ana Perez", monthKey: "2026-08", signature, validatedAtMillis: Date.parse("2026-09-01T10:00:00Z") };
    const validated = await panel.buildHoursValidationRows(MONTH_DATE, { validations: [validation], linkUidsForProfile });

    assert.equal(validated[0].status, "validated");

    // Perfil renombrado: el uid del enlace lo sigue encontrando.
    const byUid = await panel.buildHoursValidationRows(MONTH_DATE, {
        validations: [{ ...validation, profileName: "Ana P. (nombre antiguo)" }],
        linkUidsForProfile
    });

    assert.equal(byUid[0].status, "validated");

    // El visto bueno de OTRO enlace no cuenta para Ana.
    const other = await panel.buildHoursValidationRows(MONTH_DATE, {
        validations: [{ ...validation, uid: "uid-beto", profileName: "Beto Soto" }],
        linkUidsForProfile
    });

    assert.equal(other[0].status, "pending");

    // Se agrega un turno extra despues del visto bueno: amarillo.
    seed({ anaExtraDays: [18, 19] });

    const changed = await panel.buildHoursValidationRows(MONTH_DATE, { validations: [validation], linkUidsForProfile });

    assert.equal(changed[0].status, "changed");

    const html = panel.hoursValidationPanelHTML([...validated, ...changed.map(row => ({ ...row, name: "Otra" }))], "agosto 2026");

    assert.match(html, /1 de 2 validaron/);
    assert.match(html, /is-validated/);
    assert.match(html, /Cambió después de validar/);
});

test("los publicadores invalidan una huella anterior cuando el mes deja de tener Anexo 2", async () => {
    const read = path => readFile(new URL(path, import.meta.url), "utf8");
    const [server, sync, requests] = await Promise.all([
        read("../js/serverEngine.js"),
        read("../js/workerAppDataSync.js"),
        read("../js/workerRequests.js")
    ]);

    assert.match(server, /validations\[monthKey\] = report\.validation \|\| null/);
    assert.match(sync, /validations\[monthKey\] = report\.validation \|\| null/);
    assert.match(requests, /reportValidationByMonth:\s*\{[\s\S]*?validation \|\| null/);
});

test("un error al leer vistos buenos se muestra como error y permite reintentar", async () => {
    const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
    const render = main.match(/async function renderHoursValidationPanel\(\)[\s\S]*?\n}/)?.[0] || "";
    const retry = main.match(/function retryHoursValidationPanel\(\)[\s\S]*?\n}/)?.[0] || "";

    assert.match(render, /if \(watched\.error\)/);
    assert.match(render, /No se pudieron leer los vistos buenos/);
    assert.match(render, /data-hours-validation-retry/);
    assert.ok(
        render.indexOf("if (watched.error)") < render.indexOf("buildHoursValidationRows"),
        "el error corta antes de pintar trabajadores pendientes"
    );
    assert.match(retry, /stopHoursValidationsWatch\(\)/);
    assert.match(retry, /scheduleHoursValidationRender\(0\)/);
    assert.match(main, /\[data-hours-validation-retry\][\s\S]*?retryHoursValidationPanel\(\)/);
});

test("supervisor y PWA usan el mismo calculo; el visto bueno vive en hoursValidations, no en Solicitudes", async () => {
    const read = path => readFile(new URL(path, import.meta.url), "utf8");
    const [main, server, sync, requests, rules, store] = await Promise.all([
        read("../js/main.js"),
        read("../js/serverEngine.js"),
        read("../js/workerAppDataSync.js"),
        read("../js/workerRequests.js"),
        read("../firebase.rules"),
        read("../js/hoursValidationStore.js")
    ]);

    assert.match(main, /buildCoverageAuthorizationRow\(profile, monthDate/);
    assert.doesNotMatch(main, /function coverageSchedule\(/, "sin copia propia del calculo");
    assert.match(server, /buildWorkerMonthlyReport\(/);
    assert.match(server, /reportValidationByMonth,/);
    assert.match(sync, /buildWorkerMonthlyReport\(/);
    assert.match(requests, /buildWorkerMonthlyReport\(/);
    assert.match(requests, /reportValidationByMonth:\s*\{/);
    assert.doesNotMatch(requests + main, /hours_validation/);
    assert.match(store, /collection\(db, "workspaces", workspaceId, "hoursValidations"\)/);
    assert.match(store, /where\("monthKey", "==", monthKey\)/);
    assert.match(rules, /match \/hoursValidations\/\{validationId\} \{[\s\S]*?allow write: if false;/);
    assert.match(main, /stopHoursValidationsWatch/);
    assert.match(main, /previousView === "hours" && nextView !== "hours"/);
    assert.match(main, /onWorkspaceChange:[\s\S]*?stopHoursValidationPanel\(\)/);
});
