// Cambiar el TIPO de contrato rehace el calendario desde el mes de vigencia.
//
// El caso que lo destapo: un trabajador con contrato de Reemplazo -sus turnos
// los HEREDA del trabajador al que cubre- pasa a Contrato, donde los turnos
// salen de su propia rotativa. Se guardaba el cambio y el calendario seguia
// mostrando lo de antes: nadie borraba lo cargado, y `getTurnoProgramado` lee
// `data_` antes que la rotativa, asi que los dias viejos ganaban siempre.
//
// Lo unico que reescribia dias era `applyDraftRotation`, y solo corre si cambio
// la ROTATIVA (`hasRotationChanged`). Un perfil de reemplazo guarda rotativa
// vacia y sin fecha de inicio, asi que al pasarlo a Contrato no se aplicaba
// nada.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const main = await leer("../js/main.js");

// El cuerpo del guardado del perfil, para exigir que las cosas pasen AHI y no
// en cualquier parte del archivo.
function guardadoDelPerfil() {
    const inicio = main.indexOf("const contractTypeChanged =");

    assert.notEqual(inicio, -1, "no se encontro el guardado del perfil");

    return main.slice(inicio, main.indexOf("\nfunction handleAvailabilityEdit"));
}

test("al cambiar el tipo de contrato se borra desde el mes de vigencia", () => {
    const bloque = guardadoDelPerfil();

    assert.match(bloque, /if \(contractTypeChanged && compensationEffectiveDate\) \{/);
    assert.match(bloque, /contractTypeOverwriteStart = compensationEffectiveDate;/);
    assert.match(
        bloque,
        /if \(contractTypeOverwriteStart\) \{\s*\n\s*await cleanupFutureSchedule\(\s*\n\s*parseInputDate\(contractTypeOverwriteStart\)\s*\n\s*\);/
    );
});

test("la limpieza va ANTES de aplicar la rotativa", () => {
    // Al reves borraria los turnos que la rotativa acaba de escribir.
    const bloque = guardadoDelPerfil();

    assert.ok(
        bloque.indexOf("await cleanupFutureSchedule(") <
            bloque.indexOf("if (shouldApplyRotation) {"),
        "la limpieza por cambio de contrato debe correr antes que la rotativa"
    );
});

test("un cambio de grado o estamento NO borra el calendario", () => {
    // Los tres comparten la pregunta de vigencia (compensationValuesChanged),
    // pero solo el tipo de contrato cambia de donde salen los turnos.
    const bloque = guardadoDelPerfil();

    assert.match(
        bloque,
        /const compensationValuesChanged =[\s\S]{0,160}hasGradeValueChanged\(\) \|\|\s*\n\s*contractTypeChanged/
    );
    assert.doesNotMatch(
        bloque,
        /if \(compensationValuesChanged\) \{\s*\n\s*contractTypeOverwriteStart/
    );
});

test("se pide confirmacion y se puede abandonar sin guardar nada", () => {
    const bloque = guardadoDelPerfil();

    assert.match(bloque, /title: "Sobrescribir el calendario"/);
    assert.match(bloque, /destructive: true/);
    // La pregunta sale ANTES de escribir nada: se responde que no y el perfil
    // queda como estaba.
    assert.match(
        bloque,
        /if \(!confirmedOverwrite\) \{\s*\n\s*return false;\s*\n\s*\}/
    );
    assert.ok(
        bloque.indexOf("Sobrescribir el calendario") <
            bloque.indexOf("updateProfile("),
        "la confirmacion debe pedirse antes de guardar el perfil"
    );
});

test("la confirmacion dice exactamente que se borra", () => {
    const bloque = guardadoDelPerfil();

    assert.match(bloque, /turnos, permisos, feriados, licencias, devoluciones de horas/);
    assert.match(bloque, /turnos extra, cambios y traslados de turno/);
    assert.match(bloque, /Los meses anteriores/);
});

test("y avisa si el calendario va a quedar vacio", () => {
    // Pasar a un contrato sin rotativa deja el mes en blanco: decirlo antes
    // evita que parezca que el cambio volvio a no aplicarse.
    const bloque = guardadoDelPerfil();

    assert.match(bloque, /rotationGeneratesTurns\(nextRotationType\)/);
    assert.match(bloque, /El calendario quedara vacio desde ese mes/);
    assert.match(
        main,
        /function rotationGeneratesTurns\(rotationType\) \{\s*\n\s*return \["diurno", "3turno", "4turno"\]/
    );
});

test("queda registrado en la bitacora", () => {
    const bloque = guardadoDelPerfil();

    assert.match(bloque, /"Sobrescribio el calendario por cambio de contrato"/);
    assert.match(bloque, /se borro lo cargado desde el/);
});

test("se borra lo cargado, no solo los turnos", () => {
    // cleanupFutureSchedule es la misma limpieza que usa la rotativa: turnos,
    // turnos base, dias bloqueados, permisos, feriados, licencias, devoluciones
    // de horas, cambios de turno y turnos extra, devolviendo los saldos.
    const limpieza = main.slice(
        main.indexOf("async function cleanupFutureSchedule("),
        main.indexOf("async function applyDraftRotation(")
    );

    ["data", "baseData", "blocked", "admin", "legal", "comp", "absences", "hourReturns"]
        .forEach(mapa => {
            assert.match(
                limpieza,
                new RegExp(`scheduleWindowKeys\\(${mapa},`),
                `la limpieza debe alcanzar ${mapa}`
            );
        });
    assert.match(limpieza, /cleanupFutureSwaps\(/);
    assert.match(limpieza, /cancelFutureReplacementsForWorker\(/);
    assert.match(limpieza, /returnBusinessBalances\("legal", returnedLegal\)/);
});
