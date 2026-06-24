// Construye los "registros de marcaje" de un perfil para un mes: cruza las
// marcas de reloj con los segmentos programados del turno. No toca el DOM.

import { getProfileData } from "./storage.js";
import { getTurnoBase, aplicarCambiosTurno } from "./turnEngine.js";
import {
    getClockMarks,
    getClockScheduleState,
    getScheduledSegmentsForProfile
} from "./clockMarks.js";
import {
    clockSegmentsOverlap,
    findClockMarkEntry,
    hasClockMarkRecordData,
    findClockSegmentForKey,
    fallbackClockSegment
} from "./clockMarkUtils.js";
import { keyToDate as parseKey } from "./dateUtils.js";
import { TURNO } from "./constants.js";

/**
 * Estado "real" del dia (con cambios/reemplazos aplicados) para el marcaje.
 * @param {string} profileName
 * @param {string} keyDay
 * @returns {number}
 */
export function getClockActualState(profileName, keyDay) {
    const data = getProfileData(profileName);
    const hasData =
        Object.prototype.hasOwnProperty.call(data, keyDay);
    const rawState = hasData
        ? Number(data[keyDay]) || TURNO.LIBRE
        : getTurnoBase(profileName, keyDay);

    return aplicarCambiosTurno(
        profileName,
        keyDay,
        rawState
    );
}

/**
 * Estado base del dia (sin reemplazos) para comparar segmentos.
 * @param {string} profileName
 * @param {string} keyDay
 * @returns {number}
 */
export function getClockBaseState(profileName, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
}

/**
 * Indica si un segmento corresponde al turno base o a un cambio (no es extra).
 * @param {string} profileName
 * @param {string} keyDay
 * @param {Date} date
 * @param {{id: string, start: Date, end: Date}} segment
 * @param {Object} holidays
 * @returns {boolean}
 */
export function isClockBaseOrSwapSegment(
    profileName,
    keyDay,
    date,
    segment,
    holidays
) {
    const baseState = getClockBaseState(profileName, keyDay);
    const scheduledBaseState = getClockScheduleState(
        profileName,
        keyDay,
        baseState
    );
    const baseSegments = getScheduledSegmentsForProfile(
        profileName,
        keyDay,
        date,
        scheduledBaseState,
        holidays
    );

    return baseSegments.some(base =>
        base.id === segment.id ||
        clockSegmentsOverlap(base, segment)
    );
}

/**
 * Construye los registros de marcaje del perfil para el mes dado, cruzando las
 * marcas con los segmentos programados (e incluyendo marcas sin segmento).
 * @param {{name: string}} profile
 * @param {Date} monthDate
 * @param {Object} holidays
 * @returns {Array<Object>}
 */
export function buildClockMarkRecordsForProfile(profile, monthDate, holidays) {
    const records = [];
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const marks = getClockMarks(profile.name);

    Object.entries(marks).forEach(([keyDay, dayMark]) => {
        const date = parseKey(keyDay);

        if (
            Number.isNaN(date.getTime()) ||
            date.getFullYear() !== y ||
            date.getMonth() !== m ||
            !dayMark?.segments
        ) {
            return;
        }

        const actualState = getClockActualState(
            profile.name,
            keyDay
        );
        const scheduledState = getClockScheduleState(
            profile.name,
            keyDay,
            actualState
        );
        const scheduledSegments = getScheduledSegmentsForProfile(
            profile.name,
            keyDay,
            date,
            scheduledState,
            holidays
        );
        const consumed = new Set();

        scheduledSegments.forEach(segment => {
            const entry = findClockMarkEntry(dayMark, segment);

            if (!entry || !hasClockMarkRecordData(entry.value)) {
                return;
            }

            consumed.add(entry.key);
            records.push({
                profile,
                keyDay,
                date,
                segment,
                segmentKey: entry.key,
                segmentMark: entry.value,
                isBaseOrSwap: isClockBaseOrSwapSegment(
                    profile.name,
                    keyDay,
                    date,
                    segment,
                    holidays
                )
            });
        });

        Object.entries(dayMark.segments)
            .filter(([segmentKey, segmentMark]) =>
                !consumed.has(segmentKey) &&
                hasClockMarkRecordData(segmentMark)
            )
            .forEach(([segmentKey, segmentMark]) => {
                const segment =
                    findClockSegmentForKey(
                        segmentKey,
                        scheduledSegments
                    ) ||
                    fallbackClockSegment(date, segmentKey);

                records.push({
                    profile,
                    keyDay,
                    date,
                    segment,
                    segmentKey,
                    segmentMark,
                    isBaseOrSwap: isClockBaseOrSwapSegment(
                        profile.name,
                        keyDay,
                        date,
                        segment,
                        holidays
                    )
                });
            });
    });

    return records;
}
