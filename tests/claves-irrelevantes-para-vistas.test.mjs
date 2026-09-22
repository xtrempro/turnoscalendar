// La bitacora no debe tirar las caches de toda la app.
//
// Medido el 2026-09-21 en la unidad de ~68 trabajadores: tres oyentes de cambios
// de estado -calendario, dotacion y timeline- descartaban la vuelta solo si
// TODAS las claves eran cache de UI. `auditLog` pasaba ese filtro, y como de ella
// no se deduce ningun perfil afectado:
//
//   - timeline  -> clearTimelineCache() + repintado SIN cache. 6,1 s medidos,
//                  el mayor consumidor de CPU de la app.
//   - dotacion  -> ANALIZAR_MES_CACHE.clear() y analizarMesCacheVersion++, que
//                  ademas ABORTA el analizarMesCooperative del publicador RRHH.
//
// Y la bitacora se escribe en CADA accion del supervisor.
//
// Lo que se prueba de verdad es el predicado, que es donde vivia el defecto. El
// cableado de los tres oyentes se fija sobre el texto del fuente.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
    UI_CACHE_KEY_PREFIX,
    VIEW_IRRELEVANT_STATE_KEYS,
    isViewIrrelevantStateKey,
    onlyViewIrrelevantStateKeys
} = await import("../js/stateChangeRelevance.js");

async function fuente(nombre) {
    return (await readFile(
        new URL("../js/" + nombre, import.meta.url),
        "utf8"
    )).replace(/\r\n/g, "\n");
}

const staffing = await fuente("staffing.js");
const timeline = await fuente("timeline.js");
const calendar = await fuente("calendar.js");

/* =========================================================
   El caso que motivo todo
========================================================= */

test("la bitacora sola se descarta", () => {
    assert.equal(onlyViewIrrelevantStateKeys(["auditLog"]), true);
});

test("la cache de UI se sigue descartando, como antes", () => {
    assert.equal(
        onlyViewIrrelevantStateKeys([
            "proturnos_ui_cache_timeline_row_x",
            "proturnos_ui_cache_calendar_y"
        ]),
        true
    );
});

test("bitacora Y cache de UI juntas tambien", () => {
    assert.equal(
        onlyViewIrrelevantStateKeys(["auditLog", "proturnos_ui_cache_z"]),
        true
    );
});

/* =========================================================
   Lo que NO se puede descartar
========================================================= */

test("la bitacora ACOMPAÑADA de un cambio real no se descarta", () => {
    // Es el caso peligroso: si se descartara, el turno editado no se repintaria.
    assert.equal(
        onlyViewIrrelevantStateKeys(["auditLog", "data_Ana"]),
        false
    );
});

test("una clave de verdad no se descarta", () => {
    ["data_Ana", "replacements", "profiles", "rotativa_Ana"].forEach(key => {
        assert.equal(
            onlyViewIrrelevantStateKeys([key]),
            false,
            "no deberia descartarse: " + key
        );
    });
});

test("SIN claves no se descarta: hay que asumir lo peor", () => {
    // Conserva el comportamiento anterior (`keys.length && keys.every(...)`).
    // Un aviso sin detalle puede venir de cualquier parte.
    assert.equal(onlyViewIrrelevantStateKeys([]), false);
    assert.equal(onlyViewIrrelevantStateKeys(), false);
});

test("una clave suelta, sin envolver en lista, se acepta igual", () => {
    assert.equal(onlyViewIrrelevantStateKeys("auditLog"), true);
    assert.equal(onlyViewIrrelevantStateKeys("data_Ana"), false);
});

test("nulos y vacios no se hacen pasar por irrelevantes", () => {
    assert.equal(isViewIrrelevantStateKey(null), false);
    assert.equal(isViewIrrelevantStateKey(""), false);
    assert.equal(isViewIrrelevantStateKey(undefined), false);
});

/* =========================================================
   La lista es negra, y corta a proposito
========================================================= */

test("solo la bitacora esta en la lista negra", () => {
    // Agregar una clave aqui tiene que ser deliberado: si esa clave SI alimenta
    // alguna vista, la vista se queda con datos viejos y no hay error visible.
    assert.deepEqual([...VIEW_IRRELEVANT_STATE_KEYS], ["auditLog"]);
});

test("el prefijo de cache de UI es el que usan los tres oyentes", () => {
    assert.equal(UI_CACHE_KEY_PREFIX, "proturnos_ui_cache_");
});

/* =========================================================
   El cableado de los tres oyentes
========================================================= */

test("los tres importan el predicado compartido", () => {
    [
        ["staffing.js", staffing],
        ["timeline.js", timeline],
        ["calendar.js", calendar]
    ].forEach(([nombre, texto]) => {
        assert.match(
            texto,
            /import \{ onlyViewIrrelevantStateKeys \} from "\.\/stateChangeRelevance\.js";/,
            "falta el import en " + nombre
        );
    });
});

test("y ninguno conserva el filtro copiado a mano", () => {
    // Referenciar el prefijo suelto es justo el bug: cualquier clave que no fuera
    // cache de UI contaba como "algo cambio".
    [
        ["staffing.js", staffing],
        ["timeline.js", timeline],
        ["calendar.js", calendar]
    ].forEach(([nombre, texto]) => {
        assert.doesNotMatch(
            texto,
            /\.every\(\s*\w+\s*=>\s*\n?\s*String\([^)]*\)\.startsWith\("proturnos_ui_cache_"\)/,
            "quedo el filtro a mano en " + nombre
        );
    });
});

test("dotacion lo consulta antes de vaciar el analisis del mes", () => {
    const i = staffing.indexOf("function clearAnalizarMesCache");
    const j = staffing.indexOf("ANALIZAR_MES_CACHE.clear()", i);
    const k = staffing.indexOf("onlyViewIrrelevantStateKeys(keys)", i);

    assert.notEqual(k, -1, "no lo consulta");
    assert.ok(k < j, "lo consulta DESPUES de vaciar: no serviria de nada");
});

test("el timeline lo consulta antes de tirar su cache", () => {
    const i = timeline.indexOf("const handleTimelineStateChange");
    const j = timeline.indexOf("clearLegacyTimelineCache()", i);
    const k = timeline.indexOf("onlyViewIrrelevantStateKeys(keys)", i);

    assert.notEqual(k, -1, "no lo consulta");
    assert.ok(k < j, "lo consulta DESPUES de tirar la cache");
});

test("el calendario lo consulta antes de mirar sus mapas", () => {
    const i = calendar.indexOf("function handleCalendarPersistenceChange");
    const j = calendar.indexOf("calendarStorageMaps(profileName)", i);
    const k = calendar.indexOf("onlyViewIrrelevantStateKeys(changedStorageKeys)", i);

    assert.notEqual(k, -1, "no lo consulta");
    assert.ok(k < j, "lo consulta DESPUES de leer los mapas");
});
