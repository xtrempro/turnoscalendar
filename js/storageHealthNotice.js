// Aviso del almacenamiento que mide el SERVIDOR (checkStorageHealth, todos los
// dias). Complementa la alerta local de firebaseAppState.js, que solo ve los
// documentos que esta sesion recibe: aqui llegan tambien las diferencias entre
// formatos en migracion y los documentos que esta sesion no carga.
//
// Lo lee solo el dueno de la unidad (las reglas no dejan a nadie mas) y lo
// muestra el mismo banner (syncBanner.js). Si el correo de aviso no funciona,
// este es el respaldo dentro de la app.

import { getFirebaseServices } from "./firebaseClient.js";
import { isWorkspaceOwner } from "./workspacePermissions.js";

let generation = 0;

function dispatchNotice(detail) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(new CustomEvent("proturnos:firebaseAppState", {
        detail: { type: "server-storage-health", ...detail }
    }));
}

const AUDIT_LABELS = {
    auditLog: "la bitácora",
    replacements: "los reemplazos"
};

const STORAGE_KEY_LABELS = {
    auditLog: "la bitácora",
    replacements: "los reemplazos",
    attendanceMarks: "los marcajes",
    weekly_task_assignment_entries: "la asignación de tareas",
    memos: "los memorándums",
    workerRequests: "las solicitudes"
};

/**
 * El texto del aviso, o "" si no hay nada que avisar.
 */
export function serverStorageNoticeText(alerts = {}) {
    const documents = Array.isArray(alerts.documents) ? alerts.documents : [];
    const audits = Array.isArray(alerts.audits) ? alerts.audits : [];
    const worst = documents
        .slice()
        .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0))[0];
    const parts = [];

    if (worst) {
        const label = STORAGE_KEY_LABELS[worst.storageKey] || worst.storageKey;

        parts.push(
            `${worst.level === "critical" ? "Almacenamiento crítico" : "Almacenamiento en observación"} ` +
            `(${worst.percent}%): ${label} se acerca a su límite` +
            (Number.isFinite(worst.daysToCritical) && worst.daysToCritical > 0
                ? `, ~${worst.daysToCritical} días al ritmo actual`
                : "") +
            "."
        );
    }

    if (audits.length) {
        parts.push(
            "Revisión de datos: " +
            audits.map(audit =>
                audit.unreadable
                    ? `no se pudo leer ${AUDIT_LABELS[audit.kind] || audit.kind}`
                    : `${audit.issues} diferencia(s) en ${AUDIT_LABELS[audit.kind] || audit.kind}`
            ).join("; ") +
            "."
        );
    }

    return parts.length ? `${parts.join(" ")} Contacta a soporte.` : "";
}

/**
 * Lee el estado que dejo la revision diaria para esta unidad. Una sola lectura
 * por unidad abierta; la revision es diaria, no hace falta escucharla.
 */
export async function loadServerStorageNotice(workspace) {
    const current = ++generation;

    dispatchNotice({ message: "" });

    if (!workspace?.id || !isWorkspaceOwner()) return "";

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const snapshot = await firestoreModule.getDoc(
            firestoreModule.doc(db, "storageHealthUnits", workspace.id)
        );

        if (current !== generation || !snapshot.exists()) return "";

        const message = serverStorageNoticeText(snapshot.data()?.alerts || {});

        dispatchNotice({ message });
        return message;
    } catch (error) {
        // Sin el documento (unidad nueva, o aun no se despliega la revision)
        // simplemente no hay aviso.
        console.warn("No se pudo leer el aviso de almacenamiento.", error);
        return "";
    }
}

export function clearServerStorageNotice() {
    generation++;
    dispatchNotice({ message: "" });
}
