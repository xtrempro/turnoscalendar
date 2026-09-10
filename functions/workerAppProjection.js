"use strict";

// Trigger que materializa la proyección del worker-app en el servidor. El
// supervisor, tras editar, escribe un marcador en
// workspaces/{wsId}/projectionRequests/{id} con los perfiles afectados. Aquí se
// reconstruye el estado del workspace, se corre el motor REAL del cliente (bundle
// functions/engine) por cada trabajador enlazado y se escribe su proyección.
// Reemplaza el pipeline que antes corría en el hilo principal del navegador.

const admin = require("firebase-admin");
const {
    onDocumentCreated,
    onDocumentWritten
} = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const {
    computeProjectionsForProfiles,
    buildLinkedWorkerDocs,
    loadEngine
} = require("./lib/engineHarness");
const { writeProjection } = require("./lib/projectionWriter");
const { writeLinkedWorkerDocs } = require("./lib/linkedDocsWriter");

const REQUIRED_CONTRACT_PROFILE_VERSION = 2;

function normalizeProfileTargets(value) {
    const values = Array.isArray(value) ? value : [value];

    return Array.from(new Set(
        values.map(item => String(item || "").trim()).filter(Boolean)
    ));
}

async function loadWorkspaceMeta(db, workspaceId) {
    const snap = await db.collection("workspaces").doc(workspaceId).get();
    const data = snap.data() || {};

    return {
        id: workspaceId,
        name: String(data.name || data.displayName || "").trim()
    };
}

async function loadWorkerLinks(db, workspaceId) {
    const snap = await db
        .collection("workspaces").doc(workspaceId)
        .collection("workerLinks").get();

    return snap.docs
        .map(docSnap => {
            const data = docSnap.data() || {};
            const uid = String(data.uid || docSnap.id || "").trim();
            return uid ? { id: docSnap.id, ...data, uid } : null;
        })
        .filter(Boolean);
}

const WORKER_LINK_PROJECTION_FIELDS = [
    "profileName",
    "profileRut",
    "profileId",
    "inviteId",
    "uid",
    "workerEmail",
    "status"
];

function snapshotExists(snapshot) {
    if (!snapshot) return false;
    if (typeof snapshot.exists === "function") return snapshot.exists();
    return snapshot.exists === true;
}

function snapshotData(snapshot) {
    return snapshotExists(snapshot) && typeof snapshot.data === "function"
        ? snapshot.data() || {}
        : null;
}

function workerLinkProjectionPlan(before, after) {
    if (!after) return { shouldEnqueue: false, reason: "deleted" };

    const profileName = String(after.profileName || "").trim();

    if (!profileName) {
        return { shouldEnqueue: false, reason: "missing_profile" };
    }

    if (!before) {
        return {
            shouldEnqueue: true,
            profileName,
            source: "worker_link_created"
        };
    }

    const relevantChanged = WORKER_LINK_PROJECTION_FIELDS.some(field =>
        String(before[field] || "").trim() !==
            String(after[field] || "").trim()
    );

    return relevantChanged
        ? {
            shouldEnqueue: true,
            profileName,
            source: "worker_link_updated"
        }
        : { shouldEnqueue: false, reason: "unchanged" };
}

// Al crear o actualizar el enlace (el trabajador acepta/reacepta la invitacion)
// se encola de una vez su proyeccion, sin depender de que el navegador del
// supervisor este abierto. Si el doc ya existia y solo se actualizaba por un
// segundo enlace, onCreate no corria y la PWA quedaba vinculada pero sin turnos.
exports.requestProjectionOnWorkerLink = onDocumentWritten(
    {
        document: "workspaces/{workspaceId}/workerLinks/{workerUid}"
    },
    async (event) => {
        const before = snapshotData(event.data?.before);
        const after = snapshotData(event.data?.after);
        const plan = workerLinkProjectionPlan(before, after);

        if (!plan.shouldEnqueue) {
            if (plan.reason !== "missing_profile") return;
            logger.warn("worker link sin profileName; no se encola proyeccion", {
                workspaceId: event.params.workspaceId,
                workerUid: event.params.workerUid
            });
            return;
        }

        const { workspaceId } = event.params;
        const db = admin.firestore();

        try {
            await db
                .collection("workspaces").doc(workspaceId)
                .collection("projectionRequests")
                .add({
                    profiles: [plan.profileName],
                    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
                    source: plan.source
                });

            logger.info("proyeccion encolada al enlazar trabajador", {
                workspaceId,
                profile: plan.profileName,
                source: plan.source
            });
        } catch (error) {
            logger.error("no se pudo encolar la proyeccion al enlazar", {
                workspaceId,
                error: error?.message || String(error)
            });
        }
    }
);

