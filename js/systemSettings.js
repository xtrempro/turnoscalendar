import { escapeHTML } from "./htmlUtils.js";
import { showConfirm } from "./dialogs.js";
import { getCurrentFirebaseUser } from "./firebaseClient.js";
import {
    isValidEmailFormat,
    normalizeEmailKey
} from "./emailUtils.js";
import {
    DEFAULT_GRADE_HOUR_CONFIG,
    getGradeHourConfig,
    saveGradeHourConfig,
    getReplacementRequestConfig,
    saveReplacementRequestConfig,
    getAdminDisplayName,
    getAdminDisplayNames,
    setAdminDisplayName,
    getReportSignatureConfig,
    saveReportSignatureConfig,
    getTurnChangeConfig,
    saveTurnChangeConfig
} from "./storage.js";
import {
    getManualHolidays,
    saveManualHolidays
} from "./holidays.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import {
    buildStaffingRequirementRows,
    getStaffingConfig,
    saveStaffingConfig,
    staffingConfigSummary
} from "./staffing.js";
import {
    MENU_PERMISSION_DEFS,
    deleteWorkspaceMember,
    getWorkspacePermissionState,
    isWorkspaceOwner,
    listWorkspaceMembersForPermissions,
    normalizeMenuPermissions,
    saveWorkspaceMemberPermissions
} from "./workspacePermissions.js";
import {
    TURNO_COLOR_CODES,
    TURNO_COLOR_SETTINGS_CODES,
    NAMED_TURNO_COLORS,
    turnoColorLabel,
    getTurnoColorConfig,
    saveTurnoColorConfig,
    DEFAULT_BRAND_COLOR,
    DEFAULT_TURN_CHANGE_RETURN_COLOR,
    getDefaultTurnoColorConfig,
    applyTurnoColors
} from "./turnoColors.js";
import {
    getActiveWorkspace,
    sendSupervisorInvitationEmail
} from "./workspaces.js";
import {
    showSupervisorInvitePermissionsDialog
} from "./supervisorInvitesUI.js";

const GROUPS = [
    {
        key: "professional",
        title: "Profesionales",
        description: "Valores por defecto para estamento Profesional.",
        grades: Object.keys(DEFAULT_GRADE_HOUR_CONFIG.professional)
    },
    {
        key: "general",
        title: "Tecnicos, Administrativos y Auxiliares",
        description: "Valores por defecto para Tecnicos, Administrativos y Auxiliares.",
        grades: Object.keys(DEFAULT_GRADE_HOUR_CONFIG.general)
    }
];

let activeTab = "grades";
let manualHolidayDraft = [];
let gradeConfigDraft = null;
let replacementRequestConfigDraft = null;
let reportSignatureConfigDraft = null;
let turnChangeConfigDraft = null;
let staffingConfigDraft = null;
let colorConfigDraft = null;
let memberPermissionDraft = [];
let memberPermissionLoading = false;
let memberPermissionError = "";
let supervisorInviteSending = false;
let supervisorInviteMessage = "";
let supervisorInviteError = "";
let supervisorInviteEmailDraft = "";
let supervisorInviteNameDraft = "";
let onSettingsSaved = null;

function formatRate(value) {
    return Number(value || 0).toFixed(2);
}

function parseRate(value) {
    const raw = String(value || "").trim();
    const normalized = raw.includes(",")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw;
    const number = Number(normalized);

    return Number.isFinite(number) && number > 0
        ? number
        : 0;
}

function formatDate(isoDate) {
    const [year, month, day] = String(isoDate || "").split("-");
    if (!year || !month || !day) return isoDate || "";

    return `${day}-${month}-${year}`;
}

// Periodo de vigencia que se esta editando. Los valores por grado cambian una
// vez al año, asi que la pestaña muestra un periodo a la vez.
let gradePeriodIndex = 0;

const MESES_LARGOS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

function gradePeriodLabel(period) {
    const rotulo = month => {
        const [year, mes] = String(month).split("-").map(Number);

        return year && mes
            ? `${MESES_LARGOS[mes - 1]} ${year}`
            : "";
    };
    const desde = rotulo(period.from);
    const hasta = rotulo(period.to);

    if (!desde && !hasta) return "Todo el historico";
    if (!desde) return `Hasta ${hasta}`;
    if (!hasta) return `Desde ${desde}`;

    return `${desde} a ${hasta}`;
}

function activeGradePeriod(config) {
    const periods = config?.periods || [];

    if (!periods.length) return null;

    const index = Math.min(
        Math.max(gradePeriodIndex, 0),
        periods.length - 1
    );

    gradePeriodIndex = index;

    return periods[index];
}

function renderGradePeriodBar(config) {
    const periods = config?.periods || [];

    return `
        <div class="settings-grade-periods">
            <div class="settings-grade-periods__list">
                ${periods.map((period, index) => `
                    <button class="settings-grade-period ${index === gradePeriodIndex ? "is-active" : ""}"
                        type="button" data-grade-period="${index}">
                        ${escapeHTML(gradePeriodLabel(period))}
                    </button>
                `).join("")}
                <button class="settings-grade-period settings-grade-period--add"
                    type="button" data-grade-period-add>+ Agregar periodo</button>
            </div>
            <div class="settings-grade-range">
                <label>
                    <span>Desde</span>
                    <input type="month" data-grade-period-from
                        value="${escapeHTML(periods[gradePeriodIndex]?.from || "")}">
                </label>
                <label>
                    <span>Hasta</span>
                    <input type="month" data-grade-period-to
                        value="${escapeHTML(periods[gradePeriodIndex]?.to || "")}">
                </label>
                ${periods.length > 1 ? `
                    <button class="settings-grade-period-remove" type="button"
                        data-grade-period-remove="${gradePeriodIndex}">Eliminar periodo</button>
                ` : ""}
            </div>
            <p class="settings-grade-periods__note">
                Los valores se aplican por mes cerrado. Deja "Hasta" en blanco
                para el periodo vigente.
            </p>
        </div>
    `;
}

function renderRateRows(group, config) {
    return group.grades
        .map(grade => `
            <tr>
                <td>Grado ${escapeHTML(grade)}</td>
                <td>
                    <label class="settings-money-field">
                        <span>$</span>
                        <input
                            type="text"
                            inputmode="decimal"
                            data-rate-group="${group.key}"
                            data-rate-grade="${escapeHTML(grade)}"
                            value="${formatRate(activeGradePeriod(config)?.[group.key]?.[grade])}"
                        >
                    </label>
                </td>
            </tr>
        `)
        .join("");
}

function renderGradesPanel(config) {
    return `
        ${renderGradePeriodBar(config)}
        <div class="settings-grade-grid">
            ${GROUPS.map(group => `
                <section class="settings-card">
                    <div class="settings-card__head">
                        <h4>${group.title}</h4>
                        <span>${group.description}</span>
                    </div>
                    <div class="settings-table-wrap">
                        <table class="settings-table">
                            <thead>
                                <tr>
                                    <th>Grado</th>
                                    <th>Valor hora</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderRateRows(group, config)}
                            </tbody>
                        </table>
                    </div>
                </section>
            `).join("")}
        </div>
    `;
}

