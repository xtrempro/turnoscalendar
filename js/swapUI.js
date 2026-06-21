import { normalizeText } from "./stringUtils.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    cambiosDelMes,
    cambioEstaAnulado,
    canSwapProfiles,
    getSwapDateBlockReason,
    getSwapTurnState,
    isSwapExchangeableTurn,
    registrarCambio
} from "./swaps.js";
import {
    getCurrentProfile,
    getProfiles,
    getTurnChangeConfig,
    isProfileActive,
    setCurrentProfile
} from "./storage.js";
import { refreshAll } from "./refresh.js";
import { pushHistory } from "./history.js";

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

function parseInputDate(value){
    const parts = value.split("-");
    return new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );
}

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

function normalizeSearch(value) {
    return normalizeText(value);
}

function profileMetaLabel(profile = {}) {
    const role = profile.estamento || "Sin estamento";
    const profession = profile.profession &&
        normalizeSearch(profile.profession) !== "sin informacion"
        ? ` | ${profile.profession}`
        : "";

    return `${role}${profession}`;
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

function getTrabajadoresDisponibles(nombreFrom) {
    if (!getPerfil(nombreFrom)) return [];

    return getProfiles().filter(profile =>
        profile.name !== nombreFrom &&
        isProfileActive(profile) &&
        !noPuedeIntercambiar(profile.name) &&
        canSwapProfiles(nombreFrom, profile.name)
    );
}

function getSwapYear(){
    return swapDate.getFullYear();
}

function getSwapMonth(){
    return swapDate.getMonth();
}

function formatSwapMonth(){
    return swapDate
        .toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        )
        .toUpperCase();
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
    if (turno === 3) return "24";
    if (turno === 4) return "D";
    if (turno === 5) return "D+N";

    return "";
}

