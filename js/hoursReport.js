import { escapeHTML } from "./htmlUtils.js";
import {
    getBaseProfileData,
    getManualLeaveBalances,
    getProfileData,
    getRotativa,
    getReportSignatureConfig,
    getShiftAssigned,
    getValorHora
} from "./storage.js";
import { fetchHolidays } from "./holidays.js";
import {
    calcularExtraDiurnoProgramadoDia,
    calcularHorasMesPerfil
} from "./hoursEngine.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import {
    getTurnoExtraAgregado,
    getAbsenceType,
    esAusenciaInjustificada
} from "./rulesEngine.js";
import {
    calcHours,
    calcCarry,
    isBusinessDay
} from "./calculations.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import {
    codeToTurno,
    getReplacementLogForWorkerMonth,
    getReplacementOvertimeHours,
    getReplacementsForWorkerShift,
    turnoReplacementLabel
} from "./replacements.js";
import {
    cambioEstaAnulado,
    cambiosDelMes,
    getSwapPerspective
} from "./swaps.js";
import {
    formatContractDate,
    getContractsForProfile,
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getJSON } from "./persistence.js";
import {
    getClockExtraHours,
    getClockMarks
} from "./clockMarks.js";

const UNBACKED_OVERTIME_DETAIL = "Horas sin respaldo registrado";

function key(year, month, day) {
    return `${year}-${month}-${day}`;
}

