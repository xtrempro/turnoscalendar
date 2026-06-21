import { isoFromKey, keyFromISO, keyToDate as parseKey } from "./dateUtils.js";
import {
    getProfiles,
    getReplacements,
    getRotativa,
    saveReplacements,
    getReplacementRequests,
    saveReplacementRequests,
    getReplacementRequestConfig
} from "./storage.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import { getJSON } from "./persistence.js";
import { TURNO, TURNO_LABEL } from "./constants.js";
import {
    getTurnoComponentes,
    getAbsenceType,
    getTurnoExtraAgregado,
    restarTurnoCubierto,
    turnoDesdeComponentes,
    tieneAusencia
} from "./rulesEngine.js";
import { calcHours, isBusinessDay } from "./calculations.js";
import { getClockExtraHours } from "./clockMarks.js";
import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import { getWorkerAppLinkForProfile } from "./workerAppDataSync.js";

function normalizeHours(hours) {
    if (!hours) return null;

    const d = Math.max(0, Number(hours.d) || 0);
    const n = Math.max(0, Number(hours.n) || 0);

    return d || n ? { d, n } : null;
}

function diurnoExtensionHours(date, holidays = {}) {
    if (!isBusinessDay(date, holidays)) {
        return { d: 0, n: 0 };
    }

    return {
        d: date.getDay() === 5 ? 4 : 3,
        n: 0
    };
}

export function codeToTurno(code) {
    if (code === "L") return TURNO.LARGA;
    if (code === "N") return TURNO.NOCHE;
    if (code === "24") return TURNO.TURNO24;
    if (code === "D") return TURNO.DIURNO;
    if (code === "D+N") return TURNO.DIURNO_NOCHE;
    if (code === "HM") return TURNO.MEDIA_MANANA;
    if (code === "HT") return TURNO.MEDIA_TARDE;
    if (code === "18") return TURNO.TURNO18;

    return TURNO.LIBRE;
}

export function turnoToCode(turno) {
    const state = Number(turno) || TURNO.LIBRE;

    if (state === TURNO.LARGA) return "L";
    if (state === TURNO.NOCHE) return "N";
    if (state === TURNO.TURNO24) return "24";
    if (state === TURNO.DIURNO) return "D";
    if (state === TURNO.DIURNO_NOCHE) return "D+N";
    if (state === TURNO.MEDIA_MANANA) return "HM";
    if (state === TURNO.MEDIA_TARDE) return "HT";
    if (state === TURNO.TURNO18) return "18";

    return "";
}

export function turnoReplacementLabel(turno) {
    return TURNO_LABEL[Number(turno) || TURNO.LIBRE] || "";
}

export function replacementActive(replacement) {
    return Boolean(replacement) && !replacement.canceled;
}

function replacementAddsShift(replacement) {
    return replacementActive(replacement) &&
        replacement.addsShift !== false;
}

function mergeTurns(currentTurn, nextTurn) {
    return turnoDesdeComponentes([
        ...getTurnoComponentes(currentTurn),
        ...getTurnoComponentes(nextTurn)
    ]);
}

export function getReplacementForCoveredShift(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().find(replacement =>
        replacementActive(replacement) &&
        replacement.replaced === profile &&
        replacement.date === iso
    ) || null;
}

export function getReplacementForWorkerShift(profile, keyDay) {
    return getReplacementsForWorkerShift(
        profile,
        keyDay
    )[0] || null;
}

export function getClockExtraBackupForWorker(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().find(replacement =>
        replacementActive(replacement) &&
        replacement.worker === profile &&
        replacement.date === iso &&
        replacement.source === "clock_extra"
    ) || null;
}

export function getReplacementsForWorkerShift(profile, keyDay) {
    const iso = isoFromKey(keyDay);

    return getReplacements().filter(replacement =>
        replacementActive(replacement) &&
        replacement.worker === profile &&
        replacement.date === iso
    );
}

