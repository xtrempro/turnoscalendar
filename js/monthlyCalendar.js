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
    getContractsForProfile,
    isHonorariaProfile,
    isReplacementProfile
} from "./contracts.js";
import {
    cancelReplacementById,
    replacementActive,
    setManualExtraReason
} from "./replacements.js";
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
    renderId: 0,
    // Los motivos con poca gente se ven agrupados hasta que se expanden.
    expanded: { day: false, night: false },
    // "mes|grupo" -> { day: [motivo], night: [motivo] } agregados con el "+".
    addedColumns: {}
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

/**
 * Los filtros, en el orden en que se muestran: primero los profesionales y,
 * entre ellos, la profesion con mas trabajadores (es la que se abre al entrar);
 * despues el resto, tambien de mas a menos.
 */
export function monthlyGroups(month = ui.month) {
    const groups = new Map();

    monthProfiles(month)
        .filter(isShiftRotation)
        .forEach(profile => {
            const key = groupKeyFor(profile);
            const group = groups.get(key) || { key, count: 0, professionals: 0 };

            group.count += 1;
            if (/^profesional/i.test(String(profile.estamento || "").trim())) {
                group.professionals += 1;
            }
            groups.set(key, group);
        });

    const isProfessional = group => group.professionals * 2 > group.count;

    return [...groups.values()]
        .sort((a, b) =>
            Number(isProfessional(b)) - Number(isProfessional(a)) ||
            b.count - a.count ||
            a.key.localeCompare(b.key, "es")
        )
        .map(group => group.key);
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

/**
 * Lo que un calculo del mes lee UNA vez. Antes cada dia de cada trabajador
 * volvia a leer del almacenamiento local sus cuatro mapas de permisos y la
 * lista entera de reemplazos (cientos), y en un equipo del hospital el mes
 * tardaba tanto que el navegador ofrecia "esperar o cerrar".
 */
function buildReadContext() {
    const leaves = new Map();
    const recordsByWorkerDay = new Map();

    getReplacements().forEach(item => {
        if (!replacementActive(item) || !item.worker || !item.date) return;

        const key = `${item.worker}|${item.date}`;

        recordsByWorkerDay.set(key, [...(recordsByWorkerDay.get(key) || []), item]);
    });

    return {
        leavesOf(name) {
            if (!leaves.has(name)) {
                leaves.set(name, {
                    admin: getJSON(`admin_${name}`, {}),
                    legal: getJSON(`legal_${name}`, {}),
                    comp: getJSON(`comp_${name}`, {}),
                    absences: getJSON(`absences_${name}`, {})
                });
            }

            return leaves.get(name);
        },
        recordsOf(name, iso) {
            return recordsByWorkerDay.get(`${name}|${iso}`) || [];
        },
        // Solo quien tiene contratos de reemplazo puede estar cubriendo por
        // contrato: a los demas no se les pregunta dia por dia su tipo de
        // contrato, que es de lo mas caro del calculo.
        withContracts: new Set(
            getProfiles()
                .map(profile => profile.name)
                .filter(name => getContractsForProfile(name).length)
        )
    };
}

// Ausente todo el dia: no esta en el turno aunque su turno siga programado (el
// hueco lo marca isShiftUncovered). El medio administrativo SI trabaja.
function isAwayAllDay(name, keyDay, ctx) {
    const { admin, legal, comp, absences } = ctx.leavesOf(name);

    return Boolean(
        legal[keyDay] ||
        comp[keyDay] ||
        absences[keyDay] ||
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
// `rota_gap`: el que sale del modal de sugerencias al agregar a alguien en la
// columna de un motivo (el mismo registro que usa la Brecha RRHH del inicio).
const EXTRA_SOURCES = new Set(["manual_extra", "rota_gap"]);

function extraRecordFor(name, iso, slot, ctx) {
    return ctx.recordsOf(name, iso).find(item =>
        EXTRA_SOURCES.has(item.source) &&
        !item.replaced &&
        String(item.reason || "").trim() &&
        (CODE_SLOTS[String(item.turno || "")] || []).includes(slot)
    ) || null;
}

/**
 * A quien cubre y por que permiso, para el texto al pasar el mouse:
 * "Juan Zapata (Licencia Médica)". Sale del reemplazo del dia, o del contrato
 * de reemplazo si cubre por contrato.
 */
function coverDetailFor(name, keyDay, iso, slot, byContract, ctx) {
    if (byContract) {
        const contract = getContractForDate(name, keyDay);

        return contract?.replaces
            ? `${contract.replaces}${contract.reason ? ` (${contract.reason})` : ""}`
            : "";
    }

    const records = ctx.recordsOf(name, iso).filter(item =>
        item.replaced &&
        (
            !CODE_SLOTS[String(item.turno || "")] ||
            CODE_SLOTS[String(item.turno || "")].includes(slot)
        )
    );

    return [...new Set(records.map(item =>
        `${item.replaced}${item.absenceType ? ` (${item.absenceType})` : ""}`
    ))].join(", ");
}

function personTitle(person) {
    if (person.extraReason) {
        return `${person.name} — apoyo extra: ${person.extraReason}`;
    }

    if (!person.covering) return person.name;

    return person.coverDetail
        ? `${person.name} — cubre a ${person.coverDetail}`
        : `${person.name} — turno agregado sin motivo registrado`;
}

function slotsOf(state) {
    const value = Number(state) || TURNO.LIBRE;

    return {
        day: DAY_STATES.has(value),
        night: NIGHT_STATES.has(value)
    };
}

const SLICE_MS = 12;

function nowMs() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Devuelve el hilo al navegador (clics, pintado) y vuelve enseguida: setTimeout
// puede tardar 4-15 ms en volver, y el mes cede decenas de veces.
function yieldToBrowser() {
    if (typeof globalThis.scheduler?.yield === "function") {
        return globalThis.scheduler.yield();
    }

    if (typeof MessageChannel === "function") {
        return new Promise(resolve => {
            const channel = new MessageChannel();

            channel.port1.onmessage = () => {
                channel.port1.close();
                resolve();
            };
            channel.port2.postMessage(null);
        });
    }

    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * El mes de un grupo: por dia, quienes estan de Dia y de Noche, quienes van en
 * rojo por estar cubriendo, y los huecos (turnos de alguien ausente que nadie
 * cubre todavia). `shouldContinue` permite abandonar un calculo que ya no sirve (se pidio otro
 * mes, otro filtro o llegaron datos nuevos): devuelve null en ese caso.
 */
export async function buildMonthlyCalendar(
    month = ui.month,
    group = ui.group,
    { shouldContinue = () => true } = {}
) {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const days = new Date(year, monthIndex + 1, 0).getDate();
    const holidays = await fetchHolidays(year);
    const profiles = monthProfiles(month)
        .filter(profile => !group || groupKeyFor(profile) === group);
    const initials = initialsMap(profiles.map(profile => profile.name));
    const ctx = buildReadContext();
    const rows = [];
    let sliceStart = nowMs();

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

        for (const profile of profiles) {
            // Cede el hilo por TIEMPO, no por dias: con muchos trabajadores una
            // sola semana ya bloqueaba la pantalla.
            if (nowMs() - sliceStart > SLICE_MS) {
                await yieldToBrowser();
                if (!shouldContinue()) return null;
                sliceStart = nowMs();
            }

            const name = profile.name;
            const own = ownTurn(name, keyDay);
            const ownSlots = slotsOf(own);

            if (isAwayAllDay(name, keyDay, ctx)) {
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
                continue;
            }

            const real = Number(getTurnoReal(name, keyDay)) || TURNO.LIBRE;
            const realSlots = slotsOf(real);
            // Quien trabaja por un contrato de reemplazo esta cubriendo todos
            // sus turnos, aunque los herede como propios.
            const byContract =
                ctx.withContracts.has(name) &&
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
                const extraRecord = !byContract && !ownSlots[slot]
                    ? extraRecordFor(name, row.iso, slot, ctx)
                    : null;
                const reason = extraRecord
                    ? String(extraRecord.reason).trim()
                    : "";

                if (reason) {
                    (row.extras[slot][reason] ||= []).push({
                        ...person,
                        covering: false,
                        extraReason: reason,
                        // Para moverlo a otro motivo arrastrandolo.
                        extraId: String(extraRecord.id || ""),
                        // manual_extra se quita en el calendario (el turno
                        // esta escrito en su dia); rota_gap anulando el registro.
                        extraSource: String(extraRecord.source || "")
                    });
                    return;
                }

                if (person.covering) {
                    person.coverDetail = coverDetailFor(
                        name,
                        keyDay,
                        row.iso,
                        slot,
                        byContract,
                        ctx
                    );
                }

                row.slots[slot].push(person);
            });
        }

        ["day", "night"].forEach(slot => {
            row.slots[slot].sort((a, b) =>
                Number(a.covering) - Number(b.covering) ||
                a.initials.localeCompare(b.initials, "es")
            );
        });

        rows.push(row);
    }

    // Una columna por motivo distinto del mes, en el orden en que aparecen, y
    // cuantas veces aparece cada uno (para agrupar los de poca gente).
    const extraColumns = { day: [], night: [] };
    const extraCounts = { day: {}, night: {} };

    rows.forEach(row => {
        ["day", "night"].forEach(slot => {
            Object.entries(row.extras[slot]).forEach(([reason, people]) => {
                if (!extraColumns[slot].includes(reason)) {
                    extraColumns[slot].push(reason);
                }

                extraCounts[slot][reason] =
                    (extraCounts[slot][reason] || 0) + people.length;
            });
        });
    });

    const historyReasons = extraHistory(year, monthIndex, group);
    // Las tareas recurrentes de los meses anteriores se ven aunque este mes
    // todavia no tengan a nadie: asi se puede ir llenando el mes que viene.
    // Solo del mes en curso en adelante (el pasado queda como fue).
    const now = new Date();
    const upcoming = year * 12 + monthIndex >= now.getFullYear() * 12 + now.getMonth();
    const pinnedColumns = { day: [], night: [] };

    if (upcoming) {
        ["day", "night"].forEach(slot => {
            historyReasons[slot]
                .filter(item => item.recurrent)
                .forEach(({ reason }) => {
                    if (!extraColumns[slot].includes(reason)) extraColumns[slot].push(reason);
                    pinnedColumns[slot].push(reason);
                });
        });
    }

    return applyAddedColumns({
        year,
        month: monthIndex,
        group,
        rows,
        extraColumns,
        extraCounts,
        pinnedColumns,
        historyReasons
    });
}

// El "+" ofrece los motivos de los ultimos tres meses; uno que no este ahi se
// crea desde el mismo modal.
const HISTORY_MONTHS = 3;
const RECENT_MONTHS = 3;

/**
 * Los motivos de apoyo extra del grupo en los meses anteriores, por tramo: en
 * cuantos meses aparecio cada uno, y si es RECURRENTE (en al menos dos de los
 * ultimos tres meses con apoyos; si solo uno los tuvo, basta ese).
 */
export function extraHistory(year, monthIndex, group) {
    const names = new Set(
        getProfiles()
            .filter(profile => !group || groupKeyFor(profile) === group)
            .map(profile => profile.name)
    );
    const current = year * 12 + monthIndex;
    const bySlot = { day: new Map(), night: new Map() };

    getReplacements().forEach(item => {
        const reason = String(item?.reason || "").trim();

        if (
            !reason ||
            item.replaced ||
            !EXTRA_SOURCES.has(item.source) ||
            !replacementActive(item) ||
            !names.has(item.worker)
        ) {
            return;
        }

        const [y, m] = String(item.date || "").split("-").map(Number);
        const abs = y * 12 + m - 1;

        if (!Number.isFinite(abs) || abs >= current || abs < current - HISTORY_MONTHS) return;

        (CODE_SLOTS[String(item.turno || "")] || []).forEach(slot => {
            const months = bySlot[slot].get(reason) || new Set();

            months.add(abs);
            bySlot[slot].set(reason, months);
        });
    });

    const result = {};

    ["day", "night"].forEach(slot => {
        const isRecent = abs => abs >= current - RECENT_MONTHS;
        const recentWithData = new Set(
            [...bySlot[slot].values()].flatMap(months => [...months].filter(isRecent))
        ).size;

        result[slot] = [...bySlot[slot].entries()]
            .map(([reason, months]) => {
                const recent = [...months].filter(isRecent).length;

                return {
                    reason,
                    months: months.size,
                    recurrent: recent > 0 && recent >= Math.min(2, recentWithData)
                };
            })
            .sort((a, b) =>
                b.months - a.months ||
                a.reason.localeCompare(b.reason, "es")
            );
    });

    return result;
}

// Tareas que el supervisor agrego a mano con el "+" (no recurrentes). Viven
// mientras la pagina esta abierta: en cuanto alguien queda en ellas, la
// columna se sostiene sola.
function addedColumnsKey(model) {
    return `${model.year}-${model.month}|${model.group}`;
}

function applyAddedColumns(model) {
    const added = ui.addedColumns[addedColumnsKey(model)] || {};

    ["day", "night"].forEach(slot => {
        (added[slot] || []).forEach(reason => {
            if (!model.extraColumns[slot].includes(reason)) model.extraColumns[slot].push(reason);
            if (!model.pinnedColumns[slot].includes(reason)) model.pinnedColumns[slot].push(reason);
        });
    });

    return model;
}

// Un motivo con menos apariciones que esto en el mes va a "Otros motivos".
export const SMALL_EXTRA_COLUMN = 3;

/**
 * Las columnas de apoyo extra que se dibujan en un tramo: cada motivo con
 * bastante gente en la suya, y los de poca gente juntos en una sola ("Otros
 * motivos"), salvo que el supervisor la haya expandido. Uno solo de poca
 * gente no se agrupa: una columna "Otros" con un motivo no ahorra nada.
 */
// Poca gente este mes, y no es una tarea fijada (recurrente o agregada con el
// "+", que se ven aunque esten vacias).
function isSmallColumn(model, slot, reason) {
    return (model.extraCounts?.[slot]?.[reason] || 0) < SMALL_EXTRA_COLUMN &&
        !(model.pinnedColumns?.[slot] || []).includes(reason);
}

export function visibleExtraColumns(model, slot, expanded = false) {
    const reasons = model.extraColumns[slot] || [];
    const small = reasons.filter(reason => isSmallColumn(model, slot, reason));

    if (expanded || small.length < 2) {
        return reasons.map(reason => ({ kind: "reason", reason }));
    }

    return [
        ...reasons
            .filter(reason => !small.includes(reason))
            .map(reason => ({ kind: "reason", reason })),
        { kind: "group", reasons: small }
    ];
}

function canGroupExtras(model, slot) {
    return (model.extraColumns[slot] || [])
        .filter(reason => isSmallColumn(model, slot, reason))
        .length >= 2;
}

// Tareas de meses anteriores que no estan en el mes: las que ofrece el "+".
function addableHistoryReasons(model, slot) {
    return (model.historyReasons?.[slot] || [])
        .filter(item => !model.extraColumns[slot].includes(item.reason));
}

/* =========================================================
   Pintado
========================================================= */

// `drag`: los apoyos extra se pueden arrastrar a la columna de otro motivo.
function chipsHTML(list, gaps, { drag = null } = {}) {
    const people = list.map(person => {
        const draggable = drag && person.extraId
            ? ` draggable="true" data-mcal-drag="${escapeHTML(person.extraId)}" data-mcal-drag-key="${escapeHTML(drag.keyDay)}" data-mcal-drag-slot="${escapeHTML(drag.slot)}" data-mcal-drag-reason="${escapeHTML(person.extraReason)}" data-mcal-drag-name="${escapeHTML(person.name)}"`
            : "";

        return `
            <span class="mcal-chip${person.covering ? " is-covering" : ""}${draggable ? " is-draggable" : ""}" title="${escapeHTML(personTitle(person))}"${draggable}>${escapeHTML(person.initials)}${person.half ? `<small>${escapeHTML(person.half)}</small>` : ""}</span>
        `.trim();
    }).join('<span class="mcal-sep">-</span>');
    const holes = gaps.map(gap => `
        <span class="mcal-gap" title="Falta cubrir el turno de ${escapeHTML(gap.name)}">+${escapeHTML(gap.initials)}</span>
    `.trim()).join("");

    return people + (people && holes ? " " : "") + holes || '<span class="mcal-empty">—</span>';
}

/**
 * Una casilla de apoyo extra. La de un motivo recibe a quien se arrastra desde
 * otro motivo; la agrupada ("Otros motivos") junta a todos y, al pasar el
 * mouse, dice el motivo de cada uno.
 */
function extraCellHTML(row, slot, column, canEdit, index) {
    const drag = canEdit ? { keyDay: row.keyDay, slot } : null;
    // `data-mcal-col`: la columna (su posicion entre las de motivo), para que
    // el clic muestre solo a los de esa casilla y agregue con ESE motivo.
    const base = `class="mcal-slot mcal-slot--extra" data-mcal-slot="${slot}" data-mcal-key="${escapeHTML(row.keyDay)}" data-mcal-col="${index}" tabindex="0"`;

    if (column.kind === "group") {
        const people = column.reasons.flatMap(reason => row.extras[slot][reason] || []);
        const title = people
            .map(person => `${person.name} — ${person.extraReason}`)
            .join("\n");

        return `<td ${base}${title ? ` title="${escapeHTML(title)}"` : ""}>${people.length
            ? chipsHTML(people, [], { drag })
            : ""}</td>`;
    }

    const people = row.extras[slot][column.reason] || [];

    return `<td ${base} data-mcal-drop-reason="${escapeHTML(column.reason)}">${people.length
        ? chipsHTML(people, [], { drag })
        : ""}</td>`;
}

function panelHTML(model, groups) {
    const monthLabel = `${MONTH_NAMES[model.month]} ${model.year}`;
    const slots = ["day", "night"];
    const columns = {
        day: visibleExtraColumns(model, "day", ui.expanded.day),
        night: visibleExtraColumns(model, "night", ui.expanded.night)
    };
    const canEdit = canEditTarget("calendarPanel");

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
                            ${slots.map(slot => `
                                <th colspan="${1 + columns[slot].length}" class="mcal-group-head">
                                    ${slot === "day" ? "Día" : "Noche"}
                                    ${ui.expanded[slot] && canGroupExtras(model, slot)
                                        ? `<button type="button" class="mcal-fold" data-mcal-collapse="${slot}" title="Agrupar los motivos con poca gente">− Agrupar</button>`
                                        : ""}
                                    ${canEdit
                                        ? `<button type="button" class="mcal-fold" data-mcal-add-column="${slot}" title="Agregar una tarea de los ultimos meses o crear una nueva">+ Tarea</button>`
                                        : ""}
                                </th>
                            `).join("")}
                        </tr>
                        <tr>
                            ${slots.map(slot => `
                                <th class="mcal-sub-head">Titulares</th>
                                ${columns[slot].map(column => column.kind === "group"
                                    ? `
                                        <th class="mcal-sub-head mcal-sub-head--extra mcal-sub-head--group" title="${escapeHTML(column.reasons.join("\n"))}">
                                            Otros motivos (${column.reasons.length})
                                            <button type="button" class="mcal-fold" data-mcal-expand="${slot}" title="Ver cada motivo en su columna">+</button>
                                        </th>
                                    `
                                    : `
                                        <th class="mcal-sub-head mcal-sub-head--extra" title="Apoyo extra: ${escapeHTML(column.reason)}">${escapeHTML(column.reason)}</th>
                                    `).join("")}
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${model.rows.map(row => `
                            <tr class="${row.business ? "" : "is-weekend"}">
                                <td class="mcal-date">${row.day}</td>
                                <td class="mcal-weekday">${row.weekday}</td>
                                ${slots.map(slot => `
                                    <td class="mcal-slot" data-mcal-slot="${slot}" data-mcal-key="${escapeHTML(row.keyDay)}" data-mcal-col="titulares" tabindex="0">${chipsHTML(row.slots[slot], row.gaps[slot])}</td>
                                    ${columns[slot].map((column, index) => extraCellHTML(row, slot, column, canEdit, index)).join("")}
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
        panel.addEventListener("dragstart", onDragStart);
        panel.addEventListener("dragover", onDragOver);
        panel.addEventListener("dragleave", onDragLeave);
        panel.addEventListener("drop", onDrop);
        panel.addEventListener("dragend", onDragEnd);
        panel.addEventListener("keydown", event => {
            if (event.key === "Enter" && event.target.closest("[data-mcal-slot]")) {
                onPanelClick(event);
            }
        });
    }

    if (!panel.innerHTML.trim()) {
        panel.innerHTML = `<div class="mcal"><p class="mcal-loading">Armando el mes…</p></div>`;
    }

    const model = await buildMonthlyCalendar(ui.month, ui.group, {
        shouldContinue: () => renderId === ui.renderId
    });

    if (!model || renderId !== ui.renderId) return;

    lastModel = model;
    paintModel(panel, model, groups);
}

function paintModel(panel, model, groups) {
    // La tabla se desplaza sola: al repintar tras un cambio, que no salte al
    // principio del mes.
    const previousWrap = panel.querySelector(".mcal-table-wrap");
    const scroll = previousWrap
        ? { top: previousWrap.scrollTop, left: previousWrap.scrollLeft }
        : null;

    panel.innerHTML = panelHTML(model, groups);

    const wrap = panel.querySelector(".mcal-table-wrap");
    const firstHeadRow = wrap?.querySelector("thead tr");

    // La segunda fila del encabezado se fija justo debajo de la primera, que
    // puede crecer (boton "Agrupar", motivos largos).
    if (firstHeadRow?.offsetHeight) {
        wrap.style.setProperty("--mcal-head-row", `${firstHeadRow.offsetHeight}px`);
    }

    if (wrap && scroll) {
        wrap.scrollTop = scroll.top;
        wrap.scrollLeft = scroll.left;
    }
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

/* ---------- Arrastrar un apoyo extra a otro motivo ----------

   Solo dentro de la MISMA casilla de dia y tramo (el apoyo es de ese turno) y
   hacia una columna de un motivo concreto: la agrupada tiene varios y no se
   sabria cual poner. Al soltar se cambia el motivo del respaldo; si en la
   columna de origen no queda nadie en el mes, desaparece sola al repintar. */

let dragState = null;

function dropTargetFor(event) {
    const cell = event.target.closest("[data-mcal-drop-reason]");

    if (
        !cell ||
        !dragState ||
        cell.dataset.mcalKey !== dragState.keyDay ||
        cell.dataset.mcalSlot !== dragState.slot ||
        cell.dataset.mcalDropReason === dragState.reason
    ) {
        return null;
    }

    return cell;
}

function clearDropHighlights(panel) {
    panel.querySelectorAll(".is-drop-target").forEach(cell =>
        cell.classList.remove("is-drop-target")
    );
}

function onDragStart(event) {
    const chip = event.target.closest("[data-mcal-drag]");

    if (!chip) return;

    dragState = {
        extraId: chip.dataset.mcalDrag,
        keyDay: chip.dataset.mcalDragKey,
        slot: chip.dataset.mcalDragSlot,
        reason: chip.dataset.mcalDragReason,
        name: chip.dataset.mcalDragName
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragState.extraId);
}

function onDragOver(event) {
    const cell = dropTargetFor(event);

    if (!cell) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    cell.classList.add("is-drop-target");
}

function onDragLeave(event) {
    event.target.closest("[data-mcal-drop-reason]")
        ?.classList.remove("is-drop-target");
}

async function onDrop(event) {
    const cell = dropTargetFor(event);
    const panel = event.currentTarget;

    clearDropHighlights(panel);

    if (!cell) return;

    event.preventDefault();

    const moving = dragState;
    const nextReason = cell.dataset.mcalDropReason;

    dragState = null;
    pushHistory();

    if (setManualExtraReason(moving.extraId, nextReason)) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Cambio el motivo de horas extras",
            `${moving.name}: el ${moving.keyDay} pasa de "${moving.reason}" a "${nextReason}" (Calendario Mensual).`,
            { profile: moving.name, keyDay: moving.keyDay }
        );
    }

    await renderMonthlyCalendarPanel();
}

function onDragEnd(event) {
    dragState = null;
    clearDropHighlights(event.currentTarget);
}

function closeSlotDialog(backdrop, onKeydown) {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
}

const TITULARES_COLUMN = { kind: "titulares" };

// La columna de una casilla: titulares, un motivo o "Otros motivos".
function columnForCell(cell) {
    const slot = cell.dataset.mcalSlot;
    const col = cell.dataset.mcalCol;

    if (!lastModel || col === undefined || col === "titulares") {
        return TITULARES_COLUMN;
    }

    return visibleExtraColumns(lastModel, slot, ui.expanded[slot])[Number(col)] ||
        TITULARES_COLUMN;
}

function columnReasons(column) {
    if (column.kind === "reason") return [column.reason];
    if (column.kind === "group") return column.reasons;
    return [];
}

// Solo la gente de ESA casilla, no todo el tramo.
function columnPeople(row, slot, column) {
    if (column.kind === "titulares") return row.slots[slot];

    return columnReasons(column).flatMap(reason => row.extras?.[slot]?.[reason] || []);
}

function columnLabel(column) {
    if (column.kind === "reason") return column.reason;
    if (column.kind === "group") return "Otros motivos";
    return "Titulares";
}

function slotDateLabel(keyDay) {
    return dateFromKey(keyDay).toLocaleDateString("es-CL", {
        weekday: "long",
        day: "numeric",
        month: "long"
    });
}

/**
 * Agregar a alguien a la columna de un motivo: el modal de sugerencias de
 * siempre, en su modo de turno extra con motivo (no reemplaza a nadie). Lo que
 * se guarda lleva el motivo de la columna.
 */
async function addToColumn(row, slot, column) {
    const reasons = columnReasons(column);

    if (!reasons.length) return;

    const reason = reasons.length === 1
        ? reasons[0]
        : await showChoice("¿Con qué motivo se agrega?", {
            title: "Agregar apoyo extra",
            confirmText: "Continuar",
            choices: reasons.map(item => ({ value: item, label: item }))
        });

    if (!reason) return;

    // El modal busca candidatos "como" un perfil de molde: uno del grupo que
    // ya esta en ese turno (no se puede agregar a si mismo), o cualquiera.
    const groupProfiles = monthProfiles(ui.month)
        .filter(profile => groupKeyFor(profile) === ui.group);
    const onShift = new Set(row.slots[slot].map(person => person.name));
    const reference =
        groupProfiles.find(profile => onShift.has(profile.name)) ||
        groupProfiles[0];

    if (!reference) return;

    await window.openReplacementDialog?.(reference.name, row.keyDay, {
        rota: {
            group: ui.group,
            estamento: reference.estamento,
            label: ui.group,
            turno: slot === "day" ? TURNO.LARGA : TURNO.NOCHE,
            motive: reason,
            description: `Agregar a alguien de ${slot === "day" ? "Día" : "Noche"} el ${slotDateLabel(row.keyDay)} por: ${reason}. No reemplaza a nadie: queda como horas extras con ese motivo.`
        }
    });
}

async function removeExtra(person, keyDay) {
    // El agregado desde el modal de sugerencias no esta escrito en el dia: se
    // anula su registro.
    if (person.extraSource === "rota_gap") {
        const ok = await showConfirm(
            `Se quitará a ${person.name} del apoyo "${person.extraReason}" el ${slotDateLabel(keyDay)}.`,
            {
                title: "Quitar apoyo extra",
                tone: "danger",
                confirmText: "Quitar",
                cancelText: "Volver",
                destructive: true
            }
        );

        if (!ok) return false;

        pushHistory();

        return Boolean(cancelReplacementById(person.extraId, {
            reason: "extra_removed",
            details: `El supervisor quito el apoyo extra (${person.extraReason}) desde el Calendario Mensual.`,
            canceledBy: "Calendario Mensual"
        }));
    }

    return Boolean(await window.offerManualExtraRemoval?.(person.name, keyDay));
}

function openSlotDialog(row, slot, column = TITULARES_COLUMN) {
    const people = columnPeople(row, slot, column);
    const isTitulares = column.kind === "titulares";
    // Los huecos son de los titulares: en una columna de motivo no se cubre a
    // nadie, se agrega.
    const gaps = isTitulares ? row.gaps[slot] : [];
    const title = `${slot === "day" ? "Día" : "Noche"} · ${slotDateLabel(row.keyDay)}`;
    const canEdit = canEditTarget("calendarPanel");
    const backdrop = document.createElement("div");

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog mcal-dialog" role="dialog" aria-modal="true" aria-labelledby="mcalDialogTitle">
            <strong id="mcalDialogTitle">${escapeHTML(title)}</strong>
            <p class="mcal-dialog-column">${escapeHTML(columnLabel(column))}</p>
            ${people.length ? `
                <ul class="mcal-dialog-list">
                    ${people.map((person, index) => `
                        <li>
                            <span class="mcal-chip${person.covering ? " is-covering" : ""}">${escapeHTML(person.initials)}</span>
                            <span class="mcal-dialog-name">${escapeHTML(person.name)}${person.half ? ` <small>(${escapeHTML(person.half)})</small>` : ""}<small>${person.extraReason
                                ? `Apoyo extra: ${escapeHTML(person.extraReason)}`
                                : person.covering
                                    ? (person.coverDetail ? `Cubre a ${escapeHTML(person.coverDetail)}` : "Turno agregado sin motivo")
                                    : "Su turno"}</small></span>
                            ${canEdit ? `<button class="secondary-button" type="button" data-mcal-remove="${index}">Quitar</button>` : ""}
                        </li>
                    `).join("")}
                </ul>
            ` : `<p class="mcal-dialog-empty">${isTitulares ? "Nadie en este turno." : "Nadie con este motivo."}</p>`}
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
                ${canEdit && !isTitulares ? `<button class="primary-button" type="button" data-mcal-add>Agregar a alguien</button>` : ""}
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

        if (event.target.closest("[data-mcal-add]")) {
            closeSlotDialog(backdrop, onKeydown);
            await addToColumn(row, slot, column);
            return;
        }

        if (removeButton) {
            const person = people[Number(removeButton.dataset.mcalRemove)];

            if (!person) return;

            closeSlotDialog(backdrop, onKeydown);

            // Apoyo extra: se quita el turno agregado, sin permiso. Quien
            // cubre: se anula su cobertura. Su propio turno: con un permiso.
            const changed = person.extraReason
                ? await removeExtra(person, row.keyDay)
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

// "+ Tarea": una tarea de meses anteriores que no es de las recurrentes.
async function addHistoricalColumn(slot) {
    const model = lastModel;

    if (!model) return;

    const options = addableHistoryReasons(model, slot);
    const slotLabel = slot === "day" ? "Día" : "Noche";
    const NEW_TASK = "__mcal_new_task__";
    // Sin motivos recientes que ofrecer, directo a escribir uno nuevo.
    let reason = options.length
        ? await showChoice(
            `¿Qué tarea agregar a ${slotLabel}? Son los motivos de los últimos 3 meses.`,
            {
                title: "Agregar tarea",
                confirmText: "Agregar",
                choices: options.map(item => ({
                    value: item.reason,
                    label: `${item.reason} (${item.months} ${item.months === 1 ? "mes" : "meses"})`
                })),
                extraActions: [{ text: "Crear tarea nueva", value: NEW_TASK }]
            }
        )
        : NEW_TASK;

    if (reason === NEW_TASK) {
        reason = String(await showPrompt(
            `Nombre de la tarea nueva para ${slotLabel} (queda como motivo de horas extras de quien agregues en ella).`,
            {
                title: "Crear tarea nueva",
                placeholder: "Ej.: Apoyo Clínico TC",
                confirmText: "Crear"
            }
        ) || "").trim();

        // Si ya existe con otras mayusculas, se usa la que hay: dos columnas
        // "Calidad" y "calidad" partirian las horas extras en dos motivos.
        const known = [
            ...model.extraColumns[slot],
            ...(model.historyReasons?.[slot] || []).map(item => item.reason)
        ].find(item => item.toLocaleLowerCase("es") === reason.toLocaleLowerCase("es"));

        if (known) reason = known;
    }

    if (!reason || model !== lastModel) return;

    const key = addedColumnsKey(model);
    const added = ui.addedColumns[key] ||= { day: [], night: [] };

    if (!added[slot].includes(reason)) added[slot].push(reason);

    applyAddedColumns(model);

    const panel = document.getElementById(PANEL_ID);

    if (panel) paintModel(panel, model, monthlyGroups(ui.month));
}

function onPanelClick(event) {
    const addColumn = event.target.closest("[data-mcal-add-column]");

    if (addColumn) {
        event.stopPropagation();
        void addHistoricalColumn(addColumn.dataset.mcalAddColumn);
        return;
    }

    const fold =event.target.closest("[data-mcal-expand], [data-mcal-collapse]");

    if (fold) {
        event.stopPropagation();

        if (fold.dataset.mcalExpand) ui.expanded[fold.dataset.mcalExpand] = true;
        if (fold.dataset.mcalCollapse) ui.expanded[fold.dataset.mcalCollapse] = false;

        void renderMonthlyCalendarPanel();
        return;
    }

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

    if (!row) return;

    const slot = cell.dataset.mcalSlot;
    const column = columnForCell(cell);

    // Casilla de motivo vacia: directo a elegir a quien agregar.
    if (
        column.kind !== "titulares" &&
        !columnPeople(row, slot, column).length &&
        canEditTarget("calendarPanel")
    ) {
        void addToColumn(row, slot, column);
        return;
    }

    openSlotDialog(row, slot, column);
}

/* =========================================================
   Se vuelve a pintar cuando cambian los datos (aqui, en el calendario, en el
   timeline o en otra sesion), solo si la vista esta abierta.
========================================================= */

let refreshTimer = null;

// Claves que se escriben a menudo y no cambian quien esta de turno: bitacora,
// tareas, marcas, caches de la interfaz. Antes cualquier escritura (y un cambio
// dispara varias: la bitacora, la sincronizacion...) volvia a armar el mes
// entero, y los calculos se encimaban hasta colgar la pagina.
const IRRELEVANT_KEY_PREFIXES = [
    "auditLog",
    "proturnos_",
    "firebase",
    "weekly_task_assignment",
    "home_shared_tasks",
    "kanban",
    "agenda_",
    "attendanceMarks",
    "staffing_",
    "memos",
    "informations",
    "medicalEquipment",
    "tenders",
    "leaveAttachments",
    "taskScheduleColorSeed",
    "turnoColorConfig",
    "qualifications",
    "autoCoverageCampaigns",
    "workerSchedules",
    "turnoplus_"
];

function affectsMonthlyCalendar(keys) {
    if (!Array.isArray(keys) || !keys.length) return true;

    return keys.some(key =>
        !IRRELEVANT_KEY_PREFIXES.some(prefix => String(key).startsWith(prefix))
    );
}

function scheduleRefresh(keys) {
    if (document.body?.dataset?.activeView !== "monthly") return;
    if (!affectsMonthlyCalendar(keys)) return;

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        void renderMonthlyCalendarPanel();
    }, 700);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("proturnos:persistenceChanged", event => {
        scheduleRefresh(event.detail?.keys);
    });
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type === "app-state-entries-applied") {
            scheduleRefresh(event.detail.keys);
        }
    });
}
