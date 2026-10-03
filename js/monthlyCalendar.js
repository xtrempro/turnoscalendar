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
import { TURNO, TURNO_LABEL } from "./constants.js";
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
    getCurrentProfile,
    getShiftAssigned
} from "./storage.js";
import { puedeAplicarAdministrativo } from "./rulesEngine.js";
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
    setManualExtraReason,
    setManualExtraReasons,
    turnoToCode
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
import { ensureRotaGapShifts } from "./staffing.js";
import { getPreassignments, setPreassignmentReason } from "./preassignments.js";
import { cancelPreassignment, confirmPreassignment, isRotaGapMotive } from "./replacements.js";
import { canEditTarget } from "./workspacePermissions.js";
import { showAlert, showChoice, showConfirm, showPrompt } from "./dialogs.js";
import { pushHistory } from "./history.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import { openMonthlyMagic } from "./monthlyMagic.js";
import { buildMotiveCanon, canonicalMotive, motiveKey, usedExtraMotives } from "./motives.js";

// Un motivo escrito de varias formas ("APOYO IMAGENOLOGIA -2", "Apoyo
// Imagenología - 2") es UNO: una columna, una entrada en el "+", un horario
// mas usado. Se muestra con su forma mas usada (ver motives.js). Se arma al
// calcular el mes y al leer la historia.
let motiveCanon = new Map();

function refreshMotiveCanon() {
    motiveCanon = buildMotiveCanon(usedExtraMotives(getReplacements(), getPreassignments()));
}

