/**
 * Editor del horario propio de un trabajador.
 *
 * Se abre desde su perfil. Muestra solo los tramos que su rotativa usa: un
 * diurno configura su turno diurno; el de tercer o cuarto turno, sus Largas y
 * sus Noches.
 *
 * Los horarios van por periodos: al agregar uno nuevo se indica desde cuando
 * rige, y el anterior se cierra el dia antes. Asi lo nuevo cuenta de ahi en
 * adelante y los meses ya revisados no se recalculan.
 */
import { escapeHTML } from "./htmlUtils.js";
import { getRotativa } from "./storage.js";
import {
    addWorkerSchedulePeriod,
    getWorkerSchedulePeriods,
    isoFromDate,
    removeWorkerSchedulePeriod,
    scheduleSegmentsForRotativa
} from "./workerSchedule.js";

function formatDate(iso) {
    if (!iso) return "";

    const [year, month, day] = String(iso).split("-");

    return `${day}/${month}/${year}`;
}

function vigenciaLabel(period) {
    const desde = period.from ? `Desde ${formatDate(period.from)}` : "Siempre";

    return period.to ? `${desde} al ${formatDate(period.to)}` : `${desde}`;
}

function horasLabel(period, segments) {
    if (period.free) {
        return "Horario libre: sin hora fija, cumple las horas de su jornada";
    }

    return segments
        .map(segment => {
            const actual = period[segment.key];

            if (!actual?.entry && !actual?.exit) return "";

            const viernes = actual.exitFriday
                ? ` (vie hasta ${actual.exitFriday})`
                : "";

            return `${segment.label}: ${actual.entry || "—"} a `
                + `${actual.exit || "—"}${viernes}`;
        })
        .filter(Boolean)
        .join(" · ");
}

function periodosHTML(periods, segments) {
    if (!periods.length) {
        return `<p class="ws-note">Todavía no tiene horarios propios: usa el
            horario del turno.</p>`;
    }

    return `
        <div class="ws-periods">
            ${periods.map(period => `
                <div class="ws-period ${period.to ? "" : "is-open"}">
                    <div>
                        <b>${escapeHTML(vigenciaLabel(period))}</b>
                        <small>${escapeHTML(horasLabel(period, segments))}</small>
                    </div>
                    <button class="ghost-button" type="button"
                        data-ws-remove="${escapeHTML(period.from)}"
                        aria-label="Quitar este periodo">&times;</button>
                </div>`).join("")}
        </div>`;
}

function campo(segmentKey, name, label, placeholder) {
    return `
        <label class="ws-field">
            <span>${escapeHTML(label)}</span>
            <input type="time" name="${segmentKey}.${name}"
                placeholder="${escapeHTML(placeholder)}">
        </label>`;
}

function segmentoHTML(segment) {
    return `
        <fieldset class="ws-segment">
            <legend>${escapeHTML(segment.label)}</legend>
            <div class="ws-fields">
                ${campo(segment.key, "entry", "Entrada", "08:00")}
                ${campo(segment.key, "exit", "Salida", "17:00")}
                ${segment.hasFriday
                    ? campo(segment.key, "exitFriday", "Salida los viernes", "16:00")
                    : ""}
            </div>
        </fieldset>`;
}

/**
 * Abre el editor. Resuelve true si se cambio algo.
 *
 * @param {string} profile
 * @returns {Promise<boolean>}
 */
