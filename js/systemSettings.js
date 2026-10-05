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
    MENU_PERMISSION_DEFS,
    canEditMenu,
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
import {
    handleRotationSettingsChange,
    handleRotationSettingsClick,
    renderRotationSettingsPanel,
    resetRotationSettingsDraft,
    saveRotationSettingsDraft
} from "./rotationSettings.js";

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

let activeTab = "users";
// Usuarios desplegados en "Usuarios y permisos" (sobrevive a los repintados).
const openMembers = new Set();
// Hubo cambios desde que se abrio el modal (para el aviso del pie).
let settingsDirty = false;

// Menu lateral: areas y secciones. `keywords` alimenta el buscador.
const SETTINGS_NAV = [
    {
        label: "Acceso",
        items: [
            { id: "users", label: "Usuarios y permisos", dot: "#10498B", keywords: "usuarios permisos invitar administrador colaborador acceso" }
        ]
    },
    {
        label: "Turnos y cobertura",
        items: [
            { id: "rotations", label: "Rotativas y turnos", dot: "#0F766E", keywords: "rotativas turnos patron calendario horarios diurno tercer cuarto turno" },
            { id: "shifts", label: "Reglas de turnos", dot: "#0F766E", keywords: "24 horas invertido diurno post dos funcionarios repartir turno quitar turno boton planta contrata jornada corta salida temprana 17 septiembre 24 diciembre 31 diciembre reloj control" },
            { id: "swaps", label: "Cambios de turno", dot: "#0F766E", keywords: "cambios de turno cctt limite mensual tipos" },
            { id: "requests", label: "Reemplazos", dot: "#0F766E", keywords: "reemplazos sugerencias unidades enlazadas profesiones aceptacion caducidad devolucion de tiempo horas" },
            { id: "training", label: "Capacitaciones", dot: "#0F766E", keywords: "capacitaciones capacitacion noche" }
        ]
    },
    {
        label: "Unidad",
        items: [
            { id: "holidays", label: "Feriados", dot: "#B45309", keywords: "feriados inhabiles dias" },
            { id: "signature", label: "Documentos y firma", dot: "#B45309", keywords: "pie de firma documentos jefe cargo" },
            { id: "colors", label: "Colores", dot: "#B45309", keywords: "colores turnos permisos aplicacion" }
        ]
    },
    {
        label: "Remuneraciones",
        items: [
            { id: "grades", label: "Valores por grado", dot: "#7C3AED", keywords: "valores por grado valor hora periodo" },
            { id: "overtime", label: "Horas extras", dot: "#7C3AED", keywords: "horas extras hhee diurnas tope limite 40" }
        ]
    }
];

const SETTINGS_TABS = SETTINGS_NAV.flatMap(group => group.items.map(item => item.id));

function sectionHeadHTML(title, text) {
    return `
        <div class="sx-section-head">
            <h2>${title}</h2>
            <p>${text}</p>
        </div>
    `;
}
let manualHolidayDraft = [];
let gradeConfigDraft = null;
let replacementRequestConfigDraft = null;
let reportSignatureConfigDraft = null;
let turnChangeConfigDraft = null;
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
        ${sectionHeadHTML("Valores hora por grado", "Base para calcular el costo de las horas extras. Cada per\u00edodo tiene su tabla; los meses se calculan con la que les corresponde.")}
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
        .map((holiday, index) => {
            const [year, month, day] = String(holiday.date || "").split("-");
            const monthLabel = MESES_LARGOS[Number(month) - 1] || "";

            return `
                <article class="sx-row settings-holiday-item">
                    <span class="sx-date-badge">
                        <strong>${escapeHTML(day || "")}</strong>
                        <small>${escapeHTML(monthLabel.slice(0, 3))} ${escapeHTML(year || "")}</small>
                    </span>
                    <span class="sx-row__text">
                        <strong>${escapeHTML(holiday.name)}</strong>
                        <small>${escapeHTML(formatDate(holiday.date))}</small>
                    </span>
                    <button class="sx-btn-danger-text" type="button" data-remove-holiday="${index}">
                        Quitar
                    </button>
                </article>
            `;
        })
        .join("");
}

function renderHolidaysPanel() {
    return `
        ${sectionHeadHTML("Feriados de la unidad", "D\u00edas inh\u00e1biles propios de la unidad, adem\u00e1s de los feriados oficiales, que se cargan solos.")}
        <section class="sx-card sx-card--pad settings-holiday-form">
            <label class="sx-field">
                <span>Fecha</span>
                <input id="settingsHolidayDate" type="date">
            </label>
            <label class="sx-field">
                <span>Motivo</span>
                <input id="settingsHolidayName" type="text" placeholder="Ej: Aniversario del hospital">
            </label>
            <button id="settingsAddHoliday" class="sx-btn sx-btn--primary" type="button">
                Agregar feriado
            </button>
        </section>

        <div id="settingsHolidayList" class="sx-stack settings-holiday-list">
            ${renderHolidayList()}
        </div>
    `;
}

