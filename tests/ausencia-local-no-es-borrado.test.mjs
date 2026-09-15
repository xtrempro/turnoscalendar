import assert from "node:assert/strict";
import test from "node:test";

import {
    planPartialStateEntries
} from "../js/firebasePartialState.js";

// Una clave que esta sesion no tiene en su almacenamiento local NO es un
// borrado.
//
// El 2026-09-03, a las 16:50:44Z, una sesion de Imagenologia publico la entrada
// `weekly_task_assignment_tasks` con `deleted: true` y sin `value`. No se borro
// ninguna tarea a mano -eso exige confirmacion una por una-: se publico la
// AUSENCIA de la clave. El catalogo entero desaparecio para todas las sesiones,
// y como el saneado semanal trataba las casillas sin tarea como huerfanas, de
// rebote se perdieron 298 asignaciones en cuatro semanas.
//
// Un borrado de verdad siempre viene marcado con `removed: true` desde
// removeKey(). Sin esa marca no se publica nada.

const moduleForKey = () => "tasks";

test("una clave sin valor local no se publica como borrada", () => {
    const entries = planPartialStateEntries({
        keys: ["weekly_task_assignment_tasks"],
        // Notificacion masiva ("replace"/"patch"): trae las claves pero no el
        // mapa de cambios, asi que el planificador cae a leer el local.
        changes: {},
        readRaw: () => null,
        moduleForKey
    });

    assert.deepEqual(entries, []);
});

test("un borrado explicito si se publica", () => {
    const entries = planPartialStateEntries({
        keys: ["weekly_task_assignment_tasks"],
        changes: {
            weekly_task_assignment_tasks: {
                previous: "[{\"id\":\"t1\",\"title\":\"RESONADOR\"}]",
                next: null,
                removed: true
            }
        },
        readRaw: () => null,
        moduleForKey
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].deleted, true);
    assert.equal(entries[0].storageKey, "weekly_task_assignment_tasks");
});

test("vaciar el catalogo a proposito borra sus elementos, no la clave", () => {
    // Borrar la ultima tarea desde la interfaz guarda `[]`, que es un valor
    // legitimo. Si esto se publicara como `deleted` de la clave no habria forma
    // de distinguir "no tengo la clave" de "la deje vacia".
    //
    // Desde 2026-09-15 una lista con id no viaja nunca entera (ver
    // tests/reemplazos-lista-entera.test.mjs): vaciarla borra elemento por
    // elemento lo que habia.
    const entries = planPartialStateEntries({
        keys: ["weekly_task_assignment_tasks"],
        changes: {
            weekly_task_assignment_tasks: {
                previous: "[{\"id\":\"t1\",\"title\":\"RESONADOR\"}]",
                next: "[]"
            }
        },
        readRaw: () => "[]",
        moduleForKey
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].itemKey, "t1");
    assert.equal(entries[0].deleted, true);
    assert.equal(entries[0].container, "array");
});

test("un cambio normal no se ve afectado", () => {
    const entries = planPartialStateEntries({
        keys: ["weekly_task_assignment_tasks"],
        changes: {
            weekly_task_assignment_tasks: {
                previous: "[{\"id\":\"t1\",\"title\":\"RESONADOR\"}]",
                next: "[{\"id\":\"t1\",\"title\":\"RESONADOR 2\"}]"
            }
        },
        readRaw: () => "[{\"id\":\"t1\",\"title\":\"RESONADOR 2\"}]",
        moduleForKey
    });

    assert.ok(entries.length >= 1);
    assert.ok(entries.every(entry => entry.deleted !== true));
});

test("varias claves en un evento masivo: solo viajan las que existen", () => {
    const present = "{\"2026-08-31\":{}}";
    const entries = planPartialStateEntries({
        keys: [
            "weekly_task_assignment_tasks",
            "weekly_task_assignment_entries"
        ],
        changes: {},
        readRaw: key =>
            key === "weekly_task_assignment_entries" ? present : null,
        moduleForKey
    });

    assert.ok(
        entries.every(
            entry => entry.storageKey === "weekly_task_assignment_entries"
        ),
        "la clave ausente no debe generar ninguna entrada"
    );
});
