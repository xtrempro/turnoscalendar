import { escapeHTML } from "./htmlUtils.js";
import { parseISODate as parseInputDate } from "./dateUtils.js";
import {
    findTopProfileSearchMatch,
    getCalendarProfileDetail,
    getCalendarProfileSearchOptionValues,
    getCalendarProfileSearchValue
} from "./profileSearchUtils.js";
import {
    activeMonthlySwapCount,
    cambiosDelMes,
    cambioEstaAnulado,
    canSwapProfiles,
    deshacerCambioTurno,
    getEligibleSwapReceivers,
    getSwapDateBlockReason,
    getSwapTurnState,
    isSwapExchangeableTurn,
    registrarCambio,
    swapCodeLabel
} from "./swaps.js";
import {
    getCurrentProfile,
    getProfiles,
    getRotativa,
    getSwaps,
    getTurnChangeConfig,
    getWorkerRequests,
    isProfileActive,
    setCurrentProfile
} from "./storage.js";
import { refreshAll } from "./refresh.js";
import { pushHistory } from "./history.js";
import { showConfirm } from "./dialogs.js";
import { getRotativaLabel } from "./rotationUtils.js";
import { getTurnoColorConfig } from "./turnoColors.js";
import {
    downloadSwapAnexo4,
    downloadSwapAnexo4Batch,
    findSwapMemo,
    getMemoDocuments,
    openMemoDocument
} from "./memos.js";
import { openSwapScanDialog } from "./swapScan.js";
import { isPendingSwapRequest } from "./pendingSwapRequests.js";
import {
    acceptWorkerRequestById,
    rejectWorkerRequestById
} from "./workerRequests.js";

let fechaCambioSeleccionada = "";
let fechaDevolucionSeleccionada = "";
let swapDate = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
);
let swapPickerYear = swapDate.getFullYear();
let swapMonthPicker = null;
let swapMonthPickerEventsBound = false;

const SWAP_MONTH_NAMES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
];

function formatFecha(fechaStr){
    const parts = fechaStr.split("-");
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function getBaseState(nombre, year, month, day = 1){
    const key = `${year}-${month}-${day}`;
    const turno = getSwapTurnState(nombre, key);

    return turno ? turno : null;
}

function getPerfil(nombre) {
    return getProfiles().find(
        profile => profile.name === nombre
    ) || null;
}

function noPuedeIntercambiar(nombre) {
    if (!isProfileActive(nombre)) return true;

    return false;
}

function esTurnoIntercambiable(turno) {
    return isSwapExchangeableTurn(turno);
}

function codigoTurno(valor){
    const turno = Number(valor) || 0;

    if (turno === 2) return "N";
    if (turno === 1) return "L";

    return "";
}

function getTrabajadoresDisponibles(nombreFrom, keyDay = "") {
    if (!getPerfil(nombreFrom)) return [];

    return getEligibleSwapReceivers(nombreFrom, keyDay);
}

function getSwapYear(){
    return swapDate.getFullYear();
}

function getSwapMonth(){
    return swapDate.getMonth();
}

function cambiarMesSwap(offset){
    goToSwapMonth(
        getSwapYear(),
        getSwapMonth() + offset
    );
}

function goToSwapMonth(year, month){
    swapDate = new Date(
        Number(year),
        Number(month),
        1
    );

    fechaCambioSeleccionada = "";
    fechaDevolucionSeleccionada = "";

    renderSwapPanel();
}

function closeSwapMonthPicker() {
    if (!swapMonthPicker) return;

    swapMonthPicker.classList.add("hidden");
    document
        .getElementById("swapMonthLabel")
        ?.setAttribute("aria-expanded", "false");
}

function positionSwapMonthPicker() {
    const trigger = document.getElementById("swapMonthLabel");

    if (
        !trigger ||
        !swapMonthPicker ||
        swapMonthPicker.classList.contains("hidden")
    ) {
        return;
    }

    const gap = 8;
    const edge = 12;
    const triggerRect = trigger.getBoundingClientRect();
    const pickerRect = swapMonthPicker.getBoundingClientRect();
    const left = Math.min(
        Math.max(
            edge,
            triggerRect.left +
                (triggerRect.width - pickerRect.width) / 2
        ),
        window.innerWidth - pickerRect.width - edge
    );
    const preferredTop = triggerRect.bottom + gap;
    const top =
        preferredTop + pickerRect.height <= window.innerHeight - edge
            ? preferredTop
            : Math.max(edge, triggerRect.top - pickerRect.height - gap);

    swapMonthPicker.style.left = `${Math.round(left)}px`;
    swapMonthPicker.style.top = `${Math.round(top)}px`;
}

function renderSwapMonthPicker() {
    if (!swapMonthPicker) return;

    const activeYear = getSwapYear();
    const activeMonth = getSwapMonth();

    swapMonthPicker.innerHTML = `
        <div class="calendar-month-picker__year">
            <button class="calendar-month-picker__year-button" type="button" data-swap-year-step="-1" aria-label="A&#241;o anterior">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <strong>${swapPickerYear}</strong>
            <button class="calendar-month-picker__year-button" type="button" data-swap-year-step="1" aria-label="A&#241;o siguiente">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
        <div class="calendar-month-picker__months">
            ${SWAP_MONTH_NAMES.map((name, month) => `
                <button
                    class="calendar-month-picker__month${swapPickerYear === activeYear && month === activeMonth ? " is-active" : ""}"
                    type="button"
                    data-swap-month="${month}"
                >
                    ${name}
                </button>
            `).join("")}
        </div>
    `;

    swapMonthPicker
        .querySelectorAll("[data-swap-year-step]")
        .forEach(button => {
            button.onclick = event => {
                event.stopPropagation();
                swapPickerYear += Number(button.dataset.swapYearStep);
                renderSwapMonthPicker();
                positionSwapMonthPicker();
            };
        });

    swapMonthPicker
        .querySelectorAll("[data-swap-month]")
        .forEach(button => {
            button.onclick = event => {
                event.stopPropagation();
                closeSwapMonthPicker();
                goToSwapMonth(
                    swapPickerYear,
                    Number(button.dataset.swapMonth)
                );
            };
        });
}

function setupSwapMonthPicker(trigger) {
    if (!trigger || trigger.dataset.swapMonthPickerBound === "true") {
        return;
    }

    trigger.dataset.swapMonthPickerBound = "true";

    if (!swapMonthPicker) {
        swapMonthPicker = document.createElement("div");
        swapMonthPicker.className = "calendar-month-picker hidden";
        swapMonthPicker.setAttribute("role", "dialog");
        swapMonthPicker.setAttribute(
            "aria-label",
            "Seleccionar mes y a\u00f1o"
        );
        document.body.appendChild(swapMonthPicker);
    }

    trigger.addEventListener("click", event => {
        event.stopPropagation();

        if (!swapMonthPicker.classList.contains("hidden")) {
            closeSwapMonthPicker();
            return;
        }

        swapPickerYear = getSwapYear();
        renderSwapMonthPicker();
        swapMonthPicker.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
        positionSwapMonthPicker();
    });

    if (swapMonthPickerEventsBound) return;

    swapMonthPickerEventsBound = true;
    document.addEventListener("click", closeSwapMonthPicker);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeSwapMonthPicker();
        }
    });
    window.addEventListener("resize", positionSwapMonthPicker);
    window.addEventListener("scroll", positionSwapMonthPicker, true);
}

