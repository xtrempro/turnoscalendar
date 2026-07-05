import { getFirebaseServices } from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    getReplacements,
    saveReplacements
} from "./storage.js";

const INTER_UNIT_SOURCE = "inter_unit_loan";

let activeWorkspace = null;
let unsubscribeAssignments = null;
let syncGeneration = 0;

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

// Esta sincronizacion observa exclusivamente los prestamos ya asignados en el
// workspace actual. No consulta enlaces, trabajadores ni calendarios remotos.
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
                    "No se pudieron sincronizar prestamos asignados a la unidad actual.",
                    error
                );
            }
        );
    } catch (error) {
        console.warn(
            "No se pudo iniciar la sincronizacion de prestamos asignados.",
            error
        );
    }
}

export function stopInterUnitLoanSync() {
    if (unsubscribeAssignments) {
        unsubscribeAssignments();
        unsubscribeAssignments = null;
    }

    activeWorkspace = null;
    syncGeneration++;
}