function renderRequestsPanel() {
    const config =
        replacementRequestConfigDraft ||
        getReplacementRequestConfig();

    return `
        ${sectionHeadHTML("Reemplazos y sugerencias", "Qu\u00e9 ofrece el cuadro de sugerencias al buscar qui\u00e9n cubre un turno.")}
        <div class="sx-stack">
            ${checkboxHTML({
                id: "settingsEnableLinkedUnitSuggestions",
                checked: config.enableLinkedUnitSuggestions !== false,
                title: "Buscar en unidades enlazadas",
                description: "Habilita la busqueda bajo demanda. No se carga informacion externa hasta que el supervisor pulsa Buscar reemplazo compatible en unidades enlazadas."
            })}
            ${checkboxHTML({
                id: "settingsEnableCrossRoleSuggestions",
                checked: config.enableCrossRoleSuggestions !== false,
                title: "Mostrar otras profesiones y estamentos",
                description: "En las sugerencias de reemplazo se muestran trabajadores de profesiones y/o estamentos distintos al trabajador que ocasiona la necesidad de reemplazo."
            })}
            ${checkboxHTML({
                id: "settingsAllowHourReturnCoverage",
                checked: config.allowHourReturnCoverage === true,
                title: "Cubrir las devoluciones de tiempo",
                description: "Cuando alguien devuelve horas, su turno muestra el signo de exclamacion y se puede agregar a otro trabajador para cubrir las horas devueltas."
            })}
            ${checkboxHTML({
                id: "settingsEnableWorkerAcceptanceRequest",
                checked: config.enableWorkerAcceptanceRequest !== false,
                title: "Pedir aceptacion al trabajador",
                description: "Al cargar las sugerencias aparece la opcion de preguntarle al trabajador si puede realizar el reemplazo antes de anadirlo al calendario."
            })}

            ${config.enableWorkerAcceptanceRequest !== false ? `
                <label class="sx-row settings-request-field">
                    <span class="sx-row__text">
                        <strong>Caducidad de las solicitudes a trabajadores</strong>
                        <small>Tiempo en minutos. Valor recomendado: 1440 (24 horas).</small>
                    </span>
                    <span class="sx-inline-field">
                        <input
                            id="settingsReplacementRequestExpires"
                            type="number"
                            min="5"
                            step="5"
                            value="${Number(config.expiresMinutes) || 24 * 60}"
                        >
                        <span>min</span>
                    </span>
                </label>
            ` : ""}
        </div>
    `;
}

function renderTrainingPanel() {
    const config =
        replacementRequestConfigDraft ||
        getReplacementRequestConfig();

    return `
        ${sectionHeadHTML("Capacitaciones", "C\u00f3mo se tratan los turnos de quien asiste a una capacitaci\u00f3n.")}
        <div class="sx-stack">
            ${checkboxHTML({
                id: "settingsAllowNightTrainingReplacement",
                checked: config.allowNightTrainingReplacement === true,
                title: "Capacitaciones en turno de noche",
                description: "El funcionario se exime de ir a su turno de noche. La capacitacion se aplica sin pedir horario -la noche se exime completa- y el turno queda pidiendo reemplazo."
            })}
            <div class="sx-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
                Aqu\u00ed se sumar\u00e1n las pr\u00f3ximas reglas de capacitaciones.
            </div>
        </div>
    `;
}

function renderOvertimePanel() {
    const config =
        replacementRequestConfigDraft ||
        getReplacementRequestConfig();
    const limit = Number(config.monthlyDiurnalOvertimeLimit) || 40;

    return `
        ${sectionHeadHTML("Horas extras", "Tope mensual de horas extras diurnas por trabajador.")}
        <div class="sx-stack">
            <label class="sx-row">
                <span class="sx-row__text">
                    <strong>Tope mensual de horas extras diurnas</strong>
                    <small>40 es el de la norma; la unidad puede fijar uno menor. La cobertura automatica y las sugerencias de reemplazo no le ofrecen un turno a quien lo pasaria, y en el timeline las horas se ponen amarillas desde el 75 % del tope y rojas al llegar a el.</small>
                </span>
                <span class="sx-inline-field">
                    <input
                        id="settingsMonthlyDiurnalOvertimeLimit"
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value="${limit}"
                    >
                    <span>horas</span>
                </span>
            </label>
        </div>
    `;
}

// Las cuatro lineas del pie de firma: su nombre y el ejemplo que se ve
// mientras esta vacia (en el campo y en la vista previa).
const SIGNATURE_LINES = [
    { label: "L&iacute;nea 1 &middot; nombre", placeholder: "[Nombre del jefe de servicio]" },
    { label: "L&iacute;nea 2 &middot; cargo", placeholder: "[Cargo]" },
    { label: "L&iacute;nea 3 &middot; unidad", placeholder: "[Unidad]" },
    { label: "L&iacute;nea 4 &middot; establecimiento", placeholder: "[Nombre del hospital]" }
];