function isoFromKey(keyDay) {
    const parts = String(keyDay || "").split("-");

    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(Number(parts[2])).padStart(2, "0")}`;
}

function keyFromISO(value) {
    const parts = String(value || "").split("-");

    return `${parts[0]}-${Number(parts[1]) - 1}-${Number(parts[2])}`;
}

function parseKey(keyDay) {
    const parts = String(keyDay || "").split("-");

    return new Date(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2])
    );
}

function formatDate(value) {
    const iso = String(value || "").includes("-")
        ? value
        : isoFromKey(value);
    const parts = String(iso || "").split("-");

    if (parts.length !== 3) return value || "";

    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function displayReportText(value) {
    return String(value ?? "")
        .replace(/\bSin informacion\b/g, "Sin informaci\u00f3n");
}

function formatHour(value) {
    const number = Math.round((Number(value) || 0) * 100) / 100;

    if (Number.isInteger(number)) {
        return String(number);
    }

    return String(number).replace(".", ",");
}

function formatMoney(value) {
    return new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function safeFileName(value) {
    return String(value || "reporte")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function reportSignatureFooterHTML() {
    const lines = getReportSignatureConfig()
        .lines
        .map(line => String(line || "").trim())
        .filter(Boolean);

    if (!lines.length) return "";

    return `
        <footer class="report-signature-footer">
            ${lines.map(line => `<div>${escapeHTML(line)}</div>`).join("")}
        </footer>
    `;
}

async function fetchReportHolidays(year) {
    const [previous, current, next] = await Promise.all([
        fetchHolidays(year - 1),
        fetchHolidays(year),
        fetchHolidays(year + 1)
    ]);

    return {
        ...previous,
        ...current,
        ...next
    };
}

function rotationLabel(type) {
    if (type === "3turno") return "3er Turno";
    if (type === "4turno") return "4° Turno";
    if (type === "diurno") return "Diurno";
    if (type === "libre") return "Libre";
    if (type === "reemplazo") return "Reemplazo";

    return "Sin rotativa";
}

function reportKind(profileName) {
    const type = getRotativa(profileName).type;

    if (isReplacementProfile(profileName)) return "replacement";
    if (getShiftAssigned(profileName) || type === "diurno") {
        return "extra-only";
    }

    return "shift-base";
}

function isNoAssignmentShiftProfile(profileName) {
    const type = getRotativa(profileName).type;

    return (
        (type === "3turno" || type === "4turno") &&
        !getShiftAssigned(profileName)
    );
}

export function isAssignedShiftReportProfile(profileName) {
    const type = getRotativa(profileName).type;

    return (
        (type === "3turno" || type === "4turno") &&
        getShiftAssigned(profileName)
    );
}

export function isReplacementReportProfile(profileName) {
    return isReplacementProfile(profileName);
}

export function isDiurnoReportProfile(profileName) {
    return (
        !isReplacementProfile(profileName) &&
        getRotativa(profileName).type === "diurno"
    );
}

function turnoLabel(turno) {
    return TURNO_LABEL[Number(turno) || TURNO.LIBRE] || "Libre";
}

function monthLabel(date) {
    return date.toLocaleString("es-CL", {
        month: "long",
        year: "numeric"
    });
}

function getSwapDetail(profileName, keyDay, swaps) {
    const iso = isoFromKey(keyDay);
    const details = [];

    swaps.forEach(swap => {
        if (cambioEstaAnulado(swap)) return;

        const perspective = getSwapPerspective(swap, profileName);

        if (!perspective) return;

        if (
            !perspective.changeSkipped &&
            perspective.changeDate === iso
        ) {
            details.push(`CCTT ${perspective.changeTurnLabel} con ${perspective.counterpart}`);
        }

        if (
            !perspective.returnSkipped &&
            perspective.returnDate === iso
        ) {
            details.push(`DDTT ${perspective.returnTurnLabel} con ${perspective.counterpart}`);
        }
    });

    return details.join(" | ");
}

function replacementDetail(profileName, keyDay) {
    const records = getReplacementsForWorkerShift(profileName, keyDay);

    if (!records.length) return "";

    return records.map(record => {
        if (record.replaced) {
            return `Reemplaza a ${record.replaced} por ${record.absenceType || "ausencia"}`;
        }

        return `Motivo: ${record.reason || record.absenceType || "sin detalle"}`;
    }).join(" | ");
}

function contractDetail(contracts, iso) {
    const contract = contracts.find(item =>
        item.start <= iso &&
        item.end >= iso
    );

    return contract
        ? `Contrato vigente: reemplaza a ${contract.replaces}`
        : "";
}

function activeContractsForMonth(profileName, year, month) {
    const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;

    return getContractsForProfile(profileName).filter(contract =>
        contract.start <= monthEnd &&
        contract.end >= monthStart
    );
}

function rowHours(date, turno, holidays) {
    const hours = calcHours(date, Number(turno) || 0, holidays) || {
        d: 0,
        n: 0
    };

    return {
        d: formatHour(hours.d),
        n: formatHour(hours.n)
    };
}

function numberHours(date, turno, holidays) {
    const hours = calcHours(date, Number(turno) || 0, holidays) || {
        d: 0,
        n: 0
    };

    return {
        d: Number(hours.d) || 0,
        n: Number(hours.n) || 0
    };
}

function addNumericHours(target, source) {
    target.d += Number(source?.d) || 0;
    target.n += Number(source?.n) || 0;
}

function hasPositiveHours(hours = {}) {
    return (
        (Number(hours.d) || 0) > 0 ||
        (Number(hours.n) || 0) > 0
    );
}

function readProfileMap(prefix, profileName) {
    return getJSON(`${prefix}_${profileName}`, {});
}

function getReportMaps(profileName) {
    return {
        admin: readProfileMap("admin", profileName),
        legal: readProfileMap("legal", profileName),
        comp: readProfileMap("comp", profileName),
        absences: readProfileMap("absences", profileName)
    };
}

function absenceTypeLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin goce";
    if (type === "unjustified_absence") return "Ausencia injustificada";
    if (type === "license") return "Licencia M\u00e9dica";

    return type ? "Ausencia" : "";
}

function dayAbsenceDetail(keyDay, maps) {
    if (maps.admin[keyDay] === 1) {
        return {
            label: "P. Administrativo",
            full: true,
            category: "admin"
        };
    }

    if (maps.admin[keyDay] === "0.5M") {
        return {
            label: "1/2 ADM Ma\u00f1ana",
            full: false,
            category: "half_admin",
            workState: TURNO.MEDIA_TARDE
        };
    }

    if (maps.admin[keyDay] === "0.5T") {
        return {
            label: "1/2 ADM Tarde",
            full: false,
            category: "half_admin",
            workState: TURNO.MEDIA_MANANA
        };
    }

    if (maps.admin[keyDay] === 0.5) {
        return {
            label: "1/2 ADM",
            full: false,
            category: "half_admin",
            workState: TURNO.LIBRE
        };
    }

    if (maps.legal[keyDay]) {
        return {
            label: "F. Legal",
            full: true,
            category: "legal"
        };
    }

    if (maps.comp[keyDay]) {
        return {
            label: "F. Compensatorio",
            full: true,
            category: "comp"
        };
    }

    if (maps.absences[keyDay]) {
        const type = getAbsenceType(maps.absences[keyDay]);

        return {
            label: absenceTypeLabel(type),
            full: true,
            category: type,
            type
        };
    }

    return null;
}

function actualStateForReport(profileName, data, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoProgramado(profileName, keyDay)
    );
}

function reportCarryForBoundary(profileName, date, data, maps, holidays) {
    const keyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );

    if (
        isReplacementProfile(profileName) &&
        !hasContractForDate(profileName, keyDay)
    ) {
        return { d: 0, n: 0 };
    }

    const absence = dayAbsenceDetail(keyDay, maps);

    if (absence?.full || esAusenciaInjustificada(maps.absences[keyDay])) {
        return { d: 0, n: 0 };
    }

    const state = actualStateForReport(profileName, data, keyDay);

    if (
        state !== TURNO.NOCHE &&
        state !== TURNO.TURNO24 &&
        state !== TURNO.DIURNO_NOCHE
    ) {
        return { d: 0, n: 0 };
    }

    const next = new Date(date);
    next.setDate(date.getDate() + 1);

    return isBusinessDay(next, holidays)
        ? { d: 1, n: 7 }
        : { d: 0, n: 8 };
}

function reportCarryIn(profileName, year, month, data, holidays) {
    const previous = new Date(year, month, 0);
    const maps = getReportMaps(profileName);

    return reportCarryForBoundary(
        profileName,
        previous,
        data,
        maps,
        holidays
    );
}

function reportCarryOut(profileName, year, month, days, data, holidays) {
    const maps = getReportMaps(profileName);

    return reportCarryForBoundary(
        profileName,
        new Date(year, month, days),
        data,
        maps,
        holidays
    );
}

function hasNightCarryComponent(turno) {
    const state = Number(turno) || TURNO.LIBRE;

    return (
        state === TURNO.NOCHE ||
        state === TURNO.TURNO24 ||
        state === TURNO.DIURNO_NOCHE ||
        state === TURNO.TURNO18
    );
}

function assignedExtraStateForDay(profileName, keyDay, data) {
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const actual = actualStateForReport(profileName, data, keyDay);

    return getTurnoExtraAgregado(baseWithSwaps, actual);
}

function assignedCarryForBoundary(profileName, date, data, maps, holidays) {
    const keyDay = key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const absence = dayAbsenceDetail(keyDay, maps);

    if (absence?.full || esAusenciaInjustificada(maps.absences[keyDay])) {
        return { d: 0, n: 0 };
    }

    const extraState = assignedExtraStateForDay(
        profileName,
        keyDay,
        data
    );

    if (!hasNightCarryComponent(extraState)) {
        return { d: 0, n: 0 };
    }

    return calcCarry(date, extraState, holidays);
}

function assignedCarryIn(profileName, year, month, holidays) {
    const previous = new Date(year, month, 0);
    const previousData = getProfileData(profileName);
    const maps = getReportMaps(profileName);

    return assignedCarryForBoundary(
        profileName,
        previous,
        previousData,
        maps,
        holidays
    );
}

function assignedCarryOut(profileName, year, month, days, data, holidays) {
    const maps = getReportMaps(profileName);

    return assignedCarryForBoundary(
        profileName,
        new Date(year, month, days),
        data,
        maps,
        holidays
    );
}

function clockMarkSummary(profileName, keyDay) {
    const mark = getClockMarks(profileName)[keyDay];

    if (!mark?.segments) return "";

    const items = Object.values(mark.segments)
        .map(segment => {
            const details = [];

            if (segment.missingEntry) details.push("Sin entrada");
            if (segment.missingExit) details.push("Sin salida");
            if (segment.entryTime) {
                details.push(`Entrada ${segment.entryTime}`);
            }
            if (segment.exitTime) {
                details.push(`Salida ${segment.exitTime}`);
            }

            const note = segment.adminNote || segment.comments;

            return [
                details.join(" / "),
                note
            ].filter(Boolean).join(": ");
        })
        .filter(Boolean);

    return items.join(" | ");
}

function buildNoAssignmentDayRows(
    profile,
    year,
    month,
    days,
    holidays,
    options = {}
) {
    const profileName = profile.name;
    const data = getProfileData(profileName);
    const baseData = getBaseProfileData(profileName);
    const swaps = cambiosDelMes(year, month);
    const contracts = activeContractsForMonth(
        profileName,
        year,
        month
    );
    const maps = getReportMaps(profileName);
    const rows = [];
    const rawTotals = { d: 0, n: 0 };

    for (let day = 1; day <= days; day++) {
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);
        const date = parseKey(keyDay);
        const rawBase = getTurnoBase(profileName, keyDay);
        const contractIsRequired =
            options.contractOnly === true;
        const hasActiveContract =
            !contractIsRequired ||
            hasContractForDate(profileName, keyDay);

        if (!hasActiveContract) {
            rows.push({
                fecha: formatDate(iso),
                diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
                tipo: "Sin contrato",
                turnoBase: turnoLabel(rawBase),
                turnoConCambios: "-",
                turnoRealizado: "SIN CONTRATO",
                turnoExtra: "-",
                horasDiurnas: "-",
                horasNocturnas: "-",
                respaldo: "SIN CONTRATO"
            });
            continue;
        }

        const baseWithSwaps = aplicarCambiosTurno(
            profileName,
            keyDay,
            rawBase,
            { includeReplacements: false }
        );
        const actual = actualStateForReport(profileName, data, keyDay);
        const absence = dayAbsenceDetail(keyDay, maps);
        const workState = absence?.full
            ? TURNO.LIBRE
            : absence?.workState || actual;
        const hours = numberHours(date, workState, holidays);
        const hasManualBase =
            Object.prototype.hasOwnProperty.call(baseData, keyDay) ||
            rawBase > TURNO.LIBRE;
        const swap = getSwapDetail(profileName, keyDay, swaps);
        const replacement = replacementDetail(profileName, keyDay);
        const contract = contractDetail(contracts, iso);
        const clock = clockMarkSummary(profileName, keyDay);
        const details = [
            absence?.label,
            replacement,
            contract,
            swap,
            clock
        ].filter(Boolean).join(" | ");
        const extraState = getTurnoExtraAgregado(baseWithSwaps, actual);

        addNumericHours(rawTotals, hours);

        rows.push({
            fecha: formatDate(iso),
            diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
            tipo: hasManualBase
                ? "Turno base"
                : "Turno registrado",
            turnoBase: turnoLabel(rawBase),
            turnoConCambios: turnoLabel(baseWithSwaps),
            turnoRealizado: absence?.label || turnoLabel(actual),
            turnoExtra: turnoLabel(extraState),
            horasDiurnas: formatHour(hours.d),
            horasNocturnas: formatHour(hours.n),
            respaldo: details || (
                Number(extraState) > TURNO.LIBRE
                    ? UNBACKED_OVERTIME_DETAIL
                    : ""
            )
        });
    }

    return {
        rows,
        rawTotals
    };
}

function formatExtraCell(value) {
    const number = Math.round((Number(value) || 0) * 100) / 100;

    return number ? formatHour(number) : "-";
}

function combineNumericHours(...sources) {
    return sources.reduce((total, source) => ({
        d: total.d + (Number(source?.d) || 0),
        n: total.n + (Number(source?.n) || 0)
    }), { d: 0, n: 0 });
}

function subtractNumericHours(base, subtraction) {
    return {
        d: (Number(base?.d) || 0) - (Number(subtraction?.d) || 0),
        n: (Number(base?.n) || 0) - (Number(subtraction?.n) || 0)
    };
}

function buildAssignedShiftDayRows(profile, year, month, days, holidays) {
    const profileName = profile.name;
    const isDiurno = isDiurnoReportProfile(profileName);
    const data = getProfileData(profileName);
    const swaps = cambiosDelMes(year, month);
    const contracts = activeContractsForMonth(
        profileName,
        year,
        month
    );
    const maps = getReportMaps(profileName);
    const rows = [];
    const rawTotals = { d: 0, n: 0 };

    for (let day = 1; day <= days; day++) {
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);
        const date = parseKey(keyDay);
        const rawBase = getTurnoBase(profileName, keyDay);
        const baseWithSwaps = aplicarCambiosTurno(
            profileName,
            keyDay,
            rawBase,
            { includeReplacements: false }
        );
        const actual = actualStateForReport(profileName, data, keyDay);
        const absence = dayAbsenceDetail(keyDay, maps);
        const extraState = absence?.full
            ? TURNO.LIBRE
            : getTurnoExtraAgregado(baseWithSwaps, actual);
        const shiftExtraHours = isDiurno
            ? calcularExtraDiurnoProgramadoDia(
                date,
                absence?.full ? TURNO.LIBRE : actual,
                holidays
            )
            : numberHours(date, extraState, holidays);
        const clockExtraHours = absence?.full
            ? { d: 0, n: 0 }
            : getClockExtraHours(
                profileName,
                keyDay,
                date,
                actual,
                holidays
            );
        const extraHours = combineNumericHours(
            shiftExtraHours,
            clockExtraHours
        );
        const swap = getSwapDetail(profileName, keyDay, swaps);
        const replacement = replacementDetail(profileName, keyDay);
        const contract = contractDetail(contracts, iso);
        const clock = clockMarkSummary(profileName, keyDay);
        const details = [
            absence?.label,
            replacement,
            contract,
            swap,
            clock
        ].filter(Boolean).join(" | ");

        addNumericHours(rawTotals, extraHours);

        rows.push({
            fecha: formatDate(iso),
            diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
            turnoBase: turnoLabel(rawBase),
            turnoRealizado: absence?.label || turnoLabel(actual),
            hheeDiurnas: formatExtraCell(extraHours.d),
            hheeNocturnas: formatExtraCell(extraHours.n),
            respaldo: details || (
                hasPositiveHours(extraHours)
                    ? UNBACKED_OVERTIME_DETAIL
                    : ""
            )
        });
    }

    return {
        rows,
        rawTotals
    };
}

function buildDayRows(profile, year, month, days, holidays, kind) {
    const profileName = profile.name;
    const data = getProfileData(profileName);
    const baseData = getBaseProfileData(profileName);
    const swaps = cambiosDelMes(year, month);
    const contracts = activeContractsForMonth(
        profileName,
        year,
        month
    );
    const rows = [];

    for (let day = 1; day <= days; day++) {
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);
        const date = parseKey(keyDay);
        const rawBase = getTurnoBase(profileName, keyDay);
        const baseWithSwaps = aplicarCambiosTurno(
            profileName,
            keyDay,
            rawBase,
            { includeReplacements: false }
        );
        const actual = actualStateForReport(
            profileName,
            data,
            keyDay
        );
        const extraState =
            getTurnoExtraAgregado(baseWithSwaps, actual);
        const hasManualBase =
            Object.prototype.hasOwnProperty.call(baseData, keyDay) ||
            rawBase > TURNO.LIBRE;
        const swap = getSwapDetail(profileName, keyDay, swaps);
        const replacement = replacementDetail(profileName, keyDay);
        const contract = contractDetail(contracts, iso);
        const details = [
            replacement,
            contract,
            swap
        ].filter(Boolean).join(" | ");
        const actualHours = rowHours(date, actual, holidays);
        const extraHours = rowHours(date, extraState, holidays);
        const isExtra = Number(extraState) > TURNO.LIBRE;
        const hasReplacement =
            getReplacementsForWorkerShift(profileName, keyDay).length > 0;
        const include =
            kind === "extra-only"
                ? isExtra || hasReplacement
                : kind === "replacement"
                    ? actual || hasReplacement || contract || swap
                    : rawBase || baseWithSwaps || actual || hasReplacement || swap;

        if (!include) continue;

        rows.push({
            fecha: formatDate(iso),
            diaHabil: isBusinessDay(date, holidays) ? "S\u00ed" : "No",
            tipo: kind === "extra-only"
                ? "Turno extra"
                : hasManualBase
                    ? "Turno base"
                    : "Turno registrado",
            turnoBase: turnoLabel(rawBase),
            turnoConCambios: turnoLabel(baseWithSwaps),
            turnoRealizado: turnoLabel(actual),
            turnoExtra: turnoLabel(extraState),
            horasDiurnas: kind === "extra-only"
                ? extraHours.d
                : actualHours.d,
            horasNocturnas: kind === "extra-only"
                ? extraHours.n
                : actualHours.n,
            respaldo: details || (
                isExtra
                    ? UNBACKED_OVERTIME_DETAIL
                    : ""
            )
        });
    }

    return rows;
}

function buildReplacementLogRows(profileName, year, month, holidays) {
    return getReplacementLogForWorkerMonth(profileName, year, month)
        .map(record => {
            const keyDay = keyFromISO(record.date);
            const date = parseKey(keyDay);
            const turno = codeToTurno(record.turno);
            const hours = getReplacementOvertimeHours(
                record,
                date,
                turno,
                holidays
            ) || { d: 0, n: 0 };

            return {
                fecha: formatDate(record.date),
                turno: turnoReplacementLabel(turno),
                diurnas: formatHour(hours.d),
                nocturnas: formatHour(hours.n),
                reemplaza: record.replaced || "",
                motivo: record.replaced
                    ? record.absenceType || "Ausencia"
                    : record.reason || record.absenceType || "Sin detalle"
            };
        });
}

function buildSwapRows(profileName, year, month) {
    return cambiosDelMes(year, month)
        .filter(swap =>
            swap.from === profileName ||
            swap.to === profileName
        )
        .map(swap => {
            const perspective =
                getSwapPerspective(swap, profileName);
            const fechaCambio =
                perspective && !perspective.changeSkipped
                    ? formatDate(perspective.changeDate)
                    : "";
            const fechaDevolucion =
                perspective && !perspective.returnSkipped
                    ? formatDate(perspective.returnDate)
                    : "";

            return {
                estado: cambioEstaAnulado(swap) ? "Anulado" : "Activo",
                entrega: profileName,
                recibe: perspective?.counterpart || "",
                fechaCambio,
                turnoCambio: perspective?.changeTurnLabel || "",
                fechaDevolucion,
                turnoDevolucion: perspective?.returnTurnLabel || ""
            };
        });
}

function buildContractRows(profileName, year, month) {
    return activeContractsForMonth(profileName, year, month)
        .map(contract => ({
            inicio: formatContractDate(contract.start),
            termino: formatContractDate(contract.end),
            reemplaza: contract.replaces,
            motivo: contract.reason || ""
        }));
}

function finiteBalance(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric)
        ? Math.max(0, numeric)
        : null;
}

function leaveBalanceCategory(absence) {
    if (!absence) return "";

    if (
        absence.category === "admin" ||
        absence.category === "half_admin"
    ) {
        return "admin";
    }

    if (absence.category === "legal") return "legal";
    if (absence.category === "comp") return "comp";

    return "";
}

function leaveBalanceUsageForDay(keyDay, maps, holidays) {
    const date = parseKey(keyDay);
    const absence = dayAbsenceDetail(keyDay, maps);
    const category = leaveBalanceCategory(absence);

    if (!category) return null;

    return {
        category,
        amount: isBusinessDay(date, holidays)
            ? (absence.full ? 1 : 0.5)
            : 0
    };
}

function leaveBalanceKeysForYear(maps, year) {
    return [
        ...new Set([
            ...Object.keys(maps.admin),
            ...Object.keys(maps.legal),
            ...Object.keys(maps.comp)
        ])
    ]
        .filter(keyDay => parseKey(keyDay).getFullYear() === year)
        .sort((a, b) => parseKey(a) - parseKey(b));
}

function createPermissionBalanceTracker(
    profileName,
    year,
    month,
    maps,
    holidays
) {
    const manual = getManualLeaveBalances(year, profileName);
    const usedInYear = {
        admin: 0,
        legal: 0,
        comp: 0
    };
    const usedBeforeMonth = {
        admin: 0,
        legal: 0,
        comp: 0
    };
    const monthStart = new Date(year, month, 1);

    leaveBalanceKeysForYear(maps, year).forEach(keyDay => {
        const usage = leaveBalanceUsageForDay(
            keyDay,
            maps,
            holidays
        );

        if (!usage) return;

        usedInYear[usage.category] += usage.amount;

        if (parseKey(keyDay) < monthStart) {
            usedBeforeMonth[usage.category] += usage.amount;
        }
    });

    const currentBalances = {
        admin:
            finiteBalance(manual.admin) ??
            Math.max(0, 6 - usedInYear.admin),
        legal:
            finiteBalance(manual.legal) ??
            Math.max(0, 15 - usedInYear.legal),
        comp:
            finiteBalance(manual.comp) ??
            Math.max(0, 10 - usedInYear.comp)
    };
    const remaining = Object.fromEntries(
        Object.entries(currentBalances).map(([category, value]) => [
            category,
            value === null
                ? null
                : value +
                    usedInYear[category] -
                    usedBeforeMonth[category]
        ])
    );

    return {
        apply(absence, keyDay) {
            const category = leaveBalanceCategory(absence);

            if (!category || remaining[category] === null) return "";

            const usage = leaveBalanceUsageForDay(
                keyDay,
                maps,
                holidays
            );

            if (usage) {
                remaining[category] = Math.max(
                    0,
                    remaining[category] - usage.amount
                );
            }

            return formatHour(remaining[category]);
        }
    };
}

function nextDayKey(keyDay) {
    const date = parseKey(keyDay);

    date.setDate(date.getDate() + 1);

    return key(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
}

function permissionGroupKey(absence) {
    return [
        absence?.category || "",
        absence?.type || "",
        absence?.label || ""
    ].join("|");
}

function appendPermissionSegment(rows, segment) {
    if (!segment) return;

    rows.push({
        inicio: formatDate(segment.startISO),
        termino: formatDate(segment.endISO),
        cantidad: formatHour(segment.amount),
        tipo: segment.label,
        nuevoSaldo: segment.nuevoSaldo
    });
}

function permissionRowsAndAdjustments(
    profileName,
    year,
    month,
    days,
    holidays,
    options = {}
) {
    const maps = getReportMaps(profileName);
    const rows = [];
    let currentSegment = null;
    const balanceTracker = createPermissionBalanceTracker(
        profileName,
        year,
        month,
        maps,
        holidays
    );
    const adjustments = {
        businessDays: 0,
        businessHours: 0,
        adminFullDays: 0,
        adminFullHours: 0,
        halfAdminCount: 0,
        halfAdminHours: 0,
        legalDays: 0,
        legalHours: 0,
        compDays: 0,
        compHours: 0,
        medicalBusinessDays: 0,
        medicalHours: 0,
        otherApprovedDays: 0,
        otherApprovedHours: 0
    };

    for (let day = 1; day <= days; day++) {
        const date = new Date(year, month, day);
        const keyDay = key(year, month, day);
        const iso = isoFromKey(keyDay);

        if (
            options.contractOnly === true &&
            !hasContractForDate(profileName, keyDay)
        ) {
            appendPermissionSegment(rows, currentSegment);
            currentSegment = null;
            continue;
        }

        const isBusiness = isBusinessDay(date, holidays);
        const absence = dayAbsenceDetail(keyDay, maps);

        if (isBusiness) {
            adjustments.businessDays += 1;
            adjustments.businessHours += 8.8;
        }

        if (!absence) continue;

        const amount = absence.full ? 1 : 0.5;
        const groupKey = permissionGroupKey(absence);
        const nuevoSaldo = balanceTracker.apply(absence, keyDay);
        const hours = isBusiness
            ? (absence.full ? 8.8 : 4.4)
            : 0;

        if (absence.category === "admin" && isBusiness) {
            adjustments.adminFullDays += 1;
            adjustments.adminFullHours += hours;
        } else if (absence.category === "half_admin" && isBusiness) {
            adjustments.halfAdminCount += 1;
            adjustments.halfAdminHours += hours;
        } else if (absence.category === "legal" && isBusiness) {
            adjustments.legalDays += 1;
            adjustments.legalHours += hours;
        } else if (absence.category === "comp" && isBusiness) {
            adjustments.compDays += 1;
            adjustments.compHours += hours;
        } else if (
            (absence.type === "license" ||
                absence.type === "union_leave" ||
                absence.type === "professional_license") &&
            isBusiness
        ) {
            adjustments.medicalBusinessDays += 1;
            adjustments.medicalHours += hours;
        } else if (
            absence.full &&
            !esAusenciaInjustificada(maps.absences[keyDay]) &&
            isBusiness
        ) {
            adjustments.otherApprovedDays += 1;
            adjustments.otherApprovedHours += hours;
        }

        if (
            currentSegment &&
            currentSegment.groupKey === groupKey &&
            nextDayKey(currentSegment.endKey) === keyDay
        ) {
            currentSegment.endKey = keyDay;
            currentSegment.endISO = iso;
            currentSegment.amount += amount;
            currentSegment.nuevoSaldo = nuevoSaldo;
        } else {
            appendPermissionSegment(rows, currentSegment);
            currentSegment = {
                groupKey,
                startKey: keyDay,
                endKey: keyDay,
                startISO: iso,
                endISO: iso,
                amount,
                label: absence.label,
                nuevoSaldo
            };
        }
    }

    appendPermissionSegment(rows, currentSegment);

    return {
        rows,
        adjustments
    };
}

function buildClockRows(profileName, year, month) {
    const marks = getClockMarks(profileName);
    const rows = [];

    Object.entries(marks).forEach(([keyDay, mark]) => {
        const parsed = parseKey(keyDay);

        if (parsed.getFullYear() !== year || parsed.getMonth() !== month) {
            return;
        }

        Object.values(mark.segments || {}).forEach(segment => {
            const incidence = [
                segment.missingEntry ? "Sin entrada" : "",
                segment.missingExit ? "Sin salida" : "",
                segment.entryTime ? `Entrada ${segment.entryTime}` : "",
                segment.exitTime ? `Salida ${segment.exitTime}` : ""
            ].filter(Boolean).join(" / ");

            if (!incidence) return;

            rows.push({
                fecha: formatDate(isoFromKey(keyDay)),
                turno: segment.label || "",
                incidencia: incidence,
                comentario:
                    segment.adminNote ||
                    segment.comments ||
                    ""
            });
        });
    });

    return rows.sort((a, b) =>
        a.fecha.localeCompare(b.fecha)
    );
}

function buildNoAssignmentReportModel({
    profile,
    monthDate,
    holidays,
    stats,
    contractOnly = false
}) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const data = getProfileData(profile.name);
    const dayDetail = buildNoAssignmentDayRows(
        profile,
        year,
        month,
        days,
        holidays,
        { contractOnly }
    );
    const carryIn = reportCarryIn(
        profile.name,
        year,
        month,
        data,
        holidays
    );
    const carryOut = reportCarryOut(
        profile.name,
        year,
        month,
        days,
        data,
        holidays
    );
    const totalD =
        dayDetail.rawTotals.d + carryIn.d - carryOut.d;
    const totalN =
        dayDetail.rawTotals.n + carryIn.n - carryOut.n;
    const permissions = permissionRowsAndAdjustments(
        profile.name,
        year,
        month,
        days,
        holidays,
        { contractOnly }
    );
    const valorHora = getValorHora(profile.name);
    const monthName = monthLabel(monthDate);

    return {
        profile,
        monthDate,
        year,
        month,
        monthName,
        stats,
        contractOnly,
        valorHora,
        rawDiurnas: dayDetail.rawTotals.d,
        rawNocturnas: dayDetail.rawTotals.n,
        carryIn,
        carryOut,
        totalD,
        totalN,
        totalWorked: totalD + totalN,
        adjustments: permissions.adjustments,
        permissionRows: permissions.rows,
        contractRows: contractOnly
            ? buildContractRows(profile.name, year, month)
            : [],
        swapRows: buildSwapRows(profile.name, year, month),
        clockRows: buildClockRows(profile.name, year, month),
        dayRows: [
            ...dayDetail.rows,
            {
                fecha: "Total del mes",
                turnoBase: "",
                turnoRealizado: "",
                horasDiurnas: formatHour(totalD),
                horasNocturnas: formatHour(totalN),
                respaldo: ""
            }
        ]
    };
}

function buildAssignedShiftReportModel({
    profile,
    monthDate,
    holidays,
    stats
}) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const data = getProfileData(profile.name);
    const dayDetail = buildAssignedShiftDayRows(
        profile,
        year,
        month,
        days,
        holidays
    );
    const carryIn = assignedCarryIn(
        profile.name,
        year,
        month,
        holidays
    );
    const carryOut = assignedCarryOut(
        profile.name,
        year,
        month,
        days,
        data,
        holidays
    );
    const currentMonthTotals = subtractNumericHours(
        dayDetail.rawTotals,
        carryOut
    );
    const totalD =
        dayDetail.rawTotals.d + carryIn.d - carryOut.d;
    const totalN =
        dayDetail.rawTotals.n + carryIn.n - carryOut.n;
    const permissions = permissionRowsAndAdjustments(
        profile.name,
        year,
        month,
        days,
        holidays
    );
    const valorHora = getValorHora(profile.name);
    const monthName = monthLabel(monthDate);
    return {
        profile,
        monthDate,
        year,
        month,
        monthName,
        stats,
        valorHora,
        rawDiurnas: dayDetail.rawTotals.d,
        rawNocturnas: dayDetail.rawTotals.n,
        currentMonthDiurnas: currentMonthTotals.d,
        currentMonthNocturnas: currentMonthTotals.n,
        carryIn,
        carryOut,
        totalD,
        totalN,
        paymentDiurno: stats.returnTransferEnabled
            ? 0
            : totalD * valorHora * 1.25,
        paymentNocturno: stats.returnTransferEnabled
            ? 0
            : totalN * valorHora * 1.5,
        permissionRows: permissions.rows,
        swapRows: buildSwapRows(profile.name, year, month),
        clockRows: buildClockRows(profile.name, year, month),
        dayRows: dayDetail.rows
    };
}

function table(title, columns, rows) {
    const body = rows.length
        ? rows.map(row => `
            <tr>
                ${columns.map(column => `
                    <td>${escapeHTML(displayReportText(row[column.key] ?? ""))}</td>
                `).join("")}
            </tr>
        `).join("")
        : `
            <tr>
                <td colspan="${columns.length}">Sin registros para este mes.</td>
            </tr>
        `;

    return `
        <h2>${escapeHTML(title)}</h2>
        <table>
            <thead>
                <tr>
                    ${columns.map(column => `<th>${escapeHTML(column.label)}</th>`).join("")}
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>
    `;
}

function reportTableRowsHTML(columns, rows, emptyText) {
    return rows.length
        ? rows.map(row => {
            const rowClass =
                row.diaHabil === "No"
                    ? ` class="report-row--inhabil"`
                    : "";

            return `
            <tr${rowClass}>
                ${columns.map(column => `
                    <td>${escapeHTML(displayReportText(row[column.key] ?? ""))}</td>
                `).join("")}
            </tr>
        `;
        }).join("")
        : `
            <tr>
                <td colspan="${columns.length}">${escapeHTML(emptyText)}</td>
            </tr>
        `;
}

function reportWorkerDataTable(title, columns, rows, emptyText) {
    const middle = Math.ceil(rows.length / 2);
    const groups = rows.length
        ? [rows.slice(0, middle), rows.slice(middle)]
        : [[]];

    return `
        <section class="report-section report-section--worker-data">
            <h4>${escapeHTML(title)}</h4>
            <div class="report-worker-data-grid">
                ${groups.map((group, index) => `
                    <div class="report-worker-data-column">
                        <div class="report-table-wrap">
                            <table class="report-table">
                                <thead>
                                    <tr>
                                        ${columns.map(column => `<th>${escapeHTML(column.label)}</th>`).join("")}
                                    </tr>
                                </thead>
                                <tbody>${reportTableRowsHTML(columns, group, emptyText)}</tbody>
                            </table>
                        </div>
                    </div>
                `).join("")}
            </div>
        </section>
    `;
}

function reportTable(title, columns, rows, emptyText = "Sin registros para este mes.") {
    if (title === "Datos del trabajador") {
        return reportWorkerDataTable(
            title,
            columns,
            rows,
            emptyText
        );
    }

    const body = reportTableRowsHTML(columns, rows, emptyText);

    return `
        <section class="report-section">
            <h4>${escapeHTML(title)}</h4>
            <div class="report-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            ${columns.map(column => `<th>${escapeHTML(column.label)}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </section>
    `;
}

function noAssignmentHoursRows(model) {
    return [
        {
            item: "Horas diurnas",
            signo: "(+)",
            valor: formatHour(model.rawDiurnas),
            item2: "Horas nocturnas",
            signo2: "(+)",
            valor2: formatHour(model.rawNocturnas)
        },
        {
            item: "Horas diurnas mes anterior",
            signo: "(+)",
            valor: formatHour(model.carryIn.d),
            item2: "Horas nocturnas mes anterior",
            signo2: "(+)",
            valor2: formatHour(model.carryIn.n)
        },
        {
            item: "Horas diurnas mes siguiente",
            signo: "(-)",
            valor: formatHour(model.carryOut.d),
            item2: "Horas nocturnas mes siguiente",
            signo2: "(-)",
            valor2: formatHour(model.carryOut.n)
        },
        {
            item: "Total Horas Diurnas",
            signo: "(=)",
            valor: formatHour(model.totalD),
            item2: "Total Horas Nocturnas",
            signo2: "(=)",
            valor2: formatHour(model.totalN)
        }
    ];
}

function noAssignmentBusinessRows(model) {
    const adj = model.adjustments;
    const rows = [
        {
            cantidad: formatHour(adj.businessDays),
            item: "D\u00edas h\u00e1biles con contrato",
            signo: "(+)",
            horas: formatHour(adj.businessHours)
        }
    ];

    const adjustmentRows = [
        ["adminFullDays", "adminFullHours", "P. Administrativos"],
        ["legalDays", "legalHours", "F. Legal"],
        ["halfAdminCount", "halfAdminHours", "1/2 ADM ma\u00f1ana/tarde"],
        ["medicalBusinessDays", "medicalHours", "Licencias m\u00e9dicas / LM Profesional en d\u00edas h\u00e1biles"]
    ];

    if (!model.contractOnly) {
        adjustmentRows.splice(
            2,
            0,
            ["compDays", "compHours", "F. Compensatorios"]
        );
        adjustmentRows.push([
            "otherApprovedDays",
            "otherApprovedHours",
            "Otros permisos aprobados"
        ]);
    }

    adjustmentRows.forEach(([countKey, hoursKey, label]) => {
        if (!adj[countKey]) return;

        rows.push({
            cantidad: formatHour(adj[countKey]),
            item: label,
            signo: "(-)",
            horas: formatHour(adj[hoursKey])
        });
    });

    rows.push({
        cantidad: "",
        item: `Total Horas h\u00e1biles de ${model.monthName}`,
        signo: "(=)",
        horas: formatHour(model.stats.horasHabiles)
    });

    return rows;
}

function formatReturnTransferValue(hours) {
    return `${formatHour(Math.max(0, Number(hours) || 0))}h`;
}

function noAssignmentExtraRows(model) {
    const returnTransferEnabled =
        Boolean(model.stats?.returnTransferEnabled);
    const dayReturnHours =
        Math.max(0, Number(model.stats?.hheeDiurnas) || 0) * 1.25;
    const nightReturnHours =
        Math.max(0, Number(model.stats?.hheeNocturnas) || 0) * 1.5;

    return [
        {
            item: `Horas h\u00e1biles ${model.monthName}`,
            valor: formatHour(model.stats.horasHabiles),
            item2: "HHEE Diurnas",
            valor2: formatHour(model.stats.hheeDiurnas)
        },
        {
            item: "Total horas realizadas",
            valor: formatHour(model.totalWorked),
            item2: "HHEE Nocturnas",
            valor2: formatHour(model.stats.hheeNocturnas)
        },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n diurna"
                : "Pago diurno estimado",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(dayReturnHours)
                : `$${formatMoney(model.stats.paymentDiurno)}`,
            item2: returnTransferEnabled
                ? "A devoluci\u00f3n nocturna"
                : "Pago nocturno estimado",
            valor2: returnTransferEnabled
                ? formatReturnTransferValue(nightReturnHours)
                : `$${formatMoney(model.stats.paymentNocturno)}`
        }
    ];
}

function assignedShiftSummaryRows(model) {
    const returnTransferEnabled =
        Boolean(model.stats?.returnTransferEnabled);
    const dayReturnHours =
        Math.max(0, Number(model.totalD) || 0) * 1.25;
    const nightReturnHours =
        Math.max(0, Number(model.totalN) || 0) * 1.5;

    return [
        {
            item: "HHEE diurnas mes anterior",
            signo: "(+)",
            valor: formatHour(model.carryIn.d),
            item2: "HHEE nocturnas mes anterior",
            signo2: "(+)",
            valor2: formatHour(model.carryIn.n)
        },
        {
            item: "HHEE diurnas mes siguiente",
            signo: "(-)",
            valor: formatHour(model.carryOut.d),
            item2: "HHEE nocturnas mes siguiente",
            signo2: "(-)",
            valor2: formatHour(model.carryOut.n)
        },
        {
            item: "HHEE realizadas en mes actual",
            signo: "(+)",
            valor: formatHour(model.rawDiurnas),
            item2: "HHEE realizadas en mes actual",
            signo2: "(+)",
            valor2: formatHour(model.rawNocturnas)
        },
        {
            item: returnTransferEnabled
                ? "Total HHEE diurnas a devoluci\u00f3n"
                : "Total HHEE diurnas a pago",
            signo: "(=)",
            valor: formatHour(model.totalD),
            item2: returnTransferEnabled
                ? "Total HHEE nocturnas a devoluci\u00f3n"
                : "Total HHEE nocturnas a pago",
            signo2: "(=)",
            valor2: formatHour(model.totalN)
        },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n diurna"
                : "Pago extra diurno estimado",
            signo: "(=)",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(dayReturnHours)
                : `$${formatMoney(model.paymentDiurno)}`,
            item2: returnTransferEnabled
                ? "A devoluci\u00f3n nocturna"
                : "Pago extra nocturno estimado",
            signo2: "(=)",
            valor2: returnTransferEnabled
                ? formatReturnTransferValue(nightReturnHours)
                : `$${formatMoney(model.paymentNocturno)}`
        }
    ];
}

function noAssignmentProfileRows(model) {
    const workspace = getActiveWorkspace();
    const replacementContract =
        isReplacementProfile(model.profile.name)
            ? activeContractsForMonth(
                model.profile.name,
                model.year,
                model.month
            )[0]
            : null;
    const rotativa = replacementContract
        ? getRotativa(replacementContract.replaces)
        : getRotativa(model.profile.name);

    return [
        { campo: "Nombre", valor: model.profile.name },
        { campo: "RUT", valor: model.profile.rut || "Sin registro" },
        { campo: "Unidad", valor: workspace?.name || "Sin entorno activo" },
        { campo: "Contrato", valor: model.profile.contractType || "Sin registro" },
        { campo: "Grado", valor: model.profile.grade || "Sin registro" },
        { campo: "Asignaci\u00f3n de Turno", valor: getShiftAssigned(model.profile.name) ? "S\u00cd" : "NO" },
        { campo: "Estamento", valor: model.profile.estamento || "Sin registro" },
        { campo: "Rotativa", valor: rotationLabel(rotativa.type) },
        { campo: "Profesi\u00f3n", valor: model.profile.profession || "Sin informaci\u00f3n" },
        { campo: "Valor Hora", valor: `$${formatMoney(model.valorHora)}` }
    ];
}

function buildNoAssignmentReportHTML(model) {
    return `
        <div class="no-assignment-report">
            <div class="report-title-strip">
                PLANILLA "${escapeHTML(model.monthName.toUpperCase())}"
            </div>
            ${reportTable("Datos del trabajador", [
                { key: "campo", label: "Campo" },
                { key: "valor", label: "Valor" }
            ], noAssignmentProfileRows(model))}
            ${model.contractRows?.length ? reportTable("Contratos", [
                { key: "inicio", label: "Fecha Inicio" },
                { key: "termino", label: "Fecha T\u00e9rmino" },
                { key: "reemplaza", label: "Reemplaza a" },
                { key: "motivo", label: "Motivo" }
            ], model.contractRows) : ""}
            ${reportTable("Horas del Mes", [
                { key: "item", label: "Concepto diurno" },
                { key: "signo", label: "" },
                { key: "valor", label: "Horas" },
                { key: "item2", label: "Concepto nocturno" },
                { key: "signo2", label: "" },
                { key: "valor2", label: "Horas" }
            ], noAssignmentHoursRows(model))}
            ${reportTable("Cálculo de Horas Hábiles", [
                { key: "cantidad", label: "Cantidad" },
                { key: "item", label: "Concepto" },
                { key: "signo", label: "" },
                { key: "horas", label: "Horas" }
            ], noAssignmentBusinessRows(model))}
            ${reportTable("Horas extras", [
                { key: "item", label: "Concepto" },
                { key: "valor", label: "Valor" },
                { key: "item2", label: "Concepto" },
                { key: "valor2", label: "Valor" }
            ], noAssignmentExtraRows(model))}
            ${reportTable("Permisos / Ausencias", [
                { key: "inicio", label: "Fecha Inicio" },
                { key: "termino", label: "Fecha T\u00e9rmino" },
                { key: "cantidad", label: "N° Solicitado" },
                { key: "tipo", label: "Tipo de permiso" },
                { key: "nuevoSaldo", label: "Nuevo Saldo" }
            ], model.permissionRows)}
            ${reportTable("Cambios de turno", [
                { key: "estado", label: "Estado" },
                { key: "entrega", label: "Entrega turno" },
                { key: "recibe", label: "Recibe turno" },
                { key: "fechaCambio", label: "Fecha cambio" },
                { key: "turnoCambio", label: "Turno cambio" },
                { key: "fechaDevolucion", label: "Fecha devoluci\u00f3n" },
                { key: "turnoDevolucion", label: "Turno devoluci\u00f3n" }
            ], model.swapRows)}
            ${reportTable("Registros de marcaje", [
                { key: "fecha", label: "Fecha" },
                { key: "turno", label: "Turno" },
                { key: "incidencia", label: "Tipo de Incidencia" },
                { key: "comentario", label: "Comentario" }
            ], model.clockRows)}
            ${reportTable("Detalle de turnos", [
                { key: "fecha", label: "Fecha" },
                { key: "turnoBase", label: "Turno Base" },
                { key: "turnoRealizado", label: "Turno realizado" },
                { key: "horasDiurnas", label: "Horas diurnas" },
                { key: "horasNocturnas", label: "Horas nocturnas" },
                { key: "respaldo", label: "Reemplazo / motivo / CCTT" }
            ], model.dayRows)}
            ${reportSignatureFooterHTML()}
        </div>
    `;
}

function buildAssignedShiftReportHTML(model) {
    return `
        <div class="no-assignment-report assigned-shift-report">
            <div class="report-title-strip">
                PLANILLA "${escapeHTML(model.monthName.toUpperCase())}"
            </div>
            ${reportTable("Datos del trabajador", [
                { key: "campo", label: "Campo" },
                { key: "valor", label: "Valor" }
            ], noAssignmentProfileRows(model))}
            ${reportTable("Resumen de horas extras", [
                { key: "item", label: "Concepto diurno" },
                { key: "signo", label: "" },
                { key: "valor", label: "Horas / Valor" },
                { key: "item2", label: "Concepto nocturno" },
                { key: "signo2", label: "" },
                { key: "valor2", label: "Horas / Valor" }
            ], assignedShiftSummaryRows(model))}
            ${reportTable("Permisos / Ausencias", [
                { key: "inicio", label: "Fecha Inicio" },
                { key: "termino", label: "Fecha T\u00e9rmino" },
                { key: "cantidad", label: "N° Solicitado" },
                { key: "tipo", label: "Tipo de permiso" },
                { key: "nuevoSaldo", label: "Nuevo Saldo" }
            ], model.permissionRows)}
            ${reportTable("Cambios de turno", [
                { key: "recibe", label: "Recibe turno" },
                { key: "fechaCambio", label: "Fecha cambio" },
                { key: "turnoCambio", label: "Turno cambio" },
                { key: "fechaDevolucion", label: "Fecha devoluci\u00f3n" },
                { key: "turnoDevolucion", label: "Turno devoluci\u00f3n" }
            ], model.swapRows)}
            ${reportTable("Registros de marcaje", [
                { key: "fecha", label: "Fecha" },
                { key: "turno", label: "Turno" },
                { key: "incidencia", label: "Tipo de Incidencia" },
                { key: "comentario", label: "Comentario" }
            ], model.clockRows)}
            ${reportTable("Detalle de turnos", [
                { key: "fecha", label: "Fecha" },
                { key: "turnoBase", label: "Turno Base" },
                { key: "turnoRealizado", label: "Turno realizado" },
                { key: "hheeDiurnas", label: "HHEE diurnas" },
                { key: "hheeNocturnas", label: "HHEE nocturnas" },
                { key: "respaldo", label: "Reemplazo / motivo / CCTT" }
            ], model.dayRows)}
            ${reportSignatureFooterHTML()}
        </div>
    `;
}

function noAssignmentWorkbookHTML(model) {
    return `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    .report-title-strip { background: #0f172a; color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 10px; }
                    h4 { margin: 14px 0 0; padding: 6px 8px; color: #fff; background: #1d6cff; font-size: 13px; text-transform: uppercase; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #94a3b8; padding: 5px 7px; vertical-align: top; font-size: 11px; }
                    td { mso-number-format:"\\@"; }
                    .report-worker-data-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                    .report-worker-data-column { min-width: 0; }
                    .report-section--worker-data th:first-child,
                    .report-section--worker-data td:first-child { width: 1%; white-space: nowrap; padding-right: 22px; }
                    .report-row--inhabil td:first-child { background: #fee2e2; }
                    .report-signature-footer { width: 320px; margin: 72px 28px 0 auto; padding: 8px 0 0; border-top: 1px solid #1e2f4d; color: #1e2f4d; font-size: 11px; line-height: 1.3; text-align: center; }
                </style>
            </head>
            <body>${buildNoAssignmentReportHTML(model)}</body>
        </html>
    `;
}

function assignedShiftWorkbookHTML(model) {
    return `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    .report-title-strip { background: #0f172a; color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 10px; }
                    h4 { margin: 14px 0 0; padding: 6px 8px; color: #fff; background: #1d6cff; font-size: 13px; text-transform: uppercase; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #94a3b8; padding: 5px 7px; vertical-align: top; font-size: 11px; }
                    td { mso-number-format:"\\@"; }
                    .report-worker-data-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                    .report-worker-data-column { min-width: 0; }
                    .report-section--worker-data th:first-child,
                    .report-section--worker-data td:first-child { width: 1%; white-space: nowrap; padding-right: 22px; }
                    .report-row--inhabil td:first-child { background: #fee2e2; }
                    .report-signature-footer { width: 320px; margin: 72px 28px 0 auto; padding: 8px 0 0; border-top: 1px solid #1e2f4d; color: #1e2f4d; font-size: 11px; line-height: 1.3; text-align: center; }
                </style>
            </head>
            <body>${buildAssignedShiftReportHTML(model)}</body>
        </html>
    `;
}

function getCalculationRows(stats, profileName) {
    const valorHora = getValorHora(profileName);
    const returnTransferEnabled =
        Boolean(stats.returnTransferEnabled);
    const pagoDiurno = Number.isFinite(Number(stats.paymentDiurno))
        ? Number(stats.paymentDiurno)
        : stats.hheeDiurnas * 1.25 * valorHora;
    const pagoNocturno = Number.isFinite(Number(stats.paymentNocturno))
        ? Number(stats.paymentNocturno)
        : stats.hheeNocturnas * 1.5 * valorHora;
    const dayReturnHours =
        Math.max(0, Number(stats.hheeDiurnas) || 0) * 1.25;
    const nightReturnHours =
        Math.max(0, Number(stats.hheeNocturnas) || 0) * 1.5;
    const modeLabel = stats.mode === "diurno"
        ? "Personal Diurno"
        : stats.mode === "assigned"
            ? "Rotativa con asignaci\u00f3n de turno"
            : "Rotativa sin asignaci\u00f3n / c\u00e1lculo agregado";
    const formula = stats.mode === "aggregate"
        ? "Base mensual ajustada - horas diurnas trabajadas; el remanente se cruza contra horas nocturnas."
        : "Se compara cada turno real contra la rotativa base y solo se contabiliza la diferencia.";

    return [
        { item: "Modo de c\u00e1lculo", valor: modeLabel },
        { item: "Formula aplicada", valor: formula },
        { item: "Horas diurnas trabajadas", valor: `${formatHour(stats.totalD)}h` },
        { item: "Horas nocturnas trabajadas", valor: `${formatHour(stats.totalN)}h` },
        { item: "Base h\u00e1bil ajustada del mes", valor: `${formatHour(stats.horasHabiles)}h` },
        { item: "HHEE diurnas redondeadas", valor: `${stats.hheeDiurnas}h` },
        { item: "HHEE nocturnas redondeadas", valor: `${stats.hheeNocturnas}h` },
        {
            item: "Destino de HH.EE del mes",
            valor: stats.returnTransferEnabled
                ? `Devoluci\u00f3n de horas (${formatHour(stats.returnTransferHours)}h generadas)`
                : "Pago"
        },
        { item: "Valor hora actual", valor: `$${formatMoney(valorHora)}` },
        { item: "Regla de valor hora", valor: "Se usa el grado vigente en la fecha de cada hora extra cuando existe historial." },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n diurna"
                : "Pago diurno estimado",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(dayReturnHours)
                : `$${formatMoney(pagoDiurno)}`
        },
        {
            item: returnTransferEnabled
                ? "A devoluci\u00f3n nocturna"
                : "Pago nocturno estimado",
            valor: returnTransferEnabled
                ? formatReturnTransferValue(nightReturnHours)
                : `$${formatMoney(pagoNocturno)}`
        },
        { item: "Traspaso al mes siguiente", valor: `${formatHour(stats.carryOut?.d)}h diurnas / ${formatHour(stats.carryOut?.n)}h nocturnas` }
    ];
}

function buildWorkbookHTML({
    profile,
    monthDate,
    stats,
    dayRows,
    replacementRows,
    swapRows,
    contractRows
}) {
    const rotativa = getRotativa(profile.name);
    const title = `Reporte Horas Extras - ${profile.name} - ${monthLabel(monthDate)}`;
    const workspace = getActiveWorkspace();
    const workspaceUnit = workspace?.name || "Sin entorno activo";
    const profileRows = [
        { campo: "Nombre", valor: profile.name },
        { campo: "RUT", valor: profile.rut || "Sin registro" },
        { campo: "Unidad", valor: workspaceUnit },
        { campo: "Tipo de contrato", valor: profile.contractType || "Sin registro" },
        { campo: "Estamento", valor: profile.estamento || "Sin registro" },
        { campo: "Profesi\u00f3n", valor: profile.profession || "Sin informaci\u00f3n" },
        { campo: "Grado", valor: profile.grade || "Sin registro" },
        { campo: "Rotativa", valor: rotationLabel(rotativa.type) },
        { campo: "Asignaci\u00f3n de turno", valor: getShiftAssigned(profile.name) ? "S\u00ed" : "No" },
        { campo: "Mes reportado", valor: monthLabel(monthDate) }
    ];

    return `
        <!doctype html>
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
                    h1 { font-size: 22px; margin: 0 0 16px; }
                    h2 { font-size: 16px; margin: 22px 0 8px; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
                    th { background: #dbeafe; color: #0f172a; font-weight: 700; }
                    th, td { border: 1px solid #9ca3af; padding: 7px 9px; vertical-align: top; }
                    .note { color: #475569; margin-bottom: 14px; }
                    .report-signature-footer { width: 320px; margin: 72px 28px 0 auto; padding: 8px 0 0; border-top: 1px solid #1e2f4d; color: #1e2f4d; font-size: 11px; line-height: 1.3; text-align: center; }
                </style>
            </head>
            <body>
                <h1>${escapeHTML(title)}</h1>
                <div class="note">
                    Archivo generado desde ProTurnos. Las horas del resumen aplican la misma regla de c\u00e1lculo que la vista de Horas Extras.
                </div>
                ${table("Datos del trabajador", [
                    { key: "campo", label: "Campo" },
                    { key: "valor", label: "Valor" }
                ], profileRows)}
                ${contractRows.length ? table("Contratos del mes", [
                    { key: "inicio", label: "Inicio" },
                    { key: "termino", label: "T\u00e9rmino" },
                    { key: "reemplaza", label: "Reemplaza a" }
                ], contractRows) : ""}
                ${table("Detalle mensual", [
                    { key: "fecha", label: "Fecha" },
                    { key: "diaHabil", label: "D\u00eda h\u00e1bil" },
                    { key: "tipo", label: "Tipo" },
                    { key: "turnoBase", label: "Turno base" },
                    { key: "turnoConCambios", label: "Base con CCTT" },
                    { key: "turnoRealizado", label: "Turno realizado" },
                    { key: "turnoExtra", label: "Turno extra" },
                    { key: "horasDiurnas", label: "Horas diurnas" },
                    { key: "horasNocturnas", label: "Horas nocturnas" },
                    { key: "respaldo", label: "Reemplazo / motivo / CCTT" }
                ], dayRows)}
                ${table("Respaldos de horas extras", [
                    { key: "fecha", label: "Fecha" },
                    { key: "turno", label: "Turno" },
                    { key: "diurnas", label: "Horas diurnas" },
                    { key: "nocturnas", label: "Horas nocturnas" },
                    { key: "reemplaza", label: "Reemplaza a" },
                    { key: "motivo", label: "Motivo" }
                ], replacementRows)}
                ${table("Cambios de turno", [
                    { key: "estado", label: "Estado" },
                    { key: "entrega", label: "Entrega turno" },
                    { key: "recibe", label: "Recibe turno" },
                    { key: "fechaCambio", label: "Fecha cambio" },
                    { key: "turnoCambio", label: "Turno cambio" },
                    { key: "fechaDevolucion", label: "Fecha devoluci\u00f3n" },
                    { key: "turnoDevolucion", label: "Turno devoluci\u00f3n" }
                ], swapRows)}
                ${table("Detalle del c\u00e1lculo", [
                    { key: "item", label: "Item" },
                    { key: "valor", label: "Valor" }
                ], getCalculationRows(stats, profile.name))}
                ${reportSignatureFooterHTML()}
            </body>
        </html>
    `;
}

function downloadExcel(html, filename) {
    const blob = new Blob(["\ufeff", html], {
        type: "application/vnd.ms-excel;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export async function buildNoAssignmentReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isNoAssignmentShiftProfile(profile.name)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });

    return buildNoAssignmentReportHTML(model);
}

export async function buildReplacementReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isReplacementReportProfile(profile.name)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats,
        contractOnly: true
    });

    return buildNoAssignmentReportHTML(model);
}

export async function buildAssignedShiftReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isAssignedShiftReportProfile(profile.name)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildAssignedShiftReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });

    return buildAssignedShiftReportHTML(model);
}

export async function buildDiurnoReportPreviewHTML(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name || !isDiurnoReportProfile(profile.name)) {
        return "";
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = stats.mode === "aggregate"
        ? buildNoAssignmentReportModel({
            profile,
            monthDate,
            holidays,
            stats
        })
        : buildAssignedShiftReportModel({
            profile,
            monthDate,
            holidays,
            stats
        });

    return stats.mode === "aggregate"
        ? buildNoAssignmentReportHTML(model)
        : buildAssignedShiftReportHTML(model);
}

export async function exportNoAssignmentShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isNoAssignmentShiftProfile(profile.name)) {
        alert("Este reporte solo aplica para 3er o 4\u00b0 turno sin Asignaci\u00f3n de Turno.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });
    const filename = `Reporte_turno_sin_asignacion_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(noAssignmentWorkbookHTML(model), filename);
}

export async function exportReplacementShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isReplacementReportProfile(profile.name)) {
        alert("Este reporte solo aplica para trabajadores con contrato Reemplazo.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildNoAssignmentReportModel({
        profile,
        monthDate,
        holidays,
        stats,
        contractOnly: true
    });
    const filename = `Reporte_reemplazo_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(noAssignmentWorkbookHTML(model), filename);
}

export async function exportAssignedShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isAssignedShiftReportProfile(profile.name)) {
        alert("Este reporte solo aplica para 3er o 4\u00b0 turno con Asignaci\u00f3n de Turno.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = buildAssignedShiftReportModel({
        profile,
        monthDate,
        holidays,
        stats
    });
    const filename = `Reporte_turno_con_asignacion_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(assignedShiftWorkbookHTML(model), filename);
}

export async function exportDiurnoShiftReport(
    profile,
    monthDate = new Date()
) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para descargar el reporte.");
        return;
    }

    if (!isDiurnoReportProfile(profile.name)) {
        alert("Este reporte solo aplica para trabajadores con rotativa Diurno.");
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchReportHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const model = stats.mode === "aggregate"
        ? buildNoAssignmentReportModel({
            profile,
            monthDate,
            holidays,
            stats
        })
        : buildAssignedShiftReportModel({
            profile,
            monthDate,
            holidays,
            stats
        });
    const filename = `Reporte_diurno_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(
        stats.mode === "aggregate"
            ? noAssignmentWorkbookHTML(model)
            : assignedShiftWorkbookHTML(model),
        filename
    );
}

export async function exportHoursReport(profile, monthDate = new Date()) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para imprimir el reporte.");
        return;
    }

    if (isReplacementReportProfile(profile.name)) {
        await exportReplacementShiftReport(profile, monthDate);
        return;
    }

    if (isDiurnoReportProfile(profile.name)) {
        await exportDiurnoShiftReport(profile, monthDate);
        return;
    }

    if (isNoAssignmentShiftProfile(profile.name)) {
        await exportNoAssignmentShiftReport(profile, monthDate);
        return;
    }

    if (isAssignedShiftReportProfile(profile.name)) {
        await exportAssignedShiftReport(profile, monthDate);
        return;
    }

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchHolidays(year);
    const data = getProfileData(profile.name);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        data,
        {},
        { d: 0, n: 0 }
    );
    const kind = reportKind(profile.name);
    const dayRows = buildDayRows(
        profile,
        year,
        month,
        days,
        holidays,
        kind
    );
    const replacementRows = buildReplacementLogRows(
        profile.name,
        year,
        month,
        holidays
    );
    const swapRows = buildSwapRows(profile.name, year, month);
    const contractRows = kind === "replacement"
        ? buildContractRows(profile.name, year, month)
        : [];
    const html = buildWorkbookHTML({
        profile,
        monthDate,
        stats,
        dayRows,
        replacementRows,
        swapRows,
        contractRows
    });
    const filename = `HHEE_${safeFileName(profile.name)}_${year}-${String(month + 1).padStart(2, "0")}.xls`;

    downloadExcel(html, filename);
}
