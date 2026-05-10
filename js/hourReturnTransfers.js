import { getCurrentProfile } from "./storage.js";
import { getJSON, setJSON } from "./persistence.js";

function storageKey(profile) {
    return `hheeReturnTransfers_${profile}`;
}

export function hheeReturnTransferMonthKey(year, month) {
    return `${year}-${month}`;
}

function roundTransferHours(value) {
    return Math.max(
        0,
        Math.round((Number(value) || 0) * 100) / 100
    );
}

export function calculateHheeReturnTransferHours(dayHours, nightHours) {
    return roundTransferHours(
        Math.max(0, Number(dayHours) || 0) * 1.25 +
        Math.max(0, Number(nightHours) || 0) * 1.5
    );
}

export function getHheeReturnTransfers(
    profile = getCurrentProfile()
) {
    if (!profile) return {};

    return getJSON(storageKey(profile), {});
}

export function getHheeReturnTransfer(
    profile = getCurrentProfile(),
    year = new Date().getFullYear(),
    month = new Date().getMonth()
) {
    if (!profile) return null;

    return getHheeReturnTransfers(profile)[
        hheeReturnTransferMonthKey(year, month)
    ] || null;
}

export function saveHheeReturnTransfer(
    profile = getCurrentProfile(),
    year = new Date().getFullYear(),
    month = new Date().getMonth(),
    record = {}
) {
    if (!profile) return null;

    const transfers = getHheeReturnTransfers(profile);
    const key = hheeReturnTransferMonthKey(year, month);
    const next = {
        ...(transfers[key] || {}),
        ...record,
        year,
        month,
        monthKey: key,
        enabled: Boolean(record.enabled),
        transferredHours: roundTransferHours(
            record.transferredHours
        ),
        hheeDiurnas: roundTransferHours(record.hheeDiurnas),
        hheeNocturnas: roundTransferHours(record.hheeNocturnas),
        updatedAt: new Date().toISOString()
    };

    transfers[key] = next;
    setJSON(storageKey(profile), transfers);

    return next;
}

export function isHheeReturnTransferEnabled(
    profile = getCurrentProfile(),
    year = new Date().getFullYear(),
    month = new Date().getMonth()
) {
    return Boolean(
        getHheeReturnTransfer(profile, year, month)?.enabled
    );
}