// De un workspace: nombres de perfil de los trabajadores ENLAZADOS que todavia
// no tienen una proyeccion real. `projectedUids` son los uid cuyo workerAppData
// YA fue proyectado (tiene status). No basta con que el doc exista: la propia
// app del trabajador crea un workerAppData parcial (bloqueos/swap, SIN status ni
// turnos) antes de la primera proyeccion; esos hay que proyectarlos igual. Puro
// (sin Firestore) para poder testearlo.
function missingProjectionProfiles(linkDocs, projectedUids) {
    const projected = new Set(projectedUids);
    const missing = new Set();

    linkDocs.forEach(data => {
        const uid = String(data?.uid || "").trim();
        const profileName = String(data?.profileName || "").trim();

        if (uid && profileName && !projected.has(uid)) {
            missing.add(profileName);
        }
    });

    return [...missing];
}

// uid con proyeccion real: su workerAppData tiene un status final (active o
// inactive). Un doc sin status es parcial y profile_not_found se reintenta:
// puede ser un enlace con nombre desactualizado que ahora calza por RUT.
function projectedUidsFromDocs(dataDocs) {
    return dataDocs
        .filter(doc => {
            const status = String(doc?.status || "").trim();
            const contractProfileVersion =
                Number(doc?.contractProfileVersion) || 0;
            return (
                status &&
                status !== "profile_not_found" &&
                contractProfileVersion >= REQUIRED_CONTRACT_PROFILE_VERSION
            );
        })
        .map(doc => doc.id);
}

// Autocompleta las proyecciones faltantes: trabajadores enlazados que aun no
// tienen workerAppData (p.ej. se enlazaron antes del trigger onCreate, con el
// supervisor desconectado). Se auto-limita: al proyectarlos se crea su
// workerAppData y la siguiente corrida ya no los toca. Lee SOLO los IDs
// (select), asi el barrido es barato aunque las proyecciones sean grandes.
exports.backfillMissingWorkerProjections = onSchedule(
    {
        schedule: "every 24 hours",
        // Cloud Scheduler no esta disponible en southamerica-west1 (region por
        // defecto del proyecto); las demas funciones programadas usan us-central1.
        region: "us-central1",
        timeZone: "America/Santiago",
        timeoutSeconds: 540,
        memory: "512MiB"
    },
    async () => {
        const db = admin.firestore();
        const workspacesSnap = await db.collection("workspaces").select().get();
        let enqueued = 0;

        for (const wsDoc of workspacesSnap.docs) {
            const workspaceId = wsDoc.id;

            try {
                const wsRef = db.collection("workspaces").doc(workspaceId);
                const [linksSnap, dataSnap] = await Promise.all([
                    wsRef.collection("workerLinks").select("uid", "profileName").get(),
                    wsRef.collection("workerAppData")
                        .select("status", "contractProfileVersion")
                        .get()
                ]);

                if (linksSnap.empty) continue;

                const projectedUids = projectedUidsFromDocs(
                    dataSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
                );
                const missing = missingProjectionProfiles(
                    linksSnap.docs.map(doc => ({ uid: doc.id, ...(doc.data() || {}) })),
                    projectedUids
                );

                if (!missing.length) continue;

                await wsRef.collection("projectionRequests").add({
                    profiles: missing,
                    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
                    source: "backfill_missing"
                });

                enqueued += 1;
                logger.info("backfill: proyeccion encolada", {
                    workspaceId,
                    missing: missing.length
                });
            } catch (error) {
                logger.error("backfill: fallo en workspace", {
                    workspaceId,
                    error: error?.message || String(error)
                });
            }
        }

        logger.info("backfill de proyecciones completado", {
            workspaces: workspacesSnap.size,
            enqueued
        });
    }
);

