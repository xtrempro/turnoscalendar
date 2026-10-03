// Motivos de horas extras escritos de distinta forma.
//
// El motivo es texto libre, y el mismo motivo quedaba guardado de varias
// maneras ("APOYO IMAGENOLOGIA - 2", "Apoyo Imagenología -2"...): para la app
// eran motivos distintos (columnas aparte en el Calendario Mensual, repetidos
// al elegir uno, horario mas usado partido). Aqui se decide cuando dos textos
// son EL MISMO motivo: solo cambian mayusculas, tildes o espacios.

import { stripAccents } from "./stringUtils.js";

/**
 * Clave de comparacion: sin tildes, en minusculas, con los espacios juntos y
 * sin espacios alrededor de guiones, barras y puntos.
 */
export function motiveKey(value) {
    return stripAccents(String(value ?? ""))
        .toLocaleLowerCase("es")
        .replace(/\s*([-/.,:])\s*/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Clave -> la forma de escribirlo que se muestra: la mas usada; a igual uso,
 * la que lleva tildes y minusculas (la mejor escrita), y despues la primera.
 *
 * @param {Iterable<string>} texts cada aparicion del motivo (repetidas cuentan)
 */
export function buildMotiveCanon(texts) {
    const counts = new Map();

    for (const raw of texts || []) {
        const text = String(raw ?? "").trim();

        if (!text) continue;

        const key = motiveKey(text);
        const variants = counts.get(key) || new Map();

        variants.set(text, (variants.get(text) || 0) + 1);
        counts.set(key, variants);
    }

    const canon = new Map();

    counts.forEach((variants, key) => {
        const best = [...variants.entries()].sort((a, b) =>
            b[1] - a[1] ||
            writingScore(b[0]) - writingScore(a[0])
        )[0][0];

        canon.set(key, best);
    });

    return canon;
}

// Tildes y minusculas: "Apoyo Imagenología" antes que "APOYO IMAGENOLOGIA".
function writingScore(text) {
    const accents = text.length - stripAccents(text).length +
        (text.normalize("NFD").length - text.length);
    const lower = (text.match(/\p{Ll}/gu) || []).length;

    return accents * 100 + lower;
}

/**
 * El motivo como se muestra: la forma canonica de su clave, o el mismo texto
 * (sin espacios de mas) si no hay otra.
 */
export function canonicalMotive(value, canon) {
    const text = String(value ?? "").trim();

    if (!text) return "";

    return canon?.get(motiveKey(text)) || text;
}

/**
 * Si `value` ya existe escrito de otra forma entre `known`, esa forma (la mas
 * usada); si no, el texto tal cual. Es lo que se guarda al escribir un motivo
 * a mano, para no abrir otra variante.
 */
export function matchExistingMotive(value, known) {
    const text = String(value ?? "").trim();

    if (!text) return "";

    return canonicalMotive(text, buildMotiveCanon(known));
}

// Los de la Brecha ("Completar rotativa de ...") son un texto interno que no se
// escribe a mano: no se tocan.
function isInternalMotive(text) {
    return /^Completar rotativa de /i.test(String(text || "").trim());
}

const EXTRA_MOTIVE_SOURCES = new Set(["manual_extra", "rota_gap"]);

/**
 * Cada motivo de HHEE ya usado (repetidos cuentan, para elegir la forma mas
 * usada): los apoyos extra sin ausente y las preasignaciones con motivo.
 */
export function usedExtraMotives(replacements = [], preassignments = []) {
    return [
        ...(replacements || [])
            .filter(record =>
                record &&
                !record.canceled &&
                !record.replaced &&
                EXTRA_MOTIVE_SOURCES.has(record.source)
            )
            .map(record => record.reason),
        ...(preassignments || [])
            .filter(record => record && !record.replaced)
            .map(record => record.reason)
    ]
        .map(text => String(text || "").trim())
        .filter(text => text && !isInternalMotive(text));
}

/**
 * El motivo que se va a guardar, con la forma que ya existe si es el mismo
 * escrito distinto. Los internos de la Brecha pasan tal cual.
 */
export function motiveToSave(value, replacements = [], preassignments = []) {
    const text = String(value ?? "").trim();

    if (!text || isInternalMotive(text)) return text;

    return matchExistingMotive(text, usedExtraMotives(replacements, preassignments));
}

/**
 * Una lista sin motivos repetidos (por clave), en el orden en que llegan y con
 * la forma canonica si se da.
 */
export function uniqueMotives(list, canon = null) {
    const seen = new Set();
    const result = [];

    (list || []).forEach(raw => {
        const text = canonicalMotive(raw, canon);
        const key = motiveKey(text);

        if (!text || seen.has(key)) return;

        seen.add(key);
        result.push(text);
    });

    return result;
}
