// Datos FICTICIOS de la unidad de practica.
//
// Cada supervisor o administrador tiene su propia unidad de practica para
// probar la app sin tocar nada real (ver js/practiceUnit.js). Este modulo arma
// su contenido: ~28 trabajadores inventados de una unidad mixta (Enfermeria y
// Tecnicos en Enfermeria, mas dos administrativos), con 3er turno, 4to turno en
// cuatro grupos, diurnos, un reemplazo y un honorario, y situaciones por
// resolver en el mes en curso: una licencia medica con parte de sus turnos sin
// cubrir, un feriado legal, un administrativo, un grupo con un tecnico menos
// (cupos de la Brecha) y horas extras con motivo.
//
// Las fechas son RELATIVAS a `today`: la unidad siempre tiene que hacer en el
// mes que se esta mirando. Un mismo `today` da siempre lo mismo.
//
// No escribe por su cuenta: `buildPracticeBaseState` devuelve las claves de
// estado (texto, como en localStorage) y `practiceCoverages` los reemplazos y
// turnos extra, que se guardan con las funciones de la app (saveReplacement)
// para que su formato sea exactamente el de siempre.

import { TURNO } from "./constants.js";

export const PRACTICE_SEED_VERSION = 1;

// Nombres inventados (combinaciones comunes, ninguna persona real a proposito).
const FIRST_NAMES = [
    "Camila", "Matías", "Valentina", "Benjamín", "Catalina", "Tomás", "Javiera",
    "Diego", "Fernanda", "Sebastián", "Constanza", "Nicolás", "Antonia", "Felipe",
    "Isidora", "Joaquín", "Martina", "Cristóbal", "Florencia", "Vicente",
    "Josefa", "Ignacio", "Daniela", "Gabriel", "Paula", "Andrés", "Carolina", "Pablo"
];
const LAST_NAMES = [
    "Araya", "Bravo", "Cárdenas", "Díaz", "Espinoza", "Fuentes", "Gallardo",
    "Herrera", "Ibáñez", "Jara", "Lagos", "Morales", "Navarro", "Orellana",
    "Paredes", "Quiroz", "Riquelme", "Salinas", "Toledo", "Urrutia", "Valdés",
    "Yáñez", "Zamora", "Castillo", "Pizarro", "Molina", "Soto", "Vera"
];

const ENFERMERIA = "Enfermería";
const TENS = "Técnico en Enfermería";
const ADMINISTRATIVO = "Técnico en Administración de Empresas";

// Quienes son y como rotan. Los cuatro grupos del 4to turno salen de la fase
// (primer turno) con la misma fecha de inicio; al grupo D de tecnicos le falta
// uno a proposito, para que la Brecha muestre cupos.
const ROSTER = [
    // Enfermeria: 4to turno, dos por grupo.
    ...["larga", "larga", "noche", "noche", "libre1", "libre1", "libre2", "libre2"]
        .map(firstTurn => ({ estamento: "Profesional", profession: ENFERMERIA, type: "4turno", firstTurn })),
    // Enfermeria: 3er turno y diurno.
    { estamento: "Profesional", profession: ENFERMERIA, type: "3turno", firstTurn: "larga" },
    { estamento: "Profesional", profession: ENFERMERIA, type: "3turno", firstTurn: "noche" },
    { estamento: "Profesional", profession: ENFERMERIA, type: "diurno" },
    { estamento: "Profesional", profession: ENFERMERIA, type: "diurno" },
    // Tecnicos: 4to turno, grupo D con uno menos.
    ...["larga", "larga", "noche", "noche", "libre1", "libre1", "libre2"]
        .map(firstTurn => ({ estamento: "Técnico", profession: TENS, type: "4turno", firstTurn })),
    // Tecnicos: 3er turno, diurnos (uno podria pasar a turno) y un reemplazo.
    { estamento: "Técnico", profession: TENS, type: "3turno", firstTurn: "larga" },
    { estamento: "Técnico", profession: TENS, type: "3turno", firstTurn: "libre1" },
    { estamento: "Técnico", profession: TENS, type: "diurno" },
    { estamento: "Técnico", profession: TENS, type: "diurno" },
    { estamento: "Técnico", profession: TENS, type: "diurno" },
    // El de reemplazo hace Diurno: si rotara, se sumaria a un grupo y la Brecha
    // dejaria de mostrar el cupo del grupo corto.
    { estamento: "Técnico", profession: TENS, type: "diurno", contractType: "Reemplazo" },
    // Un honorario y dos administrativos.
    { estamento: "Técnico", profession: TENS, type: "diurno", contractType: "Honorarios" },
    { estamento: "Administrativo", profession: ADMINISTRATIVO, type: "diurno" },
    { estamento: "Administrativo", profession: ADMINISTRATIVO, type: "diurno" }
];