function renderHolidayList() {
    if (!manualHolidayDraft.length) {
        return `
            <div class="settings-empty">
                Aun no hay feriados manuales agregados.
            </div>
        `;
    }

    return manualHolidayDraft
        .map((holiday, index) => `
            <article class="settings-holiday-item">
                <span>
                    <strong>${escapeHTML(formatDate(holiday.date))}</strong>
                    <small>${escapeHTML(holiday.name)}</small>
                </span>
                <button type="button" data-remove-holiday="${index}">
                    Quitar
                </button>
            </article>
        `)
        .join("");
}

function renderHolidaysPanel() {
    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Feriados manuales</h4>
                <span>Estos d\u00edas se consideran inh\u00e1biles y se suman a los feriados oficiales.</span>
            </div>

            <div class="settings-holiday-form">
                <label>
                    <span>Fecha</span>
                    <input id="settingsHolidayDate" type="date">
                </label>
                <label>
                    <span>Nombre o motivo</span>
                    <input id="settingsHolidayName" type="text" placeholder="Ej: Feriado institucional">
                </label>
                <button id="settingsAddHoliday" class="secondary-button" type="button">
                    Agregar feriado
                </button>
            </div>

            <div id="settingsHolidayList" class="settings-holiday-list">
                ${renderHolidayList()}
            </div>
        </section>
    `;
}

function renderRequestsPanel() {
    const config =
        replacementRequestConfigDraft ||
        getReplacementRequestConfig();

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Reemplazos</h4>
                <span>
                    Define que opciones aparecen al cargar sugerencias de
                    reemplazo y solicitudes al trabajador.
                </span>
            </div>

            <div class="settings-switch-grid">
                ${checkboxHTML({
                    id: "settingsEnableLinkedUnitSuggestions",
                    checked: config.enableLinkedUnitSuggestions !== false,
                    title: "Buscar sugerencias en unidades enlazadas",
                    description: "Habilita la busqueda bajo demanda. No se carga informacion externa hasta que el supervisor pulsa Buscar reemplazo compatible en unidades enlazadas."
                })}
                ${checkboxHTML({
                    id: "settingsEnableCrossRoleSuggestions",
                    checked: config.enableCrossRoleSuggestions !== false,
                    title: "Mostrar personal de otras profesiones y/o estamentos",
                    description: "En las sugerencias de reemplazo se muestran trabajadores de profesiones y/o estamentos distintos al trabajador que ocasiona la necesidad de reemplazo."
                })}
                ${checkboxHTML({
                    id: "settingsEnableWorkerAcceptanceRequest",
                    checked: config.enableWorkerAcceptanceRequest !== false,
                    title: "Solicitar aceptacion al trabajador",
                    description: "Al cargar las sugerencias aparece la opcion de preguntarle al trabajador si puede realizar el reemplazo antes de anadirlo al calendario."
                })}
                ${checkboxHTML({
                    id: "settingsAllowNightTrainingReplacement",
                    checked: config.allowNightTrainingReplacement === true,
                    title: "Permitir el reemplazo de capacitaciones cuando al funcionario le corresponde turno de noche",
                    description: "El funcionario se exime de ir a su turno de noche. La capacitacion se aplica sin pedir horario -la noche se exime completa- y el turno queda pidiendo reemplazo."
                })}
            </div>

            ${config.enableWorkerAcceptanceRequest !== false ? `
                <label class="settings-request-field">
                    <span>Caducidad de solicitudes</span>
                    <input
                        id="settingsReplacementRequestExpires"
                        type="number"
                        min="5"
                        step="5"
                        value="${Number(config.expiresMinutes) || 24 * 60}"
                    >
                    <small>Tiempo en minutos. Valor recomendado: 1440 (24 horas).</small>
                </label>
            ` : ""}
        </section>
    `;
}

function renderSignaturePanel() {
    const config =
        reportSignatureConfigDraft ||
        getReportSignatureConfig();
    const labels = [
        "Primera l&iacute;nea:",
        "Segunda l&iacute;nea:",
        "Tercera l&iacute;nea:",
        "Cuarta l&iacute;nea:"
    ];

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Pie de Firma</h4>
                <span>
                    Configura el pie de firma que aparecer&aacute; en los
                    documentos imprimibles.
                </span>
            </div>

            <div class="settings-signature-grid">
                ${labels.map((label, index) => `
                    <label class="settings-signature-field">
                        <span>${label}</span>
                        <input
                            type="text"
                            maxlength="120"
                            data-signature-line="${index}"
                            value="${escapeHTML(config.lines[index] || "")}"
                        >
                    </label>
                `).join("")}
            </div>
        </section>
    `;
}

function checkboxHTML({
    id,
    checked,
    title,
    description,
    disabled = false
}) {
    return `
        <label class="settings-switch ${disabled ? "is-disabled" : ""}">
            <input
                id="${id}"
                type="checkbox"
                ${checked ? "checked" : ""}
                ${disabled ? "disabled" : ""}
            >
            <span>
                <strong>${escapeHTML(title)}</strong>
                <small>${escapeHTML(description)}</small>
            </span>
        </label>
    `;
}

function renderTurnChangesPanel() {
    const config =
        turnChangeConfigDraft ||
        getTurnChangeConfig();

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Cambio de Turno</h4>
                <span>
                    Define las reglas generales para intercambios de turno
                    y combinaciones de 24 horas.
                </span>
            </div>

            <div class="settings-switch-grid">
                ${checkboxHTML({
                    id: "settingsAllowSwaps",
                    checked: config.allowSwaps,
                    title: "Permitir cambios de turno",
                    description: "Si se desactiva, ningun trabajador podra registrar cambios y el menu quedara deshabilitado."
                })}

                ${config.allowSwaps ? checkboxHTML({
                    id: "settingsAllowDifferentTurnTypes",
                    checked: config.allowDifferentTurnTypes,
                    title: "Permitir Cambios de Turno entre diferentes tipos de turno",
                    description: "Permite cambiar Larga por Noche o Noche por Larga. Si se desactiva, solo se permite Larga por Larga y Noche por Noche."
                }) : ""}

                ${config.allowSwaps ? checkboxHTML({
                    id: "settingsLimitMonthlySwaps",
                    checked: config.limitMonthlySwaps,
                    title: "Limitar CCTT Mensuales",
                    description: "Define una cantidad maxima de cambios de turno que cada trabajador puede realizar por mes."
                }) : ""}

                ${config.allowSwaps && config.limitMonthlySwaps ? `
                    <label class="settings-limit-field">
                        <span>Cambios mensuales autorizados por trabajador</span>
                        <input
                            id="settingsMonthlySwapLimit"
                            type="number"
                            min="1"
                            step="1"
                            value="${Number(config.monthlySwapLimit) || 2}"
                        >
                    </label>
                ` : ""}

                ${checkboxHTML({
                    id: "settingsAllowTwentyFourHourShifts",
                    checked: config.allowTwentyFourHourShifts,
                    title: "Permitir turnos de 24 horas",
                    description: "Si se desactiva, no se podran generar turnos 24 manuales ni cambios que dejen a un trabajador con turno 24."
                })}

                ${config.allowTwentyFourHourShifts ? checkboxHTML({
                    id: "settingsAllowDiurnoAfterTwentyFour",
                    checked: config.allowDiurnoAfterTwentyFour,
                    title: "Permitir agregar turno diurno post 24h",
                    description: "Habilita un turno Diurno el dia siguiente a un 24h, y permite que un dia de rotativa Diurno llegue a 24h en el calendario (sin esto no podria armarse la secuencia). El reporte marca los tres turnos: Larga y Noche en la fila del 24, y el Diurno en la del dia siguiente."
                }) : ""}

                ${checkboxHTML({
                    id: "settingsAllowInvertedTwentyFourHourShifts",
                    checked: config.allowInvertedTwentyFourHourShifts,
                    title: "Permitir turnos de 24 horas invertidos",
                    description: "Si se desactiva, se bloquea Noche seguida de Larga, Diurno o D + N al dia siguiente y Noche el dia anterior a cualquiera de esos turnos."
                })}

                ${checkboxHTML({
                    id: "settingsAllowSplitShiftCoverage",
                    checked: config.allowSplitShiftCoverage,
                    title: "Permitir cubrir un mismo turno con 2 funcionarios",
                    description: "Al recortarle la jornada a quien cubre un permiso (por ejemplo, entra a las 08:00 y se va a las 13:00 de una Larga), el turno vuelve a pedir cobertura por las horas que quedan y se ofrece buscar a otro trabajador para ese tramo. Si se desactiva, recortar la jornada no ofrece nada y el turno sigue dandose por cubierto."
                })}
            </div>
        </section>
    `;
}

