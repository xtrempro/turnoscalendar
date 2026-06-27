function parseCalendarKey(key) {
    const [year, month, day] = String(key || "")
        .split("-")
        .map(Number);

    if (!year || !Number.isInteger(month) || !day) return null;

    const date = new Date(year, month, day);

    return Number.isNaN(date.getTime()) ? null : date;
}

function calendarKeyFromDate(date) {
    return [
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    ].join("-");
}

export function sortReplacementLeaveKeys(keys) {
    return Array.from(new Set(keys || []))
        .filter(key => parseCalendarKey(key))
        .sort((a, b) => parseCalendarKey(a) - parseCalendarKey(b));
}

function nextCalendarKey(key) {
    const date = parseCalendarKey(key);

    if (!date) return "";

    date.setDate(date.getDate() + 1);

    return calendarKeyFromDate(date);
}

function nextBusinessKey(key, isBusinessDay) {
    const date = parseCalendarKey(key);

    if (!date) return "";

    do {
        date.setDate(date.getDate() + 1);
    } while (!isBusinessDay(date));

    return calendarKeyFromDate(date);
}

export function groupContinuousReplacementLeaveKeys(
    keys,
    options = {}
) {
    const sortedKeys = sortReplacementLeaveKeys(keys);
    const businessContinuity = options.businessContinuity === true;
    const isBusinessDay = typeof options.isBusinessDay === "function"
        ? options.isBusinessDay
        : date => date.getDay() !== 0 && date.getDay() !== 6;
    const groups = [];
    let current = [];

    sortedKeys.forEach(key => {
        const previous = current[current.length - 1];
        const followsCalendar = previous &&
            key === nextCalendarKey(previous);
        const followsBusinessCalendar =
            previous &&
            businessContinuity &&
            key === nextBusinessKey(previous, isBusinessDay);

        if (
            previous &&
            !followsCalendar &&
            !followsBusinessCalendar
        ) {
            groups.push(current);
            current = [];
        }

        current.push(key);
    });

    if (current.length) groups.push(current);

    return groups;
}
