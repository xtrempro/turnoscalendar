import { normalizeText } from "./stringUtils.js";
import {
    getProfiles,
    getCurrentProfile,
    getShiftAssigned
} from "./storage.js";

import * as calendar from "./calendar.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado,
    getTurnoReal
} from "./turnEngine.js";
import { TURNO, TURNO_COLOR } from "./constants.js";
import { getTurnoColor } from "./turnoColors.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import { isBusinessDay } from "./calculations.js";
import { getJSON } from "./persistence.js";
import {
    esAusenciaInjustificada,
    getAbsenceType,
    getTurnoExtraAgregado,
    requiereReemplazoTurnoBase,
    restarTurnoCubierto
} from "./rulesEngine.js";
import { getLeaveApplicationInfo } from "./auditLog.js";
import {
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift
} from "./replacements.js";
import {
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    getHonorariaExcessForKey,
    getHonorariaLimitMessage,
    getHonorariaMonthlySummary
} from "./honoraria.js";
import {
    hasClockExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";
import {
    getHourReturn,
    hourReturnTimelineMarker
} from "./hourReturns.js";
import { getBlockedDayForProfile } from "./workerAvailability.js";

const timelineFilterState = {
    anchorProfile: "",
    selectedKeys: new Set(),
    open: false
};
let timelineOutsideClickController = null;
let timelineRenderRequest = 0;

function yieldTimelineRender() {
    return new Promise(resolve => {
        setTimeout(resolve, 0);
    });
}

function timelineRenderIsCurrent(requestId, year, month) {
    return (
        requestId === timelineRenderRequest &&
        calendar.currentDate.getFullYear() === year &&
        calendar.currentDate.getMonth() === month &&
        ["turnos", "timeline"].includes(
            document.body.dataset.activeView
        )
    );
}

export function cancelTimelineRender() {
    timelineRenderRequest++;
}

function getData(nombre){
    return getJSON("data_" + nombre, {});
}

function getAdmin(nombre){
    return getJSON("admin_" + nombre, {});
}

function getLegal(nombre){
    return getJSON("legal_" + nombre, {});
}

function getComp(nombre){
    return getJSON("comp_" + nombre, {});
}

function getAbs(nombre){
    return getJSON("absences_" + nombre, {});
}

function getBlocked(nombre){
    return getJSON("blocked_" + nombre, {});
}

function getCarry(nombre, y, m){
    return getJSON(
        `carry_${nombre}_${y}_${m}`,
        { d: 0, n: 0 }
    );
}

function formatTimelineHours(value){
    const rounded =
        Math.round((Number(value) || 0) * 2) / 2;

    if (!rounded) return "";

    return String(rounded).replace(".", ",");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function stopTimelineOutsideClickListener() {
    if (!timelineOutsideClickController) return;

    timelineOutsideClickController.abort();
    timelineOutsideClickController = null;
}

function setTimelineFilterOpen(container, open) {
    timelineFilterState.open = Boolean(open);
    container
        .querySelector(".timeline-filter")
        ?.classList.toggle("is-open", timelineFilterState.open);

    if (timelineFilterState.open) {
        bindTimelineOutsideClickListener(container);
    } else {
        stopTimelineOutsideClickListener();
    }
}

function bindTimelineOutsideClickListener(container) {
    stopTimelineOutsideClickListener();

    if (!timelineFilterState.open) return;

    timelineOutsideClickController = new AbortController();
    const { signal } = timelineOutsideClickController;

    document.addEventListener(
        "click",
        event => {
            const filter = container.querySelector(".timeline-filter");

            if (filter?.contains(event.target)) return;

            setTimelineFilterOpen(container, false);
        },
        { signal }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (event.key !== "Escape") return;

            setTimelineFilterOpen(container, false);
        },
        { signal }
    );
}

function normalizeTextKey(value) {
    return normalizeText(value);
}

function displayProfession(value) {
    const clean = String(value || "Sin informacion").trim();

    return normalizeTextKey(clean) === "sin informacion"
        ? "Sin informacion"
        : clean;
}

function profileUsesProfessionGroup(profile = {}) {
    return (
        profile.estamento === "Profesional" ||
        profile.estamento === "T\u00e9cnico"
    );
}

function timelineGroupForProfile(profile = {}) {
    if (profileUsesProfessionGroup(profile)) {
        const profession = displayProfession(profile.profession);
        const isUnspecified =
            normalizeTextKey(profession) === "sin informacion";
        const key = isUnspecified
            ? `profession:${profile.estamento}:${normalizeTextKey(profession)}`
            : `profession:${normalizeTextKey(profession)}`;

        return {
            key,
            label: isUnspecified
                ? `${profile.estamento || "Sin estamento"} | ${profession}`
                : profession,
            type: "profession"
        };
    }

    const estamento = profile.estamento || "Sin estamento";

    return {
        key: `estamento:${normalizeTextKey(estamento)}`,
        label: estamento,
        type: "estamento"
    };
}

function timelineFilterGroups(profiles = []) {
    const groups = new Map();

    profiles.forEach(profile => {
        const group = timelineGroupForProfile(profile);
        const existing = groups.get(group.key);

        groups.set(group.key, {
            ...group,
            count: (existing?.count || 0) + 1
        });
    });

    return Array.from(groups.values())
        .sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "profession" ? -1 : 1;
            }

            return a.label.localeCompare(b.label);
        });
}

