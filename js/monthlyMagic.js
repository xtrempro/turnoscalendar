// Boton "Ayuda para cubrir" del Calendario Mensual: arma el plan del mes
// (js/monthlyMagicPlan.js) y lo muestra como consejos numerados, cada uno con
// su detalle, casillas y "Aplicar". Al aplicar, el mes se vuelve a calcular y
// los consejos se rehacen: lo que se movio cambia lo que conviene despues.

import { escapeHTML } from "./htmlUtils.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import {
    getCompensationProfileAt,
    getReplacementRequestConfig,
    getReplacementRequests,
    getRotativa,
    getTurnChangeConfig
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { getHourReturn } from "./hourReturns.js";
import { getClockMarks } from "./clockMarks.js";
import { hasContractForDate, isHonorariaProfile, isReplacementProfile } from "./contracts.js";
import {
    buildReplacementCandidates,
    getMonthlyDiurnalOvertimeLimit,
    getReplacementNeededTurn
} from "./replacementCandidates.js";
import { calcExtraHours } from "./calculations.js";
import { fetchHolidays } from "./holidays.js";
import {
    cancelReplacementRequest,
    createReplacementRequest,
    getAbsenceLabelForProfileDate,
    isCupoStillOpen,
    saveReplacement
} from "./replacements.js";
import { isShiftUncovered } from "./home.js";
import { IS_TEST_ENVIRONMENT } from "./firebaseConfig.js";
import { moveShiftCreatesInvertedTwentyFour } from "./rulesEngine.js";
import { addPreassignment } from "./preassignments.js";
import { pushHistory } from "./history.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import { showAlert } from "./dialogs.js";
import { applyGroupChange, countAffectedFrom, firstTurnForColumnAt, loadLeaveHolidays } from "./shiftHolders.js";
import { MOVE_TIERS, movesByWorker, orderMovesForApply, planMonth } from "./monthlyMagicPlan.js";

const SLOT_LABEL = { day: "Día", night: "Noche" };

// Solicitudes a la app por un CUPO de la Brecha. Una pestaña de supervisor con
// la version anterior aplicaria su aceptacion sin el motivo del cupo, asi que
// en produccion se encienden recien cuando no quedan versiones viejas abiertas
// (se cambia esta marca y se vuelve a desplegar). Las solicitudes por una
// ausencia no dependen de esto: las versiones anteriores ya las procesan bien.
export const CUPO_APP_REQUESTS_IN_PRODUCTION = false;
const CUPO_APP_REQUESTS_ENABLED = IS_TEST_ENVIRONMENT || CUPO_APP_REQUESTS_IN_PRODUCTION;

function dayNumber(keyDay) {
    return Math.round(keyToDate(keyDay).getTime() / 86400000);
}

