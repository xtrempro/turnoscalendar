const TURN = Object.freeze({
    FREE: 0,
    LONG: 1,
    NIGHT: 2,
    TWENTY_FOUR: 3,
    DAY: 4,
    DAY_NIGHT: 5,
    HALF_MORNING: 6,
    HALF_AFTERNOON: 7,
    EIGHTEEN: 8
});

const canceledTasks = new Set();

function roundHour(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function roundExtra(value) {
    const rounded = Math.round((Number(value) || 0) * 2) / 2;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function parseISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const date = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    ));

    return Number.isNaN(date.getTime()) ? null : date;
}

function dateISO(date) {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
}

function keyDay(date) {
    return [
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    ].join("-");
}

function addUtcDays(date, amount) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + amount);
    return next;
}

function isBusinessDay(date, holidays = {}) {
    const weekday = date.getUTCDay();
    return weekday !== 0 && weekday !== 6 && !holidays[keyDay(date)];
}

function nightHours(date, holidays = {}) {
    const weekday = date.getUTCDay();
    const currentBusiness = isBusinessDay(date, holidays);
    const nextBusiness = isBusinessDay(addUtcDays(date, 1), holidays);

    if (weekday === 1) {
        return currentBusiness && nextBusiness
            ? { d: 2, n: 10 }
            : { d: 1, n: 11 };
    }
    if ([2, 3, 4].includes(weekday)) {
        if (currentBusiness && nextBusiness) return { d: 2, n: 10 };
        if (currentBusiness || nextBusiness) return { d: 1, n: 11 };
        return { d: 0, n: 12 };
    }
    if (weekday === 5) {
        return currentBusiness ? { d: 1, n: 11 } : { d: 0, n: 12 };
    }
    if (weekday === 6) return { d: 0, n: 12 };
    return nextBusiness ? { d: 1, n: 11 } : { d: 0, n: 12 };
}

function twentyFourHours(date, holidays = {}) {
    const currentBusiness = isBusinessDay(date, holidays);
    const nextBusiness = isBusinessDay(addUtcDays(date, 1), holidays);

    if (currentBusiness && nextBusiness) return { d: 14, n: 10 };
    if (currentBusiness && !nextBusiness) return { d: 13, n: 11 };
    if (!currentBusiness && nextBusiness) return { d: 1, n: 23 };
    return { d: 0, n: 24 };
}

function dayHours(date, state, holidays = {}) {
    const turn = Number(state) || TURN.FREE;

    if (turn === TURN.FREE) return { d: 0, n: 0 };
    if (turn === TURN.LONG) {
        return isBusinessDay(date, holidays)
            ? { d: 12, n: 0 }
            : { d: 0, n: 12 };
    }
    if (turn === TURN.NIGHT) return nightHours(date, holidays);
    if (turn === TURN.TWENTY_FOUR) {
        return twentyFourHours(date, holidays);
    }
    if (turn === TURN.DAY) {
        return isBusinessDay(date, holidays)
            ? { d: 8.8, n: 0 }
            : { d: 0, n: 0 };
    }
    if (turn === TURN.DAY_NIGHT) {
        const night = nightHours(date, holidays);
        return {
            d: (isBusinessDay(date, holidays) ? 8.8 : 0) + night.d,
            n: night.n
        };
    }
    if (
        turn === TURN.HALF_MORNING ||
        turn === TURN.HALF_AFTERNOON
    ) {
        return isBusinessDay(date, holidays)
            ? { d: 6, n: 0 }
            : { d: 0, n: 6 };
    }
    if (turn === TURN.EIGHTEEN) {
        const night = nightHours(date, holidays);
        const half = isBusinessDay(date, holidays)
            ? { d: 6, n: 0 }
            : { d: 0, n: 6 };
        return { d: half.d + night.d, n: half.n + night.n };
    }

    return { d: 0, n: 0 };
}

function carryForLastDay(date, state, holidays = {}) {
    if (![2, 3, 5, 8].includes(Number(state))) {
        return { d: 0, n: 0 };
    }

    const nextBusiness = isBusinessDay(addUtcDays(date, 1), holidays);
    return nextBusiness ? { d: 1, n: 7 } : { d: 0, n: 8 };
}

export function calculateMonth(payload = {}) {
    const holidays = payload.holidays || {};
    const workers = Array.isArray(payload.workers) ? payload.workers : [];

    return {
        year: Number(payload.year),
        month: Number(payload.month),
        workerTotals: workers.map(worker => {
            const days = Array.isArray(worker.days) ? worker.days : [];
            const totals = days.reduce((sum, day) => {
                const date = parseISODate(day.iso);
                const hours = date
                    ? dayHours(date, day.state, holidays)
                    : { d: 0, n: 0 };
                sum.d += hours.d;
                sum.n += hours.n;
                if (date && isBusinessDay(date, holidays)) {
                    sum.base += 8.8;
                }
                return sum;
            }, { d: 0, n: 0, base: 0 });
            const carryIn = worker.carryIn || { d: 0, n: 0 };
            const last = days.at(-1);
            const lastDate = parseISODate(last?.iso);
            const carryOut = lastDate
                ? carryForLastDay(lastDate, last.state, holidays)
                : { d: 0, n: 0 };

            return {
                workerId: String(worker.workerId || worker.id || ""),
                totalD: roundHour(totals.d + (Number(carryIn.d) || 0)),
                totalN: roundHour(totals.n + (Number(carryIn.n) || 0)),
                businessHours: roundHour(totals.base),
                hheeDiurnas: roundExtra(
                    totals.d + (Number(carryIn.d) || 0) - totals.base
                ),
                hheeNocturnas: roundExtra(
                    totals.n + (Number(carryIn.n) || 0)
                ),
                carryOut
            };
        })
    };
}

