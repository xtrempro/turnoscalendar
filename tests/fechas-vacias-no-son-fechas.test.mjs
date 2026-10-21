// Una fecha que no existe no puede viajar como si existiera.
//
// parseISODate("") devuelve un Date INVALIDO, y un Date invalido es truthy. Con
// la guarda `if (!date) return ""`, nextCalendarISO("") respondia
// "NaN-NaN-NaN" -una cadena con forma de fecha- y eso seguia camino.
//
// Donde se vio: al reactivar a alguien cuyo perfil quedo inactivo SIN fecha de
// salida registrada (sale asi cuando se va por un traspaso), el piso de
// limpieza de la rotativa quedaba en "NaN-NaN-NaN". Hoy no borra nada porque
// las fechas se comparan como texto y "N" cae despues de cualquier anio, pero
// eso es suerte: el mismo valor podria llegar a un rango de limpieza real.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseISODate, toInputDate } from "../js/dateUtils.js";

const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

function extraer(nombre) {
    const inicio = main.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    let profundidad = 0;

    for (let i = main.indexOf("{", inicio); i < main.length; i += 1) {
        if (main[i] === "{") profundidad += 1;
        else if (main[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return main.slice(inicio, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

function montar(nombre) {
    return new Function(
        "parseInputDate",
        "toInputDate",
        `${extraer(nombre)}
         return ${nombre};`
    )(parseISODate, toInputDate);
}

const siguiente = montar("nextCalendarISO");
const anterior = montar("previousCalendarISO");

test("el dia de la nada es la nada, no NaN-NaN-NaN", () => {
    for (const vacio of ["", null, undefined, "   ", "sin fecha"]) {
        assert.equal(siguiente(vacio), "", `siguiente(${JSON.stringify(vacio)})`);
        assert.equal(anterior(vacio), "", `anterior(${JSON.stringify(vacio)})`);
    }
});

test("con una fecha de verdad siguen contando dias", () => {
    assert.equal(siguiente("2026-10-18"), "2026-10-19");
    assert.equal(anterior("2026-10-19"), "2026-10-18");
    // Y cruzan el mes y el anio.
    assert.equal(siguiente("2026-10-31"), "2026-11-01");
    assert.equal(anterior("2027-01-01"), "2026-12-31");
});

test("un Date invalido es truthy: por eso no basta con `if (!date)`", () => {
    // La prueba de que la guarda vieja no alcanzaba, escrita como lo que es.
    assert.equal(Boolean(parseISODate("")), true);
    assert.equal(Number.isNaN(parseISODate("").getTime()), true);
    assert.equal(toInputDate(parseISODate("")), "NaN-NaN-NaN");
});

test("el piso de limpieza al reactivar nace de esa cuenta", () => {
    // Si volviera a devolver una fecha inventada, entraria aqui.
    assert.match(
        main,
        /isReactivating\s*\n?\s*\? nextCalendarISO\(\s*\n?\s*normalizeStoredStart\(previousSnapshot\?\.unitExitDate \|\| ""\)\s*\n?\s*\)/
    );
});
