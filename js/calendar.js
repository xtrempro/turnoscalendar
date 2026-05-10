import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getTurnoBase,
    siguienteTurnoValido
} from "./turnEngine.js";
import {
    calcularHorasMes,
    calcularHorasMesPerfil,
    renderSummaryHTML,
    calcularCarryMes
} from "./hoursEngine.js";
import {
    getProfileData,
    saveProfileData,
    getCarry,
    saveCarry,
    getBlockedDays,
    getAdminDays,
    getLegalDays,
    getAbsences,
    getCompDays,
    getShiftAssigned,
    getCurrentProfile,
    getProfiles,
    getRotativa,
    getTurnChangeConfig,
    isProfileActive,
    profileCanCoverProfile
} from "./storage.js";
import {
    tieneAusencia,
    requiereReemplazoTurnoBase,
    getTurnoExtraAgregado,
    obtenerLabelDia,
    aplicarClasesEspeciales,
    estaBloqueadoModo,
    getTurnoComponentes,
    restarTurnoCubierto,
    turnoDesdeComponentes,
    turnoExtraCubreTurno
} from "./rulesEngine.js";
import { fetchHolidays } from "./holidays.js";
import {
    calcHours,
    isBusinessDay,
    isWeekend
} from "./calculations.js";
import {
    turnoLabel,
    aplicarClaseTurno
} from "./uiEngine.js";
import { renderTimeline } from "./timeline.js";
import {
    deshacerCambioTurno,
    getCambioTurnoRecibido
} from "./swaps.js";
import {
    codeToTurno,
    getAbsenceLabelForProfileDate,
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    buildReplacementRequestWhatsAppUrl,
    cancelReplacementRequest,
    createReplacementRequest,
    createReplacementRequests,
    expireReplacementRequests,
    getPendingReplacementRequestsForShift,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift,
    renderReplacementLogHTML,
    saveReplacement,
    turnoToCode,
    turnoReplacementLabel,
    workerHasAbsence
} from "./replacements.js";
import {
    hasContractForDate,
    isReplacementProfile
} from "./contracts.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import {
    getClockExtraHours,
    hasClockExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";
import {
    getHourReturns,
    hourReturnCalendarLabel
} from "./hourReturns.js";
import { TURNO } from "./constants.js";
import {
    exportLocalSnapshot,
    getJSON,
    replaceLocalSnapshot
} from "./persistence.js";
import { getActiveWorkspace } from "./workspaces.js";
import { listAcceptedLinkedWorkspaces } from "./firebaseLinkedUnits.js";
import {
    readFirebaseWorkspaceState,
    writeFirebaseWorkspaceState
} from "./firebaseWorkspaceState.js";

export let currentDate = new Date();

const CALENDAR_AUDIT_DELAY_MS = 60000;
const calendarAuditTimers = new Map();
const calendarAuditDrafts = new Map();
let linkedReplacementStatus = "";

function key(y, m, d) {
    return `${y}-${m}-${d}`;
}

function scheduleCalendarAuditLog({
    profile,
    keyDay,
    previousTurn,
    nextTurn
}) {
    if (!profile || !keyDay) return;

    const id = `${profile}::${keyDay}`;
    const currentDraft =
        calendarAuditDrafts.get(id);
    const draft = {
        profile,
        keyDay,
        previousTurn: currentDraft
            ? currentDraft.previousTurn
            : previousTurn,
        nextTurn
    };

    calendarAuditDrafts.set(id, draft);

    if (calendarAuditTimers.has(id)) {
        clearTimeout(calendarAuditTimers.get(id));
    }

    calendarAuditTimers.set(
        id,
        setTimeout(() => {
            const finalDraft =
                calendarAuditDrafts.get(id);

            calendarAuditTimers.delete(id);
            calendarAuditDrafts.delete(id);

            if (!finalDraft) return;
            if (
                Number(finalDraft.previousTurn) ===
                Number(finalDraft.nextTurn)
            ) {
                return;
            }

            addAuditLog(
                AUDIT_CATEGORY.CALENDAR,
                "Modifico turno manualmente",
                `${finalDraft.profile}: ${finalDraft.keyDay} paso de ${turnoLabel(finalDraft.previousTurn) || "Libre"} a ${turnoLabel(finalDraft.nextTurn) || "Libre"}.`,
                {
                    profile: finalDraft.profile,
                    keyDay: finalDraft.keyDay,
                    previousTurn: finalDraft.previousTurn,
                    nextTurn: finalDraft.nextTurn,
                    delayed: true
                }
            );
        }, CALENDAR_AUDIT_DELAY_MS)
    );
}

function buildDayCell({
    day,
    month,
    year,
    keyDay,
    label,
    badge,
    title,
    isWeekendDay,
    isHoliday,
    isDraftSelected
}) {
    const div = document.createElement("div");

    div.classList.add("day");
    div.dataset.day = day;
    div.dataset.month = month;
    div.dataset.year = year;

    if (isWeekendDay) {
        div.classList.add("weekend");
    }

    if (isHoliday) {
        div.classList.add("holiday");
    }

    if (isDraftSelected) {
        div.classList.add("draft-selected");
    }

    div.innerHTML = `
        <span class="day-number">${day}</span>
        <span class="day-label-stack">
            <span class="day-label">${label || ""}</span>
            ${badge ? `<span class="day-badge">${badge}</span>` : ""}
        </span>
    `;

    if (title) {
        div.title = title;
    }

    return div;
}

function confirmUndoTurnChange(swap) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");

        backdrop.className = "turn-change-dialog-backdrop";
        backdrop.innerHTML = `
            <div class="turn-change-dialog" role="dialog" aria-modal="true" aria-labelledby="turnChangeDialogTitle">
                <strong id="turnChangeDialogTitle">Cambio de turno aplicado</strong>
                <p>
                    Para modificar el turno de este dia debes deshacer el cambio de turno aplicado.
                </p>
                <div class="turn-change-dialog__meta">
                    ${swap.from} -> ${swap.to}
                </div>
                <div class="turn-change-dialog__actions">
                    <button class="secondary-button" type="button" data-action="cancel">
                        Cancelar
                    </button>
                    <button class="primary-button" type="button" data-action="undo">
                        Deshacer
                    </button>
                </div>
            </div>
        `;

        const close = value => {
            document.removeEventListener("keydown", onKeydown);
            backdrop.remove();
            resolve(value);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                close(false);
            }
        };

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close(false);
            }
        });

        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = () => close(false);

        backdrop
            .querySelector("[data-action='undo']")
            .onclick = () => close(true);

        document.addEventListener("keydown", onKeydown);
        document.body.appendChild(backdrop);

        backdrop
            .querySelector("[data-action='undo']")
            .focus();
    });
}

async function handleTurnChangeDayClick(swap) {
    const shouldUndo =
        await confirmUndoTurnChange(swap);

    if (!shouldUndo) {
        return true;
    }

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState("Deshacer cambio de turno");
    }

    deshacerCambioTurno(swap);
    await renderCalendar();
    refreshStaffingAnalysisPanel();

    return true;
}

function sameRoleProfiles(profileName) {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        profileCanCoverProfile(profile, base)
    );
}

function replacementScopeProfiles(profileName, scope = "compatible") {
    const profiles = getProfiles();
    const base = profiles.find(profile =>
        profile.name === profileName
    );

    if (!base || !isProfileActive(base)) return [];

    return profiles.filter(profile =>
        profile.name !== profileName &&
        isProfileActive(profile) &&
        (
            scope === "all-local" ||
            profileCanCoverProfile(profile, base)
        )
    );
}