function keyFromInputDate(value) {
    const date = parseInputDate(value);

    if (Number.isNaN(date.getTime())) return "";

    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function bindSwapProfileFilters() {
    ["swapProfileSearch", "swapFilterRole"]
        .forEach(id => {
            const element = document.getElementById(id);

            if (!element || element.dataset.swapBound) return;

            element.dataset.swapBound = "true";
            element.addEventListener("input", renderSwapProfiles);
            element.addEventListener("change", renderSwapProfiles);
        });
}

function renderSwapProfiles() {
    const list = document.getElementById("swapProfiles");
    const empty = document.getElementById("swapEmptyProfiles");

    if (!list || !empty) return;

    const profiles = getProfiles();
    const current = getCurrentProfile();
    const query = normalizeSearch(
        document.getElementById("swapProfileSearch")?.value || ""
    );
    const filtro =
        document.getElementById("swapFilterRole")?.value || "Todos";
    const visibles = profiles.filter(profile => {
        const active = isProfileActive(profile);
        const role = filtro === "Todos" || profile.estamento === filtro;
        const search = !query ||
            normalizeSearch(profile.name).includes(query) ||
            normalizeSearch(profile.estamento).includes(query) ||
            normalizeSearch(profile.profession).includes(query);

        return active && role && search;
    });

    list.innerHTML = "";

    if (!visibles.length) {
        empty.classList.remove("hidden");
        empty.textContent = profiles.length
            ? "No hay resultados con ese filtro."
            : "Aun no hay colaboradores creados.";
        return;
    }

    empty.classList.add("hidden");

    visibles.forEach(profile => {
        const item = document.createElement("button");
        item.className = "profile-item swap-profile-item";
        item.type = "button";

        if (!isProfileActive(profile)) {
            item.classList.add("is-inactive");
        }

        if (profile.name === current) {
            item.classList.add("active");
        }

        item.innerHTML = `
            <span class="profile-item__avatar">
                ${escapeHTML(profile.name.trim().charAt(0).toUpperCase() || "T")}
            </span>
            <span class="profile-item__content">
                <strong>${escapeHTML(profile.name)}</strong>
                <span>${escapeHTML(profileMetaLabel(profile))}${isProfileActive(profile) ? "" : " | Desactivado"}</span>
            </span>
        `;

        item.onclick = () => {
            fechaCambioSeleccionada = "";
            fechaDevolucionSeleccionada = "";
            if (typeof window.selectProfileByName === "function") {
                window.selectProfileByName(profile.name);
            } else {
                setCurrentProfile(profile.name);
                renderSwapPanel();
                refreshAll();
            }
        };

        list.appendChild(item);
    });
}

export function renderSwapPanel(){
    const box = document.getElementById("swapPanel");
    if (!box) return;

    renderSwapProfiles();
    bindSwapProfileFilters();

    const perfiles = getProfiles();
    const selectedFrom = getCurrentProfile();
    const previousTo =
        document.getElementById("swapTo")?.value || "";
    const perfilFrom = getPerfil(selectedFrom);

    if (!selectedFrom || !perfilFrom) {
        box.innerHTML = `
            <div class="empty-state">
                Selecciona un trabajador para revisar cambios de turno.
            </div>
        `;
        return;
    }

    if (!getTurnChangeConfig().allowSwaps) {
        box.innerHTML = `
            <div class="empty-state">
                Los cambios de turno estan desactivados en Ajustes del sistema.
            </div>
        `;
        return;
    }

    if (noPuedeIntercambiar(selectedFrom)) {
        box.innerHTML = `
            <div class="empty-state">
                ${escapeHTML(selectedFrom)} no puede intercambiar turnos porque el perfil esta desactivado.
            </div>
        `;
        return;
    }

    if (perfiles.length < 2) {
        box.innerHTML = `
            <div class="empty-state">
                Necesitas al menos dos colaboradores para registrar cambios de turno.
            </div>
        `;
        return;
    }

    const options = getTrabajadoresDisponibles(
        selectedFrom
    )
        .map(profile => `
            <option
                value="${escapeHTML(profile.name)}"
                ${profile.name === previousTo ? "selected" : ""}
            >
                ${escapeHTML(profile.name)}
            </option>
        `)
        .join("");

    box.innerHTML = `
        <div class="swap-monthbar">
            <button id="swapPrevMonth" class="swap-month-button" type="button" aria-label="Mes anterior">
                &lt;
            </button>

            <button
                id="swapMonthLabel"
                class="swap-month-trigger"
                type="button"
                aria-label="Elegir mes y a&#241;o"
                aria-haspopup="dialog"
                aria-expanded="false"
            >
                ${formatSwapMonth()}
            </button>

            <button id="swapNextMonth" class="swap-month-button" type="button" aria-label="Mes siguiente">
                &gt;
            </button>
        </div>

        <div class="swap-row">
            <label class="field-stack">
                <span>Entrega turno</span>
                <div id="swapFromLabel" class="swap-readonly-worker">
                    ${escapeHTML(selectedFrom)}
                </div>
            </label>

            <label class="field-stack">
                <span>Recibe turno</span>
                <select id="swapTo">
                    ${options}
                </select>
            </label>

            <div class="mini-wrap">
                <label>Fecha de cambio</label>
                <div id="swapCalendar1"></div>
            </div>

            <div class="mini-wrap">
                <label>Fecha de devolución</label>
                <div id="swapCalendar2"></div>
            </div>

            <button id="saveSwapBtn" class="primary-button primary-button--wide" type="button">
                Registrar cambio
            </button>
        </div>

        <div id="swapList"></div>
    `;

    document.getElementById("swapPrevMonth").onclick =
        () => cambiarMesSwap(-1);

    document.getElementById("swapNextMonth").onclick =
        () => cambiarMesSwap(1);

    setupSwapMonthPicker(document.getElementById("swapMonthLabel"));

    document.getElementById("saveSwapBtn").onclick =
        guardarCambioTurno;

    document.getElementById("swapTo").onchange = () => {
        renderMiniCalendarios();
        renderSwapList();
    };

    actualizarSwapTo(previousTo);
    renderSwapList();
    renderMiniCalendarios();
}

window.renderSwapPanel = renderSwapPanel;

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

    renderMiniCalendar(
        "swapCalendar1",
        from,
        true,
        from,
        to,
        selectedDevolucionTurn
    );

    renderMiniCalendar(
        "swapCalendar2",
        to,
        false,
        to,
        from,
        selectedCambioTurn
    );
}