function toISO(date){
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function textoTurno(turno){
    if (turno === 1) return "L";
    if (turno === 2) return "N";
    if (turno === 3) return "24h";
    if (turno === 4) return "D";
    if (turno === 5) return "D+N";

    return "";
}

function keyFromInputDate(value) {
    const date = parseInputDate(value);

    if (Number.isNaN(date.getTime())) return "";

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getSwapSearchProfiles() {
    return getProfiles()
        .filter(profile => isProfileActive(profile))
        .sort((a, b) =>
            String(a.name || "").localeCompare(
                String(b.name || ""),
                "es",
                { sensitivity: "base" }
            )
        );
}

function renderSwapFromOptions() {
    const used = new Set();

    return getSwapSearchProfiles()
        .flatMap(profile => {
            const searchValue = getCalendarProfileSearchValue(profile);

            return getCalendarProfileSearchOptionValues(profile)
                .map(value => {
                    if (!value || used.has(value)) return "";

                    used.add(value);

                    const label = value !== searchValue
                        ? ` label="${escapeHTML(searchValue)}"`
                        : "";

                    return `<option value="${escapeHTML(value)}"${label}></option>`;
                });
        })
        .join("");
}

function syncSwapFromSearch() {
    const input = document.getElementById("swapFromSearch");
    if (!input) return;

    input.value = getCurrentProfile() || "";
}

function handleSwapFromSearch() {
    const input = document.getElementById("swapFromSearch");
    if (!input) return;

    const query = input.value.trim();

    if (!query) {
        syncSwapFromSearch();
        return;
    }

    const match = findTopProfileSearchMatch(
        query,
        getSwapSearchProfiles()
    );

    if (!match) {
        alert("No se encontro un colaborador con ese nombre.");
        syncSwapFromSearch();
        input.focus();
        input.select();
        return;
    }

    input.value = match.name;
    input.blur();

    if (match.name === getCurrentProfile()) return;

    fechaCambioSeleccionada = "";
    fechaDevolucionSeleccionada = "";

    if (typeof window.selectProfileByName === "function") {
        window.selectProfileByName(match.name);
        return;
    }

    setCurrentProfile(match.name);
    renderSwapPanel();
    refreshAll();
}

function bindSwapFromSearch() {
    const form = document.getElementById("swapFromSearchForm");
    const input = document.getElementById("swapFromSearch");

    if (!form || !input) return;

    form.onsubmit = event => {
        event.preventDefault();
        handleSwapFromSearch();
    };

    input.onchange = handleSwapFromSearch;
    // Al enfocar se limpia para escribir directo; si se abandona sin elegir,
    // se restaura el trabajador actual.
    input.onfocus = () => { input.value = ""; };
    input.onblur = () => {
        if (!input.value.trim()) syncSwapFromSearch();
    };
}

/**
 * Los tipos de turno que estos dos pueden intercambiar ENTRE SI este mes, o
 * null cuando el ajuste permite cruzarlos y no hay nada que restringir.
 *
 * Con "Permitir Cambios de Turno entre diferentes tipos" apagado solo se
 * devuelve el MISMO tipo, pero eso se notaba recien al hacer clic: mientras no
 * hay fecha elegida `requiredTurn` vale 0, la guarda exige un turno
 * intercambiable y por eso no se evaluaba. Los dos calendarios se pintaban
 * enteros -uno ofreciendo Noches y el otro Largas- y al elegir una fecha el
 * calendario de enfrente quedaba vacio sin explicar por que.
 *
 * Aca se cruzan los tipos que cada uno puede ofrecer de verdad: si no coinciden
 * en ninguno, se ve desde el principio y con su motivo.
 */
function tiposIntercambiablesComunes(from, to) {
    if (getTurnChangeConfig().allowDifferentTurnTypes) return null;

    const tiposDe = (giver, receiver) => {
        const tipos = new Set();
        const y = getSwapYear();
        const m = getSwapMonth();
        const dias = new Date(y, m + 1, 0).getDate();

        for (let d = 1; d <= dias; d++) {
            const key = `${y}-${m}-${d}`;
            const turno = Number(getSwapTurnState(giver, key));

            if (!esTurnoIntercambiable(turno)) continue;
            if (getSwapDateBlockReason({ giver, receiver, keyDay: key })) continue;

            tipos.add(turno);
        }

        return tipos;
    };
    const entrega = tiposDe(from, to);
    const devuelve = tiposDe(to, from);

    return new Set(
        [...entrega].filter(turno => devuelve.has(turno))
    );
}

function renderMiniCalendarios(){
    const from = getCurrentProfile();
    const to = document.getElementById("swapTo")?.value;

    if (!from || !to) return;

    let selectedCambioTurn = fechaCambioSeleccionada
        ? getSwapTurnState(
            from,
            keyFromInputDate(fechaCambioSeleccionada)
        )
        : 0;
    let selectedDevolucionTurn = fechaDevolucionSeleccionada
        ? getSwapTurnState(
            to,
            keyFromInputDate(fechaDevolucionSeleccionada)
        )
        : 0;

    if (
        fechaCambioSeleccionada &&
        getSwapDateBlockReason({
            giver: from,
            receiver: to,
            keyDay: keyFromInputDate(fechaCambioSeleccionada),
            requiredTurn: selectedDevolucionTurn
        })
    ) {
        fechaCambioSeleccionada = "";
        selectedCambioTurn = 0;
    }

    if (
        fechaDevolucionSeleccionada &&
        getSwapDateBlockReason({
            giver: to,
            receiver: from,
            keyDay: keyFromInputDate(fechaDevolucionSeleccionada),
            requiredTurn: selectedCambioTurn
        })
    ) {
        fechaDevolucionSeleccionada = "";
        selectedDevolucionTurn = 0;
    }

    const tiposComunes = tiposIntercambiablesComunes(from, to);

    renderMiniCalendar(
        "swapCalendar1",
        from,
        true,
        from,
        to,
        selectedDevolucionTurn,
        tiposComunes
    );

    renderMiniCalendar(
        "swapCalendar2",
        to,
        false,
        to,
        from,
        selectedCambioTurn,
        tiposComunes
    );

    renderSwapSummary();
}

function renderMiniCalendar(
    id,
    trabajador,
    esCambio,
    giver,
    receiver,
    requiredTurn = 0,
    // Tipos de turno que los dos pueden intercambiar entre si, o null si el
    // ajuste permite cruzarlos (ver tiposIntercambiablesComunes).
    tiposComunes = null
){
    const div = document.getElementById(id);
    if (!div) return;

    let ofrecidos = 0;

    const y = getSwapYear();
    const m = getSwapMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const totalCells = 42;

    let html = `
        <div class="swx-weekdays" aria-hidden="true">
            <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
        </div>
        <div class="swx-days">
    `;

    for (let i = 0; i < first; i++) {
        html += `<span class="swx-day swx-day--spacer" aria-hidden="true"></span>`;
    }

    for (let d = 1; d <= days; d++) {
        const fecha = new Date(y, m, d);

        const key = `${y}-${m}-${d}`;
        const turnoBase = getBaseState(
            trabajador,
            y,
            m,
            d
        );
        // El tipo que ese dia se entregaria. No es el turno base que se dibuja:
        // un Diurno con extension horaria entrega una Larga.
        const turnoDelDia = Number(getSwapTurnState(trabajador, key));
        const fueraDeTipo = Boolean(
            tiposComunes &&
            esTurnoIntercambiable(turnoDelDia) &&
            !tiposComunes.has(turnoDelDia)
        );
        const motivoBloqueo = fueraDeTipo
            ? "El ajuste de la unidad solo permite devolver el mismo tipo de "
                + "turno, y no hay dias compatibles con el otro trabajador."
            : getSwapDateBlockReason({
                giver,
                receiver,
                keyDay: key,
                requiredTurn
            });
        const valido = !motivoBloqueo;

        if (valido) ofrecidos++;

        // Larga y Noche llevan el color configurado del turno, igual que en el
        // calendario; el resto (Diurno, 24h, libre) va en gris.
        const colorTurno = turnoBase === 1 || turnoBase === 2
            ? turnColor(turnoBase)
            : "";
        const seleccionada = esCambio
            ? fechaCambioSeleccionada === toISO(fecha)
            : fechaDevolucionSeleccionada === toISO(fecha);
        const clase = [
            colorTurno ? "is-turn" : "is-plain",
            seleccionada ? "is-picked" : valido ? "is-on" : "is-off"
        ].join(" ");
        const estado = seleccionada
            ? "elegido"
            : valido ? "disponible" : "no disponible";

        html += `
            <button
                type="button"
                class="swx-day ${clase}"
                style="${colorTurno ? `--swx-turn: ${escapeHTML(colorTurno)}` : ""}"
                data-fecha="${toISO(fecha)}"
                data-tipo="${esCambio ? 1 : 2}"
                title="${escapeHTML(motivoBloqueo || `${giver} entrega ${textoTurno(turnoBase)}`)}"
                aria-label="${d}, ${escapeHTML(textoTurno(turnoBase) || "libre")}, ${estado}"
                ${valido || seleccionada ? "" : 'aria-disabled="true"'}
            >
                <span>${d}</span>
                <small>${textoTurno(turnoBase)}</small>
            </button>
        `;
    }

    for (let i = first + days; i < totalCells; i++) {
        html += `<span class="swx-day swx-day--spacer" aria-hidden="true"></span>`;
    }

    html += `</div>`;

    // Un calendario sin ningun dia disponible tiene que decir POR QUE. Antes
    // quedaba en blanco y el supervisor no tenia como saber si era un problema
    // de los turnos, de las fechas o de un ajuste de la unidad.
    div.innerHTML = ofrecidos
        ? html
        : `
            <div class="empty-state empty-state--compact">
                ${escapeHTML(
                    tiposComunes && !tiposComunes.size
                        ? "El ajuste de la unidad solo permite cambiar Larga por"
                            + " Larga y Noche por Noche, y estos dos"
                            + " trabajadores no tienen días compatibles en este"
                            + " mes."
                        : "No hay días disponibles para este trabajador en este"
                            + " mes."
                )}
            </div>
        `;

    div.querySelectorAll(".swx-day.is-on, .swx-day.is-picked")
        .forEach(item => {
            item.onclick = () => {
                const fecha = item.dataset.fecha;

                if (item.dataset.tipo === "1") {
                    const previousTo =
                        document.getElementById("swapTo")?.value || "";

                    fechaCambioSeleccionada = fecha;
                    fechaDevolucionSeleccionada = "";
                    actualizarSwapTo(previousTo);
                    // Los compatibles dependen de la fecha que se entrega.
                    renderSwapPanel();
                    return;
                } else {
                    fechaDevolucionSeleccionada = fecha;
                }

                renderMiniCalendarios();
            };
        });
}

function actualizarSwapTo(preferredTo = ""){
    const from = getCurrentProfile();
    const toSelect = document.getElementById("swapTo");

    if (!from || !toSelect) return;

    const selectedChangeKey = fechaCambioSeleccionada
        ? keyFromInputDate(fechaCambioSeleccionada)
        : "";
    const filtrados = getTrabajadoresDisponibles(
        from,
        selectedChangeKey
    );

    const selectedTo =
        filtrados.some(profile => profile.name === preferredTo)
            ? preferredTo
            : filtrados[0]?.name || "";

    toSelect.innerHTML = filtrados
        .map(profile => `
            <option
                value="${escapeHTML(profile.name)}"
                ${profile.name === selectedTo ? "selected" : ""}
            >
                ${escapeHTML(profile.name)}
            </option>
        `)
        .join("");

    if (!filtrados.length) {
        toSelect.disabled = true;

        const saveButton =
            document.getElementById("saveSwapBtn");

        if (saveButton) {
            saveButton.disabled = true;
        }

        document.getElementById("swapCalendar1").innerHTML = `
            <div class="empty-state empty-state--compact">
                No hay trabajadores habilitados para recibir el turno seleccionado.
            </div>
        `;

        document.getElementById("swapCalendar2").innerHTML = `
            <div class="empty-state empty-state--compact">
                Ajusta la selección para continuar.
            </div>
        `;
        return "";
    }

    toSelect.disabled = false;

    const saveButton =
        document.getElementById("saveSwapBtn");

    if (saveButton) {
        saveButton.disabled = false;
    }

    return selectedTo;
}

async function guardarCambioTurno(){
    const from = getCurrentProfile();
    const to = document.getElementById("swapTo")?.value;
    const fecha = fechaCambioSeleccionada;
    const devolucion = fechaDevolucionSeleccionada;

    if (!from || !to || !fecha || !devolucion) {
        alert("Completa todos los campos.");
        return;
    }

    if (from === to) {
        alert("El cambio debe ser entre trabajadores distintos.");
        return;
    }

    const f1 = parseInputDate(fecha);
    const f2 = parseInputDate(devolucion);

    if (
        f1.getFullYear() !== f2.getFullYear() ||
        f1.getMonth() !== f2.getMonth()
    ) {
        alert("Ambas fechas deben pertenecer al mismo mes.");
        return;
    }

    if (
        f1.getFullYear() !== getSwapYear() ||
        f1.getMonth() !== getSwapMonth()
    ) {
        alert("Las fechas deben pertenecer al mes visualizado.");
        return;
    }

    const perfilFrom = getPerfil(from);
    const perfilTo = getPerfil(to);

    if (
        !perfilFrom ||
        !perfilTo ||
        !canSwapProfiles(from, to)
    ) {
        alert("Los trabajadores no son compatibles para cambio de turno. Revisa estamento, profesi\u00f3n y que no tengan la misma rotativa base. Un Diurno solo puede cambiar con otro Diurno (intercambian su d\u00eda de extensi\u00f3n horaria).");
        return;
    }

    if (
        noPuedeIntercambiar(from) ||
        noPuedeIntercambiar(to)
    ) {
        alert("No se puede registrar el cambio con perfiles desactivados.");
        return;
    }

    const keyCambio = `${f1.getFullYear()}-${f1.getMonth()}-${f1.getDate()}`;
    const keyDevolucion = `${f2.getFullYear()}-${f2.getMonth()}-${f2.getDate()}`;
    const motivoCambio = getSwapDateBlockReason({
        giver: from,
        receiver: to,
        keyDay: keyCambio,
        requiredTurn: getSwapTurnState(to, keyDevolucion)
    });
    const motivoDevolucion = getSwapDateBlockReason({
        giver: to,
        receiver: from,
        keyDay: keyDevolucion,
        requiredTurn: getSwapTurnState(from, keyCambio)
    });

    if (motivoCambio) {
        alert(`No se puede usar la fecha de cambio: ${motivoCambio}`);
        return;
    }

    if (motivoDevolucion) {
        alert(`No se puede usar la fecha de devoluci\u00f3n: ${motivoDevolucion}`);
        return;
    }

    const turnoFrom = getBaseState(
        from,
        f1.getFullYear(),
        f1.getMonth(),
        f1.getDate()
    );

    const turnoTo = getBaseState(
        to,
        f2.getFullYear(),
        f2.getMonth(),
        f2.getDate()
    );

    if (!esTurnoIntercambiable(turnoFrom)) {
        alert(`${from} solo puede entregar turnos base Larga o Noche.`);
        return;
    }

    if (!esTurnoIntercambiable(turnoTo)) {
        alert(`${to} solo puede devolver turnos base Larga o Noche.`);
        return;
    }

    pushHistory();

    const swap = registrarCambio({
        from,
        to,
        fecha,
        devolucion,
        turno: codigoTurno(turnoFrom),
        turnoDevuelto: codigoTurno(turnoTo),
        year: f1.getFullYear(),
        month: f1.getMonth()
    });

    fechaCambioSeleccionada = "";
    fechaDevolucionSeleccionada = "";
    // Recien registrado, lo que hay que atender es su firma.
    swapListFilter = "pending";

    refreshAll();

    // El memorandum se crea al registrar (evento proturnos:swapRegistered);
    // el Word sale de inmediato para imprimirlo y firmarlo.
    if (swap?.id) await downloadSwapAnexo4(swap.id);
}

/* =========================================================
   Panel de Cambios de turno (mockup aprobado 2026-10-01)

   Izquierda: registrar un cambio en tres pasos -quien entrega, quien recibe y
   las fechas- con el resumen en palabras y las reglas que se cumplen. Derecha:
   las solicitudes de cambio que llegan desde la app (tambien siguen en el menu
   Solicitudes) y los cambios del mes con su Anexo 4: descargarlo para firmar y
   escanear el firmado, que queda en el memorandum del cambio.
========================================================= */

const ICONS = {
    prev: '<path d="m15 18-6-6 6-6"></path>',
    next: '<path d="m9 18 6-6-6-6"></path>',
    download: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3"></path><path d="M16 4h3a1 1 0 0 1 1 1v3"></path><path d="M20 16v3a1 1 0 0 1-1 1h-3"></path><path d="M8 20H5a1 1 0 0 1-1-1v-3"></path><path d="M4 12h16"></path>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path><path d="M14 3v5h5"></path><path d="m9 14 2 2 4-4"></path>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"></rect><path d="M11 18h2"></path>'
};

function icon(name) {
    return `<svg class="swx-i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// Filtro y busqueda de la lista del mes. `null` = todavia no se eligio: se
// abre en "Por firmar" si hay alguno, que es lo que hay que atender.
let swapListFilter = null;
let swapListQuery = "";

const OVERDUE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    const surnameIndex = parts.length >= 3 ? parts.length - 2 : parts.length - 1;

    return `${parts[0]?.[0] || ""}${parts[surnameIndex]?.[0] || ""}`.toUpperCase();
}

function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
}

function shortName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);

    if (parts.length < 2) return parts[0] || "";

    const surname = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];

    return `${parts[0][0]}. ${surname}`;
}

function isoToDate(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);

    return new Date(y, (m || 1) - 1, d || 1);
}

function shortDayLabel(iso) {
    const date = isoToDate(iso);

    if (Number.isNaN(date.getTime())) return iso || "";

    return date
        .toLocaleDateString("es-CL", { weekday: "short", day: "numeric" })
        .replace(".", "");
}

function profileSubtitle(name) {
    const profile = getPerfil(name);

    if (!profile) return "";

    const rotativa = getRotativa(name)?.type;

    return [
        getCalendarProfileDetail(profile),
        rotativa ? `Rotativa ${getRotativaLabel(rotativa)}` : ""
    ].filter(Boolean).join(" · ");
}

function monthlyLimit() {
    const config = getTurnChangeConfig();

    return config.limitMonthlySwaps
        ? Number(config.monthlySwapLimit) || 0
        : 0;
}

function swapCountText(name) {
    const limit = monthlyLimit();

    if (!limit) return "";

    return `${activeMonthlySwapCount(name, getSwapYear(), getSwapMonth())}/${limit}`;
}

function turnColor(turno) {
    return getTurnoColorConfig()?.base?.[Number(turno)] || "";
}

/* ---------- Estado de firma de cada cambio ---------- */

function swapCreatedAt(swap, memo) {
    const fromMemo = Date.parse(memo?.createdAt || "");

    if (Number.isFinite(fromMemo)) return fromMemo;

    // El id de un cambio es el Date.now() del momento en que se registro.
    const fromId = Number(swap?.id);

    return Number.isFinite(fromId) && fromId > 1e12 ? fromId : Date.now();
}

function swapDocState(swap) {
    if (cambioEstaAnulado(swap)) return { key: "canceled" };

    const memo = findSwapMemo(swap.id);
    const documents = memo ? getMemoDocuments(memo.id) : [];

    if (documents.length) {
        return { key: "signed", memo, document: documents[documents.length - 1] };
    }

    return {
        key: "pending",
        memo,
        days: Math.max(0, Math.floor((Date.now() - swapCreatedAt(swap, memo)) / DAY_MS))
    };
}

function monthSwaps() {
    return cambiosDelMes(getSwapYear(), getSwapMonth())
        .slice()
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
        .map(swap => ({ swap, state: swapDocState(swap) }));
}

function pendingSignatureSwaps(items = monthSwaps()) {
    return items.filter(item => item.state.key === "pending");
}

/* ---------- Solicitudes desde la app ---------- */

function requestField(request, ...keys) {
    for (const key of keys) {
        if (request?.[key]) return String(request[key]);
    }

    return "";
}

function pendingAppSwapRequests() {
    return getWorkerRequests().filter(isPendingSwapRequest);
}

function requestTurnLabel(profile, iso) {
    const date = isoToDate(iso);

    if (!profile || Number.isNaN(date.getTime())) return "";

    const turno = getSwapTurnState(
        profile,
        `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    );

    return swapCodeLabel(codigoTurno(turno)) || "";
}

function requestCardHTML(request) {
    const from = requestField(request, "from", "profile");
    const to = requestField(request, "to", "targetProfile", "counterpart", "receiver");
    const fecha = requestField(request, "fecha", "changeDate", "date");
    const devolucion = requestField(request, "devolucion", "returnDate", "endDate");
    const entrega = [requestTurnLabel(from, fecha), shortDayLabel(fecha)].filter(Boolean).join(" ");
    const devuelve = [requestTurnLabel(to, devolucion), shortDayLabel(devolucion)].filter(Boolean).join(" ");

    return `
        <div class="swx-request">
            <div class="swx-request__text">
                <strong>${escapeHTML(shortName(from))} → ${escapeHTML(shortName(to))}</strong>
                <span>Entrega ${escapeHTML(entrega)} · devuelve ${escapeHTML(devuelve)}</span>
                <em>El colega ya aceptó</em>
            </div>
            <div class="swx-request__actions">
                <button class="swx-btn swx-btn--ghost swx-btn--danger-text" type="button" data-swx-act="reject-request" data-request-id="${escapeHTML(request.id)}">Rechazar</button>
                <button class="swx-btn swx-btn--ghost" type="button" data-swx-act="request-calendar" data-profile="${escapeHTML(from)}" data-date="${escapeHTML(fecha)}">Ver en calendario</button>
                <button class="swx-btn swx-btn--ok" type="button" data-swx-act="accept-request" data-request-id="${escapeHTML(request.id)}">Aprobar</button>
            </div>
        </div>
    `;
}

function requestsHTML() {
    const requests = pendingAppSwapRequests();

    if (!requests.length) return "";

    return `
        <section class="swx-card swx-requests">
            <div class="swx-requests__head">
                <span class="swx-requests__icon">${icon("phone")}</span>
                <h2>Solicitudes desde la app · ${requests.length}</h2>
            </div>
            ${requests.map(requestCardHTML).join("")}
        </section>
    `;
}

/* ---------- Lista del mes ---------- */

function swapBadge(state) {
    if (state.key === "canceled") return '<span class="swx-badge swx-badge--muted">Anulado</span>';
    if (state.key === "signed") return '<span class="swx-badge swx-badge--ok">Firmado</span>';

    return state.days > OVERDUE_DAYS
        ? `<span class="swx-badge swx-badge--late">Por firmar · ${state.days} días</span>`
        : '<span class="swx-badge swx-badge--warn">Por firmar</span>';
}

function attachedLabel(document) {
    const date = Date.parse(document?.attachedAt || document?.addedAt || "");
    const when = Number.isFinite(date)
        ? new Date(date).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })
        : "";

    return [document?.name || "Anexo 4 firmado", when].filter(Boolean).join(" · ");
}

