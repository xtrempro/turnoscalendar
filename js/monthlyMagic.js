// Boton "Ayuda para cubrir" del Calendario Mensual: arma el plan del mes
// (js/monthlyMagicPlan.js) y lo muestra como consejos numerados, cada uno con
// su detalle, casillas y "Aplicar". Al aplicar, el mes se vuelve a calcular y
// los consejos se rehacen: lo que se movio cambia lo que conviene despues.

import { escapeHTML } from "./htmlUtils.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import { getCompensationProfileAt, getRotativa, getTurnChangeConfig } from "./storage.js";
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
import { getAbsenceLabelForProfileDate, saveReplacement } from "./replacements.js";
import { addPreassignment } from "./preassignments.js";
import { pushHistory } from "./history.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import { showAlert } from "./dialogs.js";
import { applyGroupChange, countAffectedFrom, firstTurnForColumnAt, loadLeaveHolidays } from "./shiftHolders.js";
import { MOVE_TIERS, movesByWorker, orderMovesForApply, planMonth } from "./monthlyMagicPlan.js";

const SLOT_LABEL = { day: "Día", night: "Noche" };

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
    const tomorrow = new Date();

    tomorrow.setDate(tomorrow.getDate() + 1);

    return {
        shouldContinue,
        // Etapa 2: quien hace Diurno en esta profesion puede pasar a un grupo.
        diurnoWorkers: () => groupNames.filter(name =>
            String(getRotativa(name)?.type || "") === "diurno" &&
            !isHonorariaProfile(name)
        ),
        firstTurnFor: (letter, keyDay) => firstTurnForColumnAt(letter, keyToDate(keyDay)),
        affectedFrom: async (name, keyDay) =>
            countAffectedFrom(name, keyToDate(keyDay), await loadLeaveHolidays(name)),
        minStartKey: `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`,
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

function adviceHTML(number, title, text, body, kind, count, { preassign = false } = {}) {
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
            `${number > 1 ? "Lo que sigue faltando después de los consejos anteriores. " : ""}Se propone primero a quien tiene menos horas extras este mes, sin pasar el tope de ${hoursLabel(getMonthlyDiurnalOvertimeLimit())} h diurnas, y después al de grado más alto. Puedes cambiar a quién en cada turno, y preasignarlos (en azul, sin horas ni aviso a la app hasta que se confirmen) en vez de asignarlos.`,
            plan.covers.map(coverRowHTML).join(""),
            "cover",
            plan.covers.length,
            { preassign: true }
        ));
    }

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
        ${pending}
        ${surplus}`;
}

/* ---------- aplicar ---------- */

function applyMove(item) {
    const { sourceKey, targetKey } = item;
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
    if (item.covers) {
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

function applyCover(item, worker, { preassign = false } = {}) {
    if (Number(getTurnoReal(worker, item.keyDay)) !== TURNO.LIBRE) {
        return `${worker} ya tiene turno el ${dateLabel(item.keyDay)}.`;
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

    async function apply(kind, onlySelected, preassign = false) {
        if (!plan) return;

        const section = backdrop.querySelector(`[data-magic-advice="${CSS.escape(kind)}"]`);
        const picked = type => [...(section?.querySelectorAll(`[data-magic-pick="${type}"]`) || [])]
            .filter(input => !onlySelected || input.checked)
            .map(input => Number(input.value));
        const errors = [];

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
                const ok = await applyGroupChange({
                    profile: item.name,
                    startISO: isoOf(item.startKey),
                    firstTurn: item.firstTurn,
                    toLetter: item.group
                });

                if (!ok) errors.push(`${item.name}: no se pudo cambiar la rotativa.`);
            }
        } else if (kind === "cover") {
            picked("cover").forEach(index => {
                const item = plan.covers[index];
                const worker = section.querySelector(`[data-magic-worker="${index}"]`)?.value || item.worker;
                const error = applyCover(item, worker, { preassign });

                if (error) errors.push(error);
            });
        }

        await onApplied?.();

        if (errors.length) {
            await showAlert(`Algunos no se aplicaron porque el calendario cambió:\n\n${errors.join("\n")}`, {
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
            button.disabled = true;
            void apply(
                button.dataset.magicApply,
                button.dataset.magicOnly === "selected",
                button.hasAttribute("data-magic-preassign")
            );
        }
    });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    await recompute();
}