export function getReplacementTurnForWorker(profile, keyDay) {
    return getReplacementsForWorkerShift(profile, keyDay)
        .filter(replacementAddsShift)
        .reduce(
            (turno, replacement) =>
                mergeTurns(turno, codeToTurno(replacement.turno)),
            TURNO.LIBRE
        );
}

export function getBackedTurnForWorker(profile, keyDay) {
    return getReplacementsForWorkerShift(profile, keyDay)
        .filter(replacement =>
            replacement.source !== "clock_extra"
        )
        .reduce(
            (turno, replacement) =>
                mergeTurns(turno, codeToTurno(replacement.turno)),
            TURNO.LIBRE
        );
}

export function getReplacementLogForWorkerMonth(profile, year, month) {
    return getReplacements()
        .filter(replacement =>
            replacementActive(replacement) &&
            replacement.worker === profile &&
            Number(replacement.year) === Number(year) &&
            Number(replacement.month) === Number(month)
        )
        .sort((a, b) => a.date.localeCompare(b.date));
}

export function getReplacementOvertimeHours(
    replacement,
    date,
    turno,
    holidays = {}
) {
    const savedHours = normalizeHours(replacement?.overtimeHours);

    if (
        !savedHours &&
        replacement?.worker &&
        getRotativa(replacement?.worker).type === "diurno" &&
        Number(turno) === TURNO.MEDIA_TARDE
    ) {
        return diurnoExtensionHours(date, holidays);
    }

    return savedHours || calcHours(date, turno, holidays);
}

export function getAbsenceLabelForProfileDate(profile, keyDay) {
    const admin = getJSON(`admin_${profile}`, {});
    const legal = getJSON(`legal_${profile}`, {});
    const comp = getJSON(`comp_${profile}`, {});
    const absences = getJSON(`absences_${profile}`, {});

    if (admin[keyDay] === 1) return "P. Administrativo";
    if (admin[keyDay] === "0.5M") return "1/2 ADM Ma\u00f1ana";
    if (admin[keyDay] === "0.5T") return "1/2 ADM Tarde";
    if (admin[keyDay] === 0.5) return "1/2 ADM";
    if (legal[keyDay]) return "F. Legal";
    if (comp[keyDay]) return "F. Compensatorio";

    const absenceType = getAbsenceType(absences[keyDay]);

    if (absenceType === "professional_license") {
        return "LM Profesional";
    }

    if (absenceType === "unpaid_leave") {
        return "Permiso sin Goce";
    }

    if (absenceType === "union_leave") {
        return "Permiso Gremial";
    }

    if (absenceType === "license") {
        return "Licencia M\u00e9dica";
    }

    if (absenceType) {
        return "Ausencia Injustificada";
    }

    return "Ausencia";
}

export function workerHasAbsence(profile, keyDay) {
    return Boolean(
        tieneAusencia(
            keyDay,
            getJSON(`admin_${profile}`, {}),
            getJSON(`legal_${profile}`, {}),
            getJSON(`comp_${profile}`, {}),
            getJSON(`absences_${profile}`, {})
        )
    );
}

