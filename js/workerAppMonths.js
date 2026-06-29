export function splitDaysByMonth(days = {}) {
    const months = {};

    Object.entries(days || {}).forEach(([iso, value]) => {
        const month = String(iso || "").slice(0, 7);

        if (!/^\d{4}-\d{2}$/.test(month)) return;

        if (!months[month]) months[month] = {};
        months[month][iso] = value;
    });

    return months;
}

export function monthScheduleBounds(days = {}) {
    const dates = Object.keys(days).sort();

    return {
        start: dates[0] || "",
        end: dates[dates.length - 1] || ""
    };
}

export function normalizeProfileTargets(value) {
    const values = Array.isArray(value) ? value : [value];

    return Array.from(new Set(
        values
            .map(item => String(item || "").trim())
            .filter(Boolean)
    ));
}
