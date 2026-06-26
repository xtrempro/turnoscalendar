import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    getProfiles,
    getProfileData,
    getReplacements,
    getRotativa,
    getTurnChangeConfig,
    isProfileActive,
    saveReplacements
} from "./storage.js";
import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getTurnoProgramado
} from "./turnEngine.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import { fetchHolidays } from "./holidays.js";
import { getJSON } from "./persistence.js";
import {
    restarTurnoCubierto,
    tieneAusencia
} from "./rulesEngine.js";
import { getBlockedDayForProfile } from "./workerAvailability.js";
import { canEditAnyMenu } from "./workspacePermissions.js";

const MONTHS_BACK = 2;
const MONTHS_FORWARD = 13;
const PUBLISH_DELAY_MS = 1400;
const INITIAL_PUBLISH_DELAY_MS = 3200;
const MAX_STAFFING_DOCUMENT_BYTES = 850000;
const INTER_UNIT_SOURCE = "inter_unit_loan";

let activeWorkspace = null;
let publishTimer = null;
let publishInFlight = false;
let publishRequested = false;
let syncGeneration = 0;
let unsubscribeAssignments = null;
const publishedHashes = new Map();

function monthId(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function dateISO(year, month, day) {
    return [
        year,
        String(month + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

function keyDay(year, month, day) {
    return `${year}-${month}-${day}`;
}

function monthDates(reference = new Date()) {
    const dates = [];

    for (
        let offset = -MONTHS_BACK;
        offset <= MONTHS_FORWARD;
        offset++
    ) {
        dates.push(new Date(
            reference.getFullYear(),
            reference.getMonth() + offset,
            1
        ));
    }

    return dates;
}

function profileLeaveMaps(profileName) {
    return {
        admin: getJSON(`admin_${profileName}`, {}),
        legal: getJSON(`legal_${profileName}`, {}),
        comp: getJSON(`comp_${profileName}`, {}),
        absences: getJSON(`absences_${profileName}`, {})
    };
}

function profileHasAbsence(profileName, dayKey, maps) {
    return tieneAusencia(
        dayKey,
        maps.admin,
        maps.legal,
        maps.comp,
        maps.absences
    );
}

function stableHash(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `${text.length}-${(hash >>> 0).toString(36)}`;
}

function cleanProfile(profile) {
    return {
        id: String(profile.id || "").slice(0, 100),
        name: String(profile.name || "").slice(0, 160),
        estamento: String(profile.estamento || "").slice(0, 100),
        profession: String(profile.profession || "").slice(0, 160)
    };
}

function turnCodeToState(code) {
    return {
        L: 1,
        N: 2,
        "24": 3,
        D: 4,
        "D+N": 5,
        HM: 6,
        HT: 7,
        "18": 8
    }[code] || 0;
}

function interUnitTurnForWorker(profileName, iso) {
    return getReplacements()
        .filter(replacement =>
            replacement &&
            !replacement.canceled &&
            replacement.source === INTER_UNIT_SOURCE &&
            replacement.worker === profileName &&
            replacement.date === iso &&
            replacement.addsShift !== false
        )
        .reduce(
            (turn, replacement) =>
                fusionarTurnos(
                    turn,
                    turnCodeToState(replacement.turno)
                ),
            0
        );
}

async function buildStaffingMonth(workspace, date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const holidays = await fetchHolidays(year);
    const profiles = getProfiles().filter(isProfileActive);
    const workers = profiles.map(profile => {
        const maps = profileLeaveMaps(profile.name);
        const stats = calcularHorasMesPerfil(
            profile.name,
            year,
            month,
            daysInMonth,
            holidays,
            getProfileData(profile.name),
            {},
            { d: 0, n: 0 }
        );
        const days = {};

        for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = keyDay(year, month, day);
            const iso = dateISO(year, month, day);
            const hasAbsence = profileHasAbsence(
                profile.name,
                dayKey,
                maps
            );
            const actualTurn = aplicarCambiosTurno(
                profile.name,
                dayKey,
                getTurnoProgramado(profile.name, dayKey)
            );
            // Los prestamos activos se validan aparte en Cloud Functions.
            // Se excluyen de esta proyeccion para que una cancelacion no deje
            // disponibilidad obsoleta si la unidad origen esta desconectada.
            const turn = restarTurnoCubierto(
                actualTurn,
                interUnitTurnForWorker(profile.name, iso)
            );

            days[iso] = {
                turn: Number(turn) || 0,
                available: !hasAbsence,
                blocked: Boolean(
                    getBlockedDayForProfile(profile.name, dayKey)
                )
            };
        }

        return {
            ...cleanProfile(profile),
            rotationType: String(getRotativa(profile.name).type || ""),
            hheeDiurnas: Number(stats.hheeDiurnas) || 0,
            hheeNocturnas: Number(stats.hheeNocturnas) || 0,
            days
        };
    });
    const payload = {
        workspaceId: workspace.id,
        workspaceName: String(workspace.name || "").slice(0, 160),
        month: monthId(date),
        workerCount: workers.length,
        allowTwentyFourHourShifts:
            getTurnChangeConfig().allowTwentyFourHourShifts !== false,
        workers,
        updatedAtISO: new Date().toISOString()
    };
    const payloadBytes = new TextEncoder()
        .encode(JSON.stringify(payload))
        .byteLength;

    if (payloadBytes > MAX_STAFFING_DOCUMENT_BYTES) {
        throw new Error(
            `La publicacion operativa ${payload.month} supera el limite seguro.`
        );
    }

    return payload;
}

async function publishInterUnitStaffingNow() {
    if (!activeWorkspace?.id || !canEditAnyMenu()) return;

    if (publishInFlight) {
        publishRequested = true;
        return;
    }

    publishInFlight = true;
    publishRequested = false;
    const generation = syncGeneration;
    const workspace = {
        ...(getActiveWorkspace() || {}),
        ...activeWorkspace
    };

    try {
        const payloads = await Promise.all(
            monthDates().map(date =>
                buildStaffingMonth(workspace, date)
            )
        );

        if (generation !== syncGeneration) return;

        const changedPayloads = payloads
            .map(payload => ({
                payload,
                hash: stableHash({
                    ...payload,
                    updatedAtISO: ""
                })
            }))
            .filter(item =>
                publishedHashes.get(item.payload.month) !== item.hash
            );

        if (!changedPayloads.length) return;

        const { db, firestoreModule } = await getFirebaseServices();
        const batch = firestoreModule.writeBatch(db);

        changedPayloads.forEach(({ payload, hash }) => {
            batch.set(
                firestoreModule.doc(
                    db,
                    "workspaces",
                    workspace.id,
                    "linkedStaffingMonths",
                    payload.month
                ),
                {
                    ...payload,
                    hash,
                    updatedAt: firestoreModule.serverTimestamp()
                }
            );
        });

        await batch.commit();

        changedPayloads.forEach(({ payload, hash }) => {
            publishedHashes.set(payload.month, hash);
        });
    } catch (error) {
        console.warn(
            "No se pudo publicar disponibilidad para unidades enlazadas.",
            error
        );
    } finally {
        publishInFlight = false;

        if (
            publishRequested &&
            generation === syncGeneration &&
            activeWorkspace?.id
        ) {
            scheduleInterUnitStaffingPublish();
        }
    }
}

export function scheduleInterUnitStaffingPublish(
    delay = PUBLISH_DELAY_MS
) {
    if (!activeWorkspace?.id) return;

    clearTimeout(publishTimer);
    publishTimer = setTimeout(
        publishInterUnitStaffingNow,
        delay
    );
}

export async function readLinkedStaffingMonth(
    workspaceId,
    keyDayValue,
    {
        linkId = "",
        requesterWorkspaceId = ""
    } = {}
) {
    const [year, zeroBasedMonth] = String(keyDayValue || "")
        .split("-")
        .map(Number);

    if (!workspaceId || !year || !Number.isInteger(zeroBasedMonth)) {
        return null;
    }

    const id = `${year}-${String(zeroBasedMonth + 1).padStart(2, "0")}`;
    const { functions, functionsModule } =
        await getFirebaseServices();
    const callable = functionsModule.httpsCallable(
        functions,
        "getLinkedStaffingMonth"
    );
    const result = await callable({
        linkId,
        sourceWorkspaceId: workspaceId,
        requesterWorkspaceId,
        month: id
    });
    const data = result.data || {};

    return data.exists
        ? { id, ...data }
        : null;
}

function assignmentToReplacement(assignment) {
    const date = String(assignment.date || "");
    const parsedDate = new Date(`${date}T12:00:00`);

    return {
        id: `interunit_${assignment.loanId}`,
        interUnitLoanId: assignment.loanId,
        requestId: "",
        requestGroupId: "",
        worker: assignment.workerName || "",
        replaced: assignment.replacedProfileName || "",
        reason: "",
        source: INTER_UNIT_SOURCE,
        addsShift: true,
        date,
        turno: assignment.turnCode || "",
        clockLabel: "",
        clockHours: null,
        diurnoLongCoverage: false,
        overtimeHours: null,
        isLoan: true,
        workerWorkspaceId: assignment.sourceWorkspaceId || "",
        workerWorkspaceName: assignment.sourceWorkspaceName || "",
        hostWorkspaceId: assignment.hostWorkspaceId || "",
        hostWorkspaceName: assignment.hostWorkspaceName || "",
        remoteReplacementId: "",
        absenceType: assignment.absenceType || "",
        year: Number.isNaN(parsedDate.getTime())
            ? 0
            : parsedDate.getFullYear(),
        month: Number.isNaN(parsedDate.getTime())
            ? 0
            : parsedDate.getMonth(),
        createdAt: assignment.createdAtISO || new Date().toISOString(),
        canceled: false
    };
}

function applyLoanAssignments(snapshot) {
    const activeAssignments = snapshot.docs
        .map(docSnap => ({
            loanId: docSnap.id,
            ...docSnap.data()
        }))
        .filter(assignment => assignment.status === "active")
        .map(assignmentToReplacement);
    const current = getReplacements();
    const local = current.filter(replacement =>
        replacement?.source !== INTER_UNIT_SOURCE
    );
    const next = [...local, ...activeAssignments];

    if (JSON.stringify(current) === JSON.stringify(next)) return;

    saveReplacements(next);

    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:interUnitLoansChanged")
        );
    }
}

export async function createInterUnitLoan(data = {}) {
    const { functions, functionsModule } =
        await getFirebaseServices();
    const callable = functionsModule.httpsCallable(
        functions,
        "createInterUnitLoan"
    );
    const result = await callable(data);

    return result.data;
}

export async function cancelInterUnitLoan(loanId, workspaceId = "") {
    if (!loanId) return null;

    const { functions, functionsModule } =
        await getFirebaseServices();
    const callable = functionsModule.httpsCallable(
        functions,
        "cancelInterUnitLoan"
    );
    const result = await callable({
        loanId,
        workspaceId:
            workspaceId ||
            activeWorkspace?.id ||
            getActiveWorkspace()?.id ||
            ""
    });

    return result.data;
}

export async function startInterUnitLoanSync(workspace) {
    const workspaceId = String(workspace?.id || "").trim();

    if (
        activeWorkspace?.id === workspaceId &&
        unsubscribeAssignments
    ) {
        return;
    }

    stopInterUnitLoanSync();
    if (!workspaceId) return;

    activeWorkspace = {
        id: workspaceId,
        name: workspace?.name || ""
    };
    syncGeneration++;
    const generation = syncGeneration;

    try {
        const { db, firestoreModule } = await getFirebaseServices();

        unsubscribeAssignments = firestoreModule.onSnapshot(
            firestoreModule.collection(
                db,
                "workspaces",
                workspaceId,
                "loanAssignments"
            ),
            snapshot => {
                if (generation !== syncGeneration) return;
                applyLoanAssignments(snapshot);
            },
            error => {
                console.warn(
                    "No se pudieron sincronizar prestamos entre unidades.",
                    error
                );
            }
        );

        scheduleInterUnitStaffingPublish(
            INITIAL_PUBLISH_DELAY_MS
        );
    } catch (error) {
        console.warn(
            "No se pudo iniciar sincronizacion entre unidades.",
            error
        );
    }
}

export function stopInterUnitLoanSync() {
    clearTimeout(publishTimer);
    publishTimer = null;

    if (unsubscribeAssignments) {
        unsubscribeAssignments();
        unsubscribeAssignments = null;
    }

    activeWorkspace = null;
    publishInFlight = false;
    publishRequested = false;
    publishedHashes.clear();
    syncGeneration++;
}

if (typeof window !== "undefined") {
    window.addEventListener("proturnos:persistenceChanged", () => {
        scheduleInterUnitStaffingPublish();
    });

    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type === "app-state-applied") {
            scheduleInterUnitStaffingPublish(400);
        }
    });
}
