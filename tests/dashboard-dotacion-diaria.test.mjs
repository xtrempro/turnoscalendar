// Dashboard: dotacion diaria por profesion, separando dia y noche.
import test from "node:test";
import assert from "node:assert/strict";

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

const {
    buildDailyServiceDetail,
    buildDailyServiceRows,
    renderDailyServiceChart
} = await import("../js/dashboard.js");
const { TURNO } = await import("../js/constants.js");
const {
    TASK_ASSIGNMENT_ENTRIES_KEY,
    TASK_ASSIGNMENT_TASKS_KEY
} = await import("../js/taskAssignmentProjection.js");

const YEAR = 2026;
const MONTH = 8; // septiembre
const key = day => `${YEAR}-${MONTH}-${day}`;
const norm = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function professionKey(data, fragment) {
    return data.professions.find(item =>
        norm(item.label).includes(norm(fragment))
    )?.id;
}

function setJSON(keyName, value) {
    localStorage.setItem(keyName, JSON.stringify(value));
}

function seed() {
    localStorage.clear();
    setJSON("profiles", [
        {
            id: "p-1",
            name: "Ana Perez",
            estamento: "Profesional",
            profession: "TM Imagenologia",
            active: true
        },
        {
            id: "p-2",
            name: "Bea Soto",
            estamento: "Profesional",
            profession: "Enfermeria",
            active: true
        },
        {
            id: "p-3",
            name: "Dora Rojas",
            estamento: "Profesional",
            profession: "TM Imagenologia",
            active: true
        },
        {
            id: "p-4",
            name: "Eli Inactiva",
            estamento: "Profesional",
            profession: "TM Imagenologia",
            active: false
        },
        {
            id: "p-5",
            name: "Tania Tecnica",
            estamento: "T\u00e9cnico",
            profession: "T\u00e9cnico en Imagenologia",
            active: true
        },
        {
            id: "p-6",
            name: "Mario Admin",
            estamento: "Administrativo",
            profession: "Secretariado",
            active: true
        },
        {
            id: "p-7",
            name: "Luz Auxiliar",
            estamento: "Auxiliar",
            profession: "Aseo clinico",
            active: true
        }
    ]);

    setJSON("data_Ana Perez", {
        [key(1)]: TURNO.LARGA,
        [key(2)]: TURNO.NOCHE,
        [key(3)]: TURNO.TURNO24
    });
    setJSON("data_Bea Soto", {
        [key(1)]: TURNO.NOCHE
    });
    setJSON("data_Dora Rojas", {
        [key(1)]: TURNO.LARGA
    });
    setJSON("data_Eli Inactiva", {
        [key(1)]: TURNO.LARGA
    });
    setJSON("data_Tania Tecnica", {
        [key(1)]: TURNO.LARGA
    });
    setJSON("data_Mario Admin", {
        [key(1)]: TURNO.LARGA
    });
    setJSON("data_Luz Auxiliar", {
        [key(1)]: TURNO.NOCHE
    });
    setJSON("absences_Dora Rojas", {
        [key(1)]: { type: "license" }
    });
    setJSON("admin_Ana Perez", {});
    setJSON("legal_Ana Perez", {});
    setJSON("comp_Ana Perez", {});
    setJSON("absences_Ana Perez", {});
    setJSON("admin_Bea Soto", {});
    setJSON("legal_Bea Soto", {});
    setJSON("comp_Bea Soto", {});
    setJSON("absences_Bea Soto", {});
}

test("cuenta trabajadores diarios por profesion y separa dia/noche", () => {
    seed();

    const data = buildDailyServiceRows(YEAR, MONTH);
    const tm = professionKey(data, "TM Imagenologia");
    const enfermeria = professionKey(data, "Enfermeria");
    const day1 = data.rows[0];
    const day2 = data.rows[1];
    const day3 = data.rows[2];

    assert.equal(day1.values[tm].day, 1);
    assert.equal(day1.values[tm].night, 0);
    assert.equal(day1.values[enfermeria].day, 0);
    assert.equal(day1.values[enfermeria].night, 1);
    assert.equal(day2.values[tm].night, 1);
    assert.equal(day3.values[tm].day, 1);
    assert.equal(day3.values[tm].night, 1);
});

test("profesionales y tecnicos van por profesion, administrativos y auxiliares por estamento", () => {
    seed();

    const data = buildDailyServiceRows(YEAR, MONTH);
    const labels = data.professions.map(item => item.label);
    const tecnico = professionKey(data, "Tecnico en Imagenologia");
    const administrativo = professionKey(data, "Administrativo");
    const auxiliar = professionKey(data, "Auxiliar");

    assert.ok(tecnico);
    assert.equal(data.rows[0].values[tecnico].day, 1);
    assert.equal(data.rows[0].values[administrativo].day, 1);
    assert.equal(data.rows[0].values[auxiliar].night, 1);
    assert.equal(labels.some(label => norm(label).includes("secretariado")), false);
    assert.equal(labels.some(label => norm(label).includes("aseo clinico")), false);
});

test("no cuenta inactivos ni trabajadores con ausencia completa", () => {
    seed();

    const data = buildDailyServiceRows(YEAR, MONTH);
    const tm = professionKey(data, "TM Imagenologia");

    assert.equal(data.rows[0].values[tm].day, 1);
});

test("el grafico usa mismo color por profesion y clic por dia", () => {
    seed();

    const chart = renderDailyServiceChart(buildDailyServiceRows(YEAR, MONTH));

    assert.match(chart, /stroke="#8a1f3d"/);
    assert.match(chart, /stroke-dasharray="8 7"/);
    assert.match(chart, /data-dashboard-service-day="2026-8-1"/);
    assert.match(chart, /data-dashboard-service-estamento="T\u00e9cnico"/);
    assert.match(chart, /data-dashboard-service-estamento="Auxiliar"/);
});

test("el eje X muestra todos los dias del mes", () => {
    seed();

    const chart = renderDailyServiceChart(buildDailyServiceRows(YEAR, MONTH));

    for (let day = 1; day <= 30; day += 1) {
        assert.match(
            chart,
            new RegExp(`dashboard-line-label[^>]*>\\s*${day}\\s*<`)
        );
    }
});

test("el detalle diario trae tareas proyectadas para las columnas", () => {
    seed();
    setJSON(TASK_ASSIGNMENT_TASKS_KEY, [{
        id: "scanner",
        shift: "both",
        shiftScope: "day",
        title: "Escaner",
        order: 1,
        defaultWorkerRules: []
    }]);
    setJSON(TASK_ASSIGNMENT_ENTRIES_KEY, {
        "2026-08-31": {
            "day|scanner|2026-8-1": {
                workers: ["Ana Perez"],
                note: "",
                removedDefaults: []
            }
        }
    });

    const detail = buildDailyServiceDetail(new Date(YEAR, MONTH, 1));

    assert.deepEqual(
        detail.byEstamento.Profesional.day
            .find(row => row.name === "Ana Perez")
            .tasks,
        ["Escaner"]
    );
});
