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
        overtimeHours: assignment.overtimeHours || null,
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

/**
 * Los prestamos de la lista son una PROYECCION de `loanAssignments`, y cada
 * cambio se publica. Solo se proyecta la coleccion completa CONFIRMADA por el
 * servidor. Un snapshot de cache no se usa para nada:
 *   - vacio (abrir sin red) publicaba la baja de cada prestamo;
 *   - atrasado con un "canceled" viejo borraba un prestamo RECREADO con el
 *     mismo id (el id sale de unidad + trabajador + fecha);
 *   - atrasado con un "active" viejo volvia a poner uno ya retirado.
 * (auditoria fase 0 y revision del diseno, P2-1.) Sin red, un prestamo nuevo
 * aparece al reconectar; ninguno se pierde.
 */
export function planLoanAssignments(current = [], snapshot = {}) {
    if (snapshot.metadata?.fromCache !== false) return current;

    const assignments = (snapshot.docs || []).map(docSnap => ({
        loanId: docSnap.id,
        ...docSnap.data()
    }));
    const active = new Map(assignments
        .filter(assignment => assignment.status === "active")
        .map(assignment => {
            const replacement = assignmentToReplacement(assignment);
            return [replacement.id, replacement];
        }));
    const next = [];

    for (const replacement of current) {
        if (replacement?.source !== INTER_UNIT_SOURCE) {
            next.push(replacement);
            continue;
        }
        // Coleccion completa del servidor: si no esta activo, ya no va.
        if (active.has(replacement.id)) {
            next.push(active.get(replacement.id));
            active.delete(replacement.id);
        }
    }

    next.push(...active.values());
    return next;
}

function applyLoanAssignments(snapshot) {
    const current = getReplacements();
    const next = planLoanAssignments(current, snapshot);

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
            // Sin esto, si la cache y el servidor coinciden no llega el aviso
            // de "ya confirmado" y una baja pendiente no se aplicaria nunca.
            { includeMetadataChanges: true },
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
