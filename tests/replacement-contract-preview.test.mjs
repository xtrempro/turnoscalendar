// El modal de contrato de reemplazo debe previsualizar lo mismo que se aplicara
// al guardar: heredar turnos del reemplazado, o no pintar nada si el contrato
// queda como libre.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

test("la previsualizacion hereda el turno base del reemplazado", () => {
    assert.match(
        source,
        /return getTurnoBase\(state\.contractReplaces, key\);/
    );
});

test("la previsualizacion libre no pinta turnos en el contrato nuevo", () => {
    assert.match(
        source,
        /state\.contractRotationMode ===\s*REPLACEMENT_ROTATION_MODE\.FREE[\s\S]{0,120}return TURNO\.LIBRE;/
    );
});