function renderStaffingRows(config) {
    const rows = buildStaffingRequirementRows(config);

    if (!rows.length) {
        return `
            <div class="settings-empty">
                Aun no hay trabajadores activos con rotativa Diurno,
                4° Turno o 3er Turno para configurar dotacion.
            </div>
        `;
    }

    return rows
        .map(row => `
            <label class="settings-staffing-row">
                <span>
                    <strong>${escapeHTML(row.groupLabel)}</strong>
                    <small>${escapeHTML(row.sectionLabel)}</small>
                </span>
                <input
                    type="number"
                    min="0"
                    step="1"
                    data-staffing-modality="${escapeHTML(row.modality)}"
                    data-staffing-estamento="${escapeHTML(row.estamento)}"
                    data-staffing-group="${escapeHTML(row.groupKey)}"
                    value="${Number(row.required) || 0}"
                >
            </label>
        `)
        .join("");
}

function renderStaffingPanel() {
    const config = staffingConfigDraft || getStaffingConfig();

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Dotacion requerida</h4>
                <span>
                    Se muestran solo las profesiones y rotativas que existen
                    actualmente en la unidad.
                </span>
            </div>

            <div class="settings-staffing-grid">
                ${renderStaffingRows(config)}
            </div>
        </section>
    `;
}

function memberLabel(member) {
    return (
        // El que puso el supervisor gana: el de la cuenta de Google suele ser
        // un alias o directamente el correo.
        getAdminDisplayName(member.email) ||
        member.displayName ||
        member.email ||
        member.uid ||
        "Usuario"
    );
}

function renderSupervisorInviteBox() {
    const message = supervisorInviteMessage
        ? `
            <div class="settings-user-invite-message settings-user-invite-message--ok">
                ${escapeHTML(supervisorInviteMessage)}
            </div>
        `
        : "";
    const error = supervisorInviteError
        ? `
            <div class="settings-user-invite-message settings-user-invite-message--error">
                ${escapeHTML(supervisorInviteError)}
            </div>
        `
        : "";

    return `
        <div class="settings-user-invite">
            <div>
                <strong>Invitar administrador</strong>
                <span>Envía una invitación segura para administrar esta unidad.</span>
            </div>
            <div class="settings-user-invite__form">
                <label class="settings-user-invite__field">
                    <span>Nombre de la persona</span>
                    <input
                        type="text"
                        autocomplete="name"
                        data-settings-invite-name
                        placeholder="Ej: Patricia Farías"
                        value="${escapeHTML(supervisorInviteNameDraft)}"
                        ${supervisorInviteSending ? "disabled" : ""}
                    >
                </label>
                <label class="settings-user-invite__field">
                    <span>Correo para invitación</span>
                    <input
                        type="email"
                        inputmode="email"
                        autocomplete="email"
                        data-settings-invite-email
                        placeholder="colaborador@correo.cl"
                        value="${escapeHTML(supervisorInviteEmailDraft)}"
                        ${supervisorInviteSending ? "disabled" : ""}
                    >
                </label>
                <button
                    class="primary-button"
                    type="button"
                    data-settings-send-supervisor-invite
                    ${supervisorInviteSending ? "disabled" : ""}
                >
                    ${supervisorInviteSending ? "Enviando..." : "Enviar invitación"}
                </button>
            </div>
            ${message}
            ${error}
        </div>
    `;
}

function renderUsersPanel() {
    const state = getWorkspacePermissionState();

    if (!isWorkspaceOwner()) {
        return `
            <section class="settings-card settings-card--wide">
                <div class="settings-card__head">
                    <h4>Usuarios y permisos</h4>
                    <span>Solo el creador de la unidad puede administrar permisos.</span>
                </div>
                <div class="settings-empty">
                    No tienes permisos para modificar accesos de otros usuarios.
                </div>
            </section>
        `;
    }

    if (!state.workspaceId) {
        return `
            <section class="settings-card settings-card--wide">
                <div class="settings-card__head">
                    <h4>Usuarios y permisos</h4>
                    <span>Selecciona o crea una unidad para administrar usuarios.</span>
                </div>
                <div class="settings-empty">
                    No hay una unidad activa.
                </div>
            </section>
        `;
    }

    if (memberPermissionLoading) {
        return `
            <section class="settings-card settings-card--wide">
                <div class="settings-card__head">
                    <h4>Usuarios y permisos</h4>
                    <span>Cargando usuarios de la unidad...</span>
                </div>
                ${renderSupervisorInviteBox()}
                <div class="settings-empty">Cargando permisos.</div>
            </section>
        `;
    }

    if (memberPermissionError) {
        return `
            <section class="settings-card settings-card--wide">
                <div class="settings-card__head">
                    <h4>Usuarios y permisos</h4>
                    <span>No se pudo cargar la lista de usuarios.</span>
                </div>
                ${renderSupervisorInviteBox()}
                <div class="settings-empty">
                    ${escapeHTML(memberPermissionError)}
                </div>
            </section>
        `;
    }

    const collaborators = memberPermissionDraft.filter(member =>
        member.role !== "owner"
    );

    return `
        <section class="settings-card settings-card--wide">
            <div class="settings-card__head">
                <h4>Usuarios y permisos</h4>
                <span>
                    Define qu\u00e9 men\u00fas puede ver cada colaborador y en cu\u00e1les
                    puede editar informaci\u00f3n.
                </span>
            </div>

            ${renderSupervisorInviteBox()}

            ${collaborators.length ? `
                <div class="settings-users-list">
                    ${collaborators.map(member => {
                        const permissions =
                            normalizeMenuPermissions(member.permissions);

                        return `
                            <article class="settings-user-card">
                                <div class="settings-user-card__head">
                                    <span class="settings-user-card__id">
                                        <input
                                            class="settings-user-name"
                                            type="text"
                                            data-member-name="${escapeHTML(member.email || "")}"
                                            value="${escapeHTML(memberLabel(member))}"
                                            placeholder="Nombre de la persona"
                                            aria-label="Nombre visible de este administrador"
                                            ${member.email ? "" : "disabled"}
                                        >
                                        <small>${escapeHTML(member.email || member.uid)}</small>
                                    </span>
                                    <div class="settings-user-card__actions">
                                        <em>Colaborador</em>
                                        <button
                                            class="settings-user-delete"
                                            type="button"
                                            data-delete-member="${escapeHTML(member.uid)}"
                                        >
                                            Eliminar
                                        </button>
                                    </div>
                                </div>

                                <div class="settings-permission-grid">
                                    <div class="settings-permission-row settings-permission-row--head">
                                        <span>Men\u00fa</span>
                                        <span>Ver</span>
                                        <span>Editar</span>
                                    </div>
                                    ${MENU_PERMISSION_DEFS.map(menu => {
                                        const permission = permissions[menu.key];
                                        return `
                                            <label class="settings-permission-row">
                                                <span>${escapeHTML(menu.label)}</span>
                                                <input
                                                    type="checkbox"
                                                    data-member-permission="${escapeHTML(member.uid)}"
                                                    data-permission-menu="${escapeHTML(menu.key)}"
                                                    data-permission-kind="view"
                                                    ${permission.view ? "checked" : ""}
                                                >
                                                <input
                                                    type="checkbox"
                                                    data-member-permission="${escapeHTML(member.uid)}"
                                                    data-permission-menu="${escapeHTML(menu.key)}"
                                                    data-permission-kind="edit"
                                                    ${permission.edit ? "checked" : ""}
                                                    ${!permission.view ? "disabled" : ""}
                                                >
                                            </label>
                                        `;
                                    }).join("")}
                                </div>
                            </article>
                        `;
                    }).join("")}
                </div>
            ` : `
                <div class="settings-empty">
                    Aun no hay colaboradores aprobados en esta unidad.
                </div>
            `}
        </section>
    `;
}

function renderColorsPanel() {
    const config = colorConfigDraft || getTurnoColorConfig();
    const baseRows = TURNO_COLOR_SETTINGS_CODES.map(code => `
        <div class="settings-color-row">
            <span class="settings-color-name">${escapeHTML(turnoColorLabel(code))}</span>
            <label class="settings-color-field">
                <span>Base</span>
                <input type="color" data-turno-color="${code}" data-color-kind="base" value="${escapeHTML(config.base[code])}">
            </label>
            <label class="settings-color-field">
                <span>Extra</span>
                <input type="color" data-turno-color="${code}" data-color-kind="extra" value="${escapeHTML(config.extra[code])}">
            </label>
        </div>
    `).join("");
    const namedRows = NAMED_TURNO_COLORS.map(item => `
        <div class="settings-color-row">
            <span class="settings-color-name">${escapeHTML(item.label)}</span>
            <label class="settings-color-field">
                <span>Color</span>
                <input type="color" data-named-color="${escapeHTML(item.key)}" value="${escapeHTML(config.named[item.key])}">
            </label>
        </div>
    `).join("");

    const brandColor = config.brand || DEFAULT_BRAND_COLOR;
    const returnColorEnabled = Boolean(config.turnChangeReturn);
    const returnColorValue =
        config.turnChangeReturn || DEFAULT_TURN_CHANGE_RETURN_COLOR;

    return `
        <div class="settings-section">
            <h4 class="settings-subtitle">Color de la aplicacion</h4>
            <p class="settings-hint">
                Color principal de la interfaz (botones, pestanas y destacados).
                Es un ajuste tuyo: solo cambia como TU ves la aplicacion, no
                afecta a los demas supervisores ni a los trabajadores.
            </p>
            <div class="settings-color-grid">
                <div class="settings-color-row">
                    <span class="settings-color-name">Color principal</span>
                    <label class="settings-color-field">
                        <span>Color</span>
                        <input type="color" data-brand-color value="${escapeHTML(brandColor)}">
                    </label>
                </div>
            </div>

            <h4 class="settings-subtitle">Colores de turnos base</h4>
            <p class="settings-hint">
                Define el color de los turnos base. La columna "Extra" es el color
                cuando el turno es de reemplazo, para distinguirlo del turno base.
            </p>
            <div class="settings-color-grid">
                ${baseRows}
            </div>

            <h4 class="settings-subtitle">Colores de permisos y horas</h4>
            <p class="settings-hint">
                Color de cada permiso, devolucion/extension de horas y reduccion de
                jornada en el calendario.
            </p>
            <div class="settings-color-grid">
                ${namedRows}
            </div>

            <h4 class="settings-subtitle">Cambios de turno</h4>
            <p class="settings-hint">
                Color del turno DEVUELTO (DDTT) en un cambio de turno. Si lo dejas
                sin personalizar, ese dia toma el color normal del turno (si devuelve
                Noche usa el color de Noche, si devuelve Larga el de Larga).
            </p>
            <div class="settings-color-grid">
                <div class="settings-color-row">
                    <span class="settings-color-name">Turno devuelto</span>
                    <label class="settings-color-toggle">
                        <input type="checkbox" id="settingsTurnChangeReturnEnabled" ${returnColorEnabled ? "checked" : ""}>
                        <span>Personalizar color</span>
                    </label>
                    <label class="settings-color-field">
                        <span>Color</span>
                        <input type="color" id="settingsTurnChangeReturnColor" data-turn-change-return-color value="${escapeHTML(returnColorValue)}" ${returnColorEnabled ? "" : "disabled"}>
                    </label>
                </div>
            </div>

            <button class="secondary-button settings-reset-colors" type="button" data-settings-reset-colors>
                Restablecer colores por defecto
            </button>
        </div>
    `;
}

function readColorConfig(backdrop) {
    const base = {};
    const extra = {};

    const current = colorConfigDraft || getTurnoColorConfig();

    for (const code of TURNO_COLOR_CODES) {
        const baseInput = backdrop.querySelector(
            `[data-turno-color="${code}"][data-color-kind="base"]`
        );
        const extraInput = backdrop.querySelector(
            `[data-turno-color="${code}"][data-color-kind="extra"]`
        );

        base[code] = baseInput?.value || current.base[code];
        extra[code] = extraInput?.value || current.extra[code];
    }

    const named = {};

    for (const item of NAMED_TURNO_COLORS) {
        const input = backdrop.querySelector(
            `[data-named-color="${item.key}"]`
        );

        named[item.key] = input?.value || current.named[item.key];
    }

    const brandInput = backdrop.querySelector("[data-brand-color]");
    const brand = brandInput?.value || current.brand || DEFAULT_BRAND_COLOR;

    // Turno devuelto: vacio cuando la personalizacion esta desactivada (usa el
    // color normal del turno).
    const returnEnabled = backdrop.querySelector(
        "#settingsTurnChangeReturnEnabled"
    )?.checked;
    const returnColorInput = backdrop.querySelector(
        "[data-turn-change-return-color]"
    );
    const turnChangeReturn = returnEnabled
        ? (returnColorInput?.value || current.turnChangeReturn || "")
        : "";

    return { base, extra, named, brand, turnChangeReturn };
}

function renderActivePanel(config) {
    if (activeTab === "colors") return renderColorsPanel();
    if (activeTab === "holidays") return renderHolidaysPanel();
    if (activeTab === "requests") return renderRequestsPanel();
    if (activeTab === "signature") return renderSignaturePanel();
    if (activeTab === "turnChanges") return renderTurnChangesPanel();
    if (activeTab === "staffing") return renderStaffingPanel();
    if (activeTab === "users") return renderUsersPanel();

    return renderGradesPanel(config);
}

function modalHTML() {
    const config = gradeConfigDraft || getGradeHourConfig();

    return `
        <div class="turn-change-dialog system-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="systemSettingsTitle">
            <div class="settings-dialog-head">
                <span>
                    <strong id="systemSettingsTitle">Ajustes del sistema</strong>
                    <p>Configura valores transversales para c\u00e1lculos y calendario.</p>
                </span>
                <button class="icon-button" type="button" data-settings-close aria-label="Cerrar ajustes">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"></path>
                        <path d="m6 6 12 12"></path>
                    </svg>
                </button>
            </div>

            <div class="settings-tabs" role="tablist">
                <button class="${activeTab === "grades" ? "is-active" : ""}" type="button" data-settings-tab="grades">
                    Valores por grado
                </button>
                <button class="${activeTab === "holidays" ? "is-active" : ""}" type="button" data-settings-tab="holidays">
                    Feriados manuales
                </button>
                <button class="${activeTab === "requests" ? "is-active" : ""}" type="button" data-settings-tab="requests">
                    Reemplazos
                </button>
                <button class="${activeTab === "signature" ? "is-active" : ""}" type="button" data-settings-tab="signature">
                    Pie de Firma
                </button>
                <button class="${activeTab === "turnChanges" ? "is-active" : ""}" type="button" data-settings-tab="turnChanges">
                    Turnos
                </button>
                <button class="${activeTab === "colors" ? "is-active" : ""}" type="button" data-settings-tab="colors">
                    Colores
                </button>
                <button class="${activeTab === "staffing" ? "is-active" : ""}" type="button" data-settings-tab="staffing">
                    Dotacion RRHH
                </button>
                ${isWorkspaceOwner() ? `
                    <button class="${activeTab === "users" ? "is-active" : ""}" type="button" data-settings-tab="users">
                        Usuarios
                    </button>
                ` : ""}
            </div>

            <div class="settings-panel">
                ${renderActivePanel(config)}
            </div>

            <div class="turn-change-dialog__actions settings-actions">
                <button class="secondary-button" type="button" data-settings-close>
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-settings-save>
                    Guardar ajustes
                </button>
            </div>
        </div>
    `;
}

function readRateConfig(backdrop) {
    const config = JSON.parse(
        JSON.stringify(gradeConfigDraft || getGradeHourConfig())
    );

    const period = activeGradePeriod(config);

    if (!period) return config;

    // El rango tambien se lee de la pantalla: si no, cambiar las fechas y
    // guardar sin tocar ningun valor no guardaria nada.
    const from = backdrop.querySelector("[data-grade-period-from]");
    const to = backdrop.querySelector("[data-grade-period-to]");

    if (from) period.from = String(from.value || "").trim();
    if (to) period.to = String(to.value || "").trim();

    backdrop
        .querySelectorAll("[data-rate-group][data-rate-grade]")
        .forEach(input => {
            const group = input.dataset.rateGroup;
            const grade = input.dataset.rateGrade;
            const fallback =
                DEFAULT_GRADE_HOUR_CONFIG[group]?.[grade] || 0;
            const value = parseRate(input.value);

            period[group][grade] = value || fallback;
        });

    return config;
}

function readRequestConfig(backdrop) {
    const input =
        backdrop.querySelector("#settingsReplacementRequestExpires");
    const fallback =
        replacementRequestConfigDraft ||
        getReplacementRequestConfig();
    const hasInput = id =>
        Boolean(backdrop.querySelector(`#${id}`));
    const checked = id =>
        Boolean(backdrop.querySelector(`#${id}`)?.checked);
    const expiresMinutes = Number(input?.value);

    return {
        ...fallback,
        enableLinkedUnitSuggestions:
            hasInput("settingsEnableLinkedUnitSuggestions")
                ? checked("settingsEnableLinkedUnitSuggestions")
                : fallback.enableLinkedUnitSuggestions,
        enableCrossRoleSuggestions:
            hasInput("settingsEnableCrossRoleSuggestions")
                ? checked("settingsEnableCrossRoleSuggestions")
                : fallback.enableCrossRoleSuggestions,
        enableWorkerAcceptanceRequest:
            hasInput("settingsEnableWorkerAcceptanceRequest")
                ? checked("settingsEnableWorkerAcceptanceRequest")
                : fallback.enableWorkerAcceptanceRequest,
        allowNightTrainingReplacement:
            hasInput("settingsAllowNightTrainingReplacement")
                ? checked("settingsAllowNightTrainingReplacement")
                : fallback.allowNightTrainingReplacement,
        expiresMinutes:
            Number.isFinite(expiresMinutes) && expiresMinutes > 0
                ? Math.round(expiresMinutes)
                : fallback.expiresMinutes
    };
}

