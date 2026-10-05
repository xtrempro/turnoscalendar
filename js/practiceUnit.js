// Unidad de practica (lado navegador).
//
// Cada supervisor o administrador tiene su propia unidad con datos ficticios
// para practicar (y, mas adelante, para el tutorial paso a paso). La crea el
// servidor (functions/practiceWorkspace.js) y este modulo:
//
// - la pide al iniciar sesion (ensurePracticeUnit);
// - la llena la primera vez que se abre, DESPUES de hidratar (si se escribiera
//   antes, la hidratacion lo pisaria): seedPracticeUnitIfEmpty;
// - la reinicia a los datos de partida (resetPracticeUnit);
// - dice si la unidad activa es de practica (isPracticeWorkspace), para que lo
//   que sale hacia afuera (PWA, invitaciones, correos, cobertura automatica,
//   enlaces, transferencias) no corra en ella;
// - dibuja la franja "Datos ficticios".

import { getFirebaseServices } from "./firebaseClient.js";
import { getRaw, setRaw } from "./persistence.js";
import { buildPracticeBaseState, practiceCoverages, PRACTICE_SEED_VERSION } from "./practiceSeed.js";
import { saveReplacement } from "./replacements.js";
import { getTurnoReal } from "./turnEngine.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";

export const PRACTICE_WORKSPACE_PREFIX = "practice_";
const SEED_VERSION_KEY = "practiceSeedVersion";

async function callFunction(name, payload = {}) {
    const { functions, functionsModule } = await getFirebaseServices();
    const callable = functionsModule.httpsCallable(functions, name);
    const result = await callable(payload);

    return result.data;
}

/** Si la unidad es de practica (marca del servidor, o su id). */
export function isPracticeWorkspace(workspace) {
    return Boolean(workspace) && (
        workspace.practice === true ||
        String(workspace.id || "").startsWith(PRACTICE_WORKSPACE_PREFIX)
    );
}

/**
 * Pide al servidor la unidad de practica (la crea si no existe). Solo la
 * reciben quienes son miembros de alguna unidad real; para el resto devuelve
 * null sin ruido.
 *
 * @param {Array} memberships las unidades de la cuenta (listUserWorkspaces)
 */
export async function ensurePracticeUnit(memberships = [], call = callFunction) {
    const hasRealUnit = (memberships || []).some(item => !isPracticeWorkspace(item));

    if (!hasRealUnit) return null;
    if ((memberships || []).some(isPracticeWorkspace)) return null;

    try {
        return await call("ensurePracticeWorkspace");
    } catch (error) {
        console.warn("No se pudo preparar la unidad de práctica.", error);
        return null;
    }
}

/**
 * La primera vez que se abre (o despues de reiniciarla), la llena con los datos
 * de partida. Llamar SOLO con la unidad ya hidratada (afterStateHydrated).
 *
 * @returns {boolean} si la lleno ahora
 */
export function seedPracticeUnitIfEmpty(workspace, {
    today = new Date(),
    read = getRaw,
    write = setRaw,
    save = saveReplacement,
    turnAt = getTurnoReal,
    audit = addAuditLog
} = {}) {
    if (!isPracticeWorkspace(workspace)) return false;
    if (read(SEED_VERSION_KEY, "")) return false;

    const state = buildPracticeBaseState({ today });

    // La version va AL FINAL: si algo falla a mitad de camino, la proxima vez
    // se vuelve a intentar entera.
    Object.entries(state)
        .filter(([key]) => key !== SEED_VERSION_KEY)
        .forEach(([key, value]) => write(key, value));

    practiceCoverages({ today, turnAt }).forEach(coverage => save(coverage));
    write(SEED_VERSION_KEY, JSON.stringify(PRACTICE_SEED_VERSION));
    audit(
        AUDIT_CATEGORY.CALENDAR,
        "Preparo la unidad de practica",
        "Se cargaron los datos ficticios de partida.",
        {}
    );

    return true;
}

/**
 * Vuelve a los datos de partida: el servidor borra el contenido y la pagina se
 * recarga; al hidratar vacia, seedPracticeUnitIfEmpty la llena de nuevo.
 */
export async function resetPracticeUnit({ call = callFunction, clearLocal = () => {}, reload = () => window.location.reload() } = {}) {
    await call("resetPracticeWorkspace");
    clearLocal();
    reload();
}

/** La franja que se ve siempre en la unidad de practica. */
export function practiceBannerHTML() {
    return `
        <div class="practice-banner" role="note">
            <strong>Unidad de práctica</strong>
            <span>Datos ficticios: nada de lo que hagas aquí afecta a una unidad real ni le llega a ningún trabajador.</span>
            <button type="button" class="secondary-button" data-practice-reset>Reiniciar datos</button>
        </div>`;
}

/**
 * Por que una accion que sale hacia afuera no se puede usar en la unidad de
 * practica ("" si se puede). Lo consultan invitaciones, PWA, correos,
 * cobertura automatica, enlaces entre unidades y transferencias.
 */
export function practiceBlockReason(workspace, action = "esta acción") {
    return isPracticeWorkspace(workspace)
        ? `En la unidad de práctica no se puede usar ${action}: sus datos son ficticios.`
        : "";
}
