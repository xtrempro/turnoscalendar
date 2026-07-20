import { getJSON, setJSON } from "./persistence.js";
import {
    getFirebaseServices,
    getCurrentFirebaseUser
} from "./firebaseClient.js";

const ACTIVE_WORKSPACE_KEY = "firebaseActiveWorkspace";
// Periodo de gracia antes de eliminar definitivamente un entorno.
export const WORKSPACE_DELETION_GRACE_HOURS = 72;

function workspaceLabel(workspace) {
    return String(workspace?.name || workspace?.id || "Unidad");
}

function userPayload(user) {
    return {
        email: user.email || "",
        displayName: user.displayName || "",
        photoURL: user.photoURL || "",
        updatedAt: new Date().toISOString()
    };
}

function parseJoinInput(value) {
    const raw = String(value || "").trim();

    if (!raw) {
        return {
            workspaceId: "",
            supervisorInvite: ""
        };
    }

    try {
        const url = new URL(raw);

        return {
            workspaceId: url.searchParams.get("joinWorkspace") || raw,
            supervisorInvite: url.searchParams.get("supervisorInvite") || ""
        };
    } catch (_error) {
        const parts = raw
            .split(/[|\s]+/)
            .map(part => part.trim())
            .filter(Boolean);

        return {
            workspaceId: parts[0] || "",
            supervisorInvite: parts[1] || ""
        };
    }
}

async function callWorkspaceFunction(name, payload = {}) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result.data || {};
}

export function getActiveWorkspace() {
    return getJSON(ACTIVE_WORKSPACE_KEY, null);
}

export function setActiveWorkspace(workspace) {
    if (!workspace) {
        setJSON(ACTIVE_WORKSPACE_KEY, null);
        return;
    }

    setJSON(ACTIVE_WORKSPACE_KEY, {
        id: workspace.id,
        name: workspaceLabel(workspace),
        role: workspace.role || "member"
    });
}

// Programa la eliminacion del entorno (solo el creador). Marca el doc con la
// fecha objetivo; una Cloud Function programada hace el borrado real al vencer.
export async function requestWorkspaceDeletion(workspaceId) {
    const user = getCurrentFirebaseUser();

    if (!user) throw new Error("Debes iniciar sesion.");
    if (!workspaceId) throw new Error("Unidad invalida.");

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.doc(db, "workspaces", workspaceId);
    const snap = await firestoreModule.getDoc(ref);

    if (!snap.exists()) throw new Error("La unidad no existe.");
    if (snap.data().ownerUid !== user.uid) {
        throw new Error("Solo el creador de la unidad puede eliminarla.");
    }

    const scheduledAt = new Date(
        Date.now() + WORKSPACE_DELETION_GRACE_HOURS * 60 * 60 * 1000
    );

    await firestoreModule.updateDoc(ref, {
        deletionStatus: "pending_deletion",
        deletionRequestedAt: firestoreModule.serverTimestamp(),
        deletionRequestedByUid: user.uid,
        deletionScheduledAt: scheduledAt,
        updatedAt: firestoreModule.serverTimestamp()
    });

    return scheduledAt.toISOString();
}

// Anula la eliminacion programada (solo el creador).
export async function cancelWorkspaceDeletion(workspaceId) {
    const user = getCurrentFirebaseUser();

    if (!user) throw new Error("Debes iniciar sesion.");
    if (!workspaceId) return;

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.doc(db, "workspaces", workspaceId);
    const snap = await firestoreModule.getDoc(ref);

    if (!snap.exists()) return;
    if (snap.data().ownerUid !== user.uid) {
        throw new Error("Solo el creador puede anular la eliminacion.");
    }

    await firestoreModule.updateDoc(ref, {
        deletionStatus: null,
        deletionRequestedAt: null,
        deletionRequestedByUid: null,
        deletionScheduledAt: null,
        deletionCanceledAt: firestoreModule.serverTimestamp(),
        updatedAt: firestoreModule.serverTimestamp()
    });
}

export async function ensureFirebaseUser(user) {
    if (!user) return;

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.doc(db, "users", user.uid);

    await firestoreModule.setDoc(
        ref,
        userPayload(user),
        { merge: true }
    );
}

export async function listUserWorkspaces(user) {
    if (!user) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.collection(
        db,
        "users",
        user.uid,
        "workspaces"
    );
    const snap = await firestoreModule.getDocs(ref);

    return snap.docs
        .map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }))
        .sort((a, b) =>
            workspaceLabel(a).localeCompare(workspaceLabel(b))
        );
}

// Lee el estado de eliminacion del doc top-level del entorno.
export async function fetchWorkspaceDeletionInfo(workspaceId) {
    if (!workspaceId) return null;

    try {
        const { db, firestoreModule } = await getFirebaseServices();
        const snap = await firestoreModule.getDoc(
            firestoreModule.doc(db, "workspaces", workspaceId)
        );

        if (!snap.exists()) return null;

        const data = snap.data();
        const scheduled = data.deletionScheduledAt;
        const scheduledMs = scheduled?.toMillis
            ? scheduled.toMillis()
            : (scheduled?.seconds ? scheduled.seconds * 1000 : null);

        return {
            ownerUid: data.ownerUid || "",
            deletionStatus: data.deletionStatus || "",
            deletionScheduledMs: scheduledMs,
            deletionRequestedByUid: data.deletionRequestedByUid || ""
        };
    } catch (error) {
        console.warn("No se pudo leer el estado del entorno.", error);
        return null;
    }
}

