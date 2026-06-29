import { escapeHTML } from "./htmlUtils.js";
import { showConfirm } from "./dialogs.js";
import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getTurnoBase,
    getTurnoProgramado,
    siguienteTurnoValido
} from "./turnEngine.js";
import {
    calcularHorasMesPerfil,
    calcularCarryMes
} from "./hoursEngine.js";
import {
    getProfileData,
    saveProfileData,
    saveCarry,
    getAdminDays,
    getLegalDays,
    getAbsences,
    getCompDays,
    getShiftAssigned,
    getCurrentProfile,
    getProfiles,
    getRotativa,
    getReplacementRequestConfig,
    getTurnChangeConfig,
    getWorkerRequests,
    getReplacements,
    isProfileActive,
    profileCanCoverProfile,
    saveReplacements
} from "./storage.js";
import {
    tieneAusencia,
    requiereReemplazoTurnoBase,
    getTurnoExtraAgregado,
    esAusenciaInjustificada,
    getAbsenceType,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo,
    getTurnoComponentes,
    restarTurnoCubierto,
    turnoDesdeComponentes,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import { fetchHolidays } from "./holidays.js";
import {
    calcHours,
    isBusinessDay,
    isWeekend
} from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { getDayColorGradient } from "./dayColorBands.js";
import {
    cancelTimelineRender,
    renderTimeline
} from "./timeline.js";
import {
    cededSwapTurnBlocks,
    deshacerCambioTurno,
    getCambioTurnoCalendario,
    getCambiosTurnoCalendario,
    swapCodeLabel
} from "./swaps.js";
import { getShiftMoveMarkers } from "./shiftMoves.js";
import {
    getAbsenceLabelForProfileDate,
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    buildReplacementRequestWhatsAppUrl,
    cancelReplacementRequest,
    createReplacementRequest,
    createReplacementRequests,
    expireReplacementRequests,
    getPendingReplacementRequestsForShift,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift,
    saveReplacement,
    turnoToCode,
    turnoReplacementLabel,
    workerHasAbsence
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
    addAuditLog,
    AUDIT_CATEGORY,
    getLeaveApplicationInfo,
    undoAuditLogEntry
} from "./auditLog.js";
import {
    getClockExtraHours,
    hasClockExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";
import {
    getHourReturns,
    hourReturnCalendarLabel
} from "./hourReturns.js";
import { withBusyState } from "./busy.js";
import {
    TURNO,
    TURNO_CLASS
} from "./constants.js";
import {
    getJSON
} from "./persistence.js";
import { getActiveWorkspace } from "./workspaces.js";
import { listAcceptedLinkedWorkspaces } from "./firebaseLinkedUnits.js";
import {
    createInterUnitLoan,
    readLinkedStaffingMonth
} from "./firebaseInterUnitLoans.js";
import { getBlockedDayForProfile } from "./workerAvailability.js";
import {
    acceptWorkerRequestById,
    rejectWorkerRequestById
} from "./workerRequests.js";

export let currentDate = new Date();

const CALENDAR_AUDIT_DELAY_MS = 60000;
const CALENDAR_DIRECT_EDIT_REFRESH_DELAY_MS = 30000;
const CALENDAR_HEAVY_UPDATE_DELAY_MS = 450;
const calendarAuditTimers = new Map();
const calendarAuditDrafts = new Map();
let linkedReplacementStatus = "";
let calendarRenderRequest = 0;
let calendarNavigationRequest = 0;
let calendarHeavyUpdateRequest = 0;
let calendarHeavyUpdateTimer = 0;
let calendarDirectEditRefreshTimer = 0;
let calendarDirectEditRefreshRequest = 0;
let calendarDirectEditHistoryTimer = 0;
let calendarDirectEditHistoryOpen = false;
let calendarPickerYear = currentDate.getFullYear();
let calendarMonthPicker = null;

const CALENDAR_MONTH_NAMES = [
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

const PENDING_LEAVE_REQUEST_TYPES = new Set([
    "admin",
    "half_admin_morning",
    "half_admin_afternoon",
    "legal",
    "comp",
    "union_leave",
    "unpaid_leave"
]);

function closeCalendarMonthPicker() {
    if (!calendarMonthPicker) return;

    calendarMonthPicker.classList.add("hidden");
    document
        .getElementById("monthYear")
        ?.setAttribute("aria-expanded", "false");
}

function positionCalendarMonthPicker() {
    const trigger = document.getElementById("monthYear");

    if (
        !trigger ||
        !calendarMonthPicker ||
        calendarMonthPicker.classList.contains("hidden")
    ) {
        return;
    }

    const gap = 8;
    const edge = 12;
    const triggerRect = trigger.getBoundingClientRect();
    const pickerRect = calendarMonthPicker.getBoundingClientRect();
    const left = Math.min(
        Math.max(
            edge,
            triggerRect.left +
            (triggerRect.width - pickerRect.width) / 2
        ),
        window.innerWidth - pickerRect.width - edge
    );
    const preferredTop = triggerRect.bottom + gap;
    const top = preferredTop + pickerRect.height <= window.innerHeight - edge
        ? preferredTop
        : Math.max(edge, triggerRect.top - pickerRect.height - gap);

    calendarMonthPicker.style.left = `${Math.round(left)}px`;
    calendarMonthPicker.style.top = `${Math.round(top)}px`;
}

function renderCalendarMonthPicker() {
    if (!calendarMonthPicker) return;

    const activeYear = currentDate.getFullYear();
    const activeMonth = currentDate.getMonth();

    calendarMonthPicker.innerHTML = `
        <div class="calendar-month-picker__year">
            <button class="calendar-month-picker__year-button" type="button" data-calendar-year-step="-1" aria-label="A&#241;o anterior">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <strong>${calendarPickerYear}</strong>
            <button class="calendar-month-picker__year-button" type="button" data-calendar-year-step="1" aria-label="A&#241;o siguiente">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
        <div class="calendar-month-picker__months">
            ${CALENDAR_MONTH_NAMES.map((name, month) => `
                <button
                    class="calendar-month-picker__month${calendarPickerYear === activeYear && month === activeMonth ? " is-active" : ""}"
                    type="button"
                    data-calendar-month="${month}"
                >
                    ${name}
                </button>
            `).join("")}
        </div>
    `;

    calendarMonthPicker
        .querySelectorAll("[data-calendar-year-step]")
        .forEach(button => {
            button.onclick = event => {
                event.stopPropagation();
                calendarPickerYear += Number(button.dataset.calendarYearStep);
                renderCalendarMonthPicker();
                positionCalendarMonthPicker();
            };
        });

    calendarMonthPicker
        .querySelectorAll("[data-calendar-month]")
        .forEach(button => {
            button.onclick = async event => {
                event.stopPropagation();
                await goToCalendarMonth(
                    calendarPickerYear,
                    Number(button.dataset.calendarMonth),
                    { deferHeavy: true }
                );
            };
        });
}

function setupCalendarMonthPicker(trigger) {
    if (!trigger || trigger.dataset.monthPickerBound === "true") {
        return;
    }

    trigger.dataset.monthPickerBound = "true";
    calendarMonthPicker = document.createElement("div");
    calendarMonthPicker.className =
        "calendar-month-picker hidden";
    calendarMonthPicker.setAttribute("role", "dialog");
    calendarMonthPicker.setAttribute(
        "aria-label",
        "Seleccionar mes y a\u00f1o"
    );
    document.body.appendChild(calendarMonthPicker);

    trigger.addEventListener("click", event => {
        event.stopPropagation();

        if (!calendarMonthPicker.classList.contains("hidden")) {
            closeCalendarMonthPicker();
            return;
        }

        calendarPickerYear = currentDate.getFullYear();
        renderCalendarMonthPicker();
        calendarMonthPicker.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
        positionCalendarMonthPicker();
    });

    document.addEventListener("click", closeCalendarMonthPicker);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeCalendarMonthPicker();
        }
    });
    window.addEventListener("resize", positionCalendarMonthPicker);
    window.addEventListener(
        "scroll",
        positionCalendarMonthPicker,
        true
    );
}

function deferAfterPaint(callback) {
    if (typeof window === "undefined") {
        callback();
        return;
    }

    const run = () => window.setTimeout(callback, 0);

    if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(run);
        });
    } else {
        run();
    }
}

function cancelCalendarHeavyUpdates() {
    clearTimeout(calendarHeavyUpdateTimer);
    calendarHeavyUpdateTimer = 0;
    calendarHeavyUpdateRequest++;
    cancelTimelineRender();
}

function runCalendarHeavyUpdates(options = {}, context = null) {
    if (calendarDirectEditRefreshTimer) {
        cancelTimelineRender();
        return;
    }

    const requestId = ++calendarHeavyUpdateRequest;
    const update = async () => {
        calendarHeavyUpdateTimer = 0;

        if (requestId !== calendarHeavyUpdateRequest) {
            return;
        }

        const activeView =
            document.body.dataset.activeView || "turnos";

        if (
            activeView === "turnos" ||
            activeView === "timeline"
        ) {
            await renderTimeline();
        }

        if (requestId !== calendarHeavyUpdateRequest) {
            return;
        }

        await new Promise(resolve => {
            window.setTimeout(resolve, 120);
        });

        if (requestId !== calendarHeavyUpdateRequest) {
            return;
        }

        if (
            context &&
            context.profile &&
            context.profile === getCurrentProfile() &&
            context.y === currentDate.getFullYear() &&
            context.m === currentDate.getMonth()
        ) {
            const carryOut = calcularCarryMes(
                context.y,
                context.m,
                context.days,
                context.holidays,
                context.data
            );
            const next = new Date(context.y, context.m + 1, 1);

            saveCarry(
                next.getFullYear(),
                next.getMonth(),
                carryOut
            );
        }

        if (requestId !== calendarHeavyUpdateRequest) {
            return;
        }

        if (
            activeView === "turnos" &&
            typeof window.renderInlineStaffingAnalysis === "function"
        ) {
            window.renderInlineStaffingAnalysis();
        }
    };

    if (options.deferHeavy) {
        cancelTimelineRender();
        clearTimeout(calendarHeavyUpdateTimer);
        calendarHeavyUpdateTimer = window.setTimeout(
            () => void update(),
            CALENDAR_HEAVY_UPDATE_DELAY_MS
        );
        return;
    }

    void update();
}

function keepCalendarDirectEditHistoryOpen(label) {
    if (
        !calendarDirectEditHistoryOpen &&
        typeof window.pushUndoState === "function"
    ) {
        window.pushUndoState(label);
    }

    calendarDirectEditHistoryOpen = true;
    clearTimeout(calendarDirectEditHistoryTimer);
    calendarDirectEditHistoryTimer = window.setTimeout(() => {
        calendarDirectEditHistoryOpen = false;
        calendarDirectEditHistoryTimer = 0;
    }, CALENDAR_DIRECT_EDIT_REFRESH_DELAY_MS);
}

function closeCalendarDirectEditHistory() {
    clearTimeout(calendarDirectEditHistoryTimer);
    calendarDirectEditHistoryTimer = 0;
    calendarDirectEditHistoryOpen = false;
}

function cancelCalendarDirectEditRefresh() {
    clearTimeout(calendarDirectEditRefreshTimer);
    calendarDirectEditRefreshTimer = 0;
    calendarDirectEditRefreshRequest++;
    calendarRenderRequest++;
    cancelCalendarHeavyUpdates();
    closeCalendarDirectEditHistory();
}

async function flushCalendarDirectEditRefresh(options = {}) {
    const expectedRequest =
        Number(options.requestId) || 0;
    const force = options.force === true;

    if (
        expectedRequest &&
        expectedRequest !== calendarDirectEditRefreshRequest
    ) {
        return;
    }

    if (!calendarDirectEditRefreshTimer && !force) return;

    clearTimeout(calendarDirectEditRefreshTimer);
    calendarDirectEditRefreshTimer = 0;
    calendarDirectEditRefreshRequest++;
    calendarRenderRequest++;
    cancelCalendarHeavyUpdates();
    closeCalendarDirectEditHistory();
    await renderCalendar({ deferHeavy: true });
}

