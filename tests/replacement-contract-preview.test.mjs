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
const styles = await readFile(
    new URL("../styles.css", import.meta.url),
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

test("un permiso preseleccionado igual carga fechas para pintar el calendario", () => {
    assert.match(
        source,
        /state\.contractLeaveRef !==\s*resolvedReplacementSelection\.leaveOption\.id[\s\S]{0,260}state\.contractStart !==\s*resolvedReplacementSelection\.leaveOption\.start[\s\S]{0,180}state\.contractEnd !==\s*resolvedReplacementSelection\.leaveOption\.end/
    );
});

test("el mini calendario muestra el turno heredado junto al contrato", () => {
    assert.match(
        source,
        /replacement-contract-preview-turn/
    );
    assert.match(
        styles,
        /\.profile-mini-day \.replacement-contract-preview-turn/
    );
});

test("el modal ofrece la modalidad de diurno puente con selector de trabajador", () => {
    assert.match(
        source,
        /REPLACEMENT_ROTATION_MODE\.DIURNO_BRIDGE/
    );
    assert.match(
        source,
        /data-contract-bridge-profile/
    );
    assert.match(
        source,
        /getDiurnoBridgeCandidatesForProfile/
    );
});