export function saveReplacement(data) {
    const date = parseKey(data.keyDay);
    const replacements = getReplacements();
    const hasReplacedWorker = Boolean(data.replaced);
    const absenceType =
        data.absenceType ||
        (
            hasReplacedWorker
                ? getAbsenceLabelForProfileDate(
                    data.replaced,
                    data.keyDay
                )
                : ""
        );

    const id =
        data.id ||
        `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const record = {
        id,
        requestId: data.requestId || "",
        requestGroupId: data.requestGroupId || "",
        worker: data.worker,
        replaced: data.replaced || "",
        reason: String(data.reason || "").trim(),
        source: data.source || "replacement",
        addsShift: data.addsShift !== false,
        date: isoFromKey(data.keyDay),
        turno: turnoToCode(data.turno),
        clockLabel: data.clockLabel || "",
        clockHours: data.clockHours || null,
        diurnoLongCoverage: Boolean(data.diurnoLongCoverage),
        overtimeHours: normalizeHours(data.overtimeHours),
        isLoan: Boolean(data.isLoan),
        workerWorkspaceId: data.workerWorkspaceId || "",
        workerWorkspaceName: data.workerWorkspaceName || "",
        hostWorkspaceId: data.hostWorkspaceId || "",
        hostWorkspaceName: data.hostWorkspaceName || "",
        remoteReplacementId: data.remoteReplacementId || "",
        absenceType,
        year: date.getFullYear(),
        month: date.getMonth(),
        createdAt: new Date().toISOString(),
        canceled: false
    };

    replacements.push(record);

    saveReplacements(replacements);
    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        data.source === "manual_extra" ||
        data.source === "clock_extra"
            ? "Respaldo horas extras manuales"
            : data.isLoan
                ? "Asigno prestamo entre unidades"
            : "Asigno reemplazo de turno",
        hasReplacedWorker
            ? `${data.worker} ${data.isLoan ? "cubre como prestamo a" : "reemplaza a"} ${data.replaced} el ${isoFromKey(data.keyDay)} por ${absenceType || "ausencia"}.`
            : `${data.worker}: ${String(data.reason || absenceType || "sin motivo").trim()} el ${isoFromKey(data.keyDay)}.`,
        {
            profile: data.worker,
            replacementId: id,
            worker: data.worker,
            replaced: data.replaced || "",
            isLoan: Boolean(data.isLoan),
            workerWorkspaceId: data.workerWorkspaceId || "",
            workerWorkspaceName: data.workerWorkspaceName || "",
            hostWorkspaceId: data.hostWorkspaceId || "",
            hostWorkspaceName: data.hostWorkspaceName || "",
            remoteReplacementId: data.remoteReplacementId || "",
            source: data.source || "replacement"
        }
    );

    return record;
}

function isExpiredRequest(request, now = new Date()) {
    if (!request?.expiresAt) return false;

    return new Date(request.expiresAt).getTime() <= now.getTime();
}

function requestId() {
    return `rr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requestGroupId() {
    return `rrg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getProfileByName(name) {
    return getProfiles().find(profile => profile.name === name) || null;
}

function whatsappPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");

    if (!digits) return "";
    if (digits.length === 8) return `569${digits}`;
    if (digits.length === 9 && digits.startsWith("9")) return `56${digits}`;
    if (digits.length >= 11 && digits.startsWith("56")) return digits;

    return digits;
}

function workerHasMobileApp(profile = {}, appLink = null) {
    return Boolean(
        appLink?.uid ||
        profile.mobileAppUid ||
        profile.appUid
    );
}

export function expireReplacementRequests(now = new Date()) {
    let changed = false;
    const requests = getReplacementRequests().map(request => {
        if (
            request.status === "pending" &&
            isExpiredRequest(request, now)
        ) {
            changed = true;
            return {
                ...request,
                status: "expired",
                expiredAt: now.toISOString()
            };
        }

        return request;
    });

    if (changed) {
        saveReplacementRequests(requests);
    }

    return requests;
}

export function getPendingReplacementRequestsForShift(
    replaced,
    keyDay,
    turno = null
) {
    const iso = isoFromKey(keyDay);
    const turnoCode = turno ? turnoToCode(turno) : "";

    return expireReplacementRequests().filter(request =>
        request.status === "pending" &&
        request.replaced === replaced &&
        request.date === iso &&
        (
            !turnoCode ||
            request.turno === turnoCode
        )
    );
}

function buildReplacementRequest(data) {
    const id = requestId();
    const workerProfile = getProfileByName(data.worker);
    const replacedProfile = getProfileByName(data.replaced);
    const appLink = getWorkerAppLinkForProfile(workerProfile);
    const config = getReplacementRequestConfig();
    const createdAt = new Date();
    const expiresAt = new Date(
        createdAt.getTime() +
        config.expiresMinutes * 60 * 1000
    );
    const workerUid =
        appLink?.uid ||
        workerProfile?.mobileAppUid ||
        workerProfile?.appUid ||
        "";
    const channel = workerHasMobileApp(workerProfile, appLink)
        ? "app"
        : "whatsapp";
    const absenceType =
        data.absenceType ||
        getAbsenceLabelForProfileDate(data.replaced, data.keyDay);

    return {
        id,
        groupId: data.groupId || id,
        groupSize: Number(data.groupSize) || 1,
        status: "pending",
        worker: data.worker,
        workerProfileId: workerProfile?.id || "",
        workerUid,
        workerEmail:
            workerProfile?.email ||
            appLink?.workerEmail ||
            "",
        replaced: data.replaced || "",
        replacedProfileId: replacedProfile?.id || "",
        keyDay: data.keyDay,
        date: isoFromKey(data.keyDay),
        turno: turnoToCode(data.turno),
        turnoLabel: turnoReplacementLabel(data.turno),
        absenceType,
        source: data.source || "replacement_request",
        channel,
        phone: workerProfile?.phone || "",
        scope: data.scope || "compatible",
        diurnoLongCoverage: Boolean(data.diurnoLongCoverage),
        overtimeHours: normalizeHours(data.overtimeHours),
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        canceledAt: "",
        acceptedAt: "",
        rejectedAt: "",
        expiredAt: "",
        appliedAt: "",
        notificationStatus:
            channel === "app"
                ? "queued"
                : "whatsapp_pending"
    };
}

export function createReplacementRequest(data) {
    const request = buildReplacementRequest(data);

    saveReplacementRequests([
        ...getReplacementRequests(),
        request
    ]);

    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        "Creo solicitud de reemplazo",
        `${request.worker}: solicitud para cubrir ${request.turnoLabel} de ${request.replaced} el ${request.date}. Canal: ${request.channel}.`,
        {
            profile: request.worker,
            requestId: request.id,
            requestGroupId: request.groupId,
            replaced: request.replaced,
            channel: request.channel
        }
    );

    return request;
}

export function createReplacementRequests(data, workers = []) {
    const uniqueWorkers = [...new Set(
        (workers || [])
            .map(worker => String(worker || "").trim())
            .filter(Boolean)
    )];

    if (!uniqueWorkers.length) return [];

    const groupId = requestGroupId();
    const diurnoLongCoverageWorkers = new Set(
        (data.diurnoLongCoverageWorkers || [])
            .map(worker => String(worker || "").trim())
            .filter(Boolean)
    );
    const workerCoverage = data.workerCoverage || {};
    const requests = uniqueWorkers.map(worker => {
        const coverage = workerCoverage[worker] || {};
        const diurnoLongCoverage =
            Boolean(coverage.diurnoLongCoverage) ||
            diurnoLongCoverageWorkers.has(worker);

        return buildReplacementRequest({
            ...data,
            worker,
            groupId,
            groupSize: uniqueWorkers.length,
            diurnoLongCoverage,
            overtimeHours: coverage.overtimeHours ||
                (
                    diurnoLongCoverage
                        ? data.diurnoLongCoverageHours
                        : data.overtimeHours
                )
        });
    });

    saveReplacementRequests([
        ...getReplacementRequests(),
        ...requests
    ]);

    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        requests.length > 1
            ? "Creo solicitud masiva de reemplazo"
            : "Creo solicitud de reemplazo",
        requests.length > 1
            ? `${requests.length} trabajadores invitados para cubrir ${requests[0].turnoLabel} de ${requests[0].replaced} el ${requests[0].date}.`
            : `${requests[0].worker}: solicitud para cubrir ${requests[0].turnoLabel} de ${requests[0].replaced} el ${requests[0].date}. Canal: ${requests[0].channel}.`,
        {
            profile: requests[0].replaced,
            requestGroupId: groupId,
            requestIds: requests.map(request => request.id),
            workers: uniqueWorkers,
            replaced: requests[0].replaced
        }
    );

    return requests;
}

export function cancelReplacementRequest(id, reason = "admin") {
    let canceled = null;
    const now = new Date().toISOString();
    const requests = getReplacementRequests().map(request => {
        if (
            request.id !== id ||
            request.status !== "pending"
        ) {
            return request;
        }

        canceled = {
            ...request,
            status: "canceled",
            canceledAt: now,
            cancelReason: reason
        };

        return canceled;
    });

    if (!canceled) return null;

    saveReplacementRequests(requests);
    addAuditLog(
        AUDIT_CATEGORY.OVERTIME,
        "Anulo solicitud de reemplazo",
        `${canceled.worker}: solicitud anulada para ${canceled.date}.`,
        {
            profile: canceled.worker,
            requestId: canceled.id
        }
    );

    return canceled;
}

export function buildReplacementRequestWhatsAppUrl(request) {
    const phone = whatsappPhone(request.phone);

    if (!phone) return "";

    const message = [
        `Hola ${request.worker}.`,
        `Se solicita cubrir un turno ${request.turnoLabel} el ${formatDate(request.date)}.`,
        `Motivo: reemplazo de ${request.replaced} por ${request.absenceType}.`,
        request.groupSize > 1
            ? "Esta invitacion fue enviada a varios trabajadores; el primer SI confirmado se queda con el turno."
            : "",
        "Responde SI para aceptar o NO para rechazar.",
        `La solicitud caduca el ${new Date(request.expiresAt).toLocaleString("es-CL")}.`
    ].filter(Boolean).join("\n");

    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function applyAcceptedReplacementRequests() {
    let changed = false;
    const replacements = getReplacements();
    const requests = getReplacementRequests();
    const nextRequests = requests.map(request => ({ ...request }));
    const groupIds = [...new Set(
        nextRequests
            .filter(request =>
                request.status === "accepted" &&
                !request.appliedAt
            )
            .map(request => request.groupId || request.id)
    )];

    groupIds.forEach(groupId => {
        const groupRequests = nextRequests.filter(request =>
            (request.groupId || request.id) === groupId
        );
        const hasAppliedRequest = groupRequests.some(request =>
            Boolean(request.appliedAt)
        );
        const hasAppliedReplacement = replacements.some(replacement =>
            !replacement.canceled &&
            (
                replacement.requestGroupId === groupId ||
                groupRequests.some(request =>
                    replacement.requestId === request.id
                )
            )
        );

        if (hasAppliedRequest || hasAppliedReplacement) {
            return;
        }

        const winner = groupRequests
            .filter(request => request.status === "accepted")
            .sort((a, b) =>
                String(a.acceptedAt || a.createdAt).localeCompare(
                    String(b.acceptedAt || b.createdAt)
                )
            )[0];

        if (!winner) return;

        const alreadyApplied = replacements.some(replacement =>
            !replacement.canceled &&
            (
                replacement.requestId === winner.id ||
                (
                    replacement.worker === winner.worker &&
                    replacement.replaced === winner.replaced &&
                    replacement.date === winner.date &&
                    replacement.turno === winner.turno
                )
            )
        );

        if (!alreadyApplied) {
            saveReplacement({
                worker: winner.worker,
                replaced: winner.replaced,
                keyDay: winner.keyDay,
                turno: codeToTurno(winner.turno),
                absenceType: winner.absenceType,
                source:
                    winner.source === "forced_replacement_request"
                        ? "forced_replacement"
                        : "replacement",
                diurnoLongCoverage:
                    Boolean(winner.diurnoLongCoverage),
                overtimeHours: winner.overtimeHours,
                requestId: winner.id,
                requestGroupId: groupId
            });
        }

        const now = new Date().toISOString();

        groupRequests.forEach(groupRequest => {
            const target = nextRequests.find(request =>
                request.id === groupRequest.id
            );

            if (!target) return;

            if (target.id === winner.id) {
                target.appliedAt = now;
                return;
            }

            if (
                target.status === "pending" ||
                target.status === "accepted"
            ) {
                target.status = "superseded";
                target.supersededAt = now;
                target.supersededByRequestId = winner.id;
            }
        });

        changed = true;
    });

    if (changed) {
        saveReplacementRequests(nextRequests);
    }

    return changed;
}

function formatDate(value) {
    const key = keyFromISO(value);
    const parts = key.split("-");

    return `${String(Number(parts[2])).padStart(2, "0")}-${String(Number(parts[1]) + 1).padStart(2, "0")}-${parts[0]}`;
}

function formatHours(hours) {
    const d = Math.round((Number(hours.d) || 0) * 2) / 2;
    const n = Math.round((Number(hours.n) || 0) * 2) / 2;
    const chunks = [];

    if (d) chunks.push(`${d}h diurnas`);
    if (n) chunks.push(`${n}h nocturnas`);

    return chunks.length ? chunks.join(" / ") : "0h";
}

function getPendingManualExtraTurn(profile, keyDay) {
    const baseWithSwaps = aplicarCambiosTurno(
        profile,
        keyDay,
        getTurnoBase(profile, keyDay),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        profile,
        keyDay,
        getTurnoProgramado(profile, keyDay),
        { includeReplacements: false }
    );
    const extraTurn = getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(profile, keyDay)
    );
}

function getUnbackedOvertimeLogEntries(
    profile,
    year,
    month,
    holidays = {}
) {
    const days = new Date(year, month + 1, 0).getDate();
    const entries = [];

    for (let day = 1; day <= days; day++) {
        const keyDay = `${year}-${month}-${day}`;
        const date = new Date(year, month, day);
        const iso = isoFromKey(keyDay);
        const pendingTurn =
            getPendingManualExtraTurn(profile, keyDay);

        if (pendingTurn) {
            const hours = getReplacementOvertimeHours(
                { worker: profile },
                date,
                pendingTurn,
                holidays
            );

            if (hours.d || hours.n) {
                entries.push({
                    date: iso,
                    label: turnoReplacementLabel(pendingTurn),
                    hours,
                    detail: "No se ha asignado respaldo."
                });
            }
        }

        if (getClockExtraBackupForWorker(profile, keyDay)) {
            continue;
        }

        const state = aplicarCambiosTurno(
            profile,
            keyDay,
            getTurnoProgramado(profile, keyDay)
        );
        const clockHours = getClockExtraHours(
            profile,
            keyDay,
            date,
            state,
            holidays
        );

        if (clockHours.d || clockHours.n) {
            entries.push({
                date: iso,
                label: "Marcaje reloj control",
                hours: clockHours,
                detail: "No se ha asignado respaldo."
            });
        }
    }

    return entries;
}

function renderBackedReplacementLogHTML(profile, year, month, holidays = {}) {
    const records =
        getReplacementLogForWorkerMonth(profile, year, month);

    if (!records.length) {
        return `
            <div class="replacement-log replacement-log--empty">
                Sin respaldos de HHEE registrados en este mes.
            </div>
        `;
    }

    const profiles = getProfiles();

    return `
        <div class="replacement-log">
            ${records.map(record => {
                const key = keyFromISO(record.date);
                const date = parseKey(key);
                const isClockExtra =
                    record.source === "clock_extra";
                const turno = codeToTurno(record.turno);
                const savedClockHours = record.clockHours || null;
                const needsClockRecalculation =
                    isClockExtra &&
                    (
                        !savedClockHours ||
                        (
                            !Number(savedClockHours.d) &&
                            !Number(savedClockHours.n)
                        )
                    );
                const hours = isClockExtra
                    ? (
                        needsClockRecalculation
                            ? getClockExtraHours(
                                record.worker,
                                key,
                                date,
                                turno,
                                holidays
                            )
                            : savedClockHours
                    )
                    : getReplacementOvertimeHours(
                        record,
                        date,
                        turno,
                        holidays
                    );
                const label = isClockExtra
                    ? (record.clockLabel || "Marcaje reloj control")
                    : turnoReplacementLabel(turno);
                const replacedProfile = profiles.find(
                    profileItem => profileItem.name === record.replaced
                );
                const estamento = replacedProfile?.estamento
                    ? ` · ${replacedProfile.estamento}`
                    : "";

                const unitText = record.isLoan
                    ? ` Prestamo en ${record.hostWorkspaceName || "otra unidad"}.`
                    : "";
                const detail = record.replaced
                    ? `${record.isLoan ? "Prestamo cubriendo a" : "Reemplaza a"} ${record.replaced}${estamento} por ${record.absenceType || "ausencia"}.${unitText}`
                    : `Motivo: ${record.reason || record.absenceType || "sin detalle"}.`;

                return `
                    <div class="replacement-log__item">
                        <span>${formatDate(record.date)} · ${label}</span>
                        <span>${formatHours(hours)}</span>
                        <small>${detail}</small>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function renderBackedOvertimeLogItem(record, profiles, holidays) {
    const key = keyFromISO(record.date);
    const date = parseKey(key);
    const isClockExtra =
        record.source === "clock_extra";
    const turno = codeToTurno(record.turno);
    const savedClockHours = record.clockHours || null;
    const needsClockRecalculation =
        isClockExtra &&
        (
            !savedClockHours ||
            (
                !Number(savedClockHours.d) &&
                !Number(savedClockHours.n)
            )
        );
    const hours = isClockExtra
        ? (
            needsClockRecalculation
                ? getClockExtraHours(
                    record.worker,
                    key,
                    date,
                    turno,
                    holidays
                )
                : savedClockHours
        )
        : getReplacementOvertimeHours(
            record,
            date,
            turno,
            holidays
        );
    const label = isClockExtra
        ? (record.clockLabel || "Marcaje reloj control")
        : turnoReplacementLabel(turno);
    const replacedProfile = profiles.find(
        profileItem => profileItem.name === record.replaced
    );
    const estamento = replacedProfile?.estamento
        ? ` - ${replacedProfile.estamento}`
        : "";
    const unitText = record.isLoan
        ? ` Prestamo en ${record.hostWorkspaceName || "otra unidad"}.`
        : "";
    const detail = record.replaced
        ? `${record.isLoan ? "Prestamo cubriendo a" : "Reemplaza a"} ${record.replaced}${estamento} por ${record.absenceType || "ausencia"}.${unitText}`
        : `Motivo: ${record.reason || record.absenceType || "sin detalle"}.`;

    return `
        <div class="replacement-log__item">
            <span>${formatDate(record.date)} - ${label}</span>
            <span>${formatHours(hours)}</span>
            <small>${detail}</small>
        </div>
    `;
}

function renderUnbackedOvertimeLogItem(entry) {
    return `
        <div class="replacement-log__item">
            <span>${formatDate(entry.date)} - ${entry.label}</span>
            <span>${formatHours(entry.hours)}</span>
            <small>${entry.detail}</small>
        </div>
    `;
}

export function renderReplacementLogHTML(profile, year, month, holidays = {}) {
    const records =
        getReplacementLogForWorkerMonth(profile, year, month);
    const pendingEntries =
        getUnbackedOvertimeLogEntries(
            profile,
            year,
            month,
            holidays
        );

    if (!pendingEntries.length) {
        return renderBackedReplacementLogHTML(
            profile,
            year,
            month,
            holidays
        );
    }

    const profiles = getProfiles();
    const items = [
        ...records.map((record, index) => ({
            date: record.date,
            order: index,
            html: renderBackedOvertimeLogItem(
                record,
                profiles,
                holidays
            )
        })),
        ...pendingEntries.map((entry, index) => ({
            date: entry.date,
            order: records.length + index,
            html: renderUnbackedOvertimeLogItem(entry)
        }))
    ].sort((a, b) =>
        a.date.localeCompare(b.date) ||
        a.order - b.order
    );

    if (!items.length) {
        return `
            <div class="replacement-log replacement-log--empty">
                Sin registros de HHEE en este mes.
            </div>
        `;
    }

    return `
        <div class="replacement-log">
            ${items.map(item => item.html).join("")}
        </div>
    `;
}
