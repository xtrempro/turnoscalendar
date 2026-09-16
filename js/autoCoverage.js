// Cobertura automatica por etapas: la parte que corre en el NAVEGADOR.
//
// El reparto de las etapas (que oleada toca, a quien le llega, cuando se alerta)
// vive en autoCoveragePlan.js, y lo comparten este modulo y la Cloud Function.
// Aqui queda lo que solo tiene sentido con un supervisor delante:
//
//   - arrancar la campaña cuando aprieta el boton, y mandar la PRIMERA oleada
//     de inmediato para que vea el resultado en el acto;
//   - cerrar la campaña apenas cubre el turno o lo marca "no requiere
//     cobertura", sin esperar al proximo barrido del servidor;
//   - leer las campañas para pintar la tarjeta de cobertura y la alerta.
//
// Las etapas SIGUIENTES no se avanzan aca. Las corre
// `exports.advanceAutoCoverage` (functions/index.js) cada 15 minutos, porque son
// de 24 horas y no pueden depender de que alguien tenga la pagina abierta. El
// reparto de trabajo se protege con la reserva (`leaseUntil` / `leaseOwner`) del
// documento de la campaña: quien va a mandar una oleada la toma primero, asi el
// servidor y el navegador no mandan la misma dos veces.
//
// Las campañas viven en workspaces/{ws}/autoCoverageCampaigns (ver
// firebaseAutoCoverage.js). En localStorage queda solo la copia local: la clave
// es interna a proposito, para que NO viaje ademas por el estado compartido y
// una foto vieja del modulo `requests` pise lo que acaba de escribir el
// servidor.

import { getJSON, setJSON } from "./persistence.js";
import { isoFromKey } from "./dateUtils.js";
import {
    getReplacementRequestConfig,
    getReplacementRequests,
    saveReplacementRequests,
    isNoCoverageDay,
    isProfileActive,
    getProfiles
} from "./storage.js";
import {
    createReplacementRequests,
    getPendingReplacementRequestsForShift,
    coveredShiftIsFullyCovered,
    turnoReplacementLabel
} from "./replacements.js";
import { getPreassignmentForCoveredShift } from "./preassignments.js";
import { getWorkerAppLinkForProfile } from "./workerAppLinks.js";
import {
    scheduledEntryTime,
    shiftStartsInTheMorning
} from "./attendanceDelay.js";
import { addAuditLog, AUDIT_CATEGORY } from "./auditLog.js";
import {
    AUTO_COVERAGE_DIRECT_MASS_HOURS,
    buildPlan,
    campaignStatusLabel,
    dueSteps,
    formatCoverageTimeLeft,
    normalizeCampaign,
    selectStageTargets,
    shiftStartInstant as planShiftStartInstant,
    stageLabel
} from "./autoCoveragePlan.js";

const STORAGE_KEY = "autoCoverageCampaigns";

// Cada cuanto se revisa si alguna campaña quedo resuelta. Es un barrido barato
// -no calcula candidatos-, a diferencia del avance de etapas, que vive en el
// servidor.
const CLOSE_SWEEP_MS = 60 * 1000;
// Cuanto se conservan las campañas cerradas. Sirven para el boton "ver quienes
// recibieron la solicitud" despues de resuelto el turno.
const KEEP_CLOSED_DAYS = 45;
// Cuanto dura la reserva que toma quien va a mandar una oleada.
const LEASE_MS = 5 * 60 * 1000;

let candidateProvider = null;
let sweepTimer = null;

// Se reexportan: el inicio los usa para pintar, y no tiene por que saber que la
// logica pura vive en otro modulo.
export {
    AUTO_COVERAGE_DIRECT_MASS_HOURS,
    campaignStatusLabel,
    formatCoverageTimeLeft
};

/**
 * calendar.js registra aca el motor real de candidatos. Devuelve
 * `{ neededTurn, absenceType, candidates }`, con `neededTurn` en 0 cuando ya no
 * hay nada que cubrir, o null si el calculo quedo obsoleto.
 */
export function setAutoCoverageCandidateProvider(provider) {
    candidateProvider = typeof provider === "function" ? provider : null;
}

