// Guardar el comentario de un movimiento de turno ya hecho.
//
// El movimiento publica la proyeccion del trabajador apenas se aplica, y el
// cuadro del comentario se abre DESPUES. Si el supervisor tarda mas que el
// publicador, la app del trabajador recibia el reporte sin el comentario, y
// `shiftMoves` no dispara por si sola otra publicacion. Por eso, una vez
// guardado el comentario, se vuelve a publicar a ESE trabajador vaciando antes
// `shiftMoves` (la Cloud Function calcula con lo que esta en la nube).

/**
 * @param {Object} params
 * @param {string} params.moveId
 * @param {string} params.profile
 * @param {string} params.comment
 * @param {Object} deps
 * @param {Function} deps.setComment (moveId, comment) => movimiento | null
 * @param {Function} deps.publish    (delay, profile, meta, options) => void
 * @param {Function} [deps.audit]    (profile, comment, moveId) => void
 * @returns {boolean} si se guardo (y se volvio a publicar)
 */
export function commitShiftMoveComment({ moveId, profile, comment }, { setComment, publish, audit }) {
    const text = String(comment || "").trim();

    if (!moveId || !text) return false;

    const updated = setComment(moveId, text);

    // Solo si el movimiento existia y quedo con el comentario.
    if (!updated) return false;

    publish(0, profile, null, {
        requiresLocalStateFlush: true,
        stateKeys: ["shiftMoves"]
    });
    audit?.(profile, text, moveId);

    return true;
}
