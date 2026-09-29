// Calendario Mensual: quien esta de Dia y de Noche cada dia del mes.
//
// Es la planilla que la unidad llevaba en Excel ("Tecnologos Medicos 4° Turno"):
// una fila por dia, la inicial del dia de la semana y, en Dia y en Noche, las
// iniciales de quienes estan de turno. Quien esta CUBRIENDO (reemplazo, turno
// extra o contrato de reemplazo) va en rojo.
//
// No guarda nada propio: se calcula con el mismo motor que el calendario de
// cada trabajador y el timeline, y lo que se hace aqui (quitar a alguien con un
// permiso, cubrir un hueco) se escribe con las mismas funciones que usan ellos.
// Por eso los tres muestran siempre lo mismo.

import { escapeHTML } from "./htmlUtils.js";
import { TURNO } from "./constants.js";
import {
    getProfiles,
    getRotativa,
    getProfileData,
    saveProfileData,
    getReplacements,
    getManualLeaveBalances,
    saveManualLeaveBalances,
    isProfileActive,
    setCurrentProfile,
    getCurrentProfile
} from "./storage.js";
import { getJSON } from "./persistence.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoReal
} from "./turnEngine.js";
import {
    excludeReplacementContractDate,
    getContractForDate,
    hasContractForDate,
    isHonorariaProfile,
    isReplacementProfile
} from "./contracts.js";
import { cancelReplacementById, replacementActive } from "./replacements.js";
import {
    aplicarAdministrativo,
    aplicarAusenciaInjustificada,
    aplicarComp,
    aplicarHalfAdministrativo,
    aplicarLegal,
    aplicarLicencia
} from "./leaveEngine.js";
import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";
import { isShiftUncovered } from "./home.js";
import { canEditTarget } from "./workspacePermissions.js";
import { showAlert, showChoice, showConfirm, showPrompt } from "./dialogs.js";
import { pushHistory } from "./history.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";

const PANEL_ID = "monthlyCalendarPanel";
const WEEKDAY_INITIALS = ["D", "L", "M", "M", "J", "V", "S"];
const MONTH_NAMES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

// Que turnos ocupan la columna Dia y cuales la Noche. El Diurno (08 a 17) no es
// turno de 3er/4to turno: solo cuenta su tramo de noche si es D+N.
const DAY_STATES = new Set([
    TURNO.LARGA,
    TURNO.TURNO24,
    TURNO.MEDIA_MANANA,
    TURNO.MEDIA_TARDE,
    TURNO.TURNO18
]);
const NIGHT_STATES = new Set([
    TURNO.NOCHE,
    TURNO.TURNO24,
    TURNO.DIURNO_NOCHE,
    TURNO.TURNO18
]);
const HALF_LABEL = {
    [TURNO.MEDIA_MANANA]: "½M",
    [TURNO.MEDIA_TARDE]: "½T"
};

const ui = {
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    group: "",
    renderId: 0
};

/* =========================================================
   Iniciales
========================================================= */

