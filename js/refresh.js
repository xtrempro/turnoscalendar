import { renderCalendar } from "./calendar.js";
import { renderTimeline } from "./timeline.js";
import { renderAuditLogPanel } from "./auditLog.js";
import {
    renderMemosPanel,
    updateMemosNavBadge
} from "./memos.js";

export function refreshAll(){
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

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
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
