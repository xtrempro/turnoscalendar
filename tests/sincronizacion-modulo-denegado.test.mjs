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

function cuerpoDe(nombre) {
    const inicio = src.search(
        new RegExp(`^(?:export )?(?:async )?function ${nombre}\\(`, "m")
    );

    assert.notEqual(inicio, -1, `no se encontro: ${nombre}`);

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
}

const hidratacion = cuerpoDe("applyInitialModules");
// La lectura se extrajo aqui para poder LANZARLA antes y que corra junto a la
// de los documentos de modulo, en vez de detras.
const lectura = cuerpoDe("readAllModuleEntries");

test("las entradas de los modulos se leen EN PARALELO", () => {
    // Estaban en un `for` con `await`, una detras de otra. Medido el 2026-09-22
    // en prod: las 17 sumaban ~32 s de red encolada sin motivo, mientras que
    // mezclarlas -lo unico que es CPU- costaba 1,8 s entre todas.
    assert.match(
        lectura,
        /return Promise\.all\(\s*\n\s*readableModules\.map\(async moduleId => \{/
    );
    assert.doesNotMatch(src, /for \(const moduleId of readableModules\)/);
});

test("y no se esperan ANTES de pedir los documentos de modulo", () => {
    // Encoladas costaban 43,7 + 7,95 = 51,6 s. Las entradas no dependen de esos
    // documentos: se piden por moduleId.
    assert.match(
        src,
        /const entriesPromise = readAllModuleEntries\(/
    );

    const pide = src.indexOf("const entriesPromise = readAllModuleEntries(");
    const docs = src.indexOf("firebase-app-state:module-docs", pide);

    assert.ok(pide !== -1 && docs > pide, "se piden DESPUES de los documentos");
});

test("y una que falla no se lleva por delante a las demas", () => {
    assert.match(lectura, /\} catch \(error\) \{/);
    assert.match(lectura, /return \{ moduleId, entries: \[\] \};/);
});

test("el modulo que no se pudo leer se avisa, no se traga", () => {
    // Quedarse sin un modulo es un problema que hay que poder ver.
    assert.match(
        lectura,
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

    const lee = hidratacion.indexOf("const lecturas = await entriesPromise;");
    const mezcla = hidratacion.indexOf("of lecturas) {", lee);

    assert.notEqual(lee, -1, "ya no se esperan las entradas pedidas");
    assert.ok(mezcla > lee, "se mezcla antes de tener las entradas");
});

test("los listeners se montan solo sobre los modulos legibles", () => {
    // Suscribirse a un modulo denegado solo produce errores en bucle.
    assert.match(arranque, /const refsLegibles = moduleRefs\.filter\(/);
    assert.match(arranque, /const unsubscribers = refsLegibles\.map\(/);
    // Los de entradas ademas dejan fuera los DIFERIDOS: `log` no se trae en el
    // arranque, y suscribirse le pediria a Firestore justo lo que se decidio no
    // descargar todavia.
    assert.match(
        arranque,
        /const entryUnsubscribers = refsLegibles\s*\n\s*\.filter\(\(\{ moduleId \}\) => !deferredPendingModules\.has\(moduleId\)\)\s*\n\s*\.map\(/
    );
});

test("un modulo diferido NO se publica hasta tenerlo", () => {
    // Es la barrera. Sin ella se podria escribir encima de lo que aun no ha
    // llegado, que es la forma del incidente del 2026-09-15.
    const puedeEscribir = src.slice(
        src.indexOf("function canWriteModule(")
    );

    assert.match(
        puedeEscribir.slice(0, 400),
        /if \(deferredPendingModules\.has\(moduleId\)\) return false;/
    );
});

test("la barrera se levanta solo despues de aplicar el modulo completo", () => {
    // Abrirla antes de terminar el reemplazo dejaria una ventana en la que se
    // publica con la copia local incompleta.
    const hidrata = src.slice(src.indexOf("hydrateDeferred = async moduleId"));
    const aplica = hidrata.indexOf("applyRemoteModule(");
    const termina = hidrata.indexOf(").then(() => {");
    const levanta = hidrata.indexOf("deferredPendingModules.delete(moduleId)");

    assert.notEqual(aplica, -1, "ya no se aplica el modulo remoto completo");
    assert.notEqual(termina, -1, "no se espera que termine la aplicacion");
    assert.notEqual(levanta, -1, "la barrera no se levanta nunca");
    assert.ok(levanta > termina, "la barrera se levanta ANTES de aplicar");
});

test("el modulo diferido tampoco lee sus fragmentos durante el arranque", () => {
    const aplicaInicial = cuerpoDe("applyInitialModules");

    assert.match(
        aplicaInicial,
        /docSnap\.exists\(\) && !deferredPendingModules\.has\(moduleId\)/
    );
});

test("dos solicitudes simultaneas comparten una sola hidratacion", () => {
    const hidrata = src.slice(src.indexOf("hydrateDeferred = async moduleId"));

    assert.match(
        hidrata,
        /if \(deferredHydrations\.has\(moduleId\)\) \{\s*return deferredHydrations\.get\(moduleId\);/
    );
    assert.match(hidrata, /deferredHydrations\.set\(moduleId, hydration\);/);
});

test("la bitacora puede hidratar entradas aunque aun no tenga manifiesto", () => {
    const hidrata = src.slice(src.indexOf("hydrateDeferred = async moduleId"));

    assert.doesNotMatch(
        hidrata.slice(0, hidrata.indexOf("const hydration =")),
        /moduleDoc\?\.docSnap\?\.exists\(\)/
    );
    assert.match(
        hidrata,
        /moduleDoc\.docSnap\.exists\(\)\s*\? moduleDoc\.docSnap\.data\(\) \|\| \{\}\s*:\s*\{\}/
    );
});

test("si falla la hidratacion la barrera permanece cerrada", () => {
    const hidrata = src.slice(src.indexOf("hydrateDeferred = async moduleId"));
    const abre = hidrata.indexOf("deferredPendingModules.delete(moduleId)");
    const captura = hidrata.indexOf("}).catch(error => {");
    const relanza = hidrata.indexOf("throw error;", captura);

    assert.ok(abre !== -1 && captura > abre, "el error puede abrir la barrera");
    assert.ok(relanza > captura, "el error de hidratacion se esta tragando");
    assert.doesNotMatch(
        hidrata.slice(captura, relanza),
        /deferredPendingModules\.delete/
    );
});

test("al parar la sincronizacion se olvida lo diferido", () => {
    // Si no, cambiar de unidad dejaria la barrera de la anterior puesta.
    const para = src.slice(src.indexOf("export function stopFirebaseAppStateSync("));

    assert.match(para.slice(0, 300), /deferredPendingModules = new Set\(\);/);
    assert.match(para.slice(0, 300), /deferredHydrations = new Map\(\);/);
    assert.match(para.slice(0, 300), /hydrateDeferred = null;/);
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
