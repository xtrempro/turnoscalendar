// Cobertura automatica POR ETAPAS.
//
// El boton de la tarjeta de inicio ya no manda una tanda unica: abre una
// campaña que va ampliando el circulo cada 24 h.
//
//   Con mas de 72 h de anticipacion:
//     t=0    A  primer tercio con menos horas extras del mes DEL TURNO
//     t=24h  B  segundo tercio
//     t=48h  C  masiva a todos + D alerta sonora al supervisor
//
//   Con menos de 72 h: se entra directo en C, y D sale 24 h despues o a la
//   mitad del tiempo que falta para el turno, lo que ocurra primero.
//
// Filtros: 1 (dia bloqueado por el trabajador) y 2 (turno de dia al dia
// siguiente) rigen en A y B; la masiva los levanta. La regla 4 (tope mensual de
// horas extras DIURNAS) no se levanta nunca.
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

// El reparto de las etapas es puro y vive en autoCoveragePlan.js: lo comparten
// el navegador y la Cloud Function que hace avanzar la cobertura.
const {
    AUTO_COVERAGE_DIRECT_MASS_HOURS,
    buildPlan,
    dueSteps,
    formatCoverageTimeLeft,
    overtimeThird,
    selectStageTargets,
    stageEligible
} = await import("../js/autoCoveragePlan.js");
const { shiftStartInstant } = await import("../js/autoCoverage.js");
const { TURNO } = await import("../js/constants.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const home = await read("../js/home.js");
const calendar = await read("../js/calendar.js");
const main = await read("../js/main.js");
const autoCoverage = await read("../js/autoCoverage.js");
const plan = await read("../js/autoCoveragePlan.js");
const serverAuto = await read("../js/serverAutoCoverage.js");
const scheduler = await read("../functions/autoCoverageScheduler.js");
const functionsIndex = await read("../functions/index.js");
const replacements = await read("../js/replacements.js");
const candidatos = await read("../js/replacementCandidates.js");
const pwa = await read(
    "../../APP TurnoPlus/www/js/app.js"
).catch(() => "");

const HOUR = 60 * 60 * 1000;

// Candidato con lo minimo que mira el motor de etapas.
function candidato(name, hhee, extra = {}) {
    return {
        profile: { name },
        hhee,
        blockedDay: null,
        nextDayMorningShift: 0,
        exceedsDiurnalLimit: false,
        isForced: false,
        isLinked: false,
        ...extra
    };
}

const nombres = list => list.map(item => item.profile.name);

/* ======================================================================
   Punto 3: el tercio con menos horas extras
   ====================================================================== */

test("la etapa A toma el tercio con MENOS horas extras", () => {
    // Seis candidatos: el tercio son dos.
    const pool = [
        candidato("F", 30), candidato("B", 5), candidato("D", 18),
        candidato("A", 0), candidato("C", 12), candidato("E", 24)
    ];

    assert.deepEqual(nombres(overtimeThird(pool, 1)), ["A", "B"]);
});

test("la etapa B toma el SEGUNDO tercio, sin repetir a nadie de A", () => {
    const pool = [
        candidato("F", 30), candidato("B", 5), candidato("D", 18),
        candidato("A", 0), candidato("C", 12), candidato("E", 24)
    ];
    const primero = nombres(overtimeThird(pool, 1));
    const segundo = nombres(overtimeThird(pool, 2));

    assert.deepEqual(segundo, ["C", "D"]);
    assert.equal(
        primero.some(name => segundo.includes(name)),
        false,
        "los tercios no se pisan"
    );
});

test("con pocos candidatos el tercio no queda vacio", () => {
    // Con 4 candidatos, redondear hacia abajo dejaria el primer tercio en 1 y
    // el segundo en 1, y dos personas nunca recibirian la solicitud. Se
    // redondea hacia arriba: 2 y 2.
    const pool = [
        candidato("A", 1), candidato("B", 2),
        candidato("C", 3), candidato("D", 4)
    ];

    assert.deepEqual(nombres(overtimeThird(pool, 1)), ["A", "B"]);
    assert.deepEqual(nombres(overtimeThird(pool, 2)), ["C", "D"]);

    // Con uno solo, la etapa A se lo lleva y la B queda vacia (y la campaña
    // pasa de largo a la masiva).
    assert.deepEqual(nombres(overtimeThird([candidato("Z", 9)], 1)), ["Z"]);
    assert.deepEqual(overtimeThird([candidato("Z", 9)], 2), []);
    assert.deepEqual(overtimeThird([], 1), []);
});

test("el orden es estable cuando dos empatan en horas extras", () => {
    // Sin desempate, dos corridas del mismo tercio podrian mandarle la
    // solicitud a personas distintas segun como viniera ordenada la lista.
    const pool = [candidato("Zoe", 10), candidato("Ana", 10)];

    assert.deepEqual(nombres(overtimeThird(pool, 1)), ["Ana"]);
    assert.deepEqual(nombres(overtimeThird(pool, 2)), ["Zoe"]);
});

test("nadie recibe la solicitud dos veces por los tercios", () => {
    // Entre una oleada y la siguiente el reparto se recalcula solo: las horas
    // extras cambian cuando alguien toma otro turno.
    const campaign = {
        steps: [
            { kind: "third", third: 1, ranAt: "x", sent: ["Ana", "Beto"] },
            { kind: "third", third: 2, at: "y" }
        ]
    };
    const pool = [
        candidato("Ana", 0), candidato("Beto", 1), candidato("Cira", 2),
        candidato("Dina", 3), candidato("Eva", 4), candidato("Fabi", 5)
    ];
    const segunda = selectStageTargets(
        campaign,
        { kind: "third", third: 2 },
        pool
    );

    // El segundo tercio del ranking COMPLETO es Cira y Dina. Descartar a los ya
    // contactados ANTES de cortar habria corrido el corte hasta Eva y Fabi, y
    // se habria saltado justo a quienes les tocaba.
    assert.deepEqual(nombres(segunda.targets), ["Cira", "Dina"]);

    // Y si el reparto cambia y alguien del primer tercio cae en el segundo, no
    // se le manda de nuevo.
    const repetido = selectStageTargets(
        { steps: [{ sent: ["Cira"] }] },
        { kind: "third", third: 2 },
        pool
    );

    assert.deepEqual(nombres(repetido.targets), ["Dina"]);

    // La masiva SI vuelve a preguntarles: para eso es masiva.
    const masiva = selectStageTargets(campaign, { kind: "mass" }, pool);

    assert.equal(nombres(masiva.targets).includes("Ana"), true);
});

/* ======================================================================
   Puntos 1, 2 y 4: los filtros por etapa
   ====================================================================== */

const TERCIO = { kind: "third", third: 1 };
const MASIVA = { kind: "mass" };

test("A y B excluyen al que bloqueo el dia desde su PWA (filtro 1)", () => {
    const pool = [
        candidato("Libre", 0),
        candidato("Bloqueado", 0, { blockedDay: { message: "no molestar" } })
    ];

    assert.deepEqual(nombres(stageEligible(pool, TERCIO)), ["Libre"]);
});

test("A y B excluyen al que tiene turno al dia siguiente (filtro 2)", () => {
    // Es la tarjeta amarilla del modal de sugerencias: trabajaria de noche y
    // seguiria de largo a la mañana siguiente.
    const pool = [
        candidato("Libre", 0),
        candidato("Amarillo", 0, { nextDayMorningShift: TURNO.LARGA })
    ];

    assert.deepEqual(nombres(stageEligible(pool, TERCIO)), ["Libre"]);
});

test("la masiva levanta los filtros 1 y 2", () => {
    const pool = [
        candidato("Libre", 0),
        candidato("Bloqueado", 0, { blockedDay: { message: "no molestar" } }),
        candidato("Amarillo", 0, { nextDayMorningShift: TURNO.LARGA })
    ];

    assert.deepEqual(
        nombres(stageEligible(pool, MASIVA)),
        ["Libre", "Bloqueado", "Amarillo"]
    );
});

test("la regla 4 rige en TODAS las etapas, tambien en la masiva", () => {
    // Es la unica que la solicitud masiva no levanta: es un turno que despues
    // no se le podria pagar.
    const pool = [
        candidato("Cabe", 0),
        candidato("SePasa", 0, { exceedsDiurnalLimit: true })
    ];

    assert.deepEqual(nombres(stageEligible(pool, TERCIO)), ["Cabe"]);
    assert.deepEqual(nombres(stageEligible(pool, MASIVA)), ["Cabe"]);
});

test("ni la masiva le ofrece el turno a un forzado o a otra unidad", () => {
    // Un forzado no cumple el perfil del ausente y una unidad enlazada va por
    // el prestamo entre unidades, con su propia autorizacion.
    const pool = [
        candidato("Propio", 0),
        candidato("Forzado", 0, { isForced: true }),
        candidato("OtraUnidad", 0, { isLinked: true })
    ];

    assert.deepEqual(nombres(stageEligible(pool, MASIVA)), ["Propio"]);
});

/* ======================================================================
   El plan de etapas
   ====================================================================== */

const ahora = new Date(2026, 8, 1, 9, 0, 0);
const enHoras = h => new Date(ahora.getTime() + h * HOUR);
const horasHasta = iso =>
    Math.round((new Date(iso).getTime() - ahora.getTime()) / HOUR);

test("el umbral del requerimiento son 72 horas", () => {
    assert.equal(AUTO_COVERAGE_DIRECT_MASS_HOURS, 72);
});

test("solo se corre la ultima etapa vencida", () => {
    // Si nadie barrio en dos dias hay varias vencidas a la vez: mandar el
    // primer tercio y la masiva con un segundo de diferencia no ayuda a nadie.
    const campaign = {
        steps: [
            { kind: "third", third: 1, at: "2026-09-01T09:00:00.000Z" },
            { kind: "third", third: 2, at: "2026-09-02T09:00:00.000Z" },
            { kind: "mass", at: "2026-09-03T09:00:00.000Z", alert: true }
        ]
    };
    const vencidas = dueSteps(campaign, new Date("2026-09-03T10:00:00.000Z"));

    assert.deepEqual(vencidas.map(item => item.index), [0, 1, 2]);
    // Quien las corre se queda con la ultima y salta las anteriores.
    assert.match(scheduler, /const target = due\[due\.length - 1\];/);
    assert.match(scheduler, /steps\[index\]\.skipped = true;/);

    // Y una etapa que todavia no vence no aparece.
    assert.deepEqual(
        dueSteps(campaign, new Date("2026-09-01T10:00:00.000Z"))
            .map(item => item.index),
        [0]
    );
});

test("con mas de 72 h: tercio, tercio y masiva cada 24 h", () => {
    const plan = buildPlan(ahora, enHoras(120));

    assert.equal(plan.path, "full");
    assert.deepEqual(
        plan.steps.map(step => [step.kind, step.third || 0, horasHasta(step.at)]),
        [["third", 1, 0], ["third", 2, 24], ["mass", 0, 48]]
    );
});

test("la alerta al supervisor sale a las 48 h, junto con la masiva", () => {
    const plan = buildPlan(ahora, enHoras(120));
    const conAlerta = plan.steps.filter(step => step.alert);

    assert.equal(conAlerta.length, 1);
    assert.equal(conAlerta[0].kind, "mass");
    assert.equal(horasHasta(conAlerta[0].at), 48);
});

test("con 72 h justas todavia no alcanza para los tercios", () => {
    // "mas de 72 horas" es estricto: a las 72 clavadas el ultimo tramo se
    // comeria el turno entero.
    assert.equal(buildPlan(ahora, enHoras(72)).path, "short");
    assert.equal(buildPlan(ahora, enHoras(72.5)).path, "full");
});

test("con menos de 72 h se entra directo en la masiva", () => {
    const plan = buildPlan(ahora, enHoras(48));

    assert.equal(plan.path, "short");
    assert.equal(plan.steps[0].kind, "mass");
    assert.equal(horasHasta(plan.steps[0].at), 0);
    assert.equal(plan.steps[0].alert, undefined);
});

test("en el camino corto la alerta sale a las 24 h", () => {
    const plan = buildPlan(ahora, enHoras(60));
    const alerta = plan.steps.find(step => step.alert);

    assert.equal(alerta.kind, "alert");
    assert.equal(horasHasta(alerta.at), 24);
});

test("si el turno es antes de 24 h, la alerta se adelanta a la mitad", () => {
    // Esperar las 24 h dejaria la alerta para despues del turno.
    const alerta = step => buildPlan(ahora, step).steps.find(item => item.alert);

    assert.equal(horasHasta(alerta(enHoras(10)).at), 5);
    assert.equal(horasHasta(alerta(enHoras(4)).at), 2);
});

test("la alerta nunca sale al instante, ni con el turno encima", () => {
    // Con el turno en 10 minutos, la mitad serian 5: se respeta el piso para
    // dar tiempo a que alguien conteste la masiva.
    const alerta = buildPlan(ahora, new Date(ahora.getTime() + 10 * 60000))
        .steps.find(step => step.alert);

    assert.ok(new Date(alerta.at).getTime() > ahora.getTime());
});

/* ======================================================================
   Tiempo restante en la alerta
   ====================================================================== */

test("el tiempo restante va en dias sobre 2 dias y en horas debajo", () => {
    assert.equal(formatCoverageTimeLeft(5 * 24 * HOUR), "5 días");
    assert.equal(formatCoverageTimeLeft(72 * HOUR), "3 días");
    // 48 h justas ya no son "mas de 2 dias".
    assert.equal(formatCoverageTimeLeft(48 * HOUR), "48 horas");
    assert.equal(formatCoverageTimeLeft(30 * HOUR), "30 horas");
    assert.equal(formatCoverageTimeLeft(1 * HOUR), "1 hora");
    assert.equal(formatCoverageTimeLeft(20 * 60000), "20 minutos");
    assert.equal(formatCoverageTimeLeft(-1), "El turno ya empezó");
});

test("el turno arranca a su hora de entrada, no a medianoche", () => {
    // "2026-8-5" es la clave interna: septiembre (mes 0-based) del 5.
    const noche = shiftStartInstant("2026-8-5", TURNO.NOCHE);
    const diurno = shiftStartInstant("2026-8-5", TURNO.DIURNO);

    assert.equal(noche.getHours(), 20);
    assert.equal(diurno.getHours(), 8);
    assert.equal(diurno.getDate(), 5);
    assert.equal(diurno.getMonth(), 8);
});

/* ======================================================================
   Medicion contra el mes DEL TURNO
   ====================================================================== */

test("las horas extras se miden en el mes del turno, no en el actual", () => {
    // Es el caso del requerimiento: la cobertura se gestiona los ultimos dias
    // de agosto para un turno de los primeros de septiembre. El motor arma el
    // mes desde el keyDay del turno, asi que `hhee` y `exceedsDiurnalLimit` ya
    // vienen medidos contra septiembre.
    assert.match(
        candidatos,
        /const date = new Date\(\s*\n\s*Number\(keyDay\.split\("-"\)\[0\]\),/
    );
    assert.match(
        candidatos,
        /const y = date\.getFullYear\(\);\s*\n\s*const m = date\.getMonth\(\);/
    );
    assert.match(
        candidatos,
        /calculateWorkerMonthTotals\(\s*\n\s*profile\.name,\s*\n\s*y,\s*\n\s*m,/
    );
    // Y la campaña consume esos campos ya calculados, sin volver a medir con
    // el mes en curso.
    assert.match(plan, /Number\(candidate\?\.hhee\) \|\| 0/);
});

/* ======================================================================
   Punto B: el primero que acepta se queda con el turno
   ====================================================================== */

test("aceptar caduca las solicitudes de TODAS las oleadas", () => {
    // Antes se agrupaba por groupId, y cada oleada es un grupo distinto: quien
    // aceptaba en la segunda dejaba viva la primera en los telefonos del primer
    // tercio.
    assert.match(replacements, /function requestShiftKey\(request\) \{/);
    assert.match(replacements, /\.map\(requestShiftKey\)/);
    assert.match(replacements, /requestShiftKey\(request\) === shiftKey/);
    assert.match(replacements, /target\.status = "superseded";/);
});

test("un turno se cubre una sola vez aunque acepten dos", () => {
    // El cotejo ya no exige el mismo trabajador, y convierte el turno antes de
    // comparar (el documento guarda la letra, el reemplazo el estado numerico).
    assert.match(replacements, /const winnerTurno = codeToTurno\(winner\.turno\);/);
    assert.match(
        replacements,
        /replacement\.replaced === winner\.replaced &&\s*\n\s*replacement\.date === winner\.date &&\s*\n\s*Number\(replacement\.turno\) === Number\(winnerTurno\)/
    );
});

test("al trabajador que perdio el turno le aparece como caducada", () => {
    // La PWA descartaba las solicitudes "superseded", asi que desaparecian de
    // su pantalla sin explicacion.
    if (!pwa) return;

    assert.match(pwa, /"canceled", "expired", "superseded"\]\.includes\(status\)/);
    assert.match(pwa, /if \(status === "superseded"\) return "Caducada";/);
});

/* ======================================================================
   Punto D: la alerta al supervisor
   ====================================================================== */

test("la alerta es sonora y usa el mismo canal que las tareas del inicio", () => {
    assert.match(main, /addEventListener\("proturnos:autoCoverageAlert"/);
    assert.match(main, /fireHomeAlert\(/);
});

test("el recuadro trae el turno, el tiempo restante y sus dos botones", () => {
    assert.match(home, /function coverageAlertCardHTML\(alert\)/);
    assert.match(home, /formatCoverageTimeLeft\(alert\.msLeft\)/);
    assert.match(home, /Queda <b>\$\{esc\(left\)\}<\/b> para cubrirlo/);
    assert.match(home, /data-hm="cobalert-ver"[\s\S]{0,200}>VER EN CALENDARIO</);
    assert.match(home, /data-hm="cobalert-who"[\s\S]{0,160}>VER QUIÉNES RECIBIERON LA SOLICITUD</);
});

test("ver en calendario reusa el salto que ya existia", () => {
    assert.match(
        home,
        /proturnos:viewWorkerRequestInCalendar[\s\S]{0,220}profile: button\.dataset\.cobProfile[\s\S]{0,80}date: button\.dataset\.cobIso/
    );
    assert.match(main, /addEventListener\(\s*\n\s*"proturnos:viewWorkerRequestInCalendar"/);
});

test("ver quienes recibieron la solicitud lista cada oleada", () => {
    assert.match(home, /function openCoverageRecipients\(panel, campaignId\)/);
    assert.match(home, /getCampaignRecipients\(campaignId\)/);
    assert.match(home, /Etapa \$\{wave\.stage\}/);
    assert.match(autoCoverage, /export function getCampaignRecipients\(campaignId\)/);
    assert.match(autoCoverage, /label: stageLabel\(step\)/);
});

/* ======================================================================
   Cierre de la campaña
   ====================================================================== */

test("cubrir el turno o marcarlo sin cobertura caduca lo pendiente", () => {
    // La misma comprobacion en los dos lados: el navegador cierra al toque para
    // que la tarjeta no quede mostrando algo resuelto, y el servidor cierra
    // aunque nadie tenga la pagina abierta.
    [autoCoverage, serverAuto].forEach(source => {
        assert.match(source, /export function shiftStillNeedsCoverage\(replaced, keyDay\)/);
        assert.match(source, /isNoCoverageDay\(replaced, keyDay\)\) return false;/);
        // Cubierto ENTERO: con la jornada recortada de quien cubre quedan horas
        // sin nadie y la campaña no puede cerrarse (ver js/shiftCoverage.js).
        assert.match(source, /coveredShiftIsFullyCovered\(replaced, keyDay\)\) return false;/);
        assert.match(source, /getPreassignmentForCoveredShift\(replaced, keyDay\)\) return false;/);
    });

    // Y al cerrar, las que siguen vivas pasan a "expired" (caducada en la PWA).
    assert.match(autoCoverage, /status: "expired",/);
    assert.match(scheduler, /status: "expired",/);
    assert.match(autoCoverage, /closeCampaign\(campaign, "covered"\)/);
    assert.match(scheduler, /return close\("covered"\);/);
});

test("el turno que ya empezo cierra la campaña", () => {
    assert.match(autoCoverage, /closeCampaign\(campaign, "past"\)/);
    assert.match(scheduler, /return close\("past"\);/);
});

/* ======================================================================
   Puesta en marcha y estado del boton
   ====================================================================== */

test("el navegador escucha las campañas del servidor", () => {
    assert.match(main, /startFirebaseAutoCoverageSync\(workspace/);
    assert.match(main, /stopFirebaseAutoCoverageSync\(\);/);
    // Y el barrido de cierre sigue corriendo a nivel de sesion, no de vista.
    assert.match(main, /startAutoCoverageScheduler\(\);/);
    assert.match(main, /stopAutoCoverageScheduler\(\);/);
});

test("el reloj de las etapas es una Cloud Function, no el navegador", () => {
    // Es el punto del requerimiento: las etapas son de 24 h y tienen que
    // avanzar aunque nadie tenga la aplicacion abierta.
    assert.match(functionsIndex, /exports\.advanceAutoCoverage = onSchedule\(/);
    assert.match(functionsIndex, /schedule: "every 15 minutes"/);
    assert.match(functionsIndex, /advanceAutoCoverageCampaigns\(\{/);
    // Y el navegador ya no las avanza: su barrido solo cierra.
    assert.doesNotMatch(autoCoverage, /runStep\(campaign, steps\[last/);
    assert.match(
        autoCoverage,
        /Barrido de cierre\. NO avanza etapas/
    );
});

test("el servidor corre el MISMO motor de candidatos que el navegador", () => {
    // Duplicar las reglas habria sido peor que moverlas: el 24 invertido, la
    // adyacencia de 24 y el tope diurno tienen que dar identico en los dos
    // lados, o el servidor le ofreceria un turno que el navegador le niega.
    assert.match(serverAuto, /from "\.\/replacementCandidates\.js"/);
    assert.match(serverAuto, /buildReplacementCandidates\(replaced, keyDay/);
    assert.match(serverAuto, /from "\.\/autoCoveragePlan\.js"/);
    assert.match(serverAuto, /selectStageTargets\(/);
    // Y se empaqueta con el resto del motor del servidor.
    assert.match(scheduler, /engine", "autoCoverage\.mjs"/);
});

test("la cobertura automatica usa el motor real de candidatos", () => {
    // NO la heuristica del inicio: mandar solicitudes con una lista aproximada
    // seria peor que no mandarlas.
    assert.match(calendar, /setAutoCoverageCandidateProvider\(async \(profileName, keyDay\) => \{/);
    assert.match(calendar, /await getReplacementCandidates\(profileName, keyDay\)/);
    assert.match(calendar, /getReplacementNeededTurn\(profileName, keyDay\)/);
    assert.doesNotMatch(
        calendar.slice(calendar.indexOf("setAutoCoverageCandidateProvider")),
        /getAvailableCandidates/
    );
});

test("crea las solicitudes con el mismo contrato que el cuadro", () => {
    // Los dos lados arman la solicitud con el MISMO helper: por eso el
    // documento que escribe el servidor sale identico, campo por campo, al que
    // escribe el navegador.
    [autoCoverage, serverAuto].forEach(source => {
        assert.match(source, /createReplacementRequests\(/);
        assert.match(source, /source: "replacement_request"/);
        // La cobertura diurno-larga viaja por trabajador, como en el cuadro.
        assert.match(source, /diurnoLongCoverageWorkers: targets/);
        assert.match(source, /workerCoverage: Object\.fromEntries\(/);
        // No se duplica una solicitud ya pendiente...
        assert.match(source, /getPendingReplacementRequestsForShift\(/);
        // ...y solo va a quien tiene la app enlazada para recibirla.
        assert.match(source, /hasApp: name => Boolean\(getWorkerAppLinkForProfile\(name\)\)/);
    });

    // El descarte por pendiente y por app vive en la seleccion compartida.
    assert.match(plan, /!pending\.has\(candidate\.profile\.name\)/);
    assert.match(plan, /hasApp\(candidate\.profile\.name\)/);
});

test("respeta la configuracion del entorno", () => {
    assert.match(
        autoCoverage,
        /getReplacementRequestConfig\(\)\.enableWorkerAcceptanceRequest === false/
    );
    assert.match(autoCoverage, /return \{ status: "disabled" \};/);
});

test("el boton no arranca dos campañas para el mismo turno", () => {
    assert.match(autoCoverage, /if \(getActiveCampaignForShift\(name, keyDay\)\) \{/);
    assert.match(autoCoverage, /return \{ status: "already-running" \};/);
    // Y en la tarjeta queda deshabilitado mientras la campaña sigue viva, aunque
    // en ese momento no haya ninguna solicitud pendiente (entre el vencimiento
    // de una oleada y el envio de la siguiente pasan horas).
    assert.match(home, /"COBERTURA EN CURSO"/);
    assert.match(home, /const campaign = kind === "sincubrir" \? \(item\.campaign \|\| null\) : null;/);
});

test("el boton se bloquea mientras envia", () => {
    // Sin esto un doble click mandaba dos veces la misma solicitud.
    assert.match(home, /button\.disabled = true;\s*\n\s*button\.textContent = "ENVIANDO\.\.\.";/);
    assert.match(home, /finally \{\s*\n\s*button\.disabled = false;/);
});

test("las campañas viven en su propia coleccion, no en el estado compartido", async () => {
    // Quien hace avanzar las etapas es el servidor. Si la campaña viajara
    // dentro de la foto del modulo `requests`, cualquier navegador con una copia
    // de hace un rato la devolveria a la etapa anterior al subir la suya.
    const sync = await read("../js/firebaseAutoCoverage.js");
    const persistence = await read("../js/persistence.js");
    const modules = await read("../js/firebaseStateModules.js");

    assert.match(sync, /"autoCoverageCampaigns"/);
    assert.match(persistence, /"autoCoverageCampaigns"/);
    assert.doesNotMatch(modules, /autoCoverageCampaigns/);

    // Y al fusionar gana la version mas adelantada: una campaña solo avanza.
    const { mergeRemoteCampaign } = await import("../js/firebaseAutoCoverage.js");
    const abierta = { id: "a", status: "active", steps: [{ ranAt: "" }] };
    const avanzada = { id: "a", status: "active", steps: [{ ranAt: "x" }] };
    const cerrada = { id: "a", status: "covered", steps: [] };

    assert.equal(mergeRemoteCampaign(abierta, avanzada), avanzada);
    assert.equal(mergeRemoteCampaign(avanzada, abierta), avanzada);
    assert.equal(mergeRemoteCampaign(cerrada, abierta), cerrada);
    assert.equal(mergeRemoteCampaign(abierta, cerrada), cerrada);
});

test("una oleada se reserva antes de salir", () => {
    // Sin la reserva, dos barridos solapados -o el navegador arrancando la
    // campaña justo cuando pasa el del servidor- mandarian la misma oleada dos
    // veces a los mismos telefonos.
    assert.match(scheduler, /async function claimCampaign\(db, ref, now\)/);
    assert.match(scheduler, /db\.runTransaction\(async \(tx\) => \{/);
    assert.match(scheduler, /if \(leaseIsLive\(data, now\)\) return null;/);
    assert.match(scheduler, /leaseOwner: "server"/);
    // El navegador nace con la reserva tomada y la suelta al terminar.
    assert.match(autoCoverage, /leaseOwner: "browser"/);
    assert.match(autoCoverage, /Se suelta la reserva/);
});

test("la alerta del servidor tambien suena en el navegador", () => {
    // La levanta el servidor, asi que el sonido se dispara al RECIBIRLA: es el
    // unico momento en que el navegador se entera.
    assert.match(autoCoverage, /export function applyRemoteAutoCoverageCampaigns/);
    assert.match(autoCoverage, /!alertedBefore\.has\(campaign\.id\)/);
    assert.match(autoCoverage, /"proturnos:autoCoverageAlert"/);
    assert.match(main, /addEventListener\("proturnos:autoCoverageAlert"/);
});