function renderSignaturePanel() {
    const config =
        reportSignatureConfigDraft ||
        getReportSignatureConfig();
    return `
        ${sectionHeadHTML("Documentos y firma", "El pie de firma de los documentos imprimibles. La l\u00ednea 1 y 2 prellenan el jefe directo y su cargo en Calificaciones.")}
        <div class="sx-signature">
            <section class="sx-card sx-card--pad settings-signature-grid">
                ${SIGNATURE_LINES.map((line, index) => `
                    <label class="sx-field settings-signature-field">
                        <span>${line.label}</span>
                        <input
                            type="text"
                            maxlength="120"
                            data-signature-line="${index}"
                            placeholder="${escapeHTML(line.placeholder)}"
                            value="${escapeHTML(config.lines[index] || "")}"
                        >
                    </label>
                `).join("")}
            </section>
            <figure class="sx-card sx-card--pad sx-signature__preview">
                <figcaption>Vista previa</figcaption>
                <div class="sx-signature__paper">
                    <span class="sx-signature__line"></span>
                    ${SIGNATURE_LINES.map((line, index) => `
                        <span
                            class="${index === 0 ? "is-name" : ""} ${config.lines[index] ? "" : "is-placeholder"}"
                            data-signature-preview="${index}"
                        >${escapeHTML(config.lines[index] || line.placeholder)}</span>
                    `).join("")}
                </div>
            </figure>
        </div>
    `;
}

function checkboxHTML({
    id,
    checked,
    title,
    description,
    disabled = false
}) {
    // Fila con interruptor a la derecha. Sigue siendo un checkbox: las
    // funciones read* lo leen por su id.
    return `
        <label class="sx-row settings-switch ${disabled ? "is-disabled" : ""}">
            <span class="sx-row__text">
                <strong>${escapeHTML(title)}</strong>
                <small>${escapeHTML(description)}</small>
            </span>
            <input
                id="${id}"
                class="sx-switch"
                type="checkbox"
                role="switch"
                ${checked ? "checked" : ""}
                ${disabled ? "disabled" : ""}
            >
        </label>
    `;
}

function renderShiftRulesPanel() {
    const config =
        turnChangeConfigDraft ||
        getTurnChangeConfig();

    return `
        ${sectionHeadHTML("Reglas de turnos", "Qu\u00e9 combinaciones de turnos permite la unidad. Rigen al asignar, mover y cubrir turnos en todo el programa.")}
        <div class="sx-stack">
            ${checkboxHTML({
                id: "settingsAllowTwentyFourHourShifts",
                checked: config.allowTwentyFourHourShifts,
                title: "Turnos de 24 horas",
                description: "Si se desactiva, no se podran generar turnos 24 manuales ni cambios que dejen a un trabajador con turno 24."
            })}

            ${config.allowTwentyFourHourShifts ? checkboxHTML({
                id: "settingsAllowDiurnoAfterTwentyFour",
                checked: config.allowDiurnoAfterTwentyFour,
                title: "Turno diurno despues de un 24",
                description: "Habilita un turno Diurno el dia siguiente a un 24h, y permite que un dia de rotativa Diurno llegue a 24h en el calendario. El reporte marca los tres turnos: Larga y Noche en la fila del 24, y el Diurno en la del dia siguiente."
            }) : ""}

            ${checkboxHTML({
                id: "settingsAllowInvertedTwentyFourHourShifts",
                checked: config.allowInvertedTwentyFourHourShifts,
                title: "Turnos de 24 horas invertidos",
                description: "Si se desactiva, se bloquea Noche seguida de Larga, Diurno o D + N al dia siguiente y Noche el dia anterior a cualquiera de esos turnos."
            })}

            ${checkboxHTML({
                id: "settingsAllowSplitShiftCoverage",
                checked: config.allowSplitShiftCoverage,
                title: "Cubrir un mismo turno con 2 funcionarios",
                description: "Al recortarle la jornada a quien cubre un permiso (por ejemplo, entra a las 08:00 y se va a las 13:00 de una Larga), el turno vuelve a pedir cobertura por las horas que quedan y se ofrece buscar a otro trabajador para ese tramo."
            })}

            ${checkboxHTML({
                id: "settingsAllowRemoveShiftButton",
                checked: config.allowRemoveShiftButton,
                title: "Botón Quitar turno para planta y contrata",
                description: "Muestra el botón QUITAR TURNO en el menú Turnos también para planta y contrata (para reemplazos y honorarios está siempre). Quitar un turno de la rotativa base descuenta sus horas de las horas extras del mes."
            })}

            <div class="sx-row settings-short-diurno-row">
                <span class="sx-row__text">
                    <strong>Jornada corta en fechas especiales</strong>
                    <small>Hora de salida de los turnos diurnos el 17 de septiembre, 24 y 31 de diciembre. El marcaje a esta hora no genera una alerta de salida temprana.</small>
                </span>
                <div class="settings-short-diurno-times">
                    <label>
                        <span>Lunes a jueves</span>
                        <input
                            id="settingsShortDiurnoEndTimeMondayThursday"
                            type="time"
                            min="08:00"
                            max="17:00"
                            value="${escapeHTML(config.shortDiurnoEndTimeMondayThursday)}"
                        >
                    </label>
                    <label>
                        <span>Viernes</span>
                        <input
                            id="settingsShortDiurnoEndTimeFriday"
                            type="time"
                            min="08:00"
                            max="16:00"
                            value="${escapeHTML(config.shortDiurnoEndTimeFriday)}"
                        >
                    </label>
                </div>
            </div>
        </div>
    `;
}

