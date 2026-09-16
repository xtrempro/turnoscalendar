// Contingencia: quien queda de LLAMADO para un turno del dia.
//
// Si alguien no llega a ultima hora, al que tiene la marca de ese dia le toca
// venir a cubrir a su compañero: "LC" para la Larga, "NC" para la Noche.
//
// Lo que este archivo fija son las dos cosas de las que cuelga todo lo demas:
// QUE dias admiten cada marca -de ahi salen las casillas que se iluminan- y
// CUANDO esa marca adelanta al trabajador en las sugerencias de reemplazo. Con
// la fecha encima va primero, porque le toca; con dias por delante todavia se
// puede buscar a otro y el tiene que quedar libre por si ese mismo dia falta
// alguien mas.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

globalThis.localStorage = new MemoryStorage();

const { setJSON } = await import("../js/persistence.js");
const { TURNO } = await import("../js/constants.js");
const { stateModuleForKey } = await import("../js/firebaseStateModules.js");
const { searchReplacements } = await import("../js/workers/scheduleWorker.js");
const {
    CONTINGENCY_BADGE,
    CONTINGENCY_PRIORITY_DAYS,
    canMarkContingency,
    contingencyCoversTurn,
    contingencyDayBlockReason,
    contingencyIsImminent,
    getContingencyKind,
    setContingencyDay,
    toggleContingencyDay
} = await import("../js/contingency.js");

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const html = await leer("../index.html");
const css = await leer("../styles.css");
const main = await leer("../js/main.js");
const calendar = await leer("../js/calendar.js");
const timeline = await leer("../js/timeline.js");
const candidatos = await leer("../js/replacementCandidates.js");
const worker = await leer("../js/workers/scheduleWorker.js");

const NOMBRE = "Trabajadora";
// Julio 2026: domingo 5, lunes 6, martes 7.
const DOMINGO = "2026-6-5";
const LUNES = "2026-6-6";
const MARTES = "2026-6-7";

