// El menu Memorandum rediseñado (2026-09).
//
// Lo que se cuida aca es la regla que cambio todo: el estado ya no se marca a
// mano, lo decide el adjunto. Pendiente mientras no haya documento, realizado
// apenas se adjunta el primero, y de vuelta a pendiente si se elimina. Lo
// demas -atrasados, indicadores, agrupacion- cuelga de esa misma regla.
import assert from "node:assert/strict";
import test from "node:test";
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

const insights = await import("../js/memosInsights.js");
const { memoListPrintHTML } = await import("../js/memosPrint.js");
const {
    createLeaveMemoTask,
    getMemoById,
    getMemos
} = await import("../js/memos.js");

async function read(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    return source.replace(/\r\n/g, "\n");
}

const memosSource = await read("../js/memos.js");
const styles = await read("../styles.css");

const HOY = "2026-09-12";
const PROFILE = "ANGELICA ANDREA SALGADO SILVA";

// Las claves del calendario llevan el mes en base 0: "2026-8-10" es el 10 de
// septiembre de 2026.
function memo(extra = {}) {
    return {
        id: "m1",
        sourceId: `leave:legal:${PROFILE}:2026-8-10:2026-8-10:1`,
        profile: PROFILE,
        typeLabel: "F. Legal",
        detail: `Nombre: ${PROFILE} | Permiso: 1 F. Legal | Fecha inicio: 10-09-2026 | Fecha termino: 10-09-2026`,
        startKey: "2026-8-10",
        endKey: "2026-8-10",
        keys: ["2026-8-10"],
        createdAt: "2026-09-10T21:20:00.000Z",
        documents: [],
        ...extra
    };
}

function documento(extra = {}) {
    return {
        id: "d1",
        name: "ResEx_2026051601028771.pdf",
        type: "application/pdf",
        storagePath: "workspaces/w/attachments/memos/m1/memo-documents/d1",
        attachedAt: "2026-09-11T10:00:00.000Z",
        resolution: "2026051601028771",
        issuedAt: "2026-09-09",
        ...extra
    };
}

/* =========================================================
   El adjunto es el que manda
========================================================= */

test("sin documento es pendiente; con uno, realizado", () => {
    assert.equal(insights.memoStatus(memo()), "pending");
    assert.equal(
        insights.memoStatus(memo({ documents: [documento()] })),
        "done"
    );
});

test("marcado realizado a mano, pero sin documento, vuelve a pendiente", () => {
    // Antes el estado se marcaba con una casilla y podia quedar mintiendo: un
    // memorandum "realizado" sin ningun respaldo adjunto.
    localStorage.clear();
    localStorage.setItem("memos", JSON.stringify([
        memo({ status: "completed", completedAt: "2026-09-11T09:00:00.000Z" })
    ]));

    const guardado = getMemoById("m1");

    assert.equal(guardado.status, "pending");
    assert.equal(guardado.completedAt, "");
    assert.equal(insights.memoStatus(guardado), "pending");
});

test("el documento adjunto deja el memorandum realizado", () => {
    localStorage.clear();
    localStorage.setItem("memos", JSON.stringify([
        memo({ documents: [documento()] })
    ]));

    const guardado = getMemoById("m1");

    assert.equal(guardado.status, "completed");
    assert.equal(guardado.completedAt, "2026-09-11T10:00:00.000Z");
    assert.equal(guardado.documents[0].resolution, "2026051601028771");
    assert.equal(guardado.documents[0].issuedAt, "2026-09-09");
});

test("aplicar de nuevo el mismo permiso no borra lo ya cobrado", () => {
    // createLeaveMemoTask se vuelve a llamar cada vez que se reaplica el
    // permiso: el documento y la anotacion de "se lo pedi" tienen que quedar.
    localStorage.clear();
    localStorage.setItem("memos", JSON.stringify([
        memo({
            documents: [documento()],
            requestedAt: "2026-09-11T09:00:00.000Z"
        })
    ]));

    createLeaveMemoTask({
        profile: PROFILE,
        typeLabel: "F. Legal",
        amount: 1,
        startKey: "2026-8-10",
        endKey: "2026-8-10",
        sourceType: "legal",
        keys: ["2026-8-10"]
    });

    const guardado = getMemos()[0];

    assert.equal(guardado.documents.length, 1);
    assert.equal(guardado.requestedAt, "2026-09-11T09:00:00.000Z");
    assert.equal(guardado.status, "completed");
});

