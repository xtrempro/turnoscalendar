// "Ese RUT ya esta en el establecimiento": el aviso es un cuadro, no una
// tarjeta dentro del formulario.
//
// La tarjeta quedaba entre los campos del perfil y se pasaba por alto; la
// decision -pedir el traspaso de su informacion o escribirla de nuevo- conviene
// tomarla ANTES de seguir llenando, porque pedir el traspaso descarta lo que se
// lleve escrito (lo trae la otra unidad, con sus saldos de vacaciones).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

function extraer(nombre) {
    const inicio = main.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    // Se devuelve desde "async" o "function", lo que venga antes.
    const asincrona = main.lastIndexOf("async function", inicio);
    const desde = asincrona === inicio - 6 ? asincrona : inicio;
    // El cuerpo empieza DESPUES de los parametros: un parametro con llaves
    // -{ replacing = null } = {}- cortaba la funcion por la mitad.
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

// --- El aviso ---

function montarAviso({ unidades, respuesta = false }) {
    const cuadros = [];
    const traspasos = [];
    const fabrica = new Function(
        "showConfirm",
        "askWorkerHandover",
        "rutLookupState",
        "pendingOwnHandoverRequest",
        "resolvePendingHandoverRequest",
        `${extraer("announceRutInEstablishment")}
         return announceRutInEstablishment;`
    );

    return {
        cuadros,
        traspasos,
        avisar: fabrica(
            async (mensaje, opciones) => {
                cuadros.push({ mensaje, ...opciones });
                return respuesta;
            },
            async () => { traspasos.push(true); },
            { rut: "1-9", unidades },
            // Sin pedido vivo: ese caso tiene sus propias pruebas.
            async () => null,
            async () => {}
        )
    };
}

const URGENCIA = { workspaceId: "ws-1", workspaceName: "Urgencia Adulto" };

test("el aviso sale en un cuadro, con los dos caminos como botones", async () => {
    const { cuadros, avisar } = montarAviso({ unidades: [URGENCIA] });

    await avisar();

    assert.equal(cuadros.length, 1);
    assert.equal(cuadros[0].confirmText, "Pedir el traspaso de su información");
    assert.equal(cuadros[0].cancelText, "Ingresar desde cero");
    assert.match(cuadros[0].mensaje, /Urgencia Adulto/);
});

test("elegir 'Ingresar desde cero' no pide nada a la otra unidad", async () => {
    const { traspasos, avisar } = montarAviso({
        unidades: [URGENCIA],
        respuesta: false
    });

    await avisar();

    assert.deepEqual(traspasos, []);
});

test("elegir el traspaso lo pide", async () => {
    const { traspasos, avisar } = montarAviso({
        unidades: [URGENCIA],
        respuesta: true
    });

    await avisar();

    assert.deepEqual(traspasos, [true]);
});

test("dice si el perfil ya esta inactivo alla", async () => {
    // No es un problema, es la mejor señal: ya se fue de esa unidad y sus
    // saldos quedaron ahi esperando.
    const { cuadros, avisar } = montarAviso({
        unidades: [{ ...URGENCIA, active: false }]
    });

    await avisar();

    assert.match(cuadros[0].mensaje, /Urgencia Adulto \(con el perfil ya inactivo\)/);
});

test("con varias unidades las nombra a todas", async () => {
    const { cuadros, avisar } = montarAviso({
        unidades: [URGENCIA, { workspaceId: "ws-2", workspaceName: "Pabellón" }]
    });

    await avisar();

    assert.match(cuadros[0].mensaje, /Urgencia Adulto, Pabellón/);
});

test("sin unidades no se abre ningun cuadro", async () => {
    const { cuadros, avisar } = montarAviso({ unidades: [] });

    await avisar();

    assert.deepEqual(cuadros, []);
});

// --- Cuando se consulta ---

function montarConsulta({
    permitido = () => true,
    valor = "31.000.001-9",
    invalido = "",
    unidades = [URGENCIA],
    estadoPrevio = { rut: "", unidades: [] },
    responder = null
} = {}) {
    const avisos = [];
    const olvidos = [];
    const consultas = [];
    const fabrica = new Function(
        "DOM",
        "profileRutLookupAllowed",
        "getRutValidationMessage",
        "findWorkerInEstablishment",
        "forgetRutLookup",
        "announceRutInEstablishment",
        "estadoInicial",
        "console",
        `let rutLookupState = estadoInicial;
         ${extraer("checkRutInEstablishment")}
         return {
             checkRutInEstablishment,
             estado: () => rutLookupState
         };`
    );
    const api = fabrica(
        { profileRutInput: { value: valor } },
        permitido,
        () => invalido,
        responder || (async rut => {
            consultas.push(rut);
            return { unidades };
        }),
        () => { olvidos.push(true); },
        async () => { avisos.push(true); },
        estadoPrevio,
        { warn() {} }
    );

    return { ...api, avisos, olvidos, consultas };
}

test("un RUT nuevo se consulta y se avisa", async () => {
    const { checkRutInEstablishment, consultas, avisos, estado } = montarConsulta();

    await checkRutInEstablishment();

    assert.deepEqual(consultas, ["31.000.001-9"]);
    assert.deepEqual(avisos, [true]);
    assert.equal(estado().rut, "31.000.001-9");
});

test("el mismo RUT no vuelve a preguntar cada vez que se pasa por el campo", async () => {
    // Es la diferencia con la tarjeta: una tarjeta se queda ahi sin molestar,
    // un cuadro que se abre solo cada vez seria insoportable.
    const { checkRutInEstablishment, consultas, avisos } = montarConsulta({
        estadoPrevio: { rut: "31.000.001-9", unidades: [URGENCIA] }
    });

    await checkRutInEstablishment();

    assert.deepEqual(consultas, []);
    assert.deepEqual(avisos, []);
});

test("un RUT invalido o vacio no llega al servidor", async () => {
    for (const caso of [
        { valor: "", invalido: "" },
        { valor: "31.000.001-0", invalido: "El digito verificador no corresponde." }
    ]) {
        const { checkRutInEstablishment, consultas, olvidos } =
            montarConsulta(caso);

        await checkRutInEstablishment();

        assert.deepEqual(consultas, []);
        assert.deepEqual(olvidos, [true], "y se olvida lo consultado antes");
    }
});

test("si cambiaron el RUT mientras respondia el servidor, no se avisa", async () => {
    const DOMFalso = { profileRutInput: { value: "31.000.001-9" } };
    const fabrica = new Function(
        "DOM",
        "profileRutLookupAllowed",
        "getRutValidationMessage",
        "findWorkerInEstablishment",
        "forgetRutLookup",
        "announceRutInEstablishment",
        "estadoInicial",
        "console",
        `let rutLookupState = estadoInicial;
         ${extraer("checkRutInEstablishment")}
         return checkRutInEstablishment;`
    );
    const avisos = [];
    const comprobar = fabrica(
        DOMFalso,
        () => true,
        () => "",
        async () => {
            // Alcanzaron a escribir otro RUT antes de que llegara la respuesta.
            DOMFalso.profileRutInput.value = "22.222.222-2";
            return { unidades: [URGENCIA] };
        },
        () => {},
        async () => { avisos.push(true); },
        { rut: "", unidades: [] },
        { warn() {} }
    );

    await comprobar();

    assert.deepEqual(avisos, []);
});

test("si cerraron el formulario mientras respondia, tampoco", async () => {
    // El cuadro se roba el foco: abrirlo encima de otra pantalla seria peor
    // que no avisar.
    let abierto = true;
    const { checkRutInEstablishment, avisos } = montarConsulta({
        permitido: () => abierto,
        responder: async () => {
            abierto = false;
            return { unidades: [URGENCIA] };
        }
    });

    await checkRutInEstablishment();

    assert.deepEqual(avisos, []);
});

test("si la consulta falla, el formulario sigue como si nada", async () => {
    const { checkRutInEstablishment, avisos, estado } = montarConsulta({
        responder: async () => { throw new Error("sin red"); }
    });

    await checkRutInEstablishment();

    assert.deepEqual(avisos, []);
    assert.equal(estado().rut, "");
});

test("la tarjeta vieja ya no existe en el formulario", async () => {
    // Si volviera, habria dos avisos para lo mismo y uno de los dos quedaria
    // sin mantener.
    const html = await readFile(
        new URL("../index.html", import.meta.url),
        "utf8"
    );
    const dom = await readFile(
        new URL("../js/dom.js", import.meta.url),
        "utf8"
    );

    assert.doesNotMatch(html, /profileRutNotice|profileRutHandoverBtn/);
    assert.doesNotMatch(dom, /profileRutNotice|profileRutHandoverBtn/);
});

// --- Si ya se pidió, se decide sobre ESE pedido ---
//
// Antes se callaba: el supervisor recorría todo el camino -modalidad, rotativa,
// calendario, confirmación- y recién al final le decían que ya lo había pedido,
// con el formulario descartado igual.

function montarAvisoConPendiente({
    pendiente,
    respuesta = false,
    unidades = [URGENCIA]
}) {
    const cuadros = [];
    const traspasos = [];
    const resueltos = [];
    const consultas = [];
    const fabrica = new Function(
        "showConfirm",
        "askWorkerHandover",
        "rutLookupState",
        "pendingOwnHandoverRequest",
        "resolvePendingHandoverRequest",
        `${extraer("announceRutInEstablishment")}
         return announceRutInEstablishment;`
    );

    return {
        cuadros,
        traspasos,
        resueltos,
        consultas,
        avisar: fabrica(
            async (mensaje, opciones) => {
                cuadros.push({ mensaje, ...opciones });
                return respuesta;
            },
            async () => { traspasos.push(true); },
            { rut: "31.000.001-9", unidades },
            async (rut) => {
                consultas.push(rut);
                return pendiente;
            },
            async (pedido) => { resueltos.push(pedido); }
        )
    };
}

test("con un pedido vivo no se ofrece pedirlo de nuevo a ciegas", async () => {
    const { avisar, cuadros, traspasos, resueltos } = montarAvisoConPendiente({
        pendiente: { id: "whr-1", sourceWorkspaceName: "Urgencia Adulto" }
    });

    await avisar();

    assert.deepEqual(cuadros, [], "no sale el cuadro de siempre");
    assert.deepEqual(traspasos, [], "ni se empieza otro camino");
    assert.equal(resueltos.length, 1, "se decide sobre el que ya hay");
    assert.equal(resueltos[0].id, "whr-1");
});

test("sin pedido vivo, el cuadro de siempre", async () => {
    const { avisar, cuadros, resueltos } = montarAvisoConPendiente({
        pendiente: null
    });

    await avisar();

    assert.equal(cuadros.length, 1);
    assert.deepEqual(resueltos, []);
});

test("aunque el RUT no aparezca en ninguna unidad, el pedido vivo se decide", async () => {
    // La otra unidad borro el perfil: el RUT ya no aparece en el
    // establecimiento, pero el pedido sigue esperando respuesta. Preguntarlo
    // despues de mirar las unidades dejaba este caso en silencio, y la persona
    // se ingresaba de cero con el traspaso en pie.
    const { avisar, resueltos, consultas, cuadros } = montarAvisoConPendiente({
        pendiente: { id: "whr-1", sourceWorkspaceId: "ws-1" },
        unidades: []
    });

    await avisar();

    assert.deepEqual(consultas, ["31.000.001-9"]);
    assert.equal(resueltos.length, 1);
    assert.equal(resueltos[0].id, "whr-1");
    assert.deepEqual(cuadros, []);
});

test("sin unidades y sin pedido, no se dice nada", async () => {
    const { avisar, resueltos, cuadros } = montarAvisoConPendiente({
        pendiente: null,
        unidades: []
    });

    await avisar();

    assert.deepEqual(resueltos, []);
    assert.deepEqual(cuadros, []);
});

function montarDecision({ eleccion }) {
    const cuadros = [];
    const traspasos = [];
    const retirados = [];
    const avisos = [];
    const fabrica = new Function(
        "showChoice",
        "showAlert",
        "askWorkerHandover",
        "cancelWorkerHandoverRequest",
        "normalizeStoredStart",
        "formatDisplayDate",
        "window",
        "CustomEvent",
        "console",
        `${extraer("resolvePendingHandoverRequest")}
         return resolvePendingHandoverRequest;`
    );

    return {
        cuadros,
        traspasos,
        retirados,
        avisos,
        decidir: fabrica(
            async (mensaje, opciones) => {
                cuadros.push({ mensaje, ...opciones });
                return eleccion;
            },
            async (mensaje) => { avisos.push(mensaje); },
            async (opciones) => { traspasos.push(opciones || null); },
            async (id) => { retirados.push(id); },
            valor => String(valor || ""),
            iso => iso,
            { dispatchEvent: () => true },
            class { constructor(tipo) { this.type = tipo; } },
            { warn() {} }
        )
    };
}

const PEDIDO = {
    id: "whr-1",
    sourceWorkspaceId: "ws-1",
    sourceWorkspaceName: "Urgencia Adulto",
    startDate: "2026-11-03"
};

test("el cuadro dice a quién se le pidió y desde cuándo, y ofrece las dos salidas", async () => {
    const { decidir, cuadros } = montarDecision({ eleccion: null });

    await decidir(PEDIDO);

    assert.equal(cuadros.length, 1);
    assert.match(cuadros[0].mensaje, /Urgencia Adulto/);
    assert.match(cuadros[0].mensaje, /2026-11-03/);
    assert.deepEqual(
        cuadros[0].choices.map(opcion => opcion.value),
        ["reemplazar", "retirar"]
    );
});

test("reemplazar vuelve a preguntar fecha y rotativa, por ESE pedido", async () => {
    const { decidir, traspasos, retirados } = montarDecision({
        eleccion: "reemplazar"
    });

    await decidir(PEDIDO);

    assert.equal(traspasos.length, 1);
    // Sin el pedido a cuestas, el camino volvia a ofrecer todas las unidades.
    assert.equal(traspasos[0]?.replacing, PEDIDO);
    assert.deepEqual(retirados, []);
});

test("retirar lo anula y lo dice", async () => {
    const { decidir, retirados, avisos, traspasos } = montarDecision({
        eleccion: "retirar"
    });

    await decidir(PEDIDO);

    assert.deepEqual(retirados, ["whr-1"]);
    assert.deepEqual(traspasos, []);
    assert.match(avisos[0], /quedó retirado/);
});

test("cerrar el cuadro no hace nada", async () => {
    const { decidir, retirados, traspasos, avisos } = montarDecision({
        eleccion: null
    });

    await decidir(PEDIDO);

    assert.deepEqual(retirados, []);
    assert.deepEqual(traspasos, []);
    assert.deepEqual(avisos, []);
});

// --- A quien se le pide el reemplazo ---
//
// El servidor identifica cada pedido por el par de unidades y el RUT
// (handoverRequestKey). Un "reemplazo" dirigido a otra unidad no reemplaza
// nada: crea un segundo pedido vivo por la misma persona, el anterior sigue
// pendiente y la traspasa quien conteste primero.

function montarPedidoDeTraspaso({ unidades }) {
    const pedidos = [];
    const fabrica = new Function(
        "rutLookupState",
        "DOM",
        "requestHandoverFromUnits",
        `${extraer("askWorkerHandover")}
         return askWorkerHandover;`
    );

    return {
        pedidos,
        pedir: fabrica(
            { rut: "31.000.001-9", unidades },
            { profileRutInput: { value: "31.000.001-9" } },
            async (unidadesPedidas, rut, opciones) => {
                pedidos.push({ unidades: unidadesPedidas, rut, opciones });
                return true;
            }
        )
    };
}

const UNIDADES = [
    { workspaceId: "ws-1", workspaceName: "Urgencia Adulto", exitDate: "2026-10-15" },
    { workspaceId: "ws-2", workspaceName: "Imagenología" }
];

test("un pedido nuevo si puede ir a cualquiera de las unidades", async () => {
    const { pedir, pedidos } = montarPedidoDeTraspaso({ unidades: UNIDADES });

    await pedir();

    assert.deepEqual(pedidos[0].unidades, UNIDADES);
    assert.equal(pedidos[0].rut, "31.000.001-9");
    assert.deepEqual(pedidos[0].opciones, { discardDraft: true });
});

test("el que reemplaza va a la unidad del pedido, sin volver a elegir", async () => {
    const { pedir, pedidos } = montarPedidoDeTraspaso({ unidades: UNIDADES });

    await pedir({ replacing: PEDIDO });

    // Una sola unidad: requestHandoverFromUnits no abre el cuadro de eleccion.
    assert.deepEqual(pedidos[0].unidades, [UNIDADES[0]]);
    // Con su ultimo dia alla, que es lo que fija desde cuando puede empezar
    // aqui.
    assert.equal(pedidos[0].unidades[0].exitDate, "2026-10-15");
});

test("si el perfil de alla ya no aparece, basta la unidad que el pedido recuerda", async () => {
    const { pedir, pedidos } = montarPedidoDeTraspaso({
        unidades: [UNIDADES[1]]
    });

    await pedir({ replacing: PEDIDO });

    assert.deepEqual(pedidos[0].unidades, [{
        workspaceId: "ws-1",
        workspaceName: "Urgencia Adulto"
    }]);
});
