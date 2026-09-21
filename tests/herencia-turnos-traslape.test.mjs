// Heredar turnos cuando el contrato se traslapa con uno anterior.
//
// Un reemplazante puede tener ya un contrato cubriendo a OTRA persona cuando se
// le crea el segundo. Dos contratos no pueden superponerse -el guardado los
// recorta con clampContractRange- y por eso el tramo traslapado no heredaba
// nada: se perdia en silencio.
//
// Pero el trabajador SI esta contratado esos dias, asi que puede tomar tambien
// el turno del segundo ausente. Lo unico que lo impide es una regla explicita
// de la unidad: hoy, que sumar los dos turnos diera un Turno 24 donde no se
// permiten. Esos dias quedan marcados con el "!" y se cubren aparte.
//
// Se prueba la DECISION, no la aritmetica de fusionar turnos ni el acceso a
// datos: esos van como dobles.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = (await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

const { TURNO } = await import("../js/constants.js");
const {
    REPLACEMENT_ROTATION_MODE,
    normalizeReplacementRotationMode
} = await import("../js/replacementRotation.js");
const {
    keyFromDate,
    parseISODate,
    toISODate
} = await import("../js/dateUtils.js");

/** El cuerpo de una funcion, saltando su lista de parametros. */
function cuerpo(nombre) {
    const start = main.indexOf("function " + nombre + "(");

    assert.notEqual(start, -1, "no se encontro: " + nombre);

    // El cuerpo empieza DESPUES de los parametros: esta funcion destructura, y
    // contar llaves desde el primer "{" se detendria en el del parametro.
    const abre = main.indexOf("(", start);
    let parens = 0;
    let cierra = abre;

    for (; cierra < main.length; cierra += 1) {
        if (main[cierra] === "(") parens += 1;
        else if (main[cierra] === ")") {
            parens -= 1;

            if (!parens) break;
        }
    }

    const open = main.indexOf("{", cierra);
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

/**
 * Arma la funcion con sus dependencias inyectadas.
 *
 * @param {object} mundo turnos del reemplazado, turnos propios, contratos y la
 *   regla del 24, cada uno como doble.
 */
function construir(mundo) {
    const llamadas = { fusiones: [] };
    const fabrica = new Function(
        "getTurnoBase",
        "getContractsForProfile",
        "turnoBloqueadoPorTurno24",
        "fusionarTurnos",
        "parseInputDate",
        "keyFromDate",
        "toISODate",
        "TURNO",
        "normalizeReplacementRotationMode",
        "REPLACEMENT_ROTATION_MODE",
        cuerpo("buildInheritedTurnPreview") +
            "\nreturn buildInheritedTurnPreview;"
    );
    const preview = fabrica(
        function (nombre, key) {
            return (mundo.turnos[nombre] || {})[key] || TURNO.LIBRE;
        },
        function () {
            return mundo.contratos || [];
        },
        function (nombre, key) {
            return (mundo.bloquea24 || []).includes(key);
        },
        function (a, b) {
            llamadas.fusiones.push([a, b]);
            return a + b;
        },
        parseISODate,
        keyFromDate,
        toISODate,
        TURNO,
        normalizeReplacementRotationMode,
        REPLACEMENT_ROTATION_MODE
    );

    return { preview: preview, llamadas: llamadas };
}

// Claves de calendario: mes en BASE 0. "2027-1-9" es el 9 de febrero de 2027.
var ANA = {
    "2027-1-9": TURNO.LARGA,
    "2027-1-10": TURNO.NOCHE,
    "2027-1-13": TURNO.LARGA,
    "2027-1-14": TURNO.NOCHE,
    "2027-1-17": TURNO.LARGA
};

function correr(extra) {
    extra = extra || {};

    var mundo = {
        turnos: {
            Ana: ANA,
            Alan: extra.propios || {}
        },
        contratos: extra.contratos || [],
        bloquea24: extra.bloquea24 || []
    };
    var armado = construir(mundo);

    return {
        resultado: armado.preview({
            replacementWorker: "Alan",
            replaced: "Ana",
            startISO: extra.startISO || "2027-02-09",
            endISO: extra.endISO || "2027-02-18",
            rotationMode: extra.modo || REPLACEMENT_ROTATION_MODE.INHERIT
        }),
        llamadas: armado.llamadas
    };
}

/* =========================================================
   Sin traslape: lo de siempre
========================================================= */

test("sin contrato anterior se heredan todos los turnos del rango", () => {
    var salida = correr().resultado;

    assert.equal(salida.heredados, 5);
    assert.equal(salida.pendientes, 0);
});

test("los dias libres del reemplazado no cuentan como turno", () => {
    // El rango tiene diez dias y solo cinco llevan turno.
    var salida = correr().resultado;

    assert.equal(salida.dias.length, 5);
});

/* =========================================================
   Con traslape: AHORA tambien se hereda
========================================================= */

test("el tramo traslapado se hereda, que es lo que antes se perdia", () => {
    var salida = correr({
        contratos: [{ start: "2027-02-01", end: "2027-02-15" }],
        propios: {}
    }).resultado;

    assert.equal(salida.heredados, 5);
    assert.equal(salida.pendientes, 0);
    assert.ok(
        salida.dias.filter(function (dia) { return dia.traslape; }).length >= 4,
        "los dias dentro del contrato anterior quedan marcados como traslape"
    );
});

test("si ya tiene turno propio ese dia, los turnos se SUMAN", () => {
    var salida = correr({
        contratos: [{ start: "2027-02-01", end: "2027-02-15" }],
        propios: { "2027-1-13": TURNO.DIURNO }
    });
    var dia13 = salida.resultado.dias.find(function (dia) {
        return dia.key === "2027-1-13";
    });

    assert.equal(salida.llamadas.fusiones.length, 1);
    assert.equal(dia13.estado, "heredado");
    assert.notEqual(dia13.turno, dia13.heredado);
});

/* =========================================================
   La regla que lo frena
========================================================= */

test("si la suma diera un Turno 24 y no se permiten, queda PENDIENTE", () => {
    var salida = correr({
        contratos: [{ start: "2027-02-01", end: "2027-02-15" }],
        propios: { "2027-1-9": TURNO.NOCHE },
        bloquea24: ["2027-1-9"]
    }).resultado;
    var dia9 = salida.dias.find(function (dia) { return dia.key === "2027-1-9"; });

    assert.equal(dia9.estado, "pendiente");
    assert.equal(salida.pendientes, 1);
    assert.equal(salida.heredados, 4);
});

test("un dia bloqueado conserva el turno PROPIO, no el heredado", () => {
    // Si se quedara con el heredado, el calendario mostraria un turno que el
    // trabajador no hace y el "!" perderia sentido.
    var salida = correr({
        contratos: [{ start: "2027-02-01", end: "2027-02-15" }],
        propios: { "2027-1-9": TURNO.NOCHE },
        bloquea24: ["2027-1-9"]
    }).resultado;
    var dia9 = salida.dias.find(function (dia) { return dia.key === "2027-1-9"; });

    assert.equal(dia9.turno, TURNO.NOCHE);
    assert.equal(dia9.propio, TURNO.NOCHE);
});

test("la regla del 24 solo aplica DENTRO del traslape", () => {
    // Fuera del contrato anterior no hay turno propio con el que chocar: el
    // dia 17 esta fuera del rango 01-15.
    var salida = correr({
        contratos: [{ start: "2027-02-01", end: "2027-02-15" }],
        propios: { "2027-1-17": TURNO.NOCHE },
        bloquea24: ["2027-1-17"]
    }).resultado;
    var dia17 = salida.dias.find(function (dia) { return dia.key === "2027-1-17"; });

    assert.equal(dia17.estado, "heredado");
    assert.equal(salida.pendientes, 0);
});

/* =========================================================
   Los otros modos no heredan nada
========================================================= */

test("en modo libre no se hereda ningun turno", () => {
    var salida = correr({ modo: REPLACEMENT_ROTATION_MODE.FREE }).resultado;

    assert.deepEqual(salida.dias, []);
    assert.equal(salida.heredados, 0);
});

test("sin ausente o sin fechas no se inventa nada", () => {
    var armado = construir({ turnos: {}, contratos: [] });

    assert.deepEqual(
        armado.preview({ replaced: "", startISO: "2027-02-09", endISO: "2027-02-18" }).dias,
        []
    );
    assert.deepEqual(
        armado.preview({ replaced: "Ana", startISO: "", endISO: "" }).dias,
        []
    );
});

/* =========================================================
   Y al guardar, el traslape queda registrado

   Se fija el cableado en el codigo fuente: la funcion de guardado toca
   almacenamiento real y no se puede ejecutar aqui.
========================================================= */

test("los dias del traslape se guardan como REEMPLAZOS", () => {
    // Es lo que apaga el "!" del ausente y lo que suma el turno a las horas
    // realizadas del reemplazante. Un trabajador a reemplazo no tiene
    // asignacion de turno: sus horas son las realizadas menos las habiles de
    // los dias con contrato.
    assert.match(main, /source: "replacement_contract_overlap"/);
    assert.match(
        main,
        /saveReplacement\(\{\s*\n\s*worker: replacementWorker,\s*\n\s*replaced,\s*\n\s*keyDay: dia\.key,\s*\n\s*turno: dia\.heredado,/
    );
});

test("solo los dias FUERA del contrato recortado", () => {
    // Dentro del contrato nuevo los turnos ya los proyecta el propio contrato;
    // duplicarlos con un reemplazo contaria el turno dos veces.
    assert.match(
        main,
        /dia\.estado === "heredado" &&\s*\n\s*\(dia\.iso < start \|\| dia\.iso > end\)/
    );
});

test("y solo cuando el contrato se recorto de verdad", () => {
    assert.match(
        main,
        /if \(start !== requestedStart \|\| end !== requestedEnd\) \{/
    );
});

test("la herencia del guardado se mide sobre el rango COMPLETO", () => {
    // Sobre el recortado no habria traslape que recuperar: es justo el tramo
    // que el recorte dejo fuera.
    assert.match(
        main,
        /startISO: requestedStart,\s*\n\s*endISO: requestedEnd,/
    );
});

test("saveReplacement esta importado", () => {
    // Referenciarla sin importarla compila igual y revienta al guardar.
    assert.match(
        main,
        /getHheeMonthRecords,\s*\n\s*saveReplacement\s*\n\} from "\.\/replacements\.js";/
    );
});

test("un rango al reves no produce dias", () => {
    var salida = correr({
        startISO: "2027-02-18",
        endISO: "2027-02-09"
    }).resultado;

    assert.deepEqual(salida.dias, []);
});
