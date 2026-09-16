import { normalizeText } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    getCompensationProfileAt,
    getProfileData,
    getProfiles,
    getShiftAssigned,
    isProfileActive
} from "./storage.js";
import {
    getContractsForProfile,
    getHonorariaContractsForProfile,
    isHonorariaContractType,
    isReplacementContractType,
    isReplacementProfile
} from "./contracts.js";
import { getJSON } from "./persistence.js";
import { currentDate } from "./calendar.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import { analizarMes } from "./staffing.js";
import { getAbsenceType } from "./rulesEngine.js";
import { measurePerformance } from "./performanceMonitor.js";
import { TURNO } from "./constants.js";
import { keyFromDate } from "./dateUtils.js";
import { getTurnoReal } from "./turnEngine.js";
import {
    buildTaskAssignmentContext,
    getDayTaskAssignments
} from "./taskAssignmentProjection.js";

const ROLE_DEFS = [
    {
        key: "profesional",
        label: "Profesional",
        color: "#1d6cff"
    },
    {
        key: "tecnico",
        label: "T\u00e9cnico",
        color: "#14b8a6"
    },
    {
        key: "auxiliar",
        label: "Auxiliar",
        color: "#f59e0b"
    },
    {
        key: "administrativo",
        label: "Administrativo",
        color: "#8b5cf6"
    }
];

const MONTH_SHORT = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic"
];

const DASHBOARD_MONTH_COUNT = 15;

const dashboardState = {
    licenseYears: 2,
    // Grafico de HH.EE por trabajador: profesion filtrada y mes visible. Se
    // calcula SOLO la profesion elegida; recorrer toda la unidad con
    // calcularHorasMesPerfil es lo que hizo desactivar otros graficos por lentos.
    overtimeProfession: "",
    overtimeYear: currentDate.getFullYear(),
    overtimeMonth: currentDate.getMonth(),
    serviceYear: currentDate.getFullYear(),
    serviceMonth: currentDate.getMonth(),
    serviceShiftMode: "both",
    serviceHiddenProfessions: new Set()
};

let renderRequest = 0;
const holidayCache = new Map();
const SERVICE_SHIFT_MODES = new Set(["both", "day", "night"]);
const SERVICE_ESTAMENTO_ORDER = [
    "Profesional",
    "T\u00e9cnico",
    "Administrativo",
    "Auxiliar"
];
const SERVICE_PROFESSION_PALETTE = [
    "#8a1f3d",
    "#2563eb",
    "#0f766e",
    "#7c3aed",
    "#d97706",
    "#0891b2",
    "#be123c",
    "#4d7c0f"
];

function roleKey(value) {
    const normalized = normalizeText(value)
        .replace(/[^a-z0-9]+/g, "");

    if (normalized.includes("profesional")) return "profesional";
    if (normalized.includes("cnico") || normalized.includes("tecnico")) {
        return "tecnico";
    }
    if (normalized.includes("auxiliar")) return "auxiliar";
    if (normalized.includes("administrativo")) return "administrativo";

    return "";
}

function roleLabel(key) {
    return ROLE_DEFS.find(role => role.key === key)?.label || key;
}

function formatMoney(value) {
    return new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 0
    }).format(Math.round(Number(value) || 0));
}

function monthLabel(year, month) {
    return `${MONTH_SHORT[month]} ${String(year).slice(-2)}`;
}

function monthRange(count = DASHBOARD_MONTH_COUNT) {
    const monthCount = Math.max(
        1,
        Number(count) || DASHBOARD_MONTH_COUNT
    );
    const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );
    const start = new Date(
        end.getFullYear(),
        end.getMonth() - monthCount + 1,
        1
    );
    const months = [];

    for (let index = 0; index < monthCount; index++) {
        const date = new Date(
            start.getFullYear(),
            start.getMonth() + index,
            1
        );

        months.push({
            year: date.getFullYear(),
            month: date.getMonth(),
            label: monthLabel(date.getFullYear(), date.getMonth())
        });
    }

    return months;
}

function yearRange(count = 5) {
    const year = currentDate.getFullYear();

    return Array.from({ length: count }, (_, index) => year - index);
}

async function holidaysForYear(year) {
    if (!holidayCache.has(year)) {
        holidayCache.set(year, await fetchHolidays(year));
    }

    return holidayCache.get(year);
}

function keyToDate(key) {
    const parts = String(key || "").split("-").map(Number);

    return new Date(parts[0], parts[1], parts[2]);
}

