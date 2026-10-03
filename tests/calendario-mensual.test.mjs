// Calendario Mensual: por dia, quien esta de Dia y de Noche (3er/4to turno),
// con las iniciales de la unidad, en rojo quien cubre, "+XX" el turno de un
// ausente sin cubrir, y un filtro de profesion a la vez.

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
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost", href: "http://localhost/" },
    matchMedia: () => ({ matches: false, addEventListener() {} })
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

const { setJSON } = await import("../js/persistence.js");
const mensual = await import("../js/monthlyCalendar.js");
const { saveReplacement } = await import("../js/replacements.js");

// Profesiones reales de la app (storage.js normaliza las que no reconoce).
const TM = "TM Imagenología";
const TENS = "Técnico en Enfermería";

beforeEach(() => {
    localStorage.clear();
    setJSON("profiles", [
        { name: "Juan Zapata", estamento: "Profesional", profession: TM, active: true },
        { name: "Karla Andrea Soto", estamento: "Profesional", profession: TM, active: true },
        { name: "Pablo Ignacio Rojas Aravena", estamento: "Profesional", profession: TM, active: true },
        { name: "Ana Paz Diaz", estamento: "Técnico", profession: TENS, active: true }
    ]);
    // Los cuatro en 4to turno, en grupos distintos.
    [
        ["Juan Zapata", "larga"],
        ["Karla Andrea Soto", "noche"],
        ["Pablo Ignacio Rojas Aravena", "libre"],
        ["Ana Paz Diaz", "larga"]
    ].forEach(([name, firstTurn]) => {
        setJSON("rotativa_" + name, { type: "4turno", start: "2026-10-01", firstTurn });
    });
});

test("iniciales con la regla de la unidad", () => {
    assert.equal(mensual.workerInitials("Juan Zapata"), "JZ");
    assert.equal(mensual.workerInitials("Karla Andrea Soto"), "KA");
    assert.equal(mensual.workerInitials("Pablo Ignacio Rojas Aravena"), "PR");
    assert.equal(mensual.workerInitials("Ana Maria Paz Diaz Soto"), "AD");
    assert.equal(mensual.workerInitials("Ana Maria Paz Diaz Soto Lara"), "AS");
    // Dos con las mismas iniciales: se distinguen con la segunda letra.
    const mapa = mensual.initialsMap(["Juan Vega", "Jose Vera"]);

    assert.notEqual(mapa.get("Juan Vega"), mapa.get("Jose Vera"));
    assert.equal(mapa.get("Juan Vega"), "JuV", "sin palabra siguiente: la minuscula");

    // Con palabra siguiente, primero su inicial.
    const fr = mensual.initialsMap([
        "Fernanda Andrea Romero Gonzalez",
        "Felipe Ignacio Rodriguez Carrizo",
        "Karla Maria Soto"
    ]);

    assert.equal(fr.get("Fernanda Andrea Romero Gonzalez"), "FRG");
    assert.equal(fr.get("Felipe Ignacio Rodriguez Carrizo"), "FRC");
    assert.equal(fr.get("Karla Maria Soto"), "KM", "sin empate no cambia");

    // Si aun empatan, la minuscula de antes.
    const empate = mensual.initialsMap([
        "Fernanda Andrea Romero Gonzalez",
        "Fabian Ignacio Rodriguez Garrido"
    ]);

    assert.equal(empate.get("Fernanda Andrea Romero Gonzalez"), "FeR");
    assert.equal(empate.get("Fabian Ignacio Rodriguez Garrido"), "FaR");
});

test("dia y noche con quien corresponde, solo de la profesion elegida", async () => {
    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const uno = mes.rows[0];

    assert.equal(mes.rows.length, 31);
    assert.deepEqual(uno.slots.day.map(p => p.initials), ["JZ"]);
    assert.deepEqual(uno.slots.night.map(p => p.initials), ["KA"]);
    // El filtro no suma: la TENS no aparece.
    const todos = mes.rows.flatMap(row => [...row.slots.day, ...row.slots.night]);

    assert.ok(todos.every(p => p.name !== "Ana Paz Diaz"));
    assert.deepEqual(
        [...mensual.monthlyGroups(new Date(2026, 9, 1))].sort(),
        [TENS, TM].sort()
    );
});