function swapItemHTML({ swap, state }) {
    const id = escapeHTML(String(swap.id));

    return `
        <article class="swx-item is-${state.key}">
            <div class="swx-item__top">
                <span class="swx-pair" aria-hidden="true">
                    <span class="swx-av">${escapeHTML(initials(swap.from))}</span>
                    <span class="swx-av swx-av--alt">${escapeHTML(initials(swap.to))}</span>
                </span>
                <span class="swx-item__text">
                    <strong>${escapeHTML(shortName(swap.from))} → ${escapeHTML(shortName(swap.to))}</strong>
                    <span>${escapeHTML(swap.turno || "")} ${escapeHTML(shortDayLabel(swap.fecha))} ⇄ ${escapeHTML(swap.turnoDevuelto || "")} ${escapeHTML(shortDayLabel(swap.devolucion))}</span>
                </span>
                ${swapBadge(state)}
            </div>
            ${state.key === "pending" ? `
                <div class="swx-item__actions">
                    <button class="swx-btn swx-btn--ghost" type="button" data-swx-act="anexo" data-swap-id="${id}">${icon("download")}Anexo 4 (Word)</button>
                    <button class="swx-btn swx-btn--warn" type="button" data-swx-act="scan" data-swap-id="${id}">${icon("scan")}Escanear firmado</button>
                </div>
            ` : ""}
            ${state.key === "signed" ? `
                <div class="swx-item__doc">
                    ${icon("doc")}
                    <span>${escapeHTML(attachedLabel(state.document))}</span>
                    <button class="swx-link" type="button" data-swx-act="open-doc" data-memo-id="${escapeHTML(state.memo.id)}" data-doc-id="${escapeHTML(state.document.id)}">Ver</button>
                </div>
            ` : ""}
            <div class="swx-item__links">
                <button class="swx-link" type="button" data-swx-act="calendar" data-swap-id="${id}">Ver en calendario</button>
                ${state.key !== "canceled" ? `<button class="swx-link swx-link--danger" type="button" data-swx-act="cancel" data-swap-id="${id}">Anular cambio</button>` : ""}
            </div>
        </article>
    `;
}