function profileMap(prefix, name) {
    return getJSON(`${prefix}_${name}`, {});
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function hm(hours, minutes = 0) {
    return `${pad2(hours)}:${pad2(minutes)}`;
}

function dashboardStandardSchedule(turno, date) {
    const friday = date.getDay() === 5;
    const diurnoEnd = friday ? 16 : 17;

    switch (Number(turno) || TURNO.LIBRE) {
        case TURNO.LARGA:
            return { day: "08:00 a 20:00", night: null };
        case TURNO.NOCHE:
            return { day: null, night: "20:00 a 08:00" };
        case TURNO.TURNO24:
            return { day: "08:00 a 20:00", night: "20:00 a 08:00" };
        case TURNO.DIURNO:
            return { day: `08:00 a ${hm(diurnoEnd)}`, night: null };
        case TURNO.DIURNO_NOCHE:
            return { day: `08:00 a ${hm(diurnoEnd)}`, night: "20:00 a 08:00" };
        case TURNO.MEDIA_MANANA:
            return { day: "08:00 a 14:00", night: null };
        case TURNO.MEDIA_TARDE:
            return { day: "14:00 a 20:00", night: null };
        case TURNO.TURNO18:
            return { day: "14:00 a 20:00", night: "20:00 a 08:00" };
        default:
            return { day: null, night: null };
    }
}

function dashboardHalfAdminSchedule(turno, half, date, assigned) {
    const friday = date.getDay() === 5;

    if (half === "0.5M") {
        if (assigned) return { day: "14:00 a 20:00", night: null };

        const entry = friday ? "12:00" : "12:30";
        const exit = Number(turno) === TURNO.LARGA
            ? "20:00"
            : (friday ? "16:00" : "17:00");

        return { day: `${entry} a ${exit}`, night: null };
    }

    if (half === "0.5T") {
        if (assigned) return { day: "08:00 a 14:00", night: null };
        return { day: "08:00 a 12:30", night: null };
    }

    return dashboardStandardSchedule(turno, date);
}

function dashboardServiceSchedule(profile, keyDay, date) {
    const name = profile?.name;

    if (!name) return null;
    if (profileMap("legal", name)[keyDay]) return null;
    if (profileMap("comp", name)[keyDay]) return null;
    if (profileMap("absences", name)[keyDay]) return null;

    const adminVal = profileMap("admin", name)[keyDay];
    const half = adminVal === "0.5M" || adminVal === "0.5T"
        ? adminVal
        : null;

    if (adminVal && !half) return null;

    const turno = Number(getTurnoReal(name, keyDay)) || TURNO.LIBRE;

    if (turno <= TURNO.LIBRE) return null;

    const schedule = half
        ? dashboardHalfAdminSchedule(
            turno,
            half,
            date,
            getShiftAssigned(name, date)
        )
        : dashboardStandardSchedule(turno, date);

    return schedule.day || schedule.night
        ? schedule
        : null;
}

function serviceProfessionLabel(profile) {
    const value = String(profile?.profession || profile?.estamento || "")
        .trim();

    return value || "Sin profesi\u00f3n";
}

function serviceProfessionColor(label, index = 0, estamentoKey = "") {
    const normalized = normalizeText(label);

    if (estamentoKey === "auxiliar") {
        return "#d97706";
    }

    if (estamentoKey === "administrativo") {
        return "#7c3aed";
    }

    if (
        normalized.includes("tm imagenologia") ||
        normalized.includes("tecnologo medico")
    ) {
        return "#8a1f3d";
    }

    if (normalized.includes("enfermeria")) {
        return "#2563eb";
    }

    if (normalized.includes("tecnico")) {
        return "#0f766e";
    }

    if (normalized.includes("administrativo")) {
        return "#7c3aed";
    }

    if (normalized.includes("auxiliar")) {
        return "#d97706";
    }

    return SERVICE_PROFESSION_PALETTE[
        Math.abs(index) % SERVICE_PROFESSION_PALETTE.length
    ];
}

function serviceEstamentoLabel(profile) {
    const key = roleKey(profile?.estamento);

    return key
        ? roleLabel(key)
        : (String(profile?.estamento || "").trim() || "Otros");
}

function serviceGroupForProfile(profile, index = 0) {
    const estamentoKey = roleKey(profile?.estamento);
    const estamento = serviceEstamentoLabel(profile);
    const label = estamentoKey === "auxiliar" ||
        estamentoKey === "administrativo"
        ? estamento
        : serviceProfessionLabel(profile);
    const id = [
        estamentoKey || normalizeText(estamento) || "otros",
        normalizeText(label) || "sin-informacion"
    ].join("|");

    return {
        id,
        label,
        estamento,
        estamentoKey,
        color: serviceProfessionColor(label, index, estamentoKey)
    };
}

function activeServiceProfessions() {
    const groups = new Map();

    getProfiles()
        .filter(isProfileActive)
        .forEach((profile, index) => {
            const group = serviceGroupForProfile(profile, index);

            if (!groups.has(group.id)) groups.set(group.id, group);
        });

    return [...groups.values()]
        .sort((a, b) =>
            serviceEstamentoRank(a.estamento) -
                serviceEstamentoRank(b.estamento) ||
            a.label.localeCompare(b.label, "es")
        )
        .map((group, index) => ({
            ...group,
            color: serviceProfessionColor(
                group.label,
                index,
                group.estamentoKey
            )
        }));
}

function cleanServiceProfessionFilters(professions) {
    const available = new Set(professions.map(item => item.id));

    for (const id of dashboardState.serviceHiddenProfessions) {
        if (!available.has(id)) {
            dashboardState.serviceHiddenProfessions.delete(id);
        }
    }
}

function selectedServiceProfessions(professions) {
    cleanServiceProfessionFilters(professions);

    return professions.filter(item =>
        !dashboardState.serviceHiddenProfessions.has(item.id)
    );
}

export function buildDailyServiceRows(
    year = dashboardState.serviceYear,
    month = dashboardState.serviceMonth
) {
    const daysCount = new Date(year, month + 1, 0).getDate();
    const professions = activeServiceProfessions();
    const rows = Array.from({ length: daysCount }, (_, index) => {
        const day = index + 1;
        const date = new Date(year, month, day);

        return {
            day,
            date,
            keyDay: keyFromDate(date),
            values: Object.fromEntries(
                professions.map(profession => [
                    profession.id,
                    { day: 0, night: 0 }
                ])
            )
        };
    });

    getProfiles()
        .filter(isProfileActive)
        .forEach((profile, index) => {
            const profession = serviceGroupForProfile(profile, index);

            rows.forEach(row => {
                const schedule = dashboardServiceSchedule(
                    profile,
                    row.keyDay,
                    row.date
                );

                if (!schedule) return;
                if (!row.values[profession.id]) {
                    row.values[profession.id] = { day: 0, night: 0 };
                }
                if (schedule.day) row.values[profession.id].day += 1;
                if (schedule.night) row.values[profession.id].night += 1;
            });
        });

    const max = rows.reduce((highest, row) => {
        const rowMax = Math.max(
            ...Object.values(row.values)
                .flatMap(value => [value.day, value.night])
        );

        return Math.max(highest, rowMax);
    }, 0);

    return { year, month, professions, rows, max };
}

function profilesForRoles(roleKeys) {
    return getProfiles()
        .filter(profile => roleKeys.has(roleKey(profile.estamento)))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function profileHheeCost(profile, year, month) {
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await holidaysForYear(year);
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        days,
        holidays,
        getProfileData(profile.name),
        {},
        { d: 0, n: 0 }
    );

    return (
        Math.max(0, Number(stats.paymentDiurno) || 0) +
        Math.max(0, Number(stats.paymentNocturno) || 0)
    );
}

async function buildHheeExpenseRows() {
    const rows = monthRange().map(month => ({
        ...month,
        values: Object.fromEntries(
            ROLE_DEFS.map(role => [role.key, 0])
        )
    }));
    const profiles = profilesForRoles(
        new Set(ROLE_DEFS.map(role => role.key))
    );

    for (const row of rows) {
        for (const profile of profiles) {
            const key = roleKey(profile.estamento);
            row.values[key] += await profileHheeCost(
                profile,
                row.year,
                row.month
            );
        }
    }

    return rows;
}

function parseISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (!match) return null;

    const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    );

    return Number.isNaN(date.getTime()) ? null : date;
}

