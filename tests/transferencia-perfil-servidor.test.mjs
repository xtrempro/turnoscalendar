// Lo que escribe el SERVIDOR al aceptar una transferencia (perfil de origen
// inactivo, solo en `items`) leido con la funcion REAL con que la app arma sus
// datos. Sin esta prueba cruzada, un id mal codificado agregaria un perfil
// duplicado en vez de reemplazar al trabajador.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
    decodePartialStateItemKey,
    mergePartialStateEntries
} from "../js/firebasePartialState.js";

const require = createRequire(import.meta.url);
const { markSourceProfileTransferred } =
    require("../functions/workerTransferRequests.js");

const RUTA = "workspaces/w-origen/stateModules/profile/entries/profiles";

// Base de datos minima: solo lo que usa markSourceProfileTransferred.
function baseDeDatos(inicial) {
    const docs = new Map(Object.entries(inicial));
    const ref = path => ({
        path,
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        collection: name => coleccion(`${path}/${name}`)
    });
    const coleccion = path => ({
        doc: id => ref(`${path}/${id}`),
        add: async value => docs.set(`${path}/auto`, value)
    });

    return {
        docs,
        collection: name => coleccion(name),
        runTransaction: async trabajo => trabajo({
            get: r => r.get(),
            update: (r, value) => docs.set(r.path, { ...docs.get(r.path), ...value })
        })
    };
}

// Como stateEntriesFromDoc (js/firebaseAppState.js): `value` primero, y los
// items encima.
function entradasDelDocumento(data) {
    const base = { moduleId: data.moduleId, storageKey: data.storageKey };

    return [
        { ...base, itemKey: "", value: data.value, deleted: false },
        ...Object.keys(data.items || {}).map(key => ({
            ...base,
            itemKey: decodePartialStateItemKey(key),
            container: data.container || "",
            value: data.items[key],
            deleted: data.deletedItems?.[key] === true
        }))
    ];
}

test("la app lee al trabajador inactivo, sin duplicarlo ni tocar a los demas", async () => {
    const perfiles = [
        // Un id con punto: se codifica como %2E y tiene que volver igual.
        { id: "profile_12.345.678-9", name: "Ana Perez", active: true },
        { id: "profile_bea", name: "Bea Soto", active: true }
    ];
    const db = baseDeDatos({
        [RUTA]: {
            moduleId: "profile",
            storageKey: "profiles",
            value: JSON.stringify(perfiles)
        }
    });

    const resultado = await markSourceProfileTransferred(
        db,
        {
            sourceWorkspaceId: "w-origen",
            profileName: "Ana Perez",
            startDate: "2026-10-01"
        },
        { serverTimestamp: () => "AHORA" }
    );

    assert.equal(resultado.marked, true);

    const estado = mergePartialStateEntries({}, entradasDelDocumento(db.docs.get(RUTA)));
    const lista = JSON.parse(estado.profiles);

    assert.equal(lista.length, 2);
    assert.deepEqual(lista[0], {
        id: "profile_12.345.678-9",
        name: "Ana Perez",
        active: false,
        unitExitDate: "2026-09-30"
    });
    assert.deepEqual(lista[1], perfiles[1]);
});