function scheduleCalendarDirectEditRefresh() {
    clearTimeout(calendarDirectEditRefreshTimer);
    calendarDirectEditRefreshRequest++;
    calendarRenderRequest++;
    cancelCalendarHeavyUpdates();
    const requestId = calendarDirectEditRefreshRequest;

    calendarDirectEditRefreshTimer = window.setTimeout(
        () => void flushCalendarDirectEditRefresh({
            requestId
        }),
        CALENDAR_DIRECT_EDIT_REFRESH_DELAY_MS
    );
}

window.flushCalendarDirectEditRefresh =
    flushCalendarDirectEditRefresh;

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function dateFromKeyDay(keyDay) {
    const [year, month, day] = String(keyDay || "")
        .split("-")
        .map(Number);

    return new Date(year || 0, month || 0, day || 1);
}

function isoFromKeyDay(keyDay) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) return "";

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function addDaysISO(iso, offset) {
    const parts = String(iso || "").split("-").map(Number);
    const date = new Date(
        Number(parts[0]) || 0,
        (Number(parts[1]) || 1) - 1,
        Number(parts[2]) || 1
    );

    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() + Number(offset || 0));

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function pendingLeaveRequestLabel(type) {
    if (type === "admin") return "ADM";
    if (type === "half_admin_morning") return "1/2M";
    if (type === "half_admin_afternoon") return "1/2T";
    if (type === "legal") return "FL";
    if (type === "comp") return "FC";
    if (type === "union_leave") return "PG";
    if (type === "unpaid_leave") return "PSG";

    return "Permiso";
}

function pendingLeaveRequestLongLabel(type) {
    if (type === "admin") return "P. Administrativo";
    if (type === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (type === "half_admin_afternoon") return "1/2 ADM Tarde";
    if (type === "legal") return "F. Legal";
    if (type === "comp") return "F. Compensatorio";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";

    return "Permiso";
}

function pendingLeaveRequestEndDate(request) {
    if (request.endDate) return request.endDate;

    const days = Math.max(
        1,
        Math.ceil(Number(request.days) || 1)
    );

    return addDaysISO(request.date, days - 1);
}

function leaveRequestCoversISODate(request, iso) {
    if (!request?.date || !iso) return false;

    const endDate = pendingLeaveRequestEndDate(request);

    return (
        String(iso) >= String(request.date) &&
        String(iso) <= String(endDate || request.date)
    );
}

function getPendingLeaveRequestForDay(profileName, keyDay) {
    const iso = isoFromKeyDay(keyDay);

    if (!profileName || !iso) return null;

    return getWorkerRequests().find(request =>
        request.status === "pending" &&
        request.profile === profileName &&
        PENDING_LEAVE_REQUEST_TYPES.has(request.type) &&
        leaveRequestCoversISODate(request, iso)
    ) || null;
}

function pendingLeaveHoverTitle(request, profileName, keyDay, baseState) {
    if (!request) return "";

    const start = request.date
        ? formatISODateForHover(request.date)
        : leaveDateLabelFromKey(keyDay);
    const end = pendingLeaveRequestEndDate(request);
    const baseLabel = turnoLabel(baseState) || "Libre";

    return [
        "Solicitud pendiente",
        `Trabajador: ${profileName}`,
        `Tipo: ${pendingLeaveRequestLongLabel(request.type)}`,
        `Inicio: ${start}`,
        end && end !== request.date
            ? `Termino: ${formatISODateForHover(end)}`
            : "",
        request.days ? `Dias: ${request.days}` : "",
        `Turno base: ${baseLabel}`,
        request.note ? `Detalle: ${request.note}` : ""
    ].filter(Boolean).join("\n");
}

function openPendingLeaveRequestDialog({
    request,
    profile,
    keyDay,
    baseState
}) {
    if (!request) return;

    const label = pendingLeaveRequestLongLabel(request.type);
    const start = request.date
        ? formatISODateForHover(request.date)
        : leaveDateLabelFromKey(keyDay);
    const end = pendingLeaveRequestEndDate(request);
    const baseLabel = turnoLabel(baseState) || "Libre";
    const canManage =
        typeof window.workspaceCanEditTarget !== "function" ||
        window.workspaceCanEditTarget("workerRequestsPanel");

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-request-dialog" role="dialog" aria-modal="true" aria-labelledby="pendingLeaveRequestTitle">
            <strong id="pendingLeaveRequestTitle">Solicitud pendiente</strong>
            <div class="leave-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Tipo</span><b>${escapeHTML(label)}</b></div>
                <div><span>Inicio</span><b>${escapeHTML(start)}</b></div>
                ${end && end !== request.date
                    ? `<div><span>T\u00e9rmino</span><b>${escapeHTML(formatISODateForHover(end))}</b></div>`
                    : ""}
                <div><span>D\u00edas</span><b>${escapeHTML(String(request.days || 1))}</b></div>
                <div><span>Turno base</span><b>${escapeHTML(baseLabel)}</b></div>
            </div>
            ${request.note
                ? `<p class="leave-detail-note">${escapeHTML(request.note)}</p>`
                : ""}
            ${canManage
                ? `
                    <div class="turn-change-dialog__actions">
                        <button class="primary-button" type="button" data-action="accept">Aceptar</button>
                        <button class="secondary-button" type="button" data-action="reject">Rechazar</button>
                        <button class="ghost-button" type="button" data-action="close">Cerrar</button>
                    </div>
                `
                : `
                    <p class="leave-detail-note">Tu usuario solo puede revisar esta solicitud.</p>
                    <div class="turn-change-dialog__actions">
                        <button class="ghost-button" type="button" data-action="close">Cerrar</button>
                    </div>
                `}
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };
    const finish = async action => {
        const button = backdrop.querySelector(`[data-action='${action}']`);

        if (button) {
            button.disabled = true;
            button.textContent =
                action === "accept" ? "Aceptando..." : "Rechazando...";
        }

        const ok = action === "accept"
            ? await acceptWorkerRequestById(request.id)
            : await rejectWorkerRequestById(request.id);

        if (!ok) {
            if (button) {
                button.disabled = false;
                button.textContent =
                    action === "accept" ? "Aceptar" : "Rechazar";
            }
            return;
        }

        close();
        window.dispatchEvent(
            new CustomEvent("proturnos:workerRequestsChanged")
        );
        await renderCalendar({ deferHeavy: true });
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='accept']")
        ?.addEventListener("click", () => void finish("accept"));
    backdrop
        .querySelector("[data-action='reject']")
        ?.addEventListener("click", () => void finish("reject"));

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function scheduleCalendarAuditLog({
    profile,
    keyDay,
    previousTurn,
    nextTurn
}) {
    if (!profile || !keyDay) return;

    const id = `${profile}::${keyDay}`;
    const currentDraft =
        calendarAuditDrafts.get(id);
    const draft = {
        profile,
        keyDay,
        previousTurn: currentDraft
            ? currentDraft.previousTurn
            : previousTurn,
        nextTurn
    };

    calendarAuditDrafts.set(id, draft);

    if (calendarAuditTimers.has(id)) {
        clearTimeout(calendarAuditTimers.get(id));
    }

    calendarAuditTimers.set(
        id,
        setTimeout(() => {
            const finalDraft =
                calendarAuditDrafts.get(id);

            calendarAuditTimers.delete(id);
            calendarAuditDrafts.delete(id);

            if (!finalDraft) return;
            if (
                Number(finalDraft.previousTurn) ===
                Number(finalDraft.nextTurn)
            ) {
                return;
            }

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Modifico turno manualmente",
                `${finalDraft.profile}: ${finalDraft.keyDay} paso de ${turnoLabel(finalDraft.previousTurn) || "Libre"} a ${turnoLabel(finalDraft.nextTurn) || "Libre"}.`,
                {
                    profile: finalDraft.profile,
                    keyDay: finalDraft.keyDay,
                    previousTurn: finalDraft.previousTurn,
                    nextTurn: finalDraft.nextTurn,
                    delayed: true
                }
            );
        }, CALENDAR_AUDIT_DELAY_MS)
    );
}

function buildDayCell({
    day,
    month,
    year,
    keyDay,
    label,
    alternateLabel,
    badge,
    badges,
    title,
    isWeekendDay,
    isHoliday,
    isDraftSelected
}) {
    const div = document.createElement("div");

    div.classList.add("day");
    div.dataset.day = day;
    div.dataset.month = month;
    div.dataset.year = year;

    if (isWeekendDay) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    const today = new Date();
    if (
        today.getFullYear() === Number(year) &&
        today.getMonth() === Number(month) &&
        today.getDate() === Number(day)
    ) {
        div.classList.add("today");
    }

    if (isDraftSelected) {
        div.classList.add("draft-selected");
    }

    const visibleBadges = Array.isArray(badges)
        ? badges.filter(Boolean)
        : (badge ? [badge] : []);

    if (visibleBadges.length > 1) {
        div.classList.add("has-multiple-badges");
    }

    const badgeHTML = visibleBadges.length
        ? `
            <span class="day-badges">
                ${visibleBadges.map(item => `<span class="day-badge">${escapeHTML(item)}</span>`).join("")}
            </span>
        `
        : "";
    const labelHTML = alternateLabel
        ? `
            <span class="day-label day-label--alternating">
                <span class="day-label__primary">${escapeHTML(label || "")}</span>
                <span class="day-label__alternate">${escapeHTML(alternateLabel || "")}</span>
            </span>
        `
        : `<span class="day-label">${escapeHTML(label || "")}</span>`;

    div.innerHTML = `
        <span class="day-number">${day}</span>
        <span class="day-label-stack">
            ${labelHTML}
            ${badgeHTML}
        </span>
    `;

    if (title) {
        div.title = title;
    }

    return div;
}

function confirmUndoTurnChange(swap) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <div class="turn-change-dialog" role="dialog" aria-modal="true" aria-labelledby="turnChangeDialogTitle">
                <strong id="turnChangeDialogTitle">Cambio de turno aplicado</strong>
                <p>
                    Para modificar el turno de este dia debes deshacer el cambio de turno aplicado.
                </p>
                <div class="turn-change-dialog__meta">
                    ${swap.from} -> ${swap.to}
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="undo">
                        Deshacer
                    </button>
                </div>
            </div>
        `;

        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                close(false);
            }
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(false);
            }
        });

        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = () => close(false);

        backdrop
            .querySelector("[data-action='undo']")
            .onclick = () => close(true);

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);

        backdrop
            .querySelector("[data-action='undo']")
            .focus();
    });
}

async function handleTurnChangeDayClick(swap) {
    const shouldUndo =
        await confirmUndoTurnChange(swap);

    if (!shouldUndo) {
        return true;
    }

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState("Deshacer cambio de turno");
    }

    deshacerCambioTurno(swap);
    await renderCalendar();
    refreshStaffingAnalysisPanel();

    return true;
}

function sameRoleProfiles(profileName) {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        profileCanCoverProfile(profile, base)
    );
}

function replacementScopeProfiles(profileName, scope = "compatible") {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        (
            scope === "all-local" ||
            profileCanCoverProfile(profile, base)
        )
    );
}

function keyToISODate(keyDay) {
    const parts = String(keyDay || "").split("-");

    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(Number(parts[2])).padStart(2, "0")}`;
}