test("un ausente sin cubrir es un hueco; quien lo cubre va en rojo", async () => {
    // Juan con feriado legal el 1: su Larga queda sin cubrir.
    setJSON("legal_Juan Zapata", { "2026-9-1": true });

    let uno = (await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM)).rows[0];

    assert.deepEqual(uno.slots.day, []);
    assert.deepEqual(uno.gaps.day.map(g => g.initials), ["JZ"]);

    // Pablo (libre ese dia) lo cubre.
    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        replaced: "Juan Zapata",
        keyDay: "2026-9-1",
        turno: 1
    });

    uno = (await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM)).rows[0];

    assert.deepEqual(uno.gaps.day, []);
    assert.deepEqual(
        uno.slots.day.map(p => [p.initials, p.covering]),
        [["PR", true]]
    );
    // El texto al pasar el mouse dice a quien cubre y por que permiso.
    assert.match(uno.slots.day[0].coverDetail, /^Juan Zapata \(.+\)$/);
});

test("un apoyo extra con motivo va en la columna de su motivo, no con los titulares", async () => {
    // Pablo libre el 1: se le agrega una Larga de apoyo, con motivo.
    setJSON("data_Pablo Ignacio Rojas Aravena", { "2026-9-1": 1 });
    ["2026-9-1"].forEach(keyDay => saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        keyDay,
        turno: 1,
        reason: "Apoyo pacientes TC oncológicos",
        absenceType: "Motivo manual",
        source: "manual_extra",
        addsShift: false
    }));

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const uno = mes.rows[0];

    assert.deepEqual(mes.extraColumns.day, ["Apoyo pacientes TC oncológicos"]);
    assert.deepEqual(mes.extraColumns.night, []);
    assert.deepEqual(uno.slots.day.map(p => p.initials), ["JZ"]);
    assert.deepEqual(
        uno.extras.day["Apoyo pacientes TC oncológicos"].map(p => [p.initials, p.covering]),
        [["PR", false]]
    );
});

test("los motivos con poca gente se agrupan; expandidos se ven todos", () => {
    const model = {
        extraColumns: { day: ["Grande", "Calidad", "Ris Pacs"], night: ["Solo"] },
        extraCounts: { day: { Grande: 5, Calidad: 1, "Ris Pacs": 2 }, night: { Solo: 1 } }
    };

    assert.deepEqual(mensual.visibleExtraColumns(model, "day"), [
        { kind: "reason", reason: "Grande" },
        { kind: "group", reasons: ["Calidad", "Ris Pacs"] }
    ]);
    assert.equal(mensual.visibleExtraColumns(model, "day", true).length, 3);
    // Uno solo de poca gente no se agrupa: no ahorraria nada.
    assert.deepEqual(mensual.visibleExtraColumns(model, "night"), [
        { kind: "reason", reason: "Solo" }
    ]);
});

test("arrastrar a otro motivo cambia el motivo y la columna vacia desaparece", async () => {
    const { setManualExtraReason } = await import("../js/replacements.js");

    setJSON("data_Pablo Ignacio Rojas Aravena", { "2026-9-1": 1 });
    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        keyDay: "2026-9-1",
        turno: 1,
        reason: "Calidad",
        absenceType: "Motivo manual",
        source: "manual_extra",
        addsShift: false
    });

    let mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const apoyo = mes.rows[0].extras.day.Calidad[0];

    assert.ok(apoyo.extraId);
    assert.ok(setManualExtraReason(apoyo.extraId, "Ris Pacs"));

    mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);

    assert.deepEqual(mes.extraColumns.day, ["Ris Pacs"]);
    assert.equal(mes.rows[0].extras.day["Ris Pacs"][0].name, "Pablo Ignacio Rojas Aravena");
});

test("agregado desde las sugerencias en la columna de un motivo: queda ahi y se puede mover", async () => {
    const { setManualExtraReason } = await import("../js/replacements.js");

    // Lo que guarda el modal de sugerencias en su modo de turno extra con
    // motivo: no reemplaza a nadie, el motivo es el de la columna.
    saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        replaced: "",
        reason: "Calidad",
        keyDay: "2026-9-1",
        turno: 1,
        absenceType: "",
        source: "rota_gap"
    });

    let mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const apoyo = mes.rows[0].extras.day.Calidad?.[0];

    assert.equal(apoyo?.name, "Pablo Ignacio Rojas Aravena");
    assert.equal(apoyo.extraSource, "rota_gap");
    assert.ok(mes.rows[0].slots.day.every(p => p.name !== apoyo.name));

    assert.ok(setManualExtraReason(apoyo.extraId, "Ris Pacs"));
    mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    assert.deepEqual(mes.extraColumns.day, ["Ris Pacs"]);
});

