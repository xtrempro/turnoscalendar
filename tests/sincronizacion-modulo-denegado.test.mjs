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
    assert.match(arranque, /try \{\s*return \{ moduleId, docSnap: await firestoreModule\.getDoc\(ref\) \};\s*\} catch \(error\) \{\s*return \{ moduleId, error \};/);
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