function formatISODateForHover(value) {
    const parts = String(value || "").split("-");

    if (parts.length !== 3) return String(value || "");

    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function formatISODateForSwapHover(value) {
    const parts = String(value || "")
        .split("-")
        .map(Number);

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        return formatISODateForHover(value);
    }

    return new Intl.DateTimeFormat(
        "es-CL",
        {
            day: "numeric",
            month: "long"
        }
    ).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function turnChangeHoverTitle(marker, profileName) {
    const swap = marker?.swap;
    const perspective = marker?.perspective;

    if (!swap) return "";

    if (perspective) {
        return [
            !perspective.changeSkipped &&
                `Cambia su turno base de ${perspective.changeTurnLabel} del ${formatISODateForSwapHover(perspective.changeDate)} con ${perspective.counterpart}`,
            !perspective.returnSkipped &&
                `Devuelve el turno el ${formatISODateForSwapHover(perspective.returnDate)} realizando ${perspective.returnTurnLabel}`
        ].filter(Boolean).join("\n");
    }

    return [
        `Cambio de turno: ${marker.label}`,
        `Trabajador seleccionado: ${profileName}`,
        `Entrega turno: ${swap.from}`,
        `Recibe turno: ${swap.to}`,
        `Fecha cambio: ${formatISODateForHover(swap.fecha)}`,
        `Turno cambio: ${swapCodeLabel(swap.turno)}`,
        `Fecha devoluci\u00f3n: ${formatISODateForHover(swap.devolucion)}`,
        `Turno devoluci\u00f3n: ${swapCodeLabel(swap.turnoDevuelto)}`
    ].filter(Boolean).join("\n");
}

function formatShiftMoveDate(keyDay) {
    const date = dateFromKeyDay(keyDay);

    if (Number.isNaN(date.getTime())) {
        return String(keyDay || "");
    }

    return new Intl.DateTimeFormat(
        "es-CL",
        {
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    ).format(date);
}

function shiftMoveTurnLabel(turn) {
    return Number(turn) === TURNO.NOCHE
        ? "Noche"
        : "Larga";
}

function shiftMoveHoverTitle(marker) {
    const move = marker?.move;

    if (!move) return "";

    const detail = [
        "Turno modificado (TTMM)",
        `Trabajador: ${move.profile}`,
        `Origen: ${formatShiftMoveDate(move.sourceKey)} · ${shiftMoveTurnLabel(move.sourceTurn)}`,
        `Destino: ${formatShiftMoveDate(move.targetKey)} · ${shiftMoveTurnLabel(move.destinationTurn)}`
    ];

    if (marker.role === "source") {
        detail.push("Este dia quedo libre por el movimiento.");
    } else if (marker.role === "target") {
        detail.push("Este dia recibio el turno movido.");
    } else {
        detail.push("En este dia se modifico el horario del turno.");
    }

    return detail.join("\n");
}

function leaveTypeForDay(keyDay, admin, legal, comp, absences) {
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

function leaveSourceMapForType(type, admin, legal, comp, absences) {
    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon" ||
        type === "half_admin"
    ) {
        return admin;
    }

    if (type === "legal") return legal;
    if (type === "comp") return comp;

    return absences;
}

function leaveApplicationHoverTitle(
    profileName,
    keyDay,
    admin,
    legal,
    comp,
    absences
) {
    const type = leaveTypeForDay(
        keyDay,
        admin,
        legal,
        comp,
        absences
    );

    if (!type) return "";

    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile: profileName,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(
                type,
                admin,
                legal,
                comp,
                absences
            )
        });

    return [
        leaveLabelForType(type),
        `Aplicado: ${info?.createdAtLabel || "Sin registro"}`,
        `Usuario: ${info?.actorName || "No registrado"}`
    ].join("\n");
}

function leaveDateLabelFromKey(keyDay) {
    const [y, m, d] = String(keyDay || "").split("-").map(Number);
    const date = new Date(y, m, d);

    if (Number.isNaN(date.getTime())) return String(keyDay || "");

    return date.toLocaleDateString("es-CL", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });
}

function openLeaveDetailDialog({
    profile,
    keyDay,
    admin,
    legal,
    comp,
    absences
}) {
    const type = leaveTypeForDay(keyDay, admin, legal, comp, absences);

    if (!type) return;

    const label = leaveLabelForType(type);
    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(
                type,
                admin,
                legal,
                comp,
                absences
            )
        });
    const canUndo = Boolean(info?.canUndo && info?.logId);

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog leave-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="leaveDetailTitle">
            <strong id="leaveDetailTitle">${escapeHTML(label)}</strong>
            <div class="leave-detail-rows">
                <div><span>Trabajador</span><b>${escapeHTML(profile)}</b></div>
                <div><span>Fecha</span><b>${escapeHTML(leaveDateLabelFromKey(keyDay))}</b></div>
                <div><span>Aplicado</span><b>${escapeHTML(info?.createdAtLabel || "Sin registro")}</b></div>
                <div><span>Por</span><b>${escapeHTML(info?.actorName || "No registrado")}</b></div>
            </div>
            <p class="leave-detail-note">
                ${canUndo
                    ? "Anular quitara el permiso/ausencia, cancelara los reemplazos asociados, notificara a los trabajadores afectados y dejara el registro del LOG marcado como anulado."
                    : "Este permiso no tiene un registro en el LOG que permita anularlo automaticamente."}
            </p>
            <div class="turn-change-dialog__actions">
                ${canUndo
                    ? `<button class="leave-detail-undo" type="button" data-action="undo">Anular permiso</button>`
                    : ""}
                <button class="ghost-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    backdrop
        .querySelector("[data-action='undo']")
        ?.addEventListener("click", async event => {
            const button = event.currentTarget;
            const confirmed = await showConfirm(
                `Se anulará ${label} de ${profile}. También se cancelarán los reemplazos asociados y se notificará a los trabajadores.`,
                {
                    title: "Anular permiso",
                    tone: "danger",
                    confirmText: "Anular permiso",
                    destructive: true
                }
            );

            if (!confirmed) return;

            button.disabled = true;
            button.textContent = "Anulando...";

            try {
                const result = await undoAuditLogEntry(info.logId, {
                    source: "calendar"
                });

                if (!result?.ok) {
                    button.disabled = false;
                    button.textContent = "Anular permiso";
                    alert(
                        "No se pudo anular automaticamente. Es posible que el registro haya cambiado."
                    );
                    return;
                }

                close();
                await renderCalendar({ deferHeavy: true });
            } catch (error) {
                console.error(error);
                button.disabled = false;
                button.textContent = "Anular permiso";
                alert("Ocurrio un error al anular el permiso.");
            }
        });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function previewDirectTurnChange(
    cell,
    nextTurn,
    date,
    holidays = {},
    options = {}
) {
    if (!cell) return;

    Object.values(TURNO_CLASS)
        .filter(Boolean)
        .forEach(className => {
            cell.classList.remove(className);
        });

    cell.classList.remove(
        "needs-extra-reason",
        "clock-extra-day",
        "clock-incident-day",
        "clock-severe-day",
        "manual-extra-day",
        "turno-split"
    );
    cell.style.removeProperty("background");

    aplicarClaseTurno(cell, nextTurn);

    if (options.manualExtra) {
        const gradient = getDayColorGradient(
            options.profileName,
            options.keyDay,
            nextTurn,
            date,
            holidays,
            null,
            options.baseTurn,
            {
                unbasedComponentsAreExtra: true,
                singleBandGradient: true
            }
        );

        cell.classList.add("manual-extra-day");

        if (gradient) {
            cell.style.setProperty(
                "background",
                gradient,
                "important"
            );
            cell.classList.add("turno-split");
        }
    }

    cell.classList.add("calendar-direct-edit-feedback");
    cell.dataset.directTurnState = String(nextTurn);

    const label = cell.querySelector(".day-label");
    if (label) {
        label.textContent = turnoLabel(nextTurn) || "";
    }

    cell.querySelectorAll(".day-badge").forEach(badge => {
        badge.remove();
    });

    const hours = calcHours(date, nextTurn, holidays);
    cell.title = `Diurnas: ${hours.d} | Nocturnas: ${hours.n}`;

    window.setTimeout(() => {
        cell.classList.remove("calendar-direct-edit-feedback");
    }, 160);
}

function combinedTurnChangeConfig(remoteConfig) {
    const localConfig = getTurnChangeConfig();

    return {
        allowTwentyFourHourShifts:
            localConfig.allowTwentyFourHourShifts !== false &&
            remoteConfig.allowTwentyFourHourShifts !== false
    };
}

function isLongNightCombination(currentState, neededTurn) {
    return (
        (
            currentState === TURNO.LARGA &&
            neededTurn === TURNO.NOCHE
        ) ||
        (
            currentState === TURNO.NOCHE &&
            neededTurn === TURNO.LARGA
        )
    );
}

function canCoverLinkedShift(currentState, neededTurn, config) {
    if (!neededTurn) return false;

    if (currentState === TURNO.LIBRE) return true;

    return (
        isLongNightCombination(currentState, neededTurn) &&
        config.allowTwentyFourHourShifts !== false
    );
}

async function linkedWorkspaceCandidates(
    profileName,
    keyDay,
    neededTurn,
    monthContext = {}
) {
    linkedReplacementStatus = "";

    const activeWorkspace = getActiveWorkspace();

    if (!activeWorkspace?.id) {
        linkedReplacementStatus =
            "Selecciona un entorno Firebase activo para buscar en unidades enlazadas.";
        return [];
    }

    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );

    if (!baseProfile) {
        linkedReplacementStatus =
            "No se encontro el perfil que requiere reemplazo.";
        return [];
    }

    const linkedWorkspaces =
        await listAcceptedLinkedWorkspaces(activeWorkspace);
    const candidates = [];
    const diagnostics = {
        readErrors: [],
        emptyMonths: [],
        totalProfiles: 0,
        compatibleProfiles: 0,
        availableProfiles: 0
    };

    if (!linkedWorkspaces.length) {
        linkedReplacementStatus =
            "No hay unidades enlazadas aceptadas para este entorno.";
        return [];
    }

    for (const workspace of linkedWorkspaces) {
        let staffingMonth = null;

        try {
            staffingMonth = await readLinkedStaffingMonth(
                workspace.id,
                keyDay,
                {
                    linkId: workspace.linkId,
                    requesterWorkspaceId: activeWorkspace.id
                }
            );
        } catch (error) {
            console.warn(
                "No se pudo leer disponibilidad de unidad enlazada.",
                workspace.id,
                error
            );
            diagnostics.readErrors.push(
                workspace.name || workspace.id
            );
            continue;
        }

        if (!staffingMonth) {
            diagnostics.emptyMonths.push(
                workspace.name || workspace.id
            );
            continue;
        }

        const allProfiles = Array.isArray(staffingMonth.workers)
            ? staffingMonth.workers
            : [];
        const profiles = allProfiles
            .filter(profile =>
                profile &&
                profileCanCoverProfile(profile, baseProfile)
            );

        diagnostics.totalProfiles += allProfiles.length;
        diagnostics.compatibleProfiles += profiles.length;

        const coverConfig = combinedTurnChangeConfig({
            allowTwentyFourHourShifts:
                staffingMonth.allowTwentyFourHourShifts !== false
        });
        const iso = keyToISODate(keyDay);

        profiles.forEach(profile => {
            const day = profile.days?.[iso] || null;
            const currentState = Number(day?.turn) || TURNO.LIBRE;

            if (
                !day?.available ||
                !canCoverLinkedShift(
                    currentState,
                    neededTurn,
                    coverConfig
                )
            ) {
                return;
            }

            const hheeDiurnas =
                Number(profile.hheeDiurnas) || 0;
            const hheeNocturnas =
                Number(profile.hheeNocturnas) || 0;

            diagnostics.availableProfiles++;

            candidates.push({
                profile,
                currentState,
                isFree: currentState === TURNO.LIBRE,
                isForced: false,
                isLinked: true,
                workspaceId: workspace.id,
                workspaceName: workspace.name || workspace.id,
                linkId: workspace.linkId || "",
                blockedDay: day.blocked
                    ? {
                        message:
                            "El trabajador marco esta fecha como no disponible para reemplazos."
                    }
                    : null,
                hheeDiurnas,
                hheeNocturnas,
                hhee: hheeDiurnas + hheeNocturnas
            });
        });
    }

    if (!candidates.length) {
        if (diagnostics.readErrors.length) {
            linkedReplacementStatus =
                `No se pudo leer la disponibilidad de ${diagnostics.readErrors.join(", ")}. Revisa que el enlace siga activo.`;
        } else if (diagnostics.emptyMonths.length) {
            linkedReplacementStatus =
                `La unidad enlazada ${diagnostics.emptyMonths.join(", ")} aun no publico disponibilidad para este mes. Abre esa unidad y espera unos segundos.`;
        } else if (!diagnostics.totalProfiles) {
            linkedReplacementStatus =
                "La unidad enlazada no tiene colaboradores activos sincronizados.";
        } else if (!diagnostics.compatibleProfiles) {
            linkedReplacementStatus =
                "Hay unidades enlazadas, pero no se encontraron trabajadores activos con la misma profesion/estamento requerido.";
        } else {
            linkedReplacementStatus =
                "Hay trabajadores compatibles en unidades enlazadas, pero todos tienen ausencia, permiso o turno incompatible ese dia.";
        }
    }

    return candidates.sort((a, b) =>
        a.workspaceName.localeCompare(b.workspaceName) ||
        a.profile.name.localeCompare(b.profile.name)
    );
}

