const LINK_FINGERPRINT_FIELDS = [
    "uid",
    "profileName",
    "profileRut",
    "workerEmail",
    "workspaceName",
    "status"
];

function linkFingerprint(link = {}) {
    return LINK_FINGERPRINT_FIELDS
        .map(field => String(link[field] ?? "").trim())
        .join("\u001f");
}

/**
 * Compara dos snapshots de enlaces PWA sin depender de Firestore.
 * Los eliminados se informan aparte porque ya no tienen un documento destino.
 */
export function diffWorkerLinks(previousLinks = [], nextLinks = []) {
    const previousByUid = new Map(
        previousLinks.map(link => [String(link?.uid || ""), link])
    );
    const nextByUid = new Map(
        nextLinks.map(link => [String(link?.uid || ""), link])
    );
    const changedUids = [];
    const removedUids = [];

    nextByUid.forEach((link, uid) => {
        const previous = previousByUid.get(uid);

        if (!previous || linkFingerprint(previous) !== linkFingerprint(link)) {
            changedUids.push(uid);
        }
    });

    previousByUid.forEach((_link, uid) => {
        if (!nextByUid.has(uid)) removedUids.push(uid);
    });

    return { changedUids, removedUids };
}

export function planWorkerLinkSnapshot(
    previousLinks,
    nextLinks,
    initialized = false
) {
    const initial = !initialized;
    const { changedUids, removedUids } = diffWorkerLinks(
        previousLinks,
        nextLinks
    );

    return {
        initial,
        changedUids,
        removedUids,
        shouldPublish: !initial &&
            Boolean(changedUids.length || removedUids.length)
    };
}

export function yieldToMainThread() {
    if (typeof globalThis.scheduler?.yield === "function") {
        return globalThis.scheduler.yield();
    }

    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Ejecuta una tarea a la vez y cede el hilo entre elementos. `shouldContinue`
 * permite cancelar limpiamente al cambiar de entorno de trabajo.
 */
export async function runCooperativeQueue(
    items,
    handler,
    {
        shouldContinue = () => true,
        yieldControl = yieldToMainThread
    } = {}
) {
    const list = Array.from(items || []);
    let processed = 0;

    for (let index = 0; index < list.length; index++) {
        if (!shouldContinue()) {
            return { completed: false, processed };
        }

        await handler(list[index], index);
        processed++;

        if (index < list.length - 1) {
            await yieldControl();
        }
    }

    return {
        completed: shouldContinue(),
        processed
    };
}
