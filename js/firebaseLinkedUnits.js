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

function cleanEmail(value) {
    return cleanText(value).toLowerCase();
}

function workspaceName(workspace) {
    return cleanText(workspace?.name, workspace?.id || "Unidad");
}

function userName(user) {
    return cleanText(user?.displayName, user?.email || "Usuario");
}

async function callLinkedUnitFunction(name, payload = {}) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result.data || {};
}

function linkFromSnap(docSnap) {
    return {
        id: docSnap.id,
        ...docSnap.data()
    };
}

function workspaceLinkSortName(link, activeWorkspace) {
    return workspaceLinkDisplayName(link, activeWorkspace);
}

function uniqueLinks(snaps, activeWorkspace) {
    const links = new Map();

    snaps.forEach(snap => {
        snap.docs.forEach(docSnap => {
            links.set(docSnap.id, linkFromSnap(docSnap));
        });
    });

    return [...links.values()]
        .sort((a, b) =>
            workspaceLinkSortName(a, activeWorkspace)
                .localeCompare(workspaceLinkSortName(b, activeWorkspace))
        );
}

function ownerPendingLinkQuery(firestoreModule, linksRef, user) {
    if (!user?.uid) return null;

    return firestoreModule.query(
        linksRef,
        firestoreModule.where("toOwnerUid", "==", user.uid)
    );
}

async function workspaceLinkQueries(firestoreModule, linksRef, workspace, user) {
    const queries = [
        firestoreModule.query(
            linksRef,
            firestoreModule.where("fromWorkspaceId", "==", workspace.id)
        ),
        firestoreModule.query(
            linksRef,
            firestoreModule.where("toWorkspaceId", "==", workspace.id)
        )
    ];
    const ownerQuery = ownerPendingLinkQuery(firestoreModule, linksRef, user);

    if (ownerQuery) queries.push(ownerQuery);

    return Promise.all(queries.map(queryRef =>
        firestoreModule.getDocs(queryRef)
    ));
}

function activeWorkspaceTargetPayload(firestoreModule, activeWorkspace) {
    return {
        toWorkspaceId: cleanWorkspaceId(activeWorkspace.id),
        toWorkspaceName: workspaceName(activeWorkspace),
        updatedAt: firestoreModule.serverTimestamp()
    };
}

export function isOwnerPendingWorkspaceLink(
    link,
    user = getCurrentFirebaseUser()
) {
    return Boolean(
        link &&
        !link.toWorkspaceId &&
        link.toOwnerUid &&
        user?.uid &&
        link.toOwnerUid === user.uid
    );
}

export function workspaceLinkDisplayName(
    link,
    activeWorkspace = getActiveWorkspace()
) {
    const isSource = link.fromWorkspaceId === activeWorkspace?.id;

    if (isSource) {
        return (
            cleanText(link.toWorkspaceName) ||
            cleanText(link.toOwnerEmail) ||
            "Unidad solicitada"
        );
    }

    return (
        cleanText(link.fromWorkspaceName) ||
        cleanText(link.requestedByName) ||
        "Unidad solicitante"
    );
}

function canResolveLinkFromActiveWorkspace(link, activeWorkspace, user) {
    if (link.toWorkspaceId === activeWorkspace.id) return true;

    return isOwnerPendingWorkspaceLink(link, user);
}

function ensureLinkCanResolveHere(link, activeWorkspace, user) {
    if (!canResolveLinkFromActiveWorkspace(link, activeWorkspace, user)) {
        throw new Error("Solo la unidad invitada puede responder este enlace.");
    }

    if (link.fromWorkspaceId === activeWorkspace.id) {
        throw new Error("No puedes enlazar la unidad activa consigo misma.");
    }
}

function responsePayloadForLink(
    payload,
    link,
    firestoreModule,
    activeWorkspace
) {
    if (link.toWorkspaceId) {
        return {
            ...payload,
            updatedAt: firestoreModule.serverTimestamp()
        };
    }

    return {
        ...payload,
        ...activeWorkspaceTargetPayload(firestoreModule, activeWorkspace)
    };
}

export async function requestWorkspaceLink(targetOwnerEmail) {
    const email = cleanEmail(targetOwnerEmail);
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para solicitar enlaces.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona una unidad antes de solicitar un enlace.");
    }

    if (!email) {
        throw new Error("Ingresa el correo del owner de la unidad que quieres enlazar.");
    }

    const result = await callLinkedUnitFunction(
        "requestWorkspaceLinkByOwnerEmail",
        {
            fromWorkspaceId: activeWorkspace.id,
            ownerEmail: email
        }
    );

    return result.linkId || "";
}

export async function listWorkspaceLinks(workspace = getActiveWorkspace()) {
    if (!workspace?.id) return [];

    const user = getCurrentFirebaseUser();
    const { db, firestoreModule } = await getFirebaseServices();
    const linksRef =
        firestoreModule.collection(db, "workspaceLinks");
    const snaps = await workspaceLinkQueries(
        firestoreModule,
        linksRef,
        workspace,
        user
    );

    return uniqueLinks(snaps, workspace);
}

export async function acceptWorkspaceLink(linkId) {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para aceptar enlaces.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona una unidad antes de aceptar enlaces.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(db, "workspaceLinks", linkId);
    const linkSnap = await firestoreModule.getDoc(linkRef);

    if (!linkSnap.exists()) {
        throw new Error("La solicitud de enlace ya no existe.");
    }

    const link = linkSnap.data() || {};

    ensureLinkCanResolveHere(link, activeWorkspace, user);

    await firestoreModule.updateDoc(linkRef, responsePayloadForLink({
        status: "accepted",
        acceptedAt: firestoreModule.serverTimestamp(),
        acceptedByUid: user.uid,
        acceptedByName: userName(user)
    }, link, firestoreModule, activeWorkspace));
}

export async function rejectWorkspaceLink(linkId, reason = "") {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona una unidad antes de rechazar enlaces.");
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const linkRef = firestoreModule.doc(db, "workspaceLinks", linkId);
    const linkSnap = await firestoreModule.getDoc(linkRef);

    if (!linkSnap.exists()) {
        throw new Error("La solicitud de enlace ya no existe.");
    }

    const link = linkSnap.data() || {};

    ensureLinkCanResolveHere(link, activeWorkspace, user);

    await firestoreModule.updateDoc(linkRef, responsePayloadForLink({
        status: "rejected",
        rejectedAt: firestoreModule.serverTimestamp(),
        rejectedByUid: user?.uid || "",
        rejectedByName: userName(user),
        rejectReason: cleanText(reason)
    }, link, firestoreModule, activeWorkspace));
}

export async function unlinkWorkspaceLink(linkId) {
    const activeWorkspace = getActiveWorkspace();
    const user = getCurrentFirebaseUser();

    if (!user) {
        throw new Error("Debes iniciar sesion para desenlazar unidades.");
    }

    if (!activeWorkspace?.id) {
        throw new Error("Selecciona una unidad antes de desenlazar unidades.");
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
        throw new Error("Este enlace no pertenece a la unidad activa.");
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
