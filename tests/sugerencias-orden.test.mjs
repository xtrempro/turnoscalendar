// Orden de las sugerencias de reemplazo.
//
// Dos grupos van al FINAL de la lista, porque aceptarles el turno tiene un
// costo que el supervisor deberia ver como ultima opcion:
//
//   - Tarjeta amarilla: al dia siguiente tienen turno, asi que trabajarian de
//     noche y seguirian sin dormir.
//   - Sobre el tope: aceptar los dejaria por encima de las 40 horas extras
//     diurnas del mes, que despues no se les puede pagar. Estos van todavia
//     mas abajo que los amarillos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { searchReplacements } = await import("../js/workers/scheduleWorker.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");

const candidato = (name, extra = {}) => ({
    profile: { name },
    isFree: true,
    replacementPriority: 10,
    hhee: 0,
    ...extra
});

function ordenar(candidates) {
    return searchReplacements({ mode: "turnoplus-prepared", candidates })
        .candidates
        .map(candidate => candidate.profile.name);
}

/* =========================================================
   El orden
========================================================= */

test("los de tarjeta amarilla quedan al final", () => {
    assert.deepEqual(
        ordenar([
            candidato("Amanda", { nextDayMorningShift: 1 }),
            candidato("Bruno"),
            candidato("Carla", { nextDayMorningShift: 1 }),
            candidato("Diego")
        ]),
        ["Bruno", "Diego", "Amanda", "Carla"]
    );
});

test("los que se pasan del tope quedan aun mas abajo", () => {
    assert.deepEqual(
        ordenar([
            candidato("Amarilla", { nextDayMorningShift: 1 }),
            candidato("Pasada", { exceedsDiurnalLimit: true }),
            candidato("Normal")
        ]),
        ["Normal", "Amarilla", "Pasada"]
    );
});

test("quien junta las dos cosas es el ultimo de todos", () => {
    assert.deepEqual(
        ordenar([
            candidato("Ambas", {
                nextDayMorningShift: 1,
                exceedsDiurnalLimit: true
            }),
            candidato("SoloPasada", { exceedsDiurnalLimit: true }),
            candidato("SoloAmarilla", { nextDayMorningShift: 1 }),
            candidato("Normal")
        ]).slice(0, 2),
        ["Normal", "SoloAmarilla"]
    );
});

test("el tope manda sobre el resto de los criterios", () => {
    // Aunque tenga la mejor rotativa y cero horas extras, si se pasa del tope
    // va abajo: no sirve ofrecerle un turno que despues no se le puede pagar.
    assert.deepEqual(
        ordenar([
            candidato("Mejor", {
                replacementPriority: 1,
                exceedsDiurnalLimit: true
            }),
            candidato("Peor", { replacementPriority: 99 })
        ]),
        ["Peor", "Mejor"]
    );
});

test("entre iguales se conserva el orden de siempre", () => {
    // Sin banderas nuevas, el criterio previo -libre, rotativa, horas extras,
    // nombre- no cambia.
    assert.deepEqual(
        ordenar([
            candidato("Zoe", { replacementPriority: 3 }),
            candidato("Ana", { replacementPriority: 1 }),
            candidato("Beto", { replacementPriority: 2 })
        ]),
        ["Ana", "Beto", "Zoe"]
    );
});

test("los dos criterios nuevos se comparan primero", async () => {
    // Si fueran los ultimos desempates, casi nunca se aplicarian.
    // El orden vive en replacementCandidateOrder.js (calendario y worker).
    const sort = await read("../js/replacementCandidateOrder.js");

    assert.ok(
        sort.indexOf("exceedsDiurnalLimit") <
        sort.indexOf("nextDayMorningShift"),
        "el tope se compara antes que la tarjeta amarilla"
    );
    assert.ok(
        sort.indexOf("nextDayMorningShift") <
        sort.indexOf("isDiurnoLongCoverage"),
        "la tarjeta amarilla se compara antes que el resto"
    );
});

/* =========================================================
   Que el dato llegue
========================================================= */

test("el candidato viaja con la bandera del tope ya calculada", async () => {
    // El worker que ordena no tiene la fecha ni los feriados para resolverlo,
    // asi que se calcula al armar el candidato.
    const candidatos = (await readFile(
        new URL("../js/replacementCandidates.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(
        candidatos,
        /exceedsDiurnalLimit: exceedsDiurnalOvertimeLimit\(\s*\n\s*\{ overtimeHours, hheeDiurnas \},\s*\n\s*date,\s*\n\s*neededTurn,\s*\n\s*holidays\s*\n\s*\)/
    );
});

test("se usa el MISMO tope que la cobertura automatica", async () => {
    // Si fueran dos reglas distintas, la lista podria ofrecer a alguien a quien
    // el envio masivo deja fuera. La bandera se calcula una sola vez, al armar
    // el candidato, y la campaña por etapas consume esa misma.
    const candidatos = (await readFile(
        new URL("../js/replacementCandidates.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(candidatos, /export function exceedsDiurnalOvertimeLimit/);

    const plan = (await readFile(
        new URL("../js/autoCoveragePlan.js", import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");

    assert.match(plan, /!candidate\.exceedsDiurnalLimit/);
});

test("la tarjeta dice por que quedo al final", () => {
    assert.match(calendar, /Superaria las \$\{MAX_MONTHLY_DIURNAL_OVERTIME\} h extras diurnas del mes/);
    assert.match(calendar, /replacement-candidate--over-limit/);
});