function readSignatureConfig(backdrop) {
    const fallback =
        reportSignatureConfigDraft ||
        getReportSignatureConfig();
    const lines = [...fallback.lines];

    backdrop
        .querySelectorAll("[data-signature-line]")
        .forEach(input => {
            const index = Number(input.dataset.signatureLine);

            if (index >= 0 && index < 4) {
                lines[index] = input.value;
            }
        });

    return { lines };
}

function readTurnChangeConfig(backdrop) {
    const fallback =
        turnChangeConfigDraft ||
        getTurnChangeConfig();
    const hasInput = id =>
        Boolean(backdrop.querySelector(`#${id}`));
    const checked = id =>
        Boolean(backdrop.querySelector(`#${id}`)?.checked);
    const monthlySwapLimit = Number(
        backdrop.querySelector("#settingsMonthlySwapLimit")?.value
    );

    return {
        ...fallback,
        allowSwaps: hasInput("settingsAllowSwaps")
            ? checked("settingsAllowSwaps")
            : fallback.allowSwaps,
        allowDifferentTurnTypes:
            hasInput("settingsAllowDifferentTurnTypes")
                ? checked("settingsAllowDifferentTurnTypes")
                : fallback.allowDifferentTurnTypes,
        allowTwentyFourHourShifts:
            hasInput("settingsAllowTwentyFourHourShifts")
                ? checked("settingsAllowTwentyFourHourShifts")
                : fallback.allowTwentyFourHourShifts,
        allowInvertedTwentyFourHourShifts:
            hasInput("settingsAllowInvertedTwentyFourHourShifts")
                ? checked("settingsAllowInvertedTwentyFourHourShifts")
                : fallback.allowInvertedTwentyFourHourShifts,
        allowSplitShiftCoverage:
            hasInput("settingsAllowSplitShiftCoverage")
                ? checked("settingsAllowSplitShiftCoverage")
                : fallback.allowSplitShiftCoverage,
        // El checkbox solo existe en el DOM con los turnos 24 activos. Al
        // desactivarlos desaparece, y sin este `false` explicito el fallback
        // conservaria la excepcion encendida de forma invisible.
        allowDiurnoAfterTwentyFour:
            hasInput("settingsAllowDiurnoAfterTwentyFour")
                ? checked("settingsAllowDiurnoAfterTwentyFour")
                : hasInput("settingsAllowTwentyFourHourShifts")
                ? false
                : fallback.allowDiurnoAfterTwentyFour,
        limitMonthlySwaps:
            hasInput("settingsLimitMonthlySwaps")
                ? checked("settingsLimitMonthlySwaps")
                : fallback.limitMonthlySwaps,
        monthlySwapLimit:
            hasInput("settingsMonthlySwapLimit")
                ? Number.isFinite(monthlySwapLimit) &&
                    monthlySwapLimit > 0
                    ? Math.round(monthlySwapLimit)
                    : fallback.monthlySwapLimit
                : fallback.monthlySwapLimit
    };
}

