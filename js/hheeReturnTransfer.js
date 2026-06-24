// Servicio de "transferencia de devolucion de HHEE": calcula y mantiene el
// saldo de horas que se traspasa de un mes al siguiente. No toca el DOM; opera
// por (profileName, year, month) y persiste via storage / hourReturnTransfers.

import {
    nextMonthPeriod,
    monthSerial,
    formatMonthHeading
} from "./dateUtils.js";
import { normalizeBalanceValue } from "./balanceUtils.js";
import {
    getProfileData,
    getCarry,
    getManualLeaveBalances,
    saveManualLeaveBalances
} from "./storage.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import {
    getHheeReturnTransfer,
    getHheeReturnTransfers,
    saveHheeReturnTransfer,
    calculateHheeReturnTransferHours
} from "./hourReturnTransfers.js";

/**
 * Periodo (year, month) en que se hace efectiva la devolucion: el almacenado en
 * el registro si existe, o el mes siguiente al del registro.
 * @param {{effectiveYear?: number, effectiveMonth?: number, year?: number, month?: number}} record
 * @returns {{year: number, month: number}}
 */
export function hheeReturnEffectivePeriod(record = {}) {
    const effectiveYear = Number(record.effectiveYear);
    const effectiveMonth = Number(record.effectiveMonth);

    if (
        Number.isFinite(effectiveYear) &&
        Number.isFinite(effectiveMonth)
    ) {
        return {
            year: effectiveYear,
            month: effectiveMonth
        };
    }

    return nextMonthPeriod(record.year, record.month);
}

/**
 * Indica si el registro tiene guardado explicitamente su periodo efectivo.
 * @param {{effectiveYear?: number, effectiveMonth?: number}} record
 * @returns {boolean}
 */
export function hasStoredHheeReturnEffectivePeriod(record = {}) {
    return (
        Number.isFinite(Number(record.effectiveYear)) &&
        Number.isFinite(Number(record.effectiveMonth))
    );
}

/**
 * Suma las horas de devolucion que se haran efectivas en meses POSTERIORES al
 * (year, month) dado (aun no disponibles para usar).
 * @param {string} profileName
 * @param {number} year
 * @param {number} month
 * @returns {number}
 */
export function futureHheeReturnTransferHours(
    profileName,
    year,
    month
) {
    if (
        !profileName ||
        !Number.isFinite(Number(year)) ||
        !Number.isFinite(Number(month))
    ) {
        return 0;
    }

    const targetSerial = monthSerial(year, month);

    return Object.values(getHheeReturnTransfers(profileName))
        .filter(record => record?.enabled)
        .reduce((sum, record) => {
            const effective =
                hheeReturnEffectivePeriod(record);

            const appliesToYear =
                Number(effective.year) === Number(year) ||
                (
                    !hasStoredHheeReturnEffectivePeriod(record) &&
                    Number(record.year) === Number(year)
                );

            if (
                !appliesToYear ||
                monthSerial(effective.year, effective.month) <=
                    targetSerial
            ) {
                return sum;
            }

            return sum +
                normalizeBalanceValue(record.transferredHours);
        }, 0);
}

/**
 * Estadisticas de horas del mes para un perfil (incluye HHEE diurnas/nocturnas).
 * @param {string} profileName
 * @param {number} year
 * @param {number} month
 * @param {Object} holidays
 * @returns {Object}
 */
export function getHheeMonthStats(profileName, year, month, holidays) {
    const days = new Date(year, month + 1, 0).getDate();

    return calcularHorasMesPerfil(
        profileName,
        year,
        month,
        days,
        holidays,
        getProfileData(profileName),
        {},
        getCarry(year, month)
    );
}

/**
 * Fija el saldo manual de horas de devolucion del perfil para un anio.
 * @param {string} profileName
 * @param {number} year
 * @param {number} value
 */
export function setHoursReturnBalance(profileName, year, value) {
    const manual = getManualLeaveBalances(year, profileName);

    saveManualLeaveBalances(
        year,
        {
            ...manual,
            hoursReturn: normalizeBalanceValue(value)
        },
        profileName
    );
}

/**
 * Ajusta (suma/resta) el saldo manual de horas de devolucion, sin negativos.
 * @param {string} profileName
 * @param {number} year
 * @param {number} delta
 */
export function adjustHoursReturnBalance(profileName, year, delta) {
    const manual = getManualLeaveBalances(year, profileName);
    const current = normalizeBalanceValue(manual.hoursReturn);

    setHoursReturnBalance(
        profileName,
        year,
        Math.max(0, current + Number(delta || 0))
    );
}

/**
 * Etiqueta del mes en que se hace efectiva la devolucion (mes siguiente).
 * @param {number} year
 * @param {number} month
 * @returns {string}
 */
export function hheeReturnEffectiveLabel(year, month) {
    const effective = nextMonthPeriod(year, month);

    return formatMonthHeading(
        new Date(effective.year, effective.month, 1)
    );
}

/**
 * Redondea horas (con signo) a 2 decimales.
 * @param {number} value
 * @returns {number}
 */
export function roundSignedHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Payload base de un registro de transferencia (horas y HHEE del mes).
 * @param {{hheeDiurnas?: number, hheeNocturnas?: number}} stats
 * @param {number} transferredHours
 * @returns {{transferredHours: number, hheeDiurnas: number, hheeNocturnas: number}}
 */
export function hheeReturnTransferPayload(stats, transferredHours) {
    return {
        transferredHours,
        hheeDiurnas: Math.max(0, Number(stats.hheeDiurnas) || 0),
        hheeNocturnas: Math.max(0, Number(stats.hheeNocturnas) || 0)
    };
}

/**
 * Recalcula y reconcilia el saldo de devolucion de un mes ya habilitado:
 * ajusta el saldo del periodo efectivo segun el delta y reescribe el registro.
 * @param {string} profileName
 * @param {number} year
 * @param {number} month
 * @param {{hheeDiurnas?: number, hheeNocturnas?: number}} stats
 */
export function syncHheeReturnTransferBalance(profileName, year, month, stats) {
    const existing =
        getHheeReturnTransfer(profileName, year, month);

    if (!existing?.enabled) return;
    const effective =
        hheeReturnEffectivePeriod({
            ...existing,
            year,
            month
        });
    const hasStoredEffective =
        hasStoredHheeReturnEffectivePeriod(existing);

    const transferredHours =
        calculateHheeReturnTransferHours(
            stats.hheeDiurnas,
            stats.hheeNocturnas
        );
    const previousTransferred =
        normalizeBalanceValue(existing.transferredHours);
    const delta = roundSignedHours(
        transferredHours - previousTransferred
    );

    if (!hasStoredEffective && Number(effective.year) !== Number(year)) {
        adjustHoursReturnBalance(
            profileName,
            year,
            -previousTransferred
        );
        adjustHoursReturnBalance(
            profileName,
            effective.year,
            previousTransferred
        );
    }

    if (delta) {
        adjustHoursReturnBalance(
            profileName,
            effective.year,
            delta
        );
    }

    saveHheeReturnTransfer(
        profileName,
        year,
        month,
        {
            ...existing,
            ...hheeReturnTransferPayload(stats, transferredHours),
            enabled: true,
            effectiveYear: effective.year,
            effectiveMonth: effective.month
        }
    );
}