function refreshStaffingAnalysisPanel() {
    const activeView =
        document.body.dataset.activeView || "turnos";

    if (
        activeView === "turnos" &&
        typeof window.renderInlineStaffingAnalysis === "function"
    ) {
        window.renderInlineStaffingAnalysis();
        return;
    }

    if (
        activeView === "staffing" &&
        typeof window.renderStaffingAnalysis === "function"
    ) {
        window.renderStaffingAnalysis();
    }
}

function candidateMeta(profile) {
    const profession = profile.profession &&
        profile.profession !== "Sin informacion"
        ? ` | ${profile.profession}`
        : "";

    return `${profile.estamento || "Sin estamento"}${profession}`;
}

function formatCandidateHours(value) {
    const hours = Math.round((Number(value) || 0) * 2) / 2;

    return Number.isInteger(hours)
        ? String(hours)
        : String(hours).replace(".", ",");
}

function replacementCandidateCoverageAttrs(candidate) {
    const attrs = [];

    if (candidate.isDiurnoLongCoverage) {
        attrs.push(`data-diurno-long-coverage="true"`);
    }

    if (candidate.overtimeHours) {
        attrs.push(`data-overtime-day-hours="${Number(candidate.overtimeHours.d) || 0}"`);
        attrs.push(`data-overtime-night-hours="${Number(candidate.overtimeHours.n) || 0}"`);
    }

    return attrs.join(" ");
}

function replacementCandidateWarning(candidate) {
    if (!candidate?.blockedDay) return "";

    return candidate.blockedDay.message ||
        "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha.";
}

function replacementCoverageFromDataset(dataset = {}) {
    const coverage = {};
    const hasCustomOvertime =
        dataset.overtimeDayHours !== undefined ||
        dataset.overtimeNightHours !== undefined;

    if (dataset.diurnoLongCoverage === "true") {
        coverage.diurnoLongCoverage = true;
    }

    if (hasCustomOvertime) {
        coverage.overtimeHours = {
            d: Number(dataset.overtimeDayHours) || 0,
            n: Number(dataset.overtimeNightHours) || 0
        };
    }

    if (
        !coverage.diurnoLongCoverage &&
        !coverage.overtimeHours
    ) {
        return {};
    }

    return coverage;
}

function getActualState(profileName, keyDay) {
    return aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoProgramado(profileName, keyDay)
    );
}

function isHalfAdminValue(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

function getHalfAdminCoverageTurn(profileName, keyDay) {
    const baseTurn = getTurnoBase(profileName, keyDay);

    if (baseTurn !== TURNO.LARGA) {
        return TURNO.LIBRE;
    }

    const admin = getJSON(`admin_${profileName}`, {});

    if (admin[keyDay] === "0.5M") {
        return TURNO.MEDIA_MANANA;
    }

    if (admin[keyDay] === "0.5T") {
        return TURNO.MEDIA_TARDE;
    }

    return TURNO.LIBRE;
}

function getReplacementNeededTurn(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});

    if (isHalfAdminValue(admin[keyDay])) {
        return getHalfAdminCoverageTurn(profileName, keyDay);
    }

    return getTurnoBase(profileName, keyDay);
}

function canCoverShift(
    currentState,
    neededTurn,
    config = getTurnChangeConfig(),
    options = {}
) {
    if (!neededTurn) return false;

    if (
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA
    ) {
        return options.allowDiurnoLongCoverage === true;
    }

    const merged = fusionarTurnos(
        currentState,
        neededTurn
    );

    if (merged === currentState) return false;

    if (
        merged === TURNO.TURNO24 &&
        config.allowTwentyFourHourShifts === false
    ) {
        return false;
    }

    return true;
}

function diurnoLongCoverageHours(date) {
    return {
        d: date.getDay() === 5 ? 4 : 3,
        n: 0
    };
}

function isHalfAdminAfternoonCoverage(profileName, keyDay, neededTurn) {
    if (neededTurn !== TURNO.MEDIA_TARDE) return false;

    const admin = getJSON(`admin_${profileName}`, {});

    return admin[keyDay] === "0.5T";
}

function halfAdminAfternoonCoverageHours(currentState, date) {
    if (
        currentState === TURNO.DIURNO ||
        currentState === TURNO.DIURNO_NOCHE
    ) {
        return diurnoLongCoverageHours(date);
    }

    return {
        d: 6,
        n: 0
    };
}

function isDiurnoLongCoverageCandidate(
    profile,
    currentState,
    neededTurn,
    date,
    holidays
) {
    return (
        getRotativa(profile.name).type === "diurno" &&
        currentState === TURNO.DIURNO &&
        neededTurn === TURNO.LARGA &&
        isBusinessDay(date, holidays)
    );
}

function getManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        Object.prototype.hasOwnProperty.call(profileData, keyDay)
            ? Number(profileData[keyDay]) || 0
            : getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    return getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );
}

function getPendingManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const extraTurn = getManualExtraTurn(
        profileName,
        keyDay,
        profileData
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(profileName, keyDay)
    );
}

function cancelManualExtraBackupsForTurnChange(
    profileName,
    keyDay,
    nextTurn
) {
    const iso = isoFromKeyDay(keyDay);
    const replacements = getReplacements();
    const now = new Date().toISOString();
    let canceledCount = 0;

    const nextReplacements = replacements.map(replacement => {
        if (
            replacement.canceled ||
            replacement.worker !== profileName ||
            replacement.date !== iso ||
            replacement.source !== "manual_extra"
        ) {
            return replacement;
        }

        canceledCount++;

        return {
            ...replacement,
            canceled: true,
            canceledAt: now,
            canceledBy: "Calendario",
            cancelReason: "manual_turn_changed"
        };
    });

    if (!canceledCount) return 0;

    saveReplacements(nextReplacements);
    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        "Anulo respaldo de turno extra",
        `${profileName}: se quito el motivo/respaldo HHEE del ${iso} porque el turno manual fue modificado a ${turnoLabel(nextTurn) || "Libre"}.`,
        {
            profile: profileName,
            keyDay,
            date: iso,
            nextTurn,
            source: "manual_turn_changed",
            canceledCount
        }
    );

    return canceledCount;
}

