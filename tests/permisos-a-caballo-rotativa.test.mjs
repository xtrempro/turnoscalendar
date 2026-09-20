// Un permiso partido por un cambio de rotativa.
//
// Cambiar la rotativa reescribe el calendario desde una fecha, y arrastraba
// consigo TODOS los permisos posteriores. Si el trabajador tenia 10 feriados
// legales y la rotativa nueva empezaba en el quinto, quedaban 4 dias sueltos y
// al saldo volvian 6: un permiso mutilado que nadie pidio partir.
//
// Ahora un bloque a caballo se conserva entero, y las licencias medicas no se
// tocan nunca. Con la clave conservada, requiereReemplazoTurnoBase vuelve a
// pedir cobertura sobre el turno NUEVO y el "!" aparece solo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
    protectedLeaveKeys,
    PROTECTED_ABSENCE_TYPES
} = await import("../js/leaveProtection.js");

// Las claves internas son `YYYY-M-D` con el mes en base 0.
const dic = day => `2026-11-${day}`;
const CAMBIO = new Date(2026, 11, 15);

/** Un mapa de permisos con el mismo valor en cada dia. */
const dias = (days, value = 1) => Object.fromEntries(
    days.map(day => [dic(day), value])
);

const ordenar = set => [...set].sort();

/* =========================================================
   El bloque a caballo se conserva ENTERO
========================================================= */

