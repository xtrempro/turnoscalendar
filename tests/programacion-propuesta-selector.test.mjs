// La propuesta de Programacion automatica: el selector "Agregar".
//
// Pedido del usuario (2026-09-15): al presionar Agregar en una casilla la
// grilla saltaba al inicio, y el menu parecia transparente.
//
//   - El salto: cada clic rehace el modal entero con innerHTML, y los
//     contenedores con scroll nacen arriba.
//   - La transparencia: el menu tiene max-height 270px, pero su lista no estaba
//     acotada; los nombres de mas se salian del fondo y quedaban encima de las
//     casillas de abajo.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(
    new URL("../js/taskAssignments.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const styles = (await readFile(
    new URL("../styles.css", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");
const dialog = source.slice(
    source.indexOf("function openTaskAutoSchedulePreviewDialog("),
    source.indexOf("async function runTaskAutoSchedule(")
);

test("redibujar la propuesta repone el scroll donde estaba", () => {
    assert.match(
        dialog,
        /const render = \(\) => \{[\s\S]*?\[node\.scrollTop, node\.scrollLeft\][\s\S]*?paint\(\);[\s\S]*?node\.scrollTop = top;\s*node\.scrollLeft = left;/
    );
    // La grilla y la lista que la contiene, que son las que scrollean.
    assert.match(dialog, /"\.task-auto-preview-list",\s*"\.task-auto-preview-grid-wrap"/);
    // El modal se sigue pintando entero, pero por dentro de render.
    assert.match(dialog, /const paint = \(\) => \{\s*const plan = currentAttempt\.plan;\s*backdrop\.innerHTML = `/);
});

test("la lista del selector solo se repone si sigue abierto el mismo", () => {
    // Abrir el de otra casilla con el scroll del anterior lo dejaria a medias.
    assert.match(dialog, /pickerKey\(\) && pickerKey\(\) === paintedPickerKey/);
    assert.match(dialog, /paint\(\);\s*paintedPickerKey = pickerKey\(\);/);
});

test("la lista del selector no se sale de su fondo", () => {
    const rule = styles.match(/\n\.task-auto-preview-picker \{[^}]*\}/)?.[0] || "";

    assert.match(rule, /max-height: 270px;/);
    assert.match(rule, /grid-template-rows: auto minmax\(0, 1fr\);/);
    assert.match(rule, /overflow: hidden;/);
    // --panel es 94% opaco: debajo va un fondo solido.
    assert.match(rule, /background: linear-gradient\(var\(--panel\), var\(--panel\)\), var\(--bg-bottom/);
});