function renderSwapsPanel() {
    const config =
        turnChangeConfigDraft ||
        getTurnChangeConfig();

    return `
        ${sectionHeadHTML("Cambios de turno", "C\u00f3mo pueden intercambiar turnos los trabajadores entre s\u00ed.")}
        <div class="sx-stack">
            ${checkboxHTML({
                id: "settingsAllowSwaps",
                checked: config.allowSwaps,
                title: "Permitir cambios de turno",
                description: "Si se desactiva, ningun trabajador podra registrar cambios y el menu quedara deshabilitado."
            })}

            ${config.allowSwaps ? checkboxHTML({
                id: "settingsAllowDifferentTurnTypes",
                checked: config.allowDifferentTurnTypes,
                title: "Entre distintos tipos de turno",
                description: "Permite cambiar Larga por Noche o Noche por Larga. Si se desactiva, solo se permite Larga por Larga y Noche por Noche."
            }) : ""}

            ${config.allowSwaps ? checkboxHTML({
                id: "settingsLimitMonthlySwaps",
                checked: config.limitMonthlySwaps,
                title: "Limitar los cambios mensuales",
                description: "Define una cantidad maxima de cambios de turno que cada trabajador puede realizar por mes."
            }) : ""}

            ${config.allowSwaps && config.limitMonthlySwaps ? `
                <label class="sx-row settings-limit-field">
                    <span class="sx-row__text">
                        <strong>Cambios mensuales autorizados por trabajador</strong>
                        <small>Cantidad maxima al mes.</small>
                    </span>
                    <span class="sx-inline-field">
                        <input
                            id="settingsMonthlySwapLimit"
                            type="number"
                            min="1"
                            step="1"
                            value="${Number(config.monthlySwapLimit) || 2}"
                        >
                        <span>al mes</span>
                    </span>
                </label>
            ` : ""}
        </div>
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
        <div class="sx-card sx-card--pad settings-user-invite">
            <div class="sx-invite__title">
                <strong>Invitar administrador</strong>
                <span>Envía una invitación segura para administrar esta unidad. Al enviarla eliges sus permisos.</span>
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

// Areas en que se agrupan los menus en los permisos de cada usuario.
const PERMISSION_AREAS = [
    { label: "Operaci\u00f3n", keys: ["turnos", "weekly", "tasks", "swap", "requests"] },
    { label: "Personas", keys: ["profile", "clockmarks", "hours", "qualifications", "memos"] },
    { label: "Gesti\u00f3n", keys: ["informations", "medicalEquipment", "tenders", "kanban", "agenda"] },
    { label: "An\u00e1lisis", keys: ["reports", "dashboard", "log"] }
];

// Los menus en su area (los que no calzan con ninguna van a "Otros", para que
// un menu nuevo no quede fuera de la pantalla).
function permissionAreas() {
    const placed = new Set();
    const areas = PERMISSION_AREAS.map(area => {
        const menus = area.keys
            .map(key => MENU_PERMISSION_DEFS.find(menu => menu.key === key))
            .filter(Boolean);

        menus.forEach(menu => placed.add(menu.key));

        return { label: area.label, menus };
    });
    const others = MENU_PERMISSION_DEFS.filter(menu => !placed.has(menu.key));

    if (others.length) areas.push({ label: "Otros", menus: others });

    return areas.filter(area => area.menus.length);
}

function permissionLevel(permission) {
    if (permission?.edit) return "edit";
    if (permission?.view) return "view";
    return "none";
}

function permissionSummary(permissions) {
    const levels = MENU_PERMISSION_DEFS.map(menu => permissionLevel(permissions[menu.key]));

    return {
        edit: levels.filter(level => level === "edit").length,
        view: levels.filter(level => level === "view").length,
        none: levels.filter(level => level === "none").length
    };
}

function memberInitials(label) {
    const words = String(label || "").trim().split(/\s+/).filter(Boolean);

    if (!words.length) return "?";

    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

function memberSinceLabel(member) {
    const value = member.joinedAt?.toDate?.() || member.joinedAt;
    const date = value ? new Date(value) : null;

    return date && !Number.isNaN(date.getTime())
        ? `en la unidad desde ${date.toLocaleDateString("es-CL")}`
        : "";
}

function memberPermissionRowsHTML(member, permissions) {
    return permissionAreas().map(area => `
        <section class="sx-perm-area">
            <h3>${escapeHTML(area.label)}</h3>
            ${area.menus.map(menu => {
                const level = permissionLevel(permissions[menu.key]);
                const name = `perm-${member.uid}-${menu.key}`;

                return `
                    <div class="sx-perm-row">
                        <span>${escapeHTML(menu.label)}</span>
                        <span class="sx-seg" role="radiogroup" aria-label="${escapeHTML(menu.label)}">
                            ${[["none", "No"], ["view", "Ver"], ["edit", "Editar"]].map(([value, label]) => `
                                <label class="sx-seg__opt sx-seg__opt--${value}">
                                    <input
                                        type="radio"
                                        name="${escapeHTML(name)}"
                                        value="${value}"
                                        data-member-permission="${escapeHTML(member.uid)}"
                                        data-permission-menu="${escapeHTML(menu.key)}"
                                        ${level === value ? "checked" : ""}
                                    >
                                    <span>${label}</span>
                                </label>
                            `).join("")}
                        </span>
                    </div>
                `;
            }).join("")}
        </section>
    `).join("");
}

function renderUsersPanel() {
    const state = getWorkspacePermissionState();
    const head = sectionHeadHTML(
        "Usuarios y permisos",
        "Qui\u00e9n administra esta unidad y qu\u00e9 puede ver o editar en cada men\u00fa. Toca un usuario para ver sus permisos."
    );

    if (!isWorkspaceOwner()) {
        return `
            ${head}
            <div class="settings-empty">
                Solo el creador de la unidad puede administrar permisos.
            </div>
        `;
    }

    if (!state.workspaceId) {
        return `
            ${head}
            <div class="settings-empty">
                No hay una unidad activa.
            </div>
        `;
    }

    if (memberPermissionLoading) {
        return `
            ${head}
            ${renderSupervisorInviteBox()}
            <div class="settings-empty">Cargando usuarios de la unidad...</div>
        `;
    }

    if (memberPermissionError) {
        return `
            ${head}
            ${renderSupervisorInviteBox()}
            <div class="settings-empty">
                No se pudo cargar la lista de usuarios. ${escapeHTML(memberPermissionError)}
            </div>
        `;
    }

    const collaborators = memberPermissionDraft.filter(member =>
        member.role !== "owner"
    );

    return `
        ${head}
        ${renderSupervisorInviteBox()}

        ${collaborators.length ? `
            <div class="sx-stack settings-users-list">
                ${collaborators.map(member => {
                    const permissions =
                        normalizeMenuPermissions(member.permissions);
                    const summary = permissionSummary(permissions);
                    const label = memberLabel(member);
                    const since = memberSinceLabel(member);

                    return `
                        <details class="sx-user settings-user-card" data-member-card="${escapeHTML(member.uid)}" ${openMembers.has(member.uid) ? "open" : ""}>
                            <summary class="sx-user__head">
                                <span class="sx-avatar">${escapeHTML(memberInitials(label))}</span>
                                <span class="sx-user__id">
                                    <span class="sx-user__name">
                                        <strong>${escapeHTML(label)}</strong>
                                        <em>Colaborador</em>
                                    </span>
                                    <small>${escapeHTML(member.email || member.uid)}${since ? ` &middot; ${escapeHTML(since)}` : ""}</small>
                                </span>
                                <span class="sx-user__counts">
                                    <span class="sx-chip sx-chip--edit">${summary.edit} editar</span>
                                    <span class="sx-chip">${summary.view} solo ver</span>
                                    <span class="sx-chip sx-chip--none">${summary.none} sin acceso</span>
                                </span>
                                <svg class="sx-user__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
                            </summary>
                            <div class="sx-user__body">
                                <div class="sx-user__tools">
                                    <label class="sx-field sx-field--inline">
                                        <span>Nombre visible</span>
                                        <input
                                            class="settings-user-name"
                                            type="text"
                                            data-member-name="${escapeHTML(member.email || "")}"
                                            value="${escapeHTML(label)}"
                                            placeholder="Nombre de la persona"
                                            aria-label="Nombre visible de este administrador"
                                            ${member.email ? "" : "disabled"}
                                        >
                                    </label>
                                    <span class="sx-user__presets">
                                        <span>Aplicar:</span>
                                        <button class="sx-btn sx-btn--ghost sx-btn--sm" type="button" data-member-preset="${escapeHTML(member.uid)}" data-preset="edit">Todo editar</button>
                                        <button class="sx-btn sx-btn--ghost sx-btn--sm" type="button" data-member-preset="${escapeHTML(member.uid)}" data-preset="view">Solo ver</button>
                                        <button class="sx-btn sx-btn--ghost sx-btn--sm" type="button" data-member-preset="${escapeHTML(member.uid)}" data-preset="ops">Coordinador</button>
                                    </span>
                                    <button
                                        class="sx-btn-danger-text settings-user-delete"
                                        type="button"
                                        data-delete-member="${escapeHTML(member.uid)}"
                                    >
                                        Quitar de la unidad
                                    </button>
                                </div>
                                <div class="sx-perm-grid">
                                    ${memberPermissionRowsHTML(member, permissions)}
                                </div>
                            </div>
                        </details>
                    `;
                }).join("")}
            </div>
        ` : `
            <div class="settings-empty">
                Aun no hay colaboradores aprobados en esta unidad.
            </div>
        `}
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
        ${sectionHeadHTML("Colores", "Los colores de los turnos y permisos son de la unidad. El color de la aplicaci\u00f3n es solo tuyo.")}
        <div class="settings-section sx-colors">
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
    if (activeTab === "rotations") return renderRotationSettingsPanel();
    if (activeTab === "colors") return renderColorsPanel();
    if (activeTab === "holidays") return renderHolidaysPanel();
    if (activeTab === "requests") return renderRequestsPanel();
    if (activeTab === "training") return renderTrainingPanel();
    if (activeTab === "overtime") return renderOvertimePanel();
    if (activeTab === "signature") return renderSignaturePanel();
    if (activeTab === "shifts") return renderShiftRulesPanel();
    if (activeTab === "swaps") return renderSwapsPanel();
    if (activeTab === "users") return renderUsersPanel();

    return renderGradesPanel(config);
}

