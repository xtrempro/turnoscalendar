// "Titulares de Turnos": los cuatro grupos del 4to turno.
//
// El 4to turno es un ciclo de cuatro dias (Largo, Noche, Libre, Libre), asi que
// hay exactamente cuatro fases y cada trabajador esta en una. Lo que se prueba
// aca es que el programa las reconozca solo mirando el calendario, que las
// letras no se muevan de un dia para otro, y que los colores salgan por
// estamento -y por profesion dentro de Profesional-.
import test from "node:test";
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
    location: { hostname: "localhost" },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
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
    COLUMN_LETTERS,
    buildColorAssignments,
    buildEstamentoGaps,
    buildShiftHolders,
    cyclePositionAt,
    detectHolderPlacement,
    compareHolders,
    formatHolderStreak,
    holderColorKey,
    renderShiftHoldersPanel
} = await import("../js/shiftHolders.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const HOY = new Date(2026, 8, 10);   // 10 de septiembre de 2026

function keyFromDate(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function addDays(date, amount) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

/** Siembra la unidad: perfiles y su rotativa. */
function sembrar(workers) {
    localStorage.clear();
    localStorage.setItem("profiles", JSON.stringify(
        workers.map(worker => ({
            id: worker.name,
            name: worker.name,
            estamento: worker.estamento || "Técnico",
            profession: worker.profession || "Técnico en Enfermería",
            active: worker.active !== false
        }))
    ));

    workers.forEach(worker => {
        localStorage.setItem(`rotativa_${worker.name}`, JSON.stringify({
            type: worker.type || "4turno",
            start: worker.start || "2026-01-05",
            firstTurn: worker.firstTurn || "larga"
        }));

        if (worker.baseData) {
            localStorage.setItem(
                `baseData_${worker.name}`,
                JSON.stringify(worker.baseData)
            );
        }
    });
}

/* ======================================================================
   La fase se reconoce sola
   ====================================================================== */

test("dos trabajadores con la misma rotativa caen en la misma columna", () => {
    sembrar([
        { name: "Ana" },
        { name: "Beto" }
    ]);

    const ana = detectHolderPlacement("Ana", HOY);
    const beto = detectHolderPlacement("Beto", HOY);

    assert.equal(ana.letter, beto.letter);
    assert.ok(COLUMN_LETTERS.includes(ana.letter));
});

test("un dia de desfase es otra columna, y las cuatro se ocupan", () => {
    // Cuatro trabajadores corridos un dia entre si cubren las cuatro fases: es
    // la definicion misma del 4to turno.
    sembrar([
        { name: "A1", start: "2026-01-05" },
        { name: "A2", start: "2026-01-06" },
        { name: "A3", start: "2026-01-07" },
        { name: "A4", start: "2026-01-08" }
    ]);

    const letras = ["A1", "A2", "A3", "A4"]
        .map(name => detectHolderPlacement(name, HOY).letter);

    assert.equal(new Set(letras).size, 4, "las cuatro columnas quedan ocupadas");
});

test("el primer turno tambien define la fase, no solo la fecha de inicio", () => {
    // Mismo dia de inicio, distinto "primer turno": son grupos distintos.
    sembrar([
        { name: "Larga", firstTurn: "larga" },
        { name: "Noche", firstTurn: "noche" },
        { name: "Libre1", firstTurn: "libre1" },
        { name: "Libre2", firstTurn: "libre2" }
    ]);

    const letras = ["Larga", "Noche", "Libre1", "Libre2"]
        .map(name => detectHolderPlacement(name, HOY).letter);

    assert.equal(new Set(letras).size, 4);
});

test("un ciclo completo de desfase vuelve a la misma columna", () => {
    // Cuatro dias de diferencia es el ciclo entero: el mismo grupo.
    sembrar([
        { name: "Hoy", start: "2026-01-05" },
        { name: "Cuatro", start: "2026-01-09" }
    ]);

    assert.equal(
        detectHolderPlacement("Hoy", HOY).letter,
        detectHolderPlacement("Cuatro", HOY).letter
    );
});

/* ======================================================================
   Las letras no se mueven
   ====================================================================== */

test("la columna es la misma hoy, mañana y en un mes", () => {
    // Es la decision de diseño: si la letra dependiera del turno del dia, cada
    // trabajador cambiaria de columna cada 24 horas y el listado dejaria de ser
    // un listado de titulares.
    sembrar([{ name: "Ana" }]);

    const letras = [0, 1, 2, 3, 30, 97].map(offset =>
        detectHolderPlacement("Ana", addDays(HOY, offset)).letter
    );

    assert.equal(new Set(letras).size, 1, `no debe cambiar: ${letras.join(", ")}`);
});

test("lo que si cambia cada dia es el turno que muestra el encabezado", () => {
    sembrar([{ name: "Ana" }]);

    const turnos = [0, 1, 2, 3].map(offset =>
        detectHolderPlacement("Ana", addDays(HOY, offset)).todayTurnLabel
    );

    // En cuatro dias recorre el ciclo entero.
    assert.deepEqual([...turnos].sort(), ["Largo", "Libre", "Libre", "Noche"]);
});

test("cyclePositionAt gira en los dos sentidos", () => {
    const base = new Date(2026, 8, 10);

    assert.equal(cyclePositionAt(0, base, addDays(base, 1)), 1);
    assert.equal(cyclePositionAt(0, base, addDays(base, 4)), 0);
    assert.equal(cyclePositionAt(0, base, addDays(base, -1)), 3, "hacia atras");
    assert.equal(cyclePositionAt(3, base, addDays(base, 1)), 0);
});

/* ======================================================================
   Solo 4to turno
   ====================================================================== */

test("el diurno, el 3er turno y los reemplazos quedan fuera", async () => {
    // El diurno no tiene fases y el 3er turno tiene un ciclo de seis dias, que
    // serian otras tantas columnas.
    sembrar([
        { name: "Cuarto", type: "4turno" },
        { name: "Diurno", type: "diurno" },
        { name: "Tercero", type: "3turno" },
        { name: "Reemplazo", type: "reemplazo" }
    ]);

    assert.equal(detectHolderPlacement("Diurno", HOY), null);
    assert.equal(detectHolderPlacement("Tercero", HOY), null);
    assert.equal(detectHolderPlacement("Reemplazo", HOY), null);
    assert.ok(detectHolderPlacement("Cuarto", HOY));

    const board = await buildShiftHolders(HOY);

    assert.equal(board.total, 1);
});

test("los trabajadores inactivos no aparecen", async () => {
    sembrar([
        { name: "Activo" },
        { name: "Inactivo", active: false }
    ]);

    const board = await buildShiftHolders(HOY);
    const nombres = board.columns
        .flatMap(column => column.workers.map(worker => worker.profile.name));

    assert.deepEqual(nombres, ["Activo"]);
});

/* ======================================================================
   Historia hacia atras
   ====================================================================== */

test("con tres meses limpios no hay aviso", () => {
    sembrar([{ name: "Ana", start: "2025-01-05" }]);

    const ana = detectHolderPlacement("Ana", HOY);

    assert.equal(ana.changedGroup, false);
    assert.equal(ana.shortHistory, false);
    assert.equal(ana.historyDays, 92);
    assert.equal(ana.streakDays, 92, "la racha cubre toda la ventana");
});

test("un ingreso reciente usa lo que haya, sin marcarlo como cambio", () => {
    // El requerimiento lo dice: tres meses "o menos si no hay suficientes datos
    // de turnos hacia atras".
    sembrar([{ name: "Nueva", start: "2026-08-24" }]);

    const nueva = detectHolderPlacement("Nueva", HOY);

    assert.equal(nueva.historyDays, 18, "desde el inicio de su rotativa");
    assert.equal(nueva.streakDays, 18);
    assert.equal(nueva.shortHistory, true);
    assert.equal(nueva.changedGroup, false, "no cambio de grupo: recien entra");
});

test("quien cambio de grupo queda en el nuevo, avisando desde cuando", () => {
    sembrar([{ name: "Rosa", start: "2025-01-05" }]);

    const antes = detectHolderPlacement("Rosa", HOY);

    // Se le reescribe la base de los ultimos 20 dias con la fase corrida un
    // lugar: es lo que pasa cuando a alguien lo pasan de grupo.
    const nuevaFase = (antes.position + 1) % 4;
    const CICLO = [1, 2, 0, 0];   // Largo, Noche, Libre, Libre
    const baseData = {};

    for (let back = 0; back < 20; back++) {
        const fase = ((nuevaFase - back) % 4 + 4) % 4;

        baseData[keyFromDate(addDays(HOY, -back))] = CICLO[fase];
    }

    sembrar([{ name: "Rosa", start: "2025-01-05", baseData }]);

    const despues = detectHolderPlacement("Rosa", HOY);

    assert.equal(despues.streakDays, 20, "la racha se corta donde cambio");
    assert.equal(despues.historyDays, 92, "pero la ventana sigue siendo de 3 meses");
    assert.equal(despues.changedGroup, true);
    assert.equal(despues.shortHistory, false);
    // Queda en su grupo ACTUAL, no en el que dice su ficha.
    assert.equal(despues.position, nuevaFase);
    assert.notEqual(despues.letter, antes.letter);
});

test("el aviso se lee en la unidad que corresponde", () => {
    assert.equal(formatHolderStreak(0), "sin coincidencias");
    assert.equal(formatHolderStreak(1), "1 día");
    assert.equal(formatHolderStreak(9), "9 días");
    assert.equal(formatHolderStreak(21), "3 semanas");
    assert.equal(formatHolderStreak(92), "3 meses");
});

/* ======================================================================
   Colores
   ====================================================================== */

const perfil = (estamento, profession) => ({ estamento, profession });

test("cada estamento lleva su color", () => {
    const perfiles = [
        perfil("Profesional", "Enfermería"),
        perfil("Técnico", "Técnico en Enfermería"),
        perfil("Administrativo", "Secretaria"),
        perfil("Auxiliar", "Auxiliar de servicio")
    ];
    const { colors, splitProfessions } = buildColorAssignments(perfiles);

    assert.equal(splitProfessions, false, "una sola profesion profesional");
    assert.equal(colors.size, 4);
    assert.equal(new Set(colors.values()).size, 4, "cuatro colores distintos");
    assert.equal(colors.get("Profesional"), 0);
});

test("dentro de Profesional, cada profesion lleva el suyo", () => {
    const perfiles = [
        perfil("Profesional", "Enfermería"),
        perfil("Profesional", "Kinesiología"),
        perfil("Profesional", "Obstetricia"),
        perfil("Técnico", "Técnico en Enfermería")
    ];
    const { colors, splitProfessions } = buildColorAssignments(perfiles);

    assert.equal(splitProfessions, true);
    assert.deepEqual(
        [...colors.keys()],
        [
            "Profesional · Enfermería",
            "Profesional · Kinesiología",
            "Profesional · Obstetricia",
            "Técnico"
        ]
    );
    assert.equal(new Set(colors.values()).size, 4);
});

test("los demas estamentos NO se abren por profesion", () => {
    // El requerimiento lo pide solo para Profesional.
    const perfiles = [
        perfil("Técnico", "Técnico en Enfermería"),
        perfil("Técnico", "Técnico en Farmacia"),
        perfil("Técnico", "Técnico en Imagenología")
    ];
    const { colors } = buildColorAssignments(perfiles);

    assert.deepEqual([...colors.keys()], ["Técnico"]);
});

test("con una sola profesion profesional no se abre nada", () => {
    const perfiles = [
        perfil("Profesional", "Enfermería"),
        perfil("Profesional", "Enfermería")
    ];
    const { colors, splitProfessions } = buildColorAssignments(perfiles);

    assert.equal(splitProfessions, false);
    assert.deepEqual([...colors.keys()], ["Profesional"]);
    assert.equal(holderColorKey(perfiles[0], false), "Profesional");
    assert.equal(
        holderColorKey(perfiles[0], true),
        "Profesional · Enfermería"
    );
});

test("el color de alguien no cambia porque entre otro trabajador", () => {
    // Si el orden dependiera de como llegan los perfiles, agregar a una persona
    // recolorearia la pantalla entera.
    const base = [
        perfil("Profesional", "Obstetricia"),
        perfil("Técnico", "Técnico en Enfermería")
    ];
    const conMas = [
        perfil("Técnico", "Técnico en Enfermería"),
        perfil("Profesional", "Obstetricia"),
        perfil("Auxiliar", "Auxiliar de servicio")
    ];

    assert.equal(
        buildColorAssignments(base).colors.get("Profesional"),
        buildColorAssignments(conMas).colors.get("Profesional")
    );
    assert.equal(
        buildColorAssignments(base).colors.get("Técnico"),
        buildColorAssignments(conMas).colors.get("Técnico")
    );
});

/* ======================================================================
   El tablero
   ====================================================================== */

test("el tablero arma cuatro columnas y reparte a la gente", async () => {
    sembrar([
        { name: "Ana", start: "2026-01-05" },
        { name: "Beto", start: "2026-01-05" },
        { name: "Cira", start: "2026-01-06" },
        { name: "Dino", start: "2026-01-07" },
        { name: "Eva", start: "2026-01-08" }
    ]);

    const board = await buildShiftHolders(HOY);

    assert.deepEqual(board.columns.map(column => column.letter), ["A", "B", "C", "D"]);
    assert.equal(board.total, 5);
    assert.deepEqual(
        board.columns.map(column => column.workers.length).sort(),
        [1, 1, 1, 2]
    );

    // Cada columna dice que hace hoy, y entre las cuatro cubren el ciclo.
    assert.deepEqual(
        board.columns.map(column => column.todayTurnLabel).sort(),
        ["Largo", "Libre", "Libre", "Noche"]
    );
});

test("una columna vacia igual dice que turno le toca hoy", async () => {
    sembrar([{ name: "Ana", start: "2026-01-05" }]);

    const board = await buildShiftHolders(HOY);
    const vacias = board.columns.filter(column => !column.workers.length);

    assert.equal(vacias.length, 3);
    vacias.forEach(column => {
        assert.ok(
            ["Largo", "Noche", "Libre"].includes(column.todayTurnLabel),
            column.todayTurnLabel
        );
    });
});

test("dentro de la columna la gente va por nombre", async () => {
    sembrar([
        { name: "Zoe", start: "2026-01-05" },
        { name: "Ana", start: "2026-01-05" },
        { name: "Mia", start: "2026-01-05" }
    ]);

    const board = await buildShiftHolders(HOY);
    const columna = board.columns.find(column => column.workers.length);

    assert.deepEqual(
        columna.workers.map(worker => worker.profile.name),
        ["Ana", "Mia", "Zoe"]
    );
});

test("primero el estamento: profesionales, tecnicos, administrativos, auxiliares", async () => {
    sembrar([
        { name: "Aux", start: "2026-01-05", estamento: "Auxiliar", profession: "Auxiliar de servicio" },
        { name: "Tec", start: "2026-01-05", estamento: "Técnico", profession: "Técnico en Enfermería" },
        { name: "Adm", start: "2026-01-05", estamento: "Administrativo", profession: "Secretaria" },
        { name: "Pro", start: "2026-01-05", estamento: "Profesional", profession: "Enfermería" }
    ]);

    const board = await buildShiftHolders(HOY);
    const columna = board.columns.find(column => column.workers.length);

    assert.deepEqual(
        columna.workers.map(worker => worker.profile.name),
        ["Pro", "Tec", "Adm", "Aux"]
    );
});

test("dentro del estamento, por profesion; dentro de la profesion, por abecedario", async () => {
    sembrar([
        { name: "Zulema", start: "2026-01-05", estamento: "Profesional", profession: "Obstetricia" },
        { name: "Ana", start: "2026-01-05", estamento: "Profesional", profession: "Obstetricia" },
        { name: "Bruno", start: "2026-01-05", estamento: "Profesional", profession: "Enfermería" },
        { name: "Aida", start: "2026-01-05", estamento: "Profesional", profession: "Kinesiología" }
    ]);

    const board = await buildShiftHolders(HOY);
    const columna = board.columns.find(column => column.workers.length);

    assert.deepEqual(
        columna.workers.map(worker => `${worker.profile.profession}/${worker.profile.name}`),
        [
            "Enfermería/Bruno",
            "Kinesiología/Aida",
            "Obstetricia/Ana",
            "Obstetricia/Zulema"
        ]
    );
});

test("un estamento fuera del catalogo va al final, no al principio", () => {
    // indexOf devuelve -1 para lo desconocido; sin corregirlo se colaria arriba
    // de los profesionales.
    const raro = { profile: { estamento: "Directivo", profession: "X", name: "A" } };
    const profesional = { profile: { estamento: "Profesional", profession: "Z", name: "Z" } };
    const auxiliar = { profile: { estamento: "Auxiliar", profession: "A", name: "A" } };

    assert.ok(compareHolders(profesional, raro) < 0);
    assert.ok(compareHolders(auxiliar, raro) < 0);
});

test("el orden no depende de como vengan los perfiles", async () => {
    const gente = [
        { name: "Tec2", estamento: "Técnico", profession: "Técnico en Farmacia" },
        { name: "Pro1", estamento: "Profesional", profession: "Enfermería" },
        { name: "Tec1", estamento: "Técnico", profession: "Técnico en Enfermería" },
        { name: "Pro2", estamento: "Profesional", profession: "Obstetricia" }
    ].map(worker => ({ ...worker, start: "2026-01-05" }));
    const esperado = ["Pro1", "Pro2", "Tec1", "Tec2"];

    sembrar(gente);

    const directo = await buildShiftHolders(HOY);

    sembrar([...gente].reverse());

    const alReves = await buildShiftHolders(HOY);

    [directo, alReves].forEach(board => {
        const columna = board.columns.find(column => column.workers.length);

        assert.deepEqual(
            columna.workers.map(worker => worker.profile.name),
            esperado
        );
    });
});

/* ======================================================================
   Pintado
   ====================================================================== */

test("el panel se pinta con las cuatro columnas, la leyenda y los avisos", async () => {
    sembrar([
        { name: "Ana Perez", start: "2026-01-05", estamento: "Profesional", profession: "Enfermería" },
        { name: "Kine Uno", start: "2026-01-06", estamento: "Profesional", profession: "Kinesiología" },
        { name: "Tens Uno", start: "2026-01-07", estamento: "Técnico", profession: "Técnico en Enfermería" },
        { name: "Nueva", start: "2026-08-24", estamento: "Auxiliar", profession: "Auxiliar de servicio" }
    ]);

    const nodo = { innerHTML: "" };

    globalThis.document.getElementById = id =>
        (id === "shiftHoldersPanel" ? nodo : null);

    try {
        await renderShiftHoldersPanel();
    } finally {
        globalThis.document.getElementById = () => null;
    }

    const html = nodo.innerHTML;

    assert.match(html, /Titulares de Turnos/);
    // Las cuatro letras, cada una con lo que hace hoy.
    ["A", "B", "C", "D"].forEach(letra => {
        assert.match(html, new RegExp(`class="tt-letter">${letra}<`));
    });
    assert.equal((html.match(/class="tt-today"/g) || []).length, 4);
    assert.equal((html.match(/class="tt-column"/g) || []).length, 4);

    // La leyenda separa las dos profesiones del estamento Profesional.
    assert.match(html, /Profesional · Enfermería/);
    assert.match(html, /Profesional · Kinesiología/);
    assert.match(html, /tt-legend-item tt-color-\d/);

    // Cada trabajador con su color y su antigüedad en el grupo.
    assert.match(html, /Ana Perez/);
    assert.match(html, /class="tt-worker tt-color-\d/);
    // La recién llegada lleva el aviso de historia corta.
    assert.match(html, /⚠ /);
});

/* ======================================================================
   Cupos disponibles

   Un grupo puede quedar con menos gente de un estamento que los demas -tres
   grupos con cuatro auxiliares y el cuarto con dos- y eso no se ve mirando el
   total de la columna. Se marca con un recuadro por cada trabajador que falta.
   ====================================================================== */

/** Columnas de mentira, con solo lo que mira la comparacion. */
function columnas(...grupos) {
    return grupos.map(gente => ({
        workers: gente.map(estamento => ({ profile: { estamento } }))
    }));
}

const AUX = "Auxiliar";
const TEC = "Técnico";
const PRO = "Profesional";

test("tres grupos con cuatro auxiliares y uno con dos: dos cupos", () => {
    const gaps = buildEstamentoGaps(columnas(
        [AUX, AUX, AUX, AUX],
        [AUX, AUX, AUX, AUX],
        [AUX, AUX, AUX, AUX],
        [AUX, AUX]
    ));

    assert.deepEqual(gaps.slice(0, 3), [[], [], []]);
    assert.deepEqual(gaps[3], [
        { estamento: AUX, count: 2, reference: 4, missing: 2 }
    ]);
});

test("si los cuatro grupos estan parejos no hay cupos", () => {
    const gaps = buildEstamentoGaps(columnas(
        [PRO, TEC], [PRO, TEC], [PRO, TEC], [PRO, TEC]
    ));

    assert.deepEqual(gaps, [[], [], [], []]);
});

test("la referencia es el grupo mejor dotado", () => {
    // Uno con cinco y tres con tres: a los tres les falta para igualarlo. La
    // regla no esconde huecos, aunque el desparejo venga de un grupo que tiene
    // gente de sobra.
    const gaps = buildEstamentoGaps(columnas(
        [TEC, TEC, TEC, TEC, TEC], [TEC, TEC, TEC], [TEC, TEC, TEC], [TEC, TEC, TEC]
    ));

    assert.deepEqual(gaps[0], []);
    gaps.slice(1).forEach(columna => {
        assert.deepEqual(columna, [
            { estamento: TEC, count: 3, reference: 5, missing: 2 }
        ]);
    });
});

test("cada estamento se compara por su cuenta", () => {
    // Al primero le falta un tecnico y al segundo un profesional: tener el
    // total parejo no significa estar parejo por estamento.
    const gaps = buildEstamentoGaps(columnas(
        [PRO, PRO, TEC],
        [PRO, TEC, TEC],
        [PRO, PRO, TEC, TEC],
        [PRO, PRO, TEC, TEC]
    ));

    assert.deepEqual(gaps[0], [
        { estamento: TEC, count: 1, reference: 2, missing: 1 }
    ]);
    assert.deepEqual(gaps[1], [
        { estamento: PRO, count: 1, reference: 2, missing: 1 }
    ]);
    assert.deepEqual(gaps[2], []);
    assert.deepEqual(gaps[3], []);
});

test("un grupo sin nadie de un estamento los muestra todos", () => {
    const gaps = buildEstamentoGaps(columnas(
        [AUX, AUX, TEC], [AUX, AUX, TEC], [AUX, AUX, TEC], [TEC]
    ));

    assert.deepEqual(gaps[3], [
        { estamento: AUX, count: 0, reference: 2, missing: 2 }
    ]);
});

test("pero un grupo entero vacio no se llena de cupos", () => {
    // Sin titulares no es lo mismo que corto de personal: ese grupo puede no
    // usarse en la unidad. La columna ya lo dice con su propio texto.
    const gaps = buildEstamentoGaps(columnas(
        [AUX, AUX, AUX], [AUX, AUX, AUX], [AUX, AUX, AUX], []
    ));

    assert.deepEqual(gaps[3], []);
});

test("los cupos salen en el orden del listado", () => {
    const gaps = buildEstamentoGaps(columnas(
        [PRO], [PRO, PRO, TEC, "Administrativo", AUX], [], []
    ));

    assert.deepEqual(
        gaps[0].map(gap => gap.estamento),
        [PRO, TEC, "Administrativo", AUX]
    );
});

test("un estamento sin registrar no genera cupos", () => {
    // "Sin estamento" es una ficha incompleta, no un cargo: avisarle al
    // supervisor que le falta uno no le sirve de nada.
    const gaps = buildEstamentoGaps(columnas(
        ["", "", ""], [], [], []
    ));

    assert.deepEqual(gaps, [[], [], [], []]);
});

test("y no arrastra a los estamentos de verdad", () => {
    const gaps = buildEstamentoGaps(columnas(
        [TEC, TEC, ""], [TEC], [TEC, TEC], [TEC, TEC]
    ));

    assert.deepEqual(gaps[1], [
        { estamento: TEC, count: 1, reference: 2, missing: 1 }
    ]);
});

test("el cupo cierra el bloque de su estamento, no la columna", async () => {
    // Si quedara al final, en una columna con auxiliares abajo el hueco de los
    // tecnicos se leeria como si faltara un auxiliar.
    sembrar([
        { name: "Tec Uno", start: "2026-01-05", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Aux Uno", start: "2026-01-05", estamento: AUX, profession: "Auxiliar de servicio" },
        { name: "Tec Dos", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Tres", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Aux Dos", start: "2026-01-06", estamento: AUX, profession: "Auxiliar de servicio" }
    ]);

    const board = await buildShiftHolders(HOY);
    const corta = board.columns.find(column =>
        column.workers.some(worker => worker.profile.name === "Tec Uno")
    );

    assert.deepEqual(
        corta.items.map(item =>
            item.type === "gap" ? `cupo ${item.gap.estamento}` : item.worker.profile.name
        ),
        ["Tec Uno", `cupo ${TEC}`, "Aux Uno"]
    );
});

test("y aparece en su lugar aunque el grupo no tenga a nadie de ese estamento", async () => {
    sembrar([
        { name: "Pro Uno", start: "2026-01-05", estamento: PRO, profession: "Enfermería" },
        { name: "Aux Uno", start: "2026-01-05", estamento: AUX, profession: "Auxiliar de servicio" },
        { name: "Pro Dos", start: "2026-01-06", estamento: PRO, profession: "Enfermería" },
        { name: "Tec Uno", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Aux Dos", start: "2026-01-06", estamento: AUX, profession: "Auxiliar de servicio" }
    ]);

    const board = await buildShiftHolders(HOY);
    const sinTecnico = board.columns.find(column =>
        column.workers.some(worker => worker.profile.name === "Pro Uno")
    );

    // El cupo del tecnico va entre el profesional y el auxiliar, que es donde
    // estaria sentado el trabajador que falta.
    assert.deepEqual(
        sinTecnico.items.map(item =>
            item.type === "gap" ? `cupo ${item.gap.estamento}` : item.worker.profile.name
        ),
        ["Pro Uno", `cupo ${TEC}`, "Aux Uno"]
    );
});

test("el numero del encabezado sigue contando titulares, no cupos", async () => {
    sembrar([
        { name: "Tec Uno", start: "2026-01-05", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Dos", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Tres", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" }
    ]);

    const board = await buildShiftHolders(HOY);
    const corta = board.columns.find(column =>
        column.workers.some(worker => worker.profile.name === "Tec Uno")
    );

    assert.equal(corta.workers.length, 1);
    assert.equal(corta.items.length, 2);
});

async function pintar() {
    const nodo = { innerHTML: "" };

    globalThis.document.getElementById = id =>
        (id === "shiftHoldersPanel" ? nodo : null);

    try {
        await renderShiftHoldersPanel();
    } finally {
        globalThis.document.getElementById = () => null;
    }

    return nodo.innerHTML;
}

test("el cupo se pinta como recuadro y dice de que estamento es", async () => {
    sembrar([
        { name: "Tec Uno", start: "2026-01-05", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Dos", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Tres", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" }
    ]);

    const html = await pintar();

    assert.equal((html.match(/class="tt-vacancy"/g) || []).length, 1);
    assert.match(html, /class="tt-vacancy-badge"[^>]*>!</);
    assert.ok(html.includes("Cupo disponible"));
    assert.ok(html.includes('class="tt-vacancy-meta">Técnico<'));
    // El detalle dice contra que se esta comparando.
    assert.ok(html.includes(
        'title="Técnico: este grupo tiene 1 y el grupo con más tiene 2."'
    ));
    // Y la nota al pie explica el recuadro.
    assert.ok(html.includes("cupos disponibles"));
});

test("si no falta nadie, no se pinta ningun cupo ni su explicacion", async () => {
    sembrar([
        { name: "Tec Uno", start: "2026-01-05", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Dos", start: "2026-01-06", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Tres", start: "2026-01-07", estamento: TEC, profession: "Técnico en Enfermería" },
        { name: "Tec Cuatro", start: "2026-01-08", estamento: TEC, profession: "Técnico en Enfermería" }
    ]);

    const html = await pintar();

    assert.ok(!html.includes("tt-vacancy"));
    assert.ok(!html.includes("cupos disponibles"));
});

test("el recuadro tiene estilo propio y no se confunde con un trabajador", async () => {
    const css = await read("../styles.css");

    assert.ok(css.includes(".tt-vacancy {"), "falta el bloque .tt-vacancy");
    assert.ok(css.includes("border: 1px dashed rgba(239, 68, 68, 0.55)"));
    assert.ok(css.includes(".tt-vacancy-badge {"));
    // El mismo rojo de la insignia del hueco de reemplazo de la semanal.
    assert.ok(css.includes("background: #ef4444;"));
});

/* ======================================================================
   Cableado
   ====================================================================== */

test("el menu esta enganchado a su vista y a su panel", async () => {
    const html = await read("../index.html");
    const navigation = await read("../js/navigation.js");
    const main = await read("../js/main.js");
    const css = await read("../styles.css");

    assert.match(html, /data-target="shiftHoldersPanel"[\s\S]{0,900}Titulares de Turnos/);
    assert.match(html, /<section id="shiftHoldersPanel"/);
    assert.match(navigation, /shiftHoldersPanel"\) \{\s*\n\s*return "holders";/);
    assert.match(main, /nextView === "holders"[\s\S]{0,80}renderShiftHoldersPanel\(\)/);
    // El panel solo se ve en su vista.
    assert.match(css, /body:not\(\[data-active-view="holders"\]\) #shiftHoldersPanel/);
});

test("el menu va justo despues de Turnos", async () => {
    // El orden del menu lateral lo pone el CSS: un tile sin regla de `order`
    // cae con order 0, es decir, arriba de todo.
    const css = await read("../styles.css");
    const ORDENES = [
        ["homePanel", null],
        ["profileSection", null],
        ["qualificationsPanel", null],
        ["calendarPanel", null],
        ["shiftHoldersPanel", null],
        [null, "#turnChangesNav"],
        ["clockMarksPanel", null],
        ["reportsPanel", null],
        ["workerRequestsPanel", null],
        ["staffingWeeklyCalendar", null],
        ["taskAssignmentsPanel", null],
        ["informationsPanel", null],
        ["medicalEquipmentPanel", null],
        ["tendersPanel", null],
        ["kanbanPanel", null],
        ["agendaPanel", null],
        ["hoursPanel", null],
        ["memosPanel", null],
        ["dashboardPanel", null],
        ["auditLogPanel", null]
    ];
    const orden = ([target, id]) => {
        const bloque = id
            ? css.slice(css.indexOf(`${id} {`))
            : css.slice(css.indexOf(
                `.actionbar .nav-tile[data-target="${target}"] {`
            ));
        const match = /order:\s*(\d+)/.exec(bloque.slice(0, 120));

        assert.ok(match, `sin orden: ${target || id}`);

        return Number(match[1]);
    };
    const numeros = ORDENES.map(orden);

    // Titulares queda entre Turnos y Cambios de Turno.
    assert.equal(numeros[4], numeros[3] + 1, "va después de Turnos");
    assert.equal(numeros[5], numeros[4] + 1, "y antes de Cambios de Turno");
    // Y nadie quedó con el mismo número al correr la lista.
    assert.equal(new Set(numeros).size, numeros.length, "hay órdenes repetidos");
    assert.deepEqual(numeros, [...numeros].sort((a, b) => a - b), "sin saltos");
});

test("su vista no oculta la grilla que contiene al panel", async () => {
    // El panel vive dentro de .secondary-grid, el mismo contenedor que usa
    // Kanban: ocultarla en esta vista lo dejaba en blanco.
    const css = await read("../styles.css");
    const html = await read("../index.html");

    assert.match(
        html,
        /<section class="secondary-grid">[\s\S]*?id="shiftHoldersPanel"/
    );
    assert.doesNotMatch(
        css,
        /body\[data-active-view="holders"\] \.secondary-grid,/
    );
    assert.match(
        css,
        /body\[data-active-view="holders"\] \.secondary-grid \{\s*\n\s*grid-template-columns/
    );
});

test("el barrido cede el hilo entre trabajador y trabajador", async () => {
    // Cada trabajador mira hasta 92 dias de calendario: hacerlo de corrido en
    // una unidad grande congelaria la pagina.
    const source = await read("../js/shiftHolders.js");

    assert.match(source, /runCooperativeRange\(0, profiles\.length - 1/);
});