export function generateSchedule(payload = {}) {
    const start = parseISODate(payload.startISO);
    const end = parseISODate(payload.endISO);
    const holidays = payload.holidays || {};
    const sequence = Array.isArray(payload.sequence)
        ? payload.sequence.map(Number)
        : [];
    const mode = String(payload.mode || "sequence");

    if (!start || !end || start > end) {
        throw new Error("Rango de generación de turnos inválido.");
    }
    if (mode === "sequence" && !sequence.length) {
        throw new Error("La secuencia de turnos está vacía.");
    }

    const entries = [];
    let position = 0;

    for (
        let cursor = new Date(start);
        cursor <= end;
        cursor = addUtcDays(cursor, 1)
    ) {
        const turn = mode === "diurno"
            ? (isBusinessDay(cursor, holidays) ? TURN.DAY : TURN.FREE)
            : (Number(sequence[position++ % sequence.length]) || TURN.FREE);

        entries.push({
            iso: dateISO(cursor),
            keyDay: keyDay(cursor),
            turn
        });
    }

    return { entries };
}

export function validateAbsences(payload = {}) {
    const records = Array.isArray(payload.records) ? payload.records : [];
    const warnings = [];
    const byWorker = new Map();

    records.forEach(record => {
        const workerId = String(record.workerId || "");
        if (!workerId) return;
        const items = byWorker.get(workerId) || [];
        items.push({
            id: String(record.id || ""),
            start: String(record.start || record.date || ""),
            end: String(record.end || record.start || record.date || "")
        });
        byWorker.set(workerId, items);
    });

    byWorker.forEach((items, workerId) => {
        items.sort((left, right) => left.start.localeCompare(right.start));
        for (let index = 1; index < items.length; index++) {
            const previous = items[index - 1];
            const current = items[index];
            if (current.start <= previous.end) {
                warnings.push({
                    workerId,
                    type: "overlap",
                    recordIds: [previous.id, current.id]
                });
            }
        }
    });

    return { warnings };
}

export function searchReplacements(payload = {}) {
    const requiredRole = String(payload.requiredRole || "");
    const requiredProfession = String(payload.requiredProfession || "");
    const candidates = Array.isArray(payload.candidates)
        ? payload.candidates
        : [];

    if (payload.mode === "turnoplus-prepared") {
        return {
            candidates: [...candidates].sort((left, right) => {
                if (
                    Boolean(left.isDiurnoLongCoverage) !==
                    Boolean(right.isDiurnoLongCoverage)
                ) {
                    return left.isDiurnoLongCoverage ? 1 : -1;
                }
                if (Boolean(left.blockedDay) !== Boolean(right.blockedDay)) {
                    return left.blockedDay ? 1 : -1;
                }
                if (Boolean(left.isFree) !== Boolean(right.isFree)) {
                    return left.isFree ? -1 : 1;
                }
                const leftPriority = Number.isFinite(
                    Number(left.replacementPriority)
                )
                    ? Number(left.replacementPriority)
                    : 20;
                const rightPriority = Number.isFinite(
                    Number(right.replacementPriority)
                )
                    ? Number(right.replacementPriority)
                    : 20;

                if (leftPriority !== rightPriority) {
                    return leftPriority - rightPriority;
                }
                if (Number(left.hhee) !== Number(right.hhee)) {
                    return (Number(left.hhee) || 0) -
                        (Number(right.hhee) || 0);
                }
                return String(left.profile?.name || "").localeCompare(
                    String(right.profile?.name || "")
                );
            })
        };
    }

    return {
        candidates: candidates
            .filter(candidate =>
                candidate.active !== false &&
                candidate.available !== false &&
                !candidate.hasAbsence &&
                !candidate.blocked
            )
            .map(candidate => ({
                ...candidate,
                score:
                    (candidate.role === requiredRole ? 100 : 0) +
                    (candidate.profession === requiredProfession ? 40 : 0) -
                    Math.max(0, Number(candidate.monthlyHhee) || 0) -
                    Math.max(0, Number(candidate.replacements) || 0) * 5
            }))
            .sort((left, right) =>
                right.score - left.score ||
                String(left.name || "").localeCompare(String(right.name || ""))
            )
    };
}

export function runScheduleTask(type, payload) {
    if (type === "CALCULATE_MONTH") return calculateMonth(payload);
    if (type === "GENERATE_SCHEDULE") return generateSchedule(payload);
    if (type === "VALIDATE_ABSENCES") return validateAbsences(payload);
    if (type === "SEARCH_REPLACEMENTS") return searchReplacements(payload);
    throw new Error(`Tarea de worker no soportada: ${type}`);
}

const workerScope = typeof self !== "undefined" ? self : null;

if (workerScope?.addEventListener && workerScope?.postMessage) {
    workerScope.addEventListener("message", event => {
        const message = event.data || {};

        if (message.type === "CANCEL_TASK") {
            canceledTasks.add(message.taskId);
            return;
        }

        const taskId = message.taskId;

        try {
            const payload = runScheduleTask(message.type, message.payload);

            if (!canceledTasks.has(taskId)) {
                workerScope.postMessage({ taskId, ok: true, payload });
            }
        } catch (error) {
            if (!canceledTasks.has(taskId)) {
                workerScope.postMessage({
                    taskId,
                    ok: false,
                    error: error?.message || String(error)
                });
            }
        } finally {
            canceledTasks.delete(taskId);
        }
    });
}