function renderMiniCalendar(
    id,
    trabajador,
    esCambio,
    giver,
    receiver,
    requiredTurn = 0
){
    const div = document.getElementById(id);
    if (!div) return;

    const y = getSwapYear();
    const m = getSwapMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const totalCells = 42;

    let html = `<div class="mini-grid">`;

    for (let i = 0; i < first; i++) {
        html += `<div class="mini-day mini-spacer" aria-hidden="true"></div>`;
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
        const motivoBloqueo =
            getSwapDateBlockReason({
                giver,
                receiver,
                keyDay: key,
                requiredTurn
            });
        const valido = !motivoBloqueo;

        const turnoClass = turnoBase === 1
            ? "mini-turn-larga"
            : turnoBase === 2
                ? "mini-turn-noche"
                : "";
        let clase = "mini-off";

        if (valido) clase = `mini-on ${turnoClass}`;

        const seleccionada = esCambio
            ? fechaCambioSeleccionada === toISO(fecha)
            : fechaDevolucionSeleccionada === toISO(fecha);

        if (seleccionada) {
            clase = `mini-selected ${turnoClass}`;
        }

        html += `
            <div
                class="mini-day ${clase}"
                data-fecha="${toISO(fecha)}"
                data-tipo="${esCambio ? 1 : 2}"
                title="${escapeHTML(motivoBloqueo || `${giver} entrega ${textoTurno(turnoBase)}`)}"
            >
                <span>${d}</span>
                <small>${textoTurno(turnoBase)}</small>
            </div>
        `;
    }

    for (let i = first + days; i < totalCells; i++) {
        html += `<div class="mini-day mini-spacer" aria-hidden="true"></div>`;
    }

    html += `</div>`;

    div.innerHTML = html;

    div.querySelectorAll(".mini-on, .mini-selected")
        .forEach(item => {
            item.onclick = () => {
                const fecha = item.dataset.fecha;

                if (item.dataset.tipo === "1") {
                    fechaCambioSeleccionada = fecha;
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

    const filtrados = getTrabajadoresDisponibles(from);

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
                No hay colegas compatibles para este cambio.
            </div>
        `;

        document.getElementById("swapCalendar2").innerHTML = `
            <div class="empty-state empty-state--compact">
                Ajusta la selección para continuar.
            </div>
        `;
        return;
    }

    toSelect.disabled = false;

    const saveButton =
        document.getElementById("saveSwapBtn");

    if (saveButton) {
        saveButton.disabled = false;
    }
}

function renderSwapList(){
    const div = document.getElementById("swapList");
    if (!div) return;

    const from = getCurrentProfile();
    const to = document.getElementById("swapTo")?.value || "";
    const selectedWorkers = new Set(
        [from, to].filter(Boolean)
    );
    const swaps = cambiosDelMes(
        getSwapYear(),
        getSwapMonth()
    ).filter(swap =>
        selectedWorkers.has(swap.from) ||
        selectedWorkers.has(swap.to)
    );

    if (!swaps.length) {
        const pairText = from && to
            ? ` donde participe ${escapeHTML(from)} o ${escapeHTML(to)}`
            : "";

        div.innerHTML = `
            <div class="empty-state empty-state--compact">
                No hay cambios de turno registrados${pairText} en ${formatSwapMonth().toLowerCase()}.
            </div>
        `;
        return;
    }

    div.innerHTML = swaps
        .slice()
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map(swap => `
            <div class="swap-item ${cambioEstaAnulado(swap) ? "is-canceled" : ""}">
                ${escapeHTML(swap.from)} -> ${escapeHTML(swap.to)}
                (${escapeHTML(formatFecha(swap.fecha))})
                ${cambioEstaAnulado(swap) ? "| ANULADO" : ""}
                | devolución ${formatFecha(swap.devolucion)}
            </div>
        `)
        .join("");
}

function guardarCambioTurno(){
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
        alert("Los trabajadores no son compatibles para cambio de turno. Revisa estamento, profesi\u00f3n y que no tengan la misma rotativa base.");
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

    registrarCambio({
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

    refreshAll();
    alert("Cambio registrado.");
}