test("primero los profesionales, y entre ellos la profesion con mas gente", () => {
    // Dos kinesiologos no le ganan a tres TM; la TENS (tecnico) va al final
    // aunque se sumen mas.
    const kine = "Kinesiología";
    const perfiles = JSON.parse(localStorage.getItem("profiles"));

    setJSON("profiles", [
        ...perfiles,
        { name: "Kine Uno", estamento: "Profesional", profession: kine, active: true },
        { name: "Kine Dos", estamento: "Profesional", profession: kine, active: true },
        ...["Tens Uno", "Tens Dos", "Tens Tres", "Tens Cuatro"].map(name => ({
            name, estamento: "Técnico", profession: TENS, active: true
        }))
    ]);
    ["Kine Uno", "Kine Dos", "Tens Uno", "Tens Dos", "Tens Tres", "Tens Cuatro"].forEach(name => {
        setJSON("rotativa_" + name, { type: "4turno", start: "2026-10-01", firstTurn: "larga" });
    });

    const grupos = mensual.monthlyGroups(new Date(2026, 9, 1));

    assert.equal(grupos[0], TM);
    assert.equal(grupos.at(-1), TENS);
});

test("el mes que viene trae las tareas recurrentes aunque esten vacias", async () => {
    const hoy = new Date();
    const mes = offset => new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
    const clave = fecha => `${fecha.getFullYear()}-${fecha.getMonth()}-10`;
    const apoyo = (fecha, reason) => saveReplacement({
        worker: "Pablo Ignacio Rojas Aravena",
        replaced: "",
        reason,
        keyDay: clave(fecha),
        turno: 1,
        absenceType: "",
        source: "rota_gap"
    });

    // "Calidad" en los dos meses anteriores: recurrente. "Ris Pacs" una vez
    // hace dos meses: no, pero se ofrece con el "+".
    apoyo(mes(-1), "Calidad");
    apoyo(mes(-2), "Calidad");
    apoyo(mes(-2), "Ris Pacs");

    const siguiente = await mensual.buildMonthlyCalendar(mes(1), TM);

    assert.deepEqual(siguiente.extraColumns.day, ["Calidad"]);
    // Vacia pero fijada: no se esconde en "Otros motivos".
    assert.deepEqual(mensual.visibleExtraColumns(siguiente, "day"), [
        { kind: "reason", reason: "Calidad" }
    ]);
    assert.deepEqual(
        siguiente.historyReasons.day.map(item => [item.reason, item.recurrent]),
        [["Calidad", true], ["Ris Pacs", false]]
    );
});

test("al quitar, solo los permisos que admite ese dia", async () => {
    const valores = async keyDay =>
        (await mensual.allowedLeaveOptions("Juan Zapata", keyDay)).map(o => o.value);

    // Jueves 1 de octubre, Larga, dia habil: todos.
    const habil = await valores("2026-9-1");

    assert.ok(habil.includes("admin"));
    assert.ok(habil.includes("half_admin_morning"));
    assert.ok(habil.includes("legal"));

    // Sabado 17, Larga, sin asignacion de turno: ni administrativo ni medio,
    // ni feriados (parten en dia habil). Las licencias si.
    const sabado = await valores("2026-9-17");

    assert.ok(!sabado.includes("admin"));
    assert.ok(!sabado.includes("half_admin_morning"));
    assert.ok(!sabado.includes("half_admin_afternoon"));
    assert.ok(!sabado.includes("legal"));
    assert.ok(sabado.includes("license"));
});

test("se cuentan los turnos que un permiso deja sin cubrir (uno abre sugerencias)", () => {
    // Juan (4to turno): Larga el 1, Noche el 2, Larga el 5. Un feriado del 1 al
    // 5 deja tres turnos sin cubrir -un rango-; solo el 1, uno.
    setJSON("legal_Juan Zapata", { "2026-9-1": true });
    assert.deepEqual(mensual.uncoveredDaysFrom("Juan Zapata", new Date(2026, 9, 1), 7), ["2026-9-1"]);

    setJSON("legal_Juan Zapata", {
        "2026-9-1": true, "2026-9-2": true, "2026-9-3": true, "2026-9-4": true, "2026-9-5": true
    });
    assert.deepEqual(
        mensual.uncoveredDaysFrom("Juan Zapata", new Date(2026, 9, 1), 7),
        ["2026-9-1", "2026-9-2", "2026-9-5"]
    );
});

