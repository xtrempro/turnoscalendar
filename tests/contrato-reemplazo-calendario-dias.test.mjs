// Lo que cada dia del calendario del cuadro de contrato le dice al supervisor.
//
// El cuadro se rediseño para que de un vistazo se vea cuanto del contrato queda
// cubierto. Eso necesita CUATRO estados distintos, no uno:
//
//   Contrato vigente  el contrato anterior del reemplazante
//   Heredado          el nuevo contrato toma el turno del ausente
//   Sin cubrir        no se pudo heredar; lleva el "!" y se cubre aparte
//   Contrato nuevo    dentro del contrato, pero sin turno que heredar
//
// Antes los tres ultimos decian todos "Nuevo Contrato", asi que el calendario
// no distinguia un dia cubierto de uno que iba a quedar sin nadie.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = (await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/** El cuerpo de una funcion flecha asignada a una constante. */
function cuerpoFlecha(nombre) {
    const start = main.indexOf(`const ${nombre} = (`);

    assert.notEqual(start, -1, `no se encontro: ${nombre}`);

    const open = main.indexOf("{", main.indexOf("=>", start));
    let depth = 0;
    let end = open;

    for (; end < main.length; end += 1) {
        if (main[end] === "{") depth += 1;
        else if (main[end] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    return main.slice(start, end + 1);
}

const diaCalendarioHTML = new Function(
    "escapeHTML",
    `${cuerpoFlecha("diaCalendarioHTML")}\nreturn diaCalendarioHTML;`
)(valor => String(valor));

/* =========================================================
   Los cuatro estados
========================================================= */

test("un dia que hereda el turno dice Heredado", () => {
    const html = diaCalendarioHTML({
        isNewReplacementContractDay: true,
        estado: "heredado",
        stateTurnLabel: "Noche"
    });

    assert.match(html, /contract-day-label--inherited/);
    assert.match(html, /Heredado/);
    assert.doesNotMatch(html, /Contrato nuevo/);
});

test("un dia que NO se pudo heredar dice Sin cubrir", () => {
    // Es el del "!": el supervisor tiene que poder verlo sin abrirlo.
    const html = diaCalendarioHTML({
        isNewReplacementContractDay: true,
        estado: "pendiente",
        stateTurnLabel: "Noche"
    });

    assert.match(html, /contract-day-label--pending/);
    assert.match(html, /Sin cubrir/);
});

test("un dia del contrato sin turno que heredar dice Contrato nuevo", () => {
    const html = diaCalendarioHTML({
        isNewReplacementContractDay: true,
        estado: "",
        stateTurnLabel: ""
    });

    assert.match(html, /contract-day-label--new/);
    assert.match(html, /Contrato nuevo/);
});

test("y un dia del contrato anterior dice Contrato vigente", () => {
    const html = diaCalendarioHTML({
        isNewReplacementContractDay: false,
        existingContract: { start: "2027-02-01", end: "2027-02-15" },
        estado: "",
        stateTurnLabel: "Larga"
    });

    assert.match(html, /contract-day-label--current/);
    assert.match(html, /Contrato vigente/);
});

/* =========================================================
   El turno que se muestra
========================================================= */

test("el contrato anterior TAMBIEN muestra su turno", () => {
    // Es lo que hace entender por que un dia del traslape no se puede heredar:
    // sin ver que el reemplazante ya tenia Noche, el "!" no se explica.
    const html = diaCalendarioHTML({
        isNewReplacementContractDay: false,
        existingContract: { start: "2027-02-01", end: "2027-02-15" },
        estado: "",
        stateTurnLabel: "Noche"
    });

    assert.match(html, /replacement-contract-preview-turn/);
    assert.match(html, /Noche/);
});

test("en modo libre no se pinta turno, que no hay ninguno", () => {
    const html = diaCalendarioHTML({
        isNewReplacementContractDay: true,
        estado: "",
        stateTurnLabel: "Larga",
        libre: true
    });

    assert.doesNotMatch(html, /replacement-contract-preview-turn/);
    assert.match(html, /Contrato nuevo/);
});

test("un dia sin turno no pinta un chip vacio", () => {
    const html = diaCalendarioHTML({
        isNewReplacementContractDay: true,
        estado: "heredado",
        stateTurnLabel: ""
    });

    assert.doesNotMatch(html, /replacement-contract-preview-turn/);
});

test("fuera del contrato y sin contrato anterior, el dia va limpio", () => {
    assert.equal(
        diaCalendarioHTML({
            isNewReplacementContractDay: false,
            estado: "",
            stateTurnLabel: "Larga"
        }),
        ""
    );
});

/* =========================================================
   El turno de un dia pendiente es el PROPIO, no el del ausente
========================================================= */

test("la previsualizacion manda sobre el turno del reemplazado", () => {
    // `getModalPreviewTurn` devolvia SIEMPRE `getTurnoBase(contractReplaces)`.
    // En un dia pendiente eso pinta el turno que justamente NO se puede
    // aplicar: el calendario mostraba un turno que nadie iba a hacer.
    const cuerpo = cuerpoFlecha("getModalPreviewTurn");
    const consulta = cuerpo.indexOf("inheritPreview?.dias?.find(");
    const respaldo = cuerpo.indexOf("getTurnoBase(state.contractReplaces, key)");

    assert.notEqual(consulta, -1, "ya no se consulta la previsualizacion");
    assert.notEqual(respaldo, -1, "se perdio el respaldo para los demas dias");
    assert.ok(
        consulta < respaldo,
        "se consulta al reemplazado ANTES que a la previsualizacion"
    );
    assert.match(cuerpo, /if \(previo\) return previo\.turno;/);
});
