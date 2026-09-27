import { getJSON, setJSON } from "./persistence.js";
import { isoFromKey } from "./dateUtils.js";

const KEY = "leaveCancellationBarriers";

function barrierKey(profile, date) {
    const worker = String(profile || "").trim().toUpperCase();
    const isoDate = String(date || "").trim();

    return worker && isoDate ? `${isoDate}|${worker}` : "";
}

export function markLeaveCancellation(profile, keys = [], logId = "") {
    const barriers = getJSON(KEY, {});
    const canceledAt = new Date().toISOString();

    keys.map(isoFromKey).filter(Boolean).forEach(date => {
        const key = barrierKey(profile, date);

        if (key) barriers[key] = { logId: String(logId || ""), canceledAt };
    });

    setJSON(KEY, barriers);
}

export function clearLeaveCancellation(profile, keys = []) {
    const barriers = getJSON(KEY, {});
    let changed = false;

    keys.map(isoFromKey).filter(Boolean).forEach(date => {
        const key = barrierKey(profile, date);

        if (key && Object.prototype.hasOwnProperty.call(barriers, key)) {
            delete barriers[key];
            changed = true;
        }
    });

    if (changed) setJSON(KEY, barriers);
}

export function hasLeaveCancellationBarrier(profile, date) {
    return Boolean(getLeaveCancellationBarrier(profile, date));
}

export function getLeaveCancellationBarrier(profile, date) {
    const key = barrierKey(profile, date);

    return key ? (getJSON(KEY, {})[key] || null) : null;
}