function parseSnapshotJSON(snapshot, keyName, fallback) {
    try {
        const raw = snapshot?.[keyName];

        if (raw === undefined || raw === null) return fallback;

        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function remoteProfileMap(snapshot, prefix, profileName) {
    return parseSnapshotJSON(
        snapshot,
        `${prefix}_${profileName}`,
        {}
    );
}

function remoteProfileHasAbsence(snapshot, profileName, keyDay) {
    return tieneAusencia(
        keyDay,
        remoteProfileMap(snapshot, "admin", profileName),
        remoteProfileMap(snapshot, "legal", profileName),
        remoteProfileMap(snapshot, "comp", profileName),
        remoteProfileMap(snapshot, "absences", profileName)
    );
}

function keyToISODate(keyDay) {
    const parts = String(keyDay || "").split("-");

    return `${parts[0]}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${String(Number(parts[2])).padStart(2, "0")}`;
}

function remoteFusionReplacementTurn(snapshot, profileName, keyDay, state) {
    const iso = keyToISODate(keyDay);
    const replacements =
        parseSnapshotJSON(snapshot, "replacements", []);

    return replacements
        .filter(replacement =>
            replacement &&
            !replacement.canceled &&
            replacement.worker === profileName &&
            replacement.date === iso &&
            replacement.addsShift !== false
        )
        .reduce(
            (turno, replacement) =>
                fusionarTurnos(turno, codeToTurno(replacement.turno)),
            Number(state) || TURNO.LIBRE
        );
}

function remoteApplySwaps(snapshot, profileName, keyDay, state) {
    const iso = keyToISODate(keyDay);
    const swaps = parseSnapshotJSON(snapshot, "swaps", []);
    let turno = Number(state) || TURNO.LIBRE;

    swaps.forEach(swap => {
        if (
            !swap ||
            swap.canceled ||
            swap.anulado ||
            swap.status === "canceled" ||
            swap.status === "anulado"
        ) {
            return;
        }

        if (!swap.skipFecha && swap.fecha === iso) {
            if (swap.from === profileName) {
                turno = TURNO.LIBRE;
            }

            if (swap.to === profileName) {
                turno = fusionarTurnos(
                    turno,
                    codeToTurno(swap.turno)
                );
            }
        }

        if (!swap.skipDevolucion && swap.devolucion === iso) {
            if (swap.to === profileName) {
                const devuelve = codeToTurno(swap.turnoDevuelto);

                if (turno === devuelve) {
                    turno = TURNO.LIBRE;
                } else if (
                    turno === TURNO.TURNO24 &&
                    devuelve === TURNO.LARGA
                ) {
                    turno = TURNO.NOCHE;
                } else if (
                    turno === TURNO.TURNO24 &&
                    devuelve === TURNO.NOCHE
                ) {
                    turno = TURNO.LARGA;
                } else {
                    turno = TURNO.LIBRE;
                }
            }

            if (swap.from === profileName) {
                turno = fusionarTurnos(
                    turno,
                    codeToTurno(swap.turnoDevuelto)
                );
            }
        }
    });

    return turno;
}

function remoteActualState(snapshot, profileName, keyDay) {
    const data = remoteProfileMap(snapshot, "data", profileName);
    const baseState = Number(data[keyDay]) || TURNO.LIBRE;
    const withSwaps = remoteApplySwaps(
        snapshot,
        profileName,
        keyDay,
        baseState
    );

    return remoteFusionReplacementTurn(
        snapshot,
        profileName,
        keyDay,
        withSwaps
    );
}

function remoteTurnChangeConfig(snapshot) {
    const config = parseSnapshotJSON(
        snapshot,
        "turnChangeConfig",
        {}
    );

    return {
        allowTwentyFourHourShifts:
            config.allowTwentyFourHourShifts !== false
    };
}

function combinedTurnChangeConfig(remoteConfig) {
    const localConfig = getTurnChangeConfig();

    return {
        allowTwentyFourHourShifts:
            localConfig.allowTwentyFourHourShifts !== false &&
            remoteConfig.allowTwentyFourHourShifts !== false
    };
}

function isLongNightCombination(currentState, neededTurn) {
    return (
        (
            currentState === TURNO.LARGA &&
            neededTurn === TURNO.NOCHE
        ) ||
        (
            currentState === TURNO.NOCHE &&
            neededTurn === TURNO.LARGA
        )
    );
}

function canCoverLinkedShift(currentState, neededTurn, config) {
    if (!neededTurn) return false;

    if (currentState === TURNO.LIBRE) return true;

    return (
        isLongNightCombination(currentState, neededTurn) &&
        config.allowTwentyFourHourShifts !== false
    );
}

function remoteMonthlyStats(
    snapshot,
    profiles,
    y,
    m,
    days,
    holidays
) {
    const localSnapshot = exportLocalSnapshot();
    const statsByProfile = new Map();

    replaceLocalSnapshot(snapshot, { silent: true });

    try {
        profiles.forEach(profile => {
            const stats = calcularHorasMesPerfil(
                profile.name,
                y,
                m,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );

            statsByProfile.set(profile.name, stats);
        });
    } finally {
        replaceLocalSnapshot(localSnapshot, { silent: true });
    }

    return statsByProfile;
}

async function linkedWorkspaceCandidates(
    profileName,
    keyDay,
    neededTurn,
    monthContext = {}
) {
    linkedReplacementStatus = "";

    const activeWorkspace = getActiveWorkspace();

    if (!activeWorkspace?.id) {
        linkedReplacementStatus =
            "Selecciona un entorno Firebase activo para buscar en unidades enlazadas.";
        return [];
    }

    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );

    if (!baseProfile) {
        linkedReplacementStatus =
            "No se encontro el perfil que requiere reemplazo.";
        return [];
    }

    const linkedWorkspaces =
        await listAcceptedLinkedWorkspaces(activeWorkspace);
    const candidates = [];
    const y = monthContext.y;
    const m = monthContext.m;
    const days = monthContext.days;
    const holidays = monthContext.holidays || {};
    const diagnostics = {
        readErrors: [],
        emptySnapshots: [],
        totalProfiles: 0,
        compatibleProfiles: 0,
        availableProfiles: 0
    };

    if (!linkedWorkspaces.length) {
        linkedReplacementStatus =
            "No hay unidades enlazadas aceptadas para este entorno.";
        return [];
    }

    for (const workspace of linkedWorkspaces) {
        let snapshot = null;

        try {
            snapshot = await readFirebaseWorkspaceState(workspace.id);
        } catch (error) {
            console.warn(
                "No se pudo leer unidad enlazada.",
                workspace.id,
                error
            );
            diagnostics.readErrors.push(
                workspace.name || workspace.id
            );
            continue;
        }

        if (!snapshot) {
            diagnostics.emptySnapshots.push(
                workspace.name || workspace.id
            );
            continue;
        }

        const allProfiles =
            parseSnapshotJSON(snapshot, "profiles", []);
        const profiles = allProfiles
            .filter(profile =>
                profile &&
                profile.active !== false &&
                profileCanCoverProfile(profile, baseProfile)
            );

        diagnostics.totalProfiles += allProfiles.filter(profile =>
            profile && profile.active !== false
        ).length;
        diagnostics.compatibleProfiles += profiles.length;

        const remoteConfig = remoteTurnChangeConfig(snapshot);
        const coverConfig = combinedTurnChangeConfig(remoteConfig);
        const statsByProfile = remoteMonthlyStats(
            snapshot,
            profiles,
            y,
            m,
            days,
            holidays
        );

        profiles.forEach(profile => {
            const currentState = remoteActualState(
                snapshot,
                profile.name,
                keyDay
            );

            if (
                remoteProfileHasAbsence(
                    snapshot,
                    profile.name,
                    keyDay
                ) ||
                !canCoverLinkedShift(
                    currentState,
                    neededTurn,
                    coverConfig
                )
            ) {
                return;
            }

            const stats = statsByProfile.get(profile.name) || {};
            const hheeDiurnas = Number(stats.hheeDiurnas) || 0;
            const hheeNocturnas = Number(stats.hheeNocturnas) || 0;

            diagnostics.availableProfiles++;

            candidates.push({
                profile,
                currentState,
                isFree: currentState === TURNO.LIBRE,
                isForced: false,
                isLinked: true,
                workspaceId: workspace.id,
                workspaceName: workspace.name || workspace.id,
                hheeDiurnas,
                hheeNocturnas,
                hhee: hheeDiurnas + hheeNocturnas
            });
        });
    }

    if (!candidates.length) {
        if (diagnostics.readErrors.length) {
            linkedReplacementStatus =
                `No se pudo leer la unidad enlazada ${diagnostics.readErrors.join(", ")}. Revisa que firebase.rules este publicado y que el enlace siga activo.`;
        } else if (diagnostics.emptySnapshots.length) {
            linkedReplacementStatus =
                `La unidad enlazada ${diagnostics.emptySnapshots.join(", ")} aun no tiene datos vivos sincronizados. Abre esa unidad y espera que Firebase suba el estado.`;
        } else if (!diagnostics.totalProfiles) {
            linkedReplacementStatus =
                "La unidad enlazada no tiene colaboradores activos sincronizados.";
        } else if (!diagnostics.compatibleProfiles) {
            linkedReplacementStatus =
                "Hay unidades enlazadas, pero no se encontraron trabajadores activos con la misma profesion/estamento requerido.";
        } else {
            linkedReplacementStatus =
                "Hay trabajadores compatibles en unidades enlazadas, pero todos tienen ausencia, permiso o turno incompatible ese dia.";
        }
    }

    return candidates.sort((a, b) =>
        a.workspaceName.localeCompare(b.workspaceName) ||
        a.profile.name.localeCompare(b.profile.name)
    );
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function refreshStaffingAnalysisPanel() {
    if (typeof window.renderStaffingAnalysis === "function") {
        window.renderStaffingAnalysis();
    }
}

function candidateMeta(profile) {
    const profession = profile.profession &&
        profile.profession !== "Sin informacion"
        ? ` | ${profile.profession}`
        : "";

    return `${profile.estamento || "Sin estamento"}${profession}`;
}

function formatCandidateHours(value) {
    const hours = Math.round((Number(value) || 0) * 2) / 2;

    return Number.isInteger(hours)
        ? String(hours)
        : String(hours).replace(".", ",");
}

function getActualState(profileName, keyDay) {
    const data = getProfileData(profileName);

    return aplicarCambiosTurno(
        profileName,
        keyDay,
        Number(data[keyDay]) || 0
    );
}

function isHalfAdminValue(value) {
    return (
        value === "0.5M" ||
        value === "0.5T" ||
        value === 0.5
    );
}

function getHalfAdminCoverageTurn(profileName, keyDay) {
    if (
        !getShiftAssigned(profileName) ||
        getRotativa(profileName).type === "diurno"
    ) {
        return TURNO.LIBRE;
    }

    const admin = getJSON(`admin_${profileName}`, {});

    if (admin[keyDay] === "0.5M") {
        return TURNO.MEDIA_MANANA;
    }

    if (admin[keyDay] === "0.5T") {
        return TURNO.MEDIA_TARDE;
    }

    return TURNO.LIBRE;
}

function getReplacementNeededTurn(profileName, keyDay) {
    const admin = getJSON(`admin_${profileName}`, {});

    if (isHalfAdminValue(admin[keyDay])) {
        return getHalfAdminCoverageTurn(profileName, keyDay);
    }

    return getTurnoBase(profileName, keyDay);
}

function canCoverShift(
    currentState,
    neededTurn,
    config = getTurnChangeConfig()
) {
    if (!neededTurn) return false;

    const merged = fusionarTurnos(
        currentState,
        neededTurn
    );

    if (merged === currentState) return false;

    if (
        merged === TURNO.TURNO24 &&
        config.allowTwentyFourHourShifts === false
    ) {
        return false;
    }

    return true;
}

function getPendingManualExtraTurn(
    profileName,
    keyDay,
    profileData
) {
    const baseWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        getTurnoBase(profileName, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profileName,
        keyDay,
        Number(profileData[keyDay]) || 0,
        { includeReplacements: false }
    );
    const extraTurn = getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(profileName, keyDay)
    );
}

async function getReplacementCandidates(
    profileName,
    keyDay,
    options = {}
) {
    const date = new Date(
        Number(keyDay.split("-")[0]),
        Number(keyDay.split("-")[1]),
        Number(keyDay.split("-")[2])
    );
    const y = date.getFullYear();
    const m = date.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const holidays = await fetchHolidays(y);
    const neededTurn =
        options.neededTurn ||
        getReplacementNeededTurn(profileName, keyDay);
    const baseProfile = getProfiles().find(profile =>
        profile.name === profileName
    );
    const scope = options.scope || "compatible";

    if (scope === "linked") {
        return linkedWorkspaceCandidates(
            profileName,
            keyDay,
            neededTurn,
            {
                y,
                m,
                days,
                holidays
            }
        );
    }

    return replacementScopeProfiles(profileName, scope)
        .map(profile => {
            const currentState =
                getActualState(profile.name, keyDay);
            const stats = calcularHorasMesPerfil(
                profile.name,
                y,
                m,
                days,
                holidays,
                getProfileData(profile.name),
                {},
                { d: 0, n: 0 }
            );
            const hheeDiurnas = Number(stats.hheeDiurnas) || 0;
            const hheeNocturnas = Number(stats.hheeNocturnas) || 0;

            return {
                profile,
                currentState,
                isFree: currentState === 0,
                isForced:
                    !profileCanCoverProfile(profile, baseProfile),
                hheeDiurnas,
                hheeNocturnas,
                hhee: hheeDiurnas + hheeNocturnas
            };
        })
        .filter(candidate =>
            !workerHasAbsence(candidate.profile.name, keyDay) &&
            canCoverShift(candidate.currentState, neededTurn)
        )
        .sort((a, b) => {
            if (a.isFree !== b.isFree) {
                return a.isFree ? -1 : 1;
            }

            if (a.hhee !== b.hhee) {
                return a.hhee - b.hhee;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function replacementDialogHTML({
    profileName,
    keyDay,
    neededTurn,
    absenceType,
    candidates,
    scope,
    requestMode,
    pendingRequests,
    selectedRequestWorkers,
    linkedStatus = ""
}) {
    const forceMode = scope === "all-local";
    const linkedMode = scope === "linked";
    const pendingByWorker = new Map(
        (pendingRequests || []).map(request => [request.worker, request])
    );
    const selectedWorkers =
        selectedRequestWorkers || new Set();
    const availableWorkers = candidates
        .filter(candidate => !pendingByWorker.get(candidate.profile.name))
        .map(candidate => candidate.profile.name);
    const selectedCount = availableWorkers.filter(worker =>
        selectedWorkers.has(worker)
    ).length;
    const allSelected =
        Boolean(availableWorkers.length) &&
        selectedCount === availableWorkers.length;
    const items = candidates.length
        ? candidates.map(candidate => {
            const pendingRequest =
                pendingByWorker.get(candidate.profile.name);
            const checked =
                selectedWorkers.has(candidate.profile.name);

            if (requestMode) {
                return `
                <label class="replacement-candidate replacement-candidate--request ${candidate.isForced ? "replacement-candidate--forced" : ""} ${pendingRequest ? "is-disabled" : ""}">
                    <input
                        class="replacement-candidate-checkbox"
                        type="checkbox"
                        data-request-worker="${escapeHTML(candidate.profile.name)}"
                        ${checked ? "checked" : ""}
                        ${pendingRequest ? "disabled" : ""}
                    >
                    <span>
                        <strong>${escapeHTML(candidate.profile.name)}</strong>
                        <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                        ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                        <small>${pendingRequest ? "Solicitud pendiente" : candidate.isFree ? "Libre ese dia" : `Turno actual: ${escapeHTML(turnoReplacementLabel(candidate.currentState))}`}</small>
                    </span>
                    <span>
                        ${pendingRequest ? "<em>Pendiente</em>" : ""}
                        ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                        ${candidate.isForced ? "<em>Forzado</em>" : ""}
                        <b>${formatCandidateHours(candidate.hhee)} HHEE</b>
                        <small class="replacement-candidate-hours">
                            D: ${formatCandidateHours(candidate.hheeDiurnas)}h · N: ${formatCandidateHours(candidate.hheeNocturnas)}h
                        </small>
                    </span>
                </label>
                `;
            }

            return `
            <button
                class="replacement-candidate ${candidate.isForced ? "replacement-candidate--forced" : ""} ${candidate.isLinked ? "replacement-candidate--linked" : ""} ${pendingRequest ? "is-disabled" : ""}"
                type="button"
                data-worker="${escapeHTML(candidate.profile.name)}"
                data-worker-workspace-id="${escapeHTML(candidate.workspaceId || "")}"
                data-worker-workspace-name="${escapeHTML(candidate.workspaceName || "")}"
                ${pendingRequest ? "disabled" : ""}
            >
                <span>
                    <strong>${escapeHTML(candidate.profile.name)}</strong>
                    <small>${escapeHTML(candidateMeta(candidate.profile))}</small>
                    ${candidate.isLinked ? `<small>Unidad: ${escapeHTML(candidate.workspaceName)}</small>` : ""}
                    <small>${pendingRequest ? "Solicitud pendiente" : candidate.isFree ? "Libre ese dia" : `Turno actual: ${escapeHTML(turnoReplacementLabel(candidate.currentState))}`}</small>
                </span>
                <span>
                    ${pendingRequest ? "<em>Pendiente</em>" : ""}
                    ${candidate.isLinked ? "<em>Unidad enlazada</em>" : ""}
                    ${candidate.isForced ? "<em>Forzado</em>" : ""}
                    <b>${formatCandidateHours(candidate.hhee)} HHEE</b>
                    <small class="replacement-candidate-hours">
                        D: ${formatCandidateHours(candidate.hheeDiurnas)}h · N: ${formatCandidateHours(candidate.hheeNocturnas)}h
                    </small>
                </span>
            </button>
            `;
        }).join("")
        : `
            <div class="empty-state empty-state--compact">
                ${escapeHTML(
                    linkedMode && linkedStatus
                        ? linkedStatus
                        : "No hay trabajadores disponibles para este reemplazo."
                )}
            </div>
        `;
    const pendingList = (pendingRequests || []).length
        ? `
            <div class="replacement-request-list">
                ${(pendingRequests || []).map(request => `
                    <article class="replacement-request-item">
                        <span>
                            <strong>${escapeHTML(request.worker)}</strong>
                            <small>Caduca: ${escapeHTML(new Date(request.expiresAt).toLocaleString("es-CL"))}</small>
                        </span>
                        <button class="ghost-button" type="button" data-cancel-request="${escapeHTML(request.id)}">
                            Anular
                        </button>
                    </article>
                `).join("")}
            </div>
        `
        : "";
    const bulkActions = requestMode
        ? `
            <div class="replacement-bulk-actions">
                <label>
                    <input type="checkbox" data-action="select-all-requests" ${allSelected ? "checked" : ""} ${availableWorkers.length ? "" : "disabled"}>
                    <span>Enviar solicitud a todos</span>
                </label>
                <button class="primary-button" type="button" data-action="send-selected-requests" ${selectedCount ? "" : "disabled"}>
                    Enviar a seleccionados (${selectedCount})
                </button>
            </div>
        `
        : "";

    return `
        <div class="turn-change-dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacementDialogTitle">
            <strong id="replacementDialogTitle">Seleccionar reemplazo</strong>
            <p>
                ${escapeHTML(profileName)} requiere cobertura para ${escapeHTML(turnoReplacementLabel(neededTurn))}
                por ${escapeHTML(absenceType)}.
            </p>
            <div class="replacement-dialog-toolbar">
                <button class="secondary-button" type="button" data-action="toggle-force">
                    ${forceMode
                        ? "Volver a profesiones/estamentos compatibles"
                        : "Mostrar personal de otras profesiones y/o estamentos"
                    }
                </button>
                <button class="ghost-button" type="button" data-action="linked-units">
                    ${linkedMode
                        ? "Volver a personal de esta unidad"
                        : "Buscar sugerencias en unidades enlazadas"
                    }
                </button>
            </div>
            ${linkedMode ? `
                <div class="replacement-dialog-note">
                    Sugerencias de unidades enlazadas activas: se muestran trabajadores compatibles y disponibles segun su unidad. Al asignar, se registra como prestamo en ambos entornos.
                </div>
            ` : `
            <label class="replacement-request-toggle">
                <input type="checkbox" data-action="request-mode" ${requestMode ? "checked" : ""}>
                <span>
                    <strong>Solicitar aceptacion al trabajador</strong>
                    <small>
                        En vez de asignar el turno de inmediato, crea una solicitud
                        para la app movil o WhatsApp.
                    </small>
                </span>
            </label>
            `}
            ${bulkActions}
            ${pendingList}
            ${forceMode ? `
                <div class="replacement-dialog-note">
                    Modo forzado activo: se muestran trabajadores disponibles aunque no coincidan por profesion o estamento.
                </div>
            ` : ""}
            <div class="replacement-candidate-list">
                ${items}
            </div>
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

async function openReplacementDialog(profileName, keyDay) {
    const existing = getReplacementForCoveredShift(
        profileName,
        keyDay
    );

    if (existing || window.selectionMode) {
        return;
    }

    const neededTurn = getReplacementNeededTurn(
        profileName,
        keyDay
    );

    if (!neededTurn) {
        return;
    }

    const absenceType =
        getAbsenceLabelForProfileDate(profileName, keyDay);
    let scope = "compatible";
    let requestMode = false;
    let selectedRequestWorkers = new Set();
    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";

    const saveLinkedUnitReplacement = async button => {
        const workerWorkspaceId =
            button.dataset.workerWorkspaceId || "";
        const workerWorkspaceName =
            button.dataset.workerWorkspaceName || "";
        const worker = button.dataset.worker || "";
        const activeWorkspace = getActiveWorkspace();

        if (!workerWorkspaceId || !worker) {
            throw new Error(
                "No se pudo identificar la unidad enlazada del trabajador."
            );
        }

        const remoteReplacementId =
            `loan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const remoteSnapshot =
            await readFirebaseWorkspaceState(workerWorkspaceId);

        if (!remoteSnapshot) {
            throw new Error(
                "La unidad enlazada aun no tiene datos vivos disponibles en Firebase."
            );
        }

        const date = new Date(
            Number(keyDay.split("-")[0]),
            Number(keyDay.split("-")[1]),
            Number(keyDay.split("-")[2])
        );
        const replacements =
            parseSnapshotJSON(remoteSnapshot, "replacements", []);

        replacements.push({
            id: remoteReplacementId,
            worker,
            replaced: profileName,
            reason: "",
            source: "linked_unit_loan",
            addsShift: true,
            date: keyToISODate(keyDay),
            turno: turnoToCode(neededTurn),
            isLoan: true,
            workerWorkspaceId,
            workerWorkspaceName,
            hostWorkspaceId: activeWorkspace?.id || "",
            hostWorkspaceName: activeWorkspace?.name || "",
            absenceType,
            year: date.getFullYear(),
            month: date.getMonth(),
            createdAt: new Date().toISOString(),
            canceled: false
        });

        remoteSnapshot.replacements =
            JSON.stringify(replacements);

        await writeFirebaseWorkspaceState(
            workerWorkspaceId,
            remoteSnapshot
        );

        saveReplacement({
            worker,
            replaced: profileName,
            keyDay,
            turno: neededTurn,
            absenceType,
            source: "linked_unit_loan",
            isLoan: true,
            workerWorkspaceId,
            workerWorkspaceName,
            hostWorkspaceId: activeWorkspace?.id || "",
            hostWorkspaceName: activeWorkspace?.name || "",
            remoteReplacementId
        });
    };

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    const bindActions = () => {
        backdrop
            .querySelector("[data-action='cancel']")
            .onclick = close;

        backdrop
            .querySelector("[data-action='toggle-force']")
            .onclick = async () => {
                scope = scope === "all-local"
                    ? "compatible"
                    : "all-local";
                await renderContent();
            };

        backdrop
            .querySelector("[data-action='linked-units']")
            .onclick = async () => {
                scope = scope === "linked"
                    ? "compatible"
                    : "linked";
                requestMode = false;
                selectedRequestWorkers = new Set();
                await renderContent();
            };

        const requestToggle =
            backdrop.querySelector("[data-action='request-mode']");
        if (requestToggle) {
            requestToggle.onchange = async () => {
                requestMode = requestToggle.checked;
                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        const updateBulkControls = () => {
            const inputs = [
                ...backdrop.querySelectorAll("[data-request-worker]")
            ];
            const availableInputs = inputs.filter(input =>
                !input.disabled
            );
            const selectedCount = availableInputs.filter(input =>
                input.checked
            ).length;
            const selectAll =
                backdrop.querySelector("[data-action='select-all-requests']");
            const sendButton =
                backdrop.querySelector("[data-action='send-selected-requests']");

            if (selectAll) {
                selectAll.checked =
                    Boolean(availableInputs.length) &&
                    selectedCount === availableInputs.length;
            }

            if (sendButton) {
                sendButton.disabled = selectedCount === 0;
                sendButton.textContent =
                    `Enviar a seleccionados (${selectedCount})`;
            }
        };

        backdrop
            .querySelectorAll("[data-request-worker]")
            .forEach(input => {
                input.onchange = () => {
                    if (input.checked) {
                        selectedRequestWorkers.add(
                            input.dataset.requestWorker
                        );
                    } else {
                        selectedRequestWorkers.delete(
                            input.dataset.requestWorker
                        );
                    }

                    updateBulkControls();
                };
            });

        const selectAllRequests =
            backdrop.querySelector("[data-action='select-all-requests']");
        if (selectAllRequests) {
            selectAllRequests.onchange = () => {
                backdrop
                    .querySelectorAll("[data-request-worker]")
                    .forEach(input => {
                        if (input.disabled) return;

                        input.checked = selectAllRequests.checked;

                        if (input.checked) {
                            selectedRequestWorkers.add(
                                input.dataset.requestWorker
                            );
                        } else {
                            selectedRequestWorkers.delete(
                                input.dataset.requestWorker
                            );
                        }
                    });

                updateBulkControls();
            };
        }

        const sendSelectedRequests =
            backdrop.querySelector("[data-action='send-selected-requests']");
        if (sendSelectedRequests) {
            sendSelectedRequests.onclick = async () => {
                const workers = [...selectedRequestWorkers];

                if (!workers.length) {
                    alert("Selecciona al menos un trabajador para enviar la solicitud.");
                    return;
                }

                if (typeof window.pushUndoState === "function") {
                    window.pushUndoState("Crear solicitud masiva de reemplazo");
                }

                const requests = createReplacementRequests(
                    {
                        replaced: profileName,
                        keyDay,
                        turno: neededTurn,
                        absenceType,
                        scope,
                        source: scope === "all-local"
                            ? "forced_replacement_request"
                            : "replacement_request"
                    },
                    workers
                );
                const whatsappRequests = requests.filter(request =>
                    request.channel === "whatsapp"
                );
                const missingPhones = whatsappRequests.filter(request =>
                    !buildReplacementRequestWhatsAppUrl(request)
                );

                whatsappRequests
                    .map(buildReplacementRequestWhatsAppUrl)
                    .filter(Boolean)
                    .forEach(url => {
                        window.open(url, "_blank", "noopener");
                    });

                if (missingPhones.length) {
                    alert(
                        `${missingPhones.length} solicitud(es) quedaron pendientes, pero sin celular registrado para preparar WhatsApp.`
                    );
                }

                selectedRequestWorkers = new Set();
                await renderContent();
            };
        }

        backdrop
            .querySelectorAll("[data-cancel-request]")
            .forEach(button => {
                button.onclick = async () => {
                    cancelReplacementRequest(
                        button.dataset.cancelRequest,
                        "admin"
                    );
                    await renderContent();
                };
            });

        backdrop
            .querySelectorAll("[data-worker]")
            .forEach(button => {
                button.onclick = async () => {
                    if (button.disabled) return;

                    if (typeof window.pushUndoState === "function") {
                        window.pushUndoState(
                            requestMode
                                ? "Crear solicitud de reemplazo"
                                : "Asignar reemplazo"
                        );
                    }

                    if (requestMode) {
                        const request = createReplacementRequest({
                            worker: button.dataset.worker,
                            replaced: profileName,
                            keyDay,
                            turno: neededTurn,
                            absenceType,
                            scope,
                            source: scope === "all-local"
                                ? "forced_replacement_request"
                                : "replacement_request"
                        });
                        const whatsappUrl =
                            buildReplacementRequestWhatsAppUrl(request);

                        if (request.channel === "whatsapp") {
                            if (whatsappUrl) {
                                window.open(
                                    whatsappUrl,
                                    "_blank",
                                    "noopener"
                                );
                            } else {
                                alert(
                                    "La solicitud quedo pendiente, pero este trabajador no tiene celular registrado para preparar el WhatsApp."
                                );
                            }
                        }

                        await renderContent();
                        return;
                    }

                    if (button.dataset.workerWorkspaceId) {
                        await saveLinkedUnitReplacement(button);
                    } else {
                        saveReplacement({
                            worker: button.dataset.worker,
                            replaced: profileName,
                            keyDay,
                            turno: neededTurn,
                            absenceType,
                            source: scope === "all-local"
                                ? "forced_replacement"
                                : "replacement"
                        });
                    }

                    close();
                    await renderCalendar();
                    refreshStaffingAnalysisPanel();
                };
            });
    };

    const renderContent = async () => {
        expireReplacementRequests();

        const candidates =
            await getReplacementCandidates(
                profileName,
                keyDay,
                { scope }
            );
        const pendingRequests =
            getPendingReplacementRequestsForShift(
                profileName,
                keyDay,
                neededTurn
            );
        const pendingWorkers = new Set(
            pendingRequests.map(request => request.worker)
        );
        const selectableWorkers = new Set(
            candidates
                .map(candidate => candidate.profile.name)
                .filter(worker => !pendingWorkers.has(worker))
        );

        selectedRequestWorkers = new Set(
            [...selectedRequestWorkers].filter(worker =>
                selectableWorkers.has(worker)
            )
        );

        backdrop.innerHTML = replacementDialogHTML({
            profileName,
            keyDay,
            neededTurn,
            absenceType,
            candidates,
            scope,
            requestMode,
            pendingRequests,
            selectedRequestWorkers,
            linkedStatus: scope === "linked"
                ? linkedReplacementStatus
                : ""
        });

        bindActions();

        (
            backdrop.querySelector(".replacement-candidate") ||
            backdrop.querySelector("[data-action='cancel']")
        )?.focus();
    };

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    await renderContent();
}

window.openReplacementDialog = openReplacementDialog;

function getExtraReasonMatches(
    profileName,
    keyDay,
    pendingTurn
) {
    return sameRoleProfiles(profileName)
        .map(profile => {
            const coveredTurn = getReplacementNeededTurn(
                profile.name,
                keyDay
            );

            return {
                profile,
                coveredTurn,
                absenceType:
                    getAbsenceLabelForProfileDate(
                        profile.name,
                        keyDay
                    ),
                exactMatch:
                    Number(coveredTurn) === Number(pendingTurn)
            };
        })
        .filter(match =>
            workerHasAbsence(match.profile.name, keyDay) &&
            !getReplacementForCoveredShift(
                match.profile.name,
                keyDay
            ) &&
            turnoExtraCubreTurno(
                pendingTurn,
                match.coveredTurn
            )
        )
        .sort((a, b) => {
            if (a.exactMatch !== b.exactMatch) {
                return a.exactMatch ? -1 : 1;
            }

            return a.profile.name.localeCompare(b.profile.name);
        });
}

function getManualBackupSections(pendingTurn, matchesByTurn) {
    return getTurnoComponentes(pendingTurn)
        .map(component => {
            const turn = turnoDesdeComponentes([component]);

            return {
                id: component,
                turn,
                label: turnoReplacementLabel(turn),
                matches: matchesByTurn.get(turn) || []
            };
        })
        .filter(section => section.turn);
}

function formatClockHoursForDialog(hours) {
    const d = Math.round((Number(hours?.d) || 0) * 2) / 2;
    const n = Math.round((Number(hours?.n) || 0) * 2) / 2;
    const parts = [];

    if (d) parts.push(`${d}h diurnas`);
    if (n) parts.push(`${n}h nocturnas`);

    return parts.length ? parts.join(" / ") : "0h";
}

function extraReasonDialogHTML({
    profileName,
    pendingTurn,
    manualSections,
    clockHours,
    hasClockSection
}) {
    const hasManualSection = Boolean(pendingTurn);
    const hasMultipleManualSections =
        (manualSections || []).length > 1;
    const savesMultipleBackups =
        hasMultipleManualSections ||
        (hasClockSection && hasManualSection);
    const manualItems = (manualSections || [])
        .map(section => {
            const items = section.matches.length
                ? section.matches.map((match, index) => `
                    <button
                        class="replacement-candidate"
                        type="button"
                        data-section-id="${section.id}"
                        data-match-index="${index}"
                    >
                        <span>
                            <strong>${match.profile.name}</strong>
                            <small>${match.absenceType} | ${turnoReplacementLabel(match.coveredTurn)}</small>
                        </span>
                        <span>${match.exactMatch ? "Coincide" : "Parcial"}</span>
                    </button>
                `).join("")
                : `
                    <div class="empty-state empty-state--compact">
                        No hay vacaciones o licencias compatibles con este tramo.
                    </div>
                `;

            return `
                <div class="overtime-backup-subsection" data-manual-section="${section.id}">
                    <div class="overtime-backup-subsection__head">
                        <span>${section.label}</span>
                    </div>
                    <div class="replacement-candidate-list">
                        ${items}
                    </div>
                    <label class="extra-reason-field">
                        <span>Motivo manual para ${section.label}</span>
                        <textarea rows="3" data-manual-reason="${section.id}" placeholder="Ej: Campana de Invierno, Estacion de Trabajo"></textarea>
                    </label>
                </div>
            `;
        })
        .join("");
    const clockSection = hasClockSection
        ? `
            <section class="overtime-backup-section" data-section="clock">
                <div class="overtime-backup-section__head">
                    <span>Horas por marcaje modificado</span>
                    <small>${formatClockHoursForDialog(clockHours)}</small>
                </div>
                <p>
                    Respalda las horas extras generadas por modificar la entrada
                    o salida del turno.
                </p>
                <label class="extra-reason-field">
                    <span>Motivo del marcaje</span>
                    <textarea rows="3" data-clock-reason placeholder="Ej: Apoyo previo al turno, continuidad de atencion, emergencia del servicio"></textarea>
                </label>
            </section>
        `
        : "";
    const manualSection = hasManualSection
        ? `
            <section class="overtime-backup-section" data-section="manual">
                <div class="overtime-backup-section__head">
                    <span>Turno extra agregado</span>
                    <small>${turnoReplacementLabel(pendingTurn)}</small>
                </div>
                <p>
                    Puedes asociar cada tramo a una ausencia compatible o escribir
                    un motivo manual por separado.
                </p>
                ${manualItems}
            </section>
        `
        : "";

    return `
        <div class="turn-change-dialog replacement-dialog extra-reason-dialog overtime-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="extraReasonDialogTitle">
            <strong id="extraReasonDialogTitle">Respaldar horas extras</strong>
            <p>
                ${profileName} tiene horas extras pendientes de respaldo.
                Completa ${savesMultipleBackups ? "las secciones" : "el motivo"} para validar el pago.
            </p>
            ${clockSection}
            ${manualSection}
            <div class="turn-change-dialog__actions">
                <button class="secondary-button" type="button" data-action="cancel">
                    Cancelar
                </button>
                <button class="primary-button" type="button" data-action="save-reason">
                    ${savesMultipleBackups ? "Guardar respaldos" : "Guardar motivo"}
                </button>
            </div>
        </div>
    `;
}

async function openExtraReasonDialog(
    profileName,
    keyDay,
    pendingTurn,
    options = {}
) {
    if ((!pendingTurn && !options.forceClock) || window.selectionMode) {
        return;
    }

    const profileData = getProfileData(profileName);
    const actualState = options.state ||
        aplicarCambiosTurno(
            profileName,
            keyDay,
            Number(profileData[keyDay]) || 0
        );
    const [year, month, day] = String(keyDay)
        .split("-")
        .map(Number);
    const date = new Date(year, month, day);
    const holidays = await fetchHolidays(year);
    const hasClockSection =
        hasClockExtra(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        ) &&
        !getClockExtraBackupForWorker(profileName, keyDay);
    const clockHours = hasClockSection
        ? getClockExtraHours(
            profileName,
            keyDay,
            date,
            actualState,
            holidays
        )
        : null;

    if (!pendingTurn && !hasClockSection) {
        return;
    }

    const matchesByTurn = new Map();
    const manualSections = pendingTurn
        ? getManualBackupSections(pendingTurn, matchesByTurn)
        : [];

    if (pendingTurn) {
        manualSections.forEach(section => {
            const matches = getExtraReasonMatches(
                profileName,
                keyDay,
                section.turn
            );

            matchesByTurn.set(section.turn, matches);
            section.matches = matches;
        });
    }

    const backdrop = document.createElement("div");
    const selectedMatches = new Map();

    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = extraReasonDialogHTML({
        profileName,
        pendingTurn,
        manualSections,
        clockHours,
        hasClockSection
    });

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };

    const onKeydown = event => {
        if (event.key === "Escape") {
            close();
        }
    };

    const saveBackups = async () => {
        const clockReason = backdrop
            .querySelector("[data-clock-reason]")
            ?.value
            .trim() || "";
        const manualBackups = manualSections.map(section => {
            const selectedIndex = selectedMatches.get(section.id);
            const selectedMatch = selectedIndex !== undefined
                ? section.matches[selectedIndex]
                : null;
            const reason = backdrop
                .querySelector(`[data-manual-reason="${section.id}"]`)
                ?.value
                .trim() || "";

            return {
                section,
                selectedMatch,
                reason
            };
        });
        const missingManualBackup = manualBackups.find(backup =>
            !backup.selectedMatch && !backup.reason
        );

        if (hasClockSection && !clockReason) {
            alert("Indica el motivo de las horas extras generadas por el marcaje.");
            backdrop.querySelector("[data-clock-reason]")?.focus();
            return;
        }

        if (pendingTurn && missingManualBackup) {
            alert(`Selecciona una ausencia compatible o escribe el motivo del turno ${missingManualBackup.section.label}.`);
            backdrop
                .querySelector(`[data-manual-reason="${missingManualBackup.section.id}"]`)
                ?.focus();
            return;
        }

        if (typeof window.pushUndoState === "function") {
            window.pushUndoState("Respaldar horas extras");
        }

        if (hasClockSection) {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: actualState,
                reason: clockReason,
                absenceType: "Marcaje reloj control",
                source: "clock_extra",
                addsShift: false,
                clockLabel: "Marcaje reloj control",
                clockHours
            });
        }

        manualBackups.forEach(backup => {
            saveReplacement({
                worker: profileName,
                keyDay,
                turno: backup.selectedMatch
                    ? backup.selectedMatch.coveredTurn
                    : backup.section.turn,
                replaced: backup.selectedMatch?.profile.name || "",
                reason: backup.selectedMatch ? "" : backup.reason,
                absenceType: backup.selectedMatch
                    ? backup.selectedMatch.absenceType
                    : "Motivo manual",
                source: "manual_extra",
                addsShift: false
            });
        });

        close();
        await renderCalendar();
        refreshStaffingAnalysisPanel();
    };

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) {
            close();
        }
    });

    backdrop
        .querySelector("[data-action='cancel']")
        .onclick = close;

    backdrop
        .querySelectorAll("[data-match-index]")
        .forEach(button => {
            button.onclick = () => {
                const sectionId = button.dataset.sectionId;

                selectedMatches.set(
                    sectionId,
                    Number(button.dataset.matchIndex)
                );

                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        const selected =
                            Number(item.dataset.matchIndex) ===
                            selectedMatches.get(sectionId);

                        item.classList.toggle("is-selected", selected);
                        item.setAttribute(
                            "aria-pressed",
                            selected ? "true" : "false"
                        );
                    });

                const manualTextarea = backdrop
                    .querySelector(`[data-manual-reason="${sectionId}"]`);

                if (manualTextarea) {
                    manualTextarea.value = "";
                }
            };
        });

    backdrop
        .querySelectorAll("[data-manual-reason]")
        .forEach(textarea => {
            textarea.addEventListener("input", event => {
                if (!event.target.value.trim()) return;

                const sectionId = event.target.dataset.manualReason;

                selectedMatches.delete(sectionId);
                backdrop
                    .querySelectorAll(
                        `[data-match-index][data-section-id="${sectionId}"]`
                    )
                    .forEach(item => {
                        item.classList.remove("is-selected");
                        item.setAttribute("aria-pressed", "false");
                    });
            });
        });

    backdrop
        .querySelector("[data-action='save-reason']")
        .onclick = saveBackups;

    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    (
        backdrop.querySelector("[data-clock-reason]") ||
        backdrop.querySelector("[data-match-index]") ||
        backdrop.querySelector("[data-manual-reason]")
    )?.focus();
}

