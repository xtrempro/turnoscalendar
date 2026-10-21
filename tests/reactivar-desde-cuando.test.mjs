// Reactivar a alguien: desde cuando empieza su rotativa nueva.
//
// Tres cosas estaban mal, y las tres se ven al reactivar a quien se habia ido:
//
//   1. El cuadro abria con la fecha de su rotativa ANTERIOR preseleccionada y
//      pintada -la del tramo en que todavia estaba aqui-, asi que aceptar sin
//      mirar aplicaba una rotativa que nadie eligio. Ahora abre sin fecha: la
//      pone el supervisor con un clic.
//   2. Abria en el mes de esa fecha vieja (enero, en un caso) en vez del mes
//      donde se puede empezar: el dia siguiente a su ultimo dia trabajado.
//   3. Elegir una fecha anterior a su salida reescribe turnos que ya estaban
//      programados -con sus permisos y cambios de turno- sin decir nada. Ahora
//      se avisa y se puede volver a elegir.
//
// Y la pregunta sale al marcar la casilla "Perfil activo", no al guardar: es
// el gesto que la provoca.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");

function extraer(nombre) {
    const inicio = main.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    const asincrona = main.lastIndexOf("async function", inicio);
    const desde = asincrona === inicio - 6 ? asincrona : inicio;
    let parentesis = 0;
    let cuerpo = -1;

    for (let i = main.indexOf("(", inicio); i < main.length; i += 1) {
        if (main[i] === "(") parentesis += 1;
        else if (main[i] === ")") {
            parentesis -= 1;
            if (!parentesis) {
                cuerpo = main.indexOf("{", i);
                break;
            }
        }
    }

    assert.notEqual(cuerpo, -1, `no encontre el cuerpo de ${nombre}`);

    let profundidad = 0;

    for (let i = cuerpo; i < main.length; i += 1) {
        if (main[i] === "{") profundidad += 1;
        else if (main[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return main.slice(desde, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

const comparar = (a, b) => String(a).localeCompare(String(b));
const siguienteDia = iso => {
    const fecha = new Date(`${iso}T00:00:00Z`);

    fecha.setUTCDate(fecha.getUTCDate() + 1);

    return fecha.toISOString().slice(0, 10);
};

// --- Que se le pide al cuadro de la rotativa ---

function montarReactivacion({ elecciones, confirmaciones = [] }) {
    const pedidos = [];
    const advertencias = [];
    const fabrica = new Function(
        "normalizeRut",
        "findWorkerInEstablishment",
        "showChoice",
        "requestHandoverFromUnits",
        "askHandoverSchedule",
        "showConfirm",
        "normalizeStoredStart",
        "nextCalendarISO",
        "compareISODate",
        "formatDisplayDate",
        "console",
        `${extraer("resolveProfileReactivation")}
         return resolveProfileReactivation;`
    );
    const restantes = [...elecciones];
    const confirmar = [...confirmaciones];

    return {
        pedidos,
        advertencias,
        reactivar: fabrica(
            valor => String(valor || "").replace(/[^0-9kK]/g, ""),
            async () => ({ unidades: [] }),
            async () => null,
            async () => false,
            async opciones => {
                pedidos.push(opciones);
                return restantes.shift() ?? null;
            },
            async (mensaje, opciones) => {
                advertencias.push({ mensaje, ...opciones });
                return confirmar.shift() ?? false;
            },
            valor => String(valor || ""),
            siguienteDia,
            comparar,
            iso => iso,
            { warn() {} }
        )
    };
}

const DESDE_EL_19 = {
    startDate: "2026-10-19",
    rotationType: "4turno",
    rotationFirstTurn: "larga",
    resumen: "4° Turno"
};

test("el cuadro abre sin fecha puesta y en el mes donde se puede empezar", async () => {
    const { reactivar, pedidos } = montarReactivacion({
        elecciones: [DESDE_EL_19]
    });

    const decision = await reactivar("Gabriel Flores", "31.005.006-7", "2026-10-18");

    assert.equal(pedidos.length, 1);
    // Sin fecha preseleccionada: la rotativa empieza donde se haga clic.
    assert.equal(pedidos[0].startEmpty, true);
    // Y abre en el dia siguiente a su ultimo dia trabajado.
    assert.equal(pedidos[0].openAt, "2026-10-19");
    assert.deepEqual(decision, { ...DESDE_EL_19, handoverRequested: false });
});

test("sin fecha de salida conocida no se inventa un mes", async () => {
    const { reactivar, pedidos } = montarReactivacion({
        elecciones: [DESDE_EL_19]
    });

    await reactivar("Gabriel Flores", "31.005.006-7", "");

    assert.equal(pedidos[0].startEmpty, true);
    assert.equal(pedidos[0].openAt, "");
});

test("una fecha posterior a su salida no pregunta nada mas", async () => {
    const { reactivar, advertencias } = montarReactivacion({
        elecciones: [DESDE_EL_19]
    });

    await reactivar("Gabriel Flores", "31.005.006-7", "2026-10-18");

    assert.deepEqual(advertencias, []);
});

test("una fecha dentro del tramo que trabajo avisa lo que se reescribe", async () => {
    const dentro = { ...DESDE_EL_19, startDate: "2026-10-10" };
    const { reactivar, advertencias } = montarReactivacion({
        elecciones: [dentro],
        confirmaciones: [true]
    });

    const decision = await reactivar("Gabriel Flores", "31.005.006-7", "2026-10-18");

    assert.equal(advertencias.length, 1);
    assert.match(advertencias[0].mensaje, /hasta el 2026-10-18/);
    assert.match(advertencias[0].mensaje, /2026-10-10/);
    assert.match(advertencias[0].mensaje, /permisos/);
    assert.match(advertencias[0].mensaje, /cambios de turno/);
    assert.equal(decision.startDate, "2026-10-10");
});

test("el mismo dia de su salida tambien avisa", async () => {
    // Ese dia trabajo: la rotativa nueva lo pisaria igual.
    const { reactivar, advertencias } = montarReactivacion({
        elecciones: [{ ...DESDE_EL_19, startDate: "2026-10-18" }],
        confirmaciones: [true]
    });

    await reactivar("Gabriel Flores", "31.005.006-7", "2026-10-18");

    assert.equal(advertencias.length, 1);
});

test("si no quiere sobrescribir, vuelve a elegir la fecha", async () => {
    const { reactivar, pedidos, advertencias } = montarReactivacion({
        elecciones: [
            { ...DESDE_EL_19, startDate: "2026-10-10" },
            DESDE_EL_19
        ],
        confirmaciones: [false]
    });

    const decision = await reactivar("Gabriel Flores", "31.005.006-7", "2026-10-18");

    assert.equal(pedidos.length, 2, "se vuelve a abrir el cuadro");
    assert.equal(advertencias.length, 1);
    assert.equal(decision.startDate, "2026-10-19");
});

test("volver a elegir la fecha no vuelve a preguntar la modalidad", async () => {
    // El cuestionario entero por corregir una fecha es exactamente lo que
    // hace que nadie corrija nada.
    const { reactivar, pedidos } = montarReactivacion({
        elecciones: [
            { ...DESDE_EL_19, startDate: "2026-10-10", rotationType: "diurno" },
            { ...DESDE_EL_19, rotationType: "diurno" }
        ],
        confirmaciones: [false]
    });

    await reactivar("Gabriel Flores", "31.005.006-7", "2026-10-18");

    assert.equal(pedidos.length, 2);
    // La primera vuelta pregunta la modalidad; la segunda la lleva puesta.
    assert.equal(pedidos[0].rotationType, "");
    assert.equal(pedidos[1].rotationType, "diurno");
});

test("cerrar el cuadro cancela la reactivacion", async () => {
    const { reactivar, advertencias } = montarReactivacion({ elecciones: [null] });

    assert.equal(
        await reactivar("Gabriel Flores", "31.005.006-7", "2026-10-18"),
        null
    );
    assert.deepEqual(advertencias, []);
});

// --- La casilla pregunta en el acto ---

function montarCasilla({
    perfil,
    marcada,
    ultimoDia,
    decision,
    modo = "edit",
    alAbrirElCuadro = () => {}
}) {
    const casilla = { checked: marcada };
    const borrador = {
        mode: modo,
        active: marcada,
        originalName: perfil?.name || "",
        name: perfil?.name || "",
        rut: perfil?.rut || "",
        rotationType: "3turno",
        rotationStart: "2026-01-01",
        rotationFirstTurn: "noche",
        pendingExitDate: "",
        pendingReactivation: null
    };
    const preguntas = [];
    const fabrica = new Function(
        "getPerfilActual",
        "profileDraft",
        "PROFILE_MODE",
        "isProfileActive",
        "DOM",
        "renderDashboardState",
        "requestProfileInactivationDate",
        "pendingHandoverReactivation",
        "resolveProfileReactivation",
        `${extraer("resolveProfileActiveToggle")}
         return resolveProfileActiveToggle;`
    );

    return {
        casilla,
        borrador,
        preguntas,
        resolver: fabrica(
            () => perfil,
            borrador,
            { VIEW: "view", EDIT: "edit", CREATE: "create" },
            item => item?.active !== false,
            { profileActiveToggle: casilla },
            () => {},
            async (...args) => {
                preguntas.push({ tipo: "inactivar", args });
                return ultimoDia;
            },
            null,
            async (...args) => {
                preguntas.push({ tipo: "reactivar", args });
                alAbrirElCuadro();
                return decision;
            }
        )
    };
}

const ACTIVO = { name: "Gabriel Flores", rut: "31.005.006-7", active: true };
const INACTIVO = {
    name: "Gabriel Flores",
    rut: "31.005.006-7",
    active: false,
    unitExitDate: "2026-10-18"
};

test("desmarcar la casilla pregunta ahi mismo cual fue su ultimo turno", async () => {
    const { resolver, borrador, preguntas, casilla } = montarCasilla({
        perfil: ACTIVO,
        marcada: false,
        ultimoDia: "2026-10-18"
    });

    await resolver();

    assert.equal(preguntas.length, 1);
    assert.equal(preguntas[0].tipo, "inactivar");
    assert.equal(borrador.pendingExitDate, "2026-10-18");
    assert.equal(casilla.checked, false, "la casilla queda desmarcada");
});

test("cerrar ese cuadro devuelve la casilla a como estaba", async () => {
    const { resolver, borrador, casilla } = montarCasilla({
        perfil: ACTIVO,
        marcada: false,
        ultimoDia: ""
    });

    await resolver();

    assert.equal(casilla.checked, true);
    assert.equal(borrador.active, true);
    assert.equal(borrador.pendingExitDate, "");
});

test("marcar la casilla pregunta la rotativa, con su ultimo dia a la vista", async () => {
    const { resolver, borrador, preguntas } = montarCasilla({
        perfil: INACTIVO,
        marcada: true,
        decision: { ...DESDE_EL_19, handoverRequested: false }
    });

    await resolver();

    assert.equal(preguntas[0].tipo, "reactivar");
    // Nombre, RUT y hasta cuando trabajo: con eso se calcula el piso.
    assert.deepEqual(preguntas[0].args, [
        "Gabriel Flores",
        "31.005.006-7",
        "2026-10-18"
    ]);
    // Y lo elegido queda en el borrador, listo para guardar.
    assert.equal(borrador.rotationStart, "2026-10-19");
    assert.equal(borrador.rotationType, "4turno");
    assert.equal(borrador.pendingReactivation.startDate, "2026-10-19");
});

test("si se pide el traspaso, el perfil NO se reactiva todavia", async () => {
    const { resolver, borrador, casilla } = montarCasilla({
        perfil: INACTIVO,
        marcada: true,
        decision: { handoverRequested: true }
    });

    await resolver();

    assert.equal(casilla.checked, false);
    assert.equal(borrador.active, false);
    assert.equal(borrador.pendingReactivation, null);
});

test("cancelar la reactivacion deja el perfil inactivo", async () => {
    const { resolver, borrador, casilla } = montarCasilla({
        perfil: INACTIVO,
        marcada: true,
        decision: null
    });

    await resolver();

    assert.equal(casilla.checked, false);
    assert.equal(borrador.active, false);
});

test("una reactivacion abandonada no deja su rotativa en el borrador", async () => {
    // El cuadro de la rotativa escribe en el borrador apenas se acepta. Si
    // despues se rechaza sobrescribir y se cierra el siguiente cuadro, eso
    // quedaba puesto: guardar cualquier otro cambio aplicaba la rotativa de
    // una reactivacion que nunca ocurrio.
    const { resolver, borrador, casilla } = montarCasilla({
        perfil: INACTIVO,
        marcada: true,
        decision: null,
        // Lo que el cuadro alcanzo a escribir antes de que se abandonara.
        alAbrirElCuadro: () => {
            borrador.rotationType = "diurno";
            borrador.rotationStart = "2026-10-10";
            borrador.rotationFirstTurn = "larga";
        }
    });

    await resolver();

    assert.equal(casilla.checked, false);
    assert.equal(borrador.rotationType, "3turno");
    assert.equal(borrador.rotationStart, "2026-01-01");
    assert.equal(borrador.rotationFirstTurn, "noche");
});

test("volver a dejarla como estaba no pregunta nada", async () => {
    const { resolver, preguntas, borrador } = montarCasilla({
        perfil: ACTIVO,
        marcada: true,
        ultimoDia: "2026-10-18"
    });

    await resolver();

    assert.deepEqual(preguntas, []);
    // Y lo respondido antes deja de valer.
    assert.equal(borrador.pendingExitDate, "");
    assert.equal(borrador.pendingReactivation, null);
});

test("mientras se crea un perfil la casilla no pregunta nada", async () => {
    // Un perfil nuevo nace como se lo deje: no hay un ultimo turno que
    // declarar ni una rotativa anterior que retomar.
    const { resolver, preguntas, casilla } = montarCasilla({
        perfil: ACTIVO,
        marcada: false,
        ultimoDia: "2026-10-18",
        modo: "create"
    });

    await resolver();

    assert.deepEqual(preguntas, []);
    assert.equal(casilla.checked, false);
});

// --- El guardado usa lo respondido ---

test("guardar no vuelve a preguntar lo que ya se respondio", () => {
    const guardar = extraer("guardarPerfil");

    assert.match(
        guardar,
        /normalizeStoredStart\(profileDraft\.pendingExitDate \|\| ""\) \|\|\s*\n\s*await requestProfileInactivationDate\(/
    );
    const vuelta = guardar.slice(
        guardar.indexOf("if (isReactivating && !pendingHandoverReactivation) {"),
        guardar.indexOf("const nextRotationType =")
    );

    assert.match(
        vuelta,
        /if \(!profileDraft\.pendingReactivation\) \{\s*\n\s*const decision = await resolveProfileReactivation\(/
    );
    // Lo respondido en la casilla NO se vuelve a imponer: si despues se cambio
    // la rotativa desde la ficha, eso es lo que vale. Por eso las
    // asignaciones viven DENTRO del "si todavia no se respondio".
    assert.ok(
        vuelta.indexOf("if (!profileDraft.pendingReactivation)") <
            vuelta.indexOf("profileDraft.rotationStart = decision.startDate;"),
        "las asignaciones tienen que quedar dentro de la guarda"
    );
    assert.match(
        vuelta,
        /reactivationFrom = normalizeStoredStart\(\s*\n?\s*profileDraft\.rotationStart \|\| ""\s*\n?\s*\);/
    );
    // Y al guardar se limpia, para que no se reuse en el proximo cambio.
    assert.match(guardar, /profileDraft\.pendingExitDate = "";/);
    assert.match(guardar, /profileDraft\.pendingReactivation = null;/);
});

test("la casilla dispara la pregunta", () => {
    assert.match(
        main,
        /profileDraft\.active =\s*\n\s*DOM\.profileActiveToggle\.checked;\s*\n\s*void resolveProfileActiveToggle\(\);/
    );
});

test("el cuadro de la rotativa sabe abrirse vacio y en un mes dado", () => {
    const abrir = extraer("openRotationConfigModal");

    assert.match(abrir, /const startEmpty = Boolean\(options\.startEmpty\);/);
    assert.match(abrir, /rotationStart: startEmpty\s*\n\s*\? ""/);
    assert.match(abrir, /options\.monthISO/);

    // Y el puente se lo pasa tal cual.
    const preguntas = extraer("askHandoverSchedule");

    assert.match(preguntas, /startEmpty,\s*\n\s*monthISO: openAt \|\| piso,/);
    // Con el piso puesto, abrir vacio no se pisa con la preseleccion.
    assert.match(preguntas, /!startEmpty &&/);
});