function swapListHTML() {
    const items = monthSwaps();
    const counts = {
        all: items.length,
        pending: items.filter(item => item.state.key === "pending").length,
        signed: items.filter(item => item.state.key === "signed").length,
        canceled: items.filter(item => item.state.key === "canceled").length
    };
    const filter = swapListFilter || (counts.pending ? "pending" : "all");
    const query = swapListQuery
        .toLocaleLowerCase("es")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
    const visible = items.filter(item => {
        if (filter !== "all" && item.state.key !== filter) return false;
        if (!query) return true;

        return `${item.swap.from} ${item.swap.to}`
            .toLocaleLowerCase("es")
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .includes(query);
    });
    const tabs = [
        ["all", "Todos"],
        ["pending", "Por firmar"],
        ["signed", "Firmados"],
        ["canceled", "Anulados"]
    ];
    const monthName = SWAP_MONTH_NAMES[getSwapMonth()].toLocaleLowerCase("es");

    return `
        <section class="swx-card swx-list">
            <div class="swx-list__head">
                <h2>Cambios de ${escapeHTML(monthName)}</h2>
                <label class="swx-search">
                    ${icon("search")}
                    <input type="search" placeholder="Buscar trabajador" aria-label="Buscar trabajador" value="${escapeHTML(swapListQuery)}" data-swx-search>
                </label>
            </div>
            <div class="swx-tabs" role="tablist">
                ${tabs.map(([key, label]) => `
                    <button type="button" role="tab" aria-selected="${filter === key}" class="${filter === key ? `is-active is-${key}` : ""}" data-swx-filter="${key}">${label} ${counts[key]}</button>
                `).join("")}
            </div>
            <div id="swapList" class="swx-list__items">
                ${visible.length
                    ? visible.map(swapItemHTML).join("")
                    : `<div class="empty-state empty-state--compact">No hay cambios${filter === "all" ? "" : " en este filtro"} en ${escapeHTML(monthName)}.</div>`}
            </div>
        </section>
    `;
}

