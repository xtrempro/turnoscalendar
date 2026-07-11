"use strict";

// Trigger que materializa la proyección del worker-app en el servidor. El
// supervisor, tras editar, escribe un marcador en
// workspaces/{wsId}/projectionRequests/{id} con los perfiles afectados. Aquí se
// reconstruye el estado del workspace, se corre el motor REAL del cliente (bundle
// functions/engine) por cada trabajador enlazado y se escribe su proyección.
// Reemplaza el pipeline que antes corría en el hilo principal del navegador.

const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { computeProjectionsForProfiles } = require("./lib/engineHarness");
const { writeProjection } = require("./lib/projectionWriter");
const { normalizeText } = require("./lib/text");

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

            // Solo se proyecta a trabajadores enlazados a la PWA. Se mapea por
            // nombre de perfil normalizado (el link guarda profileName).
            const linkByName = new Map();
            links.forEach(link => {
                const name = link.profileName || "";
                if (name) linkByName.set(normalizeText(name), link);
            });

            const linksByProfile = new Map();
            const targetProfiles = [];
            profileNames.forEach(name => {
                const link = linkByName.get(normalizeText(name));
                if (link) {
                    linksByProfile.set(name, link);
                    targetProfiles.push(name);
                }
            });

            if (targetProfiles.length) {
                const results = await computeProjectionsForProfiles(db, {
                    workspace,
                    profileNames: targetProfiles,
                    linksByProfile
                });

                for (const { link, payload } of results) {
                    if (link.uid) {
                        await writeProjection(db, workspaceId, link.uid, payload);
                    }
                }

                logger.info("worker-app projection built", {
                    workspaceId,
                    requested: profileNames.length,
                    projected: targetProfiles.length
                });
            }
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