function contractTypeKey(profile) {
    const normalized = normalizeText(profile.contractType)
        .replace(/[^a-z0-9]+/g, "");

    if (
        isReplacementContractType(profile.contractType) ||
        isReplacementProfile(profile.name)
    ) {
        return "reemplazo";
    }

    if (isHonorariaContractType(profile.contractType)) {
        return "honorarios";
    }

    if (normalized.includes("contrata")) return "contrata";
    if (normalized.includes("planta")) return "planta";

    return "";
}

function dateRangeOverlapsYear(
    startValue,
    endValue,
    year,
    { includeUndated = false } = {}
) {
    const start = parseISODate(startValue);
    const end = parseISODate(endValue);

    if (!start && !end) {
        return includeUndated;
    }

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    return (
        (!start || start.getTime() <= yearEnd.getTime()) &&
        (!end || end.getTime() >= yearStart.getTime())
    );
}

function profileOverlapsStaffingYear(profile, year, type) {
    const includeUndated = isProfileActive(profile);

    if (type === "reemplazo") {
        const contracts = getContractsForProfile(profile.name);

        if (contracts.length) {
            return contracts.some(contract =>
                dateRangeOverlapsYear(contract.start, contract.end, year)
            );
        }

        return dateRangeOverlapsYear(
            profile.contractStart,
            profile.contractEnd,
            year,
            { includeUndated }
        );
    }

    if (type === "honorarios") {
        const contracts = getHonorariaContractsForProfile(profile);

        if (contracts.length) {
            return contracts.some(contract =>
                dateRangeOverlapsYear(
                    contract.start,
                    contract.end,
                    year,
                    { includeUndated }
                )
            );
        }

        return dateRangeOverlapsYear(
            profile.honorariaStart ||
                profile.contractStart,
            profile.honorariaEnd || profile.contractEnd,
            year,
            { includeUndated }
        );
    }

    return dateRangeOverlapsYear(
        profile.contractStart,
        profile.contractEnd,
        year,
        { includeUndated }
    );
}

function buildStaffingHeadcountRows() {
    const years = yearRange(5).reverse();

    return years.map(year => {
        const values = Object.fromEntries(
            ROLE_DEFS.map(role => [role.key, 0])
        );
        const yearEnd = new Date(year, 11, 31);

        getProfiles().forEach(profile => {
            const type = contractTypeKey(profile);

            if (!type) return;

            const profileForYear =
                getCompensationProfileAt(profile.name, yearEnd) ||
                profile;
            const key = roleKey(profileForYear.estamento);

            if (
                !(key in values) ||
                !profileOverlapsStaffingYear(profile, year, type)
            ) {
                return;
            }

            values[key]++;
        });

        return {
            label: String(year),
            values
        };
    });
}

function countMissingStaffing(data) {
    return data.reduce((sum, day) => {
        return sum + (day.detalle || [])
            .filter(detail =>
                detail.tipo === "faltante" ||
                detail.tipo === "noche"
            )
            .reduce(
                (daySum, detail) =>
                    daySum + Math.max(0, Number(detail.cantidad) || 0),
                0
            );
    }, 0);
}

async function buildStaffingRows() {
    const months = monthRange();
    const values = [];

    for (const item of months) {
        const holidays = await holidaysForYear(item.year);

        values.push(
            countMissingStaffing(
                analizarMes(item.year, item.month, holidays)
            )
        );
    }

    return {
        labels: months.map(item => item.label),
        series: [
            {
                label: "Turnos sin cubrir",
                color: "#ef4444",
                values
            }
        ]
    };
}

function parseKeyDay(value) {
    const [year, month, day] = String(value || "")
        .split("-")
        .map(Number);

    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day)
    ) {
        return null;
    }

    return new Date(year, month, day);
}

function dateInRange(date, start, end) {
    return date &&
        date.getTime() >= start.getTime() &&
        date.getTime() <= end.getTime();
}

export function buildLicenseRanking() {
    const end = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
    );
    const start = new Date(
        end.getFullYear(),
        end.getMonth() - (dashboardState.licenseYears * 12) + 1,
        1
    );

    return getProfiles()
        // Los perfiles desactivados ya no son parte de la dotacion: seguir
        // rankeandolos empujaba fuera del top a gente que si esta trabajando.
        .filter(isProfileActive)
        .map(profile => {
            const days = Object.entries(
                getJSON(`absences_${profile.name}`, {})
            ).filter(([keyDay, absence]) => {
                const type = getAbsenceType(absence);

                return (
                    (
                        type === "license" ||
                        type === "professional_license"
                    ) &&
                    dateInRange(parseKeyDay(keyDay), start, end)
                );
            }).length;

            return {
                name: profile.name,
                role: roleLabel(roleKey(profile.estamento)),
                days
            };
        })
        .filter(item => item.days > 0)
        .sort((a, b) =>
            b.days - a.days ||
            a.name.localeCompare(b.name)
        )
        .slice(0, 15);
}