function renderSwapList() {
    const holder = document.getElementById("swapListHolder");

    if (!holder) return;

    const focused = document.activeElement?.matches?.("[data-swx-search]");
    const caret = focused ? document.activeElement.selectionStart : null;

    holder.innerHTML = swapListHTML();

    if (focused) {
        const input = holder.querySelector("[data-swx-search]");

        input?.focus();
        if (caret !== null) input?.setSelectionRange(caret, caret);
    }
}

/* ---------- Registrar cambio ---------- */

function personCardHTML({ label, avatarClass, name, field, subtitle }) {
    return `
        <div class="swx-person">
            <span class="swx-person__label">${label}</span>
            <div class="swx-person__box">
                <span class="swx-av swx-av--lg ${avatarClass}">${escapeHTML(initials(name) || "?")}</span>
                <span class="swx-person__field">
                    ${field}
                    <small>${escapeHTML(subtitle || "")}</small>
                </span>
            </div>
        </div>
    `;
}

function renderSwapFromSearch(selectedFrom) {
    // Solo el nombre: el estamento y la rotativa van debajo, en la tarjeta.
    const value = selectedFrom || "";

    return `
        <form id="swapFromSearchForm" class="swx-from-search" autocomplete="off">
            <input
                id="swapFromSearch"
                type="search"
                list="swapFromOptions"
                placeholder="Selecciona colaborador"
                aria-label="Trabajador que entrega el turno"
                value="${escapeHTML(value)}"
            >
            <button class="swx-icon-btn" type="submit" aria-label="Buscar trabajador que entrega turno">${icon("search")}</button>
            <datalist id="swapFromOptions">
                ${renderSwapFromOptions()}
            </datalist>
        </form>
    `;
}