/* =========================================================
   Lo que se esta atrasando
========================================================= */

test("a los 15 dias sin documento el memorandum queda atrasado", () => {
    const viejo = memo({ createdAt: "2026-08-20T10:00:00.000Z" });

    assert.equal(insights.memoDaysOld(viejo, HOY), 23);
    assert.equal(insights.memoIsOverdue(viejo, HOY), true);
    // Justo en el limite todavia no: se cuenta "mas de 15 dias".
    assert.equal(
        insights.memoIsOverdue(
            memo({ createdAt: "2026-08-28T10:00:00.000Z" }),
            HOY
        ),
        false
    );
});

test("un memorandum viejo CON documento no esta atrasado", () => {
    assert.equal(
        insights.memoIsOverdue(
            memo({
                createdAt: "2026-08-20T10:00:00.000Z",
                documents: [documento()]
            }),
            HOY
        ),
        false
    );
});

test("los atrasados no dependen del periodo elegido", () => {
    // El atrasado de otro mes es justamente el que se pierde de vista: el
    // indicador lo cuenta igual aunque el filtro sea de septiembre.
    const lista = [
        memo({ id: "a", createdAt: "2026-07-01T10:00:00.000Z", startKey: "2026-6-05", endKey: "2026-6-05", keys: ["2026-6-05"] }),
        memo({ id: "b", createdAt: "2026-09-11T10:00:00.000Z" })
    ];
    const kpis = insights.memoKpis(lista, HOY, "2026-09");
    const buscar = id => kpis.find(kpi => kpi.id === id).value;

    assert.equal(buscar("atrasados"), 1);
    assert.equal(buscar("pendientes"), 2);
});

test("los indicadores cuentan pedidos, realizados del periodo y personas", () => {
    const lista = [
        memo({ id: "a", requestedAt: "2026-09-11T09:00:00.000Z" }),
        memo({ id: "b", profile: "OTRA PERSONA" }),
        memo({ id: "c", documents: [documento()] })
    ];
    const kpis = insights.memoKpis(lista, HOY, "2026-09");
    const buscar = id => kpis.find(kpi => kpi.id === id).value;

    assert.equal(buscar("pedidos"), 1);
    assert.equal(buscar("realizados"), 1);
    assert.equal(buscar("personas"), 2);
});

test("cada indicador trae el filtro que aplica al tocarlo", () => {
    // Si el numero y la lista se calcularan por separado, podrian no calzar.
    const lista = [
        memo({ id: "a", createdAt: "2026-07-01T10:00:00.000Z" }),
        memo({ id: "b", documents: [documento()] })
    ];
    const kpis = insights.memoKpis(lista, HOY, "all");
    const filtrar = id => lista.filter(kpis.find(kpi => kpi.id === id).match);

    assert.deepEqual(filtrar("atrasados").map(item => item.id), ["a"]);
    assert.deepEqual(filtrar("realizados").map(item => item.id), ["b"]);
});

/* =========================================================
   Origen, periodo, orden y agrupacion
========================================================= */

test("el origen sale del sourceId", () => {
    assert.equal(insights.memoKind(memo()), "leave");
    assert.equal(
        insights.memoKind(memo({ sourceId: "clock:X:2026-8-10:turno" })),
        "clock"
    );
    assert.equal(
        insights.memoKind(memo({ sourceId: "replacement_contract:X:1:2:3" })),
        "contract"
    );
    assert.equal(insights.memoKind(memo({ sourceId: "manual:X:Y" })), "manual");
});

test("el periodo es el mes del permiso, no el de cuando se aplico", () => {
    // Un feriado de octubre pedido en septiembre se busca en octubre.
    const octubre = memo({
        createdAt: "2026-09-04T17:28:00.000Z",
        startKey: "2026-9-06",
        endKey: "2026-9-06",
        keys: ["2026-9-06"]
    });

    assert.equal(insights.memoMonth(octubre), "2026-10");
    assert.equal(insights.memoStartISO(octubre), "2026-10-06");
});