function collaboratorCount() {
    return memberPermissionDraft.filter(member => member.role !== "owner").length;
}

function settingsNavHTML() {
    const visibleGroups = isWorkspaceOwner()
        ? SETTINGS_NAV
        : SETTINGS_NAV
            .map(group => ({
                ...group,
                items: group.items.filter(item => item.id === "rotations")
            }))
            .filter(group => group.items.length);

    return visibleGroups.map(group => `
        <div class="sx-nav__group" data-settings-nav-group>
            <span class="sx-nav__label">${escapeHTML(group.label)}</span>
            ${group.items.map(item => `
                <button
                    class="sx-nav__item ${activeTab === item.id ? "is-active" : ""}"
                    type="button"
                    data-settings-tab="${item.id}"
                    data-settings-keywords="${escapeHTML(`${item.label} ${item.keywords}`)}"
                    ${activeTab === item.id ? 'aria-current="page"' : ""}
                >
                    <span class="sx-nav__dot" style="background: ${item.dot}"></span>
                    <span>${escapeHTML(item.label)}</span>
                    ${item.id === "users" && collaboratorCount() ? `
                        <span class="sx-chip sx-chip--edit sx-nav__badge">${collaboratorCount()}</span>
                    ` : ""}
                </button>
            `).join("")}
        </div>
    `).join("");
}