async function getReplacementCandidates(
    profileName,
    keyDay,
    options = {}
) {
    const date = new Date(
        Number(keyDay.split("-")[0]),
        Number(keyDay.split("-")[1]),
        Number(keyDay.split("-")[2])
    );
    const y = date.getFullYear();
    const m = date.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const holidays = await fetchHolidays(y);
    const neededTurn =
        options.neededTurn ||
        getReplacementNeededTurn(profileName, keyDay);
    const isHalfAfternoonCoverage =
        isHalfAdminAfternoonCoverage(
            profileName,
            keyDay,
            neededTurn
        );
    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );
    const scope = options.scope || "compatible";

    if (scope === "linked") {
        return linkedWorkspaceCandidates(
            profileName,
            keyDay,
            neededTurn,
            {
                y,
                m,
                days,
                holidays
            }
        );
    }

    return replacementScopeProfiles(profileName, scope)
        .map(profile => {
            const currentState =
                getActualState(profile.name, keyDay);
            const isDiurnoLongCoverage =
                isDiurnoLongCoverageCandidate(
                    profile,
                    currentState,
                    neededTurn,
                    date,
                    holidays
                );
            const overtimeHours = isDiurnoLongCoverage
                ? diurnoLongCoverageHours(date)
                : isHalfAfternoonCoverage
                    ? halfAdminAfternoonCoverageHours(
                        currentState,
                        date
                    )
                    : null;
            const stats = calcularHorasMesPerfil(
                profile.name,
                y,
                m,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );
            const hheeDiurnas = Number(stats.hheeDiurnas) || 0;
            const hheeNocturnas = Number(stats.hheeNocturnas) || 0;
            const blockedDay =
                getBlockedDayForProfile(profile.name, keyDay);

            return {
                profile,
                currentState,
                isFree: currentState === 0,
                isDiurnoLongCoverage,
                overtimeHours,
                isForced:
                    !profileCanCoverProfile(profile, baseProfile),
                blockedDay,
                hheeDiurnas,
                hheeNocturnas,
                hhee: hheeDiurnas + hheeNocturnas
            };
        })
        .filter(candidate =>
            !workerHasAbsence(candidate.profile.name, keyDay) &&
            !cededSwapTurnBlocks(
                candidate.profile.name,
                keyDay,
                neededTurn
            ) &&
            canCoverShift(
                candidate.currentState,
                neededTurn,
                getTurnChangeConfig(),
                {
                    allowDiurnoLongCoverage:
                        candidate.isDiurnoLongCoverage
                }
            )
        )
        .sort((a, b) => {
            if (a.isDiurnoLongCoverage !== b.isDiurnoLongCoverage) {
                return a.isDiurnoLongCoverage ? 1 : -1;
            }

            if (Boolean(a.blockedDay) !== Boolean(b.blockedDay)) {
                return a.blockedDay ? 1 : -1;
            }

            if (a.isFree !== b.isFree) {
                return a.isFree ? -1 : 1;
            }

            if (a.hhee !== b.hhee) {
                return a.hhee - b.hhee;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function replacementDialogHTML({
    profileName,
    keyDay,
    neededTurn,
    absenceType,
    candidates,
    scope,
    requestMode,
    pendingRequests,
    selectedRequestWorkers,
    linkedStatus = ""
}) {
    const replacementConfig = getReplacementRequestConfig();
    const allowLinkedSuggestions =
        replacementConfig.enableLinkedUnitSuggestions !== false;
    const allowCrossRoleSuggestions =
        replacementConfig.enableCrossRoleSuggestions !== false;
    const allowWorkerAcceptanceRequest =
        replacementConfig.enableWorkerAcceptanceRequest !== false;
    const forceMode =
        allowCrossRoleSuggestions && scope === "all-local";
    const linkedMode =
        allowLinkedSuggestions && scope === "linked";
    const isRequestMode =
        allowWorkerAcceptanceRequest &&
        !linkedMode &&
        requestMode;
    const pendingByWorker = new Map(
        (pendingRequests || []).map(request => [request.worker, request])
    );
    const selectedWorkers =
        selectedRequestWorkers || new Set();
    const availableWorkers = candidates
        .filter(candidate => !pendingByWorker.get(candidate.profile.name))
        .map(candidate => candidate.profile.name);
    const selectedCount = availableWorkers.filter(worker =>
        selectedWorkers.has(worker)
    ).length;
    const allSelected =
        Boolean(availableWorkers.length) &&
        selectedCount === availableWorkers.length;
    const items = candidates.length
        ? candidates.map(candidate => {
            const pendingRequest =
                pendingByWorker.get(candidate.profile.name);
            const checked =
                selectedWorkers.has(candidate.profile.name);
            const warning = replacementCandidateWarning(candidate);

            if (isRequestMode) {
                return `
                <label class="replacement-candidate replacement-candidate--request ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${pendingRequest ? "is-disabled" : ""}">
                    <input
                        class="replacement-candidate-checkbox"
                        type="checkbox"
                        data-request-worker="${escapeHTML(candidate.profile.name)}"
                        ${replacementCandidateCoverageAttrs(candidate)}
                        ${checked ? "checked" : ""}
                        ${pendingRequest ? "disabled" : ""}
                    >
                    <span>
                        <strong>${escapeHTML(candidate.profile.name)}</strong>
                        <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                        ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                        <small>${pendingRequest ? "Solicitud pendiente" : candidate.isFree ? "Libre ese dia" : `Turno actual: ${escapeHTML(turnoReplacementLabel(candidate.currentState))}`}</small>
                        ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                    </span>
                    <span>
                        ${pendingRequest ? "<em>Pendiente</em>" : ""}
                        ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                        ${candidate.isForced ? "<em>Forzado</em>" : ""}
                        ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                        <b>${formatCandidateHours(candidate.hhee)} HHEE</b>
                        <small class="replacement-candidate-hours">
                            D: ${formatCandidateHours(candidate.hheeDiurnas)}h · N: ${formatCandidateHours(candidate.hheeNocturnas)}h
                        </small>
                    </span>
                </label>
                `;
            }

            return `
            <button
                class="replacement-candidate ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.isLinked ? "replacement-candidate--linked" : ""} ${candidate.blockedDay ? "replacement-candidate--worker-blocked" : ""} ${pendingRequest ? "is-disabled" : ""}"
                type="button"
                data-worker="${escapeHTML(candidate.profile.name)}"
                data-worker-profile-id="${escapeHTML(candidate.profile.id || "")}"
                data-worker-workspace-id="${escapeHTML(candidate.workspaceId || "")}"
                data-worker-workspace-name="${escapeHTML(candidate.workspaceName || "")}"
                data-worker-link-id="${escapeHTML(candidate.linkId || "")}"
                ${replacementCandidateCoverageAttrs(candidate)}
                ${pendingRequest ? "disabled" : ""}
            >
                <span>
                    <strong>${escapeHTML(candidate.profile.name)}</strong>
                    <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                    ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                    <small>${pendingRequest ? "Solicitud pendiente" : candidate.isFree ? "Libre ese dia" : `Turno actual: ${escapeHTML(turnoReplacementLabel(candidate.currentState))}`}</small>
                    ${warning ? `<small class="replacement-candidate-warning">${escapeHTML(warning)}</small>` : ""}
                </span>
                <span>
                    ${pendingRequest ? "<em>Pendiente</em>" : ""}
                    ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                    ${candidate.isForced ? "<em>Forzado</em>" : ""}
                    ${candidate.blockedDay ? "<em>Dia bloqueado</em>" : ""}
                    <b>${formatCandidateHours(candidate.hhee)} HHEE</b>
                    <small class="replacement-candidate-hours">
                        D: ${formatCandidateHours(candidate.hheeDiurnas)}h · N: ${formatCandidateHours(candidate.hheeNocturnas)}h
                    </small>
                </span>
            </button>
            `;
        }).join("")
        : `
            <div class="empty-state empty-state--compact">
                ${escapeHTML(
                    linkedMode && linkedStatus
                        ? linkedStatus
                        : "No hay trabajadores disponibles para este reemplazo."
                )}
            </div>
        `;
    const pendingList = (pendingRequests || []).length
        ? `
            <div class="replacement-request-list">
                ${(pendingRequests || []).map(request => `
                    <article class="replacement-request-item">
                        <span>
                            <strong>${escapeHTML(request.worker)}</strong>
                            <small>Caduca: ${escapeHTML(new Date(request.expiresAt).toLocaleString("es-CL"))}</small>
                        </span>
                        <button class="ghost-button" type="button" data-cancel-request="${escapeHTML(request.id)}">
                            Anular
                        </button>
                    </article>
                `).join("")}
            </div>
        `
        : "";
    const bulkActions = isRequestMode
        ? `
            <div class="replacement-bulk-actions">
                <label>
                    <input type="checkbox" data-action="select-all-requests" ${allSelected ? "checked" : ""} ${availableWorkers.length ? "" : "disabled"}>
                    <span>Enviar solicitud a todos</span>
                </label>
                <button class="primary-button" type="button" data-action="send-selected-requests" ${selectedCount ? "" : "disabled"}>
                    Enviar a seleccionados (${selectedCount})
                </button>
            </div>
        `
        : "";
    const toolbarButtons = [
        allowCrossRoleSuggestions
            ? `
                <button class="secondary-button" type="button" data-action="toggle-force">
                    ${forceMode
                        ? "Volver a profesiones/estamentos compatibles"
                        : "Mostrar personal de otras profesiones y/o estamentos"
                    }
                </button>
            `
            : "",
        allowLinkedSuggestions
            ? `
                <button class="ghost-button" type="button" data-action="linked-units">
                    ${linkedMode
                        ? "Volver a personal de esta unidad"
                        : "Buscar sugerencias en unidades enlazadas"
                    }
                </button>
            `
            : ""
    ].filter(Boolean).join("");

    return `
        <div class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacementDialogTitle">
            <strong id="replacementDialogTitle">Seleccionar reemplazo</strong>
            <p>
                ${escapeHTML(profileName)} requiere cobertura para ${escapeHTML(turnoReplacementLabel(neededTurn))}
                por ${escapeHTML(absenceType)}.
            </p>
            ${toolbarButtons ? `
                <div class="replacement-dialog-toolbar">
                    ${toolbarButtons}
                </div>
            ` : ""}
            ${linkedMode ? `
                <div class="replacement-dialog-note">
                    Sugerencias de unidades enlazadas activas: se muestran trabajadores compatibles y disponibles segun su unidad. Al asignar, se registra como prestamo en ambos entornos.
                </div>
            ` : allowWorkerAcceptanceRequest ? `
            <label class="replacement-request-toggle">
                <input type="checkbox" data-action="request-mode" ${isRequestMode ? "checked" : ""}>
                <span>
                    <strong>Solicitar aceptacion al trabajador</strong>
                </span>
            </label>
            ` : ""}
            ${bulkActions}
            ${pendingList}
            ${forceMode ? `
                <div class="replacement-dialog-note">
                    Modo forzado activo: se muestran trabajadores disponibles aunque no coincidan por profesion o estamento.
                </div>
            ` : ""}
            <div class="replacement-candidate-list">
                ${items}
            </div>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

async function openReplacementDialog(profileName, keyDay) {
    const existing = getReplacementForCoveredShift(
        profileName,
        keyDay
    );

    if (existing || window.selectionMode) {
        return;
    }

    const neededTurn = getReplacementNeededTurn(
        profileName,
        keyDay
    );

    if (!neededTurn) {
        return;
    }

    const absenceType =
        getAbsenceLabelForProfileDate(profileName, keyDay);
    let scope = "compatible";
    let requestMode = false;
    let selectedRequestWorkers = new Set();
    const normalizeReplacementDialogState = () => {
        const replacementConfig = getReplacementRequestConfig();

        if (
            scope === "linked" &&
            replacementConfig.enableLinkedUnitSuggestions === false
        ) {
            scope = "compatible";
        }

        if (
            scope === "all-local" &&
            replacementConfig.enableCrossRoleSuggestions === false
        ) {
            scope = "compatible";
        }

        if (
            scope === "linked" ||
            replacementConfig.enableWorkerAcceptanceRequest === false
        ) {
            requestMode = false;
            selectedRequestWorkers = new Set();
        }
    };
    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";

    const saveLinkedUnitReplacement = async button => {
        const workerWorkspaceId =
            button.dataset.workerWorkspaceId || "";
        const workerWorkspaceName =
            button.dataset.workerWorkspaceName || "";
        const workerProfileId =
            button.dataset.workerProfileId || "";
        const linkId = button.dataset.workerLinkId || "";
        const worker = button.dataset.worker || "";
        const activeWorkspace = getActiveWorkspace();
        const replacedProfile = getProfiles().find(profile =>
            profile.name === profileName
        );

        if (
            !workerWorkspaceId ||
            !workerProfileId ||
            !worker ||
            !activeWorkspace?.id
        ) {
            throw new Error(
                "No se pudo identificar la unidad enlazada del trabajador."
            );
        }

        const result = await createInterUnitLoan({
            linkId,
            sourceWorkspaceId: workerWorkspaceId,
            hostWorkspaceId: activeWorkspace?.id || "",
            workerProfileId,
            replacedProfileId: replacedProfile?.id || "",
            replacedProfileName: profileName,
            date: keyToISODate(keyDay),
            turnCode: turnoToCode(neededTurn),
            absenceType,
        });

        saveReplacement({
            id: `interunit_${result.loanId}`,
            interUnitLoanId: result.loanId,
            worker,
            replaced: profileName,
            keyDay,
            turno: neededTurn,
            absenceType,
            source: "inter_unit_loan",
            isLoan: true,
            workerWorkspaceId,
            workerWorkspaceName,
            hostWorkspaceId: activeWorkspace?.id || "",
            hostWorkspaceName: activeWorkspace?.name || "",
        });
    };

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    const bindActions = () => {
        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = close;

        const toggleForceButton =
            backdrop.querySelector("[data-action='toggle-force']");
        if (toggleForceButton) {
            toggleForceButton.onclick = async () => {
                scope = scope === "all-local"
                    ? "compatible"
                    : "all-local";
                await renderContent();
            };
        }

        const linkedUnitsButton =
            backdrop.querySelector("[data-action='linked-units']");
        if (linkedUnitsButton) {
            linkedUnitsButton.onclick = async () => {
                scope = scope === "linked"
                    ? "compatible"
                    : "linked";
                requestMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const requestToggle =
            backdrop.querySelector("[data-action='request-mode']");
        if (requestToggle) {
            requestToggle.onchange = async () => {
                requestMode = requestToggle.checked;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const updateBulkControls = () => {
            const inputs = [
                ...backdrop.querySelectorAll("[data-request-worker]")
            ];
            const availableInputs = inputs.filter(input =>
                !input.disabled
            );
            const selectedCount = availableInputs.filter(input =>
                input.checked
            ).length;
            const selectAll =
                backdrop.querySelector("[data-action='select-all-requests']");
            const sendButton =
                backdrop.querySelector("[data-action='send-selected-requests']");

            if (selectAll) {
                selectAll.checked =
                    Boolean(availableInputs.length) &&
                    selectedCount === availableInputs.length;
            }

            if (sendButton) {
                sendButton.disabled = selectedCount === 0;
                sendButton.textContent =
                    `Enviar a seleccionados (${selectedCount})`;
            }
        };

        backdrop
            .querySelectorAll("[data-request-worker]")
            .forEach(input => {
                input.onchange = () => {
                    if (input.checked) {
                        selectedRequestWorkers.add(
                            input.dataset.requestWorker
                        );
                    } else {
                        selectedRequestWorkers.delete(
                            input.dataset.requestWorker
                        );
                    }

                    updateBulkControls();
                };
            });

        const selectAllRequests =
            backdrop.querySelector("[data-action='select-all-requests']");
        if (selectAllRequests) {
            selectAllRequests.onchange = () => {
                backdrop
                    .querySelectorAll("[data-request-worker]")
                    .forEach(input => {
                        if (input.disabled) return;

                        input.checked = selectAllRequests.checked;

                        if (input.checked) {
                            selectedRequestWorkers.add(
                                input.dataset.requestWorker
                            );
                        } else {
                            selectedRequestWorkers.delete(
                                input.dataset.requestWorker
                            );
                        }
                    });

                updateBulkControls();
            };
        }

        const sendSelectedRequests =
            backdrop.querySelector("[data-action='send-selected-requests']");
        if (sendSelectedRequests) {
            sendSelectedRequests.onclick = async () => {
                const selectedInputs = [
                    ...backdrop.querySelectorAll("[data-request-worker]")
                ].filter(input =>
                    input.checked &&
                    selectedRequestWorkers.has(
                        input.dataset.requestWorker
                    )
                );
                const workers = selectedInputs.map(input =>
                    input.dataset.requestWorker
                );
                const diurnoLongInputs = selectedInputs.filter(input =>
                    input.dataset.diurnoLongCoverage === "true"
                );
                const workerCoverage = Object.fromEntries(
                    selectedInputs.map(input => [
                        input.dataset.requestWorker,
                        replacementCoverageFromDataset(input.dataset)
                    ])
                );

                if (!workers.length) {
                    alert("Selecciona al menos un trabajador para enviar la solicitud.");
                    return;
                }

                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Crear solicitud masiva de reemplazo");
                }

                const requests = createReplacementRequests(
                    {
                        replaced: profileName,
                        keyDay,
                        turno: neededTurn,
                        absenceType,
                        scope,
                        source: scope === "all-local"
                            ? "forced_replacement_request"
                            : "replacement_request",
                        diurnoLongCoverageWorkers:
                            diurnoLongInputs.map(input =>
                                input.dataset.requestWorker
                            ),
                        diurnoLongCoverageHours:
                            replacementCoverageFromDataset(
                                diurnoLongInputs[0]?.dataset
                            ).overtimeHours,
                        workerCoverage
                    },
                    workers
                );
                const whatsappRequests = requests.filter(request =>
                    request.channel === "whatsapp"
                );
                const missingPhones = whatsappRequests.filter(request =>
                    !buildReplacementRequestWhatsAppUrl(request)
                );

                whatsappRequests
                    .map(buildReplacementRequestWhatsAppUrl)
                    .filter(Boolean)
                    .forEach(url => {
                        window.open(url, "_blank", "noopener");
                    });

                if (missingPhones.length) {
                    alert(
                        `${missingPhones.length} solicitud(es) quedaron pendientes, pero sin celular registrado para preparar WhatsApp.`
                    );
                }

                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        backdrop
            .querySelectorAll("[data-cancel-request]")
            .forEach(button => {
                button.onclick = async () => {
                    cancelReplacementRequest(
                        button.dataset.cancelRequest,
                        "admin"
                    );
                    await renderContent();
                };
            });

        backdrop
            .querySelectorAll("[data-worker]")
            .forEach(button => {
                button.onclick = async () => {
                    if (button.disabled) return;

                    await withBusyState(async () => {
                        if (typeof window.pushUndoState === "function") {
                            window.pushUndoState(
                                requestMode
                                    ? "Crear solicitud de reemplazo"
                                    : "Asignar reemplazo"
                            );
                        }

                        if (
                            requestMode &&
                            getReplacementRequestConfig()
                                .enableWorkerAcceptanceRequest !== false
                        ) {
                            const request = createReplacementRequest({
                                worker: button.dataset.worker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                scope,
                                source: scope === "all-local"
                                    ? "forced_replacement_request"
                                    : "replacement_request",
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                            const whatsappUrl =
                                buildReplacementRequestWhatsAppUrl(request);

                            if (request.channel === "whatsapp") {
                                if (whatsappUrl) {
                                    window.open(
                                        whatsappUrl,
                                        "_blank",
                                        "noopener"
                                    );
                                } else {
                                    alert(
                                        "La solicitud quedo pendiente, pero este trabajador no tiene celular registrado para preparar el WhatsApp."
                                    );
                                }
                            }

                            await renderContent();
                            return;
                        }

                        if (button.dataset.workerWorkspaceId) {
                            await saveLinkedUnitReplacement(button);
                        } else {
                            saveReplacement({
                                worker: button.dataset.worker,
                                replaced: profileName,
                                keyDay,
                                turno: neededTurn,
                                absenceType,
                                source: scope === "all-local"
                                    ? "forced_replacement"
                                    : "replacement",
                                ...replacementCoverageFromDataset(
                                    button.dataset
                                )
                            });
                        }

                        close();
                        await renderCalendar();
                        refreshStaffingAnalysisPanel();
                    }, {
                        label: requestMode
                            ? "Creando solicitud..."
                            : "Guardando reemplazo..."
                    });
                };
            });
    };

    const renderContent = async () => withBusyState(async () => {
        normalizeReplacementDialogState();
        expireReplacementRequests();

        const candidates =
            await getReplacementCandidates(
                profileName,
                keyDay,
                { scope }
            );
        const pendingRequests =
            getPendingReplacementRequestsForShift(
                profileName,
                keyDay,
                neededTurn
            );
        const pendingWorkers = new Set(
            pendingRequests.map(request => request.worker)
        );
        const selectableWorkers = new Set(
            candidates
                .map(candidate => candidate.profile.name)
                .filter(worker => !pendingWorkers.has(worker))
        );

        selectedRequestWorkers = new Set(
            [...selectedRequestWorkers].filter(worker =>
                selectableWorkers.has(worker)
            )
        );

        backdrop.innerHTML = replacementDialogHTML({
            profileName,
            keyDay,
            neededTurn,
            absenceType,
            candidates,
            scope,
            requestMode,
            pendingRequests,
            selectedRequestWorkers,
            linkedStatus: scope === "linked"
                ? linkedReplacementStatus
                : ""
        });

        bindActions();

        (
            backdrop.querySelector(".replacement-candidate") ||
            backdrop.querySelector("[data-action='cancel']")
        )?.focus();
    }, {
        label: "Calculando sugerencias..."
    });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    await renderContent();
}

window.openReplacementDialog = openReplacementDialog;

function getExtraReasonMatches(
    profileName,
    keyDay,
    pendingTurn
) {
    return sameRoleProfiles(profileName)
        .map(profile => {
            const coveredTurn = getReplacementNeededTurn(
                profile.name,
                keyDay
            );

            return {
                profile,
                coveredTurn,
                absenceType:
                    getAbsenceLabelForProfileDate(
                        profile.name,
                        keyDay
                    ),
                exactMatch:
                    Number(coveredTurn) === Number(pendingTurn)
            };
        })
        .filter(match =>
            workerHasAbsence(match.profile.name, keyDay) &&
            !getReplacementForCoveredShift(
                match.profile.name,
                keyDay
            ) &&
            turnoExtraCubreTurno(
                pendingTurn,
                match.coveredTurn
            )
        )
        .sort((a, b) => {
            if (a.exactMatch !== b.exactMatch) {
                return a.exactMatch ? -1 : 1;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function getManualBackupSections(pendingTurn, matchesByTurn) {
    return getTurnoComponentes(pendingTurn)
        .map(component => {
            const turn = turnoDesdeComponentes([component]);

            return {
                id: component,
                turn,
                label: turnoReplacementLabel(turn),
                matches: matchesByTurn.get(turn) || []
            };
        })
        .filter(section => section.turn);
}

function formatClockHoursForDialog(hours) {
    const d = Math.round((Number(hours?.d) || 0) * 2) / 2;
    const n = Math.round((Number(hours?.n) || 0) * 2) / 2;
    const parts = [];

    if (d) parts.push(`${d}h diurnas`);
    if (n) parts.push(`${n}h nocturnas`);

    return parts.length ? parts.join(" / ") : "0h";
}

function extraReasonDialogHTML({
    profileName,
    pendingTurn,
    manualSections,
    clockHours,
    hasClockSection
}) {
    const hasManualSection = Boolean(pendingTurn);
    const hasMultipleManualSections =
        (manualSections || []).length > 1;
    const savesMultipleBackups =
        hasMultipleManualSections ||
        (hasClockSection && hasManualSection);
    const manualItems = (manualSections || [])
        .map(section => {
            const items = section.matches.length
                ? section.matches.map((match, index) => `
                    <button
                        class="replacement-candidate"
                        type="button"
                        data-section-id="${escapeHTML(section.id)}"
                        data-match-index="${index}"
                    >
                        <span>
                            <strong>${escapeHTML(match.profile.name)}</strong>
                            <small>${escapeHTML(match.absenceType)} | ${escapeHTML(turnoReplacementLabel(match.coveredTurn))}</small>
                        </span>
                        <span>${match.exactMatch ? "Coincide" : "Parcial"}</span>
                    </button>
                `).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        No hay vacaciones o licencias compatibles con este tramo.
                    </div>
                `;

            return `
                <div class="overtime-backup-subsection" data-manual-section="${escapeHTML(section.id)}">
                    <div class="overtime-backup-subsection__head">
                        <span>${escapeHTML(section.label)}</span>
                    </div>
                    <div class="replacement-candidate-list">
                        ${items}
                    </div>
                    <label class="extra-reason-field">
                        <span>Motivo manual para ${escapeHTML(section.label)}</span>
                        <textarea rows="3" data-manual-reason="${escapeHTML(section.id)}" placeholder="Ej: Campana de Invierno, Estacion de Trabajo"></textarea>
                    </label>
                </div>
            `;
        })
        .join("");
    const clockSection = hasClockSection
        ? `
            <section class="overtime-backup-section" data-section="clock">
                <div class="overtime-backup-section__head">
                    <span>Horas por marcaje modificado</span>
                    <small>${formatClockHoursForDialog(clockHours)}</small>
                </div>
                <p>
                    Respalda las horas extras generadas por modificar la entrada
                    o salida del turno.
                </p>
                <label class="extra-reason-field">
                    <span>Motivo del marcaje</span>
                    <textarea rows="3" data-clock-reason placeholder="Ej: Apoyo previo al turno, continuidad de atencion, emergencia del servicio"></textarea>
                </label>
            </section>
        `
        : "";
    const manualSection = hasManualSection
        ? `
            <section class="overtime-backup-section" data-section="manual">
                <div class="overtime-backup-section__head">
                    <span>Turno extra agregado</span>
                    <small>${turnoReplacementLabel(pendingTurn)}</small>
                </div>
                <p>
                    Puedes asociar cada tramo a una ausencia compatible o escribir
                    un motivo manual por separado.
                </p>
                ${manualItems}
            </section>
        `
        : "";

    return `
        <div class="turn-change-dialog replacement-dialog extra-reason-dialog overtime-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="extraReasonDialogTitle">
            <strong id="extraReasonDialogTitle">Respaldar horas extras</strong>
            <p>
                ${profileName} tiene horas extras pendientes de respaldo.
                Completa ${savesMultipleBackups ? "las secciones" : "el motivo"} para validar el pago.
            </p>
            ${clockSection}
            ${manualSection}
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-action="save-reason">
                    ${savesMultipleBackups ? "Guardar respaldos" : "Guardar motivo"}
                </button>
            </div>
        </div>
    `;
}

async function openExtraReasonDialog(
    profileName,
    keyDay,
    pendingTurn,
    options = {}
) {
    if ((!pendingTurn && !options.forceClock) || window.selectionMode) {
        return;
    }

    const profileData = getProfileData(profileName);
    const actualState = options.state ||
        aplicarCambiosTurno(
            profileName,
            keyDay,
            getTurnoProgramado(profileName, keyDay)
        );
    const [year, month, day] = String(keyDay)
        .split("-")
        .map(Number);
    const date = new Date(year, month, day);
    const holidays = await fetchHolidays(year);
    const hasClockSection =
        hasClockExtra(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        ) &&
        !getClockExtraBackupForWorker(profileName, keyDay);
    const clockHours = hasClockSection
        ? getClockExtraHours(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        )
        : null;

    if (!pendingTurn && !hasClockSection) {
        return;
    }

    const matchesByTurn = new Map();
    const manualSections = pendingTurn
        ? getManualBackupSections(pendingTurn, matchesByTurn)
        : [];

    if (pendingTurn) {
        manualSections.forEach(section => {
            const matches = getExtraReasonMatches(
                profileName,
                keyDay,
                section.turn
            );

            matchesByTurn.set(section.turn, matches);
            section.matches = matches;
        });
    }

    const backdrop = document.createElement("div");
    const selectedMatches = new Map();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = extraReasonDialogHTML({
        profileName,
        pendingTurn,
        manualSections,
        clockHours,
        hasClockSection
    });

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    const saveBackups = async () => {
        const clockReason = backdrop
            .querySelector("[data-clock-reason]")
            ?.value
            .trim() || "";
        const manualBackups = manualSections.map(section => {
            const selectedIndex = selectedMatches.get(section.id);
            const selectedMatch = selectedIndex !== undefined
                ? section.matches[selectedIndex]
                : null;
            const reason = backdrop
                .querySelector(`[data-manual-reason="${section.id}"]`)
                ?.value
                .trim() || "";

            return {
                section,
                selectedMatch,
                reason
            };
        });
        const missingManualBackup = manualBackups.find(backup =>
            !backup.selectedMatch && !backup.reason
        );

        if (hasClockSection && !clockReason) {
            alert("Indica el motivo de las horas extras generadas por el marcaje.");
            backdrop.querySelector("[data-clock-reason]")?.focus();
            return;
        }

        if (pendingTurn && missingManualBackup) {
            alert(`Selecciona una ausencia compatible o escribe el motivo del turno ${missingManualBackup.section.label}.`);
            backdrop
                .querySelector(`[data-manual-reason="${missingManualBackup.section.id}"]`)
                ?.focus();
            return;
        }

        if (typeof window.pushUndoState === "function") {
            window.pushUndoState("Respaldar horas extras");
        }

        if (hasClockSection) {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: actualState,
                reason: clockReason,
                absenceType: "Marcaje reloj control",
                source: "clock_extra",
                addsShift: false,
                clockLabel: "Marcaje reloj control",
                clockHours
            });
        }

        manualBackups.forEach(backup => {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: backup.selectedMatch
                    ? backup.selectedMatch.coveredTurn
                    : backup.section.turn,
                replaced: backup.selectedMatch?.profile.name || "",
                reason: backup.selectedMatch ? "" : backup.reason,
                absenceType: backup.selectedMatch
                    ? backup.selectedMatch.absenceType
                    : "Motivo manual",
                source: "manual_extra",
                addsShift: false
            });
        });

        close();
        await renderCalendar();
        refreshStaffingAnalysisPanel();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelectorAll("[data-match-index]")
        .forEach(button => {
            button.onclick = () => {
                const sectionId = button.dataset.sectionId;

                selectedMatches.set(
                    sectionId,
                    Number(button.dataset.matchIndex)
                );

                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        const selected =
                            Number(item.dataset.matchIndex) ===
                            selectedMatches.get(sectionId);

                        item.classList.toggle("is-selected", selected);
                        item.setAttribute(
                            "aria-pressed",
                            selected ? "true" : "false"
                        );
                    });

                const manualTextarea = backdrop
                    .querySelector(`[data-manual-reason="${sectionId}"]`);

                if (manualTextarea) {
                    manualTextarea.value = "";
                }
            };
        });

    backdrop
        .querySelectorAll("[data-manual-reason]")
        .forEach(textarea => {
            textarea.addEventListener("input", event => {
                if (!event.target.value.trim()) return;

                const sectionId = event.target.dataset.manualReason;

                selectedMatches.delete(sectionId);
                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        item.classList.remove("is-selected");
                        item.setAttribute("aria-pressed", "false");
                    });
            });
        });

    backdrop
        .querySelector("[data-action='save-reason']")
        .onclick = saveBackups;

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    (
        backdrop.querySelector("[data-clock-reason]") ||
        backdrop.querySelector("[data-match-index]") ||
        backdrop.querySelector("[data-manual-reason]")
    )?.focus();
}

