// Que nadie quede trabajando en dos unidades el mismo dia.
//
// Son dos piezas de lo mismo:
//
//   1. A quien llego por TRASPASO no se le pueden cargar turnos antes de su
//      fecha de ingreso: hasta ese dia era de la otra unidad y su calendario de
//      esos dias vive alla. A quien se ingresa de cero no se le limita nada.
//
//   2. Al aceptar un traspaso, si esta unidad ya habia cerrado hasta que dia
//      trabajaba aqui, la fecha pedida puede ser anterior. Decide quien
//      entrega: aceptar aplica el traspaso y no hay vuelta atras.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { unitEntryBlockReason } from "../js/profileQueries.js";

const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);
const calendario = await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
);

function extraer(fuente, nombre) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    const asincrona = fuente.lastIndexOf("async function", inicio);
    const desde = asincrona === inicio - 6 ? asincrona : inicio;
    let parentesis = 0;
    let cuerpo = -1;

    for (let i = fuente.indexOf("(", inicio); i < fuente.length; i += 1) {
        if (fuente[i] === "(") parentesis += 1;
        else if (fuente[i] === ")") {
            parentesis -= 1;
            if (!parentesis) {
                cuerpo = fuente.indexOf("{", i);
                break;
            }
        }
    }

    let profundidad = 0;

    for (let i = cuerpo; i < fuente.length; i += 1) {
        if (fuente[i] === "{") profundidad += 1;
        else if (fuente[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return fuente.slice(desde, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

// --- 1. El calendario anterior al ingreso ---

const TRASPASADA = {
    name: "Ana Rojas",
    unitEntryDate: "2026-10-16",
    unitEntryLocked: true
};

test("a quien llego por traspaso no se le carga nada antes de entrar", () => {
    assert.match(
        unitEntryBlockReason(TRASPASADA, "2026-10-15"),
        /llegó por traspaso/
    );
    assert.match(
        unitEntryBlockReason(TRASPASADA, "2026-10-15"),
        /desde el 16\/10\/2026/
    );
});

test("desde el dia de ingreso en adelante, sin limite", () => {
    assert.equal(unitEntryBlockReason(TRASPASADA, "2026-10-16"), "");
    assert.equal(unitEntryBlockReason(TRASPASADA, "2026-10-17"), "");
    assert.equal(unitEntryBlockReason(TRASPASADA, "2027-01-01"), "");
});

test("a quien se ingreso de cero no se le limita nada", () => {
    // Es la salvedad: esa fecha de ingreso la escribio el supervisor de esta
    // unidad y puede cargarle lo que corresponda.
    const deCero = { name: "Beatriz", unitEntryDate: "2026-10-16" };

    assert.equal(unitEntryBlockReason(deCero, "2026-01-01"), "");
    assert.equal(unitEntryBlockReason(deCero, "2026-10-15"), "");
});

test("sin fecha de ingreso no hay nada que comparar", () => {
    assert.equal(
        unitEntryBlockReason({ name: "Ana", unitEntryLocked: true }, "2026-10-15"),
        ""
    );
    assert.equal(unitEntryBlockReason(null, "2026-10-15"), "");
    assert.equal(unitEntryBlockReason(TRASPASADA, ""), "");
});

test("el bloqueo esta en los DOS caminos que escriben el calendario", () => {
    // Pinchar un dia (clickDia) y escribir el turno encima (edicion directa)
    // son puertas distintas: con una sola tapada, por la otra se cuela.
    const clic = extraer(calendario, "clickDia");

    assert.match(clic, /dayOutsideUnitReason\(/);
    assert.match(clic, /return true;/);

    const inicioDirecta = calendario.indexOf("const activeProfileEnabled =");
    const directa = calendario.slice(
        inicioDirecta,
        calendario.indexOf("const date = dateFromKeyDay(keyDay);", inicioDirecta)
    );

    assert.match(directa, /dayOutsideUnitReason\(/);
    assert.match(directa, /event\.stopPropagation\(\);/);
});

test("y el dia se ve bloqueado antes de apretarlo", () => {
    assert.match(calendario, /div\.classList\.add\("day-before-unit-entry"\)/);
    // El motivo entra en la cuenta de los bloqueos de la casilla.
    assert.match(calendario, /const otroMotivoDeBloqueo =[\s\S]*?beforeUnitEntry;/);
    assert.match(
        calendario,
        /otroMotivoDeBloqueo \|\| !activeProfileEnabled\s*\n\s*\? "mpa-disabled"/
    );
});

test("la marca viaja con el perfil: la ponen los dos caminos del traspaso", () => {
    // Si no se guardara, el limite duraria hasta el proximo guardado del perfil.
    const crear = extraer(main, "createProfileFromHandover");

    assert.match(crear, /unitEntryLocked: true/);
    assert.match(main, /unitEntryLocked: Boolean\(/);
    // Y se conserva al editar: lo acordado no deja de serlo porque alguien
    // guarde la ficha.
    assert.match(main, /previousSnapshot\?\.unitEntryLocked/);
});

// --- 2. La ultima palabra al aceptar ---

function montarFecha({ activo = false, ultimoDia = "", respuesta = null }) {
    const cuadros = [];
    const fabrica = new Function(
        "isProfileActive",
        "normalizeStoredStart",
        "compareISODate",
        "formatDisplayDate",
        "nextCalendarISO",
        "showChoice",
        `${extraer(main, "resolveHandoverStartDate")}
         return resolveHandoverStartDate;`
    );

    return {
        cuadros,
        resolver: fabrica(
            () => activo,
            valor => String(valor || ""),
            (a, b) => (a < b ? -1 : a > b ? 1 : 0),
            iso => iso,
            iso => `${iso}+1`,
            async (mensaje, opciones) => {
                cuadros.push({ mensaje, ...opciones });
                return respuesta;
            }
        )
    };
}

const PERFIL = { name: "Ana Rojas", unitExitDate: "2026-10-08" };

test("sin cruce se acepta la fecha pedida, sin preguntar nada", async () => {
    // El perfil sigue activo aqui: no hay nada cerrado que proteger.
    const { resolver, cuadros } = montarFecha({ activo: true });

    assert.equal(await resolver(PERFIL, "2026-10-02", "Urgencia"), "2026-10-02");
    assert.deepEqual(cuadros, []);
});

test("tampoco se pregunta si el pedido empieza despues de su ultimo dia", async () => {
    const { resolver, cuadros } = montarFecha({ ultimoDia: "2026-10-08" });

    assert.equal(await resolver(PERFIL, "2026-10-20", "Urgencia"), "2026-10-20");
    assert.deepEqual(cuadros, []);
});

test("con cruce se avisa y lo decide esta unidad", async () => {
    const { resolver, cuadros } = montarFecha({ respuesta: "2026-10-08+1" });
    const acordada = await resolver(PERFIL, "2026-10-02", "Urgencia Adulto");

    assert.equal(cuadros.length, 1);
    // El aviso dice las dos fechas, que es de lo que hay que enterarse.
    assert.match(cuadros[0].mensaje, /2026-10-02/);
    assert.match(cuadros[0].mensaje, /2026-10-08/);
    assert.match(cuadros[0].mensaje, /Urgencia Adulto/);

    // Y las dos salidas son fechas concretas, no un si/no.
    assert.deepEqual(
        cuadros[0].choices.map(opcion => opcion.value),
        ["2026-10-08+1", "2026-10-02"]
    );
    assert.equal(acordada, "2026-10-08+1");
});

test("el mismo dia de su ultimo turno tambien es cruce", async () => {
    // Aceptar desde el 8 vaciaria el 8, que es un dia ya trabajado aqui.
    const { resolver, cuadros } = montarFecha({ respuesta: "2026-10-02" });

    await resolver(PERFIL, "2026-10-08", "Urgencia");

    assert.equal(cuadros.length, 1);
});

test("si eligen la fecha pedida, se acepta esa", async () => {
    const { resolver } = montarFecha({ respuesta: "2026-10-02" });

    assert.equal(await resolver(PERFIL, "2026-10-02", "Urgencia"), "2026-10-02");
});

test("cerrar el cuadro no acepta nada", async () => {
    const { resolver } = montarFecha({ respuesta: null });

    assert.equal(await resolver(PERFIL, "2026-10-02", "Urgencia"), "");
});
