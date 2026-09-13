// Calculos del menu Memorandum: en que estado esta cada memorandum, cuales se
// estan atrasando, como se agrupan por trabajador y que dice cada fila.
//
// Aca no hay DOM ni Firebase a proposito: son cuentas puras sobre lo que ya
// guarda el modulo, para poder probarlas sin levantar el panel.
//
// La regla que manda sobre todo lo demas: el estado NO se marca a mano. Un
// memorandum esta pendiente mientras no tenga ningun documento adjunto, y pasa
// a realizado apenas se adjunta el primero (ver memoStatus).

const DAY_KEY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A los 15 dias sin documento el permiso ya se aplico, el trabajador salio y el
// respaldo no llego: es lo que hay que ir a cobrar.
export const OVERDUE_DAYS = 15;

export const MEMO_STATES = {
    pending: { label: "Pendiente", tone: "danger" },
    done: { label: "Realizado", tone: "ok" }
};

// Los tres origenes que hoy crean memorandum solos, mas el que se agrega a mano.
export const MEMO_KINDS = {
    leave: { label: "Permiso", icon: "cal" },
    clock: { label: "Marcaje", icon: "clock" },
    contract: { label: "Contrato", icon: "swap" },
    manual: { label: "Manual", icon: "memo" }
};

export const MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

export function plural(count, singular, many) {
    return `${count} ${count === 1 ? singular : many}`;
}

/* =========================================================
   Fechas

   Conviven dos formatos: las claves del calendario ("2026-8-16" = 16 de
   SEPTIEMBRE, con el mes en base 0) y las marcas de tiempo ISO de createdAt.
   Todo se lleva a ISO real ("2026-09-16") para poder compararlo y mostrarlo.
========================================================= */

function pad(value) {
    return String(value).padStart(2, "0");
}

function isoFromDate(date) {
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("-");
}

export function parseDayKey(key) {
    const match = String(key || "").match(DAY_KEY_PATTERN);

    if (!match) return null;

    const date = new Date(
        Number(match[1]),
        Number(match[2]),
        Number(match[3])
    );

    return Number.isNaN(date.getTime()) ? null : date;
}

export function dayKeyToISO(key) {
    const date = parseDayKey(key);

    return date ? isoFromDate(date) : "";
}

export function todayISO(now = new Date()) {
    return isoFromDate(now);
}

// La marca de tiempo de creacion, reducida al dia.
export function timestampISO(value) {
    const text = String(value || "");

    if (ISO_PATTERN.test(text.slice(0, 10))) return text.slice(0, 10);

    const date = new Date(text);

    return Number.isNaN(date.getTime()) ? "" : isoFromDate(date);
}

