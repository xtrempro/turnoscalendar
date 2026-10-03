// Boton "Ayuda para cubrir" del Calendario Mensual: arma el plan del mes
// (js/monthlyMagicPlan.js) y lo muestra como consejos numerados, cada uno con
// su detalle, casillas y "Aplicar". Al aplicar, el mes se vuelve a calcular y
// los consejos se rehacen: lo que se movio cambia lo que conviene despues.

import { escapeHTML } from "./htmlUtils.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import { getTurnoBase, getTurnoReal } from "./turnEngine.js";
import { getCompensationProfileAt, getRotativa } from "./storage.js";
import { hasContractForDate, isHonorariaProfile, isReplacementProfile } from "./contracts.js";
import {
    buildReplacementCandidates,
    getMonthlyDiurnalOvertimeLimit,
    getReplacementNeededTurn
} from "./replacementCandidates.js";
import { calcExtraHours } from "./calculations.js";
import { fetchHolidays } from "./holidays.js";
import { saveReplacement } from "./replacements.js";
import { pushHistory } from "./history.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import { showAlert } from "./dialogs.js";
import { movesByWorker, planMonth } from "./monthlyMagicPlan.js";

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
function browserDeps(holidays, shouldContinue) {
    return {
        shouldContinue,
        canMoveSource: (name, keyDay) =>
            !isHonorariaProfile(name, keyDay) &&
            typeof window.shiftMoveDayBlockReason === "function" &&
            !window.shiftMoveDayBlockReason(name, keyDay, { source: true }),
        targetBlock: (name, keyDay, options) =>
            typeof window.shiftMoveDayBlockReason === "function"
                ? window.shiftMoveDayBlockReason(name, keyDay, options)
                : "No disponible",
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

function swapRowHTML(item, index) {
    return `
        <label class="mcal-magic-row">
            <input type="checkbox" data-magic-pick="swap" value="${index}" checked>
            <span><b>${escapeHTML(item.name)}</b> · ${escapeHTML(dateLabel(item.keyDay))}: de ${escapeHTML(turnLabel(item.sourceTurn))} a ${escapeHTML(turnLabel(item.destinationTurn))}${item.covers ? `, ${coversText(item)}` : ""}</span>
            ${invertedTag(item)}
        </label>`;
}

function moveRowHTML(item, index) {
    return `
        <label class="mcal-magic-row">
            <input type="checkbox" data-magic-pick="move" value="${index}" checked>
            <span>${escapeHTML(dateLabel(item.sourceKey))} ${escapeHTML(turnLabel(item.sourceTurn))} → <b>${escapeHTML(dateLabel(item.targetKey))} ${escapeHTML(turnLabel(item.destinationTurn))}</b>, ${coversText(item)}</span>
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

function adviceHTML(number, title, text, body, kind, count) {
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
                <button class="secondary-button" type="button" data-magic-apply="${kind}" data-magic-only="selected">Aplicar seleccionados</button>
                <button class="primary-button" type="button" data-magic-apply="${kind}" data-magic-only="all">Aplicar todo</button>
            </div>
        </section>`;
}

export function planHTML(plan, monthLabel) {
    const groups = movesByWorker(plan.moves);
    const advices = [];
    let number = 0;

    if (plan.swaps.length) {
        advices.push(adviceHTML(
            ++number,
            `Emparejar Día y Noche (${plan.swaps.length})`,
            "El mismo día sobra gente en un turno y falta en el otro: se cambia el turno de un titular de Larga a Noche (o al revés). No suma horas extras.",
            plan.swaps.map(swapRowHTML).join(""),
            "swap",
            plan.swaps.length
        ));
    }

    groups.forEach(group => {
        const indexes = group.items.map(item => plan.moves.indexOf(item));

        advices.push(adviceHTML(
            ++number,
            `Mover ${group.items.length} ${group.items.length === 1 ? "turno" : "turnos"} de ${escapeHTML(group.name)}`,
            `Trabajador de ${escapeHTML(rotationLabel(group.name))}: en ${group.items.length === 1 ? "uno de sus turnos" : `${group.items.length} de sus turnos`} de este mes queda como supernumerario. Se mueve a turnos donde falta gente (cupos o ausencias). No suma horas extras.`,
            group.items.map((item, position) => moveRowHTML(item, indexes[position])).join(""),
            `move:${escapeHTML(group.name)}`,
            group.items.length
        ));
    });

    if (plan.covers.length) {
        advices.push(adviceHTML(
            ++number,
            `Cubrir ${plan.covers.length} ${plan.covers.length === 1 ? "turno" : "turnos"} con horas extras`,
            `Lo que sigue faltando después de los consejos anteriores. Se propone primero a quien tiene menos horas extras este mes, sin pasar el tope de ${hoursLabel(getMonthlyDiurnalOvertimeLimit())} h diurnas, y después al de grado más alto. Puedes cambiar a quién en cada turno.`,
            plan.covers.map(coverRowHTML).join(""),
            "cover",
            plan.covers.length
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
        <p class="mcal-magic-summary">${escapeHTML(monthLabel)} · Meta: <b>${plan.target}</b> por turno en Titulares.${advices.length ? " Cada consejo cuenta con que se aplican los anteriores." : ""}</p>
        ${advices.length ? advices.join("") : `<p class="mcal-magic-empty">Todos los turnos ya tienen ${plan.target} ${plan.target === 1 ? "persona" : "personas"}. No hay nada que ajustar.</p>`}
        ${pending}
        ${surplus}`;
}

/* ---------- aplicar ---------- */

function applySwapOrMove(item) {
    const targetKey = item.type === "swap" ? item.keyDay : item.targetKey;
    const sourceKey = item.type === "swap" ? item.keyDay : item.sourceKey;
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

function applyCover(item, worker) {
    if (Number(getTurnoReal(worker, item.keyDay)) !== TURNO.LIBRE) {
        return `${worker} ya tiene turno el ${dateLabel(item.keyDay)}.`;
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
export async function openMonthlyMagic({ month, group, monthLabel, buildModel, onApplied }) {
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

        const next = await planMonth(model, browserDeps(holidays, () => !closed && id === runId));

        if (closed || id !== runId || !next) return;

        plan = next;
        body.innerHTML = planHTML(plan, monthLabel);
    }

    async function apply(kind, onlySelected) {
        if (!plan) return;

        const section = backdrop.querySelector(`[data-magic-advice="${CSS.escape(kind)}"]`);
        const picked = type => [...(section?.querySelectorAll(`[data-magic-pick="${type}"]`) || [])]
            .filter(input => !onlySelected || input.checked)
            .map(input => Number(input.value));
        const errors = [];

        pushHistory();

        if (kind === "swap") {
            picked("swap").forEach(index => {
                const error = applySwapOrMove(plan.swaps[index]);

                if (error) errors.push(`${plan.swaps[index].name}: ${error}`);
            });
        } else if (kind.startsWith("move:")) {
            picked("move").forEach(index => {
                const error = applySwapOrMove(plan.moves[index]);

                if (error) errors.push(`${plan.moves[index].name} (${dateLabel(plan.moves[index].sourceKey)}): ${error}`);
            });
        } else if (kind === "cover") {
            picked("cover").forEach(index => {
                const item = plan.covers[index];
                const worker = section.querySelector(`[data-magic-worker="${index}"]`)?.value || item.worker;
                const error = applyCover(item, worker);

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
            void apply(button.dataset.magicApply, button.dataset.magicOnly === "selected");
        }
    });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    await recompute();
}
