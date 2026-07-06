import { keyToDate } from "./dateUtils.js";
import { getJSON } from "./persistence.js";

const LEAVE_LABELS = {
    admin: "P. Administrativo",
    half_admin_morning: "1/2 ADM Ma\u00f1ana",
    half_admin_afternoon: "1/2 ADM Tarde",
    legal: "F. Legal",
    comp: "F. Compensatorio",
    license: "Licencia M\u00e9dica",
    professional_license: "LM Profesional",
    union_leave: "Permiso Gremial",
    unpaid_leave: "Permiso sin Goce",
    unjustified_absence: "Ausencia Injustificada"
};

function normalizeType(value) {
    const type = String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (type.includes("gremial")) return "union_leave";
    if (type === "medical_license") return "license";
    return type;
}

function absenceType(value) {
    if (!value) return "";
    if (typeof value === "string") return normalizeType(value);

    return normalizeType(
        value.type ||
        value.kind ||
        value.code ||
        value.label ||
        value.name
    );
}

function adminType(value) {
    if (value === "0.5M") return "half_admin_morning";
    if (value === "0.5T") return "half_admin_afternoon";

    const type = normalizeType(value?.type || value?.kind);

    if (type === "half_admin_morning" || type === "half_admin_afternoon") {
        return type;
    }

    return "admin";
}

function validKey(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === month &&
        date.getDate() === day
    );
}

function keyYear(key) {
    return validKey(key) ? Number(String(key).split("-")[0]) : null;
}

function compareKeys(left, right) {
    return keyToDate(left).getTime() - keyToDate(right).getTime();
}

function isNextDay(previousKey, nextKey) {
    const date = keyToDate(previousKey);
    date.setDate(date.getDate() + 1);
    return date.getTime() === keyToDate(nextKey).getTime();
}

function numericAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function activeDaysForYear({
    year,
    adminDays = {},
    legalDays = {},
    compDays = {},
    absences = {}
}) {
    const days = new Map();
    const add = (key, type, amount = 1) => {
        if (keyYear(key) !== Number(year) || !type) return;
        days.set(key, { type, amount });
    };

    Object.entries(adminDays || {}).forEach(([key, value]) => {
        if (!value) return;
        const type = adminType(value);
        add(key, type, type.startsWith("half_admin_") ? 0.5 : 1);
    });
    Object.entries(legalDays || {}).forEach(([key, value]) => {
        if (value) add(key, "legal");
    });
    Object.entries(compDays || {}).forEach(([key, value]) => {
        if (value) add(key, "comp");
    });
    Object.entries(absences || {}).forEach(([key, value]) => {
        if (value) add(key, absenceType(value));
    });

    return days;
}

function logProfile(log) {
    return String(log?.meta?.profile || log?.profile || "");
}

function logKeys(log) {
    const keys = Array.isArray(log?.meta?.keys)
        ? log.meta.keys
        : [];

    return [...new Set(keys.filter(validKey))].sort(compareKeys);
}

function recordFromKeys({
    id,
    type,
    keys,
    amount = null,
    createdAt = "",
    source = "stored"
}) {
    const sortedKeys = [...keys].sort(compareKeys);

    return {
        id,
        type,
        label: LEAVE_LABELS[type] || "Ausencia",
        startKey: sortedKeys[0],
        endKey: sortedKeys[sortedKeys.length - 1],
        keys: sortedKeys,
        amount,
        createdAt,
        source
    };
}

function recordsFromLogs({ profileName, year, auditLogs, activeDays, consumed }) {
    return (Array.isArray(auditLogs) ? auditLogs : [])
        .filter(log =>
            log &&
            !log.canceledAt &&
            log.category === "leave_absence" &&
            logProfile(log) === String(profileName || "")
        )
        .map((log, index) => {
            const type = normalizeType(log?.meta?.type);
            if (!type) return null;

            const allLogKeys = logKeys(log);
            const originalKeys = allLogKeys
                .filter(key => keyYear(key) === Number(year));
            const keys = originalKeys.filter(key =>
                activeDays.get(key)?.type === type &&
                !consumed.has(key)
            );

            if (!keys.length) return null;

            keys.forEach(key => consumed.add(key));

            const completeApplication =
                keys.length === originalKeys.length &&
                originalKeys.length === allLogKeys.length;
            const storedAmount = completeApplication
                ? numericAmount(log?.meta?.amount)
                : null;
            const amount = storedAmount ?? (
                type !== "legal" && type !== "comp"
                    ? keys.reduce(
                        (total, key) => total + activeDays.get(key).amount,
                        0
                    )
                    : null
            );

            return recordFromKeys({
                id: String(log.id || `audit_${index}`),
                type,
                keys,
                amount,
                createdAt: String(log.createdAt || ""),
                source: "audit"
            });
        })
        .filter(Boolean);
}

function fallbackRecords(activeDays, consumed) {
    const remaining = [...activeDays.keys()]
        .filter(key => !consumed.has(key))
        .sort(compareKeys);
    const groups = [];

    remaining.forEach(key => {
        const day = activeDays.get(key);
        const current = groups[groups.length - 1];

        if (
            current &&
            current.type === day.type &&
            isNextDay(current.keys[current.keys.length - 1], key)
        ) {
            current.keys.push(key);
            return;
        }

        groups.push({ type: day.type, keys: [key] });
    });

    return groups.map((group, index) => {
        const amount = group.type !== "legal" && group.type !== "comp"
            ? group.keys.reduce(
                (total, key) => total + activeDays.get(key).amount,
                0
            )
            : null;

        return recordFromKeys({
            id: `stored_${group.keys[0]}_${index}`,
            type: group.type,
            keys: group.keys,
            amount
        });
    });
}

export function buildProfileLeaveHistory({
    profileName,
    year,
    adminDays = {},
    legalDays = {},
    compDays = {},
    absences = {},
    auditLogs = []
}) {
    const activeDays = activeDaysForYear({
        year,
        adminDays,
        legalDays,
        compDays,
        absences
    });
    const consumed = new Set();
    const records = [
        ...recordsFromLogs({
            profileName,
            year,
            auditLogs,
            activeDays,
            consumed
        }),
        ...fallbackRecords(activeDays, consumed)
    ];

    return records.sort((left, right) =>
        compareKeys(right.startKey, left.startKey) ||
        String(right.createdAt).localeCompare(String(left.createdAt))
    );
}

function profileData(profileName) {
    const profile = String(profileName || "");

    return {
        adminDays: getJSON(`admin_${profile}`, {}),
        legalDays: getJSON(`legal_${profile}`, {}),
        compDays: getJSON(`comp_${profile}`, {}),
        absences: getJSON(`absences_${profile}`, {}),
        auditLogs: getJSON("auditLog", [])
    };
}

export function getProfileLeaveHistory(profileName, year) {
    return buildProfileLeaveHistory({
        profileName,
        year,
        ...profileData(profileName)
    });
}

export function getProfileLeaveHistoryYears(
    profileName,
    currentYear = new Date().getFullYear()
) {
    const data = profileData(profileName);
    const years = new Set([Number(currentYear)]);

    [
        data.adminDays,
        data.legalDays,
        data.compDays,
        data.absences
    ].forEach(map => {
        Object.keys(map || {}).forEach(key => {
            const year = keyYear(key);
            if (year) years.add(year);
        });
    });

    return [...years].sort((left, right) => right - left);
}
