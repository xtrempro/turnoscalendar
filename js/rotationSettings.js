import { TURNO } from "./constants.js";
import { showAlert, showConfirm, showPrompt } from "./dialogs.js";
import { escapeHTML } from "./htmlUtils.js";
import { getProfiles, getRotativa } from "./storage.js";
import {
    createCatalogId,
    detectRotationPattern,
    getRotationCatalog,
    getRotationDefinitions,
    getShiftDefinitions,
    normalizeRotationCatalog,
    saveRotationCatalog
} from "./rotationCatalog.js";

const BOARD_DAYS = 42;

const TURN_CLASSES = [
    { value: TURNO.LIBRE, label: "Libre" },
    { value: TURNO.DIURNO, label: "Diurno" },
    { value: TURNO.LARGA, label: "Larga" },
    { value: TURNO.NOCHE, label: "Noche" },
    { value: TURNO.TURNO24, label: "24 horas" },
    { value: TURNO.TURNO18, label: "18 horas" }
];

let draft = null;
let rotationEditor = null;
let shiftEditor = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function turnClassLabel(turn) {
    return TURN_CLASSES.find(item => item.value === Number(turn))?.label || "Libre";
}

function shiftById(id) {
    return draft?.shifts?.find(item => item.id === id) || null;
}

function rotationById(id) {
    return draft?.rotations?.find(item => item.id === id) || null;
}

function rotationsUsingShift(shiftId) {
    return (draft?.rotations || []).filter(rotation =>
        rotation.pattern.includes(shiftId)
    );
}

function rotationPatternLocked(rotation) {
    return Boolean(
        rotation?.builtin ||
        (rotation?.id && assignedProfiles(rotation.id).length)
    );
}

function shiftDefinitionLocked(shift) {
    return Boolean(
        shift?.builtin ||
        (shift?.id && rotationsUsingShift(shift.id).length)
    );
}

function scheduleLabel(shift) {
    if (Number(shift?.turn) === TURNO.LIBRE) return "Sin jornada";
    const nextDay = shift?.nextDay ? " (+1)" : "";
    const friday = shift?.fridayEnd && shift.fridayEnd !== shift.end
        ? ` · viernes ${shift.fridayEnd}`
        : "";
    return `${shift?.start || "--:--"} a ${shift?.end || "--:--"}${nextDay}${friday}`;
}

function patternLabel(pattern = []) {
    return pattern.map(id => shiftById(id)?.name || id).join(" · ");
}

function editorPattern() {
    return detectRotationPattern(rotationEditor?.slots || []);
}

