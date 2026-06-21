import { normalizeText } from "./stringUtils.js";
import { getFirebaseServices } from "./firebaseClient.js";

let blockedDays = [];
let unsubscribeBlockedDays = null;

function normalizeProfileName(value) {
    return normalizeText(value);
}

function normalizeDate(value) {
    const text = String(value || "").slice(0, 10);

    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function keyToISODate(keyDay) {
    const parts = String(keyDay || "").split("-");

    if (parts.length !== 3) return "";

    return [
        parts[0],
        String(Number(parts[1]) + 1).padStart(2, "0"),
        String(Number(parts[2])).padStart(2, "0")
    ].join("-");
}

function normalizeBlockedDay(id, data = {}) {
    const date = normalizeDate(data.date || data.day || data.iso);
    const profileName = String(
        data.profileName ||
        data.profile ||
        data.workerDisplayName ||
        ""
    ).trim();

    if (!date || !profileName) return null;
    if (["canceled", "deleted", "inactive"].includes(String(data.status || ""))) {
        return null;
    }

    return {
        id: String(data.id || id || ""),
        date,
        profileName,
        profileKey: normalizeProfileName(profileName),
        workerUid: String(data.workerUid || ""),
        profileRut: String(data.profileRut || ""),
        reason: String(data.reason || "Compromiso personal"),
        message: String(
            data.supervisorMessage ||
            "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha."
        ),
        replacementAllowed: data.replacementAllowed !== false
    };
}

export function getBlockedDayForProfile(profileName, keyDay) {
    const profileKey = normalizeProfileName(profileName);
    const date = keyToISODate(keyDay);

    if (!profileKey || !date) return null;

    return blockedDays.find(item =>
        item.profileKey === profileKey &&
        item.date === date
    ) || null;
}

export function getWorkerBlockedDays() {
    return [...blockedDays];
}

export function stopWorkerAvailabilitySync() {
    if (unsubscribeBlockedDays) {
        unsubscribeBlockedDays();
        unsubscribeBlockedDays = null;
    }

    blockedDays = [];
}

export async function startWorkerAvailabilitySync(workspace, options = {}) {
    stopWorkerAvailabilitySync();

    if (!workspace?.id) {
        options.onChange?.([]);
        return;
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const ref = firestoreModule.collection(
        db,
        "workspaces",
        workspace.id,
        "workerBlockedDays"
    );

    unsubscribeBlockedDays = firestoreModule.onSnapshot(
        ref,
        snap => {
            blockedDays = snap.docs
                .map(docSnap => normalizeBlockedDay(docSnap.id, docSnap.data()))
                .filter(Boolean)
                .sort((a, b) =>
                    a.date.localeCompare(b.date) ||
                    a.profileName.localeCompare(b.profileName)
                );
            options.onChange?.(blockedDays);
        },
        error => {
            console.warn("No se pudieron cargar dias bloqueados de trabajadores.", error);
            blockedDays = [];
            options.onChange?.(blockedDays);
        }
    );
}
