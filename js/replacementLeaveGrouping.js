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

// Los tipos de permiso que pueden originar un contrato de reemplazo, con la
// etiqueta que ve el supervisor. Vive aqui -y no en main.js, donde estaba-
// porque las ausencias de OTRA unidad tienen que producir exactamente las
// mismas etiquetas e identificadores que las propias.
export const REPLACEMENT_CONTRACT_LEAVE_TYPES = {
    legal: "F. Legal",
    comp: "F. Compensatorios",
    license: "Licencia Médica",
    professional_license: "LM Profesional",
    unpaid_leave: "Permiso sin Goce"
};

// Con continuidad habil se agrupan los que se cuentan en dias habiles: un
// feriado o un fin de semana en medio no parte el rango.
const BUSINESS_CONTINUITY_TYPES = new Set(["legal", "comp"]);

/**
 * El identificador de una opcion de permiso.
 *
 * UNA sola implementacion para todos: si una ausencia ajena se identificara con
 * otra formula, el control de "esta ausencia ya esta ocupada" -que compara por
 * este id- dejaria de calzar sin que nadie lo note.
 */
export function replacementLeaveOptionId({
    profileName,
    type,
    start,
    end
}) {
    return [
        profileName,
        type,
        start,
        end
    ].map(part =>
        encodeURIComponent(String(part || ""))
    ).join("|");
}

/** Un grupo de dias continuos a la opcion que ve el supervisor. */
export function calendarKeysToReplacementLeaveOption({
    profileName,
    type,
    label,
    keys,
    toInputDate
}) {
    const sortedKeys = sortReplacementLeaveKeys(keys);

    if (!sortedKeys.length) return null;

    const start = toInputDate(sortedKeys[0]);
    const end = toInputDate(sortedKeys[sortedKeys.length - 1]);

    if (!start || !end) return null;

    const option = {
        id: "",
        profileName,
        type,
        label,
        start,
        end,
        keys: sortedKeys
    };

    option.id = replacementLeaveOptionId(option);

    return option;
}

/**
 * Las opciones de un trabajador a partir de sus dias sueltos, por tipo.
 *
 * Es lo que usa la busqueda en unidades enlazadas: el servidor devuelve los
 * dias CRUDOS y el agrupado ocurre aqui, con las mismas funciones que agrupan
 * las ausencias propias. `isBusinessDay` y `toInputDate` viajan inyectados
 * porque dependen de los feriados y del formato de fecha, que viven en quien
 * llama.
 *
 * @param {object} leaveKeys tipo -> lista de claves de calendario.
 */
export function optionsFromLeaveKeysByType({
    profileName,
    leaveKeys = {},
    isBusinessDay,
    toInputDate
}) {
    if (!profileName || typeof toInputDate !== "function") return [];

    return Object.entries(leaveKeys)
        .filter(([type]) => REPLACEMENT_CONTRACT_LEAVE_TYPES[type])
        .flatMap(([type, keys]) =>
            groupContinuousReplacementLeaveKeys(keys, {
                businessContinuity: BUSINESS_CONTINUITY_TYPES.has(type),
                isBusinessDay
            }).map(group => calendarKeysToReplacementLeaveOption({
                profileName,
                type,
                label: REPLACEMENT_CONTRACT_LEAVE_TYPES[type],
                keys: group,
                toInputDate
            }))
        )
        .filter(Boolean);
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