function readStaffingConfig(backdrop) {
    const config = {};

    backdrop
        .querySelectorAll("[data-staffing-modality][data-staffing-estamento][data-staffing-group]")
        .forEach(input => {
            const modality = input.dataset.staffingModality;
            const estamento = input.dataset.staffingEstamento;
            const group = input.dataset.staffingGroup;
            const value = Number(input.value);

            if (!config[modality]) config[modality] = {};
            if (!config[modality][estamento]) {
                config[modality][estamento] = {};
            }

            config[modality][estamento][group] =
                Number.isFinite(value) && value > 0
                    ? Math.round(value)
                    : 0;
        });

    return config;
}

function readMemberPermissionDraft(backdrop) {
    const byUid = new Map(
        memberPermissionDraft.map(member => [
            member.uid,
            {
                ...member,
                permissions: normalizeMenuPermissions(member.permissions)
            }
        ])
    );

    backdrop
        .querySelectorAll("[data-member-permission][data-permission-menu][data-permission-kind]")
        .forEach(input => {
            const member = byUid.get(input.dataset.memberPermission);
            if (!member || member.role === "owner") return;

            const menuKey = input.dataset.permissionMenu;
            const kind = input.dataset.permissionKind;

            if (!member.permissions[menuKey]) {
                member.permissions[menuKey] = {
                    view: true,
                    edit: true
                };
            }

            member.permissions[menuKey][kind] = input.checked;

            if (kind === "view" && !input.checked) {
                member.permissions[menuKey].edit = false;
            }

            if (kind === "edit" && input.checked) {
                member.permissions[menuKey].view = true;
            }
        });

    memberPermissionDraft = Array.from(byUid.values());
}

