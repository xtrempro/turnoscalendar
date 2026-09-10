// Los dos documentos livianos que la PWA necesita por trabajador enlazado:
//
//   workspaces/{id}/workerMessageDirectory/{uid}   (a quien se le puede escribir)
//   workspaces/{id}/workerSwapCandidates/{uid}     (con quien se puede cambiar turno)
//
// Hasta ahora los publicaba el NAVEGADOR del supervisor, en cada carga de
// pagina: 132 documentos (66 enlazados x 2) en ~54 s, por sesion y por
// supervisor, contendiendo por el mismo stream de escritura que sus ediciones.
// Aqui se arman igual pero del lado servidor, y quien escribe decide que
// documentos cambiaron de verdad.
//
// Este modulo NO escribe ni conoce Firestore: recibe el estado ya sembrado en el
// shim de `localStorage` y devuelve los documentos. Eso lo hace probable sin
// nube y reutilizable por el cliente.
//
// El calculo de compatibilidad es CRUZADO: `compatibleWorkerUids` de cada uno
// depende de todos los demas, asi que siempre se arma con el universo completo
// de enlazados, aunque solo se vaya a escribir a unos pocos.

import { getProfiles, isProfileActive, getRotativa, getShiftAssigned, getTurnChangeConfig } from "./storage.js";
import { canSwapProfiles } from "./swaps.js";
import { findProfileForLink } from "./workerAppLinks.js";
import { normalizeText } from "./stringUtils.js";
import {
    getWorkerBlockedDays,
    setWorkerBlockedDays,
    normalizeBlockedDay
} from "./workerBlockedDays.js";

// Campo que cambia en CADA llamada aunque nada mas lo haga. Cualquier
// comparacion de "¿cambio el documento?" tiene que excluirlo, o se reescribirian
// los 132 documentos cada vez y no habriamos ganado nada.
export const VOLATILE_LINKED_DOC_FIELDS = ["updatedAtISO", "updatedAt"];

/**
 * Dias que el trabajador bloqueo (no hace reemplazos ni cambios ese dia).
 *
 * En el navegador llegan por listener; en el servidor los siembra quien invoca
 * con `setWorkerBlockedDays`, igual que hace la cobertura automatica.
 */
export function blockedDatesForProfile(profileName) {
    const profileKey = normalizeText(profileName);

    if (!profileKey) return [];

    return getWorkerBlockedDays()
        .filter(item =>
            normalizeText(item.profileName) === profileKey &&
            item.status !== "canceled" &&
            item.status !== "deleted" &&
            item.status !== "inactive"
        )
        .map(item => item.date)
        .filter(Boolean)
        .sort();
}

/**
 * Siembra lo que en el navegador llega por listener: los dias que el trabajador
 * bloqueo. La Cloud Function los lee de su coleccion y los pasa crudos, igual
 * que hace la cobertura automatica.
 */
export function seedLinkedDocsContext({ blockedDays = [] } = {}) {
    setWorkerBlockedDays(
        blockedDays
            .map(day => normalizeBlockedDay(day?.id, day))
            .filter(Boolean)
    );
}

export function buildWorkerMessageDirectoryPayload(link, profile, workspace, nowISO) {
    const active = profile ? isProfileActive(profile) : false;

    return {
        uid: link.uid,
        workspaceId: workspace.id,
        workspaceName: workspace.name || link.workspaceName || "",
        profileName: profile?.name || link.profileName || "",
        profileRut: profile?.rut || link.profileRut || "",
        status: profile ? (active ? "active" : "inactive") : "profile_not_found",
        worker: {
            name: profile?.name || link.profileName || "Trabajador",
            email: profile?.email || link.workerEmail || "",
            phone: profile?.phone || "",
            rut: profile?.rut || link.profileRut || "",
            role: profile?.estamento || "",
            profession: profile?.profession || "",
            unit: workspace.name || link.workspaceName || "",
            active
        },
        updatedAtISO: nowISO
    };
}

export function buildSwapCandidatePayload(
    link,
    profile,
    workspace,
    linkedProfiles,
    nowISO,
    schedule
) {
    const resolvedSchedule = schedule;
    const compatibleWorkerUids = linkedProfiles
        .filter(item =>
            item.link.uid !== link.uid &&
            item.profile &&
            canSwapProfiles(profile.name, item.profile.name)
        )
        .map(item => item.link.uid);
    const active = isProfileActive(profile);
    const turnChange = getTurnChangeConfig();

    return {
        uid: link.uid,
        workspaceId: workspace.id,
        workspaceName: workspace.name || link.workspaceName || "",
        profileName: profile.name || link.profileName || "",
        profileRut: profile.rut || link.profileRut || "",
        status: active ? "active" : "inactive",
        worker: {
            name: profile.name || link.profileName || "",
            email: profile.email || link.workerEmail || "",
            phone: profile.phone || "",
            rut: profile.rut || "",
            role: profile.estamento || "",
            profession: profile.profession || "",
            unit: workspace.name || link.workspaceName || "",
            active
        },
        rotativa: getRotativa(profile.name),
        shiftAssigned: Boolean(getShiftAssigned(profile.name)),
        // Config de la unidad para el cambio de turno: si permite dejar al
        // receptor con turno 24 (Larga+Noche) y si permite el 24 invertido.
        allowTwentyFourHourShifts:
            turnChange.allowTwentyFourHourShifts !== false,
        allowInvertedTwentyFourHourShifts:
            turnChange.allowInvertedTwentyFourHourShifts !== false,
        compatibleWorkerUids,
        blockedDayDates: blockedDatesForProfile(profile.name),
        scheduleStart: resolvedSchedule.start,
        scheduleEnd: resolvedSchedule.end,
        days: resolvedSchedule.days,
        updatedAtISO: nowISO
    };
}

