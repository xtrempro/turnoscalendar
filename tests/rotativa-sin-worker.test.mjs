// Al guardar un perfil nuevo aparecia "El Web Worker dejo de responder." y la
// rotativa no quedaba escrita: el calendario se guardaba vacio.
//
// La pestaña llevaba abierta desde antes de un despliegue, asi que pedia el
// archivo del Worker con el hash viejo; ese archivo ya no existe y el servidor
// responde el index.html, que el navegador rechaza por MIME. El Worker nunca
// arranca y applyGeneratedSchedule se quedaba sin entries.
//
// Ahora el motor del Worker tambien vive en el hilo principal: si el Worker no
// puede tomar la tarea, se calcula aqui y la rotativa se escribe igual.

import test from "node:test";
import assert from "node:assert/strict";
import {
    generateSchedule,
    runScheduleTask
} from "../js/workers/scheduleWorker.js";

const ROTATIVA = {
    startISO: "2026-10-15",
    endISO: "2026-11-30",
    mode: "sequence",
    sequence: [1, 0, 2, 0]
};

// Cada caso necesita su propio estado de modulo (el servicio recuerda que el
// Worker no sirve), de ahi la consulta en el import.
let caso = 0;

async function cargarServicio(WorkerFalso) {
    caso += 1;

    if (WorkerFalso) {
        globalThis.Worker = WorkerFalso;
    } else {
        delete globalThis.Worker;
    }

    return import(`../js/workerService.js?caso=${caso}`);
}

