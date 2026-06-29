export const cellRefs = new Map();

export function calendarCellRefKey(workerId, date) {
    return `${String(workerId || "")}::${String(date || "")}`;
}

export function registerCalendarCell(workerId, date, cell) {
    const refKey = calendarCellRefKey(workerId, date);

    if (cell) cellRefs.set(refKey, cell);
    return cell;
}

export function getCalendarCell(workerId, date) {
    return cellRefs.get(calendarCellRefKey(workerId, date)) || null;
}

export function replaceCalendarCell(workerId, date, nextCell) {
    const refKey = calendarCellRefKey(workerId, date);
    const previous = cellRefs.get(refKey);

    if (!previous?.isConnected || !nextCell) return false;

    previous.replaceWith(nextCell);
    cellRefs.set(refKey, nextCell);
    return true;
}

export function clearCalendarCellRefs(workerId = "") {
    const prefix = `${String(workerId || "")}::`;

    if (!workerId) {
        cellRefs.clear();
        return;
    }

    [...cellRefs.keys()].forEach(refKey => {
        if (refKey.startsWith(prefix)) cellRefs.delete(refKey);
    });
}

export function diffCalendarRecordKeys(previous = {}, next = {}) {
    const keys = new Set([
        ...Object.keys(previous || {}),
        ...Object.keys(next || {})
    ]);

    return [...keys].filter(key =>
        JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key])
    );
}

export function calendarKeyInMonth(keyDay, year, month) {
    const [keyYear, keyMonth] = String(keyDay || "")
        .split("-")
        .map(Number);

    return keyYear === Number(year) && keyMonth === Number(month);
}

export function keysForCalendarRange(startDate, endDate) {
    const parseLocalDate = value => {
        if (value instanceof Date) return new Date(value);

        const match = String(value || "")
            .match(/^(\d{4})-(\d{2})-(\d{2})$/);

        return match
            ? new Date(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3])
            )
            : new Date(value);
    };
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return [];
    }

    const from = start <= end ? start : end;
    const to = start <= end ? end : start;
    const keys = [];
    const cursor = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate()
    );

    while (cursor <= to) {
        keys.push(
            `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
        );
        cursor.setDate(cursor.getDate() + 1);
    }

    return keys;
}