window.openExtraReasonDialog = openExtraReasonDialog;

async function openClockExtraReasonDialog(
    profileName,
    keyDay,
    state
) {
    return openExtraReasonDialog(profileName, keyDay, 0, {
        forceClock: true,
        state
    });
}

window.openClockExtraReasonDialog = openClockExtraReasonDialog;

async function clickDia(
    keyDay,
    state,
    isHab,
    data,
    admin,
    legal,
    comp,
    absences
) {
    if (!isProfileActive(getCurrentProfile())) {
        alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
        return true;
    }

    const turnChange =
        getCambioTurnoRecibido(getCurrentProfile(), keyDay);

    if (turnChange) {
        return handleTurnChangeDayClick(turnChange);
    }

    if (window.selectionMode === "halfadmin") return;
    if (window.selectionMode) return;

    const replacementNeededTurn =
        getReplacementNeededTurn(getCurrentProfile(), keyDay);
    const needsReplacement =
        Boolean(replacementNeededTurn) &&
        requiereReemplazoTurnoBase(
            keyDay,
            getTurnoBase(getCurrentProfile(), keyDay),
            admin,
            legal,
            comp,
            absences
        ) &&
        !getReplacementForCoveredShift(
            getCurrentProfile(),
            keyDay
        );

    if (needsReplacement) {
        return openReplacementDialog(
            getCurrentProfile(),
            keyDay
        );
    }

    if (
        tieneAusencia(
            keyDay,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return;
    }

    const baseTurno = getTurnoBase(
        getCurrentProfile(),
        keyDay
    );
    const nuevo = siguienteTurnoValido(
        getCurrentProfile(),
        keyDay,
        state,
        isHab,
        {
            baseTurno
        }
    );

    if (typeof window.pushUndoState === "function") {
        window.pushUndoState(
            `Cambio ${keyDay}: ${turnoLabel(state)} -> ${turnoLabel(nuevo)}`
        );
    }

    data[keyDay] = nuevo;
    saveProfileData(data);
    scheduleCalendarAuditLog({
        profile: getCurrentProfile(),
        keyDay,
        previousTurn: state,
        nextTurn: nuevo
    });

    await renderCalendar();
    refreshStaffingAnalysisPanel();
}

export async function renderCalendar() {
    const cal = document.getElementById("calendar");
    const summary = document.getElementById("summary");
    const monthYear = document.getElementById("monthYear");

    if (!cal) return;

    cal.replaceChildren();

    const activeProfile = getCurrentProfile();
    const activeProfileEnabled =
        isProfileActive(activeProfile);
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const holidays = await fetchHolidays(y);
    const first =
        (new Date(y, m, 1).getDay() + 6) % 7;
    const days =
        new Date(y, m + 1, 0).getDate();
    const draftKey =
        typeof window.getProfileDraftSelectionKey === "function"
            ? window.getProfileDraftSelectionKey()
            : "";

    if (monthYear) {
        monthYear.innerText = currentDate.toLocaleString(
            "es-CL",
            {
                month: "long",
                year: "numeric"
            }
        );
    }

    for (let i = 0; i < first; i++) {
        cal.innerHTML += "<div class=\"calendar-spacer\"></div>";
    }

    if (!activeProfile) {
        for (let d = 1; d <= days; d++) {
            const keyDay = key(y, m, d);
            const date = new Date(y, m, d);

            const div = buildDayCell({
                day: d,
                month: m,
                year: y,
                keyDay,
                label: "",
                title: "Selecciona una fecha para la nueva rotativa.",
                isWeekendDay: isWeekend(date),
                isHoliday: Boolean(holidays[keyDay]),
                isDraftSelected: draftKey === keyDay
            });

            cal.appendChild(div);
        }

        if (summary) {
            summary.innerHTML = `
                <div class="empty-state empty-state--compact">
                    Aun no hay horas extras para mostrar.
                </div>
            `;
        }

        renderTimeline();

        if (typeof window.renderDashboardState === "function") {
            window.renderDashboardState();
        }

        return;
    }

    const data = getProfileData();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const carryIn = getCarry(y, m);
    const hourReturns = getHourReturns(activeProfile);

    for (let d = 1; d <= days; d++) {
        const keyDay = key(y, m, d);
        const baseState = getTurnoBase(activeProfile, keyDay);

        let state = Number(data[keyDay]) || 0;

        state = aplicarCambiosTurno(
            activeProfile,
            keyDay,
            state
        );

        const date = new Date(y, m, d);
        const isWeekendDay = isWeekend(date);
        const isHoliday = holidays[keyDay];
        const isHab = isBusinessDay(date, holidays);

        const hourReturn = hourReturns[keyDay] || null;
        const label = hourReturn
            ? hourReturnCalendarLabel(hourReturn)
            : obtenerLabelDia(
            keyDay,
            state,
            admin,
            legal,
            comp,
            absences,
            turnoLabel
        );
        const turnChange =
            getCambioTurnoRecibido(activeProfile, keyDay);
        const coveredReplacement =
            getReplacementForCoveredShift(activeProfile, keyDay);
        const workerReplacement =
            getReplacementForWorkerShift(activeProfile, keyDay);
        const replacementContractError =
            isReplacementProfile(activeProfile) &&
            state > 0 &&
            !hasContractForDate(activeProfile, keyDay);
        const pendingManualExtra =
            getPendingManualExtraTurn(
                activeProfile,
                keyDay,
                data
            );
        const severeClockIncident =
            hasSevereClockIncident(activeProfile, keyDay);
        const simpleClockIncident =
            !severeClockIncident &&
            hasSimpleClockIncident(activeProfile, keyDay);
        const clockExtra =
            hasClockExtra(
                activeProfile,
                keyDay,
                date,
                state,
                holidays
            );
        const showClockExtraReason =
            clockExtra &&
            !getClockExtraBackupForWorker(activeProfile, keyDay);
        const showTurnChangeBadge =
            Boolean(turnChange) &&
            state > 0 &&
            label === turnoLabel(state);
        const needsReplacement =
            requiereReemplazoTurnoBase(
                keyDay,
                baseState,
                admin,
                legal,
                comp,
                absences
            ) &&
            !coveredReplacement;
        const showExtraReason =
            !needsReplacement &&
            !turnChange &&
            !replacementContractError &&
            pendingManualExtra;
        const badge = replacementContractError
            ? "X"
            : severeClockIncident
                ? "!!!"
                : needsReplacement
                    ? "!"
                    : showExtraReason || showClockExtraReason
                    ? "?"
                    : simpleClockIncident
                        ? "*"
                        : workerReplacement
                            ? (
                                workerReplacement.isLoan
                                    ? "Prestamo"
                                    : (workerReplacement.reason ? "Motivo" : "Reemplazo")
                            )
                            : (showTurnChangeBadge ? "CCTT" : "");
        const replacementTitle = workerReplacement
            ? (
                workerReplacement.replaced
                    ? `${workerReplacement.isLoan ? "Prestamo cubriendo a" : "Reemplazo de"} ${workerReplacement.replaced} por ${workerReplacement.absenceType || "ausencia"}.`
                    : `Motivo HHEE: ${workerReplacement.reason || workerReplacement.absenceType || "sin detalle"}.`
            )
            : "";

        const div = buildDayCell({
            day: d,
            month: m,
            year: y,
            keyDay,
            label,
            badge,
            title: (() => {
                const hrs = calcHours(date, state, holidays);
                if (!activeProfileEnabled) {
                    return "Perfil desactivado: calendario solo lectura.";
                }

                const suffix = needsReplacement
                    ? " | Requiere reemplazo de turno base"
                    : showExtraReason
                        ? " | Requiere motivo de horas extras"
                        : showClockExtraReason
                            ? " | Requiere motivo por horas extras de marcaje"
                            : severeClockIncident
                                ? " | Incidencia grave de marcaje"
                                : simpleClockIncident
                                    ? " | Incidencia de marcaje"
                        : replacementContractError
                            ? " | No tiene contrato vigente en la fecha seleccionada"
                            : "";

                if (showExtraReason) {
                    return `Diurnas: ${hrs.d} | Nocturnas: ${hrs.n}${suffix}`;
                }

                if (replacementContractError) {
                    return "No tiene contrato vigente en la fecha seleccionada.";
                }

                return replacementTitle ||
                    `Diurnas: ${hrs.d} | Nocturnas: ${hrs.n}${suffix}`;
            })(),
            isWeekendDay,
            isHoliday: Boolean(isHoliday),
            isDraftSelected: draftKey === keyDay
        });

        if (showTurnChangeBadge) {
            div.classList.add("turn-change-day");
            div.dataset.swapId = String(turnChange.id);
        }

        if (!activeProfileEnabled) {
            div.classList.add("inactive-profile-day");
        }

        if (needsReplacement) {
            div.classList.add("needs-replacement");
        }

        if (showExtraReason) {
            div.classList.add("needs-extra-reason");
        }

        if (showClockExtraReason) {
            div.classList.add("needs-extra-reason");
            div.classList.add("clock-extra-day");
        }

        if (severeClockIncident) {
            div.classList.add("clock-severe-day");
        } else if (simpleClockIncident) {
            div.classList.add("clock-incident-day");
        }

        if (replacementContractError) {
            div.classList.add("contract-error-day");
        }

        if (workerReplacement) {
            div.classList.add("replacement-day");
        }

        if (hourReturn) {
            div.classList.add("hours-return-day");
            if (!hourReturn.fullTurn) {
                div.classList.add("hours-return-day--partial");
            }
        }

        aplicarClasesEspeciales(
            div,
            keyDay,
            state,
            isHab,
            isWeekendDay,
            isHoliday,
            admin,
            legal,
            comp,
            absences,
            aplicarClaseTurno
        );

        const bloqueado = estaBloqueadoModo(
            window.selectionMode,
            keyDay,
            (
                window.selectionMode === "admin" ||
                window.selectionMode === "hoursreturn"
            )
                ? getTurnoBase(activeProfile, keyDay)
                : state,
            isHab,
            admin,
            legal,
            comp,
            absences,
            getShiftAssigned(),
            {
                compCantidad: window.compCantidad || 0,
                licenseCantidad: window.licenseCantidad || 0,
                licenseType: window.licenseType || "license",
                rotativa: getRotativa(activeProfile),
                holidays,
                hourReturns
            }
        );

        if (window.selectionMode || !activeProfileEnabled) {
            div.classList.add(
                bloqueado || !activeProfileEnabled
                    ? "mpa-disabled"
                    : "mpa-enabled"
            );
        }

        div.onclick = async event => {
            if (!activeProfileEnabled) {
                event.stopPropagation();
                alert("Este perfil esta desactivado. Reactivalo desde Perfil para modificar su calendario.");
                return;
            }

            if (
                replacementContractError &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                window.startReplacementContractEdit?.(
                    activeProfile,
                    keyDay
                );
                return;
            }

            if (
                showExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    showExtraReason
                );
            }

            if (
                showClockExtraReason &&
                event.target.closest(".day-badge")
            ) {
                event.stopPropagation();
                return openClockExtraReasonDialog(
                    activeProfile,
                    keyDay,
                    state
                );
            }

            if (
                turnChange ||
                needsReplacement
            ) {
                event.stopPropagation();
            }

            await clickDia(
                keyDay,
                state,
                isHab,
                data,
                admin,
                legal,
                comp,
                absences
            );
        };

        cal.appendChild(div);
    }

    const carryOut = calcularCarryMes(
        y,
        m,
        days,
        holidays,
        data
    );

    const next = new Date(y, m + 1, 1);

    saveCarry(
        next.getFullYear(),
        next.getMonth(),
        carryOut
    );

    const stats = calcularHorasMes(
        y,
        m,
        days,
        holidays,
        data,
        blocked,
        carryIn
    );

    if (summary) {
        summary.innerHTML =
            renderSummaryHTML(stats) +
            renderReplacementLogHTML(
                activeProfile,
                y,
                m,
                holidays
            );
    }

    renderTimeline();

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
    }
}

function syncShellPanels() {
    if (typeof window.renderSwapPanel === "function") {
        window.renderSwapPanel();
    }

    if (typeof window.renderStaffingAnalysis === "function") {
        window.renderStaffingAnalysis();
    }

    if (typeof window.renderDashboardState === "function") {
        window.renderDashboardState();
    }
}

export function prevMonth() {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
    syncShellPanels();
}

export function nextMonth() {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
    syncShellPanels();
}
