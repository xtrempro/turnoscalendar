// Mover el inicio de la rotativa hacia adelante hacia desaparecer el pasado.
//
// El motor no guarda un turno por dia: lo CALCULA desde el ancla de la rotativa
// (tipo + primer turno + fecha de inicio). El 2026-10-20, al reactivar a un
// trabajador de SAMU cuya rotativa estaba anclada al 2026-01-02, el ancla paso
// al 2026-10-08 y con eso se apagaron nueve meses de turnos: septiembre entero
// y el 1 al 7 de octubre quedaron en blanco. Nadie los borro -no habia nada
// escrito que borrar-, simplemente dejaron de calcularse.
//
// Para el supervisor, para los reportes y para la app del trabajador eso es
// una perdida de datos: son dias efectivamente trabajados.
//
// Ahora, antes de mover el ancla, esos dias se escriben como turnos de verdad.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateSchedule } from "../js/workers/scheduleWorker.js";

const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const rotationApply = await leer("../js/rotationApply.js");

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

    assert.notEqual(cuerpo, -1, `no encontre el cuerpo de ${nombre}`);

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

// 4to turno: largo, largo, noche, noche, libre, libre... (la secuencia real la
// trae rotationUtils; aqui basta una que produzca turnos y libres).
const SECUENCIA = [1, 1, 2, 2, 0, 0];

function montarCongelado({
    data = {},
    baseData = {},
    blocked = {},
    perfil = "Emilio",
    honorarios = false
}) {
    const guardado = { data: null, baseData: null, blocked: null };
    const pedidos = [];
    const fabrica = new Function(
        "getCurrentProfile",
        "getProfileData",
        "getBaseProfileData",
        "getBlockedDays",
        "saveProfileData",
        "saveBaseProfileData",
        "saveBlockedDays",
        "rotationUsesBusinessDays",
        "rotationBusinessDayTurn",
        "fetchHolidays",
        "getRotationSequence",
        "generateScheduleInWorker",
        "isHonorariaProfile",
        `${extraer(rotationApply, "freezeRotationBeforeStart")}
         return freezeRotationBeforeStart;`
    );

    return {
        guardado,
        pedidos,
        data,
        congelar: fabrica(
            () => perfil,
            () => data,
            () => baseData,
            () => blocked,
            valor => { guardado.data = valor; },
            valor => { guardado.baseData = valor; },
            valor => { guardado.blocked = valor; },
            tipo => tipo === "diurno",
            () => 4,
            async () => ({}),
            () => SECUENCIA,
            async payload => {
                pedidos.push(payload);
                return generateSchedule(payload);
            },
            () => honorarios
        )
    };
}

test("escribe los turnos que la rotativa anterior venia calculando", async () => {
    const { congelar, guardado, pedidos } = montarCongelado({});

    const escritos = await congelar({
        type: "4turno",
        firstTurn: "larga",
        fromISO: "2026-01-02",
        untilISO: "2026-10-07"
    });

    // Se le pide al mismo generador que aplica las rotativas, con el rango
    // exacto que va a dejar de calcularse.
    assert.equal(pedidos[0].startISO, "2026-01-02");
    assert.equal(pedidos[0].endISO, "2026-10-07");
    assert.ok(escritos > 150, `se esperaban muchos dias, hubo ${escritos}`);

    // Los dias libres no se escriben: el motor ya los da por libres.
    const turnos = Object.values(guardado.data);

    assert.ok(turnos.length === escritos);
    assert.ok(turnos.every(turno => turno !== 0));
    // Y quedan bloqueados, como cualquier dia de rotativa aplicada.
    assert.equal(Object.keys(guardado.blocked).length, escritos);
    assert.deepEqual(guardado.baseData, guardado.data);
});

test("no pisa lo que ya estaba escrito", async () => {
    // Un cambio de turno, un turno cargado a mano o lo que dejo un permiso.
    const { congelar, guardado } = montarCongelado({
        data: { "2026-0-2": 9 },
        baseData: { "2026-0-3": 8 }
    });

    await congelar({
        type: "4turno",
        firstTurn: "larga",
        fromISO: "2026-01-02",
        untilISO: "2026-01-10"
    });

    assert.equal(guardado.data["2026-0-2"], 9, "el turno de antes manda");
    assert.equal(guardado.data["2026-0-3"], undefined, "ni se toca el dia que ya tenia base");
});

test("sin rotativa anterior no hay nada que conservar", async () => {
    for (const rotativa of [
        { type: "", fromISO: "2026-01-02", untilISO: "2026-10-07" },
        { type: "libre", fromISO: "2026-01-02", untilISO: "2026-10-07" },
        { type: "4turno", fromISO: "", untilISO: "2026-10-07" },
        { type: "4turno", fromISO: "2026-01-02", untilISO: "" },
        // El ancla se movio hacia ATRAS: esos dias los cubre la nueva.
        { type: "4turno", fromISO: "2026-10-08", untilISO: "2026-01-01" }
    ]) {
        const { congelar, guardado } = montarCongelado({});

        assert.equal(await congelar(rotativa), 0, JSON.stringify(rotativa));
        assert.equal(guardado.data, null, "no se guarda nada");
    }
});

