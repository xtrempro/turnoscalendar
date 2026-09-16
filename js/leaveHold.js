// Permisos EN ESPERA DE COBERTURA.
//
// Un P. Administrativo, un F. Legal o un F. Compensatorio aplicado desde el
// calendario no viaja a la PWA del trabajador en el momento de aplicarlo: queda
// en espera hasta que el supervisor resuelve la cobertura de al menos UNO de los
// turnos que ese permiso deja descubiertos (le asigna un reemplazo o lo marca
// "no requiere cobertura"). Ahi se libera el BLOQUE COMPLETO: si a alguien le
// cargan 10 F. Legal, basta con cubrir uno de los turnos comprometidos para que
// los 10 dias aparezcan en su telefono.
//
// La espera se anota de forma EXPLICITA al aplicar, en `leaveHold_<perfil>`, y
// no se deduce mirando los mapas de permisos. Por dos razones:
//   - los permisos ya aplicados antes de que esto existiera no llevan anotacion,
//     asi que ninguno desaparece del telefono de nadie al desplegar;
//   - liberar es definitivo. Si manana se anula el reemplazo que libero el
//     bloque, el permiso NO vuelve a esconderse: el trabajador ya lo vio.
//
// Modulo puro (sin DOM ni Firebase): lo comparten el navegador del supervisor y
// el motor de proyeccion que corre en la Cloud Function.
import { getJSON, setJSON } from "./persistence.js";
import { isoFromKey, keyFromDate } from "./dateUtils.js";
import { asRecordList, getRotativa } from "./storage.js";
import { getTurnoBase } from "./turnEngine.js";
import { requiereReemplazoTurnoBase } from "./rulesEngine.js";
import {
    getAllReplacementContracts,
    replacementContractCoversCoveredShift
} from "./contracts.js";
import { coveredShiftIsComplete } from "./shiftCoverage.js";

export const LEAVE_HOLD_KEY_PREFIX = "leaveHold_";

// Tipos de permiso que esperan cobertura. Las licencias medicas, las ausencias
// injustificadas y los medios ADM nunca entran aqui: no se aplican por bloque y
// el trabajador tiene que enterarse en el acto.
const HELD_LEAVE_TYPES = ["admin", "legal", "comp"];

// Mismos identificadores que usa js/calendarChangeEvents.js para el aviso que
// hoy sale al aplicar el permiso. Se repiten aqui (y no se importan) porque ese
// modulo arrastra firebase-client y este viaja dentro del bundle del servidor.
const LEAVE_RELEASE_EVENTS = {
    admin: {
        changeType: "administrative_leave_accepted",
        source: "administrative_leave",
        title: "Permiso administrativo actualizado",
        label: "Tu permiso administrativo fue incorporado"
    },
    legal: {
        changeType: "legal_leave_added",
        source: "legal_leave",
        title: "Feriado legal actualizado",
        label: "Tu feriado legal fue incorporado"
    },
    comp: {
        changeType: "compensatory_leave_added",
        source: "compensatory_leave",
        title: "Compensatorio actualizado",
        label: "Tu feriado compensatorio fue incorporado"
    }
};

function normalizeKeys(keys) {
    return [...new Set(
        (Array.isArray(keys) ? keys : [keys])
            .map(key => String(key || "").trim())
            .filter(Boolean)
    )];
}

export function getLeaveHolds(profile) {
    const map = getJSON(`${LEAVE_HOLD_KEY_PREFIX}${profile}`, {});

    return map && typeof map === "object" ? map : {};
}

function saveLeaveHolds(profile, map) {
    setJSON(`${LEAVE_HOLD_KEY_PREFIX}${profile}`, map);
}

/**
 * Deja un bloque de permiso a la espera de cobertura.
 *
 * Se llama ANTES de guardar el mapa del permiso: el aviso a la PWA se decide en
 * el mismo instante en que `admin_`/`legal_`/`comp_` cambian, y si la anotacion
 * llegara despues el trabajador ya habria recibido la notificacion.
 *
 * @returns {string} identificador del bloque, "" si no habia nada que anotar.
 */