/* ==========================================================================
   Almacen local
   ========================================================================== */

export function getAutoCoverageCampaigns() {
    return getJSON(STORAGE_KEY, [])
        .map(normalizeCampaign)
        .filter(Boolean);
}

function saveCampaigns(campaigns, options = {}) {
    const normalized = (Array.isArray(campaigns) ? campaigns : [])
        .map(normalizeCampaign)
        .filter(Boolean);

    setJSON(STORAGE_KEY, normalized);

    if (typeof window === "undefined") return normalized;

    window.dispatchEvent(
        new CustomEvent("proturnos:autoCoverageChanged", {
            detail: { campaigns: normalized }
        })
    );

    // Lo que viene del servidor no se le devuelve al servidor.
    if (options.remote !== true) {
        window.dispatchEvent(
            new CustomEvent("proturnos:autoCoverageSaved", {
                detail: {
                    campaigns: normalized,
                    changed: options.changed || normalized
                }
            })
        );
    }

    return normalized;
}

function upsertCampaign(campaign, options = {}) {
    const campaigns = getAutoCoverageCampaigns();
    const index = campaigns.findIndex(item => item.id === campaign.id);

    if (index >= 0) {
        campaigns[index] = campaign;
    } else {
        campaigns.push(campaign);
    }

    saveCampaigns(campaigns, { ...options, changed: [campaign] });

    return campaign;
}

/**
 * Aplica lo que llego de Firestore. El servidor manda sobre la copia local: es
 * quien hace avanzar las etapas.
 */
export function applyRemoteAutoCoverageCampaigns(remote = []) {
    const normalized = (Array.isArray(remote) ? remote : [])
        .map(normalizeCampaign)
        .filter(Boolean);
    const remoteIds = new Set(normalized.map(campaign => campaign.id));
    const previous = getAutoCoverageCampaigns();
    // Las que solo existen aca todavia no se subieron: descartarlas las borraria
    // antes de que la subida alcanzara a salir.
    const localOnly = previous.filter(campaign =>
        !remoteIds.has(campaign.id)
    );

    saveCampaigns([...normalized, ...localOnly], { remote: true });

    // La alerta del punto D la levanta el servidor, asi que el sonido tiene que
    // dispararse al RECIBIRLA, no al calcularla: es el unico momento en que el
    // navegador se entera. Solo por las que acaban de pasar a alertadas, o
    // sonaria en cada instantanea de Firestore.
    const alertedBefore = new Set(
        previous
            .filter(campaign => campaign.alertFiredAt)
            .map(campaign => campaign.id)
    );

    normalized
        .filter(campaign =>
            campaign.alertFiredAt &&
            campaign.status === "active" &&
            !alertedBefore.has(campaign.id) &&
            shiftStillNeedsCoverage(campaign.replaced, campaign.keyDay)
        )
        .forEach(campaign => {
            if (typeof window === "undefined") return;

            window.dispatchEvent(
                new CustomEvent("proturnos:autoCoverageAlert", {
                    detail: { campaign }
                })
            );
        });

    return localOnly.length > 0;
}

