// Al cambiar la rotativa se pierden los reemplazos, mire por donde se mire.
//
// `cancelFutureReplacementsForWorker` filtraba solo por `worker`: anulaba los
// reemplazos donde el trabajador iba a CUBRIR a otro, pero no aquellos donde
// OTRO lo cubria a el. Al reescribirse su calendario, esos registros quedaban
// cubriendo un turno que ya no existe como estaba, y el reemplazante seguia
// con su marca de "Reemplazo" en el dia.
//
// Importa ademas para el "!": si el permiso se conserva pero el reemplazo
// viejo sobrevive, el turno nuevo se ve cubierto y nadie vuelve a pedir
// cobertura.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key) {
        this.values.delete(key);
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

globalThis.localStorage = new MemoryStorage();
globalThis.document = {
    body: { dataset: {} },
    getElementById() {
        return null;
    },
    querySelector() {
        return null;
    },
    querySelectorAll() {
        return [];
    }
};

const {
    saveReplacement,
    cancelFutureReplacementsForWorker,
    cancelReplacementsForWorkerRange
} = await import("../js/replacements.js");
// La lista vive en el almacen, no en el modulo que la manipula.
const { getReplacements } = await import("../js/storage.js");
const { TURNO } = await import("../js/constants.js");

const AUSENTE = "Elena Rojas Torres";
const CUBRE = "Francisca Rojas Saavedra";
const AJENO = "Ana Rojas Campos";
// Clave interna: mes en base 0. Septiembre de 2026.
const SEP = day => `2026-8-${day}`;
const CORTE = "2026-09-01";

const registrar = (worker, replaced, day) => saveReplacement({
    worker,
    replaced,
    keyDay: SEP(day),
    turno: TURNO.NOCHE,
    reason: "Cobertura",
    source: "replacement"
});

const registro = fecha =>
    getReplacements().find(item => item.date === fecha);

beforeEach(() => {
    globalThis.localStorage.clear();
});

/* =========================================================
   Las dos puntas del reemplazo
========================================================= */

test("se anula el reemplazo donde OTRO lo cubre a el", () => {
    // Este es el que sobrevivia: el trabajador es el AUSENTE, no el que cubre.
    registrar(CUBRE, AUSENTE, 3);

    cancelFutureReplacementsForWorker(AUSENTE, CORTE);

    assert.equal(registro("2026-09-03").canceled, true);
});

test("y tambien el reemplazo donde el va a cubrir a otro", () => {
    // Lo que ya funcionaba: no hay que perderlo al ampliar el filtro.
    registrar(AUSENTE, AJENO, 5);

    cancelFutureReplacementsForWorker(AUSENTE, CORTE);

    assert.equal(registro("2026-09-05").canceled, true);
});

test("el reemplazo entre dos terceros no se toca", () => {
    registrar(CUBRE, AJENO, 7);

    cancelFutureReplacementsForWorker(AUSENTE, CORTE);

    assert.notEqual(registro("2026-09-07").canceled, true);
});

test("lo anterior a la fecha del cambio se respeta", () => {
    registrar(CUBRE, AUSENTE, 3);

    cancelFutureReplacementsForWorker(AUSENTE, "2026-09-10");

    assert.notEqual(registro("2026-09-03").canceled, true);
});

/* =========================================================
   La variante por rango (rotativa historica)
========================================================= */

test("por rango tambien se anula la punta del cubierto", () => {
    registrar(CUBRE, AUSENTE, 12);

    cancelReplacementsForWorkerRange(AUSENTE, CORTE, "2026-09-30");

    assert.equal(registro("2026-09-12").canceled, true);
});

test("por rango, lo de despues del tramo queda intacto", () => {
    registrar(CUBRE, AUSENTE, 25);

    cancelReplacementsForWorkerRange(AUSENTE, CORTE, "2026-09-20");

    assert.notEqual(registro("2026-09-25").canceled, true);
});

/* =========================================================
   El motivo de todo esto
========================================================= */

test("anulado deja de contar como cobertura vigente", () => {
    // Si siguiera vigente, el turno nuevo se veria cubierto y no volveria a
    // pedir cobertura: el "!" no reapareceria nunca.
    registrar(CUBRE, AUSENTE, 3);
    cancelFutureReplacementsForWorker(AUSENTE, CORTE);

    const anulado = registro("2026-09-03");

    assert.equal(anulado.cancelReason, "rotation_reset");
    assert.ok(anulado.canceledAt, "sin marca de cuando se anulo");
});