function modalHTML() {
    const config = gradeConfigDraft || getGradeHourConfig();
    const workspaceName = getActiveWorkspace()?.name || "";

    return `
        <div class="turn-change-dialog system-settings-dialog sx-dialog" role="dialog" aria-modal="true" aria-labelledby="systemSettingsTitle">
            <header class="sx-header settings-dialog-head">
                <span class="sx-header__title">
                    <strong id="systemSettingsTitle">Ajustes del sistema</strong>
                    <p>${workspaceName ? `${escapeHTML(workspaceName)} &middot; ` : ""}los cambios se aplican a todos los supervisores de la unidad</p>
                </span>
                <label class="sx-search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg>
                    <input type="search" data-settings-search placeholder="Buscar un ajuste (ej. 24 horas, feriado)" aria-label="Buscar un ajuste">
                </label>
                <button class="sx-icon-btn" type="button" data-settings-close aria-label="Cerrar ajustes">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>
                </button>
            </header>

            <div class="sx-body">
                <nav class="sx-nav" aria-label="Secciones de ajustes">
                    ${settingsNavHTML()}
                    <p class="sx-nav__empty" data-settings-search-empty hidden>Ning\u00fan ajuste coincide.</p>
                </nav>
                <main class="sx-main settings-panel">
                    ${renderActivePanel(config)}
                </main>
            </div>

            <footer class="sx-footer settings-actions">
                <span class="sx-dirty ${settingsDirty ? "is-dirty" : ""}" data-settings-dirty>
                    ${settingsDirty ? "Hay cambios sin guardar" : "Sin cambios"}
                </span>
                <button class="sx-btn sx-btn--ghost" type="button" data-settings-discard>
                    Descartar
                </button>
                <button class="sx-btn sx-btn--primary sx-btn--wide" type="button" data-settings-save>
                    Guardar cambios
                </button>
            </footer>
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
        allowHourReturnCoverage:
            hasInput("settingsAllowHourReturnCoverage")
                ? checked("settingsAllowHourReturnCoverage")
                : fallback.allowHourReturnCoverage,
        monthlyDiurnalOvertimeLimit:
            hasInput("settingsMonthlyDiurnalOvertimeLimit")
                ? Number(backdrop.querySelector("#settingsMonthlyDiurnalOvertimeLimit")?.value) ||
                    fallback.monthlyDiurnalOvertimeLimit
                : fallback.monthlyDiurnalOvertimeLimit,
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
    const value = id =>
        backdrop.querySelector(`#${id}`)?.value;
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
        allowRemoveShiftButton:
            hasInput("settingsAllowRemoveShiftButton")
                ? checked("settingsAllowRemoveShiftButton")
                : fallback.allowRemoveShiftButton,
        shortDiurnoEndTimeMondayThursday:
            hasInput("settingsShortDiurnoEndTimeMondayThursday")
                ? value("settingsShortDiurnoEndTimeMondayThursday")
                : fallback.shortDiurnoEndTimeMondayThursday,
        shortDiurnoEndTimeFriday:
            hasInput("settingsShortDiurnoEndTimeFriday")
                ? value("settingsShortDiurnoEndTimeFriday")
                : fallback.shortDiurnoEndTimeFriday,
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

    // Un grupo de radios por menu: No / Ver / Editar.
    backdrop
        .querySelectorAll("[data-member-permission][data-permission-menu]:checked")
        .forEach(input => {
            const member = byUid.get(input.dataset.memberPermission);
            if (!member || member.role === "owner") return;

            const level = input.value;

            member.permissions[input.dataset.permissionMenu] = {
                view: level === "view" || level === "edit",
                edit: level === "edit"
            };
        });

    memberPermissionDraft = Array.from(byUid.values());
}

