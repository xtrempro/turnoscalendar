// Mapeo entre "targets" (paneles con data-target) y "vistas" (data-activeView),
// y utilidades de navegacion por hash de URL. No dependen del estado de la app,
// solo del DOM y la URL actual.

/**
 * Vista (data-activeView) que corresponde a un target/panel dado.
 * @param {string} targetId
 * @returns {string}
 */
export function getViewForTarget(targetId) {
    if (targetId === "homePanel") {
        return "home";
    }

    if (
        targetId === "profileSection" ||
        targetId === "availabilitySummary"
    ) {
        return "profile";
    }

    if (targetId === "hoursPanel") {
        return "hours";
    }

    if (targetId === "turnChangesView") {
        return "swap";
    }

    if (targetId === "workerRequestsPanel") {
        return "requests";
    }

    if (targetId === "memosPanel") {
        return "memos";
    }

    if (targetId === "informationsPanel") {
        return "informations";
    }

    if (targetId === "medicalEquipmentPanel") {
        return "medicalEquipment";
    }

    if (targetId === "tendersPanel") {
        return "tenders";
    }

    if (targetId === "qualificationsPanel") {
        return "qualifications";
    }

    if (targetId === "reportsPanel") {
        return "reports";
    }

    if (targetId === "dashboardPanel") {
        return "dashboard";
    }

    if (targetId === "auditLogPanel") {
        return "log";
    }

    if (targetId === "staffingWeeklyCalendar") {
        return "weekly";
    }

    if (targetId === "timelinePanel") {
        return "timeline";
    }

    if (targetId === "taskAssignmentsPanel") {
        return "tasks";
    }

    if (targetId === "kanbanPanel") {
        return "kanban";
    }

    if (targetId === "shiftHoldersPanel") {
        return "holders";
    }

    if (targetId === "agendaPanel") {
        return "agenda";
    }

    return "turnos";
}

/**
 * Elemento por el que EMPIEZA la vista de un target.
 *
 * El tile de Perfiles apunta a "Datos personales", que no es el comienzo de su
 * vista: antes van el nombre del trabajador, sus botones y sus tarjetas de
 * resumen. Entrar al menu saltandoselas se lee como una pagina que quedo a
 * medio scroll, asi que se entra por el encabezado.
 *
 * @param {string} targetId
 * @returns {string} id del elemento por el que se entra a esa vista
 */
export function getViewTopTarget(targetId) {
    return targetId === "profileSection" ? "profileHero" : targetId;
}

/**
 * Target del tile de navegacion correspondiente a la vista activa actual.
 * @returns {string}
 */
export function getTargetForActiveView() {
    const activeView = document.body.dataset.activeView || "turnos";
    const activeTile = Array.from(
        document.querySelectorAll(".nav-tile[data-target]")
    ).find(button =>
        getViewForTarget(button.dataset.target) === activeView &&
        !button.classList.contains("nav-tile--action")
    );

    return activeTile?.dataset.target || "calendarPanel";
}

/**
 * Indica si un id corresponde a un panel navegable (existe y tiene tile).
 * @param {string} targetId
 * @returns {boolean}
 */
export function isAppTarget(targetId) {
    return Boolean(
        targetId &&
        document.getElementById(targetId) &&
        Array.from(
            document.querySelectorAll(".nav-tile[data-target]")
        ).some(button => button.dataset.target === targetId)
    );
}

/**
 * Target indicado por el hash actual de la URL, o "" si no es valido.
 * @returns {string}
 */
export function targetFromHash() {
    const value = decodeURIComponent(
        String(window.location.hash || "").replace(/^#/, "")
    );

    return isAppTarget(value) ? value : "";
}

/**
 * URL (path + query + hash) para un target dado.
 * @param {string} targetId
 * @returns {string}
 */
export function appTargetUrl(targetId) {
    const url = new URL(window.location.href);
    url.hash = targetId;
    return `${url.pathname}${url.search}${url.hash}`;
}
