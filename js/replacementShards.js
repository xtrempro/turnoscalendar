// Reemplazos repartidos por mes (19-11-2026). Sin dependencias: lo usan el
// planificador del navegador, el script del corte y las pruebas.
//
// Cada reemplazo vive en el documento de SU mes (`replacements__2026-11`) en vez
// del unico `replacements` que rondaba 1 MiB. Invariante: un id vive en UN solo
// documento toda su vida, el del mes de su `date` (sin fecha valida, `0000-00`).
// Un reemplazo no cambia de mes (un turno extra se anula, no se arrastra, y los
// cambios de turno son dentro del mismo mes); si algo lo intentara, el
// planificador lo rechaza (assignReplacementShards en firebasePartialState.js).
export const REPLACEMENT_SHARD_PREFIX = "replacements__";
export const REPLACEMENT_SHARD_UNDATED = "0000-00";

export function replacementShardMonth(record) {
    const date = String(record?.date || "");

    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : REPLACEMENT_SHARD_UNDATED;
}

export function replacementShardDocKey(record) {
    return `${REPLACEMENT_SHARD_PREFIX}${replacementShardMonth(record)}`;
}