test("si no hay nada nuevo que escribir, no se guarda por guardar", async () => {
    const { congelar, guardado } = montarCongelado({
        // Todo el rango ya esta escrito.
        data: { "2026-0-2": 1, "2026-0-3": 1, "2026-0-4": 2, "2026-0-5": 2 }
    });

    assert.equal(
        await congelar({
            type: "4turno",
            firstTurn: "larga",
            fromISO: "2026-01-02",
            untilISO: "2026-01-06"
        }),
        0
    );
    assert.equal(guardado.data, null);
});

// --- Cuando se llama ---

function montarHistoria({ previa, nuevoInicio }) {
    const llamadas = [];
    const avisos = [];
    const fabrica = new Function(
        "normalizeStoredStart",
        "previousCalendarISO",
        "compareISODate",
        "freezeRotationBeforeStart",
        "formatDisplayDate",
        "showAlert",
        "console",
        `${extraer(main, "freezeRotationHistory")}
         return freezeRotationHistory;`
    );

    return {
        llamadas,
        avisos,
        conservar: fabrica(
            valor => String(valor || ""),
            iso => {
                if (!iso) return "";
                const fecha = new Date(`${iso}T00:00:00Z`);
                fecha.setUTCDate(fecha.getUTCDate() - 1);
                return fecha.toISOString().slice(0, 10);
            },
            (a, b) => String(a).localeCompare(String(b)),
            async opciones => {
                llamadas.push(opciones);
                if (opciones.type === "explota") throw new Error("sin motor");
                return 10;
            },
            iso => iso,
            async mensaje => { avisos.push(mensaje); },
            { warn() {} }
        )(
            { rotativa: previa },
            nuevoInicio
        )
    };
}

test("al reactivar se conserva desde el ancla vieja hasta el dia anterior", async () => {
    const { conservar, llamadas } = montarHistoria({
        previa: { type: "4turno", start: "2026-01-02", firstTurn: "larga" },
        nuevoInicio: "2026-10-08"
    });

    await conservar;

    assert.deepEqual(llamadas, [{
        type: "4turno",
        firstTurn: "larga",
        fromISO: "2026-01-02",
        untilISO: "2026-10-07"
    }]);
});

test("si el ancla no se mueve hacia adelante, no se escribe nada", async () => {
    for (const nuevoInicio of ["2026-01-02", "2025-12-01"]) {
        const { conservar, llamadas } = montarHistoria({
            previa: { type: "4turno", start: "2026-01-02" },
            nuevoInicio
        });

        await conservar;

        assert.deepEqual(llamadas, [], nuevoInicio);
    }
});

test("un perfil sin rotativa anterior no dispara nada", async () => {
    const { conservar, llamadas } = montarHistoria({
        previa: {},
        nuevoInicio: "2026-10-08"
    });

    await conservar;

    assert.deepEqual(llamadas, []);
});

test("si conservar falla, la rotativa NO se cambia", async () => {
    // Avisar y seguir dejaba exactamente la perdida que esto evita: el ancla
    // se movia igual y esos dias se apagaban.
    const { conservar, avisos } = montarHistoria({
        previa: { type: "explota", start: "2026-01-02" },
        nuevoInicio: "2026-10-08"
    });

    assert.equal(await conservar, false);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /no se cambió|no se pudieron conservar/i);
});

test("cuando se conserva -o no hay nada que conservar- el guardado sigue", async () => {
    const conMovimiento = montarHistoria({
        previa: { type: "4turno", start: "2026-01-02" },
        nuevoInicio: "2026-10-08"
    });
    const sinMovimiento = montarHistoria({
        previa: {},
        nuevoInicio: "2026-10-08"
    });

    assert.equal(await conMovimiento.conservar, true);
    assert.equal(await sinMovimiento.conservar, true);
});

test("en Honorarios no se inventa nada", async () => {
    // Para Honorarios el motor NUNCA calcula la secuencia: sus turnos se
    // escriben uno a uno dentro de cada contrato. Mover el ancla no apaga
    // nada, y rellenar aqui pintaria dias trabajados fuera de todo contrato.
    const { congelar, guardado, pedidos } = montarCongelado({ honorarios: true });

    assert.equal(
        await congelar({
            type: "4turno",
            firstTurn: "larga",
            fromISO: "2026-01-02",
            untilISO: "2026-10-07"
        }),
        0
    );
    assert.deepEqual(pedidos, [], "ni se le pide al generador");
    assert.equal(guardado.data, null);
});

test("se conserva ANTES de guardar el ancla nueva", () => {
    // Guardar el ancla primero deja una ventana en que esos dias no los
    // calcula nadie, y si conservar falla ahi, ya se perdieron.
    const guardar = extraer(main, "saveProfileNow");
    const conserva = guardar.indexOf("!await freezeRotationHistory(previousSnapshot, nextRotationStart)");
    const ancla = guardar.indexOf("saveRotativa({");
    const aplica = guardar.indexOf("await applyDraftRotation(");

    assert.notEqual(conserva, -1);
    assert.notEqual(ancla, -1);
    assert.ok(conserva < ancla, "conservar va antes de guardar el ancla");
    assert.ok(ancla < aplica, "y el ancla antes de aplicar, como siempre");
    // Y si no se pudo conservar, el guardado se detiene ahi.
    assert.match(
        guardar.slice(conserva, conserva + 200),
        /\)\s*\)\s*\{\s*return false;\s*\}/
    );
});
