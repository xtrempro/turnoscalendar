import {
    getCurrentFirebaseUser,
    getFirebaseServices
} from "./firebaseClient.js";
import { getActiveWorkspace, listUserWorkspaces } from "./workspaces.js";
import { showChoice } from "./dialogs.js";

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

function ensureLinkCanResolveHere(
    link,
    activeWorkspace,
    user,
    targetWorkspace = null
) {
    if (!canResolveLinkFromActiveWorkspace(link, activeWorkspace, user)) {
        throw new Error("Solo la unidad invitada puede responder este enlace.");
    }

    // Contra la unidad que va a quedar enlazada, que no siempre es la activa:
    // el owner puede estar parado en una unidad y enlazar otra suya.
    const target = targetWorkspace || activeWorkspace;

    if (link.fromWorkspaceId === target.id) {
        throw new Error("No puedes enlazar una unidad consigo misma.");
    }
}

/**
 * Unidades de las que este usuario es OWNER.
 *
 * Son las unicas a las que se puede amarrar un enlace: las reglas exigen
 * isOwner(toWorkspaceId) para responder la solicitud.
 */
export async function listLinkTargetWorkspaces(user = getCurrentFirebaseUser()) {
    const workspaces = await listUserWorkspaces(user);

    return workspaces.filter(workspace =>
        String(workspace?.role || "") === "owner"
    );
}

/**
 * Pregunta a CUAL de sus unidades quiere enlazar.
 *
 * La solicitud llega por el correo del owner, y un owner puede tener varias
 * unidades: sin esta pregunta el enlace se amarraba en silencio a la unidad que
 * tuviera activa en ese momento, que no tiene por que ser la que le estan
 * pidiendo. Se pregunta siempre, incluso con una sola unidad, para que quede a
 * la vista cual quedo enlazada.
 *
 * @returns {Promise<{id: string, name: string}|null>} null si se cancela.
 */
export async function chooseWorkspaceForLink(link = {}) {
    const options = (await listLinkTargetWorkspaces()).filter(workspace =>
        workspace.id !== link.fromWorkspaceId
    );

    if (!options.length) {
        throw new Error(
            "No tienes unidades propias para enlazar. Solo el owner de una unidad puede aceptar un enlace."
        );
    }

    const requester = cleanText(link.fromWorkspaceName, "Otra unidad");
    const expected = cleanText(link.expectedWorkspaceName);
    const chosenId = await showChoice(
        [
            `La unidad "${requester}" quiere enlazarse con una de las tuyas.`,
            expected
                ? `Dice esperar la unidad "${expected}".`
                : "",
            "Elige a cuál enlazarla:"
        ].filter(Boolean).join(" "),
        {
            title: "Elegir unidad a enlazar",
            confirmText: "Enlazar",
            choices: options.map(workspace => ({
                value: workspace.id,
                label: workspaceName(workspace),
                hint: workspace.id
            }))
        }
    );

    if (!chosenId) return null;

    const chosen = options.find(workspace => workspace.id === chosenId);

    return chosen
        ? { id: chosen.id, name: workspaceName(chosen) }
        : null;
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

export async function requestWorkspaceLink(
    targetOwnerEmail,
    expectedWorkspaceName = ""
) {
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
            ownerEmail: email,
            // No decide nada -el owner elige al aceptar- pero le dice cual de
            // sus unidades le estan pidiendo.
            expectedWorkspaceName: cleanText(expectedWorkspaceName)
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

/**
 * Acepta la solicitud y la amarra a una unidad.
 *
 * `targetWorkspace` es la unidad ELEGIDA por el owner (chooseWorkspaceForLink).
 * Sin ella se cae en la unidad activa, que es lo que se hacia antes y solo
 * sirve cuando la solicitud ya venia dirigida a una unidad concreta.
 */
export async function acceptWorkspaceLink(linkId, targetWorkspace = null) {
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
    const target = targetWorkspace?.id
        ? targetWorkspace
        : activeWorkspace;

    ensureLinkCanResolveHere(link, activeWorkspace, user, target);

    await firestoreModule.updateDoc(linkRef, responsePayloadForLink({
        status: "accepted",
        acceptedAt: firestoreModule.serverTimestamp(),
        acceptedByUid: user.uid,
        acceptedByName: userName(user)
    }, link, firestoreModule, target));
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
