// Orden de los candidatos a cubrir un turno en el modal de sugerencias.
//
// Vivia solo dentro del Web Worker, y el calendario le pedia ordenar la lista
// con un limite de 15 s. Ordenar unas decenas de candidatos ya calculados es
// instantaneo, pero el limite es tiempo de reloj: con la pagina ocupada
// (hidratacion, publicacion de la programacion) la respuesta del worker quedaba
// en cola detras del temporizador vencido, la busqueda se daba por fallida y
// el modal no se abria ("La tarea SEARCH_REPLACEMENTS excedio 15000 ms"). Ahora
// el calendario ordena aqui mismo; el worker usa la misma funcion.

export function comparePreparedReplacementCandidates(left, right) {
    // Los dos criterios que empujan al FINAL de la lista, en orden de peso. Van
    // primero porque mandan sobre todo lo demas: no sirve que alguien aparezca
    // arriba por su rotativa si aceptar el turno lo deja sobre el tope de horas.

    // 1. Sobrepasaria las 40 horas extras diurnas del mes: ultimo de todos,
    //    porque es un turno que despues no se le puede pagar.
    if (
        Boolean(left.exceedsDiurnalLimit) !==
        Boolean(right.exceedsDiurnalLimit)
    ) {
        return left.exceedsDiurnalLimit ? 1 : -1;
    }

    // 2. Al dia siguiente tiene turno: trabajaria de noche y seguiria sin
    //    dormir. Es la tarjeta amarilla.
    if (
        Boolean(left.nextDayMorningShift) !==
        Boolean(right.nextDayMorningShift)
    ) {
        return left.nextDayMorningShift ? 1 : -1;
    }

    // 3. Contingencia del dia: es a quien le toca venir si alguien no llega a
    //    ese turno. Va PRIMERO de los que quedan, pero despues de los dos
    //    criterios de arriba: de nada sirve ofrecer el turno a quien no se le
    //    puede pagar o quien seguiria sin dormir, aunque le tocara.
    if (
        Boolean(left.contingencyPriority) !==
        Boolean(right.contingencyPriority)
    ) {
        return left.contingencyPriority ? -1 : 1;
    }

    if (
        Boolean(left.isDiurnoLongCoverage) !==
        Boolean(right.isDiurnoLongCoverage)
    ) {
        return left.isDiurnoLongCoverage ? 1 : -1;
    }
    if (Boolean(left.blockedDay) !== Boolean(right.blockedDay)) {
        return left.blockedDay ? 1 : -1;
    }
    if (Boolean(left.isFree) !== Boolean(right.isFree)) {
        return left.isFree ? -1 : 1;
    }

    const leftPriority = Number.isFinite(Number(left.replacementPriority))
        ? Number(left.replacementPriority)
        : 20;
    const rightPriority = Number.isFinite(Number(right.replacementPriority))
        ? Number(right.replacementPriority)
        : 20;

    if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
    }
    if (Number(left.hhee) !== Number(right.hhee)) {
        return (Number(left.hhee) || 0) - (Number(right.hhee) || 0);
    }

    return String(left.profile?.name || "").localeCompare(
        String(right.profile?.name || "")
    );
}

export function sortPreparedReplacementCandidates(candidates = []) {
    return [...(Array.isArray(candidates) ? candidates : [])]
        .sort(comparePreparedReplacementCandidates);
}