function pad(value) {
    return String(value).padStart(2, "0");
}

function keyOf(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isoOf(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isWeekend(date) {
    return date.getDay() === 0 || date.getDay() === 6;
}

// RUT ficticio con digito verificador valido, en un rango alto para que no se
// parezca a los de la unidad.
function rutCheckDigit(number) {
    let sum = 0;
    let factor = 2;

    for (const digit of String(number).split("").reverse()) {
        sum += Number(digit) * factor;
        factor = factor === 7 ? 2 : factor + 1;
    }

    const rest = 11 - (sum % 11);

    return rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
}

function formatRut(number) {
    return `${String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${rutCheckDigit(number)}`;
}

/** Los perfiles ficticios, en el orden de ROSTER. */
export function practiceProfiles() {
    return ROSTER.map((entry, index) => {
        const name = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[index % LAST_NAMES.length]} ${LAST_NAMES[(index * 7 + 3) % LAST_NAMES.length]}`;
        const number = 31000000 + index * 137;

        return {
            id: `practica_${pad(index + 1)}`,
            name,
            email: `practica${pad(index + 1)}@ejemplo.invalid`,
            rut: formatRut(number),
            phone: `9${String(10000000 + index * 3011).slice(0, 8)}`,
            birthDate: `${1975 + (index % 24)}-${pad((index % 12) + 1)}-${pad((index % 27) + 1)}`,
            docs: [],
            active: true,
            unitEntryDate: `20${15 + (index % 10)}-${pad((index % 12) + 1)}-01`,
            contractType: entry.contractType || (index % 3 === 0 ? "Planta" : "Contrata"),
            estamento: entry.estamento,
            profession: entry.profession,
            grade: String(entry.estamento === "Profesional" ? 12 + (index % 8) : 16 + (index % 9)),
            practice: true
        };
    });
}

/**
 * Las claves de estado de la unidad de practica (como en localStorage: texto).
 *
 * @param {Object} [options]
 * @param {Date} [options.today]
 */
export function buildPracticeBaseState({ today = new Date() } = {}) {
    const profiles = practiceProfiles();
    // Todas las rotativas parten el primer dia de hace dos meses: el mes en
    // curso y el anterior ya tienen historia.
    const start = isoOf(new Date(today.getFullYear(), today.getMonth() - 2, 1));
    const state = {
        profiles: JSON.stringify(profiles),
        practiceSeedVersion: JSON.stringify(PRACTICE_SEED_VERSION)
    };

    ROSTER.forEach((entry, index) => {
        const name = profiles[index].name;

        state[`rotativa_${name}`] = JSON.stringify(
            entry.type === "diurno"
                ? { type: "diurno", start, firstTurn: "larga" }
                : { type: entry.type, start, firstTurn: entry.firstTurn }
        );
        // Asignacion de turno: los que rotan (sus horas extras se miden contra
        // su turno base); los diurnos, no.
        state[`shift_${name}`] = JSON.stringify(entry.type !== "diurno" && entry.contractType !== "Reemplazo");
    });

    // --- Situaciones por resolver en el mes en curso ---
    const nameOf = index => profiles[index].name;
    const absences = {};
    const blocked = {};
    const legal = {};
    const admin = {};
    const mark = (map, index, key, value) => {
        map[nameOf(index)] ||= {};
        map[nameOf(index)][key] = value;
    };

    // 1) Licencia medica de 10 dias de una enfermera de 4to turno, desde pasado
    //    manana: parte de sus turnos se cubren (practiceCoverages) y el resto
    //    queda como "+XX" para practicar.
    for (let offset = 2; offset < 12; offset++) {
        const key = keyOf(addDays(today, offset));

        mark(absences, 0, key, { type: "license", previousType: "" });
        mark(blocked, 0, key, true);
    }

    // 2) Feriado legal de 5 dias habiles de un tecnico de 4to turno, desde el
    //    lunes que viene.
    let cursor = addDays(today, ((8 - today.getDay()) % 7) || 7);
    let taken = 0;

    while (taken < 5) {
        if (!isWeekend(cursor)) {
            const key = keyOf(cursor);

            mark(legal, 14, key, true);
            mark(blocked, 14, key, true);
            taken += 1;
        }
        cursor = addDays(cursor, 1);
    }

    // 3) Un dia administrativo de otra enfermera, en 5 dias.
    mark(admin, 4, keyOf(addDays(today, 5)), 1);
    mark(blocked, 4, keyOf(addDays(today, 5)), true);

    Object.entries(absences).forEach(([name, map]) => { state[`absences_${name}`] = JSON.stringify(map); });
    Object.entries(legal).forEach(([name, map]) => { state[`legal_${name}`] = JSON.stringify(map); });
    Object.entries(admin).forEach(([name, map]) => { state[`admin_${name}`] = JSON.stringify(map); });
    Object.entries(blocked).forEach(([name, map]) => { state[`blocked_${name}`] = JSON.stringify(map); });

    return state;
}

/**
 * Los reemplazos y turnos extra de la unidad de practica, como datos para
 * `saveReplacement` (js/replacements.js). Se aplican DESPUES de cargar el
 * estado base, para que la app calcule motivos y etiquetas como siempre.
 *
 * `turnAt(name, keyDay)` es el turno real ya cargado (para cubrir solo turnos
 * que existen y elegir a alguien libre).
 */
export function practiceCoverages({ today = new Date(), turnAt }) {
    const profiles = practiceProfiles();
    const absent = profiles[0].name;
    const coverages = [];

    // Dos de los turnos de la licencia, cubiertos por enfermeras libres ese dia.
    let covered = 0;

    for (let offset = 2; offset < 12 && covered < 2; offset++) {
        const key = keyOf(addDays(today, offset));
        const turno = Number(turnAt(absent, key)) || TURNO.LIBRE;

        if (turno === TURNO.LIBRE) continue;

        const worker = profiles
            .slice(1, 8)
            .find(profile => (Number(turnAt(profile.name, key)) || TURNO.LIBRE) === TURNO.LIBRE);

        if (!worker) continue;

        coverages.push({
            worker: worker.name,
            replaced: absent,
            keyDay: key,
            turno,
            source: "replacement"
        });
        covered += 1;
    }

    // Horas extras con motivo: una enfermera diurna hace una Larga de apoyo un
    // sabado del mes en curso que ya paso (o el primero, si aun no hay).
    const diurna = profiles[10].name;
    const firstSaturday = (() => {
        let day = new Date(today.getFullYear(), today.getMonth(), 1);

        while (day.getDay() !== 6) day = addDays(day, 1);
        return day;
    })();

    coverages.push({
        worker: diurna,
        replaced: "",
        reason: "Apoyo Urgencia",
        keyDay: keyOf(firstSaturday),
        turno: TURNO.LARGA,
        source: "rota_gap"
    });

    return coverages;
}