function ensureTimelineFilter(perfilActual, groups) {
    const baseGroup = timelineGroupForProfile(perfilActual);
    const availableKeys = new Set(
        groups.map(group => group.key)
    );

    if (timelineFilterState.anchorProfile !== perfilActual.name) {
        timelineFilterState.anchorProfile = perfilActual.name;
        timelineFilterState.selectedKeys = new Set([baseGroup.key]);
        timelineFilterState.open = false;
    }

    const selectedKeys = new Set(
        Array.from(timelineFilterState.selectedKeys)
            .filter(key => availableKeys.has(key))
    );

    selectedKeys.add(baseGroup.key);
    timelineFilterState.selectedKeys = selectedKeys;

    return {
        baseGroup,
        selectedKeys
    };
}

function timelineFilterHTML(groups, selectedKeys, lockedKey) {
    const selectedLabels = groups
        .filter(group => selectedKeys.has(group.key))
        .map(group => group.label);
    const label = selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} grupos`;

    return `
        <div class="timeline-filter ${timelineFilterState.open ? "is-open" : ""}">
            <button class="timeline-filter__trigger" type="button" data-timeline-filter-toggle>
                <span>${escapeHtml(label)}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
            <div class="timeline-filter__menu">
                ${groups.map(group => {
                    const locked = group.key === lockedKey;

                    return `
                        <label class="timeline-filter__option ${locked ? "is-locked" : ""}">
                            <input
                                type="checkbox"
                                data-timeline-filter-key="${escapeHtml(group.key)}"
                                ${selectedKeys.has(group.key) ? "checked" : ""}
                                ${locked ? "disabled" : ""}
                            >
                            <span>${escapeHtml(group.label)}</span>
                            <small>${group.count}</small>
                        </label>
                    `;
                }).join("")}
            </div>
        </div>
    `;
}

function dayExtraAlertClass(nombre, value) {
    if (!getShiftAssigned(nombre)) {
        return "";
    }

    const hours = Number(value) || 0;

    if (hours >= 40) {
        return " hhee-alert-danger";
    }

    if (hours > 30 && hours < 40) {
        return " hhee-alert-warning";
    }

    return "";
}

function syncTimelineStickyOffsets(container) {
    const shell = container.querySelector(".timeline-shell");
    const headerCells = container.querySelectorAll(
        ".timeline-table thead th"
    );

    if (!shell || headerCells.length < 3) return;

    const nameWidth = Math.ceil(
        headerCells[0].getBoundingClientRect().width
    );
    const dayWidth = Math.ceil(
        headerCells[1].getBoundingClientRect().width
    );

    shell.style.setProperty(
        "--timeline-hhee-day-left",
        `${nameWidth}px`
    );
    shell.style.setProperty(
        "--timeline-hhee-night-left",
        `${nameWidth + dayWidth}px`
    );
}

function getColor(nombre, key, maps = null, isExtra = false){
    const admin = maps?.admin || getAdmin(nombre);
    const legal = maps?.legal || getLegal(nombre);
    const comp = maps?.comp || getComp(nombre);
    const abs = maps?.absences || getAbs(nombre);
    const absenceType = getAbsenceType(abs[key]);

    if (absenceType === "professional_license") return "#2563eb";
    if (absenceType === "union_leave") return "#e64747";
    if (absenceType === "unpaid_leave") return "#6b7280";
    if (abs[key]) return "#ef4444";
    if (legal[key]) return "#0ea5a6";
    if (comp[key]) return "#f97316";

    if (admin[key] === 1) return "#f59e0b";
    if (admin[key] === "0.5M") return "#fbbf24";
    if (admin[key] === "0.5T") return "#facc15";

    const turno = getTurnoReal(nombre, key);

    return getTurnoColor(turno, isExtra) || TURNO_COLOR[turno] || TURNO_COLOR[0];
}

function leaveTypeForDay(keyDay, maps) {
    const admin = maps?.admin || {};
    const legal = maps?.legal || {};
    const comp = maps?.comp || {};
    const absences = maps?.absences || {};

    if (admin[keyDay] === 1) return "admin";
    if (admin[keyDay] === "0.5M") return "half_admin_morning";
    if (admin[keyDay] === "0.5T") return "half_admin_afternoon";
    if (admin[keyDay] === 0.5) return "half_admin";
    if (legal[keyDay]) return "legal";
    if (comp[keyDay]) return "comp";

    const absence = absences[keyDay];

    if (!absence) return "";

    return esAusenciaInjustificada(absence)
        ? "unjustified_absence"
        : getAbsenceType(absence);
}

function leaveLabelForType(type) {
    if (type === "admin") return "P. Administrativo";
    if (type === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (type === "half_admin_afternoon") return "1/2 ADM Tarde";
    if (type === "half_admin") return "1/2 ADM";
    if (type === "legal") return "F. Legal";
    if (type === "comp") return "F. Compensatorio";
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "unjustified_absence") return "Ausencia Injustificada";
    if (type === "license") return "Licencia Medica";

    return "Permiso/Ausencia";
}

function leaveSourceMapForType(type, maps) {
    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon" ||
        type === "half_admin"
    ) {
        return maps?.admin || {};
    }

    if (type === "legal") return maps?.legal || {};
    if (type === "comp") return maps?.comp || {};

    return maps?.absences || {};
}

function leaveApplicationHoverTitle(profileName, keyDay, maps) {
    const type = leaveTypeForDay(keyDay, maps);

    if (!type) return "";

    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile: profileName,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(type, maps)
        });

    return [
        leaveLabelForType(type),
        `Aplicado: ${info?.createdAtLabel || "Sin registro"}`,
        `Usuario: ${info?.actorName || "No registrado"}`
    ].join("\n");
}

function needsReplacementMarker(nombre, key) {
    return (
        requiereReemplazoTurnoBase(
            key,
            getTurnoBase(nombre, key),
            getAdmin(nombre),
            getLegal(nombre),
            getComp(nombre),
            getAbs(nombre)
        ) &&
        !getReplacementForCoveredShift(nombre, key)
    );
}

function replacementMarker(nombre, key) {
    return getReplacementForWorkerShift(nombre, key);
}

function pendingManualExtraMarker(nombre, key) {
    const data = getData(nombre);
    const baseWithSwaps = aplicarCambiosTurno(
        nombre,
        key,
        getTurnoBase(nombre, key),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        nombre,
        key,
        getTurnoProgramado(nombre, key),
        { includeReplacements: false }
    );
    const extraTurn = getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(nombre, key)
    );
}

function contractErrorMarker(nombre, key) {
    if (!isReplacementProfile(nombre)) {
        return false;
    }

    const state = aplicarCambiosTurno(
        nombre,
        key,
        getTurnoProgramado(nombre, key)
    );

    return state > 0 && !hasContractForDate(nombre, key);
}

function monthKeys(year, month, days) {
    return Array.from({ length: days }, (_, index) =>
        `${year}-${month}-${index + 1}`
    );
}

function hasLargaBase(profileName, key) {
    return Number(getTurnoBase(profileName, key)) === TURNO.LARGA;
}

function sameBasePattern(profileName, actualName, keys) {
    return keys.every(key =>
        Number(getTurnoBase(profileName, key)) ===
        Number(getTurnoBase(actualName, key))
    );
}

function firstLargaMatchIndex(profileName, keys) {
    return keys.findIndex(key => hasLargaBase(profileName, key));
}

function timelineCellBackground(color, isInhabil) {
    if (!isInhabil) return color;

    if (color === TURNO_COLOR[0]) {
        return "var(--timeline-holiday)";
    }

    return `linear-gradient(rgba(239, 68, 68, 0.18), rgba(239, 68, 68, 0.18)), ${color}`;
}

function timelineBlockedDayBackground(isInhabil) {
    const overlay = isInhabil
        ? "rgba(71, 85, 105, 0.28)"
        : "rgba(100, 116, 139, 0.24)";

    return `linear-gradient(135deg, ${overlay}, rgba(148, 163, 184, 0.22)), var(--timeline-empty)`;
}

async function buildTimelineRows(
    grupo,
    actual,
    year,
    month,
    diasMes,
    holidays,
    isCanceled
) {
    const keys = monthKeys(year, month, diasMes);
    const nightKeys = keys.filter(key =>
        Number(getTurnoBase(actual, key)) === TURNO.NOCHE
    );
    const freeKeys = keys.filter(key =>
        Number(getTurnoBase(actual, key)) === TURNO.LIBRE
    );

    const rows = [];

    for (const profile of grupo) {
        if (isCanceled()) return null;

        const data = getData(profile.name);
        const stats = calcularHorasMesPerfil(
            profile.name,
            year,
            month,
            diasMes,
            holidays,
            data,
            getBlocked(profile.name),
            getCarry(profile.name, year, month)
        );
        const honorariaSummary =
            getHonorariaMonthlySummary(
                profile.name,
                year,
                month,
                holidays
            );
        const rotativa = getJSON(`rotativa_${profile.name}`, {});
        const totalHhee =
            (Number(stats.hheeDiurnas) || 0) +
            (Number(stats.hheeNocturnas) || 0);
        const samePattern =
            profile.name !== actual &&
            sameBasePattern(profile.name, actual, keys);
        const nightMatch =
            firstLargaMatchIndex(profile.name, nightKeys);
        const freeMatch =
            firstLargaMatchIndex(profile.name, freeKeys);
        let priority = 3;
        let matchIndex = Number.MAX_SAFE_INTEGER;

        if (profile.name === actual) {
            priority = 0;
        } else if (samePattern) {
            priority = 6;
        } else if (rotativa.type === "diurno") {
            priority = 5;
        } else if (rotativa.type === "3turno") {
            priority = 4;
        } else if (nightMatch >= 0) {
            priority = 1;
            matchIndex = nightMatch;
        } else if (freeMatch >= 0) {
            priority = 2;
            matchIndex = freeMatch;
        }

        rows.push({
            profile,
            data,
            stats,
            honorariaSummary,
            sort: {
                priority,
                matchIndex,
                totalHhee,
                name: profile.name
            }
        });

        await yieldTimelineRender();
    }

    return rows.sort((a, b) => {
            if (a.sort.priority !== b.sort.priority) {
                return a.sort.priority - b.sort.priority;
            }

            if (a.sort.matchIndex !== b.sort.matchIndex) {
                return a.sort.matchIndex - b.sort.matchIndex;
            }

            if (a.sort.totalHhee !== b.sort.totalHhee) {
                return a.sort.totalHhee - b.sort.totalHhee;
            }

            return a.sort.name.localeCompare(b.sort.name);
        });
}

export async function renderTimeline(){
    const div = document.getElementById("teamTimeline");
    const requestId = ++timelineRenderRequest;

    if (!div) return;

    const profiles = getProfiles();
    const actual = getCurrentProfile();

    const perfilActual =
        profiles.find(x => x.name === actual);

    if (!perfilActual) {
        stopTimelineOutsideClickListener();
        div.innerHTML = `
            <div class="empty-state empty-state--compact">
                Selecciona un colaborador para ver el reporte mensual.
            </div>
        `;
        return;
    }

    const groups = timelineFilterGroups(profiles);
    const { baseGroup, selectedKeys } =
        ensureTimelineFilter(perfilActual, groups);
    const grupo = profiles
        .filter(profile =>
            profile.name === actual ||
            selectedKeys.has(timelineGroupForProfile(profile).key)
        );

    if (!grupo.length) {
        stopTimelineOutsideClickListener();
        div.innerHTML = `
            <div class="empty-state empty-state--compact">
                No hay colaboradores compatibles para comparar este mes.
            </div>
        `;
        return;
    }

    const year = calendar.currentDate.getFullYear();
    const month = calendar.currentDate.getMonth();
    const diasMes =
        new Date(year, month + 1, 0).getDate();
    const holidays = await fetchHolidays(year);

    if (
        requestId !== timelineRenderRequest ||
        !["turnos", "timeline"].includes(
            document.body.dataset.activeView
        )
    ) {
        return;
    }

    const timelineRows = await buildTimelineRows(
        grupo,
        actual,
        year,
        month,
        diasMes,
        holidays,
        () => !timelineRenderIsCurrent(
            requestId,
            year,
            month
        )
    );

    if (
        !timelineRows ||
        !timelineRenderIsCurrent(requestId, year, month)
    ) {
        return;
    }

    let html = `
        <div class="timeline-shell">
            <table class="timeline-table">
                <thead>
                    <tr>
                        <th class="timeline-name-head">
                            ${timelineFilterHTML(groups, selectedKeys, baseGroup.key)}
                        </th>
                        <th class="timeline-hhee-head timeline-hhee--day" title="HHEE Diurnas">
                            <span class="timeline-hhee-label" aria-label="HHEE Diurnas">
                                <span>HHEE</span>
                                <svg class="timeline-hhee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <circle cx="12" cy="12" r="4"></circle>
                                    <path d="M12 2v2"></path>
                                    <path d="M12 20v2"></path>
                                    <path d="M4.93 4.93l1.41 1.41"></path>
                                    <path d="M17.66 17.66l1.41 1.41"></path>
                                    <path d="M2 12h2"></path>
                                    <path d="M20 12h2"></path>
                                    <path d="M6.34 17.66l-1.41 1.41"></path>
                                    <path d="M17.66 6.34l1.41-1.41"></path>
                                </svg>
                            </span>
                        </th>
                        <th class="timeline-hhee-head timeline-hhee--night" title="HHEE Nocturnas">
                            <span class="timeline-hhee-label" aria-label="HHEE Nocturnas">
                                <span>HHEE</span>
                                <svg class="timeline-hhee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z"></path>
                                </svg>
                            </span>
                        </th>
    `;

    for (let d = 1; d <= diasMes; d++) {
        html += `<th>${d}</th>`;
    }

    html += `
                    </tr>
                </thead>
                <tbody>
    `;

    for (const {
        profile,
        data,
        stats,
        honorariaSummary
    } of timelineRows) {
        if (!timelineRenderIsCurrent(requestId, year, month)) {
            return;
        }

        const dayHhee = honorariaSummary
            ? honorariaSummary.overtimeDay
            : stats.hheeDiurnas;
        const nightHhee = honorariaSummary
            ? honorariaSummary.overtimeNight
            : stats.hheeNocturnas;
        const honorariaHheeClass =
            honorariaSummary?.overtimeHours > 0
                ? " honoraria-hhee-excess"
                : "";
        const leaveMaps = {
            admin: getAdmin(profile.name),
            legal: getLegal(profile.name),
            comp: getComp(profile.name),
            absences: getAbs(profile.name)
        };

        html += `<tr>`;
        html += `
            <td class="namecol">
                <button
                    class="timeline-profile-link"
                    type="button"
                    data-profile-name="${escapeHtml(profile.name)}"
                    title="Abrir perfil de ${escapeHtml(profile.name)}"
                >
                    ${escapeHtml(profile.name)}
                </button>
            </td>
        `;
        html += `
            <td class="timeline-hhee timeline-hhee--day${dayExtraAlertClass(profile.name, dayHhee)}${honorariaHheeClass}">
                ${formatTimelineHours(dayHhee)}
            </td>
            <td class="timeline-hhee timeline-hhee--night${honorariaHheeClass}">
                ${formatTimelineHours(nightHhee)}
            </td>
        `;

        for (let d = 1; d <= diasMes; d++) {
            const key = `${year}-${month}-${d}`;
            const replacement =
                replacementMarker(profile.name, key);
            const color = getColor(
                profile.name,
                key,
                leaveMaps,
                Boolean(replacement)
            );
            const date = new Date(year, month, d);
            const isInhabil = !isBusinessDay(date, holidays);
            const workerBlockedDay =
                getBlockedDayForProfile(profile.name, key);
            const hourReturn =
                getHourReturn(profile.name, key);
            const background = workerBlockedDay
                ? timelineBlockedDayBackground(isInhabil)
                : hourReturn
                ? "linear-gradient(135deg, #0f766e, #14b8a6)"
                : timelineCellBackground(color, isInhabil);
            const contractError =
                contractErrorMarker(profile.name, key);
            const honorariaExcess =
                getHonorariaExcessForKey(
                    honorariaSummary,
                    key
                );
            const needsReplacement =
                needsReplacementMarker(profile.name, key);
            const pendingManualExtra =
                pendingManualExtraMarker(profile.name, key);
            const severeClockIncident =
                hasSevereClockIncident(profile.name, key);
            const simpleClockIncident =
                !severeClockIncident &&
                hasSimpleClockIncident(profile.name, key);
            const clockExtra =
                hasClockExtra(
                    profile.name,
                    key,
                    new Date(year, month, d),
                    getTurnoReal(profile.name, key),
                    holidays
                );
            const showClockExtra =
                clockExtra &&
                !getClockExtraBackupForWorker(profile.name, key);
            const showExtraReason =
                !contractError &&
                !needsReplacement &&
                pendingManualExtra;
            const showHonorariaLimit =
                Boolean(honorariaExcess) &&
                !contractError &&
                !severeClockIncident &&
                !needsReplacement;
            const marker = contractError
                ? "X"
                : severeClockIncident
                    ? "!!!"
                    : needsReplacement
                        ? "!"
                        : showHonorariaLimit
                            ? "!"
                        : showExtraReason || showClockExtra
                            ? "?"
                            : simpleClockIncident
                            ? "*"
                            : (hourReturn
                                ? hourReturnTimelineMarker(hourReturn)
                                : replacement
                                ? (replacement.isLoan ? "P" : "R")
                                : "");
            const title = contractError
                ? "No tiene contrato vigente en la fecha seleccionada"
                : severeClockIncident
                    ? "Incidencia grave de marcaje"
                    : needsReplacement
                        ? "Requiere reemplazo de turno base"
                        : showHonorariaLimit
                            ? getHonorariaLimitMessage(honorariaSummary)
                        : showExtraReason
                        ? "Requiere motivo de horas extras"
                        : showClockExtra
                            ? "Requiere motivo por horas extras de marcaje"
                            : simpleClockIncident
                                ? "Incidencia de marcaje"
                        : hourReturn
                            ? `${hourReturn.fullTurn ? "Devoluci\u00f3n" : "Dev. Parcial"}: ${hourReturn.hours || 0} hrs.`
                        : replacement
                            ? (
                                replacement.replaced
                                    ? `${replacement.isLoan ? "Prestamo cubriendo a" : "Reemplazo de"} ${replacement.replaced} por ${replacement.absenceType || "ausencia"}`
                                    : `Motivo HHEE: ${replacement.reason || replacement.absenceType || "sin detalle"}`
                            )
                            : "";
            const leaveTitle = leaveApplicationHoverTitle(
                profile.name,
                key,
                leaveMaps
            );
            const titleText = [
                title,
                leaveTitle,
                workerBlockedDay
                    ? workerBlockedDay.message ||
                        "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha."
                    : ""
            ].filter(Boolean).join("\n");

            html += `
                <td
                    class="mini ${workerBlockedDay ? "worker-blocked-mini" : ""} ${isInhabil ? "timeline-inhabil" : ""} ${contractError ? "contract-error-day" : ""} ${honorariaExcess ? "honoraria-limit-day" : ""} ${severeClockIncident ? "clock-severe-day" : ""} ${simpleClockIncident ? "clock-incident-day" : ""} ${needsReplacement ? "needs-replacement" : ""} ${showExtraReason || showClockExtra ? "needs-extra-reason" : ""} ${hourReturn ? "hours-return-mini" : ""} ${replacement ? "replacement-day" : ""}"
                    style="background:${background}"
                    title="${escapeHtml(titleText)}"
                    ${contractError ? `data-contract-error-profile="${profile.name}" data-contract-error-key="${key}"` : ""}
                    ${showHonorariaLimit ? `data-honoraria-limit-profile="${profile.name}" data-honoraria-limit-key="${key}" data-honoraria-limit-message="${escapeHtml(getHonorariaLimitMessage(honorariaSummary))}"` : ""}
                    ${needsReplacement ? `data-replacement-profile="${profile.name}" data-replacement-key="${key}"` : ""}
                    ${showExtraReason ? `data-extra-profile="${profile.name}" data-extra-key="${key}" data-extra-turn="${showExtraReason}"` : ""}
                    ${showClockExtra && !showExtraReason ? `data-clock-extra-profile="${profile.name}" data-clock-extra-key="${key}" data-clock-extra-turn="${getTurnoReal(profile.name, key)}"` : ""}
                >
                    ${marker ? `<span class="timeline-replacement-marker">${marker}</span>` : ""}
                </td>
            `;
        }

        html += `</tr>`;
        await yieldTimelineRender();
    }

    html += `
                </tbody>
            </table>
        </div>
    `;

    if (!timelineRenderIsCurrent(requestId, year, month)) {
        return;
    }

    div.innerHTML = html;
    div.querySelector("[data-timeline-filter-toggle]")
        ?.addEventListener("click", event => {
            event.stopPropagation();
            setTimelineFilterOpen(
                div,
                !timelineFilterState.open
            );
        });
    div.querySelectorAll("[data-timeline-filter-key]")
        .forEach(input => {
            input.onchange = () => {
                const key = input.dataset.timelineFilterKey;

                if (!key || input.disabled) return;

                if (input.checked) {
                    timelineFilterState.selectedKeys.add(key);
                } else {
                    timelineFilterState.selectedKeys.delete(key);
                }

                timelineFilterState.open = true;
                renderTimeline();
            };
        });
    div.querySelectorAll("[data-profile-name]")
        .forEach(button => {
            button.onclick = () => {
                setTimelineFilterOpen(div, false);
                window.selectProfileByName?.(
                    button.dataset.profileName,
                    {
                        openTurns: true,
                        scrollToTop: true
                    }
                );
            };
        });
    div.querySelectorAll("[data-replacement-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.openReplacementDialog?.(
                    cell.dataset.replacementProfile,
                    cell.dataset.replacementKey
                );
            };
        });
    div.querySelectorAll("[data-extra-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.openExtraReasonDialog?.(
                    cell.dataset.extraProfile,
                    cell.dataset.extraKey,
                    Number(cell.dataset.extraTurn) || 0
                );
            };
        });
    div.querySelectorAll("[data-clock-extra-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.openClockExtraReasonDialog?.(
                    cell.dataset.clockExtraProfile,
                    cell.dataset.clockExtraKey,
                    Number(cell.dataset.clockExtraTurn) || 0
                );
            };
        });
    div.querySelectorAll("[data-contract-error-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                window.startReplacementContractEdit?.(
                    cell.dataset.contractErrorProfile,
                    cell.dataset.contractErrorKey
                );
            };
        });
    div.querySelectorAll("[data-honoraria-limit-profile]")
        .forEach(cell => {
            cell.onclick = () => {
                alert(cell.dataset.honorariaLimitMessage);
            };
        });
    syncTimelineStickyOffsets(div);
    requestAnimationFrame(() => syncTimelineStickyOffsets(div));
    bindTimelineOutsideClickListener(div);
}