function boardHTML() {
    const detected = editorPattern();
    const locked = Boolean(rotationEditor.locked);
    const palette = getShiftDefinitions(draft).map(shift => `
        <button
            class="sx-rotation-shift ${rotationEditor.selectedShiftId === shift.id ? "is-selected" : ""}"
            type="button"
            data-rotation-settings-action="select-shift"
            data-shift-id="${escapeHTML(shift.id)}"
            ${locked ? "disabled" : ""}
        >
            <span class="sx-rotation-shift__swatch" data-turn="${Number(shift.turn)}"></span>
            <strong>${escapeHTML(shift.name)}</strong>
            <small>${escapeHTML(scheduleLabel(shift))}</small>
        </button>
    `).join("");
    const cells = rotationEditor.slots.map((shiftId, index) => {
        const shift = shiftById(shiftId);
        return `
            <button
                class="sx-pattern-day ${shift ? "has-shift" : ""}"
                type="button"
                data-rotation-settings-action="paint-day"
                data-day-index="${index}"
                data-turn="${Number(shift?.turn) || 0}"
                aria-label="Dia ${index + 1}${shift ? `: ${escapeHTML(shift.name)}` : ""}"
                ${locked ? "disabled" : ""}
            >
                <span>${index + 1}</span>
                <strong>${escapeHTML(shift?.name || "")}</strong>
            </button>
        `;
    }).join("");

    return `
        <section class="sx-rotation-builder">
            <div class="sx-rotation-builder__head">
                <div>
                    <span class="sx-eyebrow">${locked ? "Patrón protegido" : rotationEditor.rotationId ? "Editar rotativa" : "Nueva rotativa"}</span>
                    <h3>${escapeHTML(rotationEditor.name || "Diseñar patrón")}</h3>
                    <p>${locked
                        ? "Esta definición no se modifica en el lugar. Duplica la rotativa para crear una versión nueva sin alterar calendarios anteriores."
                        : rotationEditor.mode === "businessDays"
                        ? "Esta rotativa aplica el mismo turno de lunes a viernes y deja libres fines de semana y feriados."
                        : "Selecciona un turno y aplícalo sobre los días. Dos repeticiones completas bastan para reconocer el patrón."}</p>
                </div>
                <button class="sx-btn sx-btn--ghost" type="button" data-rotation-settings-action="close-rotation-editor">Cerrar editor</button>
            </div>

            <div class="sx-rotation-palette" aria-label="Tipos de turno">${palette}</div>

            <div class="sx-pattern-weekdays" aria-hidden="true">
                ${["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map(day => `<span>${day}</span>`).join("")}
            </div>
            <div class="sx-pattern-calendar">${cells}</div>

            <div class="sx-pattern-status ${detected.length ? "is-recognized" : ""}">
                <div>
                    <strong>${rotationEditor.patternApplied
                        ? "Patrón aplicado a los meses siguientes"
                        : detected.length ? "Patrón reconocido" : "Construyendo patrón"}</strong>
                    <span>${detected.length
                        ? escapeHTML(patternLabel(detected))
                        : "Completa y repite la secuencia al menos una vez."}</span>
                </div>
                ${!locked && detected.length && !rotationEditor.patternApplied ? `
                    <button class="sx-btn sx-btn--primary" type="button" data-rotation-settings-action="apply-pattern">
                        Aplicar patrón
                    </button>
                ` : ""}
            </div>

            <div class="sx-rotation-builder__actions">
                ${locked ? `
                    <button class="sx-btn sx-btn--primary" type="button" data-rotation-settings-action="duplicate-rotation" data-rotation-id="${escapeHTML(rotationEditor.rotationId)}">Duplicar como nueva rotativa</button>
                ` : `
                    <button class="sx-btn sx-btn--ghost" type="button" data-rotation-settings-action="clear-pattern">Limpiar calendario</button>
                    <button class="sx-btn sx-btn--primary" type="button" data-rotation-settings-action="save-rotation" ${!detected.length || !rotationEditor.patternApplied ? "disabled" : ""}>
                        ${rotationEditor.rotationId ? "Guardar rotativa" : "Crear rotativa"}
                    </button>
                `}
            </div>
        </section>
    `;
}

