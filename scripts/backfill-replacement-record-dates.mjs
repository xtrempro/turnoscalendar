// Completa `date` y `month` en los documentos de `replacementRecords` que no los
// tienen arriba (los creo la carga inicial de la copia paralela, el 28-09-2026).
// Son los campos por los que se consultara por fecha/mes cuando la app lea de
// esta coleccion en vez de la lista `replacements`.
//
// Solo COPIA `record.date` a `date` y su `AAAA-MM` a `month`: no toca `record`,
// `revision` ni ningun otro campo, asi que ningun lector ve un reemplazo
// distinto. Por defecto lee y muestra el plan; con --apply:
//   - exige el nombre exacto de la unidad (--expected-name);
//   - guarda antes un respaldo de los documentos a cambiar en migration-backups/;
//   - escribe cada documento con la precondicion `updateTime` de la lectura (si
//     la app lo reescribio entretanto, esa escritura falla y no pisa nada; la
//     escritura de la app ya trae date/month, asi que no hace falta reintentar);
//   - relee la coleccion y verifica que todos los documentos vivos tengan fecha.
//
//   node scripts/backfill-replacement-record-dates.mjs --workspace <id> --expected-name <nombre> [--apply]

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
    replacementRecordDate,
    replacementRecordMonth
} from "../js/replacementRecordStore.js";
import {
    createFirestoreRestClient,
    firestoreValue,
    plainDocument
} from "./lib/firebase-rest.mjs";

// La REST de Firestore responde una precondicion `updateTime` vencida con 400
// FAILED_PRECONDITION (y una contencion con 409 ABORTED).
function isPreconditionConflict(error) {
    return error?.code === "FAILED_PRECONDITION" || error?.code === "ABORTED";
}

function documentId(document) {
    return String(document?.name || "").split("/").pop();
}

/**
 * Una fecha de calendario REAL en AAAA-MM-DD. `replacementRecordDate` solo mira
 * el patron (aceptaria 2026-13-40); aqui se exige ademas que el dia exista. Es
 * local al script a proposito: endurecer el helper global cambiaria a sus otros
 * consumidores sin revisarlos (auditoria GPT 19-11, P2-1).
 */
export function strictCalendarDate(value) {
    const date = replacementRecordDate(value);

    if (!date) return "";

    const [year, month, day] = date.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    return parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
        ? date
        : "";
}

/**
 * Que documentos completar. Los tombstones (deleted) se dejan como estan: su
 * fecha es opcional y no se consultan por mes. Uno con `record.date` ilegible
 * tampoco se toca: se informa para revisarlo a mano.
 *
 * "Ya tiene fecha" significa que `date` y `month` COINCIDEN con `record.date`,
 * no solo que existan: unos metadatos de otro mes harian que la consulta por mes
 * no lo encontrara. La verificacion final usa esta misma condicion estricta.
 */
export function planReplacementRecordDateBackfill(documents = []) {
    const patches = [];
    const unreadable = [];
    let alreadyDated = 0;
    let tombstones = 0;

    for (const document of documents) {
        const data = plainDocument(document);

        if (data.deleted === true) {
            tombstones++;
            continue;
        }

        // Primero el registro: una fecha rota en `record` no se da por buena
        // aunque arriba haya una fecha con buena forma.
        const date = strictCalendarDate(data.record?.date);

        if (!date) {
            unreadable.push({ id: documentId(document), date: data.record?.date ?? null });
            continue;
        }
        if (data.date === date && data.month === replacementRecordMonth(date)) {
            alreadyDated++;
            continue;
        }

        patches.push({
            id: documentId(document),
            name: document.name,
            updateTime: document.updateTime,
            date,
            month: replacementRecordMonth(date)
        });
    }

    return { patches, unreadable, alreadyDated, tombstones, total: documents.length };
}