function campaignId() {
    return `ac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ==========================================================================
   Estado del turno
   ========================================================================== */

/**
 * Instante en que empieza el turno, con la hora de ingreso que el resto del app
 * usa para medir atrasos.
 */
export function shiftStartInstant(keyDay, turno) {
    return planShiftStartInstant(
        keyDay,
        scheduledEntryTime(Number(turno)),
        shiftStartsInTheMorning(Number(turno))
    );
}

/**
 * .Sigue haciendo falta cubrir este turno? Es la comprobacion barata (sin el
 * motor de candidatos) que cierra la campaña cuando el supervisor resuelve el
 * turno por su cuenta: asigna un reemplazo, lo preasigna o lo marca como "no
 * requiere cobertura".
 */
export function shiftStillNeedsCoverage(replaced, keyDay) {
    if (isNoCoverageDay(replaced, keyDay)) return false;
    // Cubierto ENTERO: con la jornada recortada de quien cubre quedan horas sin
    // nadie, y la campaña no puede darse por terminada (ver js/shiftCoverage.js).
    if (coveredShiftIsFullyCovered(replaced, keyDay)) return false;
    if (getPreassignmentForCoveredShift(replaced, keyDay)) return false;

    return true;
}

/* ==========================================================================
   Caducidad de las solicitudes de la campaña
   ========================================================================== */

/**
 * Caduca TODAS las solicitudes pendientes de un turno, sin importar en que
 * oleada salieron. Se usa cuando el supervisor cubre el turno o lo marca como
 * "no requiere cobertura": las solicitudes que siguen vivas en los telefonos
 * pasan a "Caducada".
 */
export function expirePendingRequestsForShift(replaced, keyDay, reason = "") {
    const iso = isoFromKey(keyDay);
    const now = new Date().toISOString();
    let changed = 0;

    const requests = getReplacementRequests().map(request => {
        if (
            request.status !== "pending" ||
            request.replaced !== replaced ||
            request.date !== iso
        ) {
            return request;
        }

        changed += 1;

        return {
            ...request,
            status: "expired",
            expiredAt: now,
            expireReason: reason || "auto_coverage_closed"
        };
    });

    if (changed) saveReplacementRequests(requests);

    return changed;
}

/* ==========================================================================
   Primera oleada
   ========================================================================== */

async function runStep(campaign, step, knownPool = null) {
    if (!candidateProvider) {
        return { ...step, ranAt: new Date().toISOString(), note: "sin-motor" };
    }

    const pool = knownPool ||
        await candidateProvider(campaign.replaced, campaign.keyDay);

    // null = el calculo quedo obsoleto. No se marca la etapa como corrida: se
    // reintenta despues.
    if (!pool) return null;
    // Turno vacio = ya no hay nada que cubrir.
    if (!pool.neededTurn) return { closed: true };

    const now = new Date().toISOString();
    const ran = { ...step, ranAt: now };

    // La alerta pura del camino corto no manda solicitudes.
    if (step.kind === "alert") return ran;

    const pending = new Set(
        getPendingReplacementRequestsForShift(
            campaign.replaced,
            campaign.keyDay,
            pool.neededTurn
        ).map(request => request.worker)
    );
    const { eligible, selected, targets, overLimit } = selectStageTargets(
        campaign,
        step,
        pool.candidates,
        {
            hasApp: name => Boolean(getWorkerAppLinkForProfile(name)),
            pending
        }
    );

    ran.poolSize = eligible.length;
    ran.overLimit = overLimit;

    if (!targets.length) {
        ran.note = selected.length ? "sin-app-o-ya-pendiente" : "sin-candidatos";
        return ran;
    }

    const requests = createReplacementRequests(
        {
            replaced: campaign.replaced,
            keyDay: campaign.keyDay,
            turno: pool.neededTurn,
            absenceType: pool.absenceType || campaign.absenceType,
            scope: "compatible",
            source: "replacement_request",
            diurnoLongCoverageWorkers: targets
                .filter(candidate => candidate.isDiurnoLongCoverage)
                .map(candidate => candidate.profile.name),
            workerCoverage: Object.fromEntries(
                targets.map(candidate => [
                    candidate.profile.name,
                    {
                        diurnoLongCoverage:
                            Boolean(candidate.isDiurnoLongCoverage),
                        overtimeHours: candidate.overtimeHours || null
                    }
                ])
            )
        },
        targets.map(candidate => candidate.profile.name)
    );

    ran.groupId = requests[0]?.groupId || "";
    ran.sent = requests.map(request => request.worker);
    ran.requestIds = requests.map(request => request.id);

    return ran;
}

/* ==========================================================================
   Cierre
   ========================================================================== */

function closeCampaign(campaign, reason) {
    const now = new Date().toISOString();

    expirePendingRequestsForShift(
        campaign.replaced,
        campaign.keyDay,
        `auto_coverage_${reason}`
    );

    return upsertCampaign({
        ...campaign,
        status: reason === "covered" ? "covered" : "closed",
        closedAt: now,
        closeReason: reason,
        leaseUntil: "",
        leaseOwner: ""
    });
}

function pruneCampaigns(now) {
    const limit = now.getTime() - KEEP_CLOSED_DAYS * 24 * 60 * 60 * 1000;
    const campaigns = getAutoCoverageCampaigns();
    const kept = campaigns.filter(campaign => {
        if (campaign.status === "active") return true;

        const closed = new Date(campaign.closedAt || campaign.createdAt);

        return !Number.isFinite(closed.getTime()) ||
            closed.getTime() >= limit;
    });

    if (kept.length !== campaigns.length) saveCampaigns(kept);
}

/**
 * Barrido de cierre. NO avanza etapas -de eso se encarga la Cloud Function-:
 * solo cierra las campañas que el supervisor ya resolvio y las de turnos que ya
 * empezaron, para que la tarjeta y la alerta del inicio no se queden mostrando
 * algo resuelto hasta el proximo barrido del servidor.
 */
export function runAutoCoverageCycle() {
    const now = new Date();

    getAutoCoverageCampaigns()
        .filter(campaign => campaign.status === "active")
        .forEach(campaign => {
            if (!shiftStillNeedsCoverage(campaign.replaced, campaign.keyDay)) {
                closeCampaign(campaign, "covered");
                return;
            }

            const start = campaign.shiftStartAt
                ? new Date(campaign.shiftStartAt)
                : null;

            if (start && start.getTime() <= now.getTime()) {
                closeCampaign(campaign, "past");
            }
        });

    pruneCampaigns(now);
}

export function startAutoCoverageScheduler() {
    stopAutoCoverageScheduler();
    sweepTimer = setInterval(runAutoCoverageCycle, CLOSE_SWEEP_MS);
    runAutoCoverageCycle();
}

export function stopAutoCoverageScheduler() {
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
}

/* ==========================================================================
   API publica
   ========================================================================== */

export function getActiveCampaignForShift(replaced, keyDay) {
    return getAutoCoverageCampaigns().find(campaign =>
        campaign.status === "active" &&
        campaign.replaced === replaced &&
        campaign.keyDay === keyDay
    ) || null;
}

export function getCampaignById(id) {
    return getAutoCoverageCampaigns().find(campaign => campaign.id === id) ||
        null;
}

/**
 * Alertas vivas del punto D: campañas que ya levantaron la alerta, siguen sin
 * cubrirse y cuyo turno todavia no empieza.
 */
export function getAutoCoverageAlerts(now = new Date()) {
    return getAutoCoverageCampaigns()
        .filter(campaign =>
            campaign.status === "active" &&
            campaign.alertFiredAt &&
            shiftStillNeedsCoverage(campaign.replaced, campaign.keyDay)
        )
        .map(campaign => ({
            ...campaign,
            msLeft: campaign.shiftStartAt
                ? new Date(campaign.shiftStartAt).getTime() - now.getTime()
                : null
        }))
        .filter(campaign => campaign.msLeft === null || campaign.msLeft > 0)
        .sort((left, right) => (left.msLeft ?? 0) - (right.msLeft ?? 0));
}

/**
 * Todos los que recibieron una solicitud de esta campaña, por etapa y con el
 * estado en que quedo cada una. Es lo que muestra el boton "ver quienes
 * recibieron la solicitud de cobertura" de la alerta.
 */
export function getCampaignRecipients(campaignId) {
    const campaign = getCampaignById(campaignId);

    if (!campaign) return [];

    const byId = new Map(
        getReplacementRequests().map(request => [request.id, request])
    );

    return campaign.steps
        .filter(step => step.ranAt && step.requestIds.length)
        .map(step => ({
            stage: step.stage,
            label: stageLabel(step),
            sentAt: step.ranAt,
            workers: step.requestIds
                .map(id => byId.get(id))
                .filter(Boolean)
                .map(request => ({
                    worker: request.worker,
                    status: request.status,
                    channel: request.channel,
                    expiresAt: request.expiresAt
                }))
        }))
        .filter(step => step.workers.length);
}

/**
 * Cierra la campaña de un turno porque el supervisor lo resolvio. La caducidad
 * de las solicitudes vivas va incluida.
 */
export function closeAutoCoverageForShift(replaced, keyDay, reason = "covered") {
    const campaign = getActiveCampaignForShift(replaced, keyDay);

    if (!campaign) return null;

    return closeCampaign(campaign, reason);
}

/**
 * Arranca la cobertura automatica de un turno y manda la primera oleada.
 * Devuelve un resumen para el aviso que muestra el inicio.
 */
export async function startAutoCoverage(replaced, keyDay) {
    const name = String(replaced || "").trim();

    if (!name || !keyDay) return { status: "invalid" };

    if (getReplacementRequestConfig().enableWorkerAcceptanceRequest === false) {
        return { status: "disabled" };
    }

    if (getActiveCampaignForShift(name, keyDay)) {
        return { status: "already-running" };
    }

    if (!shiftStillNeedsCoverage(name, keyDay)) {
        return { status: "nothing-to-cover" };
    }

    if (!candidateProvider) return { status: "error" };

    const pool = await candidateProvider(name, keyDay);

    if (!pool) return { status: "canceled" };
    if (!pool.neededTurn) return { status: "nothing-to-cover" };

    const now = new Date();
    const shiftStartAt = shiftStartInstant(keyDay, pool.neededTurn);
    const plan = buildPlan(now, shiftStartAt);
    // La campaña nace con la reserva tomada: hasta que la primera oleada
    // termine de salir, el barrido del servidor no debe tocarla.
    const campaign = normalizeCampaign({
        id: campaignId(),
        replaced: name,
        keyDay,
        date: isoFromKey(keyDay),
        turno: Number(pool.neededTurn) || 0,
        turnoLabel: turnoReplacementLabel(pool.neededTurn),
        absenceType: pool.absenceType || "",
        path: plan.path,
        status: "active",
        createdAt: now.toISOString(),
        shiftStartAt: shiftStartAt ? shiftStartAt.toISOString() : "",
        leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
        leaseOwner: "browser",
        steps: plan.steps
    });

    if (typeof window !== "undefined" &&
        typeof window.pushUndoState === "function") {
        window.pushUndoState("Cobertura automatica");
    }

    upsertCampaign(campaign);

    // La primera etapa vence en este mismo instante: se corre de inmediato para
    // que el supervisor vea el resultado del boton que acaba de apretar. Se le
    // pasa el `pool` que ya se calculo mas arriba en vez de recalcularlo, que
    // repetiria el barrido de toda la unidad.
    const due = dueSteps(campaign, now);
    const steps = campaign.steps.map(step => ({ ...step }));
    let ran = null;

    if (due.length) {
        ran = await runStep(campaign, steps[due[0].index], pool);

        if (ran?.closed) {
            closeCampaign(campaign, "covered");
            return { status: "nothing-to-cover" };
        }

        if (ran) steps[due[0].index] = ran;
    }

    const started = upsertCampaign({
        ...campaign,
        steps,
        // Se suelta la reserva: de aqui en adelante manda el servidor.
        leaseUntil: "",
        leaseOwner: ""
    });

    if (ran?.sent?.length) {
        addAuditLog(
            AUDIT_CATEGORY.OVERTIME,
            "Cobertura automatica",
            `${stageLabel(ran)}: solicitud enviada a ${ran.sent.length} trabajador(es) para cubrir ${started.turnoLabel} de ${started.replaced} el ${started.date}.`,
            {
                profile: started.replaced,
                requestGroupId: ran.groupId,
                workers: ran.sent,
                autoCoverageId: started.id,
                stage: ran.stage
            }
        );
    }

    return {
        status: "ok",
        campaignId: campaign.id,
        path: plan.path,
        stage: ran?.stage || 0,
        stageLabel: ran ? stageLabel(ran) : "",
        sent: ran?.sent?.length || 0,
        poolSize: ran?.poolSize || 0,
        overLimit: ran?.overLimit || 0,
        note: ran?.note || "",
        turnoLabel: campaign.turnoLabel,
        date: campaign.date
    };
}

/**
 * Perfiles activos del entorno. Se expone para que la vista pueda decir
 * "X de Y trabajadores" sin volver a filtrar.
 */
export function activeProfileCount() {
    return getProfiles().filter(isProfileActive).length;
}