function shiftEditorHTML() {
    if (!shiftEditor) return "";
    const isFree = Number(shiftEditor.turn) === TURNO.LIBRE;
    const locked = Boolean(shiftEditor.locked);
    const disabled = locked ? "disabled" : "";

    return `
        <section class="sx-shift-editor">
            <div class="sx-rotation-builder__head">
                <div>
                    <span class="sx-eyebrow">${locked ? "Turno protegido" : shiftEditor.id ? "Editar turno" : "Nuevo turno"}</span>
                    <h3>Tipo de turno</h3>
                    ${locked ? `<p>Su clase y horario ya forman parte de una rotativa. Crea una copia para cambiarlos sin recalcular meses anteriores.</p>` : ""}
                </div>
                <button class="sx-icon-btn" type="button" data-rotation-settings-action="close-shift-editor" aria-label="Cerrar editor">&#215;</button>
            </div>
            <div class="sx-shift-form">
                <label><span>Nombre</span><input type="text" data-shift-field="name" value="${escapeHTML(shiftEditor.name)}" maxlength="60" ${disabled}></label>
                <label><span>Clase operativa</span>
                    <select data-shift-field="turn" ${disabled}>
                        ${TURN_CLASSES.map(item => `<option value="${item.value}" ${item.value === Number(shiftEditor.turn) ? "selected" : ""}>${item.label}</option>`).join("")}
                    </select>
                </label>
                ${isFree ? "" : `
                    <label><span>Entrada</span><input type="time" data-shift-field="start" value="${escapeHTML(shiftEditor.start)}" ${disabled}></label>
                    <label><span>Salida</span><input type="time" data-shift-field="end" value="${escapeHTML(shiftEditor.end)}" ${disabled}></label>
                    ${Number(shiftEditor.turn) === TURNO.DIURNO ? `
                        <label><span>Salida viernes</span><input type="time" data-shift-field="fridayEnd" value="${escapeHTML(shiftEditor.fridayEnd || shiftEditor.end)}" ${disabled}></label>
                    ` : ""}
                    <label class="sx-check-row"><input type="checkbox" data-shift-field="nextDay" ${shiftEditor.nextDay ? "checked" : ""} ${disabled}><span>La salida es al día siguiente</span></label>
                `}
            </div>
            <div class="sx-rotation-builder__actions">
                ${locked ? `
                    <button class="sx-btn sx-btn--primary" type="button" data-rotation-settings-action="duplicate-shift" data-shift-id="${escapeHTML(shiftEditor.id)}">Duplicar como nuevo turno</button>
                ` : `
                    <button class="sx-btn sx-btn--primary" type="button" data-rotation-settings-action="save-shift">Guardar turno</button>
                `}
            </div>
        </section>
    `;
}

function rotationsListHTML() {
    const rotations = getRotationDefinitions(draft);
    if (!rotations.length) return `<div class="sx-empty">No hay rotativas activas.</div>`;

    return `<div class="sx-rotation-list">${rotations.map(rotation => `
        <article class="sx-rotation-card">
            <div>
                <strong>${escapeHTML(rotation.name)}</strong>
                <span>${rotation.mode === "businessDays" ? "Días hábiles" : `${rotation.pattern.length} días`}</span>
                <small>${escapeHTML(patternLabel(rotation.pattern))}</small>
            </div>
            <div class="sx-rotation-card__actions">
                <button class="sx-icon-btn" type="button" data-rotation-settings-action="edit-rotation" data-rotation-id="${escapeHTML(rotation.id)}" title="Editar rotativa" aria-label="Editar ${escapeHTML(rotation.name)}">&#9998;</button>
                <button class="sx-icon-btn sx-icon-btn--danger" type="button" data-rotation-settings-action="delete-rotation" data-rotation-id="${escapeHTML(rotation.id)}" title="Eliminar rotativa" aria-label="Eliminar ${escapeHTML(rotation.name)}">&#128465;</button>
            </div>
        </article>
    `).join("")}</div>`;
}

function shiftsListHTML() {
    return `<div class="sx-shift-list">${getShiftDefinitions(draft).map(shift => `
        <article class="sx-shift-row">
            <span class="sx-rotation-shift__swatch" data-turn="${Number(shift.turn)}"></span>
            <div><strong>${escapeHTML(shift.name)}</strong><small>${escapeHTML(turnClassLabel(shift.turn))} · ${escapeHTML(scheduleLabel(shift))}</small></div>
            <button class="sx-icon-btn" type="button" data-rotation-settings-action="edit-shift" data-shift-id="${escapeHTML(shift.id)}" title="Editar turno" aria-label="Editar ${escapeHTML(shift.name)}">&#9998;</button>
            <button class="sx-icon-btn sx-icon-btn--danger" type="button" data-rotation-settings-action="delete-shift" data-shift-id="${escapeHTML(shift.id)}" title="Eliminar turno" aria-label="Eliminar ${escapeHTML(shift.name)}">&#128465;</button>
        </article>
    `).join("")}</div>`;
}

export function resetRotationSettingsDraft() {
    draft = clone(getRotationCatalog());
    rotationEditor = null;
    shiftEditor = null;
}