export function timestampTime(value) {
    const text = String(value || "");

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(11, 16);

    const date = new Date(text);

    return Number.isNaN(date.getTime())
        ? ""
        : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatISO(iso) {
    return ISO_PATTERN.test(String(iso || ""))
        ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
        : "—";
}

export function formatDayKey(key) {
    return formatISO(dayKeyToISO(key));
}

export function daysBetweenISO(fromISO, toISO) {
    if (!ISO_PATTERN.test(String(fromISO)) || !ISO_PATTERN.test(String(toISO))) {
        return 0;
    }

    const from = new Date(`${fromISO}T12:00:00`);
    const to = new Date(`${toISO}T12:00:00`);

    return Math.round((to - from) / 86400000);
}

export function monthOfISO(iso) {
    return ISO_PATTERN.test(String(iso || "")) ? iso.slice(0, 7) : "";
}

export function monthLabel(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return "Todos los meses";

    const name = MONTHS[Number(month.slice(5)) - 1] || "";

    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`;
}

export function searchKey(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
}

export function shortName(name) {
    const parts = String(name || "").split(" ").filter(Boolean);

    return parts.length > 2
        ? `${parts[0]} ${parts[parts.length - 2]}`
        : String(name || "");
}

export function initials(name) {
    return String(name || "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join("")
        .toUpperCase() || "?";
}

/* =========================================================
   Estado y origen del memorandum
========================================================= */

export function memoDocuments(memo) {
    return Array.isArray(memo?.documents) ? memo.documents : [];
}

/**
 * Pendiente mientras no haya documento; realizado con el primero adjunto.
 *
 * No se lee memo.status: ese campo se sigue escribiendo para lo que ya existia
 * (y para el calendario), pero quien manda es el adjunto. Asi el estado no
 * puede quedar mintiendo cuando alguien elimina el documento.
 */
export function memoStatus(memo) {
    return memoDocuments(memo).length ? "done" : "pending";
}

export function memoKind(memo) {
    const source = String(memo?.sourceId || "").split(":")[0];

    if (source === "leave") return "leave";
    if (source === "clock") return "clock";
    if (source === "replacement_contract") return "contract";

    return "manual";
}

export function memoStartISO(memo) {
    return dayKeyToISO(memo?.startKey || memo?.dateKey) ||
        timestampISO(memo?.createdAt);
}

export function memoEndISO(memo) {
    return dayKeyToISO(memo?.endKey || memo?.startKey || memo?.dateKey) ||
        memoStartISO(memo);
}

// El periodo de un memorandum es el mes del permiso, no el de cuando se aplico:
// un feriado de octubre pedido en septiembre se busca en octubre.
export function memoMonth(memo) {
    return monthOfISO(memoStartISO(memo));
}

export function memoRangeLabel(memo) {
    const start = memoStartISO(memo);
    const end = memoEndISO(memo);

    return start === end
        ? formatISO(start)
        : `${formatISO(start)} al ${formatISO(end)}`;
}

export function memoDaysOld(memo, today) {
    return daysBetweenISO(timestampISO(memo?.createdAt), today);
}

export function memoIsOverdue(memo, today) {
    return memoStatus(memo) === "pending" &&
        memoDaysOld(memo, today) > OVERDUE_DAYS;
}

export function memoWasRequested(memo) {
    return Boolean(memo?.requestedAt);
}

/* =========================================================
   Lo que muestra cada fila

   El detalle se guardo como texto ("Nombre: X | Permiso: 10 F. Legal | ...")
   porque es lo que se pega en el memorandum. Para la ficha se vuelve a separar
   en campos, sin perder el texto original.
========================================================= */

export function detailFields(detail) {
    const fields = new Map();

    String(detail || "")
        .split("|")
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(part => {
            const separator = part.indexOf(":");

            if (separator <= 0) return;

            fields.set(
                part.slice(0, separator).trim(),
                part.slice(separator + 1).trim()
            );
        });

    return fields;
}

// La cantidad se lee en dias, que es como la cuenta el documento ("Por 5
// dias"). El detalle guardado dice "Permiso: 5 F. Legal" o "1/2 ADM Tarde".
export function memoAmountLabel(memo) {
    const kind = memoKind(memo);

    if (kind === "clock") return "1 turno";

    if (kind === "contract") {
        const days = daysBetweenISO(memoStartISO(memo), memoEndISO(memo)) + 1;

        return days > 0 ? plural(days, "día", "días") : "—";
    }

    const amount = detailFields(memo?.detail).get("Permiso") || "";

    if (amount.startsWith("1/2")) return "1/2 día";

    const number = Number(
        String(amount.match(/^(\d+(?:[.,]\d+)?)\s/)?.[1] || "").replace(",", ".")
    );

    if (amount && Number.isFinite(number) && number > 0) {
        return plural(number, "día", "días");
    }

    const days = Array.isArray(memo?.keys) ? memo.keys.length : 0;

    return days
        ? plural(days, "día", "días")
        : String(memo?.typeLabel || "Memorándum");
}

// Lo que le falto marcar a un marcaje incompleto ("entrada y salida").
export function memoMissingMark(memo) {
    return memoKind(memo) === "clock"
        ? detailFields(memo?.detail).get("Falta de marcaje") || ""
        : "";
}

/**
 * Los tres datos que se leen de un vistazo en la fila, segun el origen.
 *
 * @param {Object} memo
 * @param {{shift?: string}} options la rotativa del trabajador ("4° Turno"),
 *   que no vive en el memorandum sino en su perfil
 */
export function memoFacts(memo, { shift = "" } = {}) {
    const fields = detailFields(memo?.detail);
    const kind = memoKind(memo);
    const start = memoStartISO(memo);
    const end = memoEndISO(memo);
    const dates = {
        label: start === end ? "Fecha" : "Desde / hasta",
        value: memoRangeLabel(memo)
    };

    if (kind === "contract") {
        const detail = [
            fields.get("Reemplaza a") ? `Reemplaza a ${fields.get("Reemplaza a")}` : "",
            fields.get("Motivo del reemplazo") || ""
        ].filter(Boolean).join(" · ");

        return [
            { label: "Cantidad", value: memoAmountLabel(memo) },
            dates,
            { label: "Detalle", value: detail || "—" }
        ];
    }

    if (kind === "manual") {
        return [
            dates,
            fields.get("Referencia")
                ? { label: "Referencia", value: fields.get("Referencia") }
                : null,
            shift ? { label: "Turno", value: shift } : null
        ].filter(Boolean);
    }

    // El marcaje trae el turno de ese dia; el permiso, la rotativa del perfil.
    const turno = kind === "clock" ? fields.get("Turno") || shift : shift;

    return [
        { label: "Cantidad", value: memoAmountLabel(memo) },
        dates,
        turno ? { label: "Turno", value: turno } : null
    ].filter(Boolean);
}

/* =========================================================
   Indicadores y orden
========================================================= */

/**
 * Los cinco numeros del encabezado. Cada uno trae el filtro que aplica al
 * tocarlo, para que el indicador y la lista no puedan contar cosas distintas.
 */
export function memoKpis(memos, today, month = "all") {
    const list = Array.isArray(memos) ? memos : [];
    const inMonth = list.filter(memo =>
        month === "all" || memoMonth(memo) === month
    );
    const pending = list.filter(memo => memoStatus(memo) === "pending");
    const overdue = list.filter(memo => memoIsOverdue(memo, today));
    const requested = pending.filter(memoWasRequested);

    return [
        {
            id: "pendientes",
            value: pending.length,
            label: "Pendientes",
            tone: "danger",
            match: memo => memoStatus(memo) === "pending"
        },
        {
            id: "atrasados",
            value: overdue.length,
            label: `Atrasados (+${OVERDUE_DAYS} días)`,
            tone: "danger",
            match: memo => memoIsOverdue(memo, today)
        },
        {
            id: "pedidos",
            value: requested.length,
            label: "Ya se los pedí",
            tone: "warn",
            match: memo =>
                memoStatus(memo) === "pending" && memoWasRequested(memo)
        },
        {
            id: "realizados",
            value: inMonth.filter(memo => memoStatus(memo) === "done").length,
            label: "Realizados del período",
            tone: "ok",
            match: memo => memoStatus(memo) === "done"
        },
        {
            id: "personas",
            value: new Set(pending.map(memo => memo.profile)).size,
            label: "Trabajadores por cobrar",
            tone: "notice",
            match: memo => memoStatus(memo) === "pending"
        }
    ];
}

/**
 * Primero lo que falta y, dentro de eso, lo mas viejo arriba: es el orden en
 * que hay que ir a cobrar los documentos.
 */
export function sortMemosForList(memos, today) {
    const weight = memo => (memoStatus(memo) === "pending" ? 0 : 1);

    return [...(memos || [])].sort((a, b) =>
        (weight(a) - weight(b)) ||
        (Number(memoIsOverdue(b, today)) - Number(memoIsOverdue(a, today))) ||
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
}

/**
 * Agrupa por trabajador, con los que mas deben arriba.
 */
export function groupByWorker(memos) {
    const groups = new Map();

    (memos || []).forEach(memo => {
        const name = String(memo.profile || "Sin trabajador");

        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(memo);
    });

    return [...groups.entries()]
        .map(([name, list]) => ({
            name,
            memos: list,
            pending: list.filter(memo => memoStatus(memo) === "pending").length
        }))
        .sort((a, b) =>
            (b.pending - a.pending) ||
            a.name.localeCompare(b.name, "es")
        );
}