export async function backfillReplacementRecordDates({
    client,
    projectId,
    workspaceId,
    expectedName,
    apply = false,
    backupDirectory = "migration-backups",
    logResult = console.log
}) {
    if (!workspaceId || !expectedName) {
        throw new Error("Usa --workspace y --expected-name.");
    }

    const root = `workspaces/${encodeURIComponent(workspaceId)}`;
    const workspace = plainDocument(await client.getDocument(root));

    if (String(workspace.name || "") !== expectedName) {
        throw new Error(
            `ABORTA: se esperaba "${expectedName}" y la unidad es ` +
            `"${workspace.name || "(sin nombre)"}".`
        );
    }

    const collection = `${root}/replacementRecords`;
    const documents = await client.listDocuments(collection);
    const plan = planReplacementRecordDateBackfill(documents);
    const summary = {
        projectId,
        workspaceId,
        workspaceName: workspace.name,
        mode: apply ? "ESCRITURA" : "SOLO LECTURA",
        total: plan.total,
        alreadyDated: plan.alreadyDated,
        tombstones: plan.tombstones,
        toComplete: plan.patches.length,
        unreadable: plan.unreadable
    };

    logResult(JSON.stringify(summary, null, 2));

    if (plan.unreadable.length) {
        throw new Error(
            "Hay reemplazos con una fecha ilegible. Revisalos antes de completar el resto."
        );
    }
    if (!apply || !plan.patches.length) return { ...summary, written: 0, conflicts: [] };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.resolve(
        backupDirectory,
        `${encodeURIComponent(projectId)}_${encodeURIComponent(workspaceId)}_replacementRecords-dates_${stamp}.json`
    );
    const byName = new Map(documents.map(document => [document.name, document]));

    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(backupPath, `${JSON.stringify({
        projectId,
        workspaceId,
        workspaceName: workspace.name,
        backedUpAt: new Date().toISOString(),
        documents: plan.patches.map(patch => byName.get(patch.name))
    }, null, 2)}\n`, "utf8");
    logResult(`Respaldo: ${backupPath}`);

    let written = 0;
    const conflicts = [];

    for (const patch of plan.patches) {
        try {
            await client.patchDocument(
                // El id ya viene codificado (lleva `%`): en la URL va otra vez.
                `${collection}/${encodeURIComponent(patch.id)}`,
                { date: firestoreValue(patch.date), month: firestoreValue(patch.month) },
                ["date", "month"],
                patch.updateTime
            );
            written++;
        } catch (error) {
            // Solo una precondicion fallida es un "conflicto" esperable: la app
            // reescribio el documento despues de nuestra lectura, y su escritura
            // ya trae date/month (la verificacion final lo confirma). Un permiso,
            // una credencial vencida, un argumento invalido o un fallo de red se
            // propagan: no son conflictos y seguir solo los taparia (P3-1).
            if (!isPreconditionConflict(error)) {
                logResult(JSON.stringify({ written, conflicts: conflicts.length, stoppedAt: patch.id }, null, 2));
                throw new Error(
                    `Se detuvo en ${patch.id} por un error que no es de version ` +
                    `(${error?.status || "sin estado"} ${error?.code || ""}). ` +
                    `Ya se escribieron ${written}; el respaldo esta en ${backupPath}. ` +
                    `El script es idempotente: corrige la causa y vuelve a correrlo.`,
                    { cause: error }
                );
            }
            conflicts.push({ id: patch.id, error: String(error?.message || error).slice(0, 200) });
        }
    }

    const after = planReplacementRecordDateBackfill(await client.listDocuments(collection));

    logResult(JSON.stringify({
        written,
        conflicts: conflicts.length,
        remainingWithoutDate: after.patches.length,
        unreadableAfter: after.unreadable.length
    }, null, 2));

    if (after.patches.length || after.unreadable.length) {
        throw new Error(
            `VERIFICACION: aun quedan ${after.patches.length} documentos sin fecha. ` +
            "Vuelve a correr el script (es idempotente) y revisa los conflictos."
        );
    }

    logResult("Verificacion OK: todos los documentos vivos tienen date y month.");
    return { ...summary, written, conflicts, backupPath };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const args = process.argv.slice(2);
    const arg = name => {
        const index = args.indexOf(name);
        return index < 0 ? "" : String(args[index + 1] || "");
    };
    const projectId = arg("--project") || "calendarioturnos-7c4d9";

    await backfillReplacementRecordDates({
        client: await createFirestoreRestClient(projectId),
        projectId,
        workspaceId: arg("--workspace"),
        expectedName: arg("--expected-name"),
        apply: args.includes("--apply")
    });
}