function preserveActiveDraft(backdrop) {
    if (activeTab === "grades") {
        gradeConfigDraft = readRateConfig(backdrop);
    }

    if (activeTab === "requests") {
        replacementRequestConfigDraft =
            readRequestConfig(backdrop);
    }

    if (activeTab === "signature") {
        reportSignatureConfigDraft =
            readSignatureConfig(backdrop);
    }

    if (activeTab === "turnChanges") {
        turnChangeConfigDraft =
            readTurnChangeConfig(backdrop);
    }

    if (activeTab === "staffing") {
        staffingConfigDraft = readStaffingConfig(backdrop);
    }

    if (activeTab === "colors") {
        colorConfigDraft = readColorConfig(backdrop);
    }

    if (activeTab === "users") {
        readMemberPermissionDraft(backdrop);
        supervisorInviteEmailDraft = String(
            backdrop.querySelector("[data-settings-invite-email]")?.value || ""
        );
    }
}

async function loadMemberPermissionDraft() {
    if (!isWorkspaceOwner()) {
        memberPermissionDraft = [];
        memberPermissionLoading = false;
        memberPermissionError = "";
        return;
    }

    memberPermissionLoading = true;
    memberPermissionError = "";

    try {
        memberPermissionDraft =
            await listWorkspaceMembersForPermissions();
    } catch (error) {
        memberPermissionDraft = [];
        memberPermissionError =
            error?.message || "No se pudieron cargar los usuarios.";
    } finally {
        memberPermissionLoading = false;
    }
}

async function saveMemberPermissionDrafts() {
    if (!isWorkspaceOwner()) return;

    const state = getWorkspacePermissionState();
    if (!state.workspaceId) return;

    await Promise.all(
        memberPermissionDraft
            .filter(member => member.role !== "owner")
            .map(member =>
                saveWorkspaceMemberPermissions(
                    state.workspaceId,
                    member.uid,
                    member.permissions
                )
            )
    );
}

function rerenderSettings(backdrop, focusSelector = "") {
    backdrop.innerHTML = modalHTML();

    if (focusSelector) {
        backdrop.querySelector(focusSelector)?.focus();
    }
}

