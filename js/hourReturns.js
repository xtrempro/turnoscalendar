import { getCurrentProfile } from "./storage.js";
import { getJSON, setJSON } from "./persistence.js";

function storageKey(profile) {
    return `hourReturns_${profile}`;
}

function roundHours(value) {
    return Math.max(
        0,
        Math.round((Number(value) || 0) * 10) / 10
    );
}

export function getHourReturns(profile = getCurrentProfile()) {
    if (!profile) return {};

    return getJSON(storageKey(profile), {});
}

export function saveHourReturns(
    profile = getCurrentProfile(),
    records = {}
) {
    if (!profile) return;

    setJSON(storageKey(profile), records);
}

export function getHourReturn(
    profile = getCurrentProfile(),
    keyDay = ""
) {
    if (!profile || !keyDay) return null;

    return getHourReturns(profile)[keyDay] || null;
}

export function saveHourReturn(
    profile = getCurrentProfile(),
    keyDay = "",
    record = {}
) {
    if (!profile || !keyDay) return null;

    const records = getHourReturns(profile);
    const next = {
        id: record.id || `${profile}-${keyDay}-${Date.now()}`,
        keyDay,
        profile,
        segmentId: String(record.segmentId || ""),
        segmentLabel: String(record.segmentLabel || ""),
        fullTurn: Boolean(record.fullTurn),
        entryTime: String(record.entryTime || ""),
        exitTime: String(record.exitTime || ""),
        scheduledStart: String(record.scheduledStart || ""),
        scheduledEnd: String(record.scheduledEnd || ""),
        hours: roundHours(record.hours),
        createdAt: record.createdAt || new Date().toISOString()
    };

    records[keyDay] = next;
    saveHourReturns(profile, records);

    return next;
}

export function hourReturnCalendarLabel(record) {
    if (!record) return "";

    return record.fullTurn ? "Devoluci\u00f3n" : "Dev. Parcial";
}

export function hourReturnTimelineMarker(record) {
    if (!record) return "";

    return record.fullTurn ? "D" : "DP";
}