function canonReason(value) {
    return canonicalMotive(value, motiveCanon);
}

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
    addedColumns: {},
    // "mes|grupo" -> { day: [motivo], night: [motivo] } eliminados o renombrados.
    hiddenColumns: {},
    // Desplazamiento horizontal de los motivos de cada tramo (sobrevive al
    // repintado).
    xscroll: { day: 0, night: 0 },
    // Turno que se esta moviendo: se espera el clic en la casilla de destino.
    pendingMove: null
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
 * mismas, se agrega la inicial de la palabra siguiente ("FRG" y "FRC"); si con
 * eso aun empatan, o no hay otra palabra, la segunda letra del primer nombre
 * ("JaV" y "JoV").
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

        // Primero, la inicial de la palabra que sigue ("Fernanda Andrea Romero
        // Gonzalez" FR -> FRG; "Felipe Ignacio Rodriguez Carrizo" FR -> FRC).
        const lowercase = name => {
            const second = (nameWords(name)[0] || "").charAt(1).toLocaleLowerCase("es-CL");

            return `${key.charAt(0)}${second}${key.slice(1)}`;
        };
        const extended = new Map(group.map(name => {
            const words = nameWords(name);
            // Las iniciales usan la penultima palabra (3+) o la ultima (2): la
            // que sigue es la ultima, si queda una.
            const next = words.length >= 3 ? words[words.length - 1] : "";

            return [name, next ? key + next.charAt(0).toLocaleUpperCase("es-CL") : ""];
        }));
        const counts = new Map();

        extended.forEach(value => {
            if (value) counts.set(value, (counts.get(value) || 0) + 1);
        });

        // Si aun empatan (o no hay palabra siguiente), la minuscula de antes.
        group.forEach(name => {
            const value = extended.get(name);

            result.set(name, value && counts.get(value) === 1 ? value : lowercase(name));
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
    // El Diurno no es turno de titulares, pero un Diurno DE MAS con motivo
    // si es apoyo de Dia (su columna de motivo).
    D: ["day"],
    N: ["night"],
    "D+N": ["day", "night"],
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

/**
 * Las preasignaciones (turnos tentativos, sin horas ni proyeccion hasta que se
 * confirman) se ven en azul donde irian al confirmarse:
 * - cubriendo a un ausente: con los titulares, y su "+XX" deja de verse;
 * - un cupo de la Brecha: con los titulares, en lugar de su "+Cupo";
 * - con motivo de HHEE: en la columna de ese motivo;
 * - sin motivo: con los titulares.
 */
function applyPreassignments(rowsByKey, profiles, initials) {
    const inGroup = new Set(profiles.map(profile => profile.name));

    getPreassignments().forEach(record => {
        const [y, m, d] = String(record?.date || "").split("-").map(Number);
        const row = rowsByKey.get(`${y}-${m - 1}-${d}`);
        const name = String(record?.worker || "");

        if (!row || !inGroup.has(name)) return;

        const turnSlots = slotsOf(record.turno);
        const reason = canonReason(record.reason);

        // Un Diurno preasignado con motivo de HHEE va en Dia (ver arriba).
        if (reason && !isBrechaMotive(reason) && DIURNO_STATES.has(Number(record.turno))) {
            turnSlots.day = true;
        }
        const replaced = String(record.replaced || "");

        ["day", "night"].forEach(slot => {
            if (!turnSlots[slot]) return;

            const person = {
                name,
                initials: initials.get(name) || workerInitials(name),
                covering: true,
                preassigned: true,
                preassignment: record,
                half: HALF_LABEL[Number(record.turno)] || ""
            };

            if (replaced) {
                person.coverDetail = `${replaced}${record.absenceType ? ` (${record.absenceType})` : ""}`;
                row.gaps[slot] = row.gaps[slot].filter(gap => gap.name !== replaced);
                row.slots[slot].push(person);
                return;
            }

            if (isBrechaMotive(reason)) {
                const comment = String(record.comment || "").trim();

                person.brecha = true;
                person.coverDetail = comment ? `${reason} — ${comment}` : reason;
                row.cupos[slot].splice(0, 1);
                row.slots[slot].push(person);
                return;
            }

            if (reason) {
                (row.extras[slot][reason] ||= []).push({
                    ...person,
                    covering: false,
                    extraReason: reason,
                    half: slot === "day"
                        ? extraScheduleLabel(record) || person.half
                        : person.half
                });
                return;
            }

            row.slots[slot].push(person);
        });
    });

    // Las columnas de motivo y sus cuentas incluyen a los preasignados.
    return rowsByKey;
}

// El motivo con que se guarda quien cubre un cupo de la Brecha RRHH (ver
// weeklyRotaMotive en staffing.js).
function isBrechaMotive(reason) {
    return isRotaGapMotive(reason);
}

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
    if (person.preassigned) {
        const what = person.extraReason
            || (person.brecha ? `${person.coverDetail} (Brecha RRHH)` : "")
            || (person.coverDetail ? `cubre a ${person.coverDetail}` : "turno sin motivo");

        return `${person.name} — preasignado, pendiente de confirmar: ${what}`;
    }

    if (person.extraReason) {
        return `${person.name} — apoyo extra: ${person.extraReason}${person.half ? ` (${person.half})` : ""}`;
    }

    if (!person.covering) return person.name;

    if (person.brecha) return `${person.name} — ${person.coverDetail} (Brecha RRHH)`;

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

// Turnos con tramo Diurno (08 a 17): no ocupan Titulares, pero un Diurno de
// mas con motivo de HHEE va a la columna de ese motivo, en Dia.
const DIURNO_STATES = new Set([TURNO.DIURNO, TURNO.DIURNO_NOCHE]);

// "09:30"-"15:00" -> "9:30–15": cabe bajo las iniciales.
function compactTime(value) {
    const [hour, minute] = String(value || "").split(":");

    return `${Number(hour)}${minute && minute !== "00" ? `:${minute}` : ""}`;
}

/**
 * Lo que se anota bajo las iniciales de un apoyo de Dia: "D" si viene a
 * Diurno y su horario si es personalizado (el que se le programo).
 */
function extraScheduleLabel(record) {
    if (record?.coverFrom && record?.coverUntil) {
        return `${compactTime(record.coverFrom)}–${compactTime(record.coverUntil)}`;
    }

    const code = String(record?.turno ?? "");

    return code === "D" || Number(code) === TURNO.DIURNO ? "D" : "";
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

    refreshMotiveCanon();

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
            // Cupos de la Brecha RRHH: a un grupo le falta alguien de esta
            // profesion en ese turno (no hay ausente, falta gente).
            cupos: { day: [], night: [] },
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

            // Un Diurno (o un horario personalizado) de mas con motivo de HHEE
            // es apoyo de Dia aunque no sea turno de titulares: antes no se
            // veia en ninguna columna. Su propio Diurno no cuenta.
            if (
                !realSlots.day &&
                !byContract &&
                DIURNO_STATES.has(real) &&
                !DIURNO_STATES.has(Number(own) || TURNO.LIBRE) &&
                !ownSlots.day &&
                extraRecordFor(name, row.iso, "day", ctx)
            ) {
                realSlots.day = true;
            }

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
                const recordReason = extraRecord
                    ? canonReason(extraRecord.reason)
                    : "";

                // Quien cubre un cupo de la Brecha RRHH completa la rotativa:
                // va con los titulares, en rojo, no en una columna de motivo.
                if (isBrechaMotive(recordReason)) {
                    const comment = String(extraRecord.comment || "").trim();

                    person.covering = true;
                    person.brecha = true;
                    person.coverDetail = comment ? `${recordReason} — ${comment}` : recordReason;
                    // Para quitarlo: se anula su registro.
                    person.extraId = String(extraRecord.id || "");
                    person.extraSource = String(extraRecord.source || "");
                    row.slots[slot].push(person);
                    return;
                }

                const reason = recordReason;

                if (reason) {
                    (row.extras[slot][reason] ||= []).push({
                        ...person,
                        covering: false,
                        extraReason: reason,
                        // Diurno o su horario personalizado, bajo las iniciales.
                        half: slot === "day"
                            ? extraScheduleLabel(extraRecord) || person.half
                            : person.half,
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

    // Los cupos de la Brecha RRHH del mes (el mismo barrido del inicio y del
    // Calendario Semanal, que cede el hilo y queda en cache), solo de esta
    // profesion. Si los datos cambiaron a medias devuelve null: sin cupos esta
    // vez, y el repintado que sigue al cambio los trae.
    const gapRequest = { days, today: new Date(year, monthIndex, 1) };
    let gapRows = await ensureRotaGapShifts(gapRequest).catch(() => null);

    // Un cambio a medias lo anula (devuelve null): un reintento con la foto
    // nueva, para no pintar el mes sin cupos.
    if (!gapRows && shouldContinue()) {
        gapRows = await ensureRotaGapShifts(gapRequest).catch(() => null);
    }

    if (!shouldContinue()) return null;

    const rowsByKey = new Map(rows.map(row => [row.keyDay, row]));

    (gapRows || []).forEach(gap => {
        const row = rowsByKey.get(gap.keyDay);
        const slot = gap.shiftKey === "noche" ? "night" : "day";
        const gapGroup = gap.profession && !/^sin informaci/i.test(gap.profession)
            ? gap.profession
            : gap.estamento;

        if (!row || (group && gapGroup !== group)) return;

        for (let index = 0; index < Math.max(1, Number(gap.missing) || 1); index++) {
            row.cupos[slot].push({
                group: gap.group,
                estamento: gap.estamento,
                label: gap.label,
                turno: gap.turno,
                motive: gap.motive,
                reference: gap.reference_profile || ""
            });
        }
    });

    applyPreassignments(rowsByKey, profiles, initials);

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
                .filter(({ reason }) =>
                    !(ui.hiddenColumns[`${year}-${monthIndex}|${group}`]?.[slot] || []).includes(reason)
                )
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

    refreshMotiveCanon();

    getReplacements().forEach(item => {
        const reason = canonReason(item?.reason);

        // Los de la Brecha van con los titulares: no son un motivo de columna.
        if (isBrechaMotive(reason)) return;

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
    const key = addedColumnsKey(model);
    const added = ui.addedColumns[key] || {};
    const hidden = ui.hiddenColumns[key] || {};

    ["day", "night"].forEach(slot => {
        (added[slot] || []).forEach(reason => {
            if (!model.extraColumns[slot].includes(reason)) model.extraColumns[slot].push(reason);
            if (!model.pinnedColumns[slot].includes(reason)) model.pinnedColumns[slot].push(reason);
        });

        // Eliminadas o renombradas por el supervisor: la recurrente vacia no
        // vuelve a aparecer (si alguien queda con ese motivo, se ve igual).
        (hidden[slot] || []).forEach(reason => {
            if (model.extraCounts[slot][reason]) return;

            model.extraColumns[slot] = model.extraColumns[slot].filter(item => item !== reason);
            model.pinnedColumns[slot] = model.pinnedColumns[slot].filter(item => item !== reason);
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
// `movingName`: quien se esta moviendo desde esta casilla (va en naranjo).
function chipsHTML(list, gaps, { drag = null, cupos = [], movingName = "" } = {}) {
    const people = list.map(person => {
        const draggable = drag && person.extraId
            ? ` draggable="true" data-mcal-drag="${escapeHTML(person.extraId)}" data-mcal-drag-key="${escapeHTML(drag.keyDay)}" data-mcal-drag-slot="${escapeHTML(drag.slot)}" data-mcal-drag-reason="${escapeHTML(person.extraReason)}" data-mcal-drag-name="${escapeHTML(person.name)}"`
            : "";

        return `
            <span class="mcal-chip${person.covering ? " is-covering" : ""}${person.preassigned ? " is-preassigned" : ""}${movingName && person.name === movingName ? " is-moving-source" : ""}${draggable ? " is-draggable" : ""}" title="${escapeHTML(personTitle(person))}"${draggable}>${escapeHTML(person.initials)}${person.half ? `<small>${escapeHTML(person.half)}</small>` : ""}</span>
        `.trim();
    }).join('<span class="mcal-sep">-</span>');
    const holes = gaps.map(gap => `
        <span class="mcal-gap" title="Falta cubrir el turno de ${escapeHTML(gap.name)}">+${escapeHTML(gap.initials)}</span>
    `.trim()).join("") + cupos.map(cupo => `
        <span class="mcal-gap mcal-gap--cupo" title="Cupo disponible: el grupo ${escapeHTML(cupo.group)} requiere 1 ${escapeHTML(cupo.label)}">+Cupo</span>
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
    // Es un <div> dentro de la franja desplazable del tramo (ver
    // extrasCellHTML), no una columna de la tabla.
    const base = `class="mcal-slot mcal-slot--extra mcal-xcell" data-mcal-slot="${slot}" data-mcal-key="${escapeHTML(row.keyDay)}" data-mcal-col="${index}" tabindex="0"`;

    if (column.kind === "group") {
        const people = column.reasons.flatMap(reason => row.extras[slot][reason] || []);
        const title = people
            .map(person => `${person.name} — ${person.extraReason}`)
            .join("\n");

        return `<div ${base}${title ? ` title="${escapeHTML(title)}"` : ""}>${people.length
            ? chipsHTML(people, [], { drag })
            : ""}</div>`;
    }

    const people = row.extras[slot][column.reason] || [];

    return `<div ${base} data-mcal-drop-reason="${escapeHTML(column.reason)}">${people.length
        ? chipsHTML(people, [], { drag })
        : ""}</div>`;
}

/**
 * Los motivos de HHEE de un tramo van juntos en UNA celda con desplazamiento
 * horizontal propio: con muchos motivos la tabla ya no desborda la pagina.
 * Todas las filas y el encabezado se desplazan a la vez (ver syncExtraScroll).
 */
function extrasCellHTML(content, slot, tag = "td", className = "") {
    return `<${tag} class="mcal-xwrap${className ? ` ${className}` : ""}"><div class="mcal-xscroll" data-mcal-xscroll="${slot}"><div class="mcal-xrow">${content}</div></div></${tag}>`;
}

function extraHeadHTML(slot, column, canEdit) {
    if (column.kind === "group") {
        return `
            <div class="mcal-xcell mcal-sub-head mcal-sub-head--extra mcal-sub-head--group" title="${escapeHTML(column.reasons.join("\n"))}">
                Otros motivos (${column.reasons.length})
                <button type="button" class="mcal-fold" data-mcal-expand="${slot}" title="Ver cada motivo en su columna">+</button>
            </div>
        `;
    }

    // Clic en el titulo: editar el nombre o eliminar el motivo.
    return canEdit
        ? `<div class="mcal-xcell mcal-sub-head mcal-sub-head--extra is-editable" role="button" tabindex="0" data-mcal-head-slot="${slot}" data-mcal-head-reason="${escapeHTML(column.reason)}" title="Motivo HHEE: ${escapeHTML(column.reason)}. Clic para editar el nombre o eliminarlo.">${escapeHTML(column.reason)}</div>`
        : `<div class="mcal-xcell mcal-sub-head mcal-sub-head--extra" title="Motivo HHEE: ${escapeHTML(column.reason)}">${escapeHTML(column.reason)}</div>`;
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
        <div class="mcal${ui.pendingMove ? " is-moving" : ""}">
            ${ui.pendingMove ? `
                <div class="mcal-move-banner" role="status">
                    <span>Mover el turno de <b>${escapeHTML(turnLabel(ui.pendingMove.sourceTurn))}</b> de <b>${escapeHTML(ui.pendingMove.name)}</b> del ${escapeHTML(slotDateLabel(ui.pendingMove.sourceKey))}: haz clic en la casilla de <b>Titulares</b> (Día o Noche) del día de destino.</span>
                    <button type="button" class="secondary-button" data-mcal-move-cancel>Cancelar</button>
                </div>
            ` : ""}
            <header class="mcal-head">
                <div class="mcal-title">
                    <h2>Calendario Mensual</h2>
                    ${canEdit ? `<button type="button" class="mcal-magic-button" data-mcal-magic title="Propone cómo dejar todos los turnos con la misma cantidad de gente: emparejar, mover turnos y cubrir con horas extras">✨ Ayuda para cubrir</button>` : ""}
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
                    <colgroup>
                        <col class="mcal-col-date">
                        <col class="mcal-col-weekday">
                        ${slots.map(slot => `
                            <col class="mcal-col-titulares">
                            ${columns[slot].length ? `<col data-mcal-xcol="${columns[slot].length}">` : ""}
                        `).join("")}
                    </colgroup>
                    <thead>
                        <tr>
                            <th rowspan="2">Fecha</th>
                            <th rowspan="2"></th>
                            ${slots.map(slot => `
                                <th colspan="${columns[slot].length ? 2 : 1}" class="mcal-group-head">
                                    ${slot === "day" ? "Día" : "Noche"}
                                    ${ui.expanded[slot] && canGroupExtras(model, slot)
                                        ? `<button type="button" class="mcal-fold" data-mcal-collapse="${slot}" title="Agrupar los motivos con poca gente">− Agrupar</button>`
                                        : ""}
                                    ${canEdit
                                        ? `<button type="button" class="mcal-fold" data-mcal-add-column="${slot}" title="Agregar un motivo de horas extras de los últimos 3 meses o crear uno nuevo">+ Motivos HHEE</button>`
                                        : ""}
                                </th>
                            `).join("")}
                        </tr>
                        <tr>
                            ${slots.map(slot => `
                                <th class="mcal-sub-head">Titulares</th>
                                ${columns[slot].length
                                    ? extrasCellHTML(
                                        columns[slot].map(column => extraHeadHTML(slot, column, canEdit)).join(""),
                                        slot,
                                        "th",
                                        "mcal-xwrap--head"
                                    )
                                    : ""}
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${model.rows.map(row => `
                            <tr class="${row.business ? "" : "is-weekend"}">
                                <td class="mcal-date">${row.day}</td>
                                <td class="mcal-weekday">${row.weekday}</td>
                                ${slots.map(slot => `
                                    <td class="mcal-slot${moveTargetClass(row.keyDay, slot)}" data-mcal-slot="${slot}" data-mcal-key="${escapeHTML(row.keyDay)}" data-mcal-col="titulares" tabindex="0"${moveTargetTitle(row.keyDay, slot)}>${chipsHTML(row.slots[slot], row.gaps[slot], {
                                        cupos: row.cupos?.[slot] || [],
                                        movingName: isMoveSource(row.keyDay, slot) ? ui.pendingMove.name : ""
                                    })}</td>
                                    ${columns[slot].length
                                        ? extrasCellHTML(
                                            columns[slot].map((column, index) => extraCellHTML(row, slot, column, canEdit, index)).join(""),
                                            slot
                                        )
                                        : ""}
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
        // `scroll` no burbujea: se escucha en captura.
        panel.addEventListener("scroll", syncExtraScroll, true);
        window.addEventListener("resize", onWindowResize);
        panel.addEventListener("keydown", event => {
            if (event.key === "Enter" && event.target.closest("[data-mcal-slot], [data-mcal-head-reason]")) {
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

    if (wrap) layoutExtraColumns(wrap);

    panel.querySelectorAll("[data-mcal-xscroll]").forEach(scroller => {
        scroller.scrollLeft = ui.xscroll[scroller.dataset.mcalXscroll] || 0;
    });
}

const XCELL_WIDTH = 112;
const TITULARES_MIN_WIDTH = 190;

/**
 * Reparte el ancho: Fecha, dia y Titulares tienen lo suyo, y la franja de
 * motivos de cada tramo se queda con el resto, en proporcion a cuantos motivos
 * tiene. Si no caben, cada franja se desplaza por dentro (no la pagina).
 */
function layoutExtraColumns(wrap) {
    const table = wrap.querySelector(".mcal-table");
    const extraCols = [...wrap.querySelectorAll("col[data-mcal-xcol]")];

    if (!table || !extraCols.length || !wrap.clientWidth) return;

    const fixed = [...wrap.querySelectorAll("col.mcal-col-date, col.mcal-col-weekday")]
        .reduce((sum, col) => sum + (parseFloat(getComputedStyle(col).width) || 0), 0);
    const titulares = wrap.querySelectorAll("col.mcal-col-titulares").length;
    const available = Math.max(0, wrap.clientWidth - fixed - titulares * TITULARES_MIN_WIDTH);
    // +2: el borde de la celda, o una franja justa mostraria barra igual.
    const desired = extraCols.map(col => Number(col.dataset.mcalXcol) * XCELL_WIDTH + 2);
    const total = desired.reduce((sum, value) => sum + value, 0);
    const scale = total > available ? available / total : 1;

    extraCols.forEach((col, index) => {
        col.style.width = `${Math.max(XCELL_WIDTH + 2, Math.floor(desired[index] * scale))}px`;
    });
}

// Todas las filas (y el encabezado) de un tramo se desplazan juntas.
function syncExtraScroll(event) {
    const scroller = event.target;

    if (!scroller?.dataset?.mcalXscroll) return;

    const slot = scroller.dataset.mcalXscroll;
    const left = scroller.scrollLeft;

    ui.xscroll[slot] = left;
    event.currentTarget
        .querySelectorAll(`[data-mcal-xscroll="${slot}"]`)
        .forEach(other => {
            if (other !== scroller && other.scrollLeft !== left) other.scrollLeft = left;
        });
}

let resizeTimer = null;

function onWindowResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const wrap = document.getElementById(PANEL_ID)?.querySelector(".mcal-table-wrap");

        if (wrap) layoutExtraColumns(wrap);
    }, 150);
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

/**
 * Los permisos que admite ESE dia para ese trabajador, con las mismas reglas
 * que el calendario aplica al guardarlos: antes se ofrecian todos y el que no
 * cabia fallaba recien al aplicarlo.
 * - Administrativo: la regla del calendario (turno Larga/Noche, o Diurno en
 *   rotativa diurna; sin asignacion de turno, solo en dia habil).
 * - Medio administrativo: solo dia habil y sin otro administrativo ese dia.
 * - Feriado legal y compensatorio: parten en dia habil.
 */
export async function allowedLeaveOptions(name, keyDay) {
    const date = dateFromKey(keyDay);
    const holidays = await fetchHolidays(date.getFullYear());
    const isHab = isBusinessDay(date, holidays);
    const admin = getJSON(`admin_${name}`, {});
    const legal = getJSON(`legal_${name}`, {});
    const comp = getJSON(`comp_${name}`, {});
    const absences = getJSON(`absences_${name}`, {});
    const adminAllowed = puedeAplicarAdministrativo(
        keyDay,
        getTurnoBase(name, keyDay),
        isHab,
        admin,
        legal,
        comp,
        absences,
        getShiftAssigned(name, date),
        getRotativa(name)
    );

    return LEAVE_OPTIONS.filter(option => {
        if (option.value === "admin") return adminAllowed;
        if (option.value.startsWith("half_admin")) return isHab && !admin[keyDay];
        if (option.value === "legal" || option.value === "comp") return isHab;
        return true;
    });
}

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
 * Si el turno de un titular se puede mover: es SU turno (no cubre ni es un
 * apoyo), no es de honorarios, y pasa la misma regla del "Mover Turno" del
 * calendario (Larga o Noche base, sin permisos, marcajes ni cambios). La usan
 * el boton "Mover" de la lista y el "Mover turno" dentro de Quitar.
 */
function canMoveOwnShift(person, keyDay) {
    return Boolean(
        person &&
        !person.covering &&
        !person.extraReason &&
        !person.brecha &&
        !person.preassigned &&
        !isHonorariaProfile(person.name, keyDay) &&
        typeof window.applyShiftMove === "function" &&
        typeof window.shiftMoveDayBlockReason === "function" &&
        !window.shiftMoveDayBlockReason(person.name, keyDay, { source: true })
    );
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

    const options = await allowedLeaveOptions(name, keyDay);
    const canMove = canMoveOwnShift(person, keyDay);
    // Con un boton extra el dialogo responde { action, value }.
    const decision = await showChoice(
        `¿Qué permiso se le da a ${name}? Solo aparecen los que admite este día.`,
        {
            title: "Quitar del turno",
            confirmText: "Continuar",
            choices: options.map(option => ({
                value: option.value,
                label: option.label
            })),
            extraActions: canMove
                ? [{ text: "Mover turno", value: "move" }]
                : []
        }
    );
    const value = canMove
        ? (decision?.action === "confirm" ? decision.value : "")
        : decision;

    if (canMove && decision?.action === "move") {
        startShiftMove(person, keyDay);
        return false;
    }

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

    // Los turnos del trabajador que ya estaban sin cubrir en el tramo que puede
    // tocar el permiso (los dias habiles de un feriado saltan fines de semana:
    // de ahi el margen).
    const span = option.days ? Math.ceil(amount) * 3 + 7 : 1;
    const uncoveredBefore = uncoveredDaysFrom(name, date, span);
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

    // Un solo turno por cubrir: directo a las sugerencias de reemplazo. Si el
    // permiso dejo varios (un rango), se cubren despues, dia por dia.
    const newlyUncovered = uncoveredDaysFrom(name, date, span)
        .filter(key => !uncoveredBefore.includes(key));

    if (newlyUncovered.length === 1) {
        void window.openReplacementDialog?.(name, newlyUncovered[0]);
    }

    return true;
}

// Los dias (keyDay) de un trabajador con turno sin cubrir, desde `date` y por
// `span` dias. Misma regla que el "+XX" del mes y el inicio.
export function uncoveredDaysFrom(name, date, span) {
    const keys = [];

    for (let offset = 0; offset < span; offset++) {
        const key = keyFor(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));

        if (isShiftUncovered(name, key)) keys.push(key);
    }

    return keys;
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
        return removeManualTurn(name, keyDay);
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
        const canceled = records
            .map(record => cancelReplacementById(record.id, {
                reason: "coverage_removed",
                details: `El supervisor quito la cobertura del ${keyDay} desde el Calendario Mensual.`
            }))
            .filter(Boolean);

        await window.offerShiftAttendanceNote?.(canceled);
        return true;
    }

    const turnBefore = turnoToCode(getTurnoReal(name, keyDay));
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
        await window.offerShiftAttendanceNote?.([{
            worker: name,
            replaced: contract.replaces,
            date: iso,
            turno: turnBefore,
            source: "replacement_contract"
        }]);
    }

    return excluded;
}

/* ---------- Arrastrar un apoyo extra a otro motivo ----------

   Solo dentro de la MISMA casilla de dia y tramo (el apoyo es de ese turno) y
   hacia una columna de un motivo concreto: la agrupada tiene varios y no se
   sabria cual poner. Al soltar se cambia el motivo del respaldo; si en la
   columna de origen no queda nadie en el mes, desaparece sola al repintar. */

let dragState = null;

// Un "+Cupo" de la Brecha en Titulares (mismo dia y tramo) tambien recibe a
// quien se arrastra desde una columna de motivo: es cubrir ese cupo con el.
function cupoDropFor(event) {
    const cell = event.target.closest('[data-mcal-slot][data-mcal-col="titulares"]');

    if (
        !cell ||
        !dragState ||
        cell.dataset.mcalKey !== dragState.keyDay ||
        cell.dataset.mcalSlot !== dragState.slot
    ) {
        return null;
    }

    const row = lastModel?.rows.find(item => item.keyDay === dragState.keyDay);
    const cupo = row?.cupos?.[dragState.slot]?.[0];

    return cupo ? { cell, cupo } : null;
}

function dropTargetFor(event) {
    const cupoDrop = cupoDropFor(event);

    if (cupoDrop) return cupoDrop.cell;

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
    event.target.closest('[data-mcal-drop-reason], [data-mcal-col="titulares"]')
        ?.classList.remove("is-drop-target");
}

// Soltar en un "+Cupo": el mismo cuadro de comentario que al cubrirlo con
// clic; su apoyo pasa a ser el de ese cupo (motivo "Completar rotativa de...",
// que lo deja con los titulares) y cancelar no cambia nada.
async function dropOnCupo(moving, cupo) {
    const comment = await window.openCupoCoverReasonDialog?.({
        worker: moving.name,
        keyDay: moving.keyDay,
        label: cupo.label,
        turnoLabel: TURNO_LABEL[cupo.turno] || ""
    });

    if (comment === null || comment === undefined) return;

    pushHistory();

    if (setManualExtraReason(moving.extraId, cupo.motive, { comment })) {
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Cubrio un cupo de la Brecha",
            `${moving.name}: el ${moving.keyDay} pasa de "${moving.reason}" a cubrir el cupo "${cupo.motive}"${comment ? ` (${comment})` : ""} (Calendario Mensual).`,
            { profile: moving.name, keyDay: moving.keyDay }
        );
    }

    await renderMonthlyCalendarPanel();
}

async function onDrop(event) {
    const cell = dropTargetFor(event);
    const panel = event.currentTarget;

    const cupoDrop = cupoDropFor(event);

    clearDropHighlights(panel);

    if (!cell) return;

    event.preventDefault();

    const moving = dragState;

    if (cupoDrop) {
        dragState = null;
        await dropOnCupo(moving, cupoDrop.cupo);
        return;
    }
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

/* =========================================================
   Turno de un apoyo de Dia: Larga, Diurno o un horario personalizado. Se
   pregunta antes del modal de sugerencias (la Noche va directo a 12 horas) y
   parte con el horario que mas se ha usado en ese motivo.
========================================================= */

const LARGA_WINDOW = { from: "08:00", until: "20:00" };

// Fin del Diurno ese dia: 16:00 el viernes, 17:00 el resto.
function diurnoWindowFor(keyDay) {
    return {
        from: "08:00",
        until: dateFromKey(keyDay).getDay() === 5 ? "16:00" : "17:00"
    };
}

function scheduleKey(schedule) {
    return schedule.kind === "custom"
        ? `custom|${schedule.from}|${schedule.until}`
        : schedule.kind;
}

/**
 * El horario de Dia de un registro de apoyo (reemplazo o preasignacion), o
 * null si no es de Dia (Noche, 24, medios turnos).
 */
function dayScheduleOfRecord(record) {
    const code = typeof record?.turno === "number"
        ? turnoToCode(record.turno)
        : String(record?.turno ?? "");

    if (code !== "L" && code !== "D") return null;

    if (record.coverFrom && record.coverUntil) {
        return { kind: "custom", from: record.coverFrom, until: record.coverUntil };
    }

    return { kind: code === "L" ? "larga" : "diurno" };
}

/**
 * El horario predominante de un motivo: entre quienes vinieron (o estan
 * preasignados) por el en el mes visible y los 3 anteriores. Empate: el mas
 * reciente. Sin nadie: Larga.
 */
export function predominantDaySchedule(reason, monthDate, {
    replacements = getReplacements(),
    preassignments = getPreassignments()
} = {}) {
    const target = String(reason || "").trim();
    const start = new Date(monthDate.getFullYear(), monthDate.getMonth() - HISTORY_MONTHS, 1);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const startIso = isoFor(start);
    const endIso = isoFor(end);
    const tally = new Map();

    [
        ...(replacements || []).filter(record =>
            replacementActive(record) &&
            EXTRA_SOURCES.has(record.source) &&
            !record.replaced
        ),
        ...(preassignments || []).filter(record => !record?.replaced)
    ].forEach(record => {
        const date = String(record?.date || "");

        if (
            motiveKey(record?.reason) !== motiveKey(target) ||
            date < startIso ||
            date > endIso
        ) {
            return;
        }

        const schedule = dayScheduleOfRecord(record);

        if (!schedule) return;

        const key = scheduleKey(schedule);
        const entry = tally.get(key) || { schedule, count: 0, last: "" };

        entry.count += 1;
        if (date > entry.last) entry.last = date;
        tally.set(key, entry);
    });

    const best = [...tally.values()].sort((a, b) =>
        b.count - a.count || b.last.localeCompare(a.last)
    )[0];

    return best ? best.schedule : { kind: "larga" };
}

/**
 * Lo que se guarda: el turno (Larga o Diurno) y, si es personalizado, el
 * horario. Un horario personalizado se apoya en el Diurno si cabe en el, y si
 * no en la Larga; el marcaje lleva la entrada y salida programadas. Si es
 * justo el horario de uno de los dos, es ese turno sin mas.
 */
export function dayScheduleToShift(schedule, keyDay) {
    const diurno = diurnoWindowFor(keyDay);

    if (schedule.kind === "diurno") return { turno: TURNO.DIURNO, window: null };
    if (schedule.kind !== "custom") return { turno: TURNO.LARGA, window: null };

    const { from, until } = schedule;

    if (from === LARGA_WINDOW.from && until === LARGA_WINDOW.until) {
        return { turno: TURNO.LARGA, window: null };
    }

    if (from === diurno.from && until === diurno.until) {
        return { turno: TURNO.DIURNO, window: null };
    }

    return {
        turno: from >= diurno.from && until <= diurno.until
            ? TURNO.DIURNO
            : TURNO.LARGA,
        window: { from, until }
    };
}

function scheduleLabel(schedule, keyDay) {
    if (schedule.kind === "custom") return `${schedule.from} a ${schedule.until}`;

    const window = schedule.kind === "diurno" ? diurnoWindowFor(keyDay) : LARGA_WINDOW;

    return `${schedule.kind === "diurno" ? "Diurno" : "Larga"} (${window.from} a ${window.until})`;
}

// Un cuadro con Aceptar y la X de cerrar. `onAccept(dialog)` devuelve el valor
// (o undefined si falta corregir algo); cerrar resuelve null.
function openAcceptDialog({ title, subtitle, bodyHTML, onAccept, onReady }) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        let settled = false;
        const onKeydown = event => {
            if (event.key === "Escape") {
                event.preventDefault();
                finish(null);
            }
        };
        const finish = value => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            previousFocus?.focus?.();
            resolve(value);
        };

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <form class="turn-change-dialog clock-mark-dialog clock-mark-dialog--simple mcal-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="mcalScheduleTitle">
                <div class="mcal-schedule-head">
                    <strong id="mcalScheduleTitle">${escapeHTML(title)}</strong>
                    <button type="button" class="replacement-dialog-close" data-mcal-schedule-close aria-label="Cerrar">×</button>
                </div>
                <p>${escapeHTML(subtitle)}</p>
                ${bodyHTML}
                <p class="mcal-schedule-error" data-mcal-schedule-error hidden></p>
                <div class="mcal-schedule-actions">
                    <button class="primary-button" type="submit">Aceptar</button>
                </div>
            </form>`;

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop || event.target.closest("[data-mcal-schedule-close]")) {
                finish(null);
            }
        });
        backdrop.querySelector("form").addEventListener("submit", event => {
            event.preventDefault();

            const value = onAccept(backdrop);

            if (value !== undefined) finish(value);
        });
        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
        onReady?.(backdrop);
    });
}

function showScheduleError(dialog, message) {
    const error = dialog.querySelector("[data-mcal-schedule-error]");

    if (!error) return;

    error.textContent = message;
    error.hidden = !message;
}

function timeInputsHTML(side, label, value) {
    const [hour = "08", minute = "00"] = String(value || "").split(":");

    return `
        <div class="clock-mark-column">
            <span>${label}</span>
            <div class="clock-time-inputs">
                <input class="clock-time-number" type="number" min="0" max="23" step="1" inputmode="numeric" value="${escapeHTML(hour)}" aria-label="${label} hora" data-mcal-time="${side}" data-unit="hour">
                <span>:</span>
                <input class="clock-time-number" type="number" min="0" max="59" step="1" inputmode="numeric" value="${escapeHTML(minute)}" aria-label="${label} minutos" data-mcal-time="${side}" data-unit="minute">
            </div>
        </div>`;
}

function readTime(dialog, side) {
    const hour = Number(dialog.querySelector(`[data-mcal-time="${side}"][data-unit="hour"]`)?.value);
    const minute = Number(dialog.querySelector(`[data-mcal-time="${side}"][data-unit="minute"]`)?.value);

    if (
        !Number.isInteger(hour) || !Number.isInteger(minute) ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59
    ) {
        return "";
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// El horario personalizado: entrada y salida del mismo dia.
function askCustomWindow({ reason, keyDay, initial }) {
    const start = initial || diurnoWindowFor(keyDay);

    return openAcceptDialog({
        title: "Horario personalizado",
        subtitle: `${reason} · ${slotDateLabel(keyDay)}`,
        bodyHTML: `
            <div class="clock-mark-row">
                ${timeInputsHTML("from", "Entrada", start.from)}
                ${timeInputsHTML("until", "Salida", start.until)}
            </div>`,
        onReady: dialog => {
            dialog.querySelector('[data-mcal-time="from"][data-unit="hour"]')?.focus();
        },
        onAccept: dialog => {
            const from = readTime(dialog, "from");
            const until = readTime(dialog, "until");

            if (!from || !until) {
                showScheduleError(dialog, "Revisa las horas: entre 00:00 y 23:59.");
                return undefined;
            }

            if (until <= from) {
                showScheduleError(dialog, "La salida debe ser después de la entrada (el apoyo de Día no cruza la medianoche).");
                return undefined;
            }

            return { kind: "custom", from, until };
        }
    });
}

/**
 * Que turno viene a hacer un apoyo de Dia. Resuelve { turno, window } o null
 * si se cierra.
 */
async function askDaySchedule({ reason, keyDay, monthDate }) {
    const predominant = predominantDaySchedule(reason, monthDate);
    const options = [
        { kind: "larga", label: scheduleLabel({ kind: "larga" }, keyDay) },
        { kind: "diurno", label: scheduleLabel({ kind: "diurno" }, keyDay) },
        {
            kind: "custom",
            label: predominant.kind === "custom"
                ? `Horario personalizado (${scheduleLabel(predominant, keyDay)})`
                : "Horario personalizado"
        }
    ];
    const kind = await openAcceptDialog({
        title: "Turno del apoyo",
        subtitle: `${reason} · ${slotDateLabel(keyDay)}`,
        bodyHTML: `
            <div class="app-dialog__choices" role="radiogroup" aria-label="Turno">
                ${options.map(option => `
                    <label class="app-dialog__choice">
                        <input type="radio" name="mcalDaySchedule" value="${option.kind}"${option.kind === predominant.kind ? " checked" : ""}>
                        <span class="app-dialog__choice-text">${escapeHTML(option.label)}${option.kind === predominant.kind ? `<small class="app-dialog__choice-hint">El más usado en este motivo</small>` : ""}</span>
                    </label>`).join("")}
            </div>`,
        onReady: dialog => {
            dialog.querySelector('input[name="mcalDaySchedule"]:checked')?.focus();
        },
        onAccept: dialog =>
            dialog.querySelector('input[name="mcalDaySchedule"]:checked')?.value || "larga"
    });

    if (!kind) return null;

    const schedule = kind === "custom"
        ? await askCustomWindow({
            reason,
            keyDay,
            initial: predominant.kind === "custom" ? predominant : null
        })
        : { kind };

    return schedule ? dayScheduleToShift(schedule, keyDay) : null;
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

    // De Dia se pregunta el turno (Larga, Diurno o un horario); la Noche es
    // siempre de 12 horas.
    const shift = slot === "day"
        ? await askDaySchedule({ reason, keyDay: row.keyDay, monthDate: ui.month })
        : { turno: TURNO.NOCHE, window: null };

    if (!shift) return;

    const shiftText = shift.window
        ? `de ${shift.window.from} a ${shift.window.until}`
        : `en ${TURNO_LABEL[shift.turno]}`;

    await window.openReplacementDialog?.(reference.name, row.keyDay, {
        rota: {
            group: ui.group,
            estamento: reference.estamento,
            label: ui.group,
            turno: shift.turno,
            window: shift.window,
            motive: reason,
            description: `Agregar a alguien de ${slot === "day" ? "Día" : "Noche"} el ${slotDateLabel(row.keyDay)} ${shiftText} por: ${reason}. No reemplaza a nadie: queda como horas extras con ese motivo.`
        }
    });
}

async function removeExtra(person, keyDay) {
    // El agregado desde el modal de sugerencias no esta escrito en el dia: se
    // anula su registro.
    if (person.extraSource === "rota_gap") {
        const ok = await showConfirm(
            `Se quitará a ${person.name} del ${person.brecha ? "cupo de la Brecha RRHH" : "apoyo"} "${person.extraReason || person.coverDetail}" el ${slotDateLabel(keyDay)}.`,
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

        const canceled = cancelReplacementById(person.extraId, {
            reason: "extra_removed",
            details: `El supervisor quito el apoyo extra (${person.extraReason || person.coverDetail}) desde el Calendario Mensual.`,
            canceledBy: "Calendario Mensual"
        });

        if (canceled) await window.offerShiftAttendanceNote?.([canceled]);

        return Boolean(canceled);
    }

    return removeManualTurn(person.name, keyDay);
}

// Turno escrito a mano en el dia: se quita como en su calendario. Si ya estaba
// por empezar, se ofrece anotarlo en su historial de turnos aceptados.
async function removeManualTurn(name, keyDay) {
    const turnBefore = turnoToCode(getTurnoReal(name, keyDay));
    const removed = Boolean(await window.offerManualExtraRemoval?.(name, keyDay));

    if (removed) {
        await window.offerShiftAttendanceNote?.([{
            worker: name,
            date: isoFor(dateFromKey(keyDay)),
            turno: turnBefore,
            source: "manual_extra"
        }]);
    }

    return removed;
}

function openSlotDialog(row, slot, column = TITULARES_COLUMN) {
    const people = columnPeople(row, slot, column);
    const isTitulares = column.kind === "titulares";
    // Los huecos son de los titulares: en una columna de motivo no se cubre a
    // nadie, se agrega.
    const gaps = isTitulares ? row.gaps[slot] : [];
    const cupos = isTitulares ? (row.cupos?.[slot] || []) : [];
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
                            <span class="mcal-chip${person.covering ? " is-covering" : ""}${person.preassigned ? " is-preassigned" : ""}">${escapeHTML(person.initials)}</span>
                            <span class="mcal-dialog-name">${escapeHTML(person.name)}${person.half ? ` <small>(${escapeHTML(person.half)})</small>` : ""}<small>${person.extraReason
                                ? `Apoyo extra: ${escapeHTML(person.extraReason)}`
                                : person.covering
                                    ? (person.brecha
                                        ? `${escapeHTML(person.coverDetail)} (Brecha RRHH)`
                                        : person.coverDetail ? `Cubre a ${escapeHTML(person.coverDetail)}` : "Turno agregado sin motivo")
                                    : "Su turno"}</small>${person.preassigned ? `<em class="mcal-pre-badge">Preasignado · pendiente de confirmar</em>` : ""}</span>
                            ${!canEdit ? "" : person.preassigned
                                ? `<span class="mcal-dialog-actions"><button class="primary-button" type="button" data-mcal-confirm-pre="${index}">Confirmar</button><button class="secondary-button" type="button" data-mcal-cancel-pre="${index}">Quitar preasignación</button></span>`
                                : `<span class="mcal-dialog-actions mcal-dialog-actions--inline">${isTitulares && canMoveOwnShift(person, row.keyDay) ? `<button class="secondary-button" type="button" data-mcal-move="${index}">Mover</button>` : ""}<button class="secondary-button" type="button" data-mcal-remove="${index}">Quitar</button></span>`}
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
            ${cupos.length ? `
                <ul class="mcal-dialog-list mcal-dialog-list--gaps">
                    ${cupos.map((cupo, index) => `
                        <li>
                            <span class="mcal-gap mcal-gap--cupo">+Cupo</span>
                            <span class="mcal-dialog-name">Cupo disponible<small>El grupo ${escapeHTML(cupo.group)} requiere 1 ${escapeHTML(cupo.label)} (Brecha RRHH)</small></span>
                            ${canEdit ? `<button class="primary-button" type="button" data-mcal-cupo="${index}" ${cupo.reference ? "" : "disabled title=\"No hay a quién parecerse: la unidad no tiene a nadie de esa profesión.\""}>Cubrir</button>` : ""}
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

        const confirmPre = event.target.closest("[data-mcal-confirm-pre]");
        const cancelPre = event.target.closest("[data-mcal-cancel-pre]");

        if (confirmPre || cancelPre) {
            const person = people[Number((confirmPre || cancelPre).dataset[confirmPre ? "mcalConfirmPre" : "mcalCancelPre"])];
            const record = person?.preassignment;

            if (!record) return;

            closeSlotDialog(backdrop, onKeydown);

            if (cancelPre) {
                cancelPreassignment(record);
            } else if (record.replaced) {
                // Cubre a un ausente: pasa a reemplazo real (proyecta y suma
                // horas), igual que en el calendario y el inicio.
                confirmPreassignment(record);
            } else {
                // Sin ausente: se aplica el turno y el motivo queda de respaldo.
                await window.confirmStandalonePreassignment?.(record, row.keyDay);
            }

            await renderMonthlyCalendarPanel();
            return;
        }

        const removeButton = event.target.closest("[data-mcal-remove]");
        const coverButton = event.target.closest("[data-mcal-cover]");
        const moveButton = event.target.closest("[data-mcal-move]");

        // "Mover": lo mismo que "Mover turno" dentro de Quitar, sin pasar por
        // el cuadro de permisos.
        if (moveButton) {
            const person = people[Number(moveButton.dataset.mcalMove)];

            if (!person) return;

            closeSlotDialog(backdrop, onKeydown);
            startShiftMove(person, row.keyDay);
            return;
        }

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
            const changed = person.extraReason || person.brecha
                ? await removeExtra(person, row.keyDay)
                : person.covering
                ? await removeCover(person, row.keyDay)
                : await removeWithLeave(person, row.keyDay);

            if (changed) await renderMonthlyCalendarPanel();
            return;
        }

        const cupoButton = event.target.closest("[data-mcal-cupo]");

        if (cupoButton) {
            const cupo = cupos[Number(cupoButton.dataset.mcalCupo)];

            if (!cupo?.reference) return;

            closeSlotDialog(backdrop, onKeydown);
            // El mismo modal que el CUBRIR de la Brecha RRHH del inicio: un
            // turno extra con motivo, no el reemplazo de un ausente.
            await window.openReplacementDialog?.(cupo.reference, row.keyDay, {
                rota: {
                    group: cupo.group,
                    estamento: cupo.estamento,
                    label: cupo.label,
                    turno: cupo.turno,
                    motive: cupo.motive
                }
            });
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

// "+ Motivos HHEE": un motivo de horas extras de los ultimos meses, o uno nuevo.
async function addHistoricalColumn(slot) {
    const model = lastModel;

    if (!model) return;

    const options = addableHistoryReasons(model, slot);
    const slotLabel = slot === "day" ? "Día" : "Noche";
    const NEW_TASK = "__mcal_new_task__";
    // Sin motivos recientes que ofrecer, directo a escribir uno nuevo.
    // Con un boton extra, el dialogo responde { action, value }: "confirm"
    // trae el motivo marcado, NEW_TASK pide escribir uno.
    const decision = options.length
        ? await showChoice(
            `¿Qué motivo de horas extras agregar a ${slotLabel}? Son los de los últimos 3 meses.`,
            {
                title: "Agregar motivo HHEE",
                confirmText: "Agregar",
                choices: options.map(item => ({
                    value: item.reason,
                    label: `${item.reason} (${item.months} ${item.months === 1 ? "mes" : "meses"})`
                })),
                extraActions: [{ text: "Crear motivo nuevo", value: NEW_TASK }]
            }
        )
        : { action: NEW_TASK };
    let reason = decision?.action === "confirm"
        ? String(decision.value || "")
        : "";

    if (decision?.action === NEW_TASK) {
        reason = String(await showPrompt(
            `Nombre del motivo de horas extras nuevo para ${slotLabel} (justifica las horas extras de quien agregues en él).`,
            {
                title: "Crear motivo HHEE nuevo",
                placeholder: "Ej.: Apoyo Clínico TC",
                confirmText: "Crear"
            }
        ) || "").trim();

        // Si ya existe con otras mayusculas, se usa la que hay: dos columnas
        // "Calidad" y "calidad" partirian las horas extras en dos motivos.
        const known = [
            ...model.extraColumns[slot],
            ...(model.historyReasons?.[slot] || []).map(item => item.reason)
        ].find(item => motiveKey(item) === motiveKey(reason));

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

function hideColumn(model, slot, reason) {
    const key = addedColumnsKey(model);
    const hidden = ui.hiddenColumns[key] ||= { day: [], night: [] };
    const added = ui.addedColumns[key];

    if (!hidden[slot].includes(reason)) hidden[slot].push(reason);
    if (added) added[slot] = added[slot].filter(item => item !== reason);
}

/**
 * Clic en el titulo de un motivo HHEE: editar su nombre (para todos los de esa
 * columna en el mes) o eliminarlo. Vacio se elimina en el acto; con gente,
 * se avisa a cuantos se les quitan las horas extras y se anulan esos turnos.
 */
async function editExtraColumn(slot, reason) {
    const model = lastModel;

    if (!model || !canEditTarget("calendarPanel")) return;

    const slotLabel = slot === "day" ? "Día" : "Noche";
    const people = model.rows.flatMap(row =>
        (row.extras[slot][reason] || []).map(person => ({ ...person, keyDay: row.keyDay }))
    );
    const workers = new Set(people.map(person => person.name));
    const decision = await showConfirm(
        `Motivo de horas extras de ${slotLabel}: "${reason}".${people.length
            ? ` Este mes lo tienen ${workers.size} ${workers.size === 1 ? "trabajador" : "trabajadores"} (${people.length} ${people.length === 1 ? "turno" : "turnos"}).`
            : " Este mes no tiene a nadie."}`,
        {
            title: "Motivo HHEE",
            confirmText: "Editar nombre",
            cancelText: "Cerrar",
            extraActions: [{ text: "Eliminar", value: "delete", tone: "danger" }]
        }
    );
    const action = decision?.action || "";

    if (action === "confirm") {
        let nextName = String(await showPrompt(
            `Nuevo nombre para "${reason}". Cambia el motivo de ${people.length ? "todos los de esta columna en el mes" : "la columna"}.`,
            { title: "Editar motivo HHEE", value: reason, confirmText: "Guardar" }
        ) || "").trim();

        if (!nextName || nextName === reason || model !== lastModel) return;

        // Si ya existe con otras mayusculas, se junta con ese.
        nextName = model.extraColumns[slot].find(item =>
            item.toLocaleLowerCase("es") === nextName.toLocaleLowerCase("es")
        ) || nextName;

        if (people.length) {
            pushHistory();
            setManualExtraReasons(
                people.filter(person => !person.preassigned).map(person => person.extraId),
                nextName
            );
            // Los preasignados llevan el motivo en su reserva.
            people
                .filter(person => person.preassigned)
                .forEach(person => setPreassignmentReason(person.preassignment.id, nextName));
            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Renombro un motivo de horas extras",
                `"${reason}" pasa a "${nextName}" en ${people.length} turnos de ${slotLabel} (Calendario Mensual, ${MONTH_NAMES[model.month]} ${model.year}).`,
                {}
            );
        }

        hideColumn(model, slot, reason);

        const added = ui.addedColumns[addedColumnsKey(model)] ||= { day: [], night: [] };

        if (!added[slot].includes(nextName)) added[slot].push(nextName);

        await renderMonthlyCalendarPanel();
        return;
    }

    if (action !== "delete") return;

    if (people.length) {
        const ok = await showConfirm(
            `A ${workers.size} ${workers.size === 1 ? "trabajador" : "trabajadores"} se ${workers.size === 1 ? "le quitarán sus" : "les quitarán sus"} horas extras de "${reason}" porque ${workers.size === 1 ? "está" : "están"} en esa tarea: se anulan ${people.length} ${people.length === 1 ? "turno" : "turnos"} de ${slotLabel} de este mes.`,
            {
                title: "Eliminar motivo HHEE",
                tone: "danger",
                confirmText: "Quitar horas extras y eliminar",
                cancelText: "Volver",
                destructive: true
            }
        );

        if (!ok || model !== lastModel) return;

        pushHistory();
        people.forEach(person => person.preassigned
            ? cancelPreassignment(person.preassignment)
            : cancelReplacementById(person.extraId, {
                reason: "extra_removed",
                details: `El supervisor elimino el motivo de horas extras "${reason}" desde el Calendario Mensual.`,
                canceledBy: "Calendario Mensual"
            }));
    }

    hideColumn(model, slot, reason);
    await renderMonthlyCalendarPanel();
}

/**
 * Mientras se mueve un turno, que casillas pueden recibirlo: la MISMA regla
 * que valida el movimiento (dia libre o con el complemento, y lo que la unidad
 * permite: 24 h, 24 h invertido...). Las que no, quedan apagadas y no reciben
 * el clic.
 */
function moveTargetReason(keyDay, slot) {
    const move = ui.pendingMove;

    if (!move || typeof window.shiftMoveDayBlockReason !== "function") return "";

    const destinationTurn = slot === "night" ? TURNO.NOCHE : TURNO.LARGA;

    if (keyDay === move.sourceKey && destinationTurn === Number(move.sourceTurn)) {
        return "Es el turno que se esta moviendo.";
    }

    return window.shiftMoveDayBlockReason(move.name, keyDay, {
        sourceKey: move.sourceKey,
        destinationTurn
    }) || "";
}

// La casilla de ORIGEN del turno que se mueve.
function isMoveSource(keyDay, slot) {
    const move = ui.pendingMove;

    return Boolean(move) &&
        keyDay === move.sourceKey &&
        slot === (Number(move.sourceTurn) === TURNO.NOCHE ? "night" : "day");
}

function moveTargetClass(keyDay, slot) {
    if (!ui.pendingMove) return "";
    if (isMoveSource(keyDay, slot)) return " is-move-source";

    return moveTargetReason(keyDay, slot) ? " is-move-blocked" : " is-move-target";
}

function moveTargetTitle(keyDay, slot) {
    if (!ui.pendingMove) return "";
    if (isMoveSource(keyDay, slot)) {
        return ` title="${escapeHTML(`Turno que se está moviendo: ${ui.pendingMove.name}`)}"`;
    }

    const reason = moveTargetReason(keyDay, slot);

    return reason ? ` title="${escapeHTML(`No puede recibir el turno: ${reason}`)}"` : "";
}

function turnLabel(turn) {
    return Number(turn) === TURNO.NOCHE ? "Noche" : "Larga";
}

function repaintPanel() {
    const panel = document.getElementById(PANEL_ID);

    if (panel && lastModel) paintModel(panel, lastModel, monthlyGroups(ui.month));
}

function onMoveKeydown(event) {
    if (event.key === "Escape" && ui.pendingMove) cancelShiftMove();
}

function cancelShiftMove() {
    ui.pendingMove = null;
    document.removeEventListener("keydown", onMoveKeydown);
    repaintPanel();
}

/**
 * "Mover turno": el mismo movimiento del calendario principal (queda en
 * `shiftMoves` y en el detalle de los reportes), eligiendo el destino con un
 * clic en la casilla de Titulares del dia y tramo al que va. Si el grupo que
 * pierde a la persona queda corto, la Brecha muestra su +Cupo solo.
 */
function startShiftMove(person, keyDay) {
    if (typeof window.applyShiftMove !== "function") return;

    ui.pendingMove = {
        name: person.name,
        sourceKey: keyDay,
        sourceTurn: Number(getTurnoBase(person.name, keyDay)) || TURNO.LARGA
    };
    document.addEventListener("keydown", onMoveKeydown);
    repaintPanel();
}

async function pickShiftMoveTarget(row, slot) {
    const move = ui.pendingMove;
    const destinationTurn = slot === "night" ? TURNO.NOCHE : TURNO.LARGA;
    const blockReason = window.shiftMoveDayBlockReason?.(move.name, row.keyDay, {
        sourceKey: move.sourceKey,
        destinationTurn
    });

    if (blockReason) {
        await showAlert(blockReason, { title: "No se puede mover ahí", tone: "warning" });
        return;
    }

    const ok = await showConfirm(
        `¿Deseas mover el turno de ${turnLabel(move.sourceTurn)} de ${move.name} del ${slotDateLabel(move.sourceKey)} al ${slot === "night" ? "Noche" : "Día (Larga)"} del ${slotDateLabel(row.keyDay)}?`,
        { title: "Mover turno", confirmText: "Mover", cancelText: "Volver" }
    );

    if (!ok || ui.pendingMove !== move) return;

    const result = window.applyShiftMove({
        profile: move.name,
        sourceKey: move.sourceKey,
        sourceTurn: move.sourceTurn,
        destinationTurn,
        targetKey: row.keyDay
    });

    if (!result?.ok) {
        await showAlert(result?.reason || "No se pudo mover el turno.", {
            title: "No se movió el turno",
            tone: "warning"
        });
        if (result?.sourceGone) cancelShiftMove();
        return;
    }

    ui.pendingMove = null;
    document.removeEventListener("keydown", onMoveKeydown);
    await renderMonthlyCalendarPanel();
}

function onPanelClick(event) {
    if (ui.pendingMove) {
        if (event.target.closest("[data-mcal-move-cancel]")) {
            cancelShiftMove();
            return;
        }

        const target = event.target.closest('[data-mcal-slot][data-mcal-col="titulares"].is-move-target');
        const targetRow = target && lastModel?.rows.find(item => item.keyDay === target.dataset.mcalKey);

        // Con el movimiento en curso, un clic en Titulares es el destino; el
        // resto de la tabla no abre nada (si se puede cambiar de mes).
        if (targetRow) {
            void pickShiftMoveTarget(targetRow, target.dataset.mcalSlot);
            return;
        }

        if (!event.target.closest("[data-mcal='prev'], [data-mcal='next']")) return;
    }

    const head = event.target.closest("[data-mcal-head-reason]");

    if (head) {
        event.stopPropagation();
        void editExtraColumn(head.dataset.mcalHeadSlot, head.dataset.mcalHeadReason);
        return;
    }

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

    if (event.target.closest("[data-mcal-magic]") && lastModel) {
        void openMonthlyMagic({
            month: ui.month,
            group: ui.group,
            monthLabel: `${MONTH_NAMES[ui.month.getMonth()]} ${ui.month.getFullYear()}`,
            buildModel: () => buildMonthlyCalendar(ui.month, ui.group),
            // Etapa 2: quienes de esta profesion podrian pasar de Diurno a turno.
            groupNames: monthProfiles(ui.month)
                .filter(profile => isProfileActive(profile) && groupKeyFor(profile) === ui.group)
                .map(profile => profile.name),
            onApplied: () => renderMonthlyCalendarPanel()
        });
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