class WorkerBase {
    constructor() {
        // En la subclase, para poder contar por caso.
        this.constructor.creados = (this.constructor.creados || 0) + 1;
        this.listeners = new Map();
        this.terminado = false;
        this.enviados = [];
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    emit(type, event) {
        this.listeners.get(type)?.(event);
    }

    terminate() {
        this.terminado = true;
    }
}

// El caso real: el archivo del Worker ya no existe, el navegador avisa con un
// evento "error" DESPUES de que la tarea fue enviada.
class WorkerQueNoCarga extends WorkerBase {
    postMessage() {
        setTimeout(() => {
            this.emit("error", {
                message:
                    'Failed to load module script: The server responded with a ' +
                    'non-JavaScript MIME type of "text/html".'
            });
        }, 0);
    }
}

test("si el Worker no carga, la rotativa se calcula igual en la pestaña", async () => {
    WorkerQueNoCarga.creados = 0;

    const { generateScheduleInWorker } = await cargarServicio(WorkerQueNoCarga);
    const resultado = await generateScheduleInWorker(ROTATIVA, {
        channel: "rotation:Ana",
        timeoutMs: 20000
    });

    assert.deepEqual(resultado, generateSchedule(ROTATIVA));
    assert.equal(resultado.entries.length, 47);
    assert.deepEqual(
        resultado.entries.slice(0, 4).map(entry => entry.turn),
        [1, 0, 2, 0]
    );
});

test("una vez que se sabe que no sirve, no se vuelve a intentar", async () => {
    WorkerQueNoCarga.creados = 0;

    const { generateScheduleInWorker } = await cargarServicio(WorkerQueNoCarga);

    await generateScheduleInWorker(ROTATIVA);
    assert.equal(WorkerQueNoCarga.creados, 1);

    const segunda = await generateScheduleInWorker(ROTATIVA);

    assert.deepEqual(segunda, generateSchedule(ROTATIVA));
    assert.equal(WorkerQueNoCarga.creados, 1);
});

test("un navegador sin Web Workers tampoco pierde la rotativa", async () => {
    const { generateScheduleInWorker } = await cargarServicio(null);

    assert.deepEqual(
        await generateScheduleInWorker(ROTATIVA),
        generateSchedule(ROTATIVA)
    );
});

test("un error del motor sigue siendo un error, no se recalcula aqui", async () => {
    // El Worker contesta ok:false. Eso no es una falla del Worker, asi que el
    // respaldo no corresponde: el error tiene que llegar a quien pidio la
    // tarea. La rotativa de la prueba es valida a proposito, para que un
    // respaldo indebido se delate resolviendo en vez de fallar.
    class WorkerQueRechaza extends WorkerBase {
        postMessage(message) {
            setTimeout(() => {
                this.emit("message", {
                    data: {
                        taskId: message.taskId,
                        ok: false,
                        error: "El motor rechazó la rotativa."
                    }
                });
            }, 0);
        }
    }

    const { generateScheduleInWorker } = await cargarServicio(WorkerQueRechaza);

    await assert.rejects(
        generateScheduleInWorker(ROTATIVA),
        /El motor rechazó la rotativa/
    );
});

test("cancelar sigue cancelando: no se calcula a espaldas de quien cancelo", async () => {
    const control = new AbortController();

    class WorkerQueMuereAlCancelar extends WorkerBase {
        postMessage() {
            setTimeout(() => {
                control.abort();
                // El Worker tambien se cae, para que el respaldo tenga la
                // tentacion de contestar igual.
                this.emit("error", { message: "sin archivo" });
            }, 0);
        }
    }

    const { generateScheduleInWorker } = await cargarServicio(
        WorkerQueMuereAlCancelar
    );

    await assert.rejects(
        generateScheduleInWorker(ROTATIVA, { signal: control.signal }),
        error => error.name === "AbortError"
    );
});

test("cancelado de antemano no llega a crear el Worker", async () => {
    WorkerQueNoCarga.creados = 0;

    const { generateScheduleInWorker } = await cargarServicio(WorkerQueNoCarga);
    const control = new AbortController();
    control.abort();

    await assert.rejects(
        generateScheduleInWorker(ROTATIVA, { signal: control.signal }),
        error => error.name === "AbortError"
    );
    assert.equal(WorkerQueNoCarga.creados, 0);
});

test("el Worker sano sigue siendo quien calcula", async () => {
    class WorkerQueResponde extends WorkerBase {
        postMessage(message) {
            this.enviados.push(message);
            setTimeout(() => {
                this.emit("message", {
                    data: {
                        taskId: message.taskId,
                        ok: true,
                        payload: { entries: [{ iso: "2026-10-15", keyDay: "d1", turn: 9 }] }
                    }
                });
            }, 0);
        }
    }

    const { generateScheduleInWorker } = await cargarServicio(WorkerQueResponde);
    const resultado = await generateScheduleInWorker(ROTATIVA);

    // El turno 9 no existe en el motor: prueba que la respuesta vino del
    // Worker y no del calculo local.
    assert.deepEqual(resultado.entries, [
        { iso: "2026-10-15", keyDay: "d1", turn: 9 }
    ]);
});

test("importar el motor en el hilo principal no lo deja escuchando la ventana", async () => {
    // `self` en el hilo principal es la ventana: si el motor se registrara ahi,
    // contestaria cualquier postMessage ajeno con otro postMessage a si mismo.
    const ventana = {
        escuchas: [],
        addEventListener(type, handler) {
            this.escuchas.push([type, handler]);
        },
        postMessage() {
            throw new Error("el motor no debe hablarle a la ventana");
        }
    };

    globalThis.self = ventana;
    try {
        await import("../js/workers/scheduleWorker.js?ventana=1");
        assert.deepEqual(ventana.escuchas, []);
    } finally {
        delete globalThis.self;
    }
});

test("dentro de un Worker de verdad si escucha y responde", async () => {
    class WorkerGlobalScopeFalso {
        constructor() {
            this.escuchas = new Map();
            this.respuestas = [];
        }

        addEventListener(type, handler) {
            this.escuchas.set(type, handler);
        }

        postMessage(data) {
            this.respuestas.push(data);
        }
    }

    const alcance = new WorkerGlobalScopeFalso();

    globalThis.WorkerGlobalScope = WorkerGlobalScopeFalso;
    globalThis.self = alcance;
    try {
        await import("../js/workers/scheduleWorker.js?alcance=1");

        const escucha = alcance.escuchas.get("message");
        assert.equal(typeof escucha, "function");

        escucha({
            data: { taskId: "t1", type: "GENERATE_SCHEDULE", payload: ROTATIVA }
        });

        assert.deepEqual(alcance.respuestas, [
            { taskId: "t1", ok: true, payload: generateSchedule(ROTATIVA) }
        ]);
    } finally {
        delete globalThis.WorkerGlobalScope;
        delete globalThis.self;
    }
});

test("el respaldo usa el mismo despachador que el Worker", () => {
    assert.deepEqual(
        runScheduleTask("GENERATE_SCHEDULE", ROTATIVA),
        generateSchedule(ROTATIVA)
    );
});