function stepsHTML(from, to) {
    const dates = Boolean(fechaCambioSeleccionada && fechaDevolucionSeleccionada);
    const steps = [
        ["Quién entrega", Boolean(from)],
        ["Quién recibe", Boolean(from && to)],
        ["Fechas", dates]
    ];
    const current = steps.findIndex(([, done]) => !done);

    return `
        <ol class="swx-steps" id="swapSteps">
            ${steps.map(([label, done], index) => `
                <li class="${done ? "is-done" : index === current ? "is-current" : ""}">
                    <span>${index + 1}</span>${label}
                </li>
            `).join("")}
        </ol>
    `;
}

function receiverChipsHTML(from, to) {
    const y = getSwapYear();
    const m = getSwapMonth();
    const receivers = getTrabajadoresDisponibles(
        from,
        fechaCambioSeleccionada ? keyFromInputDate(fechaCambioSeleccionada) : ""
    )
        .map(profile => ({
            name: profile.name,
            used: activeMonthlySwapCount(profile.name, y, m)
        }))
        .sort((a, b) => a.used - b.used || a.name.localeCompare(b.name, "es"))
        .slice(0, 6);

    if (!receivers.length) return "";

    return `
        <div class="swx-chips">
            <span>Compatibles:</span>
            ${receivers.map(item => {
                const count = swapCountText(item.name);

                return `
                    <button type="button" class="swx-chip ${item.name === to ? "is-active" : ""}" data-swx-receiver="${escapeHTML(item.name)}">
                        ${escapeHTML(shortName(item.name))}${count ? ` · ${count}` : ""}
                    </button>
                `;
            }).join("")}
        </div>
    `;
}

function legendHTML() {
    const colors = getTurnoColorConfig()?.base || {};

    return `
        <div class="swx-legend">
            <span><i style="background: ${escapeHTML(colors[1] || "#1f9d55")}"></i>Larga</span>
            <span><i style="background: ${escapeHTML(colors[2] || "#2563eb")}"></i>Noche</span>
            <span><i class="is-plain"></i>Diurno / libre</span>
            <span><i class="is-picked"></i>Elegido</span>
            <span><i class="is-off"></i>No disponible (pasa el mouse para ver por qué)</span>
        </div>
    `;
}

function selectedTurn(name, iso) {
    return iso ? Number(getSwapTurnState(name, keyFromInputDate(iso))) || 0 : 0;
}