function chartEmpty(message) {
    return `
        <div class="dashboard-empty">
            ${escapeHTML(message)}
        </div>
    `;
}

function renderLicenseControls() {
    return `
        <aside class="dashboard-control-card">
            <strong>Periodo</strong>
            <div class="dashboard-radio-list">
                ${[1, 2, 3, 4, 5].map(years => `
                    <label>
                        <input type="radio" name="dashboardLicenseYears" value="${years}" ${dashboardState.licenseYears === years ? "checked" : ""}>
                        <span>${years === 1 ? "\u00daltimo a\u00f1o" : `\u00daltimos ${years} a\u00f1os`}</span>
                    </label>
                `).join("")}
            </div>
        </aside>
    `;
}

function renderLicenseRanking(rows) {
    const maxDays = Math.max(1, ...rows.map(row => row.days));

    if (!rows.length) {
        return chartEmpty("No hay licencias médicas registradas en el período.");
    }

    return `
        <div class="dashboard-ranking">
            ${rows.map((row, index) => {
                const width = (row.days / maxDays) * 100;

                return `
                    <article class="dashboard-ranking-row">
                        <div class="dashboard-ranking-person">
                            <b>${index + 1}</b>
                            <span>
                                <strong>${escapeHTML(row.name)}</strong>
                                <small>${escapeHTML(row.role)}</small>
                            </span>
                        </div>
                        <div class="dashboard-ranking-bar">
                            <span style="width:${width}%"></span>
                            <strong>${row.days} d\u00edas</strong>
                        </div>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

// ---- HH.EE por trabajador (filtrado por profesion, mes a mes) ----

function overtimeProfessions() {
    const seen = new Map();

    getProfiles()
        .filter(isProfileActive)
        .forEach(profile => {
            const label = String(profile.profession || "").trim();

            if (!label) return;

            const key = normalizeText(label);

            if (!seen.has(key)) seen.set(key, label);
        });

    return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
}

function activeOvertimeProfession() {
    const professions = overtimeProfessions();

    if (!professions.length) return "";

    const current = dashboardState.overtimeProfession;

    return professions.includes(current) ? current : professions[0];
}

// Nombre corto para el eje X: los nombres completos no caben. El nombre
// completo viaja en el tooltip de la barra.
function shortWorkerName(fullName) {
    const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);

    if (parts.length <= 2) return parts.join(" ");

    return `${parts[0]} ${parts[parts.length - 2]}`;
}

export async function buildOvertimeByWorkerRows(profession, year, month) {
    const target = normalizeText(profession);
    const profiles = getProfiles().filter(profile =>
        isProfileActive(profile) &&
        normalizeText(profile.profession || "") === target
    );

    if (!profiles.length) return [];

    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await holidaysForYear(year);

    return profiles
        .map(profile => {
            const stats = calcularHorasMesPerfil(
                profile.name,
                year,
                month,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );
            const day = Number(stats.hheeDiurnas) || 0;
            const night = Number(stats.hheeNocturnas) || 0;

            return {
                name: profile.name,
                shortName: shortWorkerName(profile.name),
                day,
                night,
                total: day + night
            };
        })
        .sort((a, b) =>
            b.total - a.total ||
            a.name.localeCompare(b.name, "es")
        );
}

function formatOvertimeHours(value) {
    const rounded = Math.round((Number(value) || 0) * 10) / 10;

    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(1).replace(".", ",");
}

function renderOvertimeControls(professions, profession) {
    const monthName = `${MONTH_SHORT[dashboardState.overtimeMonth]} ${dashboardState.overtimeYear}`;

    return `
        <aside class="dashboard-control-card">
            <strong>Profesión</strong>
            <select data-dashboard-overtime-profession>
                ${professions.map(item => `
                    <option value="${escapeHTML(item)}" ${item === profession ? "selected" : ""}>
                        ${escapeHTML(item)}
                    </option>
                `).join("")}
            </select>
            <strong>Mes</strong>
            <div class="dashboard-month-nav">
                <button type="button" data-dashboard-overtime-month="-1" aria-label="Mes anterior">&#8249;</button>
                <span>${escapeHTML(monthName)}</span>
                <button type="button" data-dashboard-overtime-month="1" aria-label="Mes siguiente">&#8250;</button>
            </div>
        </aside>
    `;
}