// Manana: nada se aplica sobre un dia que ya paso (ni sobre hoy, en curso).
function firstActionableKey() {
    const tomorrow = new Date();

    tomorrow.setDate(tomorrow.getDate() + 1);
    return `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;
}

function isActionable(keyDay) {
    return dayNumber(keyDay) >= dayNumber(firstActionableKey());
}

function keyToDate(keyDay) {
    const [y, m, d] = String(keyDay).split("-").map(Number);

    return new Date(y, m, d);
}

function dateLabel(keyDay) {
    return keyToDate(keyDay).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" });
}

function turnLabel(turn) {
    return TURNO_LABEL[Number(turn)] || "Turno";
}

function hoursLabel(value) {
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function rotationLabel(name) {
    const type = String(getRotativa(name)?.type || "");

    return { "3turno": "3er turno", "4turno": "4to turno", diurno: "diurno" }[type] || type;
}

// Lo que el plan necesita leer de la pagina.
function isoOf(keyDay) {
    const date = keyToDate(keyDay);

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function browserDeps(holidays, shouldContinue, groupNames = []) {
    return {
        shouldContinue,
        // Etapa 2: quien hace Diurno en esta profesion puede pasar a un grupo.
        // Sin honorarios ni contratos de reemplazo: su rotativa la fija el
        // contrato, y reescribirla desde aqui lo dejaria descalzado.
        diurnoWorkers: () => groupNames.filter(name =>
            String(getRotativa(name)?.type || "") === "diurno" &&
            !isHonorariaProfile(name) &&
            !isReplacementProfile(name)
        ),
        firstTurnFor: (letter, keyDay) => firstTurnForColumnAt(letter, keyToDate(keyDay)),
        affectedFrom: async (name, keyDay) =>
            countAffectedFrom(name, keyToDate(keyDay), await loadLeaveHolidays(name)),
        minStartKey: firstActionableKey(),
        pendingRequestFor: ({ replaced, keyDay, cupoKey }) =>
            getReplacementRequests().find(request =>
                request?.status === "pending" &&
                request.keyDay === keyDay &&
                (replaced ? request.replaced === replaced : request.cupoKey === cupoKey)
            ) || null,
        canMoveSource: (name, keyDay) =>
            !isHonorariaProfile(name, keyDay) &&
            typeof window.shiftMoveDayBlockReason === "function" &&
            !window.shiftMoveDayBlockReason(name, keyDay, { source: true }),
        // Cascada: 3er turno; 4to turno de reemplazo; 4to turno contrata/planta.
        tierOf: (name, keyDay) => {
            const type = String(getRotativa(name)?.type || "");

            if (type === "3turno") return 1;
            if (type === "4turno") return isReplacementProfile(name, keyDay) ? 2 : 3;
            return 0;
        },
        // Lo que impide recibir un turno movido (la misma lista de "Mover turno").
        dayBlock: (name, keyDay) => {
            if (["admin_", "legal_", "comp_", "absences_"].some(prefix => getJSON(`${prefix}${name}`, {})?.[keyDay])) {
                return "Permiso o ausencia";
            }
            if (getHourReturn(name, keyDay)) return "Devolución de horas";
            if (getClockMarks(name)?.[keyDay]) return "Marcaje de reloj";
            return "";
        },
        allowInverted: getTurnChangeConfig().allowInvertedTwentyFourHourShifts !== false,
        turnAt: (name, keyDay) => Number(getTurnoReal(name, keyDay)) || TURNO.LIBRE,
        baseTurn: (name, keyDay) => Number(getTurnoBase(name, keyDay)) || TURNO.LIBRE,
        neededTurnFor: (name, keyDay) => Number(getReplacementNeededTurn(name, keyDay)) || TURNO.LIBRE,
        extraHours: (keyDay, turn) => calcExtraHours(keyToDate(keyDay), Number(turn), holidays),
        diurnalLimit: getMonthlyDiurnalOvertimeLimit(),
        candidatesFor: async ({ reference, keyDay, turn }) => {
            const result = await buildReplacementCandidates(reference, keyDay, {
                neededTurn: turn,
                scope: "compatible",
                holidays,
                shouldContinue
            });
            const date = keyToDate(keyDay);

            return (result?.candidates || []).map(candidate => {
                const name = candidate.profile.name;

                return {
                    name,
                    hheeD: candidate.hheeDiurnas,
                    hheeN: candidate.hheeNocturnas,
                    isFree: candidate.isFree && !candidate.backsPendingExtra,
                    blockedDay: Boolean(candidate.blockedDay),
                    isForced: Boolean(candidate.isForced),
                    isLinked: false,
                    // Un trabajador de reemplazo sin contrato ese dia pasa por el
                    // editor de contrato: eso queda para el modal de siempre.
                    needsContract: isReplacementProfile(name, keyDay) && !hasContractForDate(name, keyDay),
                    grade: Number(getCompensationProfileAt(name, date)?.grade) || 0
                };
            });
        }
    };
}

/* ---------- HTML ---------- */

function invertedTag(item) {
    return item.inverted
        ? `<span class="mcal-magic-tag is-warn" title="Último recurso: no había otra forma sin un 24 invertido">24 invertido</span>`
        : "";
}

function coversText(item) {
    if (item.covers) return `cubre a ${escapeHTML(item.covers)}`;
    if (item.cupo) return "cubre un cupo de la Brecha";
    return "completa el turno";
}

function moveRowHTML(item, index) {
    return `
        <label class="mcal-magic-row">
            <input type="checkbox" data-magic-pick="move" value="${index}" checked>
            <span>${item.sameDay
                ? `${escapeHTML(dateLabel(item.sourceKey))}: de ${escapeHTML(turnLabel(item.sourceTurn))} a <b>${escapeHTML(turnLabel(item.destinationTurn))}</b> el mismo día`
                : `${escapeHTML(dateLabel(item.sourceKey))} ${escapeHTML(turnLabel(item.sourceTurn))} → <b>${escapeHTML(dateLabel(item.targetKey))} ${escapeHTML(turnLabel(item.destinationTurn))}</b>`}, ${coversText(item)}</span>
            ${invertedTag(item)}
        </label>`;
}

function coverRowHTML(item, index) {
    const what = item.replaced
        ? `cubre a ${escapeHTML(item.replaced)}`
        : `cupo de la Brecha${item.cupo?.label ? ` (${escapeHTML(item.cupo.label)})` : ""}`;
    const options = [
        { name: item.worker, hhee: item.hhee, grade: item.grade },
        ...(item.alternatives || [])
    ];

    return `
        <div class="mcal-magic-row">
            <input type="checkbox" data-magic-pick="cover" value="${index}" checked aria-label="Aplicar">
            <span>${escapeHTML(dateLabel(item.keyDay))} · ${escapeHTML(turnLabel(item.turn))} · ${what}</span>
            <select data-magic-worker="${index}" aria-label="Quién lo cubre">
                ${options.map(option => `<option value="${escapeHTML(option.name)}">${escapeHTML(option.name)} · ${hoursLabel(option.hhee)} h HHEE · grado ${escapeHTML(String(option.grade || "—"))}</option>`).join("")}
            </select>
            ${invertedTag(item)}
        </div>`;
}

function adviceHTML(number, title, text, body, kind, count, { preassign = false, request = false } = {}) {
    return `
        <section class="mcal-magic-advice" data-magic-advice="${kind}">
            <div class="mcal-magic-advice-head">
                <span class="mcal-magic-number">${number}</span>
                <div>
                    <strong>${title}</strong>
                    <p>${text}</p>
                </div>
            </div>
            <details>
                <summary>Ver detalle (${count})</summary>
                <div class="mcal-magic-list">${body}</div>
            </details>
            <div class="mcal-magic-actions">
                ${preassign ? `
                <button class="secondary-button mcal-magic-preassign" type="button" data-magic-apply="${kind}" data-magic-only="selected" data-magic-preassign title="Quedan en azul, sin horas ni aviso a la app, hasta que se confirmen">Preasignar seleccionados</button>
                <button class="secondary-button mcal-magic-preassign" type="button" data-magic-apply="${kind}" data-magic-only="all" data-magic-preassign title="Quedan en azul, sin horas ni aviso a la app, hasta que se confirmen">Preasignar todo</button>
                ${request ? `
                <button class="secondary-button mcal-magic-request" type="button" data-magic-apply="${kind}" data-magic-only="selected" data-magic-request title="Le llega a la app; si acepta, el turno queda asignado">Enviar solicitud seleccionados</button>
                <button class="secondary-button mcal-magic-request" type="button" data-magic-apply="${kind}" data-magic-only="all" data-magic-request title="Le llega a la app; si acepta, el turno queda asignado">Enviar solicitud a todos</button>` : ""}
                <span class="mcal-magic-actions-gap"></span>` : ""}
                <button class="secondary-button" type="button" data-magic-apply="${kind}" data-magic-only="selected">Aplicar seleccionados</button>
                <button class="primary-button" type="button" data-magic-apply="${kind}" data-magic-only="all">Aplicar todo</button>
            </div>
        </section>`;
}

export function planHTML(plan, monthLabel) {
    const groups = movesByWorker(plan.moves);
    const advices = [];
    let number = 0;

    groups.forEach(group => {
        const indexes = group.items.map(item => plan.moves.indexOf(item));

        advices.push(adviceHTML(
            ++number,
            `Mover ${group.items.length} ${group.items.length === 1 ? "turno" : "turnos"} de ${escapeHTML(group.name)}`,
            `${escapeHTML(MOVE_TIERS.find(tier => tier.id === group.tier)?.label || rotationLabel(group.name))}: en ${group.items.length === 1 ? "uno de sus turnos" : `${group.items.length} de sus turnos`} de este mes queda como supernumerario. Se mueve a turnos donde falta gente (cupos o ausencias). No suma horas extras.`,
            group.items.map((item, position) => moveRowHTML(item, indexes[position])).join(""),
            `move:${escapeHTML(group.name)}`,
            group.items.length
        ));
    });

    (plan.rotations || []).forEach((item, index) => {
        const lost = item.affected?.length
            ? ` Desde esa fecha se reescribe su calendario y se pierden: ${item.affected.map(entry => `${escapeHTML(entry.label)} (${entry.count})`).join(", ")}.`
            : "";

        advices.push(adviceHTML(
            ++number,
            `Pasar a ${escapeHTML(item.name)} de Diurno al grupo ${escapeHTML(item.group)}`,
            `Al grupo ${escapeHTML(item.group)} le falta gente en ${item.fills} turnos de este mes desde el ${escapeHTML(dateLabel(item.startKey))}. ${escapeHTML(item.name)} hace rotativa diurna: pasa al 4to turno en ese grupo desde ese día, partiendo con ${escapeHTML(item.firstTurnLabel)}, y deja de hacer Diurno. No suma horas extras: es su nueva rotativa.${lost}${item.alternatives?.length ? ` Otras personas de Diurno: ${item.alternatives.map(escapeHTML).join(", ")}.` : ""}`,
            `<label class="mcal-magic-row">
                <input type="checkbox" data-magic-pick="rotation" value="${index}" checked>
                <span>${escapeHTML(item.name)} → grupo ${escapeHTML(item.group)} desde el ${escapeHTML(dateLabel(item.startKey))} (${escapeHTML(item.firstTurnLabel)}), cubre ${item.fills} turnos del mes</span>
            </label>`,
            `rotation:${index}`,
            1
        ));
    });

    if (plan.covers.length) {
        advices.push(adviceHTML(
            ++number,
            `Cubrir ${plan.covers.length} ${plan.covers.length === 1 ? "turno" : "turnos"} con horas extras`,
            `${number > 1 ? "Lo que sigue faltando después de los consejos anteriores. " : ""}Se propone primero a quien tiene menos horas extras este mes, sin pasar el tope de ${hoursLabel(getMonthlyDiurnalOvertimeLimit())} h diurnas, y después al de grado más alto. Puedes cambiar a quién en cada turno, y preasignarlos (en azul, sin horas ni aviso a la app hasta que se confirmen) o enviarles la solicitud a su app (si aceptan, el turno queda asignado) en vez de asignarlos.`,
            plan.covers.map(coverRowHTML).join(""),
            "cover",
            plan.covers.length,
            {
                preassign: true,
                request: getReplacementRequestConfig().enableWorkerAcceptanceRequest !== false
            }
        ));
    }

    const waiting = plan.waiting?.length
        ? `<section class="mcal-magic-pending">
                <strong>Esperando respuesta en la app (${plan.waiting.length})</strong>
                <ul>${plan.waiting.map(item => `<li>${escapeHTML(dateLabel(item.keyDay))} · ${escapeHTML(turnLabel(item.turn))} · ${item.replaced ? `cubre a ${escapeHTML(item.replaced)}` : "cupo de la Brecha"}: solicitud a ${escapeHTML(item.worker)}</li>`).join("")}</ul>
            </section>`
        : "";
    const pending = plan.unresolved.length
        ? `<section class="mcal-magic-pending">
                <strong>Sin solución por ahora (${plan.unresolved.length})</strong>
                <ul>${plan.unresolved.map(item => `<li>${escapeHTML(dateLabel(item.keyDay))} · ${SLOT_LABEL[item.slot]}${item.replaced ? ` · ${escapeHTML(item.replaced)}` : ""}: ${escapeHTML(item.reason)}</li>`).join("")}</ul>
            </section>`
        : "";
    const surplus = plan.surplus.length
        ? `<p class="mcal-magic-note">Quedan ${plan.surplus.length} ${plan.surplus.length === 1 ? "turno" : "turnos"} con gente de más que no se pudo mover sin romper las reglas de la unidad.</p>`
        : "";

    return `
        <p class="mcal-magic-summary">${escapeHTML(monthLabel)} · Meta: <b>${plan.target}</b> por turno en Titulares.${advices.length > 1 ? " Cada consejo cuenta con que se aplican los anteriores." : ""}</p>
        ${advices.length ? advices.join("") : `<p class="mcal-magic-empty">Todos los turnos ya tienen ${plan.target} ${plan.target === 1 ? "persona" : "personas"}. No hay nada que ajustar.</p>`}
        ${waiting}
        ${pending}
        ${surplus}`;
}

/* ---------- aplicar ---------- */

function applyMove(item) {
    const { sourceKey, targetKey } = item;

    if (!isActionable(sourceKey) || !isActionable(targetKey)) {
        return "ese día ya pasó.";
    }

    // applyShiftMove vuelve a revisar el origen y el destino con las reglas de
    // "Mover turno" (permisos, marcajes, cambios, 24 y 24 invertido).
    const result = window.applyShiftMove?.({
        profile: item.name,
        sourceKey,
        sourceTurn: item.sourceTurn,
        destinationTurn: item.destinationTurn,
        targetKey
    });

    if (!result?.ok) return result?.reason || "No se pudo mover el turno.";

    // En el destino habia un ausente sin cubrir: queda cubierto con este turno.
    // Es su propio turno movido, asi que no se le agrega otro (addsShift false)
    // ni suma horas extras.
    if (item.covers && isShiftUncovered(item.covers, targetKey)) {
        saveReplacement({
            worker: item.name,
            replaced: item.covers,
            keyDay: targetKey,
            turno: item.destinationTurn,
            source: "manual_extra",
            addsShift: false
        });
    }

    return "";
}

/**
 * Por que ya no se puede aplicar una cobertura ("" si se puede). Se revisa
 * todo de nuevo al aplicar, no lo que valia al calcular el plan: el modal pudo
 * quedar abierto mientras cambiaban permisos, contratos, turnos u horas. `batch`
 * acumula lo de este mismo envio (horas y turnos de quien ya se eligio en
 * otra fila), que el calendario todavia no ve si es preasignacion o solicitud.
 */
export async function coverBlockReason(item, worker, { batch, holidays, countsBatchHours }) {
    const when = dateLabel(item.keyDay);

    if (!isActionable(item.keyDay)) return `${when}: ese día ya pasó.`;
    if (Number(getTurnoReal(worker, item.keyDay)) !== TURNO.LIBRE) {
        return `${worker} ya tiene turno el ${when}.`;
    }

    const stillNeeded = item.replaced
        ? isShiftUncovered(item.replaced, item.keyDay)
        : isCupoStillOpen(item.cupo?.motive || "", item.keyDay, item.turn);

    if (!stillNeeded) return `${when}: ese turno ya está cubierto.`;

    const batchTurns = batch.turns.get(worker) || new Map();

    if (batchTurns.has(item.keyDay)) return `${worker} ya tiene otro turno de este envío el ${when}.`;

    const around = offset => {
        const date = keyToDate(item.keyDay);

        date.setDate(date.getDate() + offset);

        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

        return batchTurns.get(key) ?? (Number(getTurnoReal(worker, key)) || TURNO.LIBRE);
    };

    if (
        getTurnChangeConfig().allowInvertedTwentyFourHourShifts === false &&
        moveShiftCreatesInvertedTwentyFour(item.turn, around(-1), around(1))
    ) {
        return `${worker} quedaría en 24 invertido el ${when}.`;
    }

    if (isReplacementProfile(worker, item.keyDay) && !hasContractForDate(worker, item.keyDay)) {
        return `${worker} no tiene contrato vigente el ${when}.`;
    }

    const reference = item.replaced || item.cupo?.reference || "";
    const result = reference
        ? await buildReplacementCandidates(reference, item.keyDay, {
            neededTurn: item.turn,
            scope: "compatible",
            holidays
        })
        : null;
    const candidate = (result?.candidates || []).find(entry => entry.profile.name === worker);

    if (!candidate || !candidate.isFree || candidate.backsPendingExtra || candidate.blockedDay || candidate.isForced) {
        return `${worker} ya no está disponible para el ${when}.`;
    }

    const adding = Number(calcExtraHours(keyToDate(item.keyDay), Number(item.turn), holidays)?.d) || 0;
    const already = countsBatchHours ? batch.hours.get(worker) || 0 : 0;
    const limit = getMonthlyDiurnalOvertimeLimit();

    if ((Number(candidate.hheeDiurnas) || 0) + already + adding > limit) {
        return `${worker} pasaría el tope de ${hoursLabel(limit)} h diurnas con el turno del ${when}.`;
    }

    return "";
}

function applyCover(item, worker, { preassign = false, request = false } = {}) {

    // Solicitud a la app: le llega al trabajador y, si acepta, el turno se
    // asigna solo (applyAcceptedReplacementRequests). Un cupo lleva su motivo.
    if (request) {
        if (!item.replaced && !CUPO_APP_REQUESTS_ENABLED) {
            return `${dateLabel(item.keyDay)}: las solicitudes por cupo aún no están habilitadas; usa Aplicar o Preasignar.`;
        }

        const created = createReplacementRequest({
            worker,
            replaced: item.replaced || "",
            keyDay: item.keyDay,
            turno: item.turn,
            absenceType: item.replaced
                ? getAbsenceLabelForProfileDate(item.replaced, item.keyDay)
                : item.cupo?.motive || "",
            reason: item.replaced ? "" : item.cupo?.motive || "",
            cupoKey: item.replaced ? "" : item.cupoKey || "",
            scope: "compatible",
            source: "replacement_request"
        });

        // Sin la app enlazada la solicitud iria por WhatsApp, uno por uno:
        // eso queda para el modal de sugerencias.
        if (created.channel !== "app") {
            cancelReplacementRequest(created.id, "admin");
            return `${worker} no tiene la app enlazada: no se le envió la solicitud.`;
        }

        return "";
    }

    // Preasignar: la misma reserva del modal de sugerencias (en azul, sin
    // horas ni proyeccion hasta que se confirma). Un cupo no cubre a nadie: su
    // motivo va en `reason` y al confirmar queda como respaldo.
    if (preassign) {
        addPreassignment({
            worker,
            replaced: item.replaced || "",
            reason: item.replaced ? "" : item.cupo?.motive || "",
            comment: "",
            keyDay: item.keyDay,
            turno: item.turn,
            absenceType: item.replaced ? getAbsenceLabelForProfileDate(item.replaced, item.keyDay) : ""
        });
        addAuditLog(
            AUDIT_CATEGORY.CALENDAR,
            "Preasigno turno con la ayuda del Calendario Mensual",
            `${worker}: ${turnLabel(item.turn)} del ${item.keyDay} preasignado, ${item.replaced ? `cubre a ${item.replaced}` : `cupo de la Brecha (${item.cupo?.motive || ""})`}.`,
            { profile: worker, keyDay: item.keyDay }
        );
        return "";
    }

    saveReplacement(item.replaced
        ? {
            worker,
            replaced: item.replaced,
            keyDay: item.keyDay,
            turno: item.turn,
            source: "replacement"
        }
        : {
            worker,
            replaced: "",
            reason: item.cupo?.motive || "",
            comment: "",
            keyDay: item.keyDay,
            turno: item.turn,
            source: "rota_gap"
        });
    addAuditLog(
        AUDIT_CATEGORY.CALENDAR,
        "Asigno turno con la ayuda del Calendario Mensual",
        `${worker}: ${turnLabel(item.turn)} del ${item.keyDay}, ${item.replaced ? `cubre a ${item.replaced}` : `cupo de la Brecha (${item.cupo?.motive || ""})`}.`,
        { profile: worker, keyDay: item.keyDay }
    );

    return "";
}

/* ---------- modal ---------- */

/**
 * @param {Object} options
 * @param {Date} options.month
 * @param {string} options.group      profesion o estamento visible
 * @param {string} options.monthLabel
 * @param {Function} options.buildModel  () => Promise<model|null> del mes visible
 * @param {Function} options.onApplied   () => Promise, repinta el calendario
 */
export async function openMonthlyMagic({ month, group, monthLabel, buildModel, onApplied, groupNames = [] }) {
    const backdrop = document.createElement("div");
    let plan = null;
    let runId = 0;
    let closed = false;

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog mcal-magic-dialog" role="dialog" aria-modal="true" aria-labelledby="mcalMagicTitle">
            <div class="mcal-schedule-head">
                <strong id="mcalMagicTitle">Ayuda para cubrir el mes · ${escapeHTML(group)}</strong>
                <button type="button" class="replacement-dialog-close" data-magic-close aria-label="Cerrar">×</button>
            </div>
            <div class="mcal-magic-body" data-magic-body></div>
        </section>`;

    const body = backdrop.querySelector("[data-magic-body]");
    const close = () => {
        closed = true;
        runId += 1;
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    async function recompute() {
        const id = ++runId;

        body.innerHTML = `<p class="mcal-magic-loading">Analizando el mes: turnos, ausencias, cupos y horas extras de cada trabajador…</p>`;

        const holidays = await fetchHolidays(month.getFullYear());
        const model = await buildModel();

        if (closed || id !== runId) return;

        if (!model) {
            body.innerHTML = `<p class="mcal-magic-empty">No se pudo leer el mes. Cierra y vuelve a intentarlo.</p>`;
            return;
        }

        const next = await planMonth(model, browserDeps(holidays, () => !closed && id === runId, groupNames));

        if (closed || id !== runId || !next) return;

        plan = next;
        body.innerHTML = planHTML(plan, monthLabel);
    }

    let applying = false;

    function setBusy(busy) {
        backdrop.querySelectorAll("[data-magic-apply]").forEach(button => {
            button.disabled = busy;
        });
        backdrop.classList.toggle("is-busy", busy);
    }

    async function apply(kind, onlySelected, preassign = false, request = false) {
        if (!plan || applying) return;

        // Uno a la vez: con los botones activos, dos clics seguidos aplicaban
        // dos consejos a medias sobre el mismo calendario.
        applying = true;
        setBusy(true);

        const section = backdrop.querySelector(`[data-magic-advice="${CSS.escape(kind)}"]`);
        const picked = type => [...(section?.querySelectorAll(`[data-magic-pick="${type}"]`) || [])]
            .filter(input => !onlySelected || input.checked)
            .map(input => Number(input.value));
        const errors = [];

        try {
            pushHistory();

            if (kind.startsWith("move:")) {
                // El que libera un dia va antes que el que llega a ese dia.
                orderMovesForApply(picked("move").map(index => plan.moves[index])).forEach(move => {
                    const error = applyMove(move);

                    if (error) errors.push(`${move.name} (${dateLabel(move.sourceKey)}): ${error}`);
                });
            } else if (kind.startsWith("rotation:")) {
                for (const index of picked("rotation")) {
                    const item = plan.rotations[index];

                    if (!isActionable(item.startKey)) {
                        errors.push(`${item.name}: el ${dateLabel(item.startKey)} ya pasó.`);
                        continue;
                    }

                    if (String(getRotativa(item.name)?.type || "") !== "diurno" || isReplacementProfile(item.name)) {
                        errors.push(`${item.name}: ya no hace rotativa diurna.`);
                        continue;
                    }

                    const ok = await applyGroupChange({
                        profile: item.name,
                        startISO: isoOf(item.startKey),
                        firstTurn: item.firstTurn,
                        toLetter: item.group
                    });

                    if (!ok) errors.push(`${item.name}: no se pudo cambiar la rotativa.`);
                }
            } else if (kind === "cover") {
                const holidays = await fetchHolidays(month.getFullYear());
                const batch = { hours: new Map(), turns: new Map() };

                for (const index of picked("cover")) {
                    const item = plan.covers[index];
                    const worker = section.querySelector(`[data-magic-worker="${index}"]`)?.value || item.worker;
                    const blocked = await coverBlockReason(item, worker, {
                        batch,
                        holidays,
                        // Lo asignado de verdad ya lo ve el calendario; lo
                        // preasignado o solicitado, no.
                        countsBatchHours: preassign || request
                    });
                    const error = blocked || applyCover(item, worker, { preassign, request });

                    if (error) {
                        errors.push(error);
                        continue;
                    }

                    const adding = Number(calcExtraHours(keyToDate(item.keyDay), Number(item.turn), holidays)?.d) || 0;

                    batch.hours.set(worker, (batch.hours.get(worker) || 0) + adding);
                    if (!batch.turns.has(worker)) batch.turns.set(worker, new Map());
                    batch.turns.get(worker).set(item.keyDay, Number(item.turn));
                }
            }
        } catch (error) {
            console.error(error);
            errors.push(`Se detuvo por un error: ${error?.message || error}. Lo anterior a ese punto sí quedó aplicado.`);
        } finally {
            applying = false;
        }

        try {
            await onApplied?.();
        } catch (error) {
            console.error(error);
        }

        if (errors.length) {
            await showAlert(`Algunos no se aplicaron:\n\n${errors.join("\n")}`, {
                title: "Aplicado en parte",
                tone: "warning"
            });
        }

        await recompute();
    }

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop || event.target.closest("[data-magic-close]")) {
            close();
            return;
        }

        const button = event.target.closest("[data-magic-apply]");

        if (button) {
            void apply(
                button.dataset.magicApply,
                button.dataset.magicOnly === "selected",
                button.hasAttribute("data-magic-preassign"),
                button.hasAttribute("data-magic-request")
            );
        }
    });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    await recompute();
}
