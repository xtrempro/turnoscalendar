import { renderCalendar } from "./calendar.js";
import { renderTimeline } from "./timeline.js";
import { renderAuditLogPanel } from "./auditLog.js";
import {
    renderMemosPanel,
    updateMemosNavBadge
} from "./memos.js";
import { applyTurnoColors } from "./turnoColors.js";

let deferredDashboardTimer = 0;
let deferredDashboardUsesIdle = false;

function scheduleDashboardRefresh() {
    if (typeof window === "undefined") return;
    if (typeof window.renderDashboardState !== "function") return;

    if (deferredDashboardTimer) {
        if (
            deferredDashboardUsesIdle &&
            typeof window.cancelIdleCallback === "function"
        ) {
            window.cancelIdleCallback(deferredDashboardTimer);
        } else {
            clearTimeout(deferredDashboardTimer);
        }
    }
    deferredDashboardUsesIdle = false;

    const run = () => {
        deferredDashboardTimer = 0;

        if (
            document.body.dataset.activeView !== "dashboard" &&
            typeof window.renderDashboardState === "function"
        ) {
            window.renderDashboardState();
        }
    };

    if (typeof window.requestIdleCallback === "function") {
        deferredDashboardUsesIdle = true;
        deferredDashboardTimer = window.requestIdleCallback(run, {
            timeout: 8000
        });
        return;
    }

    deferredDashboardTimer = window.setTimeout(run, 3000);
}

export function refreshAll(){
    // Aplica los colores de turno configurados (variables CSS) antes de render.
    applyTurnoColors();

    const activeView =
        document.body.dataset.activeView || "turnos";

    if (activeView === "turnos") {
        renderCalendar({ deferHeavy: true });
    }

    if (activeView === "timeline") {
        renderTimeline();
    }

    if (
        activeView === "staffing" &&
        typeof window.renderStaffingAnalysis === "function"
    ) {
        window.renderStaffingAnalysis();
    }

    if (
        activeView === "swap" &&
        typeof window.renderSwapPanel === "function"
    ) {
        window.renderSwapPanel();
    }

    if (
        activeView === "dashboard" &&
        typeof window.renderDashboardState === "function"
    ) {
        window.renderDashboardState();
    } else {
        scheduleDashboardRefresh();
    }

    if (activeView === "log") {
        renderAuditLogPanel();
    }

    if (activeView === "memos") {
        renderMemosPanel();
    } else {
        updateMemosNavBadge();
    }

    if (
        activeView === "clockmarks" &&
        typeof window.renderClockMarksPanel === "function"
    ) {
        window.renderClockMarksPanel();
    }
}