export async function createWorkspace(user, name) {
    const cleanName = String(name || "").trim();

    if (!user) {
        throw new Error("Debes iniciar sesion para crear una unidad.");
    }

    if (!cleanName) {
        throw new Error("Debes indicar un nombre para la unidad.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const now = firestoreModule.serverTimestamp();
    const workspaceRef =
        firestoreModule.doc(
            firestoreModule.collection(db, "workspaces")
        );
    const workspace = {
        id: workspaceRef.id,
        name: cleanName,
        ownerUid: user.uid,
        createdByEmail: user.email || "",
        createdAt: now,
        updatedAt: now
    };
    const member = {
        role: "owner",
        email: user.email || "",
        displayName: user.displayName || "",
        joinedAt: now
    };

    await firestoreModule.setDoc(workspaceRef, workspace);
    await firestoreModule.setDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            workspaceRef.id,
            "members",
            user.uid
        ),
        member
    );
    await firestoreModule.setDoc(
        firestoreModule.doc(
            db,
            "users",
            user.uid,
            "workspaces",
            workspaceRef.id
        ),
        {
            name: cleanName,
            role: "owner",
            joinedAt: now
        }
    );

    const active = {
        id: workspaceRef.id,
        name: cleanName,
        role: "owner"
    };

    setActiveWorkspace(active);
    return active;
}

export async function createSupervisorInvitation(
    user,
    workspace,
    permissions
) {
    const cleanId = String(workspace?.id || "").trim();

    if (!user) {
        throw new Error("Debes iniciar sesion para generar una invitacion.");
    }

    if (!cleanId) {
        throw new Error("No se pudo identificar la unidad.");
    }

    const invite = await callWorkspaceFunction("createSupervisorInvite", {
        workspaceId: cleanId,
        permissions
    });

    return {
        ...workspace,
        id: cleanId,
        name: invite.workspaceName || workspaceLabel(workspace),
        supervisorInvite: invite.token || "",
        supervisorInviteId: invite.inviteId || "",
        supervisorInviteExpiresAt: invite.expiresAt || null,
        permissions: invite.permissions || permissions || {}
    };
}

export async function sendSupervisorInvitationEmail(
    user,
    workspace,
    email,
    permissions
) {
    const cleanId = String(workspace?.id || "").trim();
    const cleanEmail = String(email || "").trim();

    if (!user) {
        throw new Error("Debes iniciar sesion para enviar una invitacion.");
    }

    if (!cleanId) {
        throw new Error("No se pudo identificar la unidad.");
    }

    if (!cleanEmail) {
        throw new Error("Debes ingresar el correo de destino.");
    }

    const invite = await callWorkspaceFunction("sendSupervisorInviteEmail", {
        workspaceId: cleanId,
        email: cleanEmail,
        permissions
    });

    return {
        ...workspace,
        id: cleanId,
        name: invite.workspaceName || workspaceLabel(workspace),
        supervisorInviteId: invite.inviteId || "",
        deliveryEmail: invite.email || cleanEmail,
        permissions: invite.permissions || permissions || {}
    };
}

export async function claimSupervisorInvitation(
    user,
    workspaceInput,
    tokenInput = ""
) {
    const parsed = parseJoinInput(workspaceInput);
    const cleanId = String(parsed.workspaceId || "").trim();
    const token =
        String(tokenInput || parsed.supervisorInvite || "").trim();

    if (!user) {
        throw new Error("Debes iniciar sesion para unirte a una unidad.");
    }

    if (!cleanId) {
        throw new Error("Debes ingresar el ID de la unidad.");
    }

    if (!token) {
        throw new Error(
            "Debes usar un enlace de invitacion segura. Los codigos antiguos ya no son validos."
        );
    }

    return callWorkspaceFunction("claimSupervisorInvite", {
        workspaceId: cleanId,
        token
    });
}

export async function approveSupervisorInvitation(
    workspaceId,
    inviteId,
    permissionsOverride = null
) {
    return callWorkspaceFunction("approveSupervisorInvite", {
        workspaceId,
        inviteId,
        ...(permissionsOverride
            ? { permissionsOverride }
            : {})
    });
}

export async function rejectSupervisorInvitation(
    workspaceId,
    inviteId,
    reason = ""
) {
    return callWorkspaceFunction("rejectSupervisorInvite", {
        workspaceId,
        inviteId,
        reason
    });
}

export async function revokeSupervisorInvitation(workspaceId, inviteId) {
    return callWorkspaceFunction("revokeSupervisorInvite", {
        workspaceId,
        inviteId
    });
}

export async function listSupervisorInvitations(workspaceId) {
    if (!workspaceId) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const snap = await firestoreModule.getDocs(
        firestoreModule.collection(
            db,
            "workspaces",
            workspaceId,
            "supervisorInvites"
        )
    );

    return snap.docs
        .map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }))
        .sort((a, b) => {
            const aCreated = a.createdAt?.toMillis
                ? a.createdAt.toMillis()
                : 0;
            const bCreated = b.createdAt?.toMillis
                ? b.createdAt.toMillis()
                : 0;

            return bCreated - aCreated;
        });
}