test("los preasignados se ven (azul) donde irian: cubriendo al ausente o en su motivo", async () => {
    const { addPreassignment } = await import("../js/preassignments.js");

    // Juan con feriado el 1: Pablo preasignado a cubrirlo. Karla (libre el 3)
    // preasignada a un motivo.
    setJSON("legal_Juan Zapata", { "2026-9-1": true });
    addPreassignment({ worker: "Pablo Ignacio Rojas Aravena", replaced: "Juan Zapata", keyDay: "2026-9-1", turno: 1, absenceType: "F. Legal" });
    addPreassignment({ worker: "Karla Andrea Soto", replaced: "", reason: "Calidad", keyDay: "2026-9-3", turno: 1 });

    const mes = await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM);
    const uno = mes.rows[0];

    // Ya no es un hueco: esta tentativamente cubierto.
    assert.deepEqual(uno.gaps.day, []);
    assert.deepEqual(
        uno.slots.day.map(p => [p.initials, p.preassigned === true]),
        [["PR", true]]
    );
    assert.deepEqual(mes.extraColumns.day, ["Calidad"]);
    assert.equal(mes.rows[2].extras.day.Calidad[0].preassigned, true);
});

test("confirmar una preasignacion deja al que cubre en rojo (no la hace desaparecer)", async () => {
    const { addPreassignment } = await import("../js/preassignments.js");
    const { confirmPreassignment, preassignmentTurn } = await import("../js/replacements.js");

    // La reserva guarda el turno como numero; antes se leia como codigo y
    // quedaba Libre: el reemplazo confirmado no cubria nada.
    assert.equal(preassignmentTurn(2), 2);
    assert.equal(preassignmentTurn("N"), 2);
    assert.equal(preassignmentTurn("24"), 3);

    setJSON("legal_Juan Zapata", { "2026-9-1": true });
    const reserva = addPreassignment({
        worker: "Pablo Ignacio Rojas Aravena",
        replaced: "Juan Zapata",
        keyDay: "2026-9-1",
        turno: 1,
        absenceType: "F. Legal"
    });

    assert.ok(confirmPreassignment(reserva));

    const uno = (await mensual.buildMonthlyCalendar(new Date(2026, 9, 1), TM)).rows[0];

    assert.deepEqual(uno.gaps.day, []);
    assert.deepEqual(
        uno.slots.day.map(p => [p.initials, p.covering, Boolean(p.preassigned)]),
        [["PR", true, false]]
    );
});

test("los ya confirmados sin turno se reparan con el turno del ausente", async () => {
    const { repairEmptyTurnReplacements } = await import("../js/preassignmentRepair.js");
    const { getJSON } = await import("../js/persistence.js");

    setJSON("legal_Juan Zapata", { "2026-9-1": true });
    // Como quedaron: turno vacio.
    setJSON("replacements", [{
        id: "roto",
        worker: "Pablo Ignacio Rojas Aravena",
        replaced: "Juan Zapata",
        date: "2026-10-01",
        turno: "",
        source: "replacement",
        createdAt: "2026-09-30T12:00:00.000Z",
        canceled: false
    }]);

    assert.equal(repairEmptyTurnReplacements().length, 1);
    assert.equal(getJSON("replacements", [])[0].turno, "L");
    // Idempotente: la segunda vez no hay nada que hacer.
    assert.equal(repairEmptyTurnReplacements().length, 0);
});

test("el menu existe, va con el permiso de Turnos y filtra de a una profesion", async () => {
    const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");
    const [html, navegacion, permisos, fuente] = await Promise.all([
        leer("../index.html"),
        leer("../js/navigation.js"),
        leer("../js/workspacePermissions.js"),
        leer("../js/monthlyCalendar.js")
    ]);

    assert.match(html, /data-target="monthlyCalendarPanel"[\s\S]{0,900}Calendario Mensual/);
    assert.match(navegacion, /targetId === "monthlyCalendarPanel"\) \{\s*return "monthly";/);
    assert.match(permisos, /monthlyCalendarPanel: "turnos"/);
    assert.match(fuente, /if \(!groups\.includes\(ui\.group\)\) ui\.group = groups\[0\] \|\| "";/);
});