export function holdLeaveApplication(profile, keys = []) {
    const clean = normalizeKeys(keys);

    if (!profile || !clean.length) return "";

    const blockId =
        `hold_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const map = getLeaveHolds(profile);

    clean.forEach(key => {
        map[key] = blockId;
    });

    saveLeaveHolds(profile, map);

    return blockId;
}

function leaveMapsFor(profile) {
    return {
        admin: getJSON(`admin_${profile}`, {}),
        legal: getJSON(`legal_${profile}`, {}),
        comp: getJSON(`comp_${profile}`, {}),
        absences: getJSON(`absences_${profile}`, {})
    };
}

function heldLeaveTypeForKey(maps, keyDay) {
    return HELD_LEAVE_TYPES.find(type => maps[type][keyDay]) || "";
}

// Un turno comprometido queda cubierto cuando alguien lo toma (reemplazo activo
// o contrato de reemplazo vigente) o cuando el supervisor declara que no hace
// falta. Es la MISMA definicion que apaga el "!" del calendario: si el supervisor
// ya no ve nada que hacer sobre ese turno, el permiso no puede seguir esperando.
// La preasignacion NO cuenta: es tentativa a proposito y la proyeccion no la ve.
function isCoveredKey(profile, keyDay, sources) {
    if (sources.noCoverage[keyDay]) return true;

    const iso = isoFromKey(keyDay);
    // Cubierto ENTERO y no "tiene algun reemplazo": a quien cubre se le puede
    // recortar la jornada, y mientras queden horas sin nadie el turno no esta
    // resuelto, asi que el permiso sigue esperando (ver js/shiftCoverage.js).
    const takenByReplacement = coveredShiftIsComplete(
        sources.replacements.filter(replacement =>
            replacement &&
            !replacement.canceled &&
            replacement.replaced === profile &&
            replacement.date === iso
        )
    );

    if (takenByReplacement) return true;

    return sources.contracts.some(contract =>
        contract.replaces === profile &&
        replacementContractCoversCoveredShift(contract, keyDay)
    );
}

function groupHoldsByBlock(holds) {
    const blocks = new Map();

    Object.entries(holds).forEach(([keyDay, blockId]) => {
        const id = String(blockId || keyDay);

        if (!blocks.has(id)) blocks.set(id, []);

        blocks.get(id).push(keyDay);
    });

    return blocks;
}

/**
 * Dias con permiso que TODAVIA no deben viajar a la PWA del trabajador.
 *
 * Es la unica funcion que decide: la usan el motor de proyeccion (para esconder
 * los dias) y el aviso de calendario (para callar la notificacion). No escribe.
 *
 * @returns {Set<string>} claves internas (`YYYY-M-D`) en espera.
 */
export function heldLeaveKeys(profile, options = {}) {
    const held = new Set();

    if (!profile) return held;

    const holds = getLeaveHolds(profile);

    if (!Object.keys(holds).length) return held;

    const maps = leaveMapsFor(profile);
    // Se leen UNA vez por perfil: dentro del bucle habria una pasada por todos
    // los contratos de la unidad en cada dia del bloque.
    const sources = {
        replacements: asRecordList(getJSON("replacements", [])),
        noCoverage: getJSON(`noCoverage_${profile}`, {}),
        contracts: getAllReplacementContracts()
    };
    const rotativaType = getRotativa(profile).type;
    const todayISO = isoFromKey(
        keyFromDate(options.today ? new Date(options.today) : new Date())
    );

    groupHoldsByBlock(holds).forEach(blockKeys => {
        const leaveKeys = blockKeys.filter(keyDay =>
            heldLeaveTypeForKey(maps, keyDay)
        );

        // El permiso ya se anulo: no queda nada que esconder.
        if (!leaveKeys.length) return;

        // Un permiso que ya empezo deja de esperar. Esconderlo mas alla de su
        // primer dia dejaria el calendario del trabajador mintiendo para siempre
        // sobre un turno que no trabajo, y eso es peor que adelantarle el aviso.
        if (leaveKeys.map(isoFromKey).sort()[0] <= todayISO) return;

        let pending = 0;
        let covered = 0;

        leaveKeys.forEach(keyDay => {
            const compromete = requiereReemplazoTurnoBase(
                keyDay,
                getTurnoBase(profile, keyDay),
                maps.admin,
                maps.legal,
                maps.comp,
                maps.absences,
                rotativaType
            );

            if (!compromete) return;

            if (isCoveredKey(profile, keyDay, sources)) {
                covered++;
            } else {
                pending++;
            }
        });

        // Sin turnos comprometidos no hay nada que cubrir (el bloque cae sobre
        // dias libres): el permiso viaja de inmediato. Con uno cubierto, tambien.
        if (covered || !pending) return;

        leaveKeys.forEach(keyDay => held.add(keyDay));
    });

    return held;
}

export function isLeaveHeld(profile, keyDay, options = {}) {
    return heldLeaveKeys(profile, options).has(String(keyDay || ""));
}

/**
 * Quita anotaciones de espera de dias concretos. Se usa al anular un permiso:
 * sin esto la anotacion sobrevive al dia que la justificaba.
 */
export function removeLeaveHoldKeys(profile, keys = []) {
    const clean = normalizeKeys(keys);

    if (!profile || !clean.length) return [];

    const holds = getLeaveHolds(profile);
    const removed = clean.filter(key => holds[key] !== undefined);

    if (!removed.length) return [];

    removed.forEach(key => {
        delete holds[key];
    });

    saveLeaveHolds(profile, holds);

    return removed;
}

/**
 * Borra las anotaciones de los bloques que ya estan liberados. Al desaparecer la
 * anotacion la liberacion queda firme: aunque despues se anule el reemplazo que
 * la produjo, el permiso ya no vuelve a esconderse.
 *
 * @returns {string[]} claves liberadas en esta pasada.
 */
export function releaseCoveredLeaveHolds(profile, options = {}) {
    if (!profile) return [];

    const holds = getLeaveHolds(profile);
    const keys = Object.keys(holds);

    if (!keys.length) return [];

    const stillHeld = heldLeaveKeys(profile, options);
    const released = keys.filter(key => !stillHeld.has(key));

    if (!released.length) return [];

    released.forEach(key => {
        delete holds[key];
    });

    saveLeaveHolds(profile, holds);

    return released;
}

function formatReleaseDate(iso) {
    const parts = String(iso || "").split("-");

    return parts.length === 3
        ? `${parts[2]}-${parts[1]}-${parts[0]}`
        : String(iso || "");
}

function leaveReleaseMetadata(profile, releasedKeys) {
    const maps = leaveMapsFor(profile);
    const withLeave = releasedKeys.filter(keyDay =>
        heldLeaveTypeForKey(maps, keyDay)
    );

    if (!withLeave.length) return null;

    const event = LEAVE_RELEASE_EVENTS[heldLeaveTypeForKey(maps, withLeave[0])];

    if (!event) return null;

    const affectedDates = withLeave.map(isoFromKey).sort();

    return {
        changeType: event.changeType,
        source: event.source,
        title: event.title,
        message: affectedDates.length === 1
            ? `${event.label} para el ${formatReleaseDate(affectedDates[0])}.`
            : `${event.label} en ${affectedDates.length} días de tu calendario.`,
        affectedDates,
        notifyProfiles: [profile]
    };
}

/**
 * Libera lo que corresponda y, si algo se libero, manda a la PWA el aviso del
 * permiso que se callo al aplicarlo. Es el punto de entrada del navegador del
 * supervisor: se llama cada vez que un turno del ausente pasa a estar cubierto.
 */
export function releaseLeaveHoldsForCoverage(profile, options = {}) {
    const released = releaseCoveredLeaveHolds(profile, options);

    if (!released.length) return [];

    const metadata = leaveReleaseMetadata(profile, released);

    if (metadata && typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent("proturnos:calendarProfilesChanged", {
                detail: {
                    delay: 0,
                    profiles: [profile],
                    metadata
                }
            })
        );
    }

    return released;
}