test("primero lo que falta y, dentro de eso, lo mas viejo arriba", () => {
    const lista = [
        memo({ id: "realizado", documents: [documento()] }),
        memo({ id: "nuevo", createdAt: "2026-09-11T10:00:00.000Z" }),
        memo({ id: "atrasado", createdAt: "2026-08-01T10:00:00.000Z" })
    ];

    assert.deepEqual(
        insights.sortMemosForList(lista, HOY).map(item => item.id),
        ["atrasado", "nuevo", "realizado"]
    );
});

test("los trabajadores con mas pendientes quedan arriba", () => {
    const lista = [
        memo({ id: "a", profile: "UNO", documents: [documento()] }),
        memo({ id: "b", profile: "DOS" }),
        memo({ id: "c", profile: "DOS" })
    ];
    const grupos = insights.groupByWorker(lista);

    assert.deepEqual(grupos.map(group => group.name), ["DOS", "UNO"]);
    assert.equal(grupos[0].pending, 2);
    assert.equal(grupos[1].pending, 0);
});

/* =========================================================
   Lo que se lee en cada fila
========================================================= */

test("la fila del permiso muestra la cantidad en dias, las fechas y el turno", () => {
    // Igual que el documento: "Por 5 dias", no "5 F. Legal".
    const facts = insights.memoFacts(memo({
        detail: "Nombre: X | Permiso: 5 F. Legal | Fecha inicio: 10-09-2026",
        startKey: "2026-8-10",
        endKey: "2026-8-14",
        keys: ["2026-8-10", "2026-8-11", "2026-8-12"]
    }), { shift: "4° Turno" });

    assert.deepEqual(facts[0], { label: "Cantidad", value: "5 días" });
    assert.equal(facts[1].label, "Desde / hasta");
    assert.equal(facts[1].value, "10-09-2026 al 14-09-2026");
    assert.deepEqual(facts[2], { label: "Turno", value: "4° Turno" });
});

test("el medio dia se lee como medio dia, y sin rotativa no se inventa turno", () => {
    const facts = insights.memoFacts(memo({
        typeLabel: "1/2 ADM Tarde",
        detail: "Nombre: X | Permiso: 1/2 ADM Tarde | Fecha inicio: 02-09-2026"
    }));

    assert.deepEqual(facts[0], { label: "Cantidad", value: "1/2 día" });
    assert.equal(facts.length, 2);
});

test("la fila del marcaje dice que falta y de que turno", () => {
    const clock = memo({
        sourceId: "clock:X:2026-8-06:turno",
        typeLabel: "Marcaje incompleto",
        detail: "Nombre: X | Fecha: 06-09-2026 | Falta de marcaje: entrada y salida | Turno: Noche 20:00 a 08:00",
        dateKey: "2026-8-06",
        startKey: "",
        endKey: "",
        keys: []
    });
    const facts = insights.memoFacts(clock, { shift: "4° Turno" });

    assert.equal(insights.memoMissingMark(clock), "entrada y salida");
    assert.deepEqual(facts[0], { label: "Cantidad", value: "1 turno" });
    assert.equal(facts[1].value, "06-09-2026");
    // El turno de ese dia manda sobre la rotativa del perfil.
    assert.deepEqual(facts[2], { label: "Turno", value: "Noche 20:00 a 08:00" });
});

test("la fila del contrato cuenta sus dias y dice a quien reemplaza", () => {
    const facts = insights.memoFacts(memo({
        sourceId: "replacement_contract:X:1:2:3",
        typeLabel: "Contrato de reemplazo",
        detail: "Nombre: X | Inicio contrato: 15-09-2026 | Reemplaza a: K. SOTO | Motivo del reemplazo: licencia médica",
        startKey: "2026-8-15",
        endKey: "2026-10-13",
        keys: []
    }));

    assert.deepEqual(facts[0], { label: "Cantidad", value: "60 días" });
    assert.equal(facts[1].value, "15-09-2026 al 13-11-2026");
    assert.deepEqual(facts[2], {
        label: "Detalle",
        value: "Reemplaza a K. SOTO · licencia médica"
    });
});