function summaryHTML(from, to) {
    if (!from || !to || !fechaCambioSeleccionada || !fechaDevolucionSeleccionada) {
        return `
            <div class="swx-summary swx-summary--empty">
                Elige en el calendario de la izquierda el turno que entrega ${escapeHTML(firstName(from))} y, en el de la derecha, el que le devuelven.
            </div>
        `;
    }

    const turnoEntrega = selectedTurn(from, fechaCambioSeleccionada);
    const turnoDevuelve = selectedTurn(to, fechaDevolucionSeleccionada);
    const entregaLabel = swapCodeLabel(codigoTurno(turnoEntrega));
    const devuelveLabel = swapCodeLabel(codigoTurno(turnoDevuelve));
    const longDay = iso => isoToDate(iso)
        .toLocaleDateString("es-CL", { weekday: "short", day: "numeric" })
        .replace(".", "")
        .replace(/^./, letter => letter.toUpperCase());
    const limit = monthlyLimit();
    const y = getSwapYear();
    const m = getSwapMonth();
    const sameType = turnoEntrega === turnoDevuelve;
    const checks = [
        sameType
            ? `Mismo tipo de turno (${entregaLabel} por ${devuelveLabel})`
            : `${entregaLabel} por ${devuelveLabel}: la unidad permite tipos distintos`,
        "Sin 24 h invertido ni turnos encadenados",
        limit
            ? `Dentro del límite: ${firstName(from)} quedaría en ${activeMonthlySwapCount(from, y, m) + 1}/${limit} · ${firstName(to)} en ${activeMonthlySwapCount(to, y, m) + 1}/${limit}`
            : "La unidad no limita los cambios del mes",
        "Ninguno tiene permiso esos días"
    ];
    const chip = turno => `<span class="swx-turn" style="--swx-turn: ${escapeHTML(turnColor(turno))}">${escapeHTML(codigoTurno(turno))}</span>`;

    return `
        <div class="swx-summary">
            <div class="swx-summary__lines">
                <span class="swx-kicker">Así queda el cambio</span>
                <p>${chip(turnoEntrega)}<span><strong>${escapeHTML(longDay(fechaCambioSeleccionada))}</strong> · ${escapeHTML(firstName(from))} entrega su ${escapeHTML(entregaLabel)} → la hace ${escapeHTML(firstName(to))}</span></p>
                <p>${chip(turnoDevuelve)}<span><strong>${escapeHTML(longDay(fechaDevolucionSeleccionada))}</strong> · ${escapeHTML(firstName(to))} devuelve su ${escapeHTML(devuelveLabel)} → la hace ${escapeHTML(firstName(from))}</span></p>
            </div>
            <ul class="swx-summary__checks">
                ${checks.map(text => `<li>${icon("check")}${escapeHTML(text)}</li>`).join("")}
            </ul>
        </div>
    `;
}

function renderSwapSummary() {
    const from = getCurrentProfile();
    const to = document.getElementById("swapTo")?.value || "";
    const summary = document.getElementById("swapSummary");
    const steps = document.getElementById("swapSteps");
    const save = document.getElementById("saveSwapBtn");

    if (summary) summary.innerHTML = summaryHTML(from, to);
    if (steps) steps.outerHTML = stepsHTML(from, to);
    if (save) {
        save.disabled = !(from && to && fechaCambioSeleccionada && fechaDevolucionSeleccionada);
    }
}

function newSwapHTML(selectedFrom, previousTo, message = "") {
    const to = previousTo;
    const fromName = firstName(selectedFrom);
    const limit = monthlyLimit();

    if (message) {
        return `
            <section class="swx-card swx-new">
                <div class="swx-new__head"><h2>Registrar cambio</h2>${stepsHTML("", "")}</div>
                <div class="swx-people">
                    ${personCardHTML({
                        label: "Entrega el turno",
                        avatarClass: "",
                        name: selectedFrom,
                        field: renderSwapFromSearch(selectedFrom),
                        subtitle: profileSubtitle(selectedFrom)
                    })}
                </div>
                <div class="empty-state">${escapeHTML(message)}</div>
            </section>
        `;
    }

    return `
        <section class="swx-card swx-new">
            <div class="swx-new__head">
                <h2>Registrar cambio</h2>
                ${stepsHTML(selectedFrom, to)}
            </div>

            <div class="swx-people">
                <div class="swx-people__col">
                    ${personCardHTML({
                        label: "Entrega el turno",
                        avatarClass: "",
                        name: selectedFrom,
                        field: renderSwapFromSearch(selectedFrom),
                        subtitle: profileSubtitle(selectedFrom)
                    })}
                    ${limit ? `<span class="swx-note">Cambios este mes: <strong>${activeMonthlySwapCount(selectedFrom, getSwapYear(), getSwapMonth())} de ${limit}</strong></span>` : ""}
                </div>
                <div class="swx-people__col">
                    ${personCardHTML({
                        label: "Recibe el turno",
                        avatarClass: "swx-av--alt",
                        name: to,
                        field: `<select id="swapTo" aria-label="Trabajador que recibe el turno"></select>`,
                        subtitle: profileSubtitle(to)
                    })}
                    <div id="swapReceiverChips">${receiverChipsHTML(selectedFrom, to)}</div>
                </div>
            </div>

            <div class="swx-cals">
                <div class="swx-cal">
                    <div class="swx-cal__head"><strong>${escapeHTML(fromName)} entrega</strong><span>Solo sus Largas y Noches base</span></div>
                    <div id="swapCalendar1"></div>
                </div>
                <div class="swx-cal">
                    <div class="swx-cal__head"><strong id="swapCalendar2Title">${escapeHTML(firstName(to) || "Quien recibe")} devuelve</strong><span>Turnos que ${escapeHTML(fromName)} puede hacer</span></div>
                    <div id="swapCalendar2"></div>
                </div>
            </div>

            ${legendHTML()}

            <div id="swapSummary">${summaryHTML(selectedFrom, to)}</div>

            <div class="swx-new__foot">
                <span>Al registrar se crea el memorándum con el <strong>Anexo 4</strong> ya rellenado, listo para imprimir y firmar.</span>
                <button id="saveSwapBtn" class="swx-btn swx-btn--primary swx-btn--lg" type="button" disabled>${icon("check")}Registrar y descargar Anexo 4</button>
            </div>
        </section>
    `;
}

