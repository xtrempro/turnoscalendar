import {
    getBaseProfileData,
    getProfileData,
    getRotativa,
    getShiftAssigned,
    getValorHora
} from "./storage.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import {
    aplicarCambiosTurno,
    getTurnoBase
} from "./turnEngine.js";
import {
    getTurnoExtraAgregado
} from "./rulesEngine.js";
import {
    calcHours,
    isBusinessDay
} from "./calculations.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import {
    codeToTurno,
    getReplacementLogForWorkerMonth,
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
        const actual = aplicarCambiosTurno(
            profileName,
            keyDay,
            Number(data[keyDay]) || TURNO.LIBRE
        );
        const extraState =
            getTurnoExtraAgregado(baseWithSwaps, actual);
        const hasManualBase =
            Object.prototype.hasOwnProperty.call(baseData, keyDay);
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
            const hours = calcHours(date, turno, holidays) || { d: 0, n: 0 };

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

export async function exportHoursReport(profile, monthDate = new Date()) {
    if (!profile?.name) {
        alert("Selecciona un trabajador para imprimir el reporte.");
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