export function renderOvertimeByWorker(rows) {
    if (!rows.length) {
        return chartEmpty(
            "No hay trabajadores activos con esta profesión."
        );
    }

    const totals = rows.reduce((acc, row) => ({
        day: acc.day + row.day,
        night: acc.night + row.night
    }), { day: 0, night: 0 });

    if (!totals.day && !totals.night) {
        return chartEmpty("Sin horas extras registradas en este mes.");
    }

    // Escala del eje Y: se redondea hacia arriba para que la barra mas alta no
    // toque el techo y las guias caigan en numeros legibles.
    const maxTotal = Math.max(...rows.map(row => row.total), 1);
    const step = maxTotal <= 20 ? 5 : maxTotal <= 60 ? 10 : 20;
    const axisMax = Math.ceil(maxTotal / step) * step;
    const guides = [];

    for (let value = axisMax; value >= 0; value -= step) {
        guides.push(value);
    }

    return `
        <div class="dashboard-overtime">
            <div class="dashboard-overtime-legend">
                <span><i class="dashboard-overtime-swatch is-day"></i> HH.EE diurnas</span>
                <span><i class="dashboard-overtime-swatch is-night"></i> HH.EE nocturnas</span>
                <b>Total ${escapeHTML(formatOvertimeHours(totals.day + totals.night))} h</b>
            </div>
            <div class="dashboard-overtime-plot">
                <div class="dashboard-overtime-axis" aria-hidden="true">
                    ${guides.map(value => `<span>${value}</span>`).join("")}
                </div>
                <div class="dashboard-overtime-field">
                    <div class="dashboard-overtime-guides" aria-hidden="true">
                        ${guides.map((value, index) => `
                            <i style="top:${(index / (guides.length - 1)) * 100}%"></i>
                        `).join("")}
                    </div>
                    <div class="dashboard-overtime-bars">
                    ${rows.map(row => {
                        const height = (row.total / axisMax) * 100;
                        const dayShare = row.total
                            ? (row.day / row.total) * 100
                            : 0;
                        const nightShare = row.total
                            ? (row.night / row.total) * 100
                            : 0;
                        const title =
                            `${row.name}: ${formatOvertimeHours(row.total)} h totales ` +
                            `(${formatOvertimeHours(row.day)} diurnas / ${formatOvertimeHours(row.night)} nocturnas)`;

                        return `
                            <div class="dashboard-overtime-item" title="${escapeHTML(title)}">
                                <b class="dashboard-overtime-total">${escapeHTML(formatOvertimeHours(row.total))}</b>
                                <div class="dashboard-overtime-stack" style="height:${height}%">
                                    ${row.night ? `<span class="dashboard-overtime-night" style="height:${nightShare}%"></span>` : ""}
                                    ${row.day ? `<span class="dashboard-overtime-day" style="height:${dayShare}%"></span>` : ""}
                                </div>
                                <small>${escapeHTML(row.shortName)}</small>
                            </div>
                        `;
                    }).join("")}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function niceServiceAxisMax(value) {
    const max = Math.max(1, Number(value) || 0);
    const step = max <= 10 ? 2 : max <= 25 ? 5 : 10;

    return Math.ceil(max / step) * step;
}

function serviceLinePath(values, axisMax, xFor, yFor) {
    return values
        .map((value, index) => {
            const command = index === 0 ? "M" : "L";

            return `${command}${xFor(index).toFixed(2)} ${yFor(value, axisMax).toFixed(2)}`;
        })
        .join(" ");
}

function serviceSeriesForChart(data) {
    const mode = SERVICE_SHIFT_MODES.has(dashboardState.serviceShiftMode)
        ? dashboardState.serviceShiftMode
        : "both";
    const professions = selectedServiceProfessions(data.professions);
    const series = [];

    professions.forEach(profession => {
        if (mode !== "night") {
            series.push({
                profession: profession.id,
                estamento: profession.estamento,
                shift: "day",
                label: `${profession.label} \u00b7 d\u00eda`,
                color: profession.color,
                dashed: false,
                values: data.rows.map(row =>
                    row.values[profession.id]?.day || 0
                )
            });
        }

        if (mode !== "day") {
            series.push({
                profession: profession.id,
                estamento: profession.estamento,
                shift: "night",
                label: `${profession.label} \u00b7 noche`,
                color: profession.color,
                dashed: true,
                values: data.rows.map(row =>
                    row.values[profession.id]?.night || 0
                )
            });
        }
    });

    return series;
}

export function renderDailyServiceChart(data) {
    if (!data.professions.length) {
        return chartEmpty("No hay trabajadores activos para graficar.");
    }

    const visibleSeries = serviceSeriesForChart(data)
        .filter(series => series.values.some(Boolean));

    if (!visibleSeries.length) {
        return chartEmpty(
            "No hay dotaci\u00f3n en servicio para los filtros seleccionados."
        );
    }

    const width = Math.max(820, data.rows.length * 38 + 90);
    const height = 390;
    const pad = { top: 22, right: 28, bottom: 42, left: 42 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const axisMax = niceServiceAxisMax(
        Math.max(...visibleSeries.flatMap(series => series.values))
    );
    const xFor = index => pad.left + (
        data.rows.length <= 1
            ? plotWidth / 2
            : (index / (data.rows.length - 1)) * plotWidth
    );
    const yFor = (value, max) => pad.top + ((max - value) / max) * plotHeight;
    const gridValues = Array.from({ length: 5 }, (_, index) =>
        Math.round((axisMax / 4) * (4 - index))
    );
    return `
        <div class="dashboard-service">
            <div class="dashboard-service-summary">
                <span><i class="dashboard-service-line is-day"></i>D\u00eda</span>
                <span><i class="dashboard-service-line is-night"></i>Noche</span>
                <b>${escapeHTML(MONTH_SHORT[data.month])} ${data.year}</b>
            </div>
            <div class="dashboard-line-scroll">
                <svg class="dashboard-line-chart dashboard-service-chart"
                    viewBox="0 0 ${width} ${height}" role="img"
                    aria-label="Dotaci\u00f3n diaria por profesi\u00f3n">
                    ${gridValues.map(value => {
                        const y = yFor(value, axisMax);

                        return `
                            <line class="dashboard-line-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                            <text class="dashboard-line-axis" x="${pad.left - 9}" y="${y + 4}" text-anchor="end">${value}</text>
                        `;
                    }).join("")}
                    ${data.rows.map((row, index) => `
                        <text class="dashboard-line-label" x="${xFor(index)}" y="${height - 14}">
                            ${row.day}
                        </text>
                    `).join("")}
                    ${visibleSeries.map(series => `
                        <path class="dashboard-line-path"
                            d="${serviceLinePath(series.values, axisMax, xFor, yFor)}"
                            stroke="${series.color}"
                            ${series.dashed ? 'stroke-dasharray="8 7"' : ""}></path>
                    `).join("")}
                    ${visibleSeries.map(series => series.values.map((value, index) => `
                        <circle class="dashboard-line-dot"
                            cx="${xFor(index)}" cy="${yFor(value, axisMax)}" r="4"
                            fill="${series.color}">
                            <title>${escapeHTML(`${series.label}: ${value} el d\u00eda ${data.rows[index].day}`)}</title>
                        </circle>
                    `).join("")).join("")}
                    ${visibleSeries.map(series => series.values.map((value, index) => `
                        <circle class="dashboard-service-hit"
                            tabindex="0" role="button"
                            aria-label="Ver ${escapeHTML(series.label)} del d\u00eda ${data.rows[index].day}"
                            data-dashboard-service-day="${escapeHTML(data.rows[index].keyDay)}"
                            data-dashboard-service-estamento="${escapeHTML(series.estamento)}"
                            cx="${xFor(index)}" cy="${yFor(value, axisMax)}" r="12">
                            <title>${escapeHTML(`Ver ${series.estamento} en servicio el d\u00eda ${data.rows[index].day}`)}</title>
                        </circle>
                    `).join("")).join("")}
                </svg>
            </div>
            <div class="dashboard-chart-legend dashboard-service-legend">
                ${selectedServiceProfessions(data.professions).map(profession => `
                    <span><i style="background:${profession.color}"></i>${escapeHTML(profession.label)}</span>
                `).join("")}
            </div>
        </div>
    `;
}

function renderDailyServiceControls(data) {
    const monthName = `${MONTH_SHORT[dashboardState.serviceMonth]} ${dashboardState.serviceYear}`;

    return `
        <aside class="dashboard-control-card dashboard-service-controls">
            <strong>Mes</strong>
            <div class="dashboard-month-nav">
                <button type="button" data-dashboard-service-month="-1" aria-label="Mes anterior">&#8249;</button>
                <span>${escapeHTML(monthName)}</span>
                <button type="button" data-dashboard-service-month="1" aria-label="Mes siguiente">&#8250;</button>
            </div>
            <strong>Turno</strong>
            <div class="dashboard-radio-list">
                ${[
                    ["both", "D\u00eda y noche"],
                    ["day", "Solo d\u00eda"],
                    ["night", "Solo noche"]
                ].map(([value, label]) => `
                    <label>
                        <input type="radio" name="dashboardServiceShift" value="${value}" ${dashboardState.serviceShiftMode === value ? "checked" : ""}>
                        <span>${label}</span>
                    </label>
                `).join("")}
            </div>
            <strong>Profesiones</strong>
            <div class="dashboard-check-list dashboard-service-professions">
                ${data.professions.map(profession => `
                    <label style="--role-color:${profession.color}">
                        <input type="checkbox" data-dashboard-service-profession
                            value="${escapeHTML(profession.id)}"
                            ${dashboardState.serviceHiddenProfessions.has(profession.id) ? "" : "checked"}>
                        <span>${escapeHTML(profession.label)}</span>
                    </label>
                `).join("")}
            </div>
        </aside>
    `;
}

function serviceTimeMinutes(value) {
    const [hours, minutes] = String(value || "").split(":").map(Number);

    return Number.isFinite(hours)
        ? hours * 60 + (Number(minutes) || 0)
        : 0;
}

function compareServiceDetailRows(a, b) {
    const [entryA = "", exitA = ""] = String(a.time || "").split(" a ");
    const [entryB = "", exitB = ""] = String(b.time || "").split(" a ");

    return (
        serviceTimeMinutes(entryA) - serviceTimeMinutes(entryB) ||
        serviceTimeMinutes(exitB) - serviceTimeMinutes(exitA) ||
        a.name.localeCompare(b.name, "es")
    );
}

function serviceEstamentoRank(label) {
    const index = SERVICE_ESTAMENTO_ORDER.indexOf(label);

    return index === -1 ? SERVICE_ESTAMENTO_ORDER.length : index;
}

export function buildDailyServiceDetail(date = new Date()) {
    const keyDay = keyFromDate(date);
    const byEstamento = {};
    const taskContext = buildTaskAssignmentContext();

    getProfiles()
        .filter(isProfileActive)
        .forEach(profile => {
            const schedule = dashboardServiceSchedule(profile, keyDay, date);

            if (!schedule) return;

            const tasks = getDayTaskAssignments(
                profile.name,
                keyDay,
                taskContext
            );
            const tasksFor = shift => tasks
                .filter(item => item.shift === shift || item.shift === "both")
                .map(item => item.title);
            const estamento = String(profile.estamento || "Otros").trim() ||
                "Otros";

            if (!byEstamento[estamento]) {
                byEstamento[estamento] = { day: [], night: [] };
            }
            if (schedule.day) {
                byEstamento[estamento].day.push({
                    name: profile.name,
                    time: schedule.day,
                    tasks: tasksFor("day")
                });
            }
            if (schedule.night) {
                byEstamento[estamento].night.push({
                    name: profile.name,
                    time: schedule.night,
                    tasks: tasksFor("night")
                });
            }
        });

    const estamentos = Object.keys(byEstamento)
        .sort((a, b) =>
            serviceEstamentoRank(a) - serviceEstamentoRank(b) ||
            a.localeCompare(b, "es")
        );

    estamentos.forEach(estamento => {
        byEstamento[estamento].day.sort(compareServiceDetailRows);
        byEstamento[estamento].night.sort(compareServiceDetailRows);
    });

    return { keyDay, byEstamento, estamentos };
}

function serviceDetailCount(detail) {
    return new Set([
        ...detail.day.map(item => item.name),
        ...detail.night.map(item => item.name)
    ]).size;
}

function serviceDetailRowHTML(row) {
    const tasks = Array.isArray(row.tasks) ? row.tasks : [];
    const tasksHTML = tasks.length
        ? `<div class="hm-dot-tasks">${tasks
            .map(title => `<span class="hm-dot-task">${escapeHTML(title)}</span>`)
            .join("")}</div>`
        : "";

    return `
        <div class="hm-dot-row">
            <span class="hm-dot-name">${escapeHTML(row.name)}</span>
            <span class="hm-dot-time">${escapeHTML(row.time)}</span>
            ${tasksHTML}
        </div>
    `;
}

function serviceDetailColumnHTML(title, rows) {
    return `
        <div class="hm-dot-col">
            <div class="hm-dot-colhead"><span>${title}</span><b>${rows.length}</b></div>
            <div class="hm-dot-list">
                ${rows.length
                    ? rows.map(serviceDetailRowHTML).join("")
                    : `<div class="hm-dot-empty">Sin trabajadores.</div>`}
            </div>
        </div>
    `;
}

function serviceDetailDateLabel(date) {
    const days = [
        "Domingo",
        "Lunes",
        "Martes",
        "Mi\u00e9rcoles",
        "Jueves",
        "Viernes",
        "S\u00e1bado"
    ];
    const months = [
        "Enero",
        "Febrero",
        "Marzo",
        "Abril",
        "Mayo",
        "Junio",
        "Julio",
        "Agosto",
        "Septiembre",
        "Octubre",
        "Noviembre",
        "Diciembre"
    ];

    return `${days[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]}`;
}

const serviceDetailState = {
    date: new Date(),
    estamento: ""
};

function renderServiceDetailModal() {
    const backdrop = document.querySelector("[data-dashboard-service-modal]");

    if (!backdrop) return;

    const detail = buildDailyServiceDetail(serviceDetailState.date);
    const activeEstamento = detail.estamentos.includes(
        serviceDetailState.estamento
    )
        ? serviceDetailState.estamento
        : detail.estamentos[0] || "";
    const body = backdrop.querySelector("[data-dashboard-service-body]");
    const title = backdrop.querySelector("[data-dashboard-service-title]");
    const activeDetail = detail.byEstamento[activeEstamento];

    serviceDetailState.estamento = activeEstamento;
    title.textContent = activeEstamento
        ? `${activeEstamento} \u00b7 en servicio el ${serviceDetailDateLabel(serviceDetailState.date)}`
        : `Sin dotaci\u00f3n en servicio el ${serviceDetailDateLabel(serviceDetailState.date)}`;

    body.innerHTML = `
        ${detail.estamentos.length > 1
            ? `<div class="hm-dot-chips" role="tablist" aria-label="Estamento">
                ${detail.estamentos.map(estamento => {
                    const estDetail = detail.byEstamento[estamento];
                    const active = estamento === activeEstamento;

                    return `
                        <button type="button"
                            class="hm-dot-chip${active ? " is-active" : ""}"
                            data-dashboard-service-est="${escapeHTML(estamento)}"
                            role="tab"
                            aria-selected="${active ? "true" : "false"}">
                            ${escapeHTML(estamento)}<b>${serviceDetailCount(estDetail)}</b>
                        </button>
                    `;
                }).join("")}
            </div>`
            : ""}
        ${activeDetail
            ? `<div class="hm-dot-cols">
                ${serviceDetailColumnHTML("De d\u00eda", activeDetail.day)}
                ${serviceDetailColumnHTML("De noche", activeDetail.night)}
            </div>`
            : `<div class="hm-dot-empty">Sin trabajadores en servicio.</div>`}
    `;
}

function closeServiceDetailModal() {
    document
        .querySelector("[data-dashboard-service-modal]")
        ?.remove();
}

function bindServiceDetailModal(backdrop) {
    backdrop.addEventListener("click", event => {
        const target = event.target.closest(
            "[data-dashboard-service-close], [data-dashboard-service-est], [data-dashboard-service-detail-day]"
        );

        if (!target) {
            if (event.target === backdrop) closeServiceDetailModal();
            return;
        }

        if (target.dataset.dashboardServiceClose !== undefined) {
            closeServiceDetailModal();
            return;
        }

        if (target.dataset.dashboardServiceEst !== undefined) {
            serviceDetailState.estamento = target.dataset.dashboardServiceEst;
            renderServiceDetailModal();
            return;
        }

        const step = Number(target.dataset.dashboardServiceDetailDay) || 0;
        serviceDetailState.date = new Date(
            serviceDetailState.date.getFullYear(),
            serviceDetailState.date.getMonth(),
            serviceDetailState.date.getDate() + step
        );
        renderServiceDetailModal();
    });

    backdrop.addEventListener("keydown", event => {
        if (event.key === "Escape") closeServiceDetailModal();
    });
}

function openServiceDetailModal(keyDay, estamento = "") {
    const date = keyToDate(keyDay);

    if (Number.isNaN(date.getTime())) return;

    closeServiceDetailModal();
    serviceDetailState.date = date;
    serviceDetailState.estamento = String(estamento || "");

    document.body.insertAdjacentHTML("beforeend", `
        <div class="hm-modal-backdrop dashboard-service-modal-backdrop"
            data-dashboard-service-modal>
            <div class="hm-modal hm-modal--dotacion dashboard-service-modal"
                role="dialog" aria-modal="true" tabindex="-1"
                aria-label="Trabajadores en servicio">
                <div class="hm-modal-head">
                    <span class="hm-modal-ico" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                    </span>
                    <h3 data-dashboard-service-title>En servicio</h3>
                    <div class="hm-bday-nav">
                        <button type="button" data-dashboard-service-detail-day="-1" aria-label="D\u00eda anterior" title="D\u00eda anterior">&#8249;</button>
                        <button type="button" data-dashboard-service-detail-day="1" aria-label="D\u00eda siguiente" title="D\u00eda siguiente">&#8250;</button>
                    </div>
                    <button class="hm-modal-close" type="button"
                        data-dashboard-service-close aria-label="Cerrar">&times;</button>
                </div>
                <div class="hm-modal-body">
                    <div data-dashboard-service-body></div>
                </div>
            </div>
        </div>
    `);

    const backdrop = document.querySelector("[data-dashboard-service-modal]");
    const dialog = backdrop?.querySelector(".dashboard-service-modal");

    if (!backdrop || !dialog) return;

    bindServiceDetailModal(backdrop);
    renderServiceDetailModal();
    dialog.focus();
}

function loadingHTML() {
    return `
        <div class="dashboard-loading">
            Calculando dashboard...
        </div>
    `;
}

function dashboardShell(content = loadingHTML()) {
    return `
        <div class="dashboard-shell">
            ${content}
        </div>
    `;
}

function renderCard(title, subtitle, chart, controls = "") {
    const layoutClass = controls
        ? "dashboard-card-layout"
        : "dashboard-card-layout dashboard-card-layout--wide";

    return `
        <section class="dashboard-card">
            <div class="dashboard-card-head">
                <div>
                    <h3>${title}</h3>
                    ${subtitle ? `<p>${subtitle}</p>` : ""}
                </div>
            </div>
            <div class="${layoutClass}">
                <div class="dashboard-chart-area">
                    ${chart}
                </div>
                ${controls}
            </div>
        </section>
    `;
}

function bindDashboardControls(root) {
    root
        .querySelectorAll("[data-dashboard-service-month]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const step = Number(button.dataset.dashboardServiceMonth) || 0;
                const next = new Date(
                    dashboardState.serviceYear,
                    dashboardState.serviceMonth + step,
                    1
                );

                dashboardState.serviceYear = next.getFullYear();
                dashboardState.serviceMonth = next.getMonth();
                renderDashboardPanel();
            });
        });

    root
        .querySelectorAll("input[name='dashboardServiceShift']")
        .forEach(input => {
            input.addEventListener("change", event => {
                dashboardState.serviceShiftMode =
                    SERVICE_SHIFT_MODES.has(event.target.value)
                        ? event.target.value
                        : "both";
                renderDashboardPanel();
            });
        });

    root
        .querySelectorAll("[data-dashboard-service-profession]")
        .forEach(input => {
            input.addEventListener("change", event => {
                const label = event.target.value;

                if (event.target.checked) {
                    dashboardState.serviceHiddenProfessions.delete(label);
                } else {
                    dashboardState.serviceHiddenProfessions.add(label);
                }

                renderDashboardPanel();
            });
        });

    root
        .querySelectorAll("[data-dashboard-service-day]")
        .forEach(target => {
            const open = () =>
                openServiceDetailModal(
                    target.dataset.dashboardServiceDay,
                    target.dataset.dashboardServiceEstamento
                );

            target.addEventListener("click", open);
            target.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") return;

                event.preventDefault();
                open();
            });
        });

    root
        .querySelectorAll("input[name='dashboardLicenseYears']")
        .forEach(input => {
            input.addEventListener("change", event => {
                dashboardState.licenseYears =
                    Number(event.target.value) || 2;
                renderDashboardPanel();
            });
        });

    root
        .querySelector("[data-dashboard-overtime-profession]")
        ?.addEventListener("change", event => {
            dashboardState.overtimeProfession = event.target.value;
            renderDashboardPanel();
        });

    root
        .querySelectorAll("[data-dashboard-overtime-month]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const step = Number(button.dataset.dashboardOvertimeMonth) || 0;
                const next = new Date(
                    dashboardState.overtimeYear,
                    dashboardState.overtimeMonth + step,
                    1
                );

                dashboardState.overtimeYear = next.getFullYear();
                dashboardState.overtimeMonth = next.getMonth();
                renderDashboardPanel();
            });
        });
}

// NOTA: los graficos "Gasto en pago de horas extras", "Dotacion por estamento"
// y "Turnos sin cubrir" se desactivaron temporalmente porque su calculo
// (buildHheeExpenseRows / buildStaffingHeadcountRows / buildStaffingRows) es
// pesado y ralentizaba la carga del dashboard. Las funciones constructoras y de
// render se conservan intactas para volver a habilitarlos mas adelante con una
// estrategia que no penalice la carga (p. ej. carga diferida o cacheo).
export async function renderDashboardPanel() {
    const root = document.getElementById("dashboardPanel");
    if (!root) return;

    return measurePerformance(
        "dashboard:render-panel",
        async () => {
            const requestId = ++renderRequest;

            root.innerHTML = dashboardShell();

            const licenseRows = measurePerformance(
                "dashboard:build-license-ranking",
                () => buildLicenseRanking(),
                {
                    profileCount: getProfiles().length,
                    years: dashboardState.licenseYears
                }
            );

            if (requestId !== renderRequest) return;

            const professions = overtimeProfessions();
            const profession = activeOvertimeProfession();
            const serviceData = measurePerformance(
                "dashboard:build-daily-service",
                () => buildDailyServiceRows(
                    dashboardState.serviceYear,
                    dashboardState.serviceMonth
                ),
                {
                    year: dashboardState.serviceYear,
                    month: dashboardState.serviceMonth
                }
            );
            const overtimeRows = profession
                ? await measurePerformance(
                    "dashboard:build-overtime-by-worker",
                    () => buildOvertimeByWorkerRows(
                        profession,
                        dashboardState.overtimeYear,
                        dashboardState.overtimeMonth
                    ),
                    { profession }
                )
                : [];

            if (requestId !== renderRequest) return;

            root.innerHTML = dashboardShell(`
                ${renderCard(
                    "Dotaci\u00f3n diaria en servicio",
                    "Trabajadores por profesi\u00f3n durante el mes; l\u00ednea continua de d\u00eda y discontinua de noche.",
                    renderDailyServiceChart(serviceData),
                    renderDailyServiceControls(serviceData)
                )}
                ${professions.length
                    ? renderCard(
                        "Horas extras por trabajador",
                        `${escapeHTML(profession)} \u00b7 ${MONTH_SHORT[dashboardState.overtimeMonth]} ${dashboardState.overtimeYear}.`,
                        renderOvertimeByWorker(overtimeRows),
                        renderOvertimeControls(professions, profession)
                    )
                    : ""}
                ${renderCard(
                    "Licencias M\u00e9dicas",
                    // Sin subtitulo: el filtro de a\u00f1os que va al lado ya dice el
                    // periodo, y el "Top 15" es un detalle de implementacion.
                    "",
                    renderLicenseRanking(licenseRows),
                    renderLicenseControls()
                )}
            `);

            bindDashboardControls(root);
        },
        {
            years: dashboardState.licenseYears,
            profileCount: getProfiles().length
        }
    );
}
