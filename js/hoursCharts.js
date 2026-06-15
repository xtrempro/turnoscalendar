import { DOM } from "./dom.js";
import {
    getProfileData,
    getProfiles,
    isProfileActive
} from "./storage.js";
import { ESTAMENTO } from "./constants.js";
import { currentDate } from "./calendar.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";

let initialized = false;
let selectedRoleTouched = false;
let renderRequest = 0;
const holidayCache = new Map();

function pad(value) {
    return String(value).padStart(2, "0");
}

function monthValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function parseMonthValue(value) {
    const parts = String(value || "").split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;

    if (!year || month < 0) {
        return {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth()
        };
    }

    return { year, month };
}

function formatMonth(year, month) {
    return new Date(year, month, 1)
        .toLocaleString("es-CL", {
            month: "short",
            year: "2-digit"
        })
        .replace(".", "");
}

function formatHour(value) {
    const number = Math.round((Number(value) || 0) * 10) / 10;

    if (Number.isInteger(number)) {
        return String(number);
    }

    return String(number).replace(".", ",");
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function holidaysForYear(year) {
    if (!holidayCache.has(year)) {
        holidayCache.set(year, await fetchHolidays(year));
    }

    return holidayCache.get(year);
}

function getRoleProfiles(role) {
    return getProfiles()
        .filter(isProfileActive)
        .filter(profile => profile.estamento === role)
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function getProfileStats(profileName, year, month) {
    const days = new Date(year, month + 1, 0).getDate();
    const holidays = await holidaysForYear(year);

    return calcularHorasMesPerfil(
        profileName,
        year,
        month,
        days,
        holidays,
        getProfileData(profileName),
        {},
        { d: 0, n: 0 }
    );
}

async function buildMonthlyRows(role, year, month) {
    const profiles = getRoleProfiles(role);
    const rows = [];

    for (const profile of profiles) {
        const stats = await getProfileStats(
            profile.name,
            year,
            month
        );

        rows.push({
            name: profile.name,
            day: Number(stats.hheeDiurnas) || 0,
            night: Number(stats.hheeNocturnas) || 0
        });
    }

    return rows;
}

async function buildHistoryRows(role, year, month, years) {
    const months = Math.max(12, Number(years) * 12);
    const profiles = getRoleProfiles(role);
    const start = new Date(year, month - months + 1, 1);
    const rows = [];

    for (let index = 0; index < months; index++) {
        const date = new Date(
            start.getFullYear(),
            start.getMonth() + index,
            1
        );
        let day = 0;
        let night = 0;

        for (const profile of profiles) {
            const stats = await getProfileStats(
                profile.name,
                date.getFullYear(),
                date.getMonth()
            );

            day += Number(stats.hheeDiurnas) || 0;
            night += Number(stats.hheeNocturnas) || 0;
        }

        rows.push({
            label: formatMonth(
                date.getFullYear(),
                date.getMonth()
            ),
            day,
            night
        });
    }

    return rows;
}

async function buildProfileHistoryRows(profileName, year, month) {
    const months = 12;
    const start = new Date(year, month - months + 1, 1);
    const rows = [];

    for (let index = 0; index < months; index++) {
        const date = new Date(
            start.getFullYear(),
            start.getMonth() + index,
            1
        );
        const stats = await getProfileStats(
            profileName,
            date.getFullYear(),
            date.getMonth()
        );

        rows.push({
            label: formatMonth(
                date.getFullYear(),
                date.getMonth()
            ),
            day: Number(stats.hheeDiurnas) || 0,
            night: Number(stats.hheeNocturnas) || 0
        });
    }

    return rows;
}

function emptyChart(message) {
    return `
        <div class="empty-state empty-state--compact">
            ${message}
        </div>
    `;
}

function renderLegend() {
    return `
        <div class="hhee-chart-legend">
            <span><i class="hhee-color-day"></i> HHEE Diurnas</span>
            <span><i class="hhee-color-night"></i> HHEE Nocturnas</span>
        </div>
    `;
}

function getProfileChartTarget() {
    return DOM.hheeProfileHistoryChart || DOM.hheeHistoryChart;
}

function renderMonthlyChart(rows, role, year, month) {
    if (!DOM.hheeMonthlyChart) return;

    if (!rows.length) {
        DOM.hheeMonthlyChart.innerHTML =
            emptyChart(`No hay trabajadores activos en ${role}.`);
        return;
    }

    const max = Math.max(
        1,
        ...rows.map(row => row.day + row.night)
    );

    DOM.hheeMonthlyChart.innerHTML = `
        ${renderLegend()}
        <div class="hhee-chart-context">
            ${role} | ${formatMonth(year, month)}
        </div>
        <div class="hhee-worker-bars">
            ${rows.map(row => {
                const total = row.day + row.night;
                const dayWidth = total
                    ? (row.day / max) * 100
                    : 0;
                const nightWidth = total
                    ? (row.night / max) * 100
                    : 0;

                return `
                    <div class="hhee-worker-row">
                        <strong title="${row.name}">${row.name}</strong>
                        <div class="hhee-stacked-bar" title="${row.name}: ${formatHour(row.day)}h diurnas / ${formatHour(row.night)}h nocturnas">
                            <span class="hhee-bar-day" style="width:${dayWidth}%"></span>
                            <span class="hhee-bar-night" style="width:${nightWidth}%"></span>
                        </div>
                        <small>${formatHour(total)}h</small>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function renderHistoryChart(rows, role, years) {
    if (!DOM.hheeHistoryChart) return;

    if (!rows.length) {
        DOM.hheeHistoryChart.innerHTML =
            emptyChart(`No hay datos historicos para ${role}.`);
        return;
    }

    const max = Math.max(
        1,
        ...rows.map(row => row.day + row.night)
    );

    DOM.hheeHistoryChart.innerHTML = `
        ${renderLegend()}
        <div class="hhee-chart-context">
            ${role} | \u00daltimos ${years} a\u00f1o(s)
        </div>
        <div class="hhee-history-bars">
            ${rows.map(row => {
                const total = row.day + row.night;
                const height = Math.max(
                    total ? (total / max) * 100 : 0,
                    total ? 5 : 0
                );
                const dayPercent = total
                    ? (row.day / total) * 100
                    : 0;
                const nightPercent = total
                    ? (row.night / total) * 100
                    : 0;

                return `
                    <div class="hhee-history-item" title="${row.label}: ${formatHour(row.day)}h diurnas / ${formatHour(row.night)}h nocturnas">
                        <div class="hhee-history-stack" style="height:${height}%">
                            <span class="hhee-bar-night" style="height:${nightPercent}%"></span>
                            <span class="hhee-bar-day" style="height:${dayPercent}%"></span>
                        </div>
                        <small>${row.label}</small>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function renderProfileHistoryChart(rows, profileName, year, month) {
    const target = getProfileChartTarget();

    if (!target) return;

    if (!rows.length) {
        target.innerHTML =
            emptyChart("No hay datos historicos para este perfil.");
        return;
    }

    const max = Math.max(
        1,
        ...rows.map(row => row.day + row.night)
    );

    target.innerHTML = `
        ${renderLegend()}
        <div class="hhee-history-bars hhee-profile-history-bars">
            ${rows.map(row => {
                const total = row.day + row.night;
                const height = Math.max(
                    total ? (total / max) * 100 : 0,
                    total ? 5 : 0
                );
                const dayPercent = total
                    ? (row.day / total) * 100
                    : 0;
                const nightPercent = total
                    ? (row.night / total) * 100
                    : 0;

                return `
                    <div class="hhee-history-item" title="${row.label}: ${formatHour(row.day)}h diurnas / ${formatHour(row.night)}h nocturnas">
                        <div class="hhee-history-stack" style="height:${height}%">
                            <span class="hhee-bar-night" style="height:${nightPercent}%"></span>
                            <span class="hhee-bar-day" style="height:${dayPercent}%"></span>
                        </div>
                        <small>${row.label}</small>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function setLoadingState() {
    const profileTarget = getProfileChartTarget();

    if (profileTarget) {
        profileTarget.innerHTML =
            emptyChart("Calculando ultimos 12 meses...");
    }

    if (DOM.hheeMonthlyChart) {
        DOM.hheeMonthlyChart.innerHTML =
            emptyChart("Calculando comparacion mensual...");
    }

    if (
        DOM.hheeHistoryChart &&
        DOM.hheeHistoryChart !== profileTarget
    ) {
        DOM.hheeHistoryChart.innerHTML =
            emptyChart("Calculando historico...");
    }
}

export async function renderHoursCharts(currentProfile = null) {
    const target = getProfileChartTarget();

    if (!target) {
        return;
    }

    if (DOM.hheeChartMonth && !DOM.hheeChartMonth.value) {
        DOM.hheeChartMonth.value = monthValue(currentDate);
    }

    if (!currentProfile?.name) {
        target.innerHTML =
            emptyChart("Selecciona un colaborador para ver su historico de HH.EE.");
        return;
    }

    const requestId = ++renderRequest;
    const { year, month } =
        parseMonthValue(DOM.hheeChartMonth?.value || monthValue(currentDate));

    setLoadingState();

    const rows = await buildProfileHistoryRows(
        currentProfile.name,
        year,
        month
    );

    if (requestId !== renderRequest) return;

    renderProfileHistoryChart(
        rows,
        currentProfile.name,
        year,
        month
    );
}

export function initHoursCharts(getCurrentProfileData) {
    if (initialized) return;

    initialized = true;

    if (DOM.hheeChartMonth && !DOM.hheeChartMonth.value) {
        DOM.hheeChartMonth.value = monthValue(currentDate);
    }

    if (DOM.hheeChartRole) {
        DOM.hheeChartRole.onchange = () => {
            selectedRoleTouched = true;
            renderHoursCharts(getCurrentProfileData?.());
        };
    }

    if (DOM.hheeChartMonth) {
        DOM.hheeChartMonth.onchange = () => {
            if (
                typeof window.setHoursMonthFromValue === "function"
            ) {
                window.setHoursMonthFromValue(
                    DOM.hheeChartMonth.value
                );
                return;
            }

            renderHoursCharts(getCurrentProfileData?.());
        };
    }

    if (DOM.hheeHistoryYears) {
        DOM.hheeHistoryYears.onchange = () =>
            renderHoursCharts(getCurrentProfileData?.());
    }
}