test("un bloque que cruza la fecha se conserva completo", () => {
    // Del 7 al 21, con la rotativa nueva empezando el 15.
    const legal = dias([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    const { legal: keys } = protectedLeaveKeys({ legal }, CAMBIO);

    assert.equal(keys.size, 15);
    // Tambien los dias ANTERIORES al cambio: el bloque es uno solo.
    assert.ok(keys.has(dic(7)));
    assert.ok(keys.has(dic(14)));
    assert.ok(keys.has(dic(21)));
});

test("un bloque que empieza DESPUES se sobreescribe", () => {
    const legal = dias([20, 21, 22, 23]);

    assert.equal(protectedLeaveKeys({ legal }, CAMBIO).legal.size, 0);
});

test("un bloque que empieza JUSTO en la fecha tambien se sobreescribe", () => {
    // Cae entero bajo la rotativa nueva, asi que se rehace con ella.
    const legal = dias([15, 16, 17]);

    assert.equal(protectedLeaveKeys({ legal }, CAMBIO).legal.size, 0);
});

test("un bloque que termina antes no se protege", () => {
    const comp = dias([1, 2, 3, 4, 5]);

    assert.equal(protectedLeaveKeys({ comp }, CAMBIO).comp.size, 0);
});

test("un hueco corta el bloque: ya no cruza", () => {
    // 13 y 14 antes, 16 y 17 despues, pero el 15 no esta: son dos bloques
    // distintos y ninguno cruza la fecha.
    const admin = dias([13, 14, 16, 17]);

    assert.equal(protectedLeaveKeys({ admin }, CAMBIO).admin.size, 0);
});

/* =========================================================
   Cada permiso lleva SU conjunto
========================================================= */

test("cada tipo de permiso arma su propio bloque", () => {
    // El administrativo cruza; el compensatorio va entero despues.
    const admin = dias([14, 15]);
    const comp = dias([18, 19]);
    const kept = protectedLeaveKeys({ admin, comp }, CAMBIO);

    assert.deepEqual(ordenar(kept.admin), [dic(14), dic(15)].sort());
    assert.equal(kept.comp.size, 0);
});

test("una licencia NO protege otro permiso del mismo dia", () => {
    // Con un unico conjunto de fechas compartido, la licencia del dia 20
    // impedia borrar el administrativo del MISMO dia 20: la proteccion de un
    // permiso se contagiaba a los otros tres.
    const absences = dias([20], { type: "license" });
    const admin = dias([20]);
    const kept = protectedLeaveKeys({ admin, absences }, CAMBIO);

    assert.equal(kept.absences.size, 1);
    assert.equal(kept.admin.size, 0);
});

/* =========================================================
   Las licencias no se tocan nunca
========================================================= */

test("una licencia medica posterior se conserva igual", () => {
    const absences = dias([20, 21, 22], { type: "license" });

    assert.equal(protectedLeaveKeys({ absences }, CAMBIO).absences.size, 3);
});

test("la LM Profesional tambien", () => {
    const absences = dias([25], { type: "professional_license" });

    assert.equal(protectedLeaveKeys({ absences }, CAMBIO).absences.size, 1);
});

test("pero el resto de las ausencias si se sobreescribe", () => {
    const absences = dias([20, 21], { type: "union_leave" });

    assert.equal(protectedLeaveKeys({ absences }, CAMBIO).absences.size, 0);
});

test("una ausencia comun que CRUZA la fecha se conserva igual", () => {
    // Por la regla del bloque a caballo, no por ser licencia.
    const absences = dias([14, 15, 16], { type: "union_leave" });

    assert.equal(protectedLeaveKeys({ absences }, CAMBIO).absences.size, 3);
});

test("dos tipos pegados no forman un bloque comun", () => {
    // El gremial del 13-14 no hereda la proteccion de la licencia del 15-16.
    const absences = {
        ...dias([13, 14], { type: "union_leave" }),
        ...dias([15, 16], { type: "license" })
    };
    const { absences: keys } = protectedLeaveKeys({ absences }, CAMBIO);

    assert.deepEqual(ordenar(keys), [dic(15), dic(16)].sort());
});

test("la ausencia guardada como texto tambien se reconoce", () => {
    // El mapa acepta texto u objeto segun quien la haya escrito.
    const absences = dias([20], "license");

    assert.equal(protectedLeaveKeys({ absences }, CAMBIO).absences.size, 1);
});

/* =========================================================
   Bordes
========================================================= */

test("sin permisos no hay nada que conservar", () => {
    assert.deepEqual(protectedLeaveKeys({}, CAMBIO), {});
    assert.deepEqual(protectedLeaveKeys(null, CAMBIO), {});
});

test("cada mapa pedido vuelve con su conjunto, aunque este vacio", () => {
    // Quien llama hace `kept[name].has(...)` sin preguntar: si faltara la
    // entrada, reventaria justo en el camino que borra datos.
    const kept = protectedLeaveKeys(
        { admin: {}, legal: {}, comp: {}, absences: {} },
        CAMBIO
    );

    ["admin", "legal", "comp", "absences"].forEach(name => {
        assert.ok(kept[name] instanceof Set, `falta el conjunto: ${name}`);
    });
});

test("las licencias protegidas son exactamente dos", () => {
    // Si alguien agrega un tipo aqui, que sea a proposito: todo lo demas lo
    // puede rehacer el supervisor.
    assert.deepEqual(
        [...PROTECTED_ABSENCE_TYPES].sort(),
        ["license", "professional_license"]
    );
});

/* =========================================================
   El boton "Modificar rotativa" comparte las reglas
=========================================================

   Se puede cambiar de rotativa por dos caminos: arrastrando la tarjeta en
   Titulares y con el boton del calendario. Los dos terminan en
   cleanupFutureSchedule, asi que las protecciones de arriba ya valian para
   ambos; lo que NO compartian era el aviso. El boton del calendario solo
   decia algo cuando habia otra rotativa por delante: en el caso normal
   reescribia el calendario sin advertir nada.

   main.js no se puede importar desde las pruebas, asi que esto se fija sobre
   el texto. */

const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

test("el boton del calendario avisa antes de reescribir", async () => {
    assert.match(
        main,
        /!await confirmRotationOverwrite\(profile\.name, fecha\)/
    );
});

test("y usa el MISMO recuento del tablero, no uno propio", async () => {
    // Si se reimplementara aqui, el aviso y el del tablero podrian separarse.
    assert.match(
        main,
        /const perdidas = countAffectedFrom\(profileName, startDate, holidays\);/
    );
    // Lo que importa es que SALGAN de shiftHolders.js, no en que orden estan
    // dentro del import: fijar la posicion rompia la prueba en cuanto alguien
    // agregaba otro nombre al bloque, sin que nada estuviera mal.
    const importBlock = main.slice(
        main.indexOf("import {", main.indexOf('} from "./shiftHolders.js";') - 400),
        main.indexOf('} from "./shiftHolders.js";')
    );

    assert.match(importBlock, /countAffectedFrom,/);
    assert.match(importBlock, /loadLeaveHolidays,/);

    const holders = await readFile(
        new URL("../js/shiftHolders.js", import.meta.url),
        "utf8"
    );

    assert.match(holders, /export async function loadLeaveHolidays\(profileName\)/);
});

test("en modo 'aplicar hasta' NO se muestra el recuento", () => {
    // Ahi el cambio va acotado por una fecha final, y contar hacia adelante
    // sin tope exageraria la perdida.
    assert.match(
        main,
        /overlapDecision\.mode !== "limit" &&\s*\n\s*!await confirmRotationOverwrite/
    );
});

test("cancelar conserva el modo de seleccion", () => {
    // El `return` va ANTES de clearSelectionMode: asi se puede elegir otra
    // fecha sin tener que volver a entrar al menu.
    assert.match(
        main,
        /!await confirmRotationOverwrite\(profile\.name, fecha\)\s*\n\s*\) \{\s*\n\s*return;\s*\n\s*\}\s*\n+\s*pendingRotationChange = null;\s*\n\s*clearSelectionMode\(false\);/
    );
});

test("el dialogo de solapamiento ya no promete borrar las licencias", () => {
    // Su nota decia que se anulan "permisos y ausencias de ese tramo", que
    // desde el cambio anterior es falso.
    assert.match(
        main,
        /salvo las licencias médicas y los permisos que ya venían/
    );
    assert.doesNotMatch(main, /ausencias de ese tramo; o aplicarla/);
});
