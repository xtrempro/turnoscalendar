import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

function cleanText(value, fallback = "") {
    const text = String(value ?? "").trim();

    return text || fallback;
}

function cleanWorkspaceId(value) {
    return cleanText(value).replace(/\//g, "").trim();
}

function workspaceName(workspace) {
    return cleanText(workspace?.name, workspace?.id || "Entorno");
}

function userName(user) {
    return cleanText(user?.displayName, user?.email || "Usuario");
}

function linkDocId(fromWorkspaceId, toWorkspaceId) {
    return `${cleanWorkspaceId(fromWorkspaceId)}__${cleanWorkspaceId(toWorkspaceId)}`;
}

function linkFromSnap(docSnap) {
    return {
        id: docSnap.id,
        ...docSnap.data()
    };
}

function uniqueLinks(snaps) {
    const links = new Map();

    snaps.forEach(snap => {
        snap.docs.forEach(docSnap => {
            links.set(docSnap.id, linkFromSnap(docSnap));
        });
    });

    return [...links.values()].sort((a, b) => {
        const aName = a.fromWorkspaceName || a.toWorkspaceName || a.id;
        const bName = b.fromWorkspaceName || b.toWorkspaceName || b.id;

        return String(aName).localeCompare(String(bName));
    });
}

export async function requestWorkspaceLink(targetWorkspaceId) {
    const targetId = cleanWorkspaceId(targetWorkspaceId);
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para solicitar enlaces.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona un entorno antes de solicitar un enlace.");
    }

    if (!targetId) {
        throw new Error("Ingresa el ID del entorno que quieres enlazar.");
    }

    if (targetId === activeWorkspace.id) {
        throw new Error("No puedes enlazar el entorno activo consigo mismo.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(
        db,
        "workspaceLinks",
        linkDocId(activeWorkspace.id, targetId)
    );
    const now = firestoreModule.serverTimestamp();

    await firestoreModule.setDoc(linkRef, {
        fromWorkspaceId: activeWorkspace.id,
        fromWorkspaceName: workspaceName(activeWorkspace),
        toWorkspaceId: targetId,
        toWorkspaceName: targetId,
        status: "pending",
        requestedByUid: user.uid,
        requestedByName: userName(user),
        createdAt: now,
        updatedAt: now
    });

    return linkRef.id;
}

export async function listWorkspaceLinks(workspace = getActiveWorkspace()) {
    if (!workspace?.id) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const linksRef =
        firestoreModule.collection(db, "workspaceLinks");
    const [fromSnap, toSnap] = await Promise.all([
        firestoreModule.getDocs(
            firestoreModule.query(
                linksRef,
                firestoreModule.where(
                    "fromWorkspaceId",
                    "==",
                    workspace.id
                )
            )
        ),
        firestoreModule.getDocs(
            firestoreModule.query(
                linksRef,
                firestoreModule.where(
                    "toWorkspaceId",
                    "==",
                    workspace.id
                )
            )
        )
    ]);

    return uniqueLinks([fromSnap, toSnap]);
}

export async function acceptWorkspaceLink(linkId) {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para aceptar enlaces.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona un entorno antes de aceptar enlaces.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(db, "workspaceLinks", linkId);
    const linkSnap = await firestoreModule.getDoc(linkRef);

    if (!linkSnap.exists()) {
        throw new Error("La solicitud de enlace ya no existe.");
    }

    const link = linkSnap.data() || {};

    if (link.toWorkspaceId !== activeWorkspace.id) {
        throw new Error("Solo el entorno invitado puede aceptar este enlace.");
    }

    await firestoreModule.updateDoc(linkRef, {
        status: "accepted",
        toWorkspaceName: workspaceName(activeWorkspace),
        acceptedAt: firestoreModule.serverTimestamp(),
        acceptedByUid: user.uid,
        acceptedByName: userName(user),
        updatedAt: firestoreModule.serverTimestamp()
    });
}

export async function rejectWorkspaceLink(linkId, reason = "") {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona un entorno antes de rechazar enlaces.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(db, "workspaceLinks", linkId);
    const linkSnap = await firestoreModule.getDoc(linkRef);

    if (!linkSnap.exists()) {
        throw new Error("La solicitud de enlace ya no existe.");
    }

    const link = linkSnap.data() || {};

    if (link.toWorkspaceId !== activeWorkspace.id) {
        throw new Error("Solo el entorno invitado puede rechazar este enlace.");
    }

    await firestoreModule.updateDoc(linkRef, {
        status: "rejected",
        rejectedAt: firestoreModule.serverTimestamp(),
        rejectedByUid: user?.uid || "",
        rejectedByName: userName(user),
        rejectReason: cleanText(reason),
        updatedAt: firestoreModule.serverTimestamp()
    });
}

export async function unlinkWorkspaceLink(linkId) {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para desenlazar unidades.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona un entorno antes de desenlazar unidades.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(db, "workspaceLinks", linkId);
    const linkSnap = await firestoreModule.getDoc(linkRef);

    if (!linkSnap.exists()) {
        throw new Error("El enlace ya no existe.");
    }

    const link = linkSnap.data() || {};
    const belongsToActiveWorkspace =
        link.fromWorkspaceId === activeWorkspace.id ||
        link.toWorkspaceId === activeWorkspace.id;

    if (!belongsToActiveWorkspace) {
        throw new Error("Este enlace no pertenece al entorno activo.");
    }

    if (link.status !== "accepted") {
        throw new Error("Solo se pueden desenlazar unidades con enlace activo.");
    }

    await firestoreModule.updateDoc(linkRef, {
        status: "unlinked",
        unlinkedAt: firestoreModule.serverTimestamp(),
        unlinkedByUid: user.uid,
        unlinkedByName: userName(user),
        updatedAt: firestoreModule.serverTimestamp()
    });
}