/* =========================================================
   El documento se ve aqui mismo
========================================================= */

test("el visor dibuja el adjunto en la pagina, sin abrir otra pestaña", () => {
    // Es el cambio que pidio el usuario: revisar que el papel calce con el
    // permiso es lo que se hace todo el dia, y no puede costar una pestaña.
    assert.match(memosSource, /<iframe src="\$\{attr\(url\)\}#toolbar=0/);
    assert.match(memosSource, /<img src="\$\{attr\(url\)\}" alt="\$\{attr\(doc\.name\)\}">/);
    assert.match(memosSource, /data-mem-stage/);
    assert.match(memosSource, /async function hydrateViewer/);
});

test("TurnoPlus no dibuja el documento: lo emite el sistema de personal", () => {
    // Si alguna vez aparece aca un documento de diseño propio, es un error:
    // el que vale es el que se escanea o se descarga del otro sistema.
    assert.doesNotMatch(memosSource, /RESOLUCIÓN EXENTA N°/);
    assert.match(memosSource, /Documento del sistema de personal/);
});

test("la pantalla completa carga el documento en su propio cuadro", () => {
    // El visor del panel tambien tiene un [data-mem-stage] y esta antes en el
    // documento: sin separar los dos, el dialogo se quedaba en "Cargando".
    assert.match(memosSource, /hydrateViewer\(doc, "#memDialog"\)/);
    assert.match(memosSource, /const selector = `\$\{scope\} \[data-mem-stage\]`/);
});

test("el visor recuerda la URL resuelta de cada documento", () => {
    // Resolverla es una llamada a Storage y el visor se redibuja con cada
    // zoom: sin cache, acercar la imagen costaria una llamada por clic.
    assert.match(memosSource, /const previewUrls = new Map\(\)/);
    assert.match(memosSource, /if \(previewUrls\.has\(doc\.id\)\) return previewUrls\.get\(doc\.id\)/);
});

/* =========================================================
   El panel usa su propio bloque de estilos
========================================================= */

test("el panel se dibuja con el bloque mem-, aislado del resto", () => {
    assert.match(memosSource, /<div class="mem mem-root">/);
    assert.match(styles, /\.mem-root \{/);
    assert.match(styles, /:where\(\.mem\) button \{/);
    // El backdrop-filter de .panel crea un bloque contenedor que romperia el
    // position:fixed de los dialogos.
    assert.match(styles, /#memosPanel\.memos-panel \{[^}]*backdrop-filter: none;/);
});

test("los anchos se miden sobre el modulo, no sobre la ventana", () => {
    assert.match(styles, /container-name: mem;/);
    assert.match(styles, /@container mem \(max-width: 1100px\)/);
});

test("los dialogos cuelgan del body, fuera del panel", () => {
    assert.match(memosSource, /document\.body\.appendChild\(layer\)/);
    assert.match(memosSource, /id="memOverlay"/);
});

/* =========================================================
   El listado que se lleva a personal
========================================================= */

test("el listado impreso agrupa por trabajador y marca los atrasados", () => {
    const html = memoListPrintHTML({
        memos: [
            memo({ id: "a", createdAt: "2026-08-01T10:00:00.000Z" }),
            memo({ id: "b", profile: "OTRA PERSONA", documents: [documento()] })
        ],
        today: HOY,
        unitName: "Imagenología",
        printedAt: "12-09-2026 09:00",
        title: "Memorándums pendientes"
    });

    assert.match(html, /ANGELICA ANDREA SALGADO SILVA/);
    assert.match(html, /OTRA PERSONA/);
    assert.match(html, /42 días sin documento/);
    assert.match(html, /Res\. exenta N° 2026051601028771/);
    assert.match(html, /Imagenología/);
});

test("el listado vacio lo dice, no imprime una hoja en blanco", () => {
    assert.match(
        memoListPrintHTML({ memos: [], today: HOY }),
        /No hay memorándums en este filtro/
    );
});