async function sendSettingsSupervisorInvitation(backdrop, sourceButton) {
    preserveActiveDraft(backdrop);

    const state = getWorkspacePermissionState();
    const activeWorkspace = getActiveWorkspace();
    const workspace = {
        ...(activeWorkspace || {}),
        id: state.workspaceId || activeWorkspace?.id || "",
        name: activeWorkspace?.name || "la unidad"
    };
    const user = getCurrentFirebaseUser();
    const emailInput = sourceButton
        ?.closest(".settings-user-invite")
        ?.querySelector("[data-settings-invite-email]");
    const email = normalizeEmailKey(emailInput?.value);
    const nameInput = sourceButton
        ?.closest(".settings-user-invite")
        ?.querySelector("[data-settings-invite-name]");
    const displayName = String(nameInput?.value || "").trim();

    supervisorInviteEmailDraft = email;
    supervisorInviteNameDraft = displayName;
    supervisorInviteMessage = "";
    supervisorInviteError = "";

    if (!workspace.id) {
        supervisorInviteError =
            "Selecciona o crea una unidad antes de enviar invitaciones.";
        rerenderSettings(backdrop, "[data-settings-invite-email]");
        return;
    }

    if (!user) {
        supervisorInviteError =
            "Debes iniciar sesión para enviar invitaciones.";
        rerenderSettings(backdrop, "[data-settings-invite-email]");
        return;
    }

    if (!email) {
        supervisorInviteError =
            "Ingresa el correo al que quieres enviar la invitación.";
        rerenderSettings(backdrop, "[data-settings-invite-email]");
        return;
    }

    if (!isValidEmailFormat(email)) {
        supervisorInviteError =
            "El correo debe tener el formato nombre@dominio.cl.";
        rerenderSettings(backdrop, "[data-settings-invite-email]");
        return;
    }

    if (!displayName) {
        // Es lo que va a ver esa persona al entrar. Sin nombre, el saludo cae
        // en el de su cuenta de Google, que suele no servir.
        supervisorInviteError =
            "Ingresa el nombre de la persona que vas a invitar.";
        rerenderSettings(backdrop, "[data-settings-invite-name]");
        return;
    }

    const permissions =
        await showSupervisorInvitePermissionsDialog({
            title: "Nueva invitación segura",
            message:
                "Selecciona los permisos que tendrá el supervisor si apruebas su solicitud.",
            confirmText: "Enviar invitación"
        });

    if (!permissions) return;

    supervisorInviteSending = true;
    rerenderSettings(backdrop);

    try {
        await sendSupervisorInvitationEmail(
            user,
            workspace,
            email,
            permissions
        );

        // El nombre se guarda ANTES de que la persona acepte: cuando entre, el
        // saludo ya la reconoce sin que nadie tenga que volver aca.
        setAdminDisplayName(email, displayName);

        supervisorInviteEmailDraft = "";
        supervisorInviteNameDraft = "";
        supervisorInviteMessage =
            `Invitación enviada a ${displayName} (${email}).`;
    } catch (error) {
        supervisorInviteError =
            error?.message || "No se pudo enviar la invitación.";
    } finally {
        supervisorInviteSending = false;
        rerenderSettings(
            backdrop,
            supervisorInviteError ? "[data-settings-invite-email]" : ""
        );
    }
}

function rerenderHolidayList(backdrop) {
    const list = backdrop.querySelector("#settingsHolidayList");
    if (!list) return;

    list.innerHTML = renderHolidayList();
}

