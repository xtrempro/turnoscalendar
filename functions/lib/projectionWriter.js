"use strict";

// Escribe la proyección del worker-app en Firestore con la MISMA estructura que
// producía el cliente (ver js/workerAppDataSync.js): los días van troceados por
// mes a workerAppData/{uid}/months/{YYYY-MM}, y el resto del payload al doc raíz
// workerAppData/{uid} (sin `days`, que se borra del raíz). La PWA lee los meses
// vía getWorkerAppMonth y el resto por su listener del doc raíz.

const { FieldValue } = require("firebase-admin/firestore");

function splitDaysByMonth(days = {}) {
    const months = {};

    Object.entries(days || {}).forEach(([iso, value]) => {
        const month = String(iso || "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) return;
        if (!months[month]) months[month] = {};
        months[month][iso] = value;
    });

    return months;
}

function monthScheduleBounds(days = {}) {
    const dates = Object.keys(days).sort();
    return { start: dates[0] || "", end: dates[dates.length - 1] || "" };
}

// stableStringify + hashText (FNV-1a) idénticos al cliente, para que los
// monthHashes coincidan con los que la PWA ya cachea.
function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`
        ).join(",")}}`;
    }
    return JSON.stringify(value);
}

function hashText(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function monthDaysHash(days) {
    return hashText(stableStringify(days || {}));
}

function workerAppDataDoc(db, workspaceId, uid) {
    return db
        .collection("workspaces").doc(workspaceId)
        .collection("workerAppData").doc(uid);
}

async function writeProjection(db, workspaceId, uid, payload) {
    if (!uid) return { availableMonths: [], monthHashes: {} };

    const months = splitDaysByMonth(payload.days);
    const availableMonths = Object.keys(months).sort();
    const monthHashes = {};
    const batch = db.batch();
    const rootRef = workerAppDataDoc(db, workspaceId, uid);
    const monthsCol = rootRef.collection("months");

    for (const [month, days] of Object.entries(months)) {
        monthHashes[month] = monthDaysHash(days);
        const bounds = monthScheduleBounds(days);

        batch.set(monthsCol.doc(month), {
            uid,
            workspaceId,
            month,
            profileName: payload.profileName || "",
            profileRut: payload.profileRut || "",
            scheduleStart: bounds.start,
            scheduleEnd: bounds.end,
            days,
            updatedAtISO: payload.updatedAtISO || "",
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    }

    // Doc raíz: todo el payload MENOS `days` (que se borra), más el índice de
    // meses y los metadatos de almacenamiento mensual.
    const { days: _days, ...rootBase } = payload || {};

    batch.set(rootRef, {
        ...rootBase,
        days: FieldValue.delete(),
        calendarStorageVersion: 3,
        calendarStorageMode: "monthly",
        hasMonthlyCalendar: true,
        availableMonths,
        monthHashes,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();

    return { availableMonths, monthHashes };
}

module.exports = {
    writeProjection,
    splitDaysByMonth,
    monthScheduleBounds,
    monthDaysHash
};
