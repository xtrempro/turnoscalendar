// El modal de sugerencias de reemplazo no se abria a veces:
// "Uncaught (in promise) Error: La tarea SEARCH_REPLACEMENTS excedio 15000 ms".
//
// El calendario le pedia al Web Worker solo ORDENAR los candidatos ya
// calculados, con un limite de 15 s de reloj. Con la pagina ocupada, la
// respuesta llegaba detras del temporizador vencido y la busqueda se daba por
// fallida; el error no se capturaba y el modal quedaba sin abrir y sin aviso.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sortPreparedReplacementCandidates } from "../js/replacementCandidateOrder.js";
import { searchReplacements } from "../js/workers/scheduleWorker.js";

const calendar = await readFile(new URL("../js/calendar.js", import.meta.url), "utf8");

const CANDIDATOS = [
    { profile: { name: "Carla" }, isFree: false, hhee: 2 },
    { profile: { name: "Ana" }, isFree: true, hhee: 5, nextDayMorningShift: true },
    { profile: { name: "Beto" }, isFree: true, hhee: 1 },
    { profile: { name: "Dani" }, isFree: true, hhee: 0, exceedsDiurnalLimit: true },
    { profile: { name: "Eva" }, isFree: true, hhee: 9, contingencyPriority: true }
];

test("el calendario ordena sin el worker ni su limite de tiempo", () => {
    assert.doesNotMatch(calendar, /searchReplacementsInWorker/);
    assert.match(calendar, /sortPreparedReplacementCandidates\(built\.candidates\)/);
});

test("el orden es el mismo que el del worker", () => {
    const aqui = sortPreparedReplacementCandidates(CANDIDATOS).map(item => item.profile.name);
    const worker = searchReplacements({ mode: "turnoplus-prepared", candidates: CANDIDATOS })
        .candidates.map(item => item.profile.name);

    assert.deepEqual(aqui, worker);
    // Contingencia primero; al fondo quien sigue sin dormir y, ultimo, quien
    // pasaria el tope de horas diurnas.
    assert.deepEqual(aqui, ["Eva", "Beto", "Carla", "Ana", "Dani"]);
});

test("un error al calcular avisa y no deja el modal a medias", () => {
    assert.match(
        calendar,
        /catch \(error\) \{\s*console\.warn\("No se pudieron calcular las sugerencias de reemplazo\.", error\);\s*alert\(/
    );
    assert.match(calendar, /if \(!backdrop\.innerHTML\.trim\(\)\) \{\s*document\.removeEventListener\("keydown", onKeydown\);\s*backdrop\.remove\(\);/);
});
