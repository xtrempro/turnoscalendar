// ============================================================================
//  stateChangeRelevance.js — que claves de estado obligan a rehacer una vista
// ============================================================================
//
//  Los oyentes de cambios de estado reciben una lista de CLAVES y deciden que
//  cache tirar. Tres de ellos -calendario, dotacion y timeline- repetian el
//  mismo filtro: descartar la vuelta solo si TODAS las claves eran cache de UI.
//  Cualquier otra clave contaba como "algo cambio", y eso vaciaba caches
//  enteras.
//
//  Medido el 2026-09-21 en la unidad de ~68 trabajadores: la bitacora
//  (`auditLog`) pasaba ese filtro. Como de ella no se deduce ningun perfil
//  afectado, `handleTimelineStateChange` caia al camino de abajo
//  -`clearTimelineCache()` mas un repintado SIN cache- y `clearAnalizarMesCache`
//  vaciaba ANALIZAR_MES_CACHE y subia su version. O sea: cada anotacion de
//  bitacora tiraba las caches de toda la app. `timeline:build-batch` era el
//  mayor consumidor de CPU de la medicion, con 6,1 s.
//
//  La bitacora se escribe en CADA accion del supervisor, y su unica vista
//  (`renderAuditLogPanel`) se repinta por refresh.js, no por estos oyentes:
//  js/auditLog.js no registra ningun listener.
//
//  La lista es NEGRA a proposito. Una lista blanca que olvidara una clave
//  dejaria una vista mostrando datos viejos -el defecto que estos tres oyentes
//  se agregaron para arreglar-, y eso es peor que recalcular de mas.
// ============================================================================

export const UI_CACHE_KEY_PREFIX = "proturnos_ui_cache_";

// Claves que cambian sin que cambie nada de lo que se ve ni de lo que se
// calcula a partir del estado. Solo entra aqui lo que se haya comprobado que
// ninguna vista derive de ella.
export const VIEW_IRRELEVANT_STATE_KEYS = new Set([
    "auditLog"
]);

export function isViewIrrelevantStateKey(key) {
    const text = String(key || "");

    return text.startsWith(UI_CACHE_KEY_PREFIX) ||
        VIEW_IRRELEVANT_STATE_KEYS.has(text);
}

/**
 * ¿Todas las claves de este cambio son intrascendentes para las vistas?
 *
 * Sin claves devuelve `false` y NO se descarta: un aviso sin detalle puede venir
 * de cualquier parte y hay que asumir lo peor. Es exactamente lo que hacian los
 * tres oyentes antes de compartir este modulo (`keys.length && keys.every(...)`),
 * y se conserva a proposito.
 */
export function onlyViewIrrelevantStateKeys(keys = []) {
    const list = Array.isArray(keys) ? keys : [keys];

    return list.length > 0 && list.every(isViewIrrelevantStateKey);
}
