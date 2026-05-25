import {
    getBaseProfileData,
    getManualLeaveBalances,
    getProfileData,
    getRotativa,
    getShiftAssigned,
    getValorHora
} from "./storage.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
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
    cambiosDelMes
} from "./swaps.js";
import {
    formatContractDate,
    getContractsForProfile
} from "./contracts.js";
import { getActiveWorkspace } from "./workspaces.js";
import { getJSON } from "./persistence.js";
import { getClockMarks } from "./clockMarks.js";

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

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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
    if (type === "reemplazo") return "Reemplazo";

    return "Sin rotativa";
}

function reportKind(profileName) {
    const type = getRotativa(profileName).type;

    if (type === "reemplazo") return "replacement";
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

        if (!swap.skipFecha && swap.fecha === iso) {
            if (swap.from === profileName) {
                details.push(`Entrega ${swap.turno || ""} a ${swap.to}`);
            }

            if (swap.to === profileName) {
                details.push(`Recibe ${swap.turno || ""} de ${swap.from}`);
            }
        }

        if (!swap.skipDevolucion && swap.devolucion === iso) {
            if (swap.to === profileName) {
                details.push(`Devuelve ${swap.turnoDevuelto || ""} a ${swap.from}`);
            }

            if (swap.from === profileName) {
                details.push(`Recibe devolucion ${swap.turnoDevuelto || ""} de ${swap.to}`);
            }
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
    if (type === "unpaid_leave") return "Permiso sin goce";
    if (type === "unjustified_absence") return "Ausencia injustificada";
    if (type === "license") return "Licencia Medica";

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
            label: "1/2 ADM Manana",
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

function buildNoAssignmentDayRows(profile, year, month, days, holidays) {
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

        addNumericHours(rawTotals, hours);

        rows.push({
            fecha: formatDate(iso),
            diaHabil: isBusinessDay(date, holidays) ? "Si" : "No",
            tipo: hasManualBase
                ? "Turno base"
                : "Turno registrado",
            turnoBase: turnoLabel(rawBase),
            turnoConCambios: turnoLabel(baseWithSwaps),
            turnoRealizado: absence?.label || turnoLabel(actual),
            turnoExtra: turnoLabel(
                getTurnoExtraAgregado(baseWithSwaps, actual)
            ),
            horasDiurnas: formatHour(hours.d),
            horasNocturnas: formatHour(hours.n),
            respaldo: details
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
            diaHabil: isBusinessDay(date, holidays) ? "Si" : "No",
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
                    ? "Sin respaldo registrado"
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
        .map(swap => ({
            estado: cambioEstaAnulado(swap) ? "Anulado" : "Activo",
            entrega: swap.from,
            recibe: swap.to,
            fechaCambio: formatDate(swap.fecha),
            turnoCambio: swap.turno || "",
            fechaDevolucion: formatDate(swap.devolucion),
            turnoDevolucion: swap.turnoDevuelto || ""
        }));
}

function buildContractRows(profileName, year, month) {
    return activeContractsForMonth(profileName, year, month)
        .map(contract => ({
            inicio: formatContractDate(contract.start),
            termino: formatContractDate(contract.end),
            reemplaza: contract.replaces
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
        comp: finiteBalance(manual.comp)
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

function permissionRowsAndAdjustments(profileName, year, month, days, holidays) {
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
    stats
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
        holidays
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
        carryIn,
        carryOut,
        totalD,
        totalN,
        totalWorked: totalD + totalN,
        adjustments: permissions.adjustments,
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
                    <td>${escapeHTML(row[column.key] ?? "")}</td>
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
                    <td>${escapeHTML(row[column.key] ?? "")}</td>
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
            item: "Dias habiles con contrato",
            signo: "(+)",
            horas: formatHour(adj.businessHours)
        }
    ];

    [
        ["adminFullDays", "adminFullHours", "P. Administrativos"],
        ["legalDays", "legalHours", "F. Legal"],
        ["compDays", "compHours", "F. Compensatorios"],
        ["halfAdminCount", "halfAdminHours", "1/2 ADM manana/tarde"],
        ["medicalBusinessDays", "medicalHours", "Licencias medicas en dias habiles"],
        ["otherApprovedDays", "otherApprovedHours", "Otros permisos aprobados"]
    ].forEach(([countKey, hoursKey, label]) => {
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
        item: `Total Horas habiles de ${model.monthName}`,
        signo: "(=)",
        horas: formatHour(model.stats.horasHabiles)
    });

    return rows;
}

function noAssignmentExtraRows(model) {
    return [
        {
            item: `Horas habiles ${model.monthName}`,
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
            item: "Pago diurno estimado",
            valor: `$${formatMoney(model.stats.paymentDiurno)}`,
            item2: "Pago nocturno estimado",
            valor2: `$${formatMoney(model.stats.paymentNocturno)}`
        }
    ];
}

function noAssignmentProfileRows(model) {
    const workspace = getActiveWorkspace();
    const rotativa = getRotativa(model.profile.name);

    return [
        { campo: "Nombre", valor: model.profile.name },
        { campo: "RUT", valor: model.profile.rut || "Sin registro" },
        { campo: "Unidad", valor: workspace?.name || "Sin entorno activo" },
        { campo: "Contrato", valor: model.profile.contractType || "Sin registro" },
        { campo: "Grado", valor: model.profile.grade || "Sin registro" },
        { campo: "Asignacion de Turno", valor: getShiftAssigned(model.profile.name) ? "SI" : "NO" },
        { campo: "Estamento", valor: model.profile.estamento || "Sin registro" },
        { campo: "Rotativa", valor: rotationLabel(rotativa.type) },
        { campo: "Profesion", valor: model.profile.profession || "Sin informacion" },
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
                { key: "termino", label: "Fecha Termino" },
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
                { key: "fechaDevolucion", label: "Fecha devolucion" },
                { key: "turnoDevolucion", label: "Turno devolucion" }
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
                </style>
            </head>
            <body>${buildNoAssignmentReportHTML(model)}</body>
        </html>
    `;
}

function getCalculationRows(stats, profileName) {
    const valorHora = getValorHora(profileName);
    const pagoDiurno = Number.isFinite(Number(stats.paymentDiurno))
        ? Number(stats.paymentDiurno)
        : stats.hheeDiurnas * 1.25 * valorHora;
    const pagoNocturno = Number.isFinite(Number(stats.paymentNocturno))
        ? Number(stats.paymentNocturno)
        : stats.hheeNocturnas * 1.5 * valorHora;
    const modeLabel = stats.mode === "diurno"
        ? "Personal Diurno"
        : stats.mode === "assigned"
            ? "Rotativa con asignacion de turno"
            : "Rotativa sin asignacion / calculo agregado";
    const formula = stats.mode === "aggregate"
        ? "Base mensual ajustada - horas diurnas trabajadas; el remanente se cruza contra horas nocturnas."
        : "Se compara cada turno real contra la rotativa base y solo se contabiliza la diferencia.";

    return [
        { item: "Modo de calculo", valor: modeLabel },
        { item: "Formula aplicada", valor: formula },
        { item: "Horas diurnas trabajadas", valor: `${formatHour(stats.totalD)}h` },
        { item: "Horas nocturnas trabajadas", valor: `${formatHour(stats.totalN)}h` },
        { item: "Base habil ajustada del mes", valor: `${formatHour(stats.horasHabiles)}h` },
        { item: "HHEE diurnas redondeadas", valor: `${stats.hheeDiurnas}h` },
        { item: "HHEE nocturnas redondeadas", valor: `${stats.hheeNocturnas}h` },
        {
            item: "Destino de HH.EE del mes",
            valor: stats.returnTransferEnabled
                ? `Devolucion de horas (${formatHour(stats.returnTransferHours)}h generadas)`
                : "Pago"
        },
        { item: "Valor hora actual", valor: `$${formatMoney(valorHora)}` },
        { item: "Regla de valor hora", valor: "Se usa el grado vigente en la fecha de cada hora extra cuando existe historial." },
        { item: "Pago diurno estimado", valor: `$${formatMoney(pagoDiurno)}` },
        { item: "Pago nocturno estimado", valor: `$${formatMoney(pagoNocturno)}` },
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
        { campo: "Profesion", valor: profile.profession || "Sin informacion" },
        { campo: "Grado", valor: profile.grade || "Sin registro" },
        { campo: "Rotativa", valor: rotationLabel(rotativa.type) },
        { campo: "Asignacion de turno", valor: getShiftAssigned(profile.name) ? "Si" : "No" },
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
                </style>
            </head>
            <body>
                <h1>${escapeHTML(title)}</h1>
                <div class="note">
                    Archivo generado desde ProTurnos. Las horas del resumen aplican la misma regla de calculo que la vista de Horas Extras.
                </div>
                ${table("Datos del trabajador", [
                    { key: "campo", label: "Campo" },
                    { key: "valor", label: "Valor" }
                ], profileRows)}
                ${contractRows.length ? table("Contratos del mes", [
                    { key: "inicio", label: "Inicio" },
                    { key: "termino", label: "Termino" },
                    { key: "reemplaza", label: "Reemplaza a" }
                ], contractRows) : ""}
                ${table("Detalle mensual", [
                    { key: "fecha", label: "Fecha" },
                    { key: "diaHabil", label: "Dia habil" },
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
                    { key: "fechaDevolucion", label: "Fecha devolucion" },
                    { key: "turnoDevolucion", label: "Turno devolucion" }
                ], swapRows)}
                ${table("Detalle del calculo", [
                    { key: "item", label: "Item" },
                    { key: "valor", label: "Valor" }
                ], getCalculationRows(stats, profile.name))}
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

export async function exportHoursReport(profile, monthDate = new Date()) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para imprimir el reporte.");
        return;
    }

    if (isNoAssignmentShiftProfile(profile.name)) {
        await exportNoAssignmentShiftReport(profile, monthDate);
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