function nameWords(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Iniciales de un nombre, con la regla de la unidad: con 2 palabras, las dos;
 * con 3 o mas, la primera y la PENULTIMA (el primer nombre y el apellido
 * paterno): 3 -> 1a y 2a, 4 -> 1a y 3a, 5 -> 1a y 4a, 6 -> 1a y 5a.
 */
export function workerInitials(name) {
    const words = nameWords(name);
    const initial = word => word.charAt(0).toLocaleUpperCase("es-CL");

    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("es-CL");
    if (words.length === 2) return initial(words[0]) + initial(words[1]);

    return initial(words[0]) + initial(words[words.length - 2]);
}

/**
 * Iniciales sin repetir dentro de un grupo: si dos personas comparten las
 * mismas, se agrega la segunda letra del primer nombre ("JaV" y "JoV").
 */
export function initialsMap(names) {
    const byInitials = new Map();

    names.forEach(name => {
        const key = workerInitials(name);

        byInitials.set(key, [...(byInitials.get(key) || []), name]);
    });

    const result = new Map();

    byInitials.forEach((group, key) => {
        if (group.length === 1) {
            result.set(group[0], key);
            return;
        }

        group.forEach(name => {
            const words = nameWords(name);
            const second = (words[0] || "").charAt(1).toLocaleLowerCase("es-CL");

            result.set(name, `${key.charAt(0)}${second}${key.slice(1)}`);
        });
    });

    return result;
}

/* =========================================================
   Grupos (estamento, o estamento y profesion)
========================================================= */

// Filtro por PROFESION (uno a la vez, no se suman). Quien no tiene profesion
// registrada cae en su estamento.
function groupKeyFor(profile) {
    const estamento = String(profile?.estamento || "Sin estamento").trim();
    const profession = String(profile?.profession || "").trim();

    return profession && !/^sin informaci/i.test(profession)
        ? profession
        : estamento;
}

function isShiftRotation(profile) {
    const type = getRotativa(profile.name).type;

    return type === "3turno" || type === "4turno";
}

function monthProfiles(month) {
    const monthStart = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;

    return getProfiles().filter(profile =>
        isProfileActive(profile) ||
        String(profile.unitExitDate || "") >= monthStart
    );
}

/** Los grupos que tienen gente de 3er o 4to turno (los que tiene sentido ver). */
export function monthlyGroups(month = ui.month) {
    const groups = new Set();

    monthProfiles(month)
        .filter(isShiftRotation)
        .forEach(profile => groups.add(groupKeyFor(profile)));

    return [...groups].sort((a, b) => a.localeCompare(b, "es"));
}

/* =========================================================
   Quien esta en cada turno
========================================================= */

function keyFor(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isoFor(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Ausente todo el dia: no esta en el turno aunque su turno siga programado (el
// hueco lo marca isShiftUncovered). El medio administrativo SI trabaja.
function isAwayAllDay(name, keyDay) {
    const admin = getJSON(`admin_${name}`, {});

    return Boolean(
        getJSON(`legal_${name}`, {})[keyDay] ||
        getJSON(`comp_${name}`, {})[keyDay] ||
        getJSON(`absences_${name}`, {})[keyDay] ||
        admin[keyDay] === 1 ||
        admin[keyDay] === true
    );
}

// Su turno propio del dia, con los cambios de turno pero SIN reemplazos: lo que
// tiene de mas es lo que esta cubriendo.
function ownTurn(name, keyDay) {
    return aplicarCambiosTurno(
        name,
        keyDay,
        getTurnoBase(name, keyDay),
        { includeReplacements: false }
    );
}

// Tramos que ocupa el turno de un registro de reemplazo (codigo "L", "N"...).
const CODE_SLOTS = {
    L: ["day"],
    HM: ["day"],
    HT: ["day"],
    N: ["night"],
    "D+N": ["night"],
    "24": ["day", "night"],
    "18": ["day", "night"]
};

/**
 * El motivo de horas extras con que se respaldo el turno de mas de ese tramo,
 * si NO cubre a nadie ("Apoyo pacientes TC oncologicos"). Esos van en su
 * propia columna; quien reemplaza a alguien sigue con los titulares, en rojo.
 */
function extraReasonFor(name, iso, slot) {
    const record = getReplacements().find(item =>
        replacementActive(item) &&
        item.worker === name &&
        item.date === iso &&
        item.source === "manual_extra" &&
        !item.replaced &&
        String(item.reason || "").trim() &&
        (CODE_SLOTS[String(item.turno || "")] || []).includes(slot)
    );

    return record ? String(record.reason).trim() : "";
}

function slotsOf(state) {
    const value = Number(state) || TURNO.LIBRE;

    return {
        day: DAY_STATES.has(value),
        night: NIGHT_STATES.has(value)
    };
}

/**
 * El mes de un grupo: por dia, quienes estan de Dia y de Noche, quienes van en
 * rojo por estar cubriendo, y los huecos (turnos de alguien ausente que nadie
 * cubre todavia).
 */
export async function buildMonthlyCalendar(month = ui.month, group = ui.group) {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const days = new Date(year, monthIndex + 1, 0).getDate();
    const holidays = await fetchHolidays(year);
    const profiles = monthProfiles(month)
        .filter(profile => !group || groupKeyFor(profile) === group);
    const initials = initialsMap(profiles.map(profile => profile.name));
    const rows = [];

    for (let dayNumber = 1; dayNumber <= days; dayNumber++) {
        const date = new Date(year, monthIndex, dayNumber);
        const keyDay = keyFor(date);
        const row = {
            keyDay,
            iso: isoFor(date),
            day: dayNumber,
            weekday: WEEKDAY_INITIALS[date.getDay()],
            business: isBusinessDay(date, holidays),
            slots: { day: [], night: [] },
            gaps: { day: [], night: [] },
            // Motivo de horas extras -> quienes vienen por el (su columna).
            extras: { day: {}, night: {} }
        };

        profiles.forEach(profile => {
            const name = profile.name;
            const own = ownTurn(name, keyDay);
            const ownSlots = slotsOf(own);

            if (isAwayAllDay(name, keyDay)) {
                // Su turno queda como hueco si nadie lo cubre entero.
                if ((ownSlots.day || ownSlots.night) && isShiftUncovered(name, keyDay)) {
                    ["day", "night"].forEach(slot => {
                        if (ownSlots[slot]) {
                            row.gaps[slot].push({
                                name,
                                initials: initials.get(name) || workerInitials(name)
                            });
                        }
                    });
                }
                return;
            }

            const real = Number(getTurnoReal(name, keyDay)) || TURNO.LIBRE;
            const realSlots = slotsOf(real);
            // Quien trabaja por un contrato de reemplazo esta cubriendo todos
            // sus turnos, aunque los herede como propios.
            const byContract =
                isReplacementProfile(name, keyDay) &&
                hasContractForDate(name, keyDay);

            ["day", "night"].forEach(slot => {
                if (!realSlots[slot]) return;

                const person = {
                    name,
                    initials: initials.get(name) || workerInitials(name),
                    covering: byContract || !ownSlots[slot],
                    half: HALF_LABEL[real] || ""
                };
                // Apoyo extra con motivo (no reemplaza a nadie): a la columna
                // de su motivo, sin rojo.
                const reason = !byContract && !ownSlots[slot]
                    ? extraReasonFor(name, row.iso, slot)
                    : "";

                if (reason) {
                    (row.extras[slot][reason] ||= []).push({
                        ...person,
                        covering: false,
                        extraReason: reason
                    });
                    return;
                }

                row.slots[slot].push(person);
            });
        });

        ["day", "night"].forEach(slot => {
            row.slots[slot].sort((a, b) =>
                Number(a.covering) - Number(b.covering) ||
                a.initials.localeCompare(b.initials, "es")
            );
        });

        rows.push(row);

        // Cede el hilo cada semana: un mes de una unidad grande recorre miles
        // de dias-persona.
        if (dayNumber % 7 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // Una columna por motivo distinto del mes, en el orden en que aparecen.
    const extraColumns = { day: [], night: [] };

    rows.forEach(row => {
        ["day", "night"].forEach(slot => {
            Object.keys(row.extras[slot]).forEach(reason => {
                if (!extraColumns[slot].includes(reason)) {
                    extraColumns[slot].push(reason);
                }
            });
        });
    });

    return { year, month: monthIndex, rows, extraColumns };
}

/* =========================================================
   Pintado
========================================================= */

function chipsHTML(list, gaps) {
    const people = list.map(person => `
        <span class="mcal-chip${person.covering ? " is-covering" : ""}" title="${escapeHTML(person.name)}${person.covering ? " (cubriendo)" : ""}">${escapeHTML(person.initials)}${person.half ? `<small>${escapeHTML(person.half)}</small>` : ""}</span>
    `.trim()).join('<span class="mcal-sep">-</span>');
    const holes = gaps.map(gap => `
        <span class="mcal-gap" title="Falta cubrir el turno de ${escapeHTML(gap.name)}">+${escapeHTML(gap.initials)}</span>
    `.trim()).join("");

    return people + (people && holes ? " " : "") + holes || '<span class="mcal-empty">—</span>';
}

function panelHTML(model, groups) {
    const monthLabel = `${MONTH_NAMES[model.month]} ${model.year}`;

    return `
        <div class="mcal">
            <header class="mcal-head">
                <div class="mcal-title">
                    <h2>Calendario Mensual</h2>
                    <p>Quién está de día y de noche. En <span class="mcal-chip is-covering">rojo</span> quien está cubriendo; <span class="mcal-gap">+XX</span> es un turno sin cubrir. Toca una casilla para quitar a alguien o cubrir el hueco.</p>
                </div>
                <div class="mcal-controls">
                    <div class="mcal-filters" role="group" aria-label="Profesión">
                        ${groups.map(group => `
                            <button type="button" class="mcal-filter${group === ui.group ? " is-active" : ""}" data-mcal-group="${escapeHTML(group)}" aria-pressed="${group === ui.group}">${escapeHTML(group)}</button>
                        `).join("")}
                    </div>
                    <div class="mcal-month">
                        <button type="button" data-mcal="prev" aria-label="Mes anterior">‹</button>
                        <strong>${escapeHTML(monthLabel)}</strong>
                        <button type="button" data-mcal="next" aria-label="Mes siguiente">›</button>
                    </div>
                </div>
            </header>
            <div class="mcal-table-wrap">
                <table class="mcal-table">
                    <thead>
                        <tr>
                            <th rowspan="2">Fecha</th>
                            <th rowspan="2"></th>
                            ${["day", "night"].map(slot => `
                                <th colspan="${1 + model.extraColumns[slot].length}" class="mcal-group-head">${slot === "day" ? "Día" : "Noche"}</th>
                            `).join("")}
                        </tr>
                        <tr>
                            ${["day", "night"].map(slot => `
                                <th class="mcal-sub-head">Titulares</th>
                                ${model.extraColumns[slot].map(reason => `
                                    <th class="mcal-sub-head mcal-sub-head--extra" title="Apoyo extra: ${escapeHTML(reason)}">${escapeHTML(reason)}</th>
                                `).join("")}
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${model.rows.map(row => `
                            <tr class="${row.business ? "" : "is-weekend"}">
                                <td class="mcal-date">${row.day}</td>
                                <td class="mcal-weekday">${row.weekday}</td>
                                ${["day", "night"].map(slot => `
                                    <td class="mcal-slot" data-mcal-slot="${slot}" data-mcal-key="${escapeHTML(row.keyDay)}" tabindex="0">${chipsHTML(row.slots[slot], row.gaps[slot])}</td>
                                    ${model.extraColumns[slot].map(reason => `
                                        <td class="mcal-slot mcal-slot--extra" data-mcal-slot="${slot}" data-mcal-key="${escapeHTML(row.keyDay)}" tabindex="0">${(row.extras[slot][reason] || []).length
                                            ? chipsHTML(row.extras[slot][reason], [])
                                            : ""}</td>
                                    `).join("")}
                                `).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

let lastModel = null;

export async function renderMonthlyCalendarPanel() {
    const panel = document.getElementById(PANEL_ID);

    if (!panel) return;

    const renderId = ++ui.renderId;
    const groups = monthlyGroups(ui.month);

    // Siempre hay UNA profesion elegida (los filtros no se suman).
    if (!groups.includes(ui.group)) ui.group = groups[0] || "";

    if (!panel.dataset.bound) {
        panel.dataset.bound = "1";
        panel.addEventListener("click", onPanelClick);
        panel.addEventListener("keydown", event => {
            if (event.key === "Enter" && event.target.closest("[data-mcal-slot]")) {
                onPanelClick(event);
            }
        });
    }

    if (!panel.innerHTML.trim()) {
        panel.innerHTML = `<div class="mcal"><p class="mcal-loading">Armando el mes…</p></div>`;
    }

    const model = await buildMonthlyCalendar(ui.month, ui.group);

    if (renderId !== ui.renderId) return;

    lastModel = model;
    panel.innerHTML = panelHTML(model, groups);
}

/* =========================================================
   Acciones
========================================================= */

const LEAVE_OPTIONS = [
    { value: "admin", label: "Permiso administrativo", days: true, balance: "admin" },
    { value: "half_admin_morning", label: "1/2 administrativo mañana", balance: "admin" },
    { value: "half_admin_afternoon", label: "1/2 administrativo tarde", balance: "admin" },
    { value: "legal", label: "Feriado legal", days: true, balance: "legal" },
    { value: "comp", label: "Feriado compensatorio", days: true, balance: "comp" },
    { value: "license", label: "Licencia médica", days: true },
    { value: "professional_license", label: "Licencia médica profesional", days: true },
    { value: "unpaid_leave", label: "Permiso sin goce", days: true },
    { value: "unjustified", label: "Ausencia injustificada" }
];

// Mismo recurso que Solicitudes y el calendario: el permiso se aplica sobre el
// perfil ABIERTO, asi que se abre el del trabajador y se restaura siempre.
async function withProfile(profileName, task) {
    const previous = getCurrentProfile();

    setCurrentProfile(profileName);

    try {
        return await task();
    } finally {
        setCurrentProfile(previous);
    }
}

function decrementBalance(profileName, field, amount, year) {
    const manual = getManualLeaveBalances(year, profileName);
    const current = Number(manual[field]);

    if (!Number.isFinite(current)) return;

    saveManualLeaveBalances(
        year,
        {
            ...manual,
            [field]: Math.max(0, Math.round((current - amount) * 10) / 10)
        },
        profileName
    );
}

function dateFromKey(keyDay) {
    const [year, month, day] = String(keyDay).split("-").map(Number);

    return new Date(year, month, day);
}

async function applyLeave(profileName, option, date, amount) {
    return withProfile(profileName, async () => {
        switch (option.value) {
            case "admin":
                return aplicarAdministrativo(date, amount, { holdUntilCovered: true });
            case "half_admin_morning":
                return aplicarHalfAdministrativo(date, "M");
            case "half_admin_afternoon":
                return aplicarHalfAdministrativo(date, "T");
            case "legal":
                return aplicarLegal(date, amount, { holdUntilCovered: true });
            case "comp":
                return aplicarComp(date, amount, { holdUntilCovered: true });
            case "license":
            case "professional_license":
            case "unpaid_leave":
                return aplicarLicencia(date, amount, option.value);
            case "unjustified":
                return aplicarAusenciaInjustificada(date);
            default:
                return false;
        }
    });
}

/**
 * Quitar a alguien que esta en su PROPIO turno: se le da un permiso. El hueco
 * que deja aparece como "+XX" para cubrirlo.
 */
async function removeWithLeave(person, keyDay) {
    const name = person.name;
    const date = dateFromKey(keyDay);

    // Honorarios no tiene permisos: se le paga lo que trabaja, asi que quitarlo
    // es dejar ese dia sin turno.
    if (isHonorariaProfile(name, keyDay)) {
        const ok = await showConfirm(
            `${name} es de honorarios: no tiene permisos. Se le quitará el turno de este día.`,
            { title: "Quitar turno", tone: "warning", confirmText: "Quitar turno" }
        );

        if (!ok) return false;

        pushHistory();

        const data = getProfileData(name);

        data[keyDay] = TURNO.LIBRE;
        saveProfileData(data, name);
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Quito turno desde el Calendario Mensual",
            `${name}: sin turno el ${keyDay}.`,
            { profile: name, keyDay }
        );
        return true;
    }

    const value = await showChoice(
        `¿Qué permiso se le da a ${name}?`,
        {
            title: "Quitar del turno",
            confirmText: "Continuar",
            choices: LEAVE_OPTIONS.map(option => ({
                value: option.value,
                label: option.label
            }))
        }
    );

    if (!value) return false;

    const option = LEAVE_OPTIONS.find(item => item.value === value);
    let amount = option.balance === "admin" && !option.days ? 0.5 : 1;

    if (option.days) {
        const typed = await showPrompt(
            `¿Cuántos días de ${option.label.toLowerCase()}? Parte el ${date.toLocaleDateString("es-CL")}.`,
            {
                title: option.label,
                inputType: "number",
                value: option.value === "comp" ? "10" : "1",
                confirmText: "Aplicar"
            }
        );

        if (typed === null) return false;

        amount = Number(typed);

        if (!Number.isFinite(amount) || amount <= 0) {
            await showAlert("Indica una cantidad de días válida.", { tone: "warning" });
            return false;
        }
    }

    pushHistory();

    const applied = await applyLeave(name, option, date, amount);

    if (!applied) {
        await showAlert(
            `No se pudo aplicar ${option.label.toLowerCase()} a ${name}. Revisa sus saldos, que la fecha sea válida para ese permiso y que no choque con otro permiso o licencia.`,
            { title: "No se aplicó el permiso", tone: "warning" }
        );
        return false;
    }

    if (option.balance) {
        decrementBalance(name, option.balance, amount, date.getFullYear());
    }

    return true;
}

/**
 * Quitar a alguien que esta CUBRIENDO: se anula su reemplazo de ese dia (o se
 * excluye el dia de su contrato de reemplazo). El turno del ausente vuelve a
 * quedar como hueco.
 */
async function removeCover(person, keyDay) {
    const name = person.name;
    const iso = isoFor(dateFromKey(keyDay));
    const records = getReplacements().filter(record =>
        replacementActive(record) &&
        record.worker === name &&
        record.date === iso &&
        record.replaced &&
        record.addsShift !== false
    );
    const contract = !records.length &&
        isReplacementProfile(name, keyDay) &&
        getContractForDate(name, keyDay);

    // Turno agregado a mano (no reemplaza a nadie): se quita como en su
    // calendario, devolviendo el dia a su turno base.
    if (!records.length && !contract) {
        return Boolean(await window.offerManualExtraRemoval?.(name, keyDay));
    }

    const covered = records.map(record => record.replaced).filter(Boolean);
    const ok = await showConfirm(
        `Se le quitará a ${name} el turno que cubre ese día` +
        (covered.length ? ` (reemplazo de ${[...new Set(covered)].join(", ")})` : " (contrato de reemplazo)") +
        ". Se le avisará por la aplicación y el turno volverá a quedar sin cubrir." +
        (contract ? " El resto de su contrato se mantiene." : ""),
        {
            title: "Quitar reemplazo",
            tone: "danger",
            confirmText: "Quitar reemplazo",
            destructive: true
        }
    );

    if (!ok) return false;

    pushHistory();

    if (records.length) {
        records.forEach(record => cancelReplacementById(record.id, {
            reason: "coverage_removed",
            details: `El supervisor quito la cobertura del ${keyDay} desde el Calendario Mensual.`
        }));
        return true;
    }

    const excluded = excludeReplacementContractDate({ ...contract, worker: name }, iso);

    if (excluded) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Quito un dia del contrato de reemplazo",
            `${name}: deja de cubrir a ${contract.replaces} el ${keyDay} (Calendario Mensual).`,
            { profile: name, replaced: contract.replaces, keyDay }
        );
        window.dispatchEvent(new CustomEvent("proturnos:calendarProfilesChanged", {
            detail: {
                profiles: [name, contract.replaces].filter(Boolean),
                metadata: {
                    changeType: "replacement_contract_day_removed",
                    source: "replacement_contract",
                    title: "Turno quitado",
                    message: `Se te quitó el turno del ${dateFromKey(keyDay).toLocaleDateString("es-CL")}.`,
                    affectedDates: [iso]
                }
            }
        }));
    }

    return excluded;
}

function closeSlotDialog(backdrop, onKeydown) {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
}

function openSlotDialog(row, slot) {
    // Titulares y, despues, los apoyos extra de ese tramo (con su motivo).
    const people = [
        ...row.slots[slot],
        ...Object.values(row.extras?.[slot] || {}).flat()
    ];
    const gaps = row.gaps[slot];
    const date = dateFromKey(row.keyDay);
    const title = `${slot === "day" ? "Día" : "Noche"} · ${date.toLocaleDateString("es-CL", {
        weekday: "long",
        day: "numeric",
        month: "long"
    })}`;
    const canEdit = canEditTarget("calendarPanel");
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog mcal-dialog" role="dialog" aria-modal="true" aria-labelledby="mcalDialogTitle">
            <strong id="mcalDialogTitle">${escapeHTML(title)}</strong>
            ${people.length ? `
                <ul class="mcal-dialog-list">
                    ${people.map((person, index) => `
                        <li>
                            <span class="mcal-chip${person.covering ? " is-covering" : ""}">${escapeHTML(person.initials)}</span>
                            <span class="mcal-dialog-name">${escapeHTML(person.name)}${person.half ? ` <small>(${escapeHTML(person.half)})</small>` : ""}<small>${person.extraReason ? `Apoyo extra: ${escapeHTML(person.extraReason)}` : person.covering ? "Cubriendo" : "Su turno"}</small></span>
                            ${canEdit ? `<button class="secondary-button" type="button" data-mcal-remove="${index}">Quitar</button>` : ""}
                        </li>
                    `).join("")}
                </ul>
            ` : `<p class="mcal-dialog-empty">Nadie en este turno.</p>`}
            ${gaps.length ? `
                <ul class="mcal-dialog-list mcal-dialog-list--gaps">
                    ${gaps.map((gap, index) => `
                        <li>
                            <span class="mcal-gap">+${escapeHTML(gap.initials)}</span>
                            <span class="mcal-dialog-name">Falta cubrir el turno de ${escapeHTML(gap.name)}<small>Está con permiso o ausencia</small></span>
                            ${canEdit ? `<button class="primary-button" type="button" data-mcal-cover="${index}">Cubrir</button>` : ""}
                        </li>
                    `).join("")}
                </ul>
            ` : ""}
            ${canEdit ? "" : `<p class="mcal-dialog-empty">Tu usuario tiene permiso solo de lectura en Turnos.</p>`}
            <div class="turn-change-dialog__actions">
                <button class="ghost-button" type="button" data-mcal-close>Cerrar</button>
            </div>
        </section>
    `;

    const onKeydown = event => {
        if (event.key === "Escape") closeSlotDialog(backdrop, onKeydown);
    };

    backdrop.addEventListener("click", async event => {
        if (event.target === backdrop || event.target.closest("[data-mcal-close]")) {
            closeSlotDialog(backdrop, onKeydown);
            return;
        }

        const removeButton = event.target.closest("[data-mcal-remove]");
        const coverButton = event.target.closest("[data-mcal-cover]");

        if (removeButton) {
            const person = people[Number(removeButton.dataset.mcalRemove)];

            if (!person) return;

            closeSlotDialog(backdrop, onKeydown);

            // Apoyo extra: se quita el turno agregado, sin permiso. Quien
            // cubre: se anula su cobertura. Su propio turno: con un permiso.
            const changed = person.extraReason
                ? Boolean(await window.offerManualExtraRemoval?.(person.name, row.keyDay))
                : person.covering
                ? await removeCover(person, row.keyDay)
                : await removeWithLeave(person, row.keyDay);

            if (changed) await renderMonthlyCalendarPanel();
            return;
        }

        if (coverButton) {
            const gap = gaps[Number(coverButton.dataset.mcalCover)];

            if (!gap) return;

            closeSlotDialog(backdrop, onKeydown);
            // Las sugerencias de siempre: quienes estan libres y pueden cubrir.
            // Al asignar, el cambio llega por el evento de persistencia y el
            // mes se vuelve a pintar solo.
            await window.openReplacementDialog?.(gap.name, row.keyDay);
        }
    });

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
}

function onPanelClick(event) {
    // Un filtro a la vez: tocar una profesion muestra SOLO esa.
    const filter = event.target.closest("[data-mcal-group]");

    if (filter) {
        ui.group = filter.dataset.mcalGroup;
        void renderMonthlyCalendarPanel();
        return;
    }

    const nav = event.target.closest("[data-mcal='prev'], [data-mcal='next']");

    if (nav) {
        const step = nav.dataset.mcal === "next" ? 1 : -1;

        ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + step, 1);
        void renderMonthlyCalendarPanel();
        return;
    }

    const cell = event.target.closest("[data-mcal-slot]");

    if (!cell || !lastModel) return;

    const row = lastModel.rows.find(item => item.keyDay === cell.dataset.mcalKey);

    if (row) openSlotDialog(row, cell.dataset.mcalSlot);
}

/* =========================================================
   Se vuelve a pintar cuando cambian los datos (aqui, en el calendario, en el
   timeline o en otra sesion), solo si la vista esta abierta.
========================================================= */

let refreshTimer = null;

function scheduleRefresh() {
    if (document.body?.dataset?.activeView !== "monthly") return;

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        void renderMonthlyCalendarPanel();
    }, 400);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("proturnos:persistenceChanged", scheduleRefresh);
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type === "app-state-entries-applied") scheduleRefresh();
    });
}