function bindBackdrop(backdrop) {
    backdrop.addEventListener("change", event => {
        // Nombre visible de un administrador. Se guarda al salir del campo (o
        // al presionar Enter), no en cada tecla: escribir "Patricia" no puede
        // disparar seis guardados y seis sincronizaciones.
        const nameInput = event.target?.closest?.("[data-member-name]");

        if (nameInput) {
            setAdminDisplayName(
                nameInput.dataset.memberName,
                nameInput.value
            );
            return;
        }

        if (
            event.target?.matches?.("[data-member-permission]")
        ) {
            preserveActiveDraft(backdrop);
            backdrop.innerHTML = modalHTML();
            return;
        }

        if (
            ![
                "settingsAllowSwaps",
                "settingsLimitMonthlySwaps",
                // Cuelga de el la opcion de Diurno post 24h: sin reconstruir, el
                // hijo quedaba en pantalla despues de apagar el padre.
                "settingsAllowTwentyFourHourShifts",
                "settingsEnableWorkerAcceptanceRequest",
                "settingsTurnChangeReturnEnabled"
            ].includes(event.target?.id)
        ) {
            return;
        }

        const focusId = event.target.id;
        preserveActiveDraft(backdrop);
        backdrop.innerHTML = modalHTML();
        backdrop
            .querySelector(`#${focusId}`)
            ?.focus();
    });

    backdrop.addEventListener("click", async event => {
        if (
            event.target === backdrop ||
            event.target.closest("[data-settings-close]")
        ) {
            backdrop.remove();
            return;
        }

        const tab = event.target.closest("[data-settings-tab]");
        if (tab) {
            preserveActiveDraft(backdrop);
            activeTab = tab.dataset.settingsTab;
            backdrop.innerHTML = modalHTML();
            return;
        }

        // Periodos de vigencia de los valores por grado. Cada accion guarda
        // antes lo que hay en pantalla (preserveActiveDraft lee las tablas),
        // para no perder lo que el usuario acaba de escribir.
        const periodTab = event.target.closest("[data-grade-period]");
        if (periodTab) {
            preserveActiveDraft(backdrop);
            gradePeriodIndex = Number(periodTab.dataset.gradePeriod) || 0;
            backdrop.innerHTML = modalHTML();
            return;
        }

        if (event.target.closest("[data-grade-period-add]")) {
            preserveActiveDraft(backdrop);

            const config = gradeConfigDraft || getGradeHourConfig();
            const last = config.periods.at(-1);

            // El periodo nuevo arranca copiando los valores del ultimo: casi
            // siempre es un reajuste sobre la tabla vigente, no una tabla desde
            // cero.
            config.periods.push({
                from: "",
                to: "",
                professional: { ...(last?.professional || {}) },
                general: { ...(last?.general || {}) }
            });
            gradeConfigDraft = config;
            gradePeriodIndex = config.periods.length - 1;
            backdrop.innerHTML = modalHTML();
            return;
        }

        const removePeriod = event.target.closest("[data-grade-period-remove]");
        if (removePeriod) {
            const config = gradeConfigDraft || getGradeHourConfig();

            if (config.periods.length > 1) {
                config.periods.splice(
                    Number(removePeriod.dataset.gradePeriodRemove) || 0,
                    1
                );
                gradeConfigDraft = config;
                gradePeriodIndex = 0;
                backdrop.innerHTML = modalHTML();
            }
            return;
        }

        const resetColors = event.target.closest("[data-settings-reset-colors]");
        if (resetColors) {
            colorConfigDraft = getDefaultTurnoColorConfig();
            backdrop.innerHTML = modalHTML();
            return;
        }

        const sendSupervisorInvite = event.target.closest(
            "[data-settings-send-supervisor-invite]"
        );
        if (sendSupervisorInvite) {
            await sendSettingsSupervisorInvitation(
                backdrop,
                sendSupervisorInvite
            );
            return;
        }

        const addHoliday = event.target.closest("#settingsAddHoliday");
        if (addHoliday) {
            const dateInput = backdrop.querySelector("#settingsHolidayDate");
            const nameInput = backdrop.querySelector("#settingsHolidayName");
            const date = dateInput?.value || "";
            const name = String(nameInput?.value || "").trim();

            if (!date) {
                dateInput?.focus();
                return;
            }

            manualHolidayDraft = manualHolidayDraft
                .filter(item => item.date !== date)
                .concat({
                    date,
                    name: name || "Feriado manual"
                })
                .sort((a, b) => a.date.localeCompare(b.date));

            if (dateInput) dateInput.value = "";
            if (nameInput) nameInput.value = "";
            rerenderHolidayList(backdrop);
            dateInput?.focus();
            return;
        }

        const removeHoliday = event.target.closest("[data-remove-holiday]");
        if (removeHoliday) {
            const index = Number(removeHoliday.dataset.removeHoliday);
            manualHolidayDraft = manualHolidayDraft.filter((_, itemIndex) =>
                itemIndex !== index
            );
            rerenderHolidayList(backdrop);
            return;
        }

        const deleteMemberButton =
            event.target.closest("[data-delete-member]");
        if (deleteMemberButton) {
            preserveActiveDraft(backdrop);

            const state = getWorkspacePermissionState();
            const uid = deleteMemberButton.dataset.deleteMember;
            const member = memberPermissionDraft.find(item =>
                item.uid === uid
            );

            if (!state.workspaceId || !member || member.role === "owner") {
                return;
            }

            const label = memberLabel(member);
            const confirmed = await showConfirm(
                `${label} dejará de tener acceso a los menús y datos compartidos de esta unidad.`,
                {
                    title: "Quitar acceso a la unidad",
                    tone: "danger",
                    confirmText: "Quitar acceso",
                    destructive: true
                }
            );

            if (!confirmed) return;

            deleteMemberButton.disabled = true;

            try {
                await deleteWorkspaceMember(state.workspaceId, uid);
                memberPermissionDraft =
                    memberPermissionDraft.filter(item => item.uid !== uid);

                addAuditLog(
                    AUDIT_CATEGORY.SYSTEM_SETTINGS,
                    "Elimino colaborador de la unidad",
                    `Quito el acceso de ${label}.`,
                    {
                        scope: "workspace_members",
                        uid
                    }
                );

                backdrop.innerHTML = modalHTML();
            } catch (error) {
                deleteMemberButton.disabled = false;
                alert(
                    error?.message ||
                    "No se pudo eliminar el usuario de la unidad."
                );
            }

            return;
        }

        if (event.target.closest("[data-settings-save]")) {
            try {
                preserveActiveDraft(backdrop);
                const previousStaffingConfig = getStaffingConfig();
                const nextStaffingConfig =
                    staffingConfigDraft ||
                    getStaffingConfig();
                saveGradeHourConfig(gradeConfigDraft);
                saveManualHolidays(manualHolidayDraft);
                saveReplacementRequestConfig(
                    replacementRequestConfigDraft ||
                    getReplacementRequestConfig()
                );
                saveReportSignatureConfig(
                    reportSignatureConfigDraft ||
                    getReportSignatureConfig()
                );
                saveTurnChangeConfig(
                    turnChangeConfigDraft ||
                    getTurnChangeConfig()
                );
                saveStaffingConfig(nextStaffingConfig);
                saveTurnoColorConfig(
                    colorConfigDraft || getTurnoColorConfig()
                );
                applyTurnoColors();
                await saveMemberPermissionDrafts();

                if (
                    staffingConfigSummary(previousStaffingConfig) !==
                    staffingConfigSummary(nextStaffingConfig)
                ) {
                    addAuditLog(
                        AUDIT_CATEGORY.STAFFING,
                        "Modifico dotacion requerida",
                        `Antes: ${staffingConfigSummary(previousStaffingConfig)}. Ahora: ${staffingConfigSummary(nextStaffingConfig)}.`,
                        { scope: "staffing_settings" }
                    );
                }

                addAuditLog(
                    AUDIT_CATEGORY.SYSTEM_SETTINGS,
                    "Modifico ajustes del sistema",
                    "Actualizo valores por grado, feriados manuales, opciones de reemplazos, pie de firma, reglas de cambios de turno, dotacion requerida y/o permisos de usuarios.",
                    { scope: "system_settings" }
                );
                backdrop.remove();
                onSettingsSaved?.();
            } catch (error) {
                alert(
                    error?.message ||
                    "No se pudieron guardar los ajustes."
                );
            }
        }
    });
}

export function openSystemSettings(initialTab = activeTab) {
    const nextTab = String(initialTab || activeTab);

    if (
        nextTab === "users" ||
        [
            "grades",
            "holidays",
            "requests",
            "signature",
            "turnChanges",
            "colors",
            "staffing"
        ].includes(nextTab)
    ) {
        activeTab = nextTab;
    }

    document
        .querySelector(".turn-change-dialog-backdrop[data-system-settings]")
        ?.remove();

    manualHolidayDraft = getManualHolidays();
    gradeConfigDraft = getGradeHourConfig();
    replacementRequestConfigDraft =
        getReplacementRequestConfig();
    reportSignatureConfigDraft =
        getReportSignatureConfig();
    turnChangeConfigDraft = getTurnChangeConfig();
    staffingConfigDraft = getStaffingConfig();
    colorConfigDraft = getTurnoColorConfig();
    memberPermissionDraft = [];
    memberPermissionLoading = false;
    memberPermissionError = "";
    supervisorInviteSending = false;
    supervisorInviteMessage = "";
    supervisorInviteError = "";
    supervisorInviteEmailDraft = "";

    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.dataset.systemSettings = "true";
    backdrop.innerHTML = modalHTML();

    bindBackdrop(backdrop);
    document.body.appendChild(backdrop);

    backdrop
        .querySelector(
            activeTab === "grades"
                ? "[data-rate-group]"
                : activeTab === "holidays"
                    ? "#settingsHolidayDate"
                    : activeTab === "requests"
                        ? "#settingsReplacementRequestExpires"
                        : activeTab === "signature"
                            ? "[data-signature-line]"
                            : activeTab === "turnChanges"
                                ? "#settingsAllowSwaps"
                                : activeTab === "users"
                                    ? "[data-settings-invite-email], [data-member-permission]"
                                    : "[data-staffing-modality]"
        )
        ?.focus();

    if (isWorkspaceOwner()) {
        memberPermissionLoading = true;
        backdrop.innerHTML = modalHTML();
        loadMemberPermissionDraft()
            .then(() => {
                if (!backdrop.isConnected) return;
                backdrop.innerHTML = modalHTML();
            });
    }
}

export function initSystemSettings(options = {}) {
    onSettingsSaved = options.onSaved || null;
    options.button?.addEventListener("click", () => {
        if (!isWorkspaceOwner()) {
            alert(
                "Solo el creador de la unidad puede abrir los ajustes del sistema."
            );
            return;
        }

        openSystemSettings();
    });
}
