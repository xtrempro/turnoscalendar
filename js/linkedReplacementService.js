import { getFirebaseServices } from "./firebaseClient.js";

function cleanText(value, maxLength = 160) {
    return String(value || "").trim().slice(0, maxLength);
}

function normalizeCandidate(candidate = {}) {
    const availability = candidate.availability || {};

    return {
        workerId: cleanText(candidate.workerId, 120),
        name: cleanText(candidate.name),
        estamento: cleanText(candidate.estamento, 100),
        profession: cleanText(candidate.profession),
        role: cleanText(candidate.role),
        workspaceId: cleanText(candidate.workspaceId, 160),
        workspaceName: cleanText(candidate.workspaceName),
        linkId: cleanText(candidate.linkId, 220),
        availability: {
            date: cleanText(availability.date, 10),
            available: availability.available === true,
            currentTurn: Number(availability.currentTurn) || 0,
            blocked: availability.blocked === true
        }
    };
}

// Unico punto de entrada del frontend para consultar personal de otras
// unidades. No mantiene listeners, cache ni estado precargado: la Function se
// invoca exclusivamente desde la accion explicita del modal de sugerencias.
export async function findCompatibleReplacementInLinkedUnits(params = {}) {
    const requesterWorkspaceId = cleanText(
        params.requesterWorkspaceId,
        160
    );
    const date = cleanText(params.date, 10);
    const turnCode = cleanText(params.turnCode, 8);
    const targetProfile = {
        estamento: cleanText(params.targetProfile?.estamento, 100),
        profession: cleanText(params.targetProfile?.profession, 160)
    };

    if (
        !requesterWorkspaceId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !turnCode ||
        !targetProfile.estamento
    ) {
        throw new Error("No fue posible preparar la busqueda en unidades enlazadas.");
    }

    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(
        functions,
        "findCompatibleReplacementInLinkedUnits"
    );
    const result = await callable({
        requesterWorkspaceId,
        date,
        turnCode,
        targetProfile
    });
    const data = result.data || {};

    return {
        date,
        candidates: (Array.isArray(data.candidates) ? data.candidates : [])
            .map(normalizeCandidate)
            .filter(candidate =>
                candidate.workerId &&
                candidate.name &&
                candidate.workspaceId &&
                candidate.availability.available
            ),
        units: Array.isArray(data.units) ? data.units : [],
        failedUnits: Array.isArray(data.failedUnits)
            ? data.failedUnits.map(item => cleanText(item))
            : [],
        message: cleanText(data.message, 500)
    };
}