export function renderRotationSettingsPanel() {
    if (!draft) resetRotationSettingsDraft();

    return `
        <div class="sx-rotations-panel">
            <div class="sx-section-head sx-section-head--actions">
                <div>
                    <h2>Rotativas y turnos</h2>
                    <p>Define los turnos de la unidad y crea patrones que podrán asignarse desde Perfiles y Calendario mensual.</p>
                </div>
                <div class="sx-inline-actions">
                    <button class="sx-btn sx-btn--ghost" type="button" data-rotation-settings-action="new-shift">Nuevo turno</button>
                    <button class="sx-btn sx-btn--primary" type="button" data-rotation-settings-action="new-rotation">Nueva rotativa</button>
                </div>
            </div>

            ${rotationEditor ? boardHTML() : ""}
            ${shiftEditor ? shiftEditorHTML() : ""}

            <div class="sx-rotation-columns">
                <section>
                    <div class="sx-subhead"><h3>Rotativas disponibles</h3><span>${getRotationDefinitions(draft).length}</span></div>
                    ${rotationsListHTML()}
                </section>
                <section>
                    <div class="sx-subhead"><h3>Tipos de turno</h3><span>${getShiftDefinitions(draft).length}</span></div>
                    ${shiftsListHTML()}
                </section>
            </div>
        </div>
    `;
}

export function saveRotationSettingsDraft() {
    if (!draft) return getRotationCatalog();
    draft = clone(saveRotationCatalog(draft));
    return draft;
}

function readShiftEditor(container) {
    const read = name => container.querySelector(`[data-shift-field="${name}"]`);
    const turn = Number(read("turn")?.value);
    return {
        ...shiftEditor,
        name: String(read("name")?.value || "").trim(),
        turn,
        start: turn === TURNO.LIBRE ? "" : String(read("start")?.value || ""),
        end: turn === TURNO.LIBRE ? "" : String(read("end")?.value || ""),
        fridayEnd: turn === TURNO.DIURNO ? String(read("fridayEnd")?.value || read("end")?.value || "") : "",
        nextDay: turn === TURNO.LIBRE ? false : Boolean(read("nextDay")?.checked)
    };
}

function assignedProfiles(rotationId) {
    return getProfiles().filter(profile => getRotativa(profile.name).type === rotationId);
}

