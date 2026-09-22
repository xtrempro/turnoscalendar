// Un modulo remoto que se deniega no puede dejar la app en SOLO ESCRITURA.
//
// El 2026-09-09 el cliente ya pedia el modulo `medicalEquipment` y sus reglas no
// estaban desplegadas. El arranque leia todos los modulos con un Promise.all, y
// ese unico `permission-denied` rechazaba el lote entero: la sincronizacion no
// se iniciaba para NINGUN modulo. La app seguia publicando, asi que un borrado
// local salia al servidor sin que el estado remoto llegara nunca a corregirlo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const src = await readFile(
    new URL("../js/firebaseAppState.js", import.meta.url),
    "utf8"
);

const arranque = src.slice(
    src.indexOf("waitingInitialState = true;"),
    src.indexOf("unsubscribeStateEntries = () =>")
);

test("cada modulo se lee por separado, no en un lote que se rechaza entero", () => {
    // El Promise.all sigue estando (se leen en paralelo), pero cada lectura
    // atrapa su propio error en vez de rechazar el lote.
    //
    // Se comprueba el ORDEN de las piezas, no que esten en la misma linea: al
    // envolver el getDoc en una sonda por modulo, la adyacencia se rompio sin
    // que cambiara nada de lo que esto vigila.
    const lee = arranque.indexOf("firestoreModule.getDoc(ref)");
    const atrapa = arranque.indexOf("} catch (error) {", lee);
    const devuelve = arranque.indexOf("return { moduleId, error };", atrapa);

    assert.notEqual(lee, -1, "ya no se lee el documento del modulo");
    assert.notEqual(atrapa, -1, "la lectura dejo de atrapar su propio error");
    assert.notEqual(devuelve, -1, "el modulo que falla ya no se anota");
    assert.match(arranque, /try \{/);
});

test("los modulos legibles se aplican aunque otro falle", () => {
    assert.match(arranque, /const deniedModules = moduleReads\.filter\(item => item\.error\)/);
    assert.match(arranque, /const moduleDocs = moduleReads\.filter\(item => !item\.error\)/);
});

test("el modulo denegado se avisa por el canal de estado, no solo por consola", () => {
    // Quedarse sin leer un modulo tiene que ser visible: en el incidente el
    // unico rastro era un console.warn.
    const aviso = arranque.slice(arranque.indexOf("deniedModules.forEach"));

    assert.match(aviso, /dispatchStatus\(\{/);
    assert.match(aviso, /type: "app-state-error"/);
});

test("si NINGUN modulo se pudo leer, el error sigue propagandose", () => {
    // Denegarlo todo es otra cosa -sesion sin permisos, reglas rotas- y ahi si
    // corresponde fallar en vez de fingir que se sincronizo.
    assert.match(
        arranque,
        /if \(!moduleDocs\.length && deniedModules\.length\) \{\s*throw deniedModules\[0\]\.error;/
    );
});

/* ======================================================================
   Las ENTRADAS de cada modulo: el mismo arreglo, que aqui faltaba

   El del 09-09 se aplico al bucle de manifiestos. El de las entradas seguia
   lanzando: un `permission-denied` ahi subia y tumbaba la hidratacion entera.
   ====================================================================== */

const hidratacion = (() => {
    const inicio = src.indexOf("async function applyInitialModules(");
    const abre = src.indexOf("{", src.indexOf(")", inicio));
    let depth = 0;
    let fin = abre;

    for (; fin < src.length; fin += 1) {
        if (src[fin] === "{") depth += 1;
        else if (src[fin] === "}") {
            depth -= 1;

            if (!depth) break;
        }
    }

    return src.slice(inicio, fin + 1);
})();

test("las entradas de los modulos se leen EN PARALELO", () => {
    // Estaban en un `for` con `await`, una detras de otra. Medido el 2026-09-22
    // en prod: las 17 sumaban ~32 s de red encolada sin motivo, mientras que
    // mezclarlas -lo unico que es CPU- costaba 1,8 s entre todas.
    assert.match(
        hidratacion,
        /const lecturas = await Promise\.all\(\s*\n\s*readableModules\.map\(async moduleId => \{/
    );
    assert.doesNotMatch(
        hidratacion,
        /for \(const moduleId of readableModules\)/
    );
});

test("y una que falla no se lleva por delante a las demas", () => {
    assert.match(hidratacion, /\} catch \(error\) \{/);
    assert.match(hidratacion, /return \{ moduleId, entries: \[\] \};/);
});

test("el modulo que no se pudo leer se avisa, no se traga", () => {
    // Quedarse sin un modulo es un problema que hay que poder ver.
    assert.match(
        hidratacion,
        /dispatchStatus\(\{\s*\n\s*type: "app-state-error",\s*\n\s*moduleId,/
    );
});

test("se lee a la vez, pero la foto se arma EN ORDEN", () => {
    // `Promise.all` conserva el orden del arreglo, asi que el mezclado no
    // depende de cual lectura termine primero.
    assert.match(
        hidratacion,
        /for \(const \{ moduleId, entries \} of lecturas\) \{/
    );

    const lee = hidratacion.indexOf("const lecturas = await Promise.all(");
    const mezcla = hidratacion.indexOf("of lecturas) {", lee);

    assert.ok(lee !== -1 && mezcla > lee);
});

test("los listeners se montan solo sobre los modulos legibles", () => {
    // Suscribirse a un modulo denegado solo produce errores en bucle.
    assert.match(arranque, /const refsLegibles = moduleRefs\.filter\(/);
    assert.match(arranque, /const unsubscribers = refsLegibles\.map\(/);
    assert.match(arranque, /const entryUnsubscribers = refsLegibles\.map\(/);
});

test("medicalEquipment esta en las reglas y en la lista del cliente", () => {
    // La causa de fondo: el cliente pedia un modulo que las reglas no conocian.
    // Si vuelve a aparecer un modulo nuevo, esta prueba obliga a las dos mitades.
    const reglas = readFileSync(new URL("../firebase.rules", import.meta.url), "utf8");
    const modulos = readFileSync(new URL("../js/firebaseStateModules.js", import.meta.url), "utf8");

    // Los modulos del DUEÑO no necesitan clausula propia: canReadStateModule
    // empieza por `isOwner(workspaceId) ||`, que ya los cubre.
    const declarados = [
        ...modulos.matchAll(/^\s{4}(\w+): \{ permission: "(\w+)"/gm)
    ]
        .filter(([, , permiso]) => permiso !== "owner")
        .map(([, moduleId]) => moduleId);

    assert.ok(declarados.includes("medicalEquipment"), "falta en el cliente");
    assert.match(
        reglas,
        /function canReadStateModule[\s\S]{0,80}isOwner\(workspaceId\) \|\|/
    );

    declarados.forEach(moduleId => {
        assert.ok(
            reglas.includes(`moduleId == "${moduleId}"`),
            `el modulo ${moduleId} no tiene clausula en firebase.rules: ` +
            "el cliente lo pediria y las reglas lo denegarian"
        );
    });
});
