// El calendario del modal "Ultimo dia de ..." se pinta como el calendario.
//
// Hasta el 2026-10-14 ese modal era la unica vista de dias en blanco y negro:
// habia que elegir el ultimo turno de alguien leyendo etiquetas diminutas, sin
// poder distinguir de un vistazo un turno de un permiso o de un dia libre.
//
// Ahora usa el MISMO pintor del calendario (aplicarClasesEspeciales), asi que
// aqui se comprueban las dos cosas que pueden romperse: lo que dice cada dia y
// el orden con que se le pasan los datos al pintor (confundir "fin de semana"
// con "feriado" pinta mal y no falla por ninguna parte).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TURNO } from "../js/constants.js";
import { turnoLabel } from "../js/uiEngine.js";
import {
    aplicarClasesEspeciales,
    esAusenciaInjustificada,
    getAbsenceType
} from "../js/rulesEngine.js";

const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

function extraer(fuente, nombre) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    let profundidad = 0;

    for (let i = fuente.indexOf("{", inicio); i < fuente.length; i += 1) {
        if (fuente[i] === "{") profundidad += 1;
        else if (fuente[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return fuente.slice(inicio, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

// Las funciones reales del modal, con los datos del perfil de mentira y el
// resto de las piezas de verdad.
function montarDia({ programado = {}, base = {} } = {}) {
    const fabrica = new Function(
        "TURNO",
        "turnoLabel",
        "getAbsenceType",
        "esAusenciaInjustificada",
        "getTurnoProgramado",
        "getTurnoBase",
        `${extraer(main, "inactivationAbsenceLabel")}
         ${extraer(main, "profileInactivationDay")}
         return profileInactivationDay;`
    );

    return fabrica(
        TURNO,
        turnoLabel,
        getAbsenceType,
        esAusenciaInjustificada,
        (perfil, key) => programado[key] || TURNO.LIBRE,
        (perfil, key) => base[key] || TURNO.LIBRE
    );
}

const dias = (extra = {}) => ({
    admin: {},
    legal: {},
    comp: {},
    absences: {},
    ...extra
});

test("un dia con turno dice su turno", () => {
    const dia = montarDia({ programado: { "2026-9-2": TURNO.LARGA } });

    assert.equal(dia("Ana", "2026-9-2", dias()).label, turnoLabel(TURNO.LARGA));
    assert.equal(dia("Ana", "2026-9-2", dias()).turn, TURNO.LARGA);
});

test("un dia sin nada dice Libre", () => {
    assert.equal(montarDia()("Ana", "2026-9-3", dias()).label, "Libre");
});

test("el permiso manda sobre el turno que hay debajo", () => {
    // Si dijera el turno, el supervisor elegiria como ultimo dia trabajado uno
    // en que la persona estaba de permiso.
    const dia = montarDia({ programado: { "2026-9-2": TURNO.LARGA } });

    assert.equal(
        dia("Ana", "2026-9-2", dias({ legal: { "2026-9-2": true } })).label,
        "F. Legal"
    );
    assert.equal(
        dia("Ana", "2026-9-2", dias({ comp: { "2026-9-2": true } })).label,
        "F. Comp."
    );
    assert.equal(
        dia("Ana", "2026-9-2", dias({ admin: { "2026-9-2": 1 } })).label,
        "P. Administrativo"
    );
    assert.equal(
        dia("Ana", "2026-9-2", dias({ admin: { "2026-9-2": "0.5M" } })).label,
        "1/2 P. Admin."
    );
});

test("cada ausencia dice lo que es, no todas 'Licencia'", () => {
    // Antes toda ausencia decia "Licencia": una capacitacion se veia igual que
    // una licencia medica, y ahora ademas llevan colores distintos.
    const dia = montarDia();
    const etiqueta = absence =>
        dia("Ana", "2026-9-2", dias({ absences: { "2026-9-2": absence } })).label;

    assert.equal(etiqueta("training"), "Capacitacion");
    assert.equal(etiqueta("professional_license"), "LM Profesional");
    assert.equal(etiqueta("union_leave"), "P. Gremial");
    assert.equal(etiqueta("unpaid_leave"), "Sin Goce");
    assert.equal(etiqueta(1), "Licencia");
});

test("el turno base viaja aparte del programado", () => {
    // Es lo que decide si el permiso cayo sobre un dia de trabajo o sobre uno
    // libre: con base libre, la casilla se pinta mas tenue.
    const dia = montarDia({
        programado: { "2026-9-2": TURNO.LARGA },
        base: { "2026-9-2": TURNO.NOCHE }
    });

    assert.equal(dia("Ana", "2026-9-2", dias()).baseTurn, TURNO.NOCHE);
    assert.equal(montarDia()("Ana", "2026-9-2", dias()).baseTurn, TURNO.LIBRE);
});

// --- El orden con que se llama al pintor ---

function argumentosDeLaLlamada(fuente, nombre) {
    const inicio = fuente.indexOf(`${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre la llamada a ${nombre}`);

    const abre = fuente.indexOf("(", inicio);
    let profundidad = 0;

    for (let i = abre; i < fuente.length; i += 1) {
        if (fuente[i] === "(") profundidad += 1;
        else if (fuente[i] === ")") {
            profundidad -= 1;
            if (!profundidad) {
                return separarArgumentos(fuente.slice(abre + 1, i));
            }
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

// Corta por las comas de PRIMER nivel: `isBusinessDay(date, holidays)` es un
// solo argumento, aunque lleve una coma adentro.
function separarArgumentos(texto) {
    const partes = [];
    let actual = "";
    let profundidad = 0;

    for (const caracter of texto) {
        if (caracter === "(" || caracter === "[" || caracter === "{") profundidad += 1;
        if (caracter === ")" || caracter === "]" || caracter === "}") profundidad -= 1;

        if (caracter === "," && !profundidad) {
            partes.push(actual.trim());
            actual = "";
            continue;
        }

        actual += caracter;
    }

    partes.push(actual.trim());

    return partes.filter(Boolean);
}

test("el modal le pasa los datos al pintor en el orden que este espera", () => {
    // Cambiar "fin de semana" por "feriado" pinta mal y no falla en ninguna
    // parte: el unico que se da cuenta es quien mira la pantalla.
    const argumentos = argumentosDeLaLlamada(main, "aplicarClasesEspeciales");

    assert.equal(argumentos[0], "cell");
    assert.equal(argumentos[1], "key");
    assert.equal(argumentos[2], "dia.turn");
    assert.match(argumentos[3], /^isBusinessDay\(/);
    assert.match(argumentos[4], /^isWeekend\(/);
    assert.match(argumentos[5], /^Boolean\(holidays\[/);
    assert.equal(argumentos[6], "dias.admin");
    assert.equal(argumentos[7], "dias.legal");
    assert.equal(argumentos[8], "dias.comp");
    assert.equal(argumentos[9], "dias.absences");
    assert.equal(argumentos[10], "aplicarClaseTurno");
    assert.equal(argumentos[11], "dia.baseTurn");
});

test("y el pintor sigue esperando ese orden", async () => {
    // El contrato esta del otro lado: si cambian los parametros del pintor,
    // esta prueba lo dice en vez de dejar el modal pintando cualquier cosa.
    const rules = await readFile(
        new URL("../js/rulesEngine.js", import.meta.url),
        "utf8"
    );
    const parametros = argumentosDeLaLlamada(rules, "export function aplicarClasesEspeciales")
        .map(parte => parte.split("=")[0].trim());

    assert.deepEqual(parametros, [
        "div",
        "keyDay",
        "state",
        "isHab",
        "isWeekend",
        "isHoliday",
        "admin",
        "legal",
        "comp",
        "absences",
        "aplicarClaseTurnoFn",
        "baseTurn",
        "dayGradient"
    ]);
});

// --- Lo que el pintor deja en la casilla ---

class CeldaFalsa {
    constructor() {
        this.clases = new Set();
        this.style = {
            setProperty: (nombre, valor) => { this.fondo = valor; },
            removeProperty: () => { this.fondo = ""; }
        };
        this.classList = {
            add: (...nombres) => nombres.forEach(n => this.clases.add(n)),
            remove: (...nombres) => nombres.forEach(n => this.clases.delete(n)),
            contains: nombre => this.clases.has(nombre)
        };
    }
}

function pintar({ turn, baseTurn = TURNO.LIBRE, mapas = dias(), weekend = false }) {
    const celda = new CeldaFalsa();

    aplicarClasesEspeciales(
        celda,
        "2026-9-2",
        turn,
        true,
        weekend,
        false,
        mapas.admin,
        mapas.legal,
        mapas.comp,
        mapas.absences,
        (div, state) => {
            if (state === TURNO.LARGA) div.classList.add("blue");
            if (state === TURNO.NOCHE) div.classList.add("purple");
        },
        baseTurn
    );

    return celda.clases;
}

test("un turno y un permiso no se ven iguales", () => {
    assert.ok(pintar({ turn: TURNO.LARGA }).has("blue"));
    assert.ok(
        pintar({
            turn: TURNO.LARGA,
            baseTurn: TURNO.LARGA,
            mapas: dias({ legal: { "2026-9-2": true } })
        }).has("legal-day")
    );
    assert.ok(
        pintar({
            turn: TURNO.LIBRE,
            mapas: dias({ absences: { "2026-9-2": "training" } })
        }).has("training-day")
    );
});

test("un permiso sobre un dia libre se pinta mas tenue", () => {
    const sobreTurno = pintar({
        turn: TURNO.LARGA,
        baseTurn: TURNO.LARGA,
        mapas: dias({ legal: { "2026-9-2": true } })
    });
    const sobreLibre = pintar({
        turn: TURNO.LIBRE,
        baseTurn: TURNO.LIBRE,
        mapas: dias({ legal: { "2026-9-2": true } })
    });

    assert.equal(sobreTurno.has("leave-free-day"), false);
    assert.equal(sobreLibre.has("leave-free-day"), true);
});

test("la transparencia del permiso sobre dia libre tambien aplica al modal", async () => {
    // La regla estaba escrita solo para el calendario (.day) y el timeline
    // (.mini): sin esto, en el modal el permiso sobre un dia libre se veria
    // igual que uno sobre un dia de trabajo.
    const css = await readFile(
        new URL("../styles.css", import.meta.url),
        "utf8"
    );

    assert.match(css, /\.profile-mini-day\.leave-free-day[^{]*\{\s*opacity: 0\.5;/);
});