export async function handleRotationSettingsClick(event, container, callbacks = {}) {
    const button = event.target?.closest?.("[data-rotation-settings-action]");
    if (!button) return false;
    const action = button.dataset.rotationSettingsAction;
    const rerender = callbacks.rerender || (() => {});
    const dirty = callbacks.dirty || (() => {});

    if (action === "new-rotation") {
        const firstShift = getShiftDefinitions(draft).find(item => item.id !== "libre") || getShiftDefinitions(draft)[0];
        rotationEditor = {
            rotationId: "",
            name: "",
            mode: "sequence",
            selectedShiftId: firstShift?.id || "libre",
            slots: Array(BOARD_DAYS).fill(""),
            patternApplied: false,
            locked: false
        };
        shiftEditor = null;
        rerender();
        return true;
    }

    if (action === "edit-rotation") {
        const rotation = rotationById(button.dataset.rotationId);
        if (!rotation) return true;
        const repeated = Array.from({ length: BOARD_DAYS }, (_, index) =>
            rotation.pattern[index % rotation.pattern.length]
        );
        rotationEditor = {
            rotationId: rotation.id,
            name: rotation.name,
            mode: rotation.mode,
            selectedShiftId: rotation.pattern[0] || "libre",
            slots: repeated,
            patternApplied: true,
            locked: rotationPatternLocked(rotation)
        };
        shiftEditor = null;
        rerender();
        return true;
    }

    if (action === "close-rotation-editor") {
        rotationEditor = null;
        rerender();
        return true;
    }

    if (action === "select-shift") {
        if (rotationEditor?.locked) return true;
        rotationEditor.selectedShiftId = button.dataset.shiftId;
        rerender();
        return true;
    }

    if (action === "paint-day") {
        if (rotationEditor?.locked) return true;
        const index = Number(button.dataset.dayIndex);
        if (index >= 0 && index < BOARD_DAYS) {
            if (rotationEditor.mode === "businessDays") {
                const next = rotationEditor.slots[index] === rotationEditor.selectedShiftId
                    ? ""
                    : rotationEditor.selectedShiftId;
                rotationEditor.slots = Array(BOARD_DAYS).fill(next);
            } else {
                rotationEditor.slots[index] = rotationEditor.slots[index] === rotationEditor.selectedShiftId
                    ? ""
                    : rotationEditor.selectedShiftId;
            }
            rotationEditor.patternApplied = false;
            rerender();
        }
        return true;
    }

    if (action === "clear-pattern") {
        if (rotationEditor?.locked) return true;
        rotationEditor.slots = Array(BOARD_DAYS).fill("");
        rotationEditor.patternApplied = false;
        rerender();
        return true;
    }

    if (action === "apply-pattern") {
        if (rotationEditor?.locked) return true;
        const pattern = editorPattern();
        if (pattern.length) {
            rotationEditor.slots = Array.from({ length: BOARD_DAYS }, (_, index) =>
                pattern[index % pattern.length]
            );
            rotationEditor.patternApplied = true;
            rerender();
        }
        return true;
    }

    if (action === "duplicate-rotation") {
        const source = rotationById(button.dataset.rotationId);
        if (!source) return true;
        rotationEditor = {
            rotationId: "",
            name: `${source.name} copia`,
            mode: source.mode,
            selectedShiftId: source.pattern[0] || "libre",
            slots: Array.from({ length: BOARD_DAYS }, (_, index) =>
                source.pattern[index % source.pattern.length]
            ),
            patternApplied: true,
            locked: false
        };
        rerender();
        return true;
    }

    if (action === "save-rotation") {
        if (rotationEditor?.locked) {
            await showAlert(
                "Duplica esta rotativa para cambiar su patrón sin alterar calendarios anteriores.",
                { title: "Patrón protegido", tone: "warning" }
            );
            return true;
        }
        const pattern = editorPattern();
        if (!pattern.length || !rotationEditor.patternApplied) return true;
        const name = await showPrompt(
            "Escribe el nombre con que aparecerá esta rotativa en Perfiles y Calendario mensual.",
            {
                title: rotationEditor.rotationId ? "Guardar rotativa" : "Nombre de la nueva rotativa",
                confirmText: "Guardar",
                value: rotationEditor.name || ""
            }
        );
        if (name === null) return true;
        const cleanName = String(name || "").trim();
        if (!cleanName) return true;
        const duplicate = draft.rotations.some(rotation =>
            rotation.active &&
            rotation.id !== rotationEditor.rotationId &&
            rotation.name.localeCompare(cleanName, "es", { sensitivity: "base" }) === 0
        );
        if (duplicate) {
            await showAlert("Ya existe una rotativa con ese nombre.", {
                title: "Nombre en uso",
                tone: "warning"
            });
            return true;
        }

        if (rotationEditor.rotationId) {
            const rotation = rotationById(rotationEditor.rotationId);
            if (rotation) Object.assign(rotation, {
                name: cleanName,
                pattern: rotation.mode === "businessDays"
                    ? [pattern[0]]
                    : [...pattern]
            });
        } else {
            const id = createCatalogId(cleanName, draft.rotations.map(item => item.id));
            draft.rotations.push({ id, name: cleanName, mode: rotationEditor.mode, pattern: [...pattern], active: true, builtin: false });
        }
        rotationEditor = null;
        dirty();
        rerender();
        return true;
    }

    if (action === "delete-rotation") {
        const rotation = rotationById(button.dataset.rotationId);
        if (!rotation) return true;
        const assigned = assignedProfiles(rotation.id);
        if (assigned.length) {
            await showAlert(
                `No se puede eliminar: está asignada a ${assigned.length} trabajador${assigned.length === 1 ? "" : "es"}.`,
                { title: "Rotativa en uso", tone: "warning" }
            );
            return true;
        }
        const confirmed = await showConfirm(
            `La rotativa ${rotation.name} dejará de aparecer como opción.`,
            { title: "Eliminar rotativa", confirmText: "Eliminar", destructive: true, tone: "danger" }
        );
        if (!confirmed) return true;
        rotation.active = false;
        dirty();
        rerender();
        return true;
    }

    if (action === "new-shift") {
        shiftEditor = { id: "", name: "", turn: TURNO.LARGA, start: "08:00", end: "20:00", fridayEnd: "", nextDay: false, active: true, builtin: false, locked: false };
        rotationEditor = null;
        rerender();
        return true;
    }

    if (action === "edit-shift") {
        const shift = shiftById(button.dataset.shiftId);
        if (shift) shiftEditor = {
            ...clone(shift),
            locked: shiftDefinitionLocked(shift)
        };
        rotationEditor = null;
        rerender();
        return true;
    }

    if (action === "duplicate-shift") {
        const source = shiftById(button.dataset.shiftId);
        if (!source) return true;
        shiftEditor = {
            ...clone(source),
            id: "",
            name: `${source.name} copia`,
            active: true,
            builtin: false,
            locked: false
        };
        rerender();
        return true;
    }

    if (action === "close-shift-editor") {
        shiftEditor = null;
        rerender();
        return true;
    }

    if (action === "save-shift") {
        if (shiftEditor?.locked) {
            await showAlert(
                "Duplica este turno para cambiar su clase u horario sin recalcular meses anteriores.",
                { title: "Turno protegido", tone: "warning" }
            );
            return true;
        }
        const next = readShiftEditor(container);
        if (!next.name) {
            container.querySelector('[data-shift-field="name"]')?.focus();
            return true;
        }
        const duplicate = draft.shifts.some(shift =>
            shift.active &&
            shift.id !== next.id &&
            shift.name.localeCompare(next.name, "es", { sensitivity: "base" }) === 0
        );
        if (duplicate) {
            await showAlert("Ya existe un turno con ese nombre.", {
                title: "Nombre en uso",
                tone: "warning"
            });
            return true;
        }
        if (next.turn !== TURNO.LIBRE && (!next.start || !next.end)) {
            await showAlert("Indica la hora de entrada y salida del turno.", {
                title: "Horario incompleto",
                tone: "warning"
            });
            return true;
        }
        if (next.id) {
            Object.assign(shiftById(next.id), next);
        } else {
            next.id = createCatalogId(next.name, draft.shifts.map(item => item.id));
            draft.shifts.push(next);
        }
        shiftEditor = null;
        dirty();
        rerender();
        return true;
    }

    if (action === "delete-shift") {
        const shift = shiftById(button.dataset.shiftId);
        if (!shift) return true;
        const usedBy = rotationsUsingShift(shift.id);
        if (usedBy.length) {
            await showAlert(
                `No se puede eliminar: lo usan ${usedBy.map(item => item.name).join(", ")}.`,
                { title: "Turno en uso", tone: "warning" }
            );
            return true;
        }
        const confirmed = await showConfirm(
            `El turno ${shift.name} dejará de estar disponible.`,
            { title: "Eliminar turno", confirmText: "Eliminar", destructive: true, tone: "danger" }
        );
        if (!confirmed) return true;
        shift.active = false;
        dirty();
        rerender();
        return true;
    }

    return true;
}

export function handleRotationSettingsChange(event, container, rerender) {
    if (!event.target?.matches?.('[data-shift-field="turn"]') || !shiftEditor || shiftEditor.locked) return false;
    shiftEditor = readShiftEditor(container);
    rerender();
    return true;
}

export function getRotationSettingsDraft() {
    return draft ? normalizeRotationCatalog(draft) : getRotationCatalog();
}
