// Escribe los dos documentos livianos de cada enlazado, pero SOLO los que
// cambiaron de verdad.
//
// Es la mitad que hace barata la migracion. El navegador del supervisor los
// reescribia todos en cada carga -132 documentos en ~54 s, por sesion-, porque
// no tenia forma barata de saber cuales seguian iguales. Aca se leen de una
// sola pasada (una consulta por coleccion, no 132 lecturas sueltas), se
// comparan ignorando `updatedAtISO` y se escriben los distintos.
//
// En regimen normal eso es CERO escrituras. Cuando hay una de verdad -alguien
// cambio de rotativa, se enlazo un telefono nuevo, se movio un turno- se
// escriben solo las afectadas.

const { FieldValue } = require("firebase-admin/firestore");

// Firestore admite 500 operaciones por lote.
const BATCH_LIMIT = 400;

function collectionRef(db, workspaceId, name) {
    return db
        .collection("workspaces").doc(workspaceId)
        .collection(name);
}

async function readStoredDocs(db, workspaceId, collections) {
    const stored = new Map();

    await Promise.all(collections.map(async (name) => {
        const snap = await collectionRef(db, workspaceId, name).get();

        snap.docs.forEach((docSnap) => {
            stored.set(`${name}/${docSnap.id}`, docSnap.data() || null);
        });
    }));

    return stored;
}

async function commitInBatches(db, operations) {
    for (let index = 0; index < operations.length; index += BATCH_LIMIT) {
        const batch = db.batch();

        operations.slice(index, index + BATCH_LIMIT).forEach((apply) => apply(batch));
        await batch.commit();
    }
}

/**
 * @param {object} db
 * @param {string} workspaceId
 * @param {{documents: Array, duplicates: Array}} built lo que devolvio el motor
 * @param {(stored: object, next: object) => boolean} changed comparador del motor
 * @returns {Promise<{written: number, skipped: number, retired: number}>}
 */
async function writeLinkedWorkerDocs(db, workspaceId, built, changed) {
    const documents = built?.documents || [];
    const duplicates = built?.duplicates || [];

    if (!documents.length && !duplicates.length) {
        return { written: 0, skipped: 0, retired: 0 };
    }

    const collections = [...new Set(documents.map((item) => item.collection))];
    const stored = await readStoredDocs(
        db,
        workspaceId,
        collections.length ? collections : ["workerMessageDirectory", "workerSwapCandidates"]
    );

    const operations = [];
    let skipped = 0;

    documents.forEach(({ collection, uid, payload }) => {
        const current = stored.get(`${collection}/${uid}`);

        if (!changed(current, payload)) {
            skipped += 1;
            return;
        }

        operations.push((batch) => {
            batch.set(
                collectionRef(db, workspaceId, collection).doc(uid),
                { ...payload, updatedAt: FieldValue.serverTimestamp() }
            );
        });
    });

    // Una persona con dos cuentas: al enlace viejo se le retiran sus documentos
    // para que la PWA no la liste ni la ofrezca dos veces. No se borra
    // `workerLinks`, que es la decision del supervisor.
    const retired = [];

    duplicates.forEach((uid) => {
        const directory = stored.get(`workerMessageDirectory/${uid}`);
        const candidate = stored.get(`workerSwapCandidates/${uid}`);

        if (directory && directory.status !== "unlinked") {
            retired.push(uid);
            operations.push((batch) => {
                batch.set(
                    collectionRef(db, workspaceId, "workerMessageDirectory").doc(uid),
                    { status: "unlinked", updatedAt: FieldValue.serverTimestamp() },
                    { merge: true }
                );
            });
        }

        if (candidate && candidate.status !== "inactive") {
            operations.push((batch) => {
                batch.set(
                    collectionRef(db, workspaceId, "workerSwapCandidates").doc(uid),
                    { status: "inactive", updatedAt: FieldValue.serverTimestamp() },
                    { merge: true }
                );
            });
        }
    });

    await commitInBatches(db, operations);

    return {
        written: operations.length,
        skipped,
        retired: retired.length
    };
}

module.exports = { writeLinkedWorkerDocs };