export function openWorkerScheduleDialog(profile) {
    return new Promise(resolve => {
        const rotativa = getRotativa(profile).type;
        const segments = scheduleSegmentsForRotativa(rotativa);
        // El horario libre solo tiene sentido en el diurno: es una jornada de
        // horas (9 de lunes a jueves, 8 los viernes) y no un turno con su hora
        // de entrada. Una Larga o una Noche cubren una franja del dia que si
        // tiene que estar cubierta a su hora.
        const libre = rotativa === "diurno";

        if (!segments.length) {
            resolve(false);
            return;
        }

        const backdrop = document.createElement("div");
        let changed = false;

        backdrop.className = "turn-change-dialog-backdrop";

        const render = () => {
            const periods = getWorkerSchedulePeriods(profile);

            backdrop.innerHTML = `
                <section class="turn-change-dialog ws-dialog" role="dialog"
                    aria-modal="true" aria-label="Horario propio">
                    <strong>Horarios de entrada y salida</strong>
                    <p class="ws-intro">
                        ${escapeHTML(profile)} — sus atrasos e incidencias se
                        medirán con estos horarios en vez del general.
                    </p>

                    ${periodosHTML(periods, segments)}

                    <form data-ws-form>
                        <fieldset class="ws-segment ws-validity">
                            <legend>Vigencia del nuevo horario</legend>
                            <div class="ws-fields">
                                <label class="ws-field">
                                    <span>Rige desde</span>
                                    <input type="date" name="from" required
                                        value="${escapeHTML(isoFromDate(new Date()))}">
                                </label>
                                <label class="ws-field">
                                    <span>Hasta (opcional)</span>
                                    <input type="date" name="to">
                                </label>
                            </div>
                            <p class="ws-note">
                                Sin fecha de término rige indefinidamente. Lo
                                anterior se cierra el día antes: no se
                                recalcula hacia atrás.
                            </p>
                        </fieldset>

                        ${libre ? `
                            <fieldset class="ws-segment ws-free">
                                <legend>Horario libre</legend>
                                <label class="ws-free-toggle">
                                    <input type="checkbox" name="free" data-ws-free>
                                    <span>Sin hora fija de entrada ni de salida</span>
                                </label>
                                <p class="ws-note">
                                    No se le miden atrasos: lo que se le exige es
                                    cumplir las horas de su jornada — 9 horas de
                                    lunes a jueves y 8 los viernes. Si el marcaje
                                    muestra que se quedó de más, el reporte lo
                                    avisa para decidir si corresponden horas
                                    extras.
                                </p>
                            </fieldset>
                        ` : ""}

                        ${segments.map(segmentoHTML).join("")}

                        <p class="ws-note">
                            Deja un campo vacío para que ese tramo use el
                            horario del turno.
                        </p>
                        <div class="turn-change-dialog__actions">
                            <button class="primary-button" type="submit">
                                Agregar horario
                            </button>
                            <button class="ghost-button" type="button" data-ws-close>
                                Cerrar
                            </button>
                        </div>
                    </form>
                </section>`;

            backdrop.querySelector("[data-ws-form]").addEventListener(
                "submit",
                event => {
                    event.preventDefault();

                    const period = {};
                    const data = new FormData(event.currentTarget);
                    // Una casilla marcada llega como "on", no como true.
                    const free = data.get("free") !== null;

                    data.forEach((value, name) => {
                        if (name === "free") return;

                        if (!name.includes(".")) {
                            period[name] = String(value || "");
                            return;
                        }

                        // Con horario libre las horas no se guardan aunque
                        // queden escritas en el formulario: un periodo no puede
                        // ser libre y exigir una hora de entrada a la vez.
                        if (free) return;

                        const [segmentKey, field] = name.split(".");

                        period[segmentKey] = period[segmentKey] || {};
                        period[segmentKey][field] = String(value || "");
                    });

                    if (free) period.free = true;

                    if (addWorkerSchedulePeriod(profile, period)) {
                        changed = true;
                        render();
                    }
                }
            );

            backdrop.querySelectorAll("[data-ws-remove]").forEach(button => {
                button.addEventListener("click", () => {
                    removeWorkerSchedulePeriod(
                        profile,
                        button.dataset.wsRemove
                    );
                    changed = true;
                    render();
                });
            });

            backdrop.querySelector("[data-ws-close]")
                .addEventListener("click", () => close());
        };

        const close = () => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(changed);
        };
        const onKeydown = (event) => {
            if (event.key === "Escape") close();
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) close();
        });

        render();
        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);
    });
}

/**
 * Resumen para el perfil: el horario que rige hoy, y si hay mas periodos.
 */
export function workerScheduleSummary(profile) {
    const periods = getWorkerSchedulePeriods(profile);

    if (!periods.length) return "";

    const segments = scheduleSegmentsForRotativa(getRotativa(profile).type);
    const hoy = isoFromDate(new Date());
    const vigente = periods.find(period =>
        (!period.from || period.from <= hoy) &&
        (!period.to || hoy <= period.to)
    );

    if (!vigente) {
        return `${periods.length} horario(s) configurado(s), ninguno vigente hoy`;
    }

    const otros = periods.length - 1;

    return horasLabel(vigente, segments)
        + (otros > 0 ? ` · ${otros} período(s) más` : "");
}