/**
 * Cuando la misma persona enlaza dos cuentas, hay dos uid para un perfil. Se
 * conserva SOLO el enlace mas reciente; los demas se devuelven aparte para
 * retirarles sus documentos, o la PWA la listaria y ofreceria dos veces.
 */
export function selectPrimaryLinkedProfiles(linkedProfiles, recencyOf) {
    const primaryByProfile = new Map();

    linkedProfiles.forEach(item => {
        const key = normalizeText(item.profile.name);
        const existing = primaryByProfile.get(key);

        if (!existing || recencyOf(item.link) >= recencyOf(existing.link)) {
            primaryByProfile.set(key, item);
        }
    });

    const primary = [...primaryByProfile.values()];
    const primaryUids = new Set(primary.map(item => item.link.uid));

    return {
        primary,
        duplicates: linkedProfiles.filter(item => !primaryUids.has(item.link.uid))
    };
}

/** Antiguedad del enlace, para elegir el primario entre dos cuentas. */
export function workerLinkRecency(link) {
    const stamp = link?.linkedAt || link?.claimedAt || link?.updatedAt;

    if (stamp && typeof stamp.toMillis === "function") return stamp.toMillis();

    const parsed = Date.parse(
        link?.updatedAtISO || link?.linkedAtISO || link?.updatedAt || ""
    );

    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Arma los documentos de TODOS los enlazados de la unidad.
 *
 * @param {{id: string, name: string}} workspace
 * @param {Array} links documentos de workerLinks tal como vienen de Firestore
 * @param {string} nowISO sello unico para toda la corrida
 * @returns {{documents: Array, duplicates: Array, unmatchedLinks: Array}}
 */
export function buildLinkedWorkerDocuments(
    workspace,
    links = [],
    computeSchedule,
    nowISO = new Date().toISOString()
) {
    const profiles = getProfiles();
    const resolved = links
        .filter(link => link?.uid)
        .map(link => ({ link, profile: findProfileForLink(link, profiles) }));
    const linkedProfiles = resolved.filter(item => item.profile);
    // Un enlace sin perfil no es un error del que haya que morirse -la persona
    // pudo cambiar de nombre-, pero SI hay que poder verlo: la PWA de esa
    // persona deja de recibir sin hacer ruido.
    const unmatchedLinks = resolved
        .filter(item => !item.profile)
        .map(item => item.link.uid);

    if (!linkedProfiles.length) {
        return { documents: [], duplicates: [], unmatchedLinks };
    }

    const { primary, duplicates } = selectPrimaryLinkedProfiles(
        linkedProfiles,
        workerLinkRecency
    );
    const documents = [];

    primary.forEach(item => {
        // El try es POR TRABAJADOR: uno que no se pueda armar no puede llevarse
        // por delante la publicacion de los demas.
        try {
            documents.push({
                collection: "workerMessageDirectory",
                uid: item.link.uid,
                payload: buildWorkerMessageDirectoryPayload(
                    item.link,
                    item.profile,
                    workspace,
                    nowISO
                )
            });
        } catch (error) {
            documents.push({
                collection: "workerMessageDirectory",
                uid: item.link.uid,
                error: error?.message || String(error)
            });
        }

        try {
            documents.push({
                collection: "workerSwapCandidates",
                uid: item.link.uid,
                payload: buildSwapCandidatePayload(
                    item.link,
                    item.profile,
                    workspace,
                    // El universo de compatibilidad va sin duplicados, para que
                    // compatibleWorkerUids no repita a la misma persona.
                    primary,
                    nowISO,
                    computeSchedule(item.profile)
                )
            });
        } catch (error) {
            documents.push({
                collection: "workerSwapCandidates",
                uid: item.link.uid,
                error: error?.message || String(error)
            });
        }
    });

    return {
        documents: documents.filter(item => item.payload),
        failed: documents.filter(item => item.error),
        duplicates: duplicates.map(item => item.link.uid),
        unmatchedLinks
    };
}

/**
 * .Cambio el documento de verdad?
 *
 * Compara ignorando los campos volatiles. Sin esto, `updatedAtISO` haria que
 * TODOS los documentos parecieran distintos en cada corrida y se reescribirian
 * los 132: exactamente el costo que se venia a eliminar.
 */
export function linkedDocChanged(stored, next) {
    if (!stored) return true;

    return JSON.stringify(withoutVolatileFields(next)) !==
        JSON.stringify(withoutVolatileFields(stored));
}

export function withoutVolatileFields(payload) {
    if (!payload || typeof payload !== "object") return payload;

    // Se ordenan las claves para que dos documentos iguales con distinto orden
    // de propiedades no se vean distintos (Firestore no conserva el orden).
    const copy = {};

    Object.keys(payload)
        .filter(key => !VOLATILE_LINKED_DOC_FIELDS.includes(key))
        .sort()
        .forEach(key => {
            const value = payload[key];

            copy[key] = value && typeof value === "object" && !Array.isArray(value)
                ? withoutVolatileFields(value)
                : value;
        });

    return copy;
}