async function loadWorkerBlockedDays(db, workspaceId) {
    const snap = await db
        .collection("workspaces").doc(workspaceId)
        .collection("workerBlockedDays").get();

    return snap.docs.map(docSnap => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

// Publica el directorio de mensajes y los candidatos de cambio de turno.
//
// Va SIEMPRE junto a la proyeccion, aunque el marcador nombre a un solo
// trabajador: `compatibleWorkerUids` es cruzado y un cambio de estamento o de
// rotativa mueve la compatibilidad de los demas. Lo que evita que eso cueste
// caro no es publicar menos, es escribir solo lo que cambio.
//
// Mejor-esfuerzo: un fallo aca NO puede tumbar la proyeccion, que es lo que
// mueve los turnos en el telefono.
async function publishLinkedWorkerDocs(db, workspaceId, workspace, links) {
    if (!links.length) return;

    try {
        const blockedDays = await loadWorkerBlockedDays(db, workspaceId);
        const built = await buildLinkedWorkerDocs(db, {
            workspace,
            links,
            blockedDays
        });
        const engine = await loadEngine();
        const result = await writeLinkedWorkerDocs(
            db,
            workspaceId,
            built,
            engine.linkedDocChanged
        );

        logger.info("worker-app linked docs published", {
            workspaceId,
            linked: links.length,
            built: built.documents.length,
            ...result,
            failed: built.failed?.length || 0,
            unmatchedLinks: built.unmatchedLinks?.length || 0
        });
    } catch (error) {
        logger.error("worker-app linked docs failed", {
            workspaceId,
            error: error?.message || String(error)
        });
    }
}

exports.buildWorkerAppProjection = onDocumentCreated(
    {
        document: "workspaces/{workspaceId}/projectionRequests/{requestId}",
        // Serializa las invocaciones por instancia: el motor usa globalThis
        // (localStorage shim) y una cache de feriados de módulo que se resetea
        // por invocación; con concurrencia > 1 se pisarían entre sí.
        concurrency: 1,
        memory: "512MiB",
        timeoutSeconds: 300
    },
    async (event) => {
        const { workspaceId } = event.params;
        const ref = event.data?.ref;
        const request = event.data?.data() || {};
        const profileNames = normalizeProfileTargets(request.profiles);

        if (!profileNames.length) {
            if (ref) await ref.delete().catch(() => {});
            return;
        }

        const db = admin.firestore();

        try {
            const [workspace, links] = await Promise.all([
                loadWorkspaceMeta(db, workspaceId),
                loadWorkerLinks(db, workspaceId)
            ]);

            if (profileNames.length) {
                const results = await computeProjectionsForProfiles(db, {
                    workspace,
                    profileNames,
                    links
                });

                for (const { link, payload } of results) {
                    if (link.uid) {
                        await writeProjection(db, workspaceId, link.uid, payload);
                    }
                }

                logger.info("worker-app projection built", {
                    workspaceId,
                    requested: profileNames.length,
                    projected: results.length
                });
            }

            await publishLinkedWorkerDocs(db, workspaceId, workspace, links);
        } catch (error) {
            // Mejor-esfuerzo: se registra y se descarta el marcador. La próxima
            // edición del supervisor crea uno nuevo y recomputa.
            logger.error("worker-app projection failed", {
                workspaceId,
                error: error?.message || String(error)
            });
        } finally {
            if (ref) await ref.delete().catch(() => {});
        }
    }
);