function sembrar(turnos = {}) {
    localStorage.clear();
    setJSON("profiles", [
        { name: NOMBRE, contractType: "Planta", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + NOMBRE, { type: "libre" });
    setJSON("data_" + NOMBRE, turnos);
}

beforeEach(() => sembrar());

/* =========================================================
   Los dias que admiten cada marca

   Son las reglas del turno que tendria que venir a hacer: la LC entra a las
   08:00 y la NC a las 20:00.
========================================================= */

test("LC: no el dia en que ya hace Larga", () => {
    sembrar({ [LUNES]: TURNO.LARGA });

    assert.equal(canMarkContingency(NOMBRE, LUNES, "L"), false);
    assert.match(
        contingencyDayBlockReason(NOMBRE, LUNES, "L"),
        /ya hace Larga/
    );
});

test("LC: no el dia siguiente a una Noche suya", () => {
    // La Noche termina a las 08:00 y la Larga empieza a las 08:00: encadenaria
    // la jornada sin dormir.
    sembrar({ [DOMINGO]: TURNO.NOCHE });

    assert.equal(canMarkContingency(NOMBRE, LUNES, "L"), false);
    assert.match(
        contingencyDayBlockReason(NOMBRE, LUNES, "L"),
        /saliendo de una Noche/
    );
});

test("LC: si en un dia libre, y tambien en uno con Diurno", () => {
    assert.equal(canMarkContingency(NOMBRE, LUNES, "L"), true);

    sembrar({ [LUNES]: TURNO.DIURNO });

    assert.equal(canMarkContingency(NOMBRE, LUNES, "L"), true);
});

test("NC: no el dia en que ya hace Noche", () => {
    sembrar({ [LUNES]: TURNO.NOCHE });

    assert.equal(canMarkContingency(NOMBRE, LUNES, "N"), false);
    assert.match(
        contingencyDayBlockReason(NOMBRE, LUNES, "N"),
        /ya hace Noche/
    );
});

test("NC: no la vispera de una Larga suya", () => {
    sembrar({ [MARTES]: TURNO.LARGA });

    assert.equal(canMarkContingency(NOMBRE, LUNES, "N"), false);
    assert.match(
        contingencyDayBlockReason(NOMBRE, LUNES, "N"),
        /encadenaría 24 horas/
    );
});

test("NC: si el dia DESPUES de una Larga", () => {
    // Al reves no hay problema: la Larga termina a las 20:00 del dia anterior.
    sembrar({ [DOMINGO]: TURNO.LARGA });

    assert.equal(canMarkContingency(NOMBRE, LUNES, "N"), true);
});

test("un turno de 24 h cierra las dos marcas", () => {
    sembrar({ [LUNES]: TURNO.TURNO24 });

    assert.equal(canMarkContingency(NOMBRE, LUNES, "L"), false);
    assert.equal(canMarkContingency(NOMBRE, LUNES, "N"), false);
});

test("un dia con permiso no queda de contingencia", () => {
    // Quien no puede venir no puede quedar de llamado.
    assert.equal(
        canMarkContingency(NOMBRE, LUNES, "N", { admin: { [LUNES]: 1 } }),
        false
    );
    assert.equal(
        canMarkContingency(
            NOMBRE,
            LUNES,
            "N",
            { hourReturns: { [LUNES]: { hours: 8 } } }
        ),
        false
    );
});

/* =========================================================
   La marca
========================================================= */

test("se marca, y volver a marcar el mismo dia la quita", () => {
    assert.equal(toggleContingencyDay(NOMBRE, LUNES, "N"), "on");
    assert.equal(getContingencyKind(NOMBRE, LUNES), "N");

    assert.equal(toggleContingencyDay(NOMBRE, LUNES, "N"), "off");
    assert.equal(getContingencyKind(NOMBRE, LUNES), "");
});

test("una marca por dia: la otra la reemplaza", () => {
    // Quien queda de llamado para la Larga no puede quedar a la vez para la
    // Noche: cubrir una lo deja fuera de la otra.
    setContingencyDay(NOMBRE, LUNES, "N");

    assert.equal(toggleContingencyDay(NOMBRE, LUNES, "L"), "on");
    assert.equal(getContingencyKind(NOMBRE, LUNES), "L");
});

test("un dia que la regla no admite no se marca", () => {
    sembrar({ [LUNES]: TURNO.NOCHE });

    assert.equal(toggleContingencyDay(NOMBRE, LUNES, "N"), "");
    assert.equal(getContingencyKind(NOMBRE, LUNES), "");
});

test("las siglas son LC y NC", () => {
    assert.equal(CONTINGENCY_BADGE.L, "LC");
    assert.equal(CONTINGENCY_BADGE.N, "NC");
});

/* =========================================================
   A que turno sirve cada marca
========================================================= */

test("la NC sirve para la Noche y para el 24; la LC no", () => {
    assert.equal(contingencyCoversTurn("N", TURNO.NOCHE), true);
    assert.equal(contingencyCoversTurn("N", TURNO.TURNO24), true);
    assert.equal(contingencyCoversTurn("N", TURNO.DIURNO_NOCHE), true);
    assert.equal(contingencyCoversTurn("L", TURNO.NOCHE), false);
});

test("la LC sirve para la Larga y para sus medias jornadas", () => {
    // La media mañana y la media tarde son los dos tramos en que se parte una
    // Larga cuando el ausente tenia medio administrativo.
    assert.equal(contingencyCoversTurn("L", TURNO.LARGA), true);
    assert.equal(contingencyCoversTurn("L", TURNO.MEDIA_MANANA), true);
    assert.equal(contingencyCoversTurn("L", TURNO.MEDIA_TARDE), true);
    assert.equal(contingencyCoversTurn("L", TURNO.DIURNO), false);
    assert.equal(contingencyCoversTurn("", TURNO.LARGA), false);
});

/* =========================================================
   Cuando se adelanta en la lista
========================================================= */

test("hoy y los dias pegados son inminentes; ocho dias mas no", () => {
    const hoy = new Date();
    const enDias = dias => new Date(
        hoy.getFullYear(),
        hoy.getMonth(),
        hoy.getDate() + dias
    );

    assert.equal(contingencyIsImminent(enDias(0), hoy), true);
    assert.equal(
        contingencyIsImminent(enDias(CONTINGENCY_PRIORITY_DAYS), hoy),
        true
    );
    assert.equal(
        contingencyIsImminent(enDias(CONTINGENCY_PRIORITY_DAYS + 1), hoy),
        false
    );
    assert.equal(contingencyIsImminent(enDias(8), hoy), false);
});

const candidato = (name, extra = {}) => ({
    profile: { name },
    isFree: true,
    replacementPriority: 10,
    hhee: 0,
    ...extra
});

const ordenar = candidates => searchReplacements({
    mode: "turnoplus-prepared",
    candidates
}).candidates.map(candidate => candidate.profile.name);

test("el de contingencia encabeza la lista", () => {
    assert.deepEqual(
        ordenar([
            candidato("Ana", { replacementPriority: 1 }),
            candidato("Bruno", { contingencyPriority: true }),
            candidato("Carla")
        ]),
        ["Bruno", "Ana", "Carla"]
    );
});

test("pero no por encima del tope de horas ni de la tarjeta amarilla", () => {
    // De nada sirve ofrecerle el turno a quien despues no se le puede pagar, o
    // a quien seguiria sin dormir, aunque le tocara por contingencia.
    assert.deepEqual(
        ordenar([
            candidato("SobreTope", {
                contingencyPriority: true,
                exceedsDiurnalLimit: true
            }),
            candidato("Amarilla", {
                contingencyPriority: true,
                nextDayMorningShift: 1
            }),
            candidato("Normal")
        ]),
        ["Normal", "Amarilla", "SobreTope"]
    );
});

test("con dias por delante aparece igual, pero sin saltarse la fila", () => {
    // Sigue siendo una opcion -y la tarjeta lo dice-, solo que todavia hay
    // tiempo de buscar a otro.
    const lista = ordenar([
        candidato("Ana", { replacementPriority: 1 }),
        candidato("Lejano", {
            contingencyCovers: true,
            contingencyPriority: false
        })
    ]);

    assert.equal(lista[0], "Ana");
    assert.ok(lista.includes("Lejano"));
});

test("la contingencia se compara despues del tope y del dia siguiente", () => {
    const orden = worker.slice(worker.indexOf("turnoplus-prepared"));

    assert.ok(
        orden.indexOf("nextDayMorningShift") <
        orden.indexOf("contingencyPriority"),
        "la tarjeta amarilla manda sobre la contingencia"
    );
    assert.ok(
        orden.indexOf("contingencyPriority") <
        orden.indexOf("isDiurnoLongCoverage"),
        "y la contingencia manda sobre el resto"
    );
});

test("la bandera que ordena viaja resuelta desde el candidato", () => {
    // El worker que ordena no tiene la fecha para saber si el turno es
    // inminente, asi que se decide al armar el candidato.
    assert.match(
        candidatos,
        /contingencyPriority: contingencyCovers && contingencyImminent,/
    );
    assert.match(
        candidatos,
        /const contingencyImminent = contingencyIsImminent\(date\);/
    );
});

/* =========================================================
   Cableado
========================================================= */

test("los dos botones viven con los demas del menu Turnos", () => {
    const panel = html.slice(
        html.indexOf('id="turnosSidePanel"'),
        html.indexOf("</section>", html.indexOf('id="turnosSidePanel"'))
    );

    assert.match(panel, /data-mark-contingency="larga"/);
    assert.match(panel, /data-mark-contingency="noche"/);
    assert.match(panel, />L CONTINGENCIA</);
    assert.match(panel, />N CONTINGENCIA</);
    // Misma caja que los otros seis, para que se lean como una sola lista.
    assert.match(
        panel,
        /class="legend-action add-turn-button add-turn-button--larga add-turn-button--contingency"/
    );
});

test("se distinguen de los otros sin leer la etiqueta", () => {
    // Relleno es "turno puesto" y hueco es "preasignado": el halo dice
    // "a la espera de que lo llamen".
    assert.match(
        css,
        /\.add-turn-button--contingency \.add-turn-button__dot::before \{/
    );
    assert.match(css, /\.day-badge--contingency \{/);
    assert.match(css, /\.replacement-candidate--contingency/);
});

test("el boton arma su propio modo y no el de agregar turno", () => {
    assert.match(main, /const CONTINGENCY_OPTIONS = \{/);
    assert.match(main, /function activarModoMarcarContingencia\(clave\)/);
    assert.match(main, /activarModo\("contingency", `Marcando \$\{opcion\.label\}`\)/);
    assert.match(
        main,
        /if \(selectionMode === "contingency"\) \{\s*\n\s*await handleContingencySelection\(fecha\);/
    );
    // Y se limpia al apagar cualquier modo, con lo demas.
    assert.match(main, /window\.pendingContingency = "";/);
});

test("el modo NO se apaga al marcar un dia", () => {
    // Al reves que los botones de turno: la contingencia se programa de a
    // varios dias seguidos del mismo trabajador.
    const inicio = main.indexOf("async function handleContingencySelection(");
    // Hasta donde empieza la siguiente funcion: mas alla vive
    // handleTrainingSelection, que si apaga el modo, y daria un falso negativo.
    const bloque = main.slice(
        inicio,
        main.indexOf("\nasync function ", inicio + 1)
    );

    assert.match(bloque, /El modo se queda armado/);
    assert.doesNotMatch(
        bloque.slice(bloque.indexOf("const resultado")),
        /clearSelectionMode\(\)/
    );
    // El de turno sigue apagandose.
    assert.match(main, /\/\/ Un boton, un turno\.\s*\n\s*clearSelectionMode\(\);/);
});

test("la casilla que se ilumina y la que acepta el click salen del mismo sitio", () => {
    assert.match(calendar, /export function canMarkContingencyDay\(/);
    assert.match(calendar, /export function toggleContingencyForDay\(/);
    assert.match(
        calendar,
        /window\.selectionMode === "contingency" &&\s*\n\s*!canMarkContingencyDay\(/
    );
    assert.match(calendar, /contingencyBlocked \|\|/);
});

test("un dia ya marcado siempre se puede tocar, para poder quitarlo", () => {
    const bloque = calendar.slice(
        calendar.indexOf("export function canMarkContingencyDay(")
    ).slice(0, 700);

    assert.match(
        bloque,
        /if \(getContingencyKind\(profileName, keyDay\) === kindValue\) return true;/
    );
});

test("la sigla convive con el turno del dia en vez de reemplazarlo", () => {
    // Va como insignia -como el "No disp."-, no como etiqueta: el dia puede
    // tener turno propio.
    assert.match(
        calendar,
        /\.\.\.\(contingencyKind\s*\n\s*\? \[CONTINGENCY_BADGE\[contingencyKind\]\]/
    );
    assert.match(calendar, /day-badge--contingency/);
});

test("y tambien se ve en el timeline, sin tapar lo urgente", () => {
    // Es la sigla de menor prioridad de la casilla: no hay nada que resolver.
    assert.match(timeline, /: contingencyMark\);/);
    assert.match(timeline, /contingency-mini/);
});

/* =========================================================
   Que el dato viaje y no se pierda
========================================================= */

test("viaja en el modulo turnos, asi que no necesita reglas nuevas", () => {
    // Un modulo nuevo sin sus reglas desplegadas tumba TODA la sincronizacion:
    // por eso la marca se cuelga de un modulo que ya existe.
    assert.equal(stateModuleForKey(`contingency_${NOMBRE}`), "turnos");
});

test("se sincroniza por dia y no como un valor entero", async () => {
    // Sin esto, dos supervisores marcando dias distintos se pisarian la lista.
    const parcial = await leer("../js/firebasePartialState.js");

    assert.match(parcial, /"contingency_",/);
});

test("sigue al trabajador si le cambian el nombre", async () => {
    const storage = await leer("../js/storage.js");
    const keysToMove = storage.slice(
        storage.indexOf("const keysToMove = ["),
        storage.indexOf("];", storage.indexOf("const keysToMove = ["))
    );

    assert.match(keysToMove, /"contingency_",/);
});

test("un cambio ajeno repinta la casilla y la fila", () => {
    // El calendario compara mapas para saber que dias repintar, y el timeline
    // mira el prefijo para saber a que trabajador le cambio algo.
    assert.match(calendar, /\[`contingency_\$\{profileName\}`\]: getJSON\(/);
    assert.match(timeline, /"contingency_",/);
    assert.match(timeline, /contingencyByProfile: new Map\(\),/);
});
