import { getJSON, setJSON } from "./persistence.js";

const MANUAL_HOLIDAYS_KEY = "manualHolidays";

let holidaysCache = {};

function holidayKeyFromISO(isoDate) {
    const [year, month, day] = String(isoDate || "")
        .split("-")
        .map(Number);

    if (!year || !month || !day) return "";

    return `${year}-${month - 1}-${day}`;
}

function normalizeManualHoliday(item) {
    const date = String(item?.date || "").trim();
    const key = holidayKeyFromISO(date);

    if (!key) return null;

    return {
        date,
        name: String(item?.name || "Feriado manual").trim() || "Feriado manual"
    };
}

function manualHolidayMap(year) {
    return getManualHolidays()
        .filter(item => Number(item.date.slice(0, 4)) === Number(year))
        .reduce((acc, item) => {
            const key = holidayKeyFromISO(item.date);
            if (key) acc[key] = item.name || true;
            return acc;
        }, {});
}

export function getCachedHolidays(year){
    return holidaysCache[year] || {};
}

export function clearHolidaysCache(year = null) {
    if (year === null || year === undefined) {
        holidaysCache = {};
        return;
    }

    delete holidaysCache[year];
}

export function getManualHolidays() {
    const unique = new Map();

    getJSON(MANUAL_HOLIDAYS_KEY, [])
        .map(normalizeManualHoliday)
        .filter(Boolean)
        .forEach(item => {
            unique.set(item.date, item);
        });

    return Array.from(unique.values())
        .sort((a, b) => a.date.localeCompare(b.date));
}

export function saveManualHolidays(holidays = []) {
    const unique = new Map();

    holidays
        .map(normalizeManualHoliday)
        .filter(Boolean)
        .forEach(item => {
            unique.set(item.date, item);
        });

    setJSON(
        MANUAL_HOLIDAYS_KEY,
        Array.from(unique.values())
            .sort((a, b) => a.date.localeCompare(b.date))
    );

    clearHolidaysCache();
}

export async function fetchHolidays(year){
    if(holidaysCache[year]) return holidaysCache[year];

    // Cache persistente (solo feriados oficiales) para evitar el fetch de red en
    // cada recarga. Los feriados manuales se combinan frescos en cada carga.
    const persisted = getJSON(`holidaysCache_${year}`, null);

    if (
        persisted &&
        typeof persisted === "object" &&
        Object.keys(persisted).length
    ) {
        const merged = { ...persisted, ...manualHolidayMap(year) };
        holidaysCache[year] = merged;
        return merged;
    }

    const official = {};

    try {
        const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/CL`);
        const data = await r.json();

        data.forEach(d=>{
            const [holidayYear, month, day] = d.date.split("-").map(Number);
            official[`${holidayYear}-${month - 1}-${day}`] = d.localName || true;
        });

        if (Object.keys(official).length) {
            setJSON(`holidaysCache_${year}`, official);
        }
    } catch {
        // Si la API no responde, se mantienen al menos los feriados manuales.
    }

    const h = { ...official, ...manualHolidayMap(year) };

    holidaysCache[year] = h;
    return h;
}