export function renderSwapPanel(){
    const box = document.getElementById("swapPanel");
    if (!box) return;

    if (!getTurnChangeConfig().allowSwaps) {
        box.innerHTML = `
            <div class="empty-state">
                Los cambios de turno estan desactivados en Ajustes del sistema.
            </div>
        `;
        return;
    }

    const perfiles = getProfiles();
    const selectedFrom = getCurrentProfile();
    const previousTo =
        document.getElementById("swapTo")?.value || "";
    const perfilFrom = getPerfil(selectedFrom);
    const pendingCount = pendingSignatureSwaps().length;
    const message = !selectedFrom || !perfilFrom
        ? "Selecciona un trabajador para revisar cambios de turno."
        : noPuedeIntercambiar(selectedFrom)
            ? `${selectedFrom} no puede intercambiar turnos porque el perfil esta desactivado.`
            : perfiles.length < 2
                ? "Necesitas al menos dos colaboradores para registrar cambios de turno."
                : "";
    // Quien recibe se resuelve ANTES de pintar: su tarjeta y su calendario
    // salen con nombre desde el principio, no despues de llenar el select.
    const receivers = message
        ? []
        : getTrabajadoresDisponibles(
            selectedFrom,
            fechaCambioSeleccionada
                ? keyFromInputDate(fechaCambioSeleccionada)
                : ""
        );
    const effectiveTo = receivers.some(profile => profile.name === previousTo)
        ? previousTo
        : receivers[0]?.name || "";

    box.innerHTML = `
        <div class="swx">
            <header class="swx-head">
                <span class="swx-head__spacer"></span>
                <div class="swx-month">
                    <button id="swapPrevMonth" class="swx-month__nav" type="button" aria-label="Mes anterior">${icon("prev")}</button>
                    <button
                        id="swapMonthLabel"
                        class="swx-month__label"
                        type="button"
                        aria-label="Elegir mes y a&#241;o"
                        aria-haspopup="dialog"
                        aria-expanded="false"
                    >${escapeHTML(SWAP_MONTH_NAMES[getSwapMonth()])} ${getSwapYear()}</button>
                    <button id="swapNextMonth" class="swx-month__nav" type="button" aria-label="Mes siguiente">${icon("next")}</button>
                </div>
                <button class="swx-btn swx-btn--ghost swx-btn--lg" type="button" data-swx-act="download-pending" ${pendingCount ? "" : "disabled"}>${icon("download")}Descargar pendientes de firma (${pendingCount})</button>
            </header>

            <div class="swx-grid">
                ${newSwapHTML(selectedFrom, effectiveTo, message)}
                <aside class="swx-side">
                    ${requestsHTML()}
                    <div id="swapListHolder">${swapListHTML()}</div>
                </aside>
            </div>
        </div>
    `;

    document.getElementById("swapPrevMonth").onclick =
        () => cambiarMesSwap(-1);

    document.getElementById("swapNextMonth").onclick =
        () => cambiarMesSwap(1);

    setupSwapMonthPicker(document.getElementById("swapMonthLabel"));
    bindSwapFromSearch();
    bindSwapPanelActions(box);

    if (message) return;

    document.getElementById("saveSwapBtn").onclick =
        guardarCambioTurno;

    document.getElementById("swapTo").onchange = () => {
        fechaDevolucionSeleccionada = "";
        renderSwapPanel();
    };

    actualizarSwapTo(effectiveTo);
    renderMiniCalendarios();
}

window.renderSwapPanel = renderSwapPanel;

function swapFromId(swapId) {
    return getSwaps().find(swap => String(swap?.id) === String(swapId)) || null;
}

function viewInCalendar(profile, iso) {
    if (!profile || !iso) return;

    window.dispatchEvent(new CustomEvent("proturnos:viewWorkerRequestInCalendar", {
        detail: { profile, date: iso }
    }));
}

async function cancelSwapFromList(swap) {
    const confirmed = await showConfirm(
        `Se anulará el cambio entre ${swap.from} y ${swap.to} ` +
            `(${formatFecha(swap.fecha)} y ${formatFecha(swap.devolucion)}). ` +
            "Cada uno vuelve a su turno original.",
        {
            title: "Anular cambio de turno",
            tone: "danger",
            confirmText: "Anular cambio",
            cancelText: "Volver",
            destructive: true
        }
    );

    if (!confirmed) return;

    pushHistory();
    deshacerCambioTurno(swap);
    refreshAll();
}

// Un solo manejador por panel: el contenido se repinta entero y los botones
// llegan y se van, pero `box` es el mismo.
function bindSwapPanelActions(box) {
    if (box.dataset.swxBound === "true") return;

    box.dataset.swxBound = "true";

    box.addEventListener("input", event => {
        if (!event.target.matches?.("[data-swx-search]")) return;

        swapListQuery = event.target.value;
        renderSwapList();
    });

    box.addEventListener("click", async event => {
        const filter = event.target.closest("[data-swx-filter]");

        if (filter) {
            swapListFilter = filter.dataset.swxFilter;
            renderSwapList();
            return;
        }

        const receiver = event.target.closest("[data-swx-receiver]");

        if (receiver) {
            const select = document.getElementById("swapTo");

            if (select && select.value !== receiver.dataset.swxReceiver) {
                select.value = receiver.dataset.swxReceiver;
                select.onchange?.();
            }
            return;
        }

        const button = event.target.closest("[data-swx-act]");

        if (!button) return;

        const action = button.dataset.swxAct;
        const swap = button.dataset.swapId ? swapFromId(button.dataset.swapId) : null;

        if (action === "download-pending") {
            const pending = pendingSignatureSwaps().map(item => item.swap.id);
            const month = `${SWAP_MONTH_NAMES[getSwapMonth()]}_${getSwapYear()}`;

            await downloadSwapAnexo4Batch(pending, `Anexos4_pendientes_${month}.zip`);
            return;
        }

        if (action === "anexo" && swap) {
            await downloadSwapAnexo4(swap.id);
            return;
        }

        if (action === "scan" && swap) {
            openSwapScanDialog(swap, { onDone: () => renderSwapPanel() });
            return;
        }

        if (action === "open-doc") {
            await openMemoDocument(button.dataset.memoId, button.dataset.docId);
            return;
        }

        if (action === "calendar" && swap) {
            viewInCalendar(swap.from, swap.fecha);
            return;
        }

        if (action === "cancel" && swap) {
            await cancelSwapFromList(swap);
            return;
        }

        if (action === "request-calendar") {
            viewInCalendar(button.dataset.profile, button.dataset.date);
            return;
        }

        if (action === "accept-request" || action === "reject-request") {
            button.disabled = true;
            const done = action === "accept-request"
                ? await acceptWorkerRequestById(button.dataset.requestId)
                : await rejectWorkerRequestById(button.dataset.requestId);

            if (done === false) button.disabled = false;
            if (done !== false) refreshAll();
            renderSwapPanel();
        }
    });
}