function preserveActiveDraft(backdrop) {
    if (activeTab === "grades") {
        gradeConfigDraft = readRateConfig(backdrop);
    }

    if (["requests", "training", "overtime"].includes(activeTab)) {
        replacementRequestConfigDraft =
            readRequestConfig(backdrop);
    }

    if (activeTab === "signature") {
        reportSignatureConfigDraft =
            readSignatureConfig(backdrop);
    }

    if (activeTab === "shifts" || activeTab === "swaps") {
        turnChangeConfigDraft =
            readTurnChangeConfig(backdrop);
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

// Aviso del pie: hubo cambios desde que se abrio el modal.
function markSettingsDirty(backdrop) {
    settingsDirty = true;

    const indicator = backdrop.querySelector("[data-settings-dirty]");

    if (indicator) {
        indicator.classList.add("is-dirty");
        indicator.textContent = "Hay cambios sin guardar";
    }
}

// Contadores del encabezado de un usuario, sin repintar el modal (repintar
// cerraria los usuarios abiertos y moveria el scroll).
function refreshMemberSummary(backdrop, uid) {
    const card = [...backdrop.querySelectorAll("[data-member-card]")]
        .find(item => item.dataset.memberCard === uid);

    if (!card) return;

    const counts = { edit: 0, view: 0, none: 0 };

    card.querySelectorAll("[data-member-permission]:checked").forEach(input => {
        counts[input.value] = (counts[input.value] || 0) + 1;
    });

    const chips = card.querySelectorAll(".sx-user__counts .sx-chip");

    if (chips[0]) chips[0].textContent = `${counts.edit} editar`;
    if (chips[1]) chips[1].textContent = `${counts.view} solo ver`;
    if (chips[2]) chips[2].textContent = `${counts.none} sin acceso`;
}

// Perfiles rapidos de permisos de un usuario.
function applyMemberPreset(backdrop, uid, preset) {
    const area = key => PERMISSION_AREAS.find(item => item.keys.includes(key))?.label || "";
    const levelFor = key => {
        if (preset === "edit") return "edit";
        if (preset === "view") return "view";
        // Coordinador: edita la operacion, mira personas y analisis.
        const label = area(key);

        if (label === "Operaci\u00f3n") return "edit";
        if (label === "Personas" || label === "An\u00e1lisis") return "view";
        return "none";
    };

    backdrop
        .querySelectorAll("[data-member-permission][data-permission-menu]")
        .forEach(input => {
            if (input.dataset.memberPermission !== uid) return;

            input.checked = input.value === levelFor(input.dataset.permissionMenu);
        });

    refreshMemberSummary(backdrop, uid);
    markSettingsDirty(backdrop);
}

// Buscador: deja en el menu lateral solo las secciones que calzan.
function filterSettingsNav(backdrop, query) {
    const words = String(query || "")
        .toLocaleLowerCase("es")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/\s+/)
        .filter(Boolean);
    let visible = 0;

    backdrop.querySelectorAll("[data-settings-nav-group]").forEach(group => {
        let groupVisible = 0;

        group.querySelectorAll("[data-settings-keywords]").forEach(item => {
            const text = item.dataset.settingsKeywords
                .toLocaleLowerCase("es")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");
            const match = words.every(word => text.includes(word));

            item.hidden = !match;
            if (match) groupVisible++;
        });

        group.hidden = !groupVisible;
        visible += groupVisible;
    });

    const empty = backdrop.querySelector("[data-settings-search-empty]");

    if (empty) empty.hidden = visible > 0;
}

async function confirmDiscardSettings() {
    if (!settingsDirty) return true;

    return showConfirm(
        "Hay cambios sin guardar en los ajustes. Si sales ahora, se pierden.",
        {
            title: "Descartar cambios",
            tone: "warning",
            confirmText: "Descartar",
            cancelText: "Seguir editando"
        }
    );
}

function bindBackdrop(backdrop) {
    // Usuarios abiertos: se recuerdan para el proximo repintado. `toggle` no
    // burbujea, por eso se escucha en captura.
    backdrop.addEventListener("toggle", event => {
        const card = event.target?.closest?.("[data-member-card]");

        if (!card) return;

        if (card.open) openMembers.add(card.dataset.memberCard);
        else openMembers.delete(card.dataset.memberCard);
    }, true);

    backdrop.addEventListener("input", event => {
        if (event.target?.matches?.("[data-settings-search]")) {
            filterSettingsNav(backdrop, event.target.value);
            return;
        }

        // Vista previa del pie de firma, en vivo.
        const signatureLine = event.target?.closest?.("[data-signature-line]");

        if (signatureLine) {
            const preview = backdrop.querySelector(
                `[data-signature-preview="${signatureLine.dataset.signatureLine}"]`
            );

            if (preview) {
                const value = signatureLine.value.trim();

                // Vacia: se ve el ejemplo, atenuado, como en el campo.
                preview.textContent = value || signatureLine.placeholder || "";
                preview.classList.toggle("is-placeholder", !value);
            }
        }

        if (
            event.target?.closest?.(".sx-main") &&
            !event.target.matches("[data-settings-invite-email], [data-settings-invite-name]")
        ) {
            markSettingsDirty(backdrop);
        }
    });

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
            refreshMemberSummary(backdrop, event.target.dataset.memberPermission);
            markSettingsDirty(backdrop);
            return;
        }

        if (
            activeTab === "rotations" &&
            handleRotationSettingsChange(
                event,
                backdrop,
                () => rerenderSettings(backdrop)
            )
        ) {
            markSettingsDirty(backdrop);
            return;
        }

        if (event.target?.closest?.(".sx-main")) {
            markSettingsDirty(backdrop);
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
            event.target.closest("[data-settings-close], [data-settings-discard]")
        ) {
            if (await confirmDiscardSettings()) backdrop.remove();
            return;
        }

        const preset = event.target.closest("[data-member-preset]");
        if (preset) {
            applyMemberPreset(backdrop, preset.dataset.memberPreset, preset.dataset.preset);
            return;
        }

        const tab = event.target.closest("[data-settings-tab]");
        if (tab) {
            preserveActiveDraft(backdrop);
            activeTab = tab.dataset.settingsTab;
            backdrop.innerHTML = modalHTML();
            return;
        }

        if (activeTab === "rotations") {
            const handled = await handleRotationSettingsClick(
                event,
                backdrop,
                {
                    rerender: () => rerenderSettings(backdrop),
                    dirty: () => markSettingsDirty(backdrop)
                }
            );

            if (handled) return;
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
            settingsDirty = true;
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
            settingsDirty = true;
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

            settingsDirty = true;
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
            settingsDirty = true;
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
                if (isWorkspaceOwner()) {
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
                    saveTurnoColorConfig(
                        colorConfigDraft || getTurnoColorConfig()
                    );
                }
                saveRotationSettingsDraft();
                applyTurnoColors();
                await saveMemberPermissionDrafts();

                addAuditLog(
                    AUDIT_CATEGORY.SYSTEM_SETTINGS,
                    "Modifico ajustes del sistema",
                    isWorkspaceOwner()
                        ? "Actualizo valores por grado, rotativas, turnos, feriados manuales, opciones de reemplazos, pie de firma, reglas de cambios de turno, colores y/o permisos de usuarios."
                        : "Actualizo las rotativas y los tipos de turno de la unidad.",
                    { scope: activeTab === "rotations" ? "rotation_catalog" : "system_settings" }
                );
                settingsDirty = false;
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

    // "turnChanges" era la pestaña de antes: hoy son dos secciones.
    const requested = !isWorkspaceOwner()
        ? "rotations"
        : nextTab === "turnChanges" ? "shifts" : nextTab;

    if (SETTINGS_TABS.includes(requested)) {
        activeTab = requested;
    }

    settingsDirty = false;

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
    colorConfigDraft = getTurnoColorConfig();
    resetRotationSettingsDraft();
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

    backdrop.querySelector("[data-settings-search]")?.focus();

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
        if (!isWorkspaceOwner() && !canEditMenu("turnos")) {
            alert(
                "Necesitas permiso para editar Turnos y administrar rotativas."
            );
            return;
        }

        openSystemSettings();
    });
}