window.openExtraReasonDialog = openExtraReasonDialog;

async function openClockExtraReasonDialog(
    profileName,
    keyDay,
    state
) {
    return openExtraReasonDialog(profileName, keyDay, 0, {
        forceClock: true,
        state
    });
}

window.openClockExtraReasonDialog = openClockExtraReasonDialog;

async function clickDia(
    keyDay,
    state,
    isHab,
    data,
    admin,
    legal,
    comp,
    absences,
    options = {}
) {
    if (
        typeof window.workspaceCanEditTarget === "function" &&
        !window.workspaceCanEditTarget("calendarPanel")
    ) {
        return true;
    }

    if (!isProfileActive(getCurrentProfile())) {
        alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
        return true;
    }

    const turnChange =
        getCambioTurnoCalendario(getCurrentProfile(), keyDay)?.swap;

    if (turnChange) {
        return handleTurnChangeDayClick(turnChange);
    }

    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    const replacementNeededTurn =
        getReplacementNeededTurn(getCurrentProfile(), keyDay);
    const needsReplacement =
        Boolean(replacementNeededTurn) &&
        requiereReemplazoTurnoBase(
            keyDay,
            getTurnoBase(getCurrentProfile(), keyDay),
            admin,
            legal,
            comp,
            absences
        ) &&
        !getReplacementForCoveredShift(
            getCurrentProfile(),
            keyDay
        );

    if (needsReplacement) {
        return openReplacementDialog(
            getCurrentProfile(),
            keyDay
        );
    }

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        openLeaveDetailDialog({
            profile: getCurrentProfile(),
            keyDay,
            admin,
            legal,
            comp,
            absences
        });
        return;
    }

    const directEditEnabled =
        typeof window.calendarDirectEditEnabled === "function"
            ? window.calendarDirectEditEnabled()
            : true;

    if (!directEditEnabled) {
        return;
    }

    const baseTurno = getTurnoBase(
        getCurrentProfile(),
        keyDay
    );
    const previewState = Number(
        options.cell?.dataset.directTurnState
    );
    const currentState = Number.isFinite(previewState)
        ? previewState
        : state;
    const nuevo = siguienteTurnoValido(
        getCurrentProfile(),
        keyDay,
        currentState,
        isHab,
        {
            baseTurno
        }
    );
    const effectiveBaseTurn = aplicarCambiosTurno(
        getCurrentProfile(),
        keyDay,
        baseTurno,
        { includeReplacements: false }
    );
    const manualExtra = Boolean(
        getShiftAssigned(
            getCurrentProfile(),
            options.date || dateFromKeyDay(keyDay)
        ) &&
        getTurnoExtraAgregado(effectiveBaseTurn, nuevo)
    );

    previewDirectTurnChange(
        options.cell,
        nuevo,
        options.date || dateFromKeyDay(keyDay),
        options.holidays || {},
        {
            profileName: getCurrentProfile(),
            keyDay,
            baseTurn: effectiveBaseTurn,
            manualExtra
        }
    );

    keepCalendarDirectEditHistoryOpen(
        `Edicion directa de turnos desde ${keyDay}`
    );
    if (Number(nuevo) !== Number(currentState)) {
        cancelManualExtraBackupsForTurnChange(
            getCurrentProfile(),
            keyDay,
            nuevo
        );
    }
    data[keyDay] = nuevo;
    saveProfileData(data);
    scheduleCalendarAuditLog({
        profile: getCurrentProfile(),
        keyDay,
        previousTurn: currentState,
        nextTurn: nuevo
    });
    scheduleCalendarDirectEditRefresh();
}

