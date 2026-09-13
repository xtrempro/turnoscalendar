// El documento del memorandum, visto desde la casilla del calendario.
//
// Un permiso de 10 feriados legales genera UN memorandum y UN documento de
// respaldo. Antes ese documento solo se veia en el menu MEMOS: desde el
// calendario no habia forma de llegar a el, ni de subirlo si faltaba. Aca se
// verifica que las 10 casillas lleguen al mismo memorandum -incluidos los dias
// que el rango salta, porque un feriado legal cuenta dias habiles- y que el
// panel ofrezca eliminarlo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, dataset: {}, appendChild() {} })
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const {
    createLeaveMemoTask,
    findClockMemoForDay,
    findLeaveMemoForDay,
    getMemoById,
    getMemoDocuments,
    getMemos,
    createClockMemoTask
} = await import("../js/memos.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const calendar = await read("../js/calendar.js");
const memos = await read("../js/memos.js");
const leaveEngine = await read("../js/leaveEngine.js");
const styles = await read("../styles.css");

const PROFILE = "CAMILA ESTRELLA NORAMBUENA DELGADO";

// Las claves del calendario llevan el mes en base 0: "2026-8-16" es el 16 de
// septiembre de 2026.
function aplicarFeriadoLegal(keys) {
    localStorage.clear();

    return createLeaveMemoTask({
        profile: PROFILE,
        typeLabel: "F. Legal",
        amount: keys.length,
        startKey: keys[0],
        endKey: keys[keys.length - 1],
        sourceType: "legal",
        keys
    });
}

/* =========================================================
   De la casilla al memorandum
========================================================= */

test("cualquier dia del permiso llega al mismo memorandum", () => {
    const keys = [
        "2026-8-14", "2026-8-15", "2026-8-16",
        "2026-8-17", "2026-8-18"
    ];
    const memo = aplicarFeriadoLegal(keys);

    keys.forEach(keyDay => {
        assert.equal(
            findLeaveMemoForDay({
                profile: PROFILE,
                leaveType: "legal",
                keyDay
            })?.id,
            memo.id,
            keyDay
        );
    });
});

test("los dias que el permiso salta NO caen en el memorandum", () => {
    // Un feriado legal cuenta dias habiles: el sabado y el domingo que quedan
    // dentro del rango no son parte del permiso, y su casilla no es una casilla
    // del permiso. Por eso se guardan los dias exactos y no solo el rango.
    const memo = aplicarFeriadoLegal([
        "2026-8-11", "2026-8-14", "2026-8-15"
    ]);

    assert.equal(memo.keys.length, 3);
    assert.equal(
        findLeaveMemoForDay({
            profile: PROFILE,
            leaveType: "legal",
            keyDay: "2026-8-12"
        }),
        null
    );
});

test("un memorandum viejo, sin los dias, cae al rango", () => {
    // Lo aplicado antes de este cambio no trae ni leaveType ni keys: el tipo
    // sale del sourceId y los dias del rango de inicio y termino. Sin esto, el
    // documento ya adjunto quedaria inalcanzable desde el calendario.
    localStorage.clear();
    localStorage.setItem("memos", JSON.stringify([{
        id: "memo_viejo",
        sourceId: "leave:legal:" + PROFILE + ":2026-8-14:2026-8-18:5",
        profile: PROFILE,
        typeLabel: "F. Legal",
        startKey: "2026-8-14",
        endKey: "2026-8-18",
        status: "pending",
        createdAt: "2026-08-31T12:00:00.000Z",
        documents: []
    }]));

    assert.equal(
        findLeaveMemoForDay({
            profile: PROFILE,
            leaveType: "legal",
            keyDay: "2026-8-16"
        })?.id,
        "memo_viejo"
    );
    assert.equal(
        findLeaveMemoForDay({
            profile: PROFILE,
            leaveType: "legal",
            keyDay: "2026-8-19"
        }),
        null
    );
});

test("el permiso de otro tipo no comparte el documento", () => {
    // Dos permisos distintos el mismo dia son dos memorandum distintos: el
    // respaldo de uno no sirve para el otro.
    aplicarFeriadoLegal(["2026-8-14"]);

    assert.equal(
        findLeaveMemoForDay({
            profile: PROFILE,
            leaveType: "admin",
            keyDay: "2026-8-14"
        }),
        null
    );
});

test("el medio administrativo comparte memorandum con el legado", () => {
    // El valor viejo 0.5 no distingue mañana de tarde; el memorandum si.
    localStorage.clear();
    const memo = createLeaveMemoTask({
        profile: PROFILE,
        typeLabel: "1/2 ADM Mañana",
        amount: 0.5,
        startKey: "2026-8-14",
        endKey: "2026-8-14",
        sourceType: "half_admin_morning",
        keys: ["2026-8-14"]
    });

    assert.equal(
        findLeaveMemoForDay({
            profile: PROFILE,
            leaveType: "half_admin",
            keyDay: "2026-8-14"
        })?.id,
        memo.id
    );
});

test("el marcaje incompleto llega por su dia", () => {
    localStorage.clear();
    const memo = createClockMemoTask({
        profile: PROFILE,
        dateKey: "2026-8-14",
        missingExit: true
    });

    assert.equal(
        findClockMemoForDay({ profile: PROFILE, keyDay: "2026-8-14" })?.id,
        memo.id
    );
    assert.equal(
        findClockMemoForDay({ profile: PROFILE, keyDay: "2026-8-15" }),
        null
    );
});

/* =========================================================
   Los dias exactos llegan desde donde se aplica el permiso
========================================================= */

test("cada permiso que genera memorandum manda sus dias", () => {
    // Sin esto el memorandum solo sabe el rango, y las casillas de un permiso
    // con saltos quedan mal asociadas.
    assert.match(leaveEngine, /sourceType: "admin",\s*\n\s*keys\s*\n/);
    assert.match(leaveEngine, /sourceType: "legal",\s*\n\s*keys: nuevos\s*\n/);
    assert.match(leaveEngine, /sourceType: "comp",\s*\n\s*keys: nuevos\s*\n/);
    assert.match(leaveEngine, /sourceType: "unpaid_leave",\s*\n\s*keys\s*\n/);
    assert.match(
        leaveEngine,
        /: "half_admin_afternoon",\s*\n\s*keys: \[key\]\s*\n/
    );
});

/* =========================================================
   Que el documento se pueda abrir, subir y eliminar
========================================================= */

test("un documento sin contenido no cuenta como documento", () => {
    // Mismo criterio que las licencias: si no se puede abrir, no es respaldo.
    localStorage.clear();
    localStorage.setItem("memos", JSON.stringify([{
        id: "memo_1",
        sourceId: "leave:legal:x:2026-8-14:2026-8-14:1",
        profile: PROFILE,
        documents: [
            { id: "a", name: "sin-contenido.pdf" },
            { id: "b", name: "vale.pdf", storagePath: "workspaces/x/y/b" }
        ]
    }]));

    assert.deepEqual(
        getMemoDocuments("memo_1").map(doc => doc.id),
        ["b"]
    );
});

test("al eliminar, primero se borra el archivo y despues la referencia", () => {
    // Al reves, un fallo al eliminar dejaria un archivo huerfano en Storage que
    // ya nadie puede alcanzar.
    assert.match(
        memos,
        /await deleteStoredAttachment\(document\);\s*\n\s*\n\s*const memo = setMemoDocuments\(/
    );
});

test("subir exige que el archivo haya quedado guardado", () => {
    assert.match(
        memos,
        /if \(!hasAttachmentContent\(document\)\) \{[\s\S]{0,120}throw new Error/
    );
});

test("el panel de memos ofrece eliminar el documento", () => {
    // Antes solo se podia adjuntar: un documento equivocado quedaba para
    // siempre. En el visor es el boton del tacho, al lado del zoom.
    assert.match(
        memos,
        /data-mem-act="remove-doc" data-mem-doc-id="\$\{attr\(doc\.id\)\}"/
    );
    assert.match(memos, /case "remove-doc": \{/);
    assert.match(memos, /confirmText: "Eliminar"/);
    assert.match(styles, /\.mem-iconbtn--danger/);
});

/* =========================================================
   Donde aparece el boton en el calendario
========================================================= */

test("los tres cuadros de la casilla ofrecen el documento", () => {
    // Detalle del permiso, cuadro de reemplazo (el que se abre cuando el turno
    // sigue sin cubrir) y detalle del marcaje.
    assert.equal(
        calendar.match(/data-action='leave-docs'/g)?.length,
        3
    );
    assert.match(calendar, /const memoDocsButton = documentsButtonHTML\(/);
    assert.match(
        calendar,
        /openDocumentsForTarget\(documentsTarget, profile\)/
    );
});

test("adjuntar desde la casilla escribe en el memorandum", () => {
    // Es lo que hace que el documento aparezca despues en el menu MEMOS: no hay
    // una copia aparte para el calendario.
    assert.match(calendar, /add: file => addMemoDocument\(memoId, file\)/);
    assert.match(
        calendar,
        /remove: documentId => removeMemoDocument\(memoId, documentId\)/
    );
    assert.match(calendar, /list: \(\) => getMemoDocuments\(memoId\)/);
});

test("manda el permiso de MEMOS, no el del calendario", () => {
    // El archivo vive en el modulo memos: storage.rules lo juzga con ese
    // permiso, asi que el cuadro tiene que gatearse igual.
    assert.match(calendar, /canEdit: canEditTarget\("memosPanel"\)/);
    assert.match(calendar, /if \(!memo \|\| !canViewTarget\("memosPanel"\)\) return null;/);
});

test("una licencia medica sigue usando su propio respaldo", () => {
    // Las licencias no generan memorandum: su documento cuelga del registro del
    // LOG. Los dos caminos no se pisan.
    assert.match(calendar, /if \(leaveTypeNeedsDocument\(type\)\) \{/);
    assert.match(calendar, /kind: "leave",/);
});

test("el documento viaja con el resto del entorno", () => {
    // Va dentro de la clave "memos", que ya es un modulo sincronizado: si
    // quedara solo en el navegador del supervisor, otro no lo veria.
    localStorage.clear();
    const memo = aplicarFeriadoLegal(["2026-8-14"]);

    assert.ok(getMemoById(memo.id));
    assert.equal(getMemos().length, 1);
    assert.ok(localStorage.getItem("memos").includes(memo.id));
});
