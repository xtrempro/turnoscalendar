import { getJSON, setJSON } from "./persistence.js";
import { getFirebaseServices } from "./firebaseClient.js";

const ACTIVE_WORKSPACE_KEY = "firebaseActiveWorkspace";
const INVITE_CODE_BYTES = 16;

function workspaceLabel(workspace) {
    return String(workspace?.name || workspace?.id || "Entorno");
}

function userPayload(user) {
    return {
        email: user.email || "",
        displayName: user.displayName || "",
        photoURL: user.photoURL || "",
        updatedAt: new Date().toISOString()
    };
}

function createInviteCode() {
    const bytes = new Uint8Array(INVITE_CODE_BYTES);

    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index++) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }

    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function parseJoinInput(value) {
    const raw = String(value || "").trim();

    if (!raw) {
        return {
            workspaceId: "",
            inviteCode: ""
        };
    }

    try {
        const url = new URL(raw);

        return {
            workspaceId: url.searchParams.get("joinWorkspace") || raw,
            inviteCode: url.searchParams.get("inviteCode") || ""
        };
    } catch (_error) {
        const parts = raw
            .split(/[|\s]+/)
            .map(part => part.trim())
            .filter(Boolean);

        return {
            workspaceId: parts[0] || "",
            inviteCode: parts[1] || ""
        };
    }
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

export async function createWorkspace(user, name) {
    const cleanName = String(name || "").trim();

    if (!user) {
        throw new Error("Debes iniciar sesion para crear un entorno.");
    }

    if (!cleanName) {
        throw new Error("Debes indicar un nombre para el entorno.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const now = firestoreModule.serverTimestamp();
    const inviteCode = createInviteCode();
    const workspaceRef =
        firestoreModule.doc(
            firestoreModule.collection(db, "workspaces")
        );
    const workspace = {
        id: workspaceRef.id,
        name: cleanName,
        ownerUid: user.uid,
        inviteCode,
        createdByEmail: user.email || "",
        createdAt: now,
        updatedAt: now
    };
    const member = {
        role: "owner",
        email: user.email || "",
        displayName: user.displayName || "",
        inviteCode,
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

export async function prepareWorkspaceInvitation(user, workspace) {
    const cleanId = String(workspace?.id || "").trim();

    if (!user) {
        throw new Error("Debes iniciar sesion para generar una invitacion.");
    }

    if (!cleanId) {
        throw new Error("No se pudo identificar el entorno.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const workspaceRef =
        firestoreModule.doc(db, "workspaces", cleanId);
    const workspaceSnap =
        await firestoreModule.getDoc(workspaceRef);

    if (!workspaceSnap.exists()) {
        throw new Error("No existe un entorno con ese ID.");
    }

    const workspaceData = workspaceSnap.data() || {};
    let inviteCode = String(workspaceData.inviteCode || "").trim();

    if (!inviteCode) {
        if (workspaceData.ownerUid !== user.uid) {
            throw new Error(
                "Solo el propietario puede generar una invitacion segura para este entorno."
            );
        }

        inviteCode = createInviteCode();
        await firestoreModule.updateDoc(workspaceRef, {
            inviteCode,
            updatedAt: firestoreModule.serverTimestamp()
        });
    }

    return {
        ...workspace,
        ...workspaceData,
        id: cleanId,
        name: workspaceLabel({
            ...workspace,
            ...workspaceData,
            id: cleanId
        }),
        inviteCode
    };
}

export async function joinWorkspace(user, workspaceInput, inviteCodeInput = "") {
    const parsed = parseJoinInput(workspaceInput);
    const cleanId = String(parsed.workspaceId || "").trim();
    const inviteCode =
        String(inviteCodeInput || parsed.inviteCode || "").trim();

    if (!user) {
        throw new Error("Debes iniciar sesion para unirte a un entorno.");
    }

    if (!cleanId) {
        throw new Error("Debes ingresar el ID del entorno.");
    }

    if (!inviteCode) {
        throw new Error(
            "Debes usar un enlace de invitacion o ingresar el codigo de invitacion del entorno."
        );
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const workspaceRef =
        firestoreModule.doc(db, "workspaces", cleanId);
    const now = firestoreModule.serverTimestamp();

    await firestoreModule.setDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            cleanId,
            "members",
            user.uid
        ),
        {
            role: "member",
            email: user.email || "",
            displayName: user.displayName || "",
            inviteCode,
            joinedAt: now
        },
        { merge: true }
    );

    const workspaceSnap =
        await firestoreModule.getDoc(workspaceRef);

    if (!workspaceSnap.exists()) {
        throw new Error("No existe un entorno con ese ID.");
    }

    const workspace = {
        id: workspaceSnap.id,
        ...workspaceSnap.data()
    };

    await firestoreModule.setDoc(
        firestoreModule.doc(
            db,
            "users",
            user.uid,
            "workspaces",
            cleanId
        ),
        {
            name: workspaceLabel(workspace),
            role: "member",
            joinedAt: now
        },
        { merge: true }
    );

    const active = {
        id: cleanId,
        name: workspaceLabel(workspace),
        role: "member"
    };

    setActiveWorkspace(active);
    return active;
}