export async function renderCalendar(options = {}) {
    if (
        calendarDirectEditRefreshTimer &&
        options.allowDuringDirectEdit !== true
    ) {
        return;
    }

    const cal = document.getElementById("calendar");
    const monthYear = document.getElementById("monthYear");
    const renderRequest = ++calendarRenderRequest;

    if (!cal) return;

    const calendarPanel = cal.closest(".calendar-panel");
    const activeProfile = getCurrentProfile();
    const activeProfileEnabled =
        isProfileActive(activeProfile);
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();

    cal.classList.remove("has-multiple-badge-days");
    calendarPanel?.classList.remove("has-multiple-badge-days");

    if (monthYear) {
        monthYear.innerText = currentDate.toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        );
        setupCalendarMonthPicker(monthYear);
    }

    const holidays = await fetchHolidays(y);
    const first =
        (new Date(y, m, 1).getDay() + 6) % 7;
    const days =
        new Date(y, m + 1, 0).getDate();
    const draftKey =
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "";

    if (renderRequest !== calendarRenderRequest) return;

    const fragment = document.createDocumentFragment();
    let hasMultipleBadgeDays = false;

    for (let i = 0; i < first; i++) {
        const spacer = document.createElement("div");
        spacer.className = "calendar-spacer";
        fragment.appendChild(spacer);
    }

    if (!activeProfile) {
        for (let d = 1; d <= days; d++) {
            const keyDay = key(y, m, d);
            const date = new Date(y, m, d);

            const div = buildDayCell({
                day: d,
                month: m,
                year: y,
                keyDay,
                label: "",
                title: "Selecciona una fecha para la nueva rotativa.",
                isWeekendDay: isWeekend(date),
                isHoliday: Boolean(holidays[keyDay]),
                isDraftSelected: draftKey === keyDay
            });

            fragment.appendChild(div);
        }

        cal.replaceChildren(fragment);

        runCalendarHeavyUpdates(options);

        return;
    }

    const data = getProfileData();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const hourReturns = getHourReturns(activeProfile);
    const honorariaSummary = getHonorariaMonthlySummary(
        activeProfile,
        y,
        m,
        holidays
    );

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);
        const baseState = getTurnoBase(activeProfile, keyDay);
        const pendingLeaveRequest =
            getPendingLeaveRequestForDay(activeProfile, keyDay);
        const pendingLeaveLabel =
            pendingLeaveRequest
                ? pendingLeaveRequestLabel(pendingLeaveRequest.type)
                : "";
        const pendingLeaveBaseLabel =
            pendingLeaveRequest
                ? turnoLabel(baseState) || "Libre"
                : "";

        const state = aplicarCambiosTurno(
            activeProfile,
            keyDay,
            getTurnoProgramado(activeProfile, keyDay)
        );

        const date = new Date(y, m, d);
        const isWeekendDay = isWeekend(date);
        const isHoliday = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);

        const turnChangeMarkers =
            getCambiosTurnoCalendario(activeProfile, keyDay);
        const turnChangeMarker = turnChangeMarkers[0] || null;
        const shiftMoveMarkers =
            getShiftMoveMarkers(activeProfile, keyDay);
        const hourReturn = hourReturns[keyDay] || null;
        const label = hourReturn
            ? hourReturnCalendarLabel(hourReturn)
            : (
                pendingLeaveRequest
                    ? pendingLeaveLabel
                    : obtenerLabelDia(
                        keyDay,
                        state,
                        admin,
                        legal,
                        comp,
                        absences,
                        turnoLabel
                    )
            );
        const turnChange = turnChangeMarker?.swap || null;
        const coveredReplacement =
            getReplacementForCoveredShift(activeProfile, keyDay);
        const workerReplacement =
            getReplacementForWorkerShift(activeProfile, keyDay);
        const replacementContractError =
            isReplacementProfile(activeProfile) &&
            state > 0 &&
            !hasContractForDate(activeProfile, keyDay);
        const pendingManualExtra =
            getPendingManualExtraTurn(
                activeProfile,
                keyDay,
                data
            );
        const manualExtra = Boolean(
            getShiftAssigned(activeProfile, date) &&
            getManualExtraTurn(
                activeProfile,
                keyDay,
                data
            )
        );
        const severeClockIncident =
            hasSevereClockIncident(activeProfile, keyDay);
        const simpleClockIncident =
            !severeClockIncident &&
            hasSimpleClockIncident(activeProfile, keyDay);
        const clockExtra =
            hasClockExtra(
                activeProfile,
                keyDay,
                date,
                state,
                holidays
            );
        const showClockExtraReason =
            clockExtra &&
            !getClockExtraBackupForWorker(activeProfile, keyDay);
        const showTurnChangeBadge =
            Boolean(turnChange) &&
            state > 0 &&
            label === turnoLabel(state);
        const needsReplacement =
            requiereReemplazoTurnoBase(
                keyDay,
                baseState,
                admin,
                legal,
                comp,
                absences
            ) &&
            !coveredReplacement;
        const showExtraReason =
            !needsReplacement &&
            !turnChange &&
            !replacementContractError &&
            pendingManualExtra;
        const honorariaExcess =
            getHonorariaExcessForKey(
                honorariaSummary,
                keyDay
            );
        const showHonorariaLimitBadge =
            Boolean(honorariaExcess) &&
            !replacementContractError &&
            !severeClockIncident &&
            !needsReplacement;
        const badge = replacementContractError
            ? "X"
            : severeClockIncident
                ? "!!!"
                : needsReplacement
                    ? "!"
                    : showHonorariaLimitBadge
                        ? "!"
                    : showExtraReason || showClockExtraReason
                    ? "?"
                    : simpleClockIncident
                        ? "*"
                        : workerReplacement
                            ? (
                                workerReplacement.isLoan
                                    ? "Prestamo"
                                    : (workerReplacement.reason ? "Motivo" : "Reemplazo")
                            )
                            : (
                                turnChangeMarker?.label ||
                                (showTurnChangeBadge ? "CCTT" : "")
                            );
        const replacementTitle = workerReplacement
            ? (
                workerReplacement.replaced
                    ? `${workerReplacement.isLoan ? "Prestamo cubriendo a" : "Reemplazo de"} ${workerReplacement.replaced} por ${workerReplacement.absenceType || "ausencia"}.`
                    : `Motivo HHEE: ${workerReplacement.reason || workerReplacement.absenceType || "sin detalle"}.`
            )
            : "";
        const turnChangeTitle = Array.from(new Set(
            turnChangeMarkers
                .map(marker => turnChangeHoverTitle(marker, activeProfile))
                .filter(Boolean)
        )).join("\n\n");
        const shiftMoveTitle = Array.from(new Set(
            shiftMoveMarkers
                .map(shiftMoveHoverTitle)
                .filter(Boolean)
        )).join("\n\n");
        const workerBlockedDay =
            getBlockedDayForProfile(activeProfile, keyDay);
        const calendarBadges =
            Array.from(new Set([
                ...(pendingLeaveRequest ? ["Pend."] : []),
                ...(workerBlockedDay ? ["No disp."] : []),
                ...turnChangeMarkers.map(marker => marker.label),
                ...shiftMoveMarkers.map(marker => marker.label)
            ]));

        if (calendarBadges.length > 1) {
            hasMultipleBadgeDays = true;
        }

        const div = buildDayCell({
            day: d,
            month: m,
            year: y,
            keyDay,
            label,
            alternateLabel: pendingLeaveRequest
                ? pendingLeaveBaseLabel
                : "",
            badge,
            badges: calendarBadges.length
                ? calendarBadges
                : undefined,
            title: (() => {
                const hrs = calcHours(date, state, holidays);
                const leaveTitle = leaveApplicationHoverTitle(
                    activeProfile,
                    keyDay,
                    admin,
                    legal,
                    comp,
                    absences
                );

                const suffix = needsReplacement
                    ? " | Requiere reemplazo de turno base"
                    : workerBlockedDay
                        ? ` | ${workerBlockedDay.message}`
                    : honorariaExcess
                        ? ` | ${getHonorariaLimitMessage(honorariaSummary)}`
                    : showExtraReason
                        ? " | Requiere motivo de horas extras"
                        : showClockExtraReason
                            ? " | Requiere motivo por horas extras de marcaje"
                            : severeClockIncident
                                ? " | Incidencia grave de marcaje"
                                : simpleClockIncident
                                    ? " | Incidencia de marcaje"
                        : replacementContractError
                            ? " | No tiene contrato vigente en la fecha seleccionada"
                            : "";

                const baseTitle = (() => {
                    if (!activeProfileEnabled) {
                        return "Perfil desactivado: calendario solo lectura.";
                    }

                    if (showExtraReason) {
                        return `Diurnas: ${hrs.d} | Nocturnas: ${hrs.n}${suffix}`;
                    }

                    if (replacementContractError) {
                        return "No tiene contrato vigente en la fecha seleccionada.";
                    }

                    return replacementTitle ||
                        `Diurnas: ${hrs.d} | Nocturnas: ${hrs.n}${suffix}`;
                })();

                return [
                    pendingLeaveHoverTitle(
                        pendingLeaveRequest,
                        activeProfile,
                        keyDay,
                        baseState
                    ),
                    turnChangeTitle,
                    shiftMoveTitle,
                    baseTitle,
                    leaveTitle
                ].filter(Boolean).join("\n");
            })(),
            isWeekendDay,
            isHoliday: Boolean(isHoliday),
            isDraftSelected:
                draftKey === keyDay ||
                (
                    window.selectionMode === "moveshifttarget" &&
                    window.pendingShiftMoveSourceKey === keyDay
                )
        });

        if (turnChangeMarker) {
            div.classList.add("turn-change-day");
            div.dataset.swapId = String(
                turnChangeMarker.swap.id
            );
        }

        if (shiftMoveMarkers.length) {
            div.classList.add("shift-move-day");
        }

        if (workerBlockedDay) {
            div.classList.add("worker-blocked-day");
        }

        if (pendingLeaveRequest) {
            div.classList.add("pending-leave-request-day");
            div.dataset.workerRequestId = pendingLeaveRequest.id;
        }

        if (!activeProfileEnabled) {
            div.classList.add("inactive-profile-day");
        }

        if (needsReplacement) {
            div.classList.add("needs-replacement");
        }

        if (honorariaExcess) {
            div.classList.add("honoraria-limit-day");
        }

        if (showExtraReason) {
            div.classList.add("needs-extra-reason");
        }

        if (showClockExtraReason) {
            div.classList.add("needs-extra-reason");
            div.classList.add("clock-extra-day");
        }

        if (severeClockIncident) {
            div.classList.add("clock-severe-day");
        } else if (simpleClockIncident) {
            div.classList.add("clock-incident-day");
        }

        if (replacementContractError) {
            div.classList.add("contract-error-day");
        }

        if (workerReplacement) {
            div.classList.add("replacement-day");
        }

        if (manualExtra) {
            div.classList.add("manual-extra-day");
        }

        if (hourReturn) {
            div.classList.add("hours-return-day");
            if (!hourReturn.fullTurn) {
                div.classList.add("hours-return-day--partial");
            }
        }

        aplicarClasesEspeciales(
            div,
            keyDay,
            state,
            isHab,
            isWeekendDay,
            isHoliday,
            admin,
            legal,
            comp,
            absences,
            aplicarClaseTurno,
            getTurnoBase(activeProfile, keyDay),
            getDayColorGradient(
                activeProfile,
                keyDay,
                state,
                date,
                holidays,
                admin[keyDay],
                getTurnoBase(activeProfile, keyDay),
                {
                    unbasedComponentsAreExtra: manualExtra,
                    singleBandGradient: manualExtra
                }
            )
        );

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            (
                window.selectionMode === "admin" ||
                window.selectionMode === "hoursreturn" ||
                window.selectionMode === "moveshiftsource" ||
                window.selectionMode === "moveshifttarget"
            )
                ? getTurnoBase(activeProfile, keyDay)
                : state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            getShiftAssigned(activeProfile, date),
            {
                compCantidad: window.compCantidad || 0,
                legalCantidad: window.legalCantidad || 0,
                licenseCantidad: window.licenseCantidad || 0,
                licenseType: window.licenseType || "license",
                rotativa: getRotativa(activeProfile),
                holidays,
                hourReturns,
                actualState: state,
                moveShiftSourceKey:
                    window.pendingShiftMoveSourceKey || "",
                moveShiftDestinationTurn:
                    window.pendingShiftMoveDestinationTurn || 0,
                moveShiftProgrammedTurn:
                    getTurnoProgramado(activeProfile, keyDay)
            }
        );

        if (window.selectionMode || !activeProfileEnabled) {
            div.classList.add(
                bloqueado || !activeProfileEnabled
                    ? "mpa-disabled"
                    : "mpa-enabled"
            );
        }

        div.onclick = async event => {
            if (!activeProfileEnabled) {
                event.stopPropagation();
                alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
                return;
            }

            if (
                pendingLeaveRequest &&
                !window.selectionMode
            ) {
                event.stopPropagation();
                return openPendingLeaveRequestDialog({
                    request: pendingLeaveRequest,
                    profile: activeProfile,
                    keyDay,
                    baseState
                });
            }

            if (
                replacementContractError &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                window.startReplacementContractEdit?.(
                    activeProfile,
                    keyDay
                );
                return;
            }

            if (
                showHonorariaLimitBadge &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                alert(getHonorariaLimitMessage(honorariaSummary));
                return;
            }

            if (
                showExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    showExtraReason
                );
            }

            if (
                showClockExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openClockExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    state
                );
            }

            if (
                turnChange ||
                needsReplacement
            ) {
                event.stopPropagation();
            }

            await clickDia(
                keyDay,
                state,
                isHab,
                data,
                admin,
                legal,
                comp,
                absences,
                {
                    cell: div,
                    date,
                    holidays
                }
            );
        };

        fragment.appendChild(div);
    }

    cal.replaceChildren(fragment);
    cal.classList.toggle(
        "has-multiple-badge-days",
        hasMultipleBadgeDays
    );
    calendarPanel?.classList.toggle(
        "has-multiple-badge-days",
        hasMultipleBadgeDays
    );

    runCalendarHeavyUpdates(options, {
        profile: activeProfile,
        y,
        m,
        days,
        holidays,
        data
    });
}

