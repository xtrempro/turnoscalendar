// "Adjuntar registro" del inicio.
//
// 2026-09-28: el boton del inicio apretaba el input de Reportes, pero ese input
// solo se conectaba al pintar Reportes. Sin haber pasado por ahi, el archivo se
// elegia y nadie lo leia. Ademas el resultado salia como un toast breve.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

test("el importador del reloj se conecta al arrancar la app", () => {
    assert.match(main, /\r?\nbindShellInteractions\(\);\r?\n[\s\S]{0,300}\r?\nbindAttendanceImport\(\);\r?\n/);
});

test("fuera de Reportes el resultado sale en una ventana con las marcas nuevas", () => {
    assert.match(main, /const enVentana = document\.body\.dataset\.activeView !== "reports";/);
    assert.match(main, /Se agregaron \$\{result\.added\} marca\(s\) nueva\(s\)\./);
    assert.match(main, /title: "Registro del reloj cargado"/);
    assert.match(main, /title: "No se pudo cargar el registro"/);
});