function syncShellPanels(options = {}) {
    const sync = () => {
        if (
            options.navigationRequest &&
            options.navigationRequest !== calendarNavigationRequest
        ) {
            return;
        }

        if (
            document.body.dataset.activeView === "swap" &&
            typeof window.renderSwapPanel === "function"
        ) {
            window.renderSwapPanel();
        }

        if (typeof window.renderDashboardState === "function") {
            window.renderDashboardState();
        }
    };

    if (options.deferHeavy) {
        deferAfterPaint(sync);
        return;
    }

    sync();
}

export async function goToCalendarMonth(year, month, options = {}) {
    const navigationRequest = ++calendarNavigationRequest;
    const renderOptions = {
        ...options,
        deferHeavy: true,
        navigationRequest
    };

    cancelCalendarHeavyUpdates();
    cancelCalendarDirectEditRefresh();
    closeCalendarMonthPicker();
    currentDate.setFullYear(Number(year), Number(month), 1);
    await renderCalendar(renderOptions);

    if (navigationRequest !== calendarNavigationRequest) {
        return;
    }

    syncShellPanels(renderOptions);
}

export async function prevMonth(options = {}) {
    const target = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - 1,
        1
    );

    await goToCalendarMonth(
        target.getFullYear(),
        target.getMonth(),
        options
    );
}

export async function nextMonth(options = {}) {
    const target = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        1
    );

    await goToCalendarMonth(
        target.getFullYear(),
        target.getMonth(),
        options
    );
}
