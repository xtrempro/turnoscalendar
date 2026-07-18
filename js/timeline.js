import { normalizeText } from "./stringUtils.js";
import {
    getProfiles,
    getCurrentProfile,
    getShiftAssigned,
    getReplacements,
    getSwaps
} from "./storage.js";

import * as calendar from "./calendar.js";
import {
    aplicarCambiosTurno,
    fusionarTurnos,
    getTurnoBase,
    getTurnoProgramado,
    getTurnoReal
} from "./turnEngine.js";
import { TURNO, TURNO_COLOR } from "./constants.js";
import { getTurnoColor } from "./turnoColors.js";
import { getDayColorGradient } from "./dayColorBands.js";
import { fetchHolidays } from "./holidays.js";
import { calcularHorasMesPerfil } from "./hoursEngine.js";
import { isBusinessDay } from "./calculations.js";
import {
    getJSON,
    getRaw,
    listKeys,
    removeKey,
    setRaw
} from "./persistence.js";
import {
    esAusenciaInjustificada,
    getAbsenceType,
    getTurnoExtraAgregado,
    requiereReemplazoTurnoBase,
    restarTurnoCubierto
} from "./rulesEngine.js";
import { getLeaveApplicationInfo } from "./auditLog.js";
import {
    codeToTurno,
    getBackedTurnForWorker,
    getClockExtraBackupForWorker,
    getReplacementForCoveredShift,
    getReplacementForWorkerShift,
    replacementActive
} from "./replacements.js";
import {
    getAllReplacementContracts,
    getInheritedReplacementContractForCoveredShift,
    hasContractForDate,
    isReplacementProfile,
    replacementContractCoversCoveredShift
} from "./contracts.js";
import {
    getHonorariaExcessForKey,
    getHonorariaLimitMessage,
    getHonorariaMonthlySummary
} from "./honoraria.js";
import {
    getClockMarks,
    getClockIncidentDetail,
    hasClockExtra,
    hasSevereClockIncident,
    hasSimpleClockIncident
} from "./clockMarks.js";
import {
    getHourReturns,
    getHourReturn,
    hourReturnTimelineMarker
} from "./hourReturns.js";
import {
    getBlockedDayForProfile,
    getWorkerBlockedDays
} from "./workerAvailability.js";
import { getActiveWorkspace } from "./workspaces.js";
import {
    isoFromKey,
    keyFromISO
} from "./dateUtils.js";
import {
    measurePerformance,
    startPerformanceSpan
} from "./performanceMonitor.js";

const timelineFilterState = {
    anchorProfile: "",
    selectedKeys: new Set(),
    open: false
};
let timelineOutsideClickController = null;
let timelineRenderRequest = 0;
const TIMELINE_DISABLED_FOR_SPEED_TEST = false;
const TIMELINE_PAGE_SIZE = 20;
const TIMELINE_FOREGROUND_INITIAL_LIMIT = 5;
const TIMELINE_INITIAL_BATCH_SIZE = 5;
const TIMELINE_INCREMENTAL_BATCH_SIZE = 5;
const TIMELINE_VISIBLE_BATCH_SIZE = 1;
const TIMELINE_CACHE_VERSION = 3;
const TIMELINE_CACHE_PREFIX = "proturnos_ui_cache_timeline_";
const TIMELINE_ROW_CACHE_PREFIX = "proturnos_ui_cache_timeline_row_";
const TIMELINE_METRICS_CACHE_PREFIX = "proturnos_ui_cache_timeline_metrics_";
const TIMELINE_MONTH_INDEX_CACHE_PREFIX =
    "proturnos_ui_cache_timeline_month_index_";
const TIMELINE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TIMELINE_CACHE_MAX_ENTRIES = 24;
const TIMELINE_ROW_CACHE_MAX_ENTRIES = 2500;
const TIMELINE_METRICS_CACHE_MAX_ENTRIES = 2500;
const TIMELINE_MONTH_INDEX_CACHE_MAX_ENTRIES = 72;
const TIMELINE_MONTH_INDEX_WRITE_EVERY = 5;
const TIMELINE_METRICS_USER_QUIET_MS = 60000;
const TIMELINE_METRICS_RETRY_MS = 15000;
const TIMELINE_METRICS_VISIBLE_RETRY_MS = 60000;
const TIMELINE_SORT_LARGA_TURNS = new Set([TURNO.LARGA]);
const TIMELINE_SORT_NIGHT_TURNS = new Set([
    TURNO.NOCHE,
    TURNO.TURNO18,
    TURNO.TURNO24,
    TURNO.DIURNO_NOCHE
]);
const TIMELINE_SORT_DIURNO_TURNS = new Set([TURNO.DIURNO]);
const TIMELINE_STRUCTURE_ANCHOR_ISO = "2026-01-01";
let timelineRowLimit = TIMELINE_PAGE_SIZE;
let timelinePageSignature = "";
// Observer que carga la siguiente página de filas al hacer scroll (virtualización
// por viewport: no renderizamos las 100 filas de golpe, solo la primera página y
// vamos cargando el resto a medida que el usuario baja).
let timelineLazyObserver = null;
const timelineMemoryCache = new Map();
const timelineRowMemoryCache = new Map();
const timelineMetricsMemoryCache = new Map();
const timelineMonthIndexMemoryCache = new Map();
const timelineVisibilityResolvers = new Set();
const timelineMetricsRefreshTimers = new Map();
const timelineMetricsRefreshRequests = new Map();
let timelineLastUserActivityAt = Date.now();
// Contexto del ultimo render (mes visible) para actualizar casillas sueltas
// sin reconstruir todo el timeline.
let timelineViewState = null;

function timelineMonthKey(year, month) {
    return `${Number(year)}-${Number(month)}`;
}

function timelineCacheHash(value) {
    let hash = 2166136261;
    const text = String(value || "");

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function timelineCacheKey(viewSignature, rowLimit) {
    return (
        TIMELINE_CACHE_PREFIX +
        `${TIMELINE_CACHE_VERSION}_` +
        timelineCacheHash(`${viewSignature}\u001f${rowLimit}`)
    );
}

function timelineWorkspaceId() {
    return String(getActiveWorkspace?.()?.id || "local");
}

function timelineWorkerId(profile) {
    return String(
        profile?.id ||
        profile?.workerId ||
        profile?.uid ||
        profile?.name ||
        ""
    );
}

function timelineFiltersSignature(selectedKeys) {
    return Array.from(selectedKeys || [])
        .sort()
        .join("|") || "default";
}

function currentTimelineSelectedKey() {
    return Array.from(timelineFilterState.selectedKeys || [])[0] || "";
}

function timelineCurrentProfileGroup(profiles = getProfiles()) {
    const actual = getCurrentProfile();
    const profile = profiles.find(item => item.name === actual);

    return profile ? timelineGroupForProfile(profile) : null;
}

function timelineMonthContractSignature(year, month) {
    const diasMes = new Date(year, month + 1, 0).getDate();
    const keys = monthKeys(year, month, diasMes);
    const monthStart = isoFromKey(keys[0]);
    const monthEnd = isoFromKey(keys[keys.length - 1]);
    const parts = [];

    getAllReplacementContracts().forEach(contract => {
        if (
            !contract?.worker ||
            !contract?.replaces ||
            !monthStart ||
            !monthEnd ||
            contract.end < monthStart ||
            contract.start > monthEnd
        ) {
            return;
        }

        const coverage = keys
            .map(keyDay => {
                const iso = isoFromKey(keyDay);

                if (
                    !iso ||
                    contract.start > iso ||
                    contract.end < iso
                ) {
                    return "";
                }

                return `${iso}:${replacementContractCoversCoveredShift(
                    contract,
                    keyDay
                ) ? "1" : "0"}`;
            })
            .filter(Boolean)
            .join(",");

        if (!coverage) return;

        parts.push([
            contract.id,
            contract.worker,
            contract.replaces,
            contract.start,
            contract.end,
            contract.rotationMode || "",
            coverage
        ].join("\u001f"));
    });

    return parts.length
        ? timelineCacheHash(parts.sort().join("\u001e"))
        : "no-contracts";
}

function timelineFastSignature(year, month) {
    const profiles = getProfiles();
    const selectedKey = currentTimelineSelectedKey();
    const currentGroup = timelineCurrentProfileGroup(profiles);

    if (!selectedKey) return "";

    if (
        currentGroup?.key &&
        selectedKey !== currentGroup.key
    ) {
        return "";
    }

    return [
        year,
        month,
        selectedKey,
        profiles.length,
        timelineMonthContractSignature(year, month)
    ].join("\u001f");
}

function timelineFastCacheViewSignature(fastSignature) {
    return fastSignature
        ? `fast:${fastSignature}`
        : "";
}

function timelineFastCacheKey(fastSignature) {
    const viewSignature = timelineFastCacheViewSignature(fastSignature);

    return viewSignature
        ? timelineCacheKey(viewSignature, -1)
        : "";
}

function syncTimelineFilterToCurrentProfile(profiles = getProfiles()) {
    const currentGroup = timelineCurrentProfileGroup(profiles);

    if (!currentGroup?.key) return "";

    const selectedKey = currentTimelineSelectedKey();

    if (selectedKey !== currentGroup.key) {
        timelineFilterState.selectedKeys = new Set([currentGroup.key]);
        timelineFilterState.open = false;
    }

    return currentGroup.key;
}

function timelineRowCacheKey({
    workspaceId = timelineWorkspaceId(),
    monthKey,
    workerId,
    filtersSignature,
    dependencySignature = ""
}) {
    return (
        TIMELINE_ROW_CACHE_PREFIX +
        `${TIMELINE_CACHE_VERSION}_` +
        timelineCacheHash([
            workspaceId,
            monthKey,
            workerId,
            filtersSignature,
            dependencySignature
        ].join("\u001f"))
    );
}

function timelineMetricsCacheKey({
    workspaceId = timelineWorkspaceId(),
    monthKey,
    workerId
}) {
    return (
        TIMELINE_METRICS_CACHE_PREFIX +
        `${TIMELINE_CACHE_VERSION}_` +
        timelineCacheHash([
            workspaceId,
            monthKey,
            workerId
        ].join("\u001f"))
    );
}

function parseTimelineCache(raw) {
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function readTimelineCache(cacheKey, {
    viewSignature,
    rowLimit,
    monthKey
}) {
    const fromMemory = timelineMemoryCache.get(cacheKey);
    const payload = fromMemory ||
        parseTimelineCache(getRaw(cacheKey, null));

    if (
        !payload ||
        payload.version !== TIMELINE_CACHE_VERSION ||
        payload.viewSignature !== viewSignature ||
        payload.rowLimit !== rowLimit ||
        payload.monthKey !== monthKey ||
        typeof payload.html !== "string" ||
        Date.now() - Number(payload.savedAt || 0) > TIMELINE_CACHE_MAX_AGE_MS
    ) {
        return null;
    }

    timelineMemoryCache.set(cacheKey, payload);
    return payload;
}

function pruneTimelineCache() {
    const keys = listKeys(TIMELINE_CACHE_PREFIX)
        .filter(key =>
            !key.startsWith(TIMELINE_ROW_CACHE_PREFIX) &&
            !key.startsWith(TIMELINE_METRICS_CACHE_PREFIX) &&
            !key.startsWith(TIMELINE_MONTH_INDEX_CACHE_PREFIX)
        );

    if (keys.length <= TIMELINE_CACHE_MAX_ENTRIES) return;

    const entries = keys
        .map(key => ({
            key,
            savedAt:
                Number(
                    timelineMemoryCache.get(key)?.savedAt ??
                    parseTimelineCache(getRaw(key, null))?.savedAt
                ) || 0
        }))
        .sort((a, b) => b.savedAt - a.savedAt);

    entries
        .slice(TIMELINE_CACHE_MAX_ENTRIES)
        .forEach(entry => {
            timelineMemoryCache.delete(entry.key);
            removeKey(entry.key);
        });
}

function writeTimelineCache(cacheKey, payload) {
    const next = {
        ...payload,
        version: TIMELINE_CACHE_VERSION,
        savedAt: Date.now()
    };

    timelineMemoryCache.set(cacheKey, next);

    try {
        measurePerformance(
            "timeline:write-html-cache",
            () => {
                setRaw(cacheKey, JSON.stringify(next));
                pruneTimelineCache();
            },
            {
                htmlLength: String(payload?.html || "").length,
                rowLimit: payload?.rowLimit || 0
            }
        );
    } catch {
        timelineMemoryCache.delete(cacheKey);
    }
}

function parseTimelineRowCache(raw) {
    return parseTimelineCache(raw);
}

function readTimelineRowCache(cacheKey, {
    monthKey,
    workerId,
    filtersSignature
}) {
    const payload = timelineRowMemoryCache.get(cacheKey) ||
        parseTimelineRowCache(getRaw(cacheKey, null));

    if (
        !payload ||
        payload.version !== TIMELINE_CACHE_VERSION ||
        payload.monthKey !== monthKey ||
        payload.workerId !== workerId ||
        payload.filtersSignature !== filtersSignature ||
        typeof payload.innerHTML !== "string" ||
        typeof payload.rowHash !== "string" ||
        Date.now() - Number(payload.savedAt || 0) > TIMELINE_CACHE_MAX_AGE_MS
    ) {
        return null;
    }

    timelineRowMemoryCache.set(cacheKey, payload);
    return payload;
}

function pruneTimelineRowCache() {
    const keys = listKeys(TIMELINE_ROW_CACHE_PREFIX);

    if (keys.length <= TIMELINE_ROW_CACHE_MAX_ENTRIES) return;

    keys
        .map(key => ({
            key,
            savedAt:
                Number(
                    timelineRowMemoryCache.get(key)?.savedAt ??
                    parseTimelineRowCache(getRaw(key, null))?.savedAt
                ) || 0
        }))
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(TIMELINE_ROW_CACHE_MAX_ENTRIES)
        .forEach(entry => {
            timelineRowMemoryCache.delete(entry.key);
            removeKey(entry.key);
        });
}

function writeTimelineRowCache(cacheKey, payload) {
    const next = {
        ...payload,
        version: TIMELINE_CACHE_VERSION,
        savedAt: Date.now()
    };

    timelineRowMemoryCache.set(cacheKey, next);

    try {
        measurePerformance(
            "timeline:write-row-cache",
            () => {
                setRaw(cacheKey, JSON.stringify(next));
                pruneTimelineRowCache();
            },
            {
                htmlLength: String(payload?.innerHTML || "").length,
                profileName: payload?.profileName || "",
                workerId: payload?.workerId || ""
            }
        );
    } catch {
        timelineRowMemoryCache.delete(cacheKey);
    }
}

function readTimelineMetricsCache(cacheKey, {
    monthKey,
    workerId
}) {
    const payload = timelineMetricsMemoryCache.get(cacheKey) ||
        parseTimelineCache(getRaw(cacheKey, null));

    if (
        !payload ||
        payload.version !== TIMELINE_CACHE_VERSION ||
        payload.monthKey !== monthKey ||
        payload.workerId !== workerId ||
        !payload.stats ||
        Date.now() - Number(payload.savedAt || 0) > TIMELINE_CACHE_MAX_AGE_MS
    ) {
        return null;
    }

    timelineMetricsMemoryCache.set(cacheKey, payload);
    return payload;
}

function pruneTimelineMetricsCache() {
    const keys = listKeys(TIMELINE_METRICS_CACHE_PREFIX);

    if (keys.length <= TIMELINE_METRICS_CACHE_MAX_ENTRIES) return;

    keys
        .map(key => ({
            key,
            savedAt:
                Number(
                    timelineMetricsMemoryCache.get(key)?.savedAt ??
                    parseTimelineCache(getRaw(key, null))?.savedAt
                ) || 0
        }))
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(TIMELINE_METRICS_CACHE_MAX_ENTRIES)
        .forEach(entry => {
            timelineMetricsMemoryCache.delete(entry.key);
            removeKey(entry.key);
        });
}

function writeTimelineMetricsCache(cacheKey, payload) {
    const next = {
        ...payload,
        version: TIMELINE_CACHE_VERSION,
        savedAt: Date.now()
    };

    timelineMetricsMemoryCache.set(cacheKey, next);

    try {
        measurePerformance(
            "timeline:write-metrics-cache",
            () => {
                setRaw(cacheKey, JSON.stringify(next));
                pruneTimelineMetricsCache();
            },
            {
                profileName: payload?.profileName || "",
                workerId: payload?.workerId || ""
            }
        );
    } catch {
        timelineMetricsMemoryCache.delete(cacheKey);
    }
}

function timelineMonthIndexCacheKey({
    workspaceId = timelineWorkspaceId(),
    monthKey,
    fastSignature
}) {
    if (!monthKey || !fastSignature) return "";

    return (
        TIMELINE_MONTH_INDEX_CACHE_PREFIX +
        `${TIMELINE_CACHE_VERSION}_` +
        timelineCacheHash([
            workspaceId,
            monthKey,
            fastSignature
        ].join("\u001f"))
    );
}

function readTimelineMonthIndex(cacheKey, {
    monthKey,
    fastSignature
}) {
    if (!cacheKey) return null;

    const payload = timelineMonthIndexMemoryCache.get(cacheKey) ||
        parseTimelineCache(getRaw(cacheKey, null));

    if (
        !payload ||
        payload.version !== TIMELINE_CACHE_VERSION ||
        payload.monthKey !== monthKey ||
        payload.fastSignature !== fastSignature ||
        typeof payload.shellHTML !== "string" ||
        !Array.isArray(payload.rows) ||
        Date.now() - Number(payload.savedAt || 0) > TIMELINE_CACHE_MAX_AGE_MS
    ) {
        return null;
    }

    timelineMonthIndexMemoryCache.set(cacheKey, payload);
    return payload;
}

function pruneTimelineMonthIndexCache() {
    const keys = listKeys(TIMELINE_MONTH_INDEX_CACHE_PREFIX);

    if (keys.length <= TIMELINE_MONTH_INDEX_CACHE_MAX_ENTRIES) return;

    keys
        .map(key => ({
            key,
            savedAt:
                Number(
                    timelineMonthIndexMemoryCache.get(key)?.savedAt ??
                    parseTimelineCache(getRaw(key, null))?.savedAt
                ) || 0
        }))
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(TIMELINE_MONTH_INDEX_CACHE_MAX_ENTRIES)
        .forEach(entry => {
            timelineMonthIndexMemoryCache.delete(entry.key);
            removeKey(entry.key);
        });
}

function writeTimelineMonthIndex(cacheKey, payload) {
    if (!cacheKey) return;

    const next = {
        ...payload,
        version: TIMELINE_CACHE_VERSION,
        savedAt: Date.now()
    };

    timelineMonthIndexMemoryCache.set(cacheKey, next);

    try {
        measurePerformance(
            "timeline:write-month-index",
            () => {
                setRaw(cacheKey, JSON.stringify(next));
                pruneTimelineMonthIndexCache();
            },
            {
                monthKey: payload?.monthKey || "",
                rowCount: payload?.rows?.length || 0,
                complete: payload?.complete === true
            }
        );
    } catch {
        timelineMonthIndexMemoryCache.delete(cacheKey);
    }
}

function readTimelineRowCacheForIndex(rowRef, payload) {
    if (!rowRef?.cacheKey) return null;

    return readTimelineRowCache(rowRef.cacheKey, {
        monthKey: payload.monthKey,
        workerId: rowRef.workerId,
        filtersSignature: payload.filtersSignature
    });
}

function timelineHTMLFromMonthIndex(payload) {
    if (
        typeof document === "undefined" ||
        !payload ||
        typeof payload.shellHTML !== "string"
    ) {
        return "";
    }

    const template = document.createElement("div");

    template.innerHTML = payload.shellHTML;

    const tbody = timelineRowsTbody(template);

    if (!tbody) return "";

    let restored = 0;

    payload.rows.forEach(rowRef => {
        const cached = readTimelineRowCacheForIndex(rowRef, payload);

        if (!cached) return;

        tbody.appendChild(timelineRowElement({
            workerId: rowRef.workerId,
            profileName: rowRef.profileName,
            innerHTML: cached.innerHTML,
            rowHash: cached.rowHash,
            cacheKey: rowRef.cacheKey
        }));
        restored++;
    });

    return restored ? template.innerHTML : "";
}

function writeTimelineMonthIndexFromDOM(
    container,
    context,
    options = {}
) {
    const fastSignature =
        options.fastSignature ||
        timelineFastSignature(context.year, context.month);
    const cacheKey = timelineMonthIndexCacheKey({
        workspaceId: context.workspaceId,
        monthKey: context.monthKey,
        fastSignature
    });

    if (!cacheKey || !fastSignature || !container) return;

    const rowsByWorkerId = new Map(
        Array.from(container.querySelectorAll("[data-timeline-row]"))
            .map(row => [row.dataset.workerId || "", row])
            .filter(([workerId]) => Boolean(workerId))
    );
    const rows = context.orderedGroup
        .map(profile => {
            const workerId = timelineWorkerId(profile);
            const row = rowsByWorkerId.get(workerId);
            const cacheKeyForRow = row?.dataset?.timelineRowCacheKey || "";

            if (!row || !cacheKeyForRow) return null;

            return {
                workerId,
                profileName: profile.name,
                cacheKey: cacheKeyForRow,
                rowHash: row.dataset.timelineRowHash || ""
            };
        })
        .filter(Boolean);

    writeTimelineMonthIndex(cacheKey, {
        workspaceId: context.workspaceId,
        monthKey: context.monthKey,
        fastSignature,
        viewSignature: context.viewSignature,
        structureSignature: timelineStructureSignature(
            context,
            context.monthKey
        ),
        filtersSignature: context.filtersSignature,
        shellHTML: timelineShellHTML(context),
        rows,
        totalRows: context.orderedGroup.length,
        complete:
            options.complete === true ||
            rows.length >= context.orderedGroup.length
    });
}

function clearTimelineCache() {
    timelineMemoryCache.clear();
    timelineRowMemoryCache.clear();
    timelineMetricsMemoryCache.clear();
    timelineMonthIndexMemoryCache.clear();
    listKeys(TIMELINE_CACHE_PREFIX).forEach(removeKey);
    listKeys(TIMELINE_ROW_CACHE_PREFIX).forEach(removeKey);
    listKeys(TIMELINE_METRICS_CACHE_PREFIX).forEach(removeKey);
    listKeys(TIMELINE_MONTH_INDEX_CACHE_PREFIX).forEach(removeKey);
}

function clearLegacyTimelineCache() {
    timelineMemoryCache.clear();
    timelineMonthIndexMemoryCache.clear();
    listKeys(TIMELINE_CACHE_PREFIX)
        .filter(key =>
            !key.startsWith(TIMELINE_ROW_CACHE_PREFIX) &&
            !key.startsWith(TIMELINE_METRICS_CACHE_PREFIX) &&
            !key.startsWith(TIMELINE_MONTH_INDEX_CACHE_PREFIX)
        )
        .forEach(removeKey);
    listKeys(TIMELINE_MONTH_INDEX_CACHE_PREFIX).forEach(removeKey);
}

function timelineProfilesFromReplacementContractRaw(raw) {
    if (!raw) return [];

    try {
        const contracts = JSON.parse(raw);

        if (!Array.isArray(contracts)) return [];

        return contracts
            .flatMap(contract => [
                contract?.worker,
                contract?.replaces
            ])
            .map(name => String(name || "").trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

function timelineAffectedProfilesFromKeys(keys = [], changes = {}) {
    const profiles = getProfiles();
    const names = new Set();
    const prefixes = [
        "data_",
        "admin_",
        "legal_",
        "comp_",
        "absences_",
        "blocked_",
        "rotativa_",
        "replacementContracts_",
        "carry_",
        "clockMarks_",
        "hourReturns_"
    ];

    keys.forEach(key => {
        const text = String(key || "");

        prefixes.forEach(prefix => {
            if (!text.startsWith(prefix)) return;

            const rest = text.slice(prefix.length);
            const match = profiles.find(profile =>
                rest === profile.name ||
                rest.startsWith(`${profile.name}_`)
            );

            if (match) names.add(match.name);

            if (prefix === "replacementContracts_") {
                const change = changes?.[text] || {};

                timelineProfilesFromReplacementContractRaw(
                    change.previous
                ).forEach(name => names.add(name));
                timelineProfilesFromReplacementContractRaw(
                    change.next
                ).forEach(name => names.add(name));
            }
        });
    });

    return names;
}

function clearTimelineRowCacheForProfiles(profileNames = new Set()) {
    if (!profileNames.size) return false;

    const workerIds = new Set(
        getProfiles()
            .filter(profile => profileNames.has(profile.name))
            .map(timelineWorkerId)
    );
    const keys = listKeys(TIMELINE_ROW_CACHE_PREFIX);
    const metricKeys = listKeys(TIMELINE_METRICS_CACHE_PREFIX);
    const indexKeys = listKeys(TIMELINE_MONTH_INDEX_CACHE_PREFIX);

    keys.forEach(key => {
        const payload = timelineRowMemoryCache.get(key) ||
            parseTimelineRowCache(getRaw(key, null));

        if (
            profileNames.has(payload?.profileName) ||
            workerIds.has(payload?.workerId)
        ) {
            timelineRowMemoryCache.delete(key);
            removeKey(key);
        }
    });

    Array.from(timelineRowMemoryCache.entries())
        .forEach(([key, payload]) => {
            if (
                profileNames.has(payload?.profileName) ||
                workerIds.has(payload?.workerId)
            ) {
                timelineRowMemoryCache.delete(key);
            }
        });

    metricKeys.forEach(key => {
        const payload = timelineMetricsMemoryCache.get(key) ||
            parseTimelineCache(getRaw(key, null));

        if (
            profileNames.has(payload?.profileName) ||
            workerIds.has(payload?.workerId)
        ) {
            timelineMetricsMemoryCache.delete(key);
            removeKey(key);
        }
    });

    Array.from(timelineMetricsMemoryCache.entries())
        .forEach(([key, payload]) => {
            if (
                profileNames.has(payload?.profileName) ||
                workerIds.has(payload?.workerId)
            ) {
                timelineMetricsMemoryCache.delete(key);
            }
        });

    indexKeys.forEach(key => {
        const payload = timelineMonthIndexMemoryCache.get(key) ||
            parseTimelineCache(getRaw(key, null));
        const touchesProfile = Array.isArray(payload?.rows) &&
            payload.rows.some(row =>
                profileNames.has(row?.profileName) ||
                workerIds.has(row?.workerId)
            );

        if (touchesProfile) {
            timelineMonthIndexMemoryCache.delete(key);
            removeKey(key);
        }
    });

    Array.from(timelineMonthIndexMemoryCache.entries())
        .forEach(([key, payload]) => {
            const touchesProfile = Array.isArray(payload?.rows) &&
                payload.rows.some(row =>
                    profileNames.has(row?.profileName) ||
                    workerIds.has(row?.workerId)
                );

            if (touchesProfile) {
                timelineMonthIndexMemoryCache.delete(key);
            }
        });

    return true;
}

function timelineMonthLabel(year, month) {
    return new Date(Number(year), Number(month), 1)
        .toLocaleString("es-CL", {
            month: "long",
            year: "numeric"
        });
}

function timelineIsVisibleView() {
    const activeView = document.body.dataset.activeView || "turnos";

    return ["turnos", "timeline"].includes(activeView);
}

function timelinePendingHTML(year, month) {
    return `
        <div class="empty-state empty-state--compact timeline-pending-state">
            Actualizando timeline de ${escapeHtml(timelineMonthLabel(year, month))}...
        </div>
    `;
}

function timelineDisabledHTML(year, month) {
    return `
        <div class="empty-state empty-state--compact">
            Timeline desactivado temporalmente para prueba de velocidad
            <br>
            <small>${escapeHtml(timelineMonthLabel(year, month))}</small>
        </div>
    `;
}

function renderTimelineDisabledState(div, year, month) {
    if (!div) return false;

    stopTimelineOutsideClickListener();
    timelineViewState = null;
    div.dataset.timelineMonthKey = timelineMonthKey(year, month);
    div.dataset.timelineState = "disabled";
    div.setAttribute("aria-busy", "false");
    div.innerHTML = timelineDisabledHTML(year, month);
    return true;
}

export function showTimelinePendingMonth(year, month) {
    const div = document.getElementById("teamTimeline");

    if (!div || !timelineIsVisibleView()) return false;

    if (TIMELINE_DISABLED_FOR_SPEED_TEST) {
        return renderTimelineDisabledState(div, year, month);
    }

    const key = timelineMonthKey(year, month);

    if (
        div.dataset.timelineMonthKey === key &&
        div.dataset.timelineState === "ready"
    ) {
        return false;
    }

    timelineViewState = null;
    div.dataset.timelineMonthKey = key;
    div.dataset.timelineState = "pending";
    div.setAttribute("aria-busy", "true");

    if (timelineRowsTbody(div)) {
        updateTimelineProgress(
            div,
            `Actualizando timeline de ${timelineMonthLabel(year, month)}...`
        );
        return true;
    }

    stopTimelineOutsideClickListener();
    div.innerHTML = timelinePendingHTML(year, month);
    return true;
}

function yieldTimelineRender() {
    return new Promise(resolve => {
        setTimeout(resolve, 0);
    });
}

function waitTimelineIdle(timeout = 180) {
    return new Promise(resolve => {
        if (
            typeof window !== "undefined" &&
            typeof document !== "undefined" &&
            document.visibilityState === "hidden"
        ) {
            waitTimelineVisible().then(resolve);
            return;
        }

        if (
            typeof window !== "undefined" &&
            typeof window.requestIdleCallback === "function"
        ) {
            window.requestIdleCallback(resolve, { timeout });
            return;
        }

        window.setTimeout(resolve, 0);
    });
}

function markTimelineUserActivity() {
    timelineLastUserActivityAt = Date.now();
}

function timelineHasPendingInput() {
    try {
        return Boolean(
            typeof navigator !== "undefined" &&
            navigator.scheduling &&
            typeof navigator.scheduling.isInputPending === "function" &&
            navigator.scheduling.isInputPending({ includeContinuous: true })
        );
    } catch (_error) {
        return false;
    }
}

function timelineInteractiveDelay(quietMs = TIMELINE_METRICS_USER_QUIET_MS) {
    if (typeof document === "undefined") return 0;
    if (document.visibilityState !== "visible") return 0;

    // Las metricas HHEE son utiles pero no deben competir con scroll, clicks
    // ni cambios de mes. Mientras la pestaña esta visible se reintentan luego;
    // al ocultarse, pueden refrescar cache en segundo plano.
    const delay = Math.max(
        TIMELINE_METRICS_VISIBLE_RETRY_MS,
        TIMELINE_METRICS_RETRY_MS,
        Number(quietMs) || TIMELINE_METRICS_USER_QUIET_MS
    );

    return timelineHasPendingInput()
        ? Math.max(delay, TIMELINE_METRICS_RETRY_MS)
        : delay;
}

function waitTimelineBackgroundIdle(timeout = 500) {
    return new Promise(resolve => {
        if (
            typeof window !== "undefined" &&
            typeof window.requestIdleCallback === "function"
        ) {
            window.requestIdleCallback(resolve, {
                timeout: Math.max(120, Number(timeout) || 500)
            });
            return;
        }

        window.setTimeout(resolve, 0);
    });
}

function waitTimelineVisible() {
    if (
        typeof document === "undefined" ||
        document.visibilityState !== "hidden"
    ) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        timelineVisibilityResolvers.add(resolve);
    });
}

async function pauseTimelineIfHidden(container = null) {
    if (
        typeof document === "undefined" ||
        document.visibilityState !== "hidden"
    ) {
        return;
    }

    if (container) {
        updateTimelineProgress(
            container,
            "Timeline pausado hasta volver a la pesta\u00f1a..."
        );
    }

    await waitTimelineVisible();

    if (container) {
        updateTimelineProgress(
            container,
            "Actualizando timeline..."
        );
    }
}

function timelineRenderIsCurrent(requestId, year, month) {
    return (
        requestId === timelineRenderRequest &&
        calendar.currentDate.getFullYear() === year &&
        calendar.currentDate.getMonth() === month &&
        ["turnos", "timeline"].includes(
            document.body.dataset.activeView
        )
    );
}

export function cancelTimelineRender() {
    timelineRenderRequest++;
    timelineMetricsRefreshTimers.forEach(timer => clearTimeout(timer));
    timelineMetricsRefreshTimers.clear();
    timelineMetricsRefreshRequests.clear();
}

// Escapa un valor para usarlo dentro de un selector [attr="valor"].
function cssAttr(value) {
    return String(value).replace(/["\\]/g, "\\$&");
}

// Delegacion de clicks de la grilla en el contenedor persistente. Asi las
// casillas reemplazadas de forma incremental siguen respondiendo sin re-enlazar
// manejadores. Se enlaza una sola vez por contenedor.
function ensureTimelineCellDelegation(container) {
    if (!container || container.dataset.timelineDelegated === "1") return;

    container.dataset.timelineDelegated = "1";
    container.addEventListener("click", event => {
        const cell = event.target.closest(
            "[data-replacement-profile]," +
            "[data-worker-replacement-profile]," +
            "[data-extra-profile]," +
            "[data-clock-extra-profile]," +
            "[data-contract-error-profile]," +
            "[data-honoraria-limit-profile]"
        );

        if (cell && container.contains(cell)) {
            event.preventDefault();
            event.stopPropagation();

            if (cell.dataset.contractErrorProfile) {
                // La cruz de "sin contrato" tiene prioridad visual y de accion:
                // el dia puede tener tambien un reemplazo, pero lo primero es
                // configurar el contrato (modal de contratos), no anularlo.
                window.startReplacementContractEdit?.(
                    cell.dataset.contractErrorProfile,
                    cell.dataset.contractErrorKey
                );
            } else if (cell.dataset.replacementProfile) {
                window.openReplacementDialog?.(
                    cell.dataset.replacementProfile,
                    cell.dataset.replacementKey
                );
            } else if (cell.dataset.workerReplacementProfile) {
                window.openReplacementDetailDialog?.(
                    cell.dataset.workerReplacementProfile,
                    cell.dataset.workerReplacementKey,
                    cell.dataset.workerReplacementId || ""
                );
            } else if (cell.dataset.extraProfile) {
                window.openExtraReasonDialog?.(
                    cell.dataset.extraProfile,
                    cell.dataset.extraKey,
                    Number(cell.dataset.extraTurn) || 0
                );
            } else if (cell.dataset.clockExtraProfile) {
                window.openClockExtraReasonDialog?.(
                    cell.dataset.clockExtraProfile,
                    cell.dataset.clockExtraKey,
                    Number(cell.dataset.clockExtraTurn) || 0
                );
            } else if (cell.dataset.honorariaLimitProfile) {
                alert(cell.dataset.honorariaLimitMessage);
            }

            return;
        }

        const profileButton = event.target.closest("[data-profile-name]");

        if (profileButton && container.contains(profileButton)) {
            event.preventDefault();
            setTimelineFilterOpen(container, false);
            window.selectProfileByName?.(
                profileButton.dataset.profileName,
                {
                    openTurns: true,
                    scrollToTop: true
                }
            );
            return;
        }
    });
}

function revealTimelineRow(container, rowIndex) {
    const rows = container.querySelectorAll(".timeline-table tbody tr");
    const index = Math.min(
        Math.max(Number(rowIndex) || 0, 0),
        rows.length - 1
    );
    const row = rows[index];

    if (!row) return;

    window.requestAnimationFrame(() => {
        row.scrollIntoView({
            block: "start",
            inline: "nearest",
            behavior: "smooth"
        });
    });
}

function syncTimelineActiveProfile(container, activeProfile = getCurrentProfile()) {
    if (!container) return;

    const activeName = String(activeProfile || "");

    container
        .querySelectorAll(".timeline-profile-link[data-profile-name]")
        .forEach(button => {
            const isActive =
                Boolean(activeName) &&
                button.dataset.profileName === activeName;

            button.classList.toggle(
                "is-current-calendar-profile",
                isActive
            );

            if (isActive) {
                button.setAttribute("aria-current", "true");
            } else {
                button.removeAttribute("aria-current");
            }
        });
}

// Actualiza en el DOM solo las casillas indicadas de un trabajador (color,
// marcador, titulo y estado) sin reconstruir todo el timeline. No hace nada si
// el timeline no esta renderizado o el trabajador no esta en la vista actual.
// Si no se pasan claves, refresca toda la fila del trabajador en el mes visible.
export function updateTimelineCells(profileName, keys = null) {
    if (TIMELINE_DISABLED_FOR_SPEED_TEST) return false;

    const container = document.getElementById("teamTimeline");

    if (!container || !timelineViewState || !profileName) return false;

    const rowCell = container.querySelector(
        `.mini[data-timeline-profile="${cssAttr(profileName)}"]`
    );

    if (!rowCell) return false;

    const profile = getProfiles().find(item => item.name === profileName);

    if (!profile) return false;

    const { year, month, diasMes, holidays } = timelineViewState;
    const ctx = {
        year,
        month,
        holidays,
        leaveMaps: {
            admin: getAdmin(profileName),
            legal: getLegal(profileName),
            comp: getComp(profileName),
            absences: getAbs(profileName)
        },
        honorariaSummary: getHonorariaMonthlySummary(
            profileName,
            year,
            month,
            holidays
        )
    };
    const targetKeys = Array.isArray(keys)
        ? keys
        : keys
            ? [keys]
            : monthKeys(year, month, diasMes);
    const template = document.createElement("tbody");
    let updated = false;

    targetKeys.forEach(key => {
        const [ky, km, day] = String(key).split("-").map(Number);

        if (ky !== year || km !== month || !day || day < 1 || day > diasMes) {
            return;
        }

        const current = container.querySelector(
            `.mini[data-timeline-profile="${cssAttr(profileName)}"]` +
            `[data-timeline-key="${cssAttr(key)}"]`
        );

        if (!current) return;

        template.innerHTML =
            `<tr>${renderTimelineDayCell(profile, day, ctx)}</tr>`;
        const next = template.querySelector("td");

        if (next) {
            current.replaceWith(next);
            updated = true;
        }
    });

    if (updated) {
        clearLegacyTimelineCache();
        clearTimelineRowCacheForProfiles(new Set([profileName]));
        // Un turno extra / reemplazo cambia las HH.EE del mes: recomputa SOLO
        // este trabajador y refresca su columna de HH.EE. Sin esto la columna
        // quedaba con el valor previo (0 -> vacía) tras editar (regresión de la
        // actualización incremental de casillas).
        refreshTimelineRowHheeCells(
            rowCell.closest("[data-timeline-row]"),
            profile,
            { year, month, diasMes, holidays }
        );
    }

    return updated;
}

// Recalcula y actualiza SOLO las columnas de HH.EE (diurnas/nocturnas) de la
// fila de un trabajador, sin reconstruir el resto de la fila. Reutiliza el MISMO
// motor de horas que Reportes (calcularHorasMesPerfil vía
// computeTimelineRowMetrics), computa un único trabajador y persiste la caché de
// métricas para que un render completo posterior sea coherente.
function refreshTimelineRowHheeCells(row, profile, {
    year,
    month,
    diasMes,
    holidays
}) {
    if (!row || !profile) return;

    const dayCell = row.querySelector(".timeline-hhee--day");
    const nightCell = row.querySelector(".timeline-hhee--night");

    if (!dayCell && !nightCell) return;

    const { stats, honorariaSummary, totalHhee } = computeTimelineRowMetrics({
        profile,
        year,
        month,
        diasMes,
        holidays,
        data: getTimelineCachedData(profile.name)
    });
    const dayHhee = honorariaSummary
        ? honorariaSummary.overtimeDay
        : stats.hheeDiurnas;
    const nightHhee = honorariaSummary
        ? honorariaSummary.overtimeNight
        : stats.hheeNocturnas;
    const honorariaHheeClass =
        honorariaSummary?.overtimeHours > 0
            ? " honoraria-hhee-excess"
            : "";

    if (dayCell) {
        dayCell.className =
            "timeline-hhee timeline-hhee--day" +
            dayExtraAlertClass(
                profile.name,
                dayHhee,
                new Date(year, month, 1)
            ) +
            honorariaHheeClass;
        dayCell.textContent = formatTimelineHours(dayHhee);
    }

    if (nightCell) {
        nightCell.className =
            "timeline-hhee timeline-hhee--night" + honorariaHheeClass;
        nightCell.textContent = formatTimelineHours(nightHhee);
    }

    const workerId = timelineWorkerId(profile);
    const monthKey = timelineMonthKey(year, month);

    writeTimelineMetricsCache(
        timelineMetricsCacheKey({ monthKey, workerId }),
        {
            monthKey,
            workerId,
            profileName: profile.name,
            stats,
            honorariaSummary,
            totalHhee
        }
    );
}

function getData(nombre){
    return getJSON("data_" + nombre, {});
}

function getAdmin(nombre){
    return getJSON("admin_" + nombre, {});
}

function getLegal(nombre){
    return getJSON("legal_" + nombre, {});
}

function getComp(nombre){
    return getJSON("comp_" + nombre, {});
}

function getAbs(nombre){
    return getJSON("absences_" + nombre, {});
}

function getBlocked(nombre){
    return getJSON("blocked_" + nombre, {});
}

function getCarry(nombre, y, m){
    return getJSON(
        `carry_${nombre}_${y}_${m}`,
        { d: 0, n: 0 }
    );
}

function timelineEnsureNestedMap(map, key) {
    let nested = map.get(key);

    if (!nested) {
        nested = new Map();
        map.set(key, nested);
    }

    return nested;
}

function createTimelineRenderCache(year, month, diasMes) {
    const keys = monthKeys(year, month, diasMes);
    const isoByKey = new Map();
    const dateByKey = new Map();
    const blockedByProfileKey = new Map();
    const replacementByProfileIso = new Map();
    const coveredReplacementByProfileIso = new Map();
    const clockExtraBackupByProfileIso = new Map();
    const replacementTurnByProfileKey = new Map();
    const backedTurnByProfileKey = new Map();

    keys.forEach(keyDay => {
        const iso = isoFromKey(keyDay);

        isoByKey.set(keyDay, iso);
        dateByKey.set(
            keyDay,
            new Date(year, month, Number(keyDay.split("-")[2]))
        );
    });

    getWorkerBlockedDays().forEach(item => {
        const itemProfileKey =
            item?.profileKey || normalizeText(item?.profileName);

        if (
            !itemProfileKey ||
            !timelineISOInMonth(item.date, year, month)
        ) {
            return;
        }

        timelineEnsureNestedMap(
            blockedByProfileKey,
            itemProfileKey
        ).set(item.date, item);
    });

    getReplacements()
        .filter(replacementActive)
        .forEach(replacement => {
            const iso = String(replacement?.date || "");

            if (!timelineISOInMonth(iso, year, month)) return;

            const keyDay = keyFromISO(iso);
            const workerName = replacement.worker || "";
            const replacedName = replacement.replaced || "";

            if (workerName) {
                const replacementMap = timelineEnsureNestedMap(
                    replacementByProfileIso,
                    workerName
                );

                if (!replacementMap.has(iso)) {
                    replacementMap.set(iso, replacement);
                }

                if (replacement.addsShift !== false) {
                    addReplacementTurn(
                        timelineEnsureNestedMap(
                            replacementTurnByProfileKey,
                            workerName
                        ),
                        keyDay,
                        replacement
                    );
                }

                if (replacement.source !== "clock_extra") {
                    addReplacementTurn(
                        timelineEnsureNestedMap(
                            backedTurnByProfileKey,
                            workerName
                        ),
                        keyDay,
                        replacement
                    );
                }

                if (replacement.source === "clock_extra") {
                    const backupMap = timelineEnsureNestedMap(
                        clockExtraBackupByProfileIso,
                        workerName
                    );

                    if (!backupMap.has(iso)) {
                        backupMap.set(iso, replacement);
                    }
                }
            }

            if (replacedName) {
                const coveredMap = timelineEnsureNestedMap(
                    coveredReplacementByProfileIso,
                    replacedName
                );

                if (!coveredMap.has(iso)) {
                    coveredMap.set(iso, replacement);
                }
            }
        });

    getAllReplacementContracts()
        .forEach(contract => {
            keys.forEach(keyDay => {
                const iso = isoByKey.get(keyDay);

                if (
                    !iso ||
                    !replacementContractCoversCoveredShift(
                        contract,
                        keyDay
                    )
                ) {
                    return;
                }

                const coveredMap = timelineEnsureNestedMap(
                    coveredReplacementByProfileIso,
                    contract.replaces
                );

                if (!coveredMap.has(iso)) {
                    coveredMap.set(iso, {
                        id: `contract:${contract.id}:${iso}`,
                        date: iso,
                        worker: contract.worker,
                        replaced: contract.replaces,
                        source: "replacement_contract",
                        contractId: contract.id,
                        inherited: true
                    });
                }
            });
        });

    return {
        year,
        month,
        diasMes,
        keys,
        isoByKey,
        dateByKey,
        blockedByProfileKey,
        replacementByProfileIso,
        coveredReplacementByProfileIso,
        clockExtraBackupByProfileIso,
        replacementTurnByProfileKey,
        backedTurnByProfileKey,
        swaps: getSwaps(),
        dataByProfile: new Map(),
        baseDataByProfile: new Map(),
        leaveMapsByProfile: new Map(),
        blockedByProfile: new Map(),
        carryByProfileMonth: new Map(),
        rotativaByProfile: new Map(),
        hourReturnsByProfile: new Map(),
        clockMarksByProfile: new Map(),
        baseSequenceByProfile: new Map()
    };
}

function timelineCachedJSON(renderCache, mapName, cacheKey, storageKey, fallback) {
    const map = renderCache?.[mapName];

    if (!map) return getJSON(storageKey, fallback);

    if (!map.has(cacheKey)) {
        map.set(cacheKey, getJSON(storageKey, fallback));
    }

    return map.get(cacheKey);
}

function getTimelineCachedData(nombre, renderCache = null) {
    return timelineCachedJSON(
        renderCache,
        "dataByProfile",
        nombre,
        "data_" + nombre,
        {}
    );
}

function getTimelineCachedBaseData(nombre, renderCache = null) {
    return timelineCachedJSON(
        renderCache,
        "baseDataByProfile",
        nombre,
        "baseData_" + nombre,
        {}
    );
}

function getTimelineCachedLeaveMaps(nombre, renderCache = null) {
    if (!renderCache?.leaveMapsByProfile) {
        return {
            admin: getAdmin(nombre),
            legal: getLegal(nombre),
            comp: getComp(nombre),
            absences: getAbs(nombre)
        };
    }

    if (!renderCache.leaveMapsByProfile.has(nombre)) {
        renderCache.leaveMapsByProfile.set(nombre, {
            admin: getAdmin(nombre),
            legal: getLegal(nombre),
            comp: getComp(nombre),
            absences: getAbs(nombre)
        });
    }

    return renderCache.leaveMapsByProfile.get(nombre);
}

function getTimelineCachedBlocked(nombre, renderCache = null) {
    return timelineCachedJSON(
        renderCache,
        "blockedByProfile",
        nombre,
        "blocked_" + nombre,
        {}
    );
}

function getTimelineCachedCarry(nombre, y, m, renderCache = null) {
    const key = `${nombre}\u001f${y}\u001f${m}`;

    return timelineCachedJSON(
        renderCache,
        "carryByProfileMonth",
        key,
        `carry_${nombre}_${y}_${m}`,
        { d: 0, n: 0 }
    );
}

function getTimelineCachedRotativa(nombre, renderCache = null) {
    return timelineCachedJSON(
        renderCache,
        "rotativaByProfile",
        nombre,
        `rotativa_${nombre}`,
        {}
    );
}

function getTimelineCachedHourReturns(nombre, renderCache = null) {
    if (!renderCache?.hourReturnsByProfile) {
        return getHourReturns(nombre);
    }

    if (!renderCache.hourReturnsByProfile.has(nombre)) {
        renderCache.hourReturnsByProfile.set(
            nombre,
            getHourReturns(nombre)
        );
    }

    return renderCache.hourReturnsByProfile.get(nombre);
}

function getTimelineCachedClockMarks(nombre, renderCache = null) {
    if (!renderCache?.clockMarksByProfile) {
        return getClockMarks(nombre);
    }

    if (!renderCache.clockMarksByProfile.has(nombre)) {
        renderCache.clockMarksByProfile.set(
            nombre,
            getClockMarks(nombre)
        );
    }

    return renderCache.clockMarksByProfile.get(nombre);
}

function formatTimelineHours(value){
    const rounded =
        Math.round((Number(value) || 0) * 2) / 2;

    if (!rounded) return "";

    return String(rounded).replace(".", ",");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function stopTimelineOutsideClickListener() {
    if (!timelineOutsideClickController) return;

    timelineOutsideClickController.abort();
    timelineOutsideClickController = null;
}

function setTimelineFilterOpen(container, open) {
    timelineFilterState.open = Boolean(open);
    container
        .querySelector(".timeline-filter")
        ?.classList.toggle("is-open", timelineFilterState.open);

    if (timelineFilterState.open) {
        bindTimelineOutsideClickListener(container);
    } else {
        stopTimelineOutsideClickListener();
    }
}

function bindTimelineOutsideClickListener(container) {
    stopTimelineOutsideClickListener();

    if (!timelineFilterState.open) return;

    timelineOutsideClickController = new AbortController();
    const { signal } = timelineOutsideClickController;

    document.addEventListener(
        "click",
        event => {
            const filter = container.querySelector(".timeline-filter");

            if (filter?.contains(event.target)) return;

            setTimelineFilterOpen(container, false);
        },
        { signal }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (event.key !== "Escape") return;

            setTimelineFilterOpen(container, false);
        },
        { signal }
    );
}

function normalizeTextKey(value) {
    return normalizeText(value);
}

function displayProfession(value) {
    const clean = String(value || "Sin informacion").trim();

    return normalizeTextKey(clean) === "sin informacion"
        ? "Sin informacion"
        : clean;
}

function profileUsesProfessionGroup(profile = {}) {
    return (
        profile.estamento === "Profesional" ||
        profile.estamento === "T\u00e9cnico"
    );
}

function timelineGroupForProfile(profile = {}) {
    if (profileUsesProfessionGroup(profile)) {
        const profession = displayProfession(profile.profession);
        const isUnspecified =
            normalizeTextKey(profession) === "sin informacion";
        const key = isUnspecified
            ? `profession:${profile.estamento}:${normalizeTextKey(profession)}`
            : `profession:${normalizeTextKey(profession)}`;

        return {
            key,
            label: isUnspecified
                ? `${profile.estamento || "Sin estamento"} | ${profession}`
                : profession,
            type: "profession"
        };
    }

    const estamento = profile.estamento || "Sin estamento";

    return {
        key: `estamento:${normalizeTextKey(estamento)}`,
        label: estamento,
        type: "estamento"
    };
}

function timelineFilterGroups(profiles = []) {
    const groups = new Map();

    profiles.forEach(profile => {
        const group = timelineGroupForProfile(profile);
        const existing = groups.get(group.key);

        groups.set(group.key, {
            ...group,
            count: (existing?.count || 0) + 1
        });
    });

    return Array.from(groups.values())
        .sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "profession" ? -1 : 1;
            }

            return a.label.localeCompare(b.label);
        });
}

function ensureTimelineFilter(perfilActual, groups) {
    const availableKeys = new Set(
        groups.map(group => group.key)
    );
    const currentGroup = perfilActual
        ? timelineGroupForProfile(perfilActual)
        : groups[0];
    let selectedKey =
        Array.from(timelineFilterState.selectedKeys || [])[0] ||
        currentGroup?.key ||
        groups[0]?.key ||
        "";

    if (
        currentGroup?.key &&
        availableKeys.has(currentGroup.key) &&
        selectedKey !== currentGroup.key
    ) {
        selectedKey = currentGroup.key;
        timelineFilterState.open = false;
    } else if (!availableKeys.has(selectedKey)) {
        selectedKey = currentGroup?.key || groups[0]?.key || "";
        timelineFilterState.open = false;
    }

    timelineFilterState.anchorProfile = "";
    timelineFilterState.selectedKeys = selectedKey
        ? new Set([selectedKey])
        : new Set();

    const selectedGroup =
        groups.find(group => group.key === selectedKey) ||
        currentGroup ||
        groups[0];

    return {
        baseGroup: selectedGroup,
        selectedKeys: timelineFilterState.selectedKeys
    };
}

function timelineFilterHTML(groups, selectedKeys) {
    const selectedKey = Array.from(selectedKeys || [])[0] || "";

    return `
        <div class="timeline-filter timeline-filter--single">
            <select class="timeline-filter__select" data-timeline-filter-select>
                ${groups.map(group => `
                    <option
                        value="${escapeHtml(group.key)}"
                        ${group.key === selectedKey ? "selected" : ""}
                    >
                        ${escapeHtml(`${group.label} (${group.count})`)}
                    </option>
                `).join("")}
            </select>
        </div>
    `;
}

function dayExtraAlertClass(nombre, value, monthDate = new Date()) {
    if (!getShiftAssigned(nombre, monthDate)) {
        return "";
    }

    const hours = Number(value) || 0;

    if (hours >= 40) {
        return " hhee-alert-danger";
    }

    if (hours > 30 && hours < 40) {
        return " hhee-alert-warning";
    }

    return "";
}

function syncTimelineStickyOffsets(container) {
    return measurePerformance(
        "timeline:sync-sticky-offsets",
        () => {
            const shell = container.querySelector(".timeline-shell");
            const headerCells = container.querySelectorAll(
                ".timeline-table thead th"
            );

            if (!shell || headerCells.length < 3) return;

            const nameWidth = Math.ceil(
                headerCells[0].getBoundingClientRect().width
            );
            const dayWidth = Math.ceil(
                headerCells[1].getBoundingClientRect().width
            );

            shell.style.setProperty(
                "--timeline-hhee-day-left",
                `${nameWidth}px`
            );
            shell.style.setProperty(
                "--timeline-hhee-night-left",
                `${nameWidth + dayWidth}px`
            );
        },
        {
            rowCount:
                container?.querySelectorAll?.("[data-timeline-row]")?.length || 0
        }
    );
}

function getColor(nombre, key, maps = null, isExtra = false, realTurn = null){
    const admin = maps?.admin || getAdmin(nombre);
    const legal = maps?.legal || getLegal(nombre);
    const comp = maps?.comp || getComp(nombre);
    const abs = maps?.absences || getAbs(nombre);
    const absenceType = getAbsenceType(abs[key]);

    if (absenceType === "professional_license") return "#2563eb";
    if (absenceType === "union_leave") return "#e64747";
    if (absenceType === "unpaid_leave") return "#6b7280";
    if (abs[key]) return "#d97706";
    if (legal[key]) return "#0ea5a6";
    if (comp[key]) return "#f97316";

    if (admin[key] === 1) return "#f59e0b";
    if (admin[key] === "0.5M") return "#fbbf24";
    if (admin[key] === "0.5T") return "#facc15";

    const turno = realTurn === null || realTurn === undefined
        ? getTurnoReal(nombre, key)
        : Number(realTurn) || TURNO.LIBRE;

    return getTurnoColor(turno, isExtra) || TURNO_COLOR[turno] || TURNO_COLOR[0];
}

function leaveTypeForDay(keyDay, maps) {
    const admin = maps?.admin || {};
    const legal = maps?.legal || {};
    const comp = maps?.comp || {};
    const absences = maps?.absences || {};

    if (admin[keyDay] === 1) return "admin";
    if (admin[keyDay] === "0.5M") return "half_admin_morning";
    if (admin[keyDay] === "0.5T") return "half_admin_afternoon";
    if (admin[keyDay] === 0.5) return "half_admin";
    if (legal[keyDay]) return "legal";
    if (comp[keyDay]) return "comp";

    const absence = absences[keyDay];

    if (!absence) return "";

    return esAusenciaInjustificada(absence)
        ? "unjustified_absence"
        : getAbsenceType(absence);
}

function leaveLabelForType(type) {
    if (type === "admin") return "P. Administrativo";
    if (type === "half_admin_morning") return "1/2 ADM Ma\u00f1ana";
    if (type === "half_admin_afternoon") return "1/2 ADM Tarde";
    if (type === "half_admin") return "1/2 ADM";
    if (type === "legal") return "F. Legal";
    if (type === "comp") return "F. Compensatorio";
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "unjustified_absence") return "Ausencia Injustificada";
    if (type === "license") return "Licencia Medica";

    return "Permiso/Ausencia";
}

function leaveSourceMapForType(type, maps) {
    if (
        type === "admin" ||
        type === "half_admin_morning" ||
        type === "half_admin_afternoon" ||
        type === "half_admin"
    ) {
        return maps?.admin || {};
    }

    if (type === "legal") return maps?.legal || {};
    if (type === "comp") return maps?.comp || {};

    return maps?.absences || {};
}

function leaveApplicationHoverTitle(profileName, keyDay, maps) {
    const type = leaveTypeForDay(keyDay, maps);

    if (!type) return "";

    const info = type === "half_admin"
        ? null
        : getLeaveApplicationInfo({
            profile: profileName,
            keyDay,
            type,
            sourceMap: leaveSourceMapForType(type, maps)
        });

    return [
        leaveLabelForType(type),
        `Aplicado: ${info?.createdAtLabel || "Sin registro"}`,
        `Usuario: ${info?.actorName || "No registrado"}`
    ].join("\n");
}

function needsReplacementMarker(nombre, key) {
    return (
        requiereReemplazoTurnoBase(
            key,
            getTurnoBase(nombre, key),
            getAdmin(nombre),
            getLegal(nombre),
            getComp(nombre),
            getAbs(nombre)
        ) &&
        !getReplacementForCoveredShift(nombre, key) &&
        !getInheritedReplacementContractForCoveredShift(nombre, key)
    );
}

function replacementMarker(nombre, key) {
    return getReplacementForWorkerShift(nombre, key);
}

function pendingManualExtraMarker(nombre, key) {
    const data = getData(nombre);
    const baseWithSwaps = aplicarCambiosTurno(
        nombre,
        key,
        getTurnoBase(nombre, key),
        { includeReplacements: false }
    );
    const actualWithSwaps = aplicarCambiosTurno(
        nombre,
        key,
        getTurnoProgramado(nombre, key),
        { includeReplacements: false }
    );
    const extraTurn = getTurnoExtraAgregado(
        baseWithSwaps,
        actualWithSwaps
    );

    return restarTurnoCubierto(
        extraTurn,
        getBackedTurnForWorker(nombre, key)
    );
}

function contractErrorMarker(nombre, key) {
    if (!isReplacementProfile(nombre)) {
        return false;
    }

    const state = aplicarCambiosTurno(
        nombre,
        key,
        getTurnoProgramado(nombre, key)
    );

    return state > 0 && !hasContractForDate(nombre, key);
}

function timelineISOInMonth(iso, year, month) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-\d{2}$/);

    return Boolean(match) &&
        Number(match[1]) === Number(year) &&
        Number(match[2]) - 1 === Number(month);
}

function mergeTimelineTurn(currentTurn, nextTurn) {
    return fusionarTurnos(
        Number(currentTurn) || TURNO.LIBRE,
        Number(nextTurn) || TURNO.LIBRE
    );
}

function addReplacementTurn(index, keyDay, replacement) {
    if (!keyDay || !replacement) return;

    index.set(
        keyDay,
        mergeTimelineTurn(
            index.get(keyDay) || TURNO.LIBRE,
            codeToTurno(replacement.turno)
        )
    );
}

function timelineClockMarkHasSevereIncident(mark) {
    if (!mark?.segments) return false;

    return Object.values(mark.segments).some(segment =>
        (segment?.missingEntry || segment?.missingExit) &&
        !segment?.rrhhPayApproved
    );
}

function timelineClockMarkHasSimpleIncident(mark) {
    if (!mark?.segments || timelineClockMarkHasSevereIncident(mark)) {
        return false;
    }

    return Object.values(mark.segments).some(segment =>
        (segment?.entryTime || segment?.exitTime) &&
        !segment?.rrhhPayApproved &&
        !segment?.discountWaived
    );
}

function buildTimelineRowAuxiliaryContext(
    profileName,
    year,
    month,
    diasMes,
    leaveMaps,
    rowData = {},
    renderCache = null
) {
    const finishAux = startPerformanceSpan(
        "timeline:row-aux-context",
        {
            profile: profileName,
            year,
            month,
            days: diasMes
        }
    );
    const keys = renderCache?.keys || monthKeys(year, month, diasMes);
    const isoByKey = renderCache?.isoByKey || new Map();
    const dateByKey = renderCache?.dateByKey || new Map();
    let blockedByIso = renderCache
        ? (
            renderCache.blockedByProfileKey
                ?.get(normalizeText(profileName)) ||
            new Map()
        )
        : null;
    let replacementByIso = renderCache
        ? (
            renderCache.replacementByProfileIso
                ?.get(profileName) ||
            new Map()
        )
        : null;
    let coveredReplacementByIso = renderCache
        ? (
            renderCache.coveredReplacementByProfileIso
                ?.get(profileName) ||
            new Map()
        )
        : null;
    let clockExtraBackupByIso = renderCache
        ? (
            renderCache.clockExtraBackupByProfileIso
                ?.get(profileName) ||
            new Map()
        )
        : null;
    let replacementTurnByKey = renderCache
        ? (
            renderCache.replacementTurnByProfileKey
                ?.get(profileName) ||
            new Map()
        )
        : null;
    let backedTurnByKey = renderCache
        ? (
            renderCache.backedTurnByProfileKey
                ?.get(profileName) ||
            new Map()
        )
        : null;
    const baseTurnByKey = new Map();
    const programmedTurnByKey = new Map();
    const realTurnByKey = new Map();
    const baseWithSwapsByKey = new Map();
    const actualWithoutReplacementsByKey = new Map();
    const pendingManualExtraByKey = new Map();
    const contractErrorByKey = new Map();
    const needsReplacementByKey = new Map();
    const profileKey = normalizeText(profileName);
    const swaps = renderCache?.swaps || getSwaps();
    const data =
        rowData?.data || getTimelineCachedData(profileName, renderCache);
    const isReplacement = isReplacementProfile(profileName);

    if (!renderCache) {
        keys.forEach(keyDay => {
            const iso = isoFromKey(keyDay);

            isoByKey.set(keyDay, iso);
            dateByKey.set(
                keyDay,
                new Date(year, month, Number(keyDay.split("-")[2]))
            );
        });
    }

    if (!blockedByIso) {
        blockedByIso = new Map();

        getWorkerBlockedDays().forEach(item => {
            const itemProfileKey =
                item?.profileKey || normalizeText(item?.profileName);

            if (
                itemProfileKey === profileKey &&
                timelineISOInMonth(item.date, year, month)
            ) {
                blockedByIso.set(item.date, item);
            }
        });
    }

    if (
        !replacementByIso ||
        !coveredReplacementByIso ||
        !clockExtraBackupByIso ||
        !replacementTurnByKey ||
        !backedTurnByKey
    ) {
        replacementByIso = replacementByIso || new Map();
        coveredReplacementByIso = coveredReplacementByIso || new Map();
        clockExtraBackupByIso = clockExtraBackupByIso || new Map();
        replacementTurnByKey = replacementTurnByKey || new Map();
        backedTurnByKey = backedTurnByKey || new Map();

        getReplacements()
            .filter(replacementActive)
            .forEach(replacement => {
                const iso = String(replacement?.date || "");

                if (!timelineISOInMonth(iso, year, month)) return;

                const keyDay = keyFromISO(iso);

                if (replacement.worker === profileName) {
                    if (!replacementByIso.has(iso)) {
                        replacementByIso.set(iso, replacement);
                    }

                    if (replacement.addsShift !== false) {
                        addReplacementTurn(
                            replacementTurnByKey,
                            keyDay,
                            replacement
                        );
                    }

                    if (replacement.source !== "clock_extra") {
                        addReplacementTurn(
                            backedTurnByKey,
                            keyDay,
                            replacement
                        );
                    }

                    if (
                        replacement.source === "clock_extra" &&
                        !clockExtraBackupByIso.has(iso)
                    ) {
                        clockExtraBackupByIso.set(iso, replacement);
                    }
                }

                if (
                    replacement.replaced === profileName &&
                    !coveredReplacementByIso.has(iso)
                ) {
                    coveredReplacementByIso.set(iso, replacement);
                }
            });
    }

    keys.forEach(keyDay => {
        const iso = isoByKey.get(keyDay);
        const replacementTurn =
            replacementTurnByKey.get(keyDay) || TURNO.LIBRE;
        const baseTurn = getTurnoBase(profileName, keyDay);
        const programmedTurn = getTurnoProgramado(profileName, keyDay);
        const baseWithSwaps = aplicarCambiosTurno(
            profileName,
            keyDay,
            baseTurn,
            {
                includeReplacements: false,
                replacementTurn,
                swaps,
                isoDate: iso
            }
        );
        const actualWithoutReplacements = aplicarCambiosTurno(
            profileName,
            keyDay,
            programmedTurn,
            {
                includeReplacements: false,
                replacementTurn,
                swaps,
                isoDate: iso
            }
        );
        const realTurn = aplicarCambiosTurno(
            profileName,
            keyDay,
            programmedTurn,
            {
                replacementTurn,
                swaps,
                isoDate: iso
            }
        );
        const extraTurn = getTurnoExtraAgregado(
            baseWithSwaps,
            actualWithoutReplacements
        );

        baseTurnByKey.set(keyDay, baseTurn);
        programmedTurnByKey.set(keyDay, programmedTurn);
        realTurnByKey.set(keyDay, realTurn);
        baseWithSwapsByKey.set(keyDay, baseWithSwaps);
        actualWithoutReplacementsByKey.set(
            keyDay,
            actualWithoutReplacements
        );
        pendingManualExtraByKey.set(
            keyDay,
            restarTurnoCubierto(
                extraTurn,
                backedTurnByKey.get(keyDay) || TURNO.LIBRE
            )
        );
        needsReplacementByKey.set(
            keyDay,
            requiereReemplazoTurnoBase(
                keyDay,
                baseTurn,
                leaveMaps.admin,
                leaveMaps.legal,
                leaveMaps.comp,
                leaveMaps.absences
            ) &&
            !coveredReplacementByIso.has(iso)
        );

        if (isReplacement) {
            contractErrorByKey.set(
                keyDay,
                realTurn > 0 && !hasContractForDate(profileName, keyDay)
            );
        }
    });

    const aux = {
        data,
        keys,
        isoByKey,
        dateByKey,
        blockedByIso,
        hourReturns: getTimelineCachedHourReturns(profileName, renderCache),
        clockMarks: getTimelineCachedClockMarks(profileName, renderCache),
        replacementByIso,
        coveredReplacementByIso,
        clockExtraBackupByIso,
        replacementTurnByKey,
        backedTurnByKey,
        baseTurnByKey,
        programmedTurnByKey,
        realTurnByKey,
        baseWithSwapsByKey,
        actualWithoutReplacementsByKey,
        pendingManualExtraByKey,
        contractErrorByKey,
        needsReplacementByKey
    };

    finishAux({
        blockedCount: blockedByIso.size,
        replacementCount: replacementByIso.size,
        coveredReplacementCount: coveredReplacementByIso.size
    });
    return aux;
}

function monthKeys(year, month, days) {
    return Array.from({ length: days }, (_, index) =>
        `${year}-${month}-${index + 1}`
    );
}

function timelineBaseSequence(profileName, keys, cache = null, renderCache = null) {
    if (cache?.has(profileName)) return cache.get(profileName);

    const baseData = getTimelineCachedBaseData(profileName, renderCache);
    const hasBaseData = Object.keys(baseData || {}).length > 0;
    const sequence = hasBaseData
        ? keys.map(key =>
            Object.prototype.hasOwnProperty.call(baseData, key)
                ? Number(baseData[key]) || TURNO.LIBRE
                : Number(getTurnoBase(profileName, key)) || TURNO.LIBRE
        )
        : keys.map(key =>
            Number(getTurnoBase(profileName, key)) || TURNO.LIBRE
        );

    cache?.set(profileName, sequence);
    return sequence;
}

function timelineSortContext(year, month, diasMes, renderCache = null) {
    const keys = renderCache?.keys || monthKeys(year, month, diasMes);
    const baseCache =
        renderCache?.baseSequenceByProfile || new Map();

    return {
        keys,
        baseCache,
        renderCache
    };
}

function timelineRotationRank(type) {
    if (type === "4turno") return 0;
    if (type === "3turno") return 1;
    if (type === "diurno") return 2;

    return 3;
}

function timelineFirstTurnIndex(sequence, candidates) {
    return sequence.findIndex(turn =>
        candidates.has(Number(turn))
    );
}

function timelineParseISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return null;

    const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    );

    return Number.isNaN(date.getTime()) ? null : date;
}

function timelineDayNumber(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return 0;
    }

    return Math.floor(Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    ) / 86400000);
}

function timelinePositiveModulo(value, modulo) {
    const base = Number(modulo) || 1;

    return ((Number(value) || 0) % base + base) % base;
}

function timelineRotationCycleLength(type) {
    if (type === "3turno") return 6;
    if (type === "4turno") return 4;

    return 1;
}

function timelineRotationFirstTurnIndex(type, firstTurn = "larga") {
    const normalized = normalizeText(firstTurn);

    if (type === "3turno") {
        if (normalized === "larga 2" || normalized === "larga2") return 1;
        if (normalized === "noche") return 2;
        if (normalized === "noche 2" || normalized === "noche2") return 3;
        if (normalized === "libre 1" || normalized === "libre1") return 4;
        if (normalized === "libre 2" || normalized === "libre2") return 5;

        return 0;
    }

    if (type === "4turno") {
        if (normalized === "noche") return 1;
        if (normalized === "libre 1" || normalized === "libre1") return 2;
        if (normalized === "libre 2" || normalized === "libre2") return 3;

        return 0;
    }

    return 0;
}

function timelineStructuralPhase(profile, rotativa) {
    const rotationType = String(rotativa?.type || "");

    if (rotationType === "diurno") return 0;

    const cycleLength = timelineRotationCycleLength(rotationType);

    if (cycleLength <= 1) return Number.MAX_SAFE_INTEGER;

    const start = timelineParseISODate(rotativa?.start);
    const anchor = timelineParseISODate(TIMELINE_STRUCTURE_ANCHOR_ISO);

    if (!start || !anchor) {
        return Number.MAX_SAFE_INTEGER;
    }

    const firstTurnIndex = timelineRotationFirstTurnIndex(
        rotationType,
        rotativa?.firstTurn
    );

    return timelinePositiveModulo(
        timelineDayNumber(anchor) -
            timelineDayNumber(start) +
            firstTurnIndex,
        cycleLength
    );
}

function timelineProfileStructuralSignature(profile, renderCache = null) {
    const rotativa = getTimelineCachedRotativa(profile.name, renderCache);
    const rotationType = String(rotativa?.type || "");

    return [
        timelineWorkerId(profile),
        profile.name,
        profile.active === false ? "inactive" : "active",
        profile.estamento || "",
        profile.profession || "",
        isReplacementProfile(profile.name) ? "replacement" : "staff",
        rotationType,
        rotativa?.start || "",
        rotativa?.firstTurn || ""
    ].join("\u001f");
}

function timelineStructuralProfileSort(profile, renderCache = null) {
    const rotativa = getTimelineCachedRotativa(profile.name, renderCache);
    const rotationType = String(rotativa?.type || "");

    return {
        priority: timelineRotationRank(rotationType),
        replacementRank: isReplacementProfile(profile.name) ? 1 : 0,
        phase: timelineStructuralPhase(profile, rotativa),
        matchIndex: timelineStructuralPhase(profile, rotativa),
        totalHhee: 0,
        name: profile.name,
        workerId: timelineWorkerId(profile)
    };
}

function timelineProfileSort(profile, sortContext, totalHhee = 0) {
    const { keys, baseCache, renderCache } = sortContext;
    const sequence = timelineBaseSequence(
        profile.name,
        keys,
        baseCache,
        renderCache
    );
    const rotativa =
        getTimelineCachedRotativa(profile.name, renderCache);
    const rotationType = String(rotativa?.type || "");
    const firstLarga = timelineFirstTurnIndex(
        sequence,
        TIMELINE_SORT_LARGA_TURNS
    );
    const firstNoche = timelineFirstTurnIndex(
        sequence,
        TIMELINE_SORT_NIGHT_TURNS
    );
    const firstDiurno = timelineFirstTurnIndex(
        sequence,
        TIMELINE_SORT_DIURNO_TURNS
    );
    const firstWorked = sequence.findIndex(turn =>
        Number(turn) > TURNO.LIBRE
    );
    const phaseIndex = firstLarga >= 0
        ? firstLarga
        : firstNoche >= 0
            ? firstNoche + 0.5
            : firstDiurno >= 0
                ? firstDiurno
                : firstWorked >= 0
                    ? firstWorked + 0.75
                    : Number.MAX_SAFE_INTEGER;

    if (false) {
        // Trabajadores cuyo segundo libre coincide con el primer largo
        // del trabajador visible: son la rotativa siguiente natural.
        return null;
    } else if (false) {
        // Luego vienen quienes tienen larga cuando el trabajador visible
        // está libre. El primer libre queda antes por matchIndex.
        return null;
    }

    return {
        priority: timelineRotationRank(rotationType),
        matchIndex: phaseIndex,
        totalHhee,
        name: profile.name
    };
}

function compareTimelineSort(a, b) {
    if (a.priority !== b.priority) {
        return a.priority - b.priority;
    }

    if (a.matchIndex !== b.matchIndex) {
        return a.matchIndex - b.matchIndex;
    }

    return a.name.localeCompare(b.name);
}

function compareTimelineStructuralSort(a, b) {
    if (a.priority !== b.priority) {
        return a.priority - b.priority;
    }

    if (a.replacementRank !== b.replacementRank) {
        return a.replacementRank - b.replacementRank;
    }

    if (a.phase !== b.phase) {
        return a.phase - b.phase;
    }

    const nameCompare = a.name.localeCompare(b.name);

    if (nameCompare !== 0) return nameCompare;

    return String(a.workerId || "").localeCompare(String(b.workerId || ""));
}

function orderTimelineProfiles(
    grupo,
    actual,
    year,
    month,
    diasMes,
    sortContext = null
) {
    return measurePerformance(
        "timeline:order-profiles",
        () => {
            const effectiveSortContext =
                sortContext || timelineSortContext(year, month, diasMes);

            return [...grupo]
                .map(profile => ({
                    profile,
                    sort: timelineStructuralProfileSort(
                        profile,
                        effectiveSortContext.renderCache || null
                    )
                }))
                .sort((a, b) =>
                    compareTimelineStructuralSort(a.sort, b.sort)
                )
                .map(item => item.profile);
        },
        {
            profileCount: grupo.length,
            actual,
            year,
            month
        }
    );
}

function timelineCellBackground(color, isInhabil) {
    if (!isInhabil) return color;

    if (color === TURNO_COLOR[0]) {
        return "var(--timeline-holiday)";
    }

    return `linear-gradient(rgba(239, 68, 68, 0.18), rgba(239, 68, 68, 0.18)), ${color}`;
}

function timelineBlockedDayBackground(isInhabil) {
    const overlay = isInhabil
        ? "rgba(71, 85, 105, 0.28)"
        : "rgba(100, 116, 139, 0.24)";

    return `linear-gradient(135deg, ${overlay}, rgba(148, 163, 184, 0.22)), var(--timeline-empty)`;
}

function emptyTimelineStats() {
    return {
        hheeDiurnas: 0,
        hheeNocturnas: 0
    };
}

function computeTimelineRowMetrics({
    profile,
    year,
    month,
    diasMes,
    holidays,
    data,
    renderCache = null
}) {
    const finishMetrics = startPerformanceSpan(
        "timeline:compute-row-metrics",
        {
            profile: profile?.name || "",
            year,
            month,
            days: diasMes
        }
    );
    const stats = calcularHorasMesPerfil(
        profile.name,
        year,
        month,
        diasMes,
        holidays,
        data,
        getTimelineCachedBlocked(profile.name, renderCache),
        getTimelineCachedCarry(profile.name, year, month, renderCache)
    );
    const honorariaSummary =
        getHonorariaMonthlySummary(
            profile.name,
            year,
            month,
            holidays
        );
    const totalHhee =
        (Number(stats.hheeDiurnas) || 0) +
        (Number(stats.hheeNocturnas) || 0);

    finishMetrics({
        totalHhee
    });

    return {
        stats,
        honorariaSummary,
        totalHhee
    };
}

function buildTimelineRowData({
    profile,
    actual,
    year,
    month,
    diasMes,
    holidays,
    keys,
    nightKeys,
    freeKeys,
    sortContext = null,
    metricsCacheKey = "",
    monthKey = timelineMonthKey(year, month),
    workerId = timelineWorkerId(profile),
    forceFreshMetrics = false,
    renderCache = null
}) {
    const finishRowData = startPerformanceSpan(
        "timeline:build-row-data",
        {
            profile: profile?.name || "",
            actual,
            year,
            month,
            days: diasMes
        }
    );
    const data = getTimelineCachedData(profile.name, renderCache);
    const cachedMetrics = !forceFreshMetrics && metricsCacheKey
        ? readTimelineMetricsCache(metricsCacheKey, {
            monthKey,
            workerId
        })
        : null;
    const metrics = forceFreshMetrics
        ? computeTimelineRowMetrics({
            profile,
            year,
            month,
            diasMes,
            holidays,
            data,
            renderCache
        })
        : cachedMetrics
            ? {
                stats: cachedMetrics.stats || emptyTimelineStats(),
                honorariaSummary: cachedMetrics.honorariaSummary || null,
                totalHhee: Number(cachedMetrics.totalHhee) || 0
            }
            : {
                stats: emptyTimelineStats(),
                honorariaSummary: null,
                totalHhee: 0
            };
    const effectiveSortContext =
        sortContext ||
        timelineSortContext(year, month, diasMes, renderCache);
    const sort = timelineStructuralProfileSort(
        profile,
        renderCache
    );

    const rowData = {
        profile,
        data,
        stats: metrics.stats,
        honorariaSummary: metrics.honorariaSummary,
        workerId,
        metricsCacheKey,
        metricsStale: !forceFreshMetrics && !cachedMetrics,
        sort,
        renderCache
    };

    if (forceFreshMetrics && metricsCacheKey) {
        writeTimelineMetricsCache(metricsCacheKey, {
            monthKey,
            workerId,
            profileName: profile.name,
            stats: metrics.stats,
            honorariaSummary: metrics.honorariaSummary,
            totalHhee: metrics.totalHhee
        });
    }

    finishRowData({
        totalHhee: metrics.totalHhee,
        workerId: rowData.workerId,
        metricsCached: Boolean(cachedMetrics),
        metricsStale: rowData.metricsStale
    });

    return rowData;
}

async function buildTimelineRows(
    grupo,
    actual,
    year,
    month,
    diasMes,
    holidays,
    isCanceled
) {
    const sortContext = timelineSortContext(year, month, diasMes);
    const { keys } = sortContext;

    const rows = [];

    for (const profile of grupo) {
        if (isCanceled()) return null;

        rows.push(buildTimelineRowData({
            profile,
            actual,
            year,
            month,
            diasMes,
            holidays,
            keys,
            sortContext
        }));

        await yieldTimelineRender();
    }

    return rows.sort((a, b) =>
        compareTimelineSort(a.sort, b.sort)
    );
}

// Construye una sola casilla-dia del timeline. Se reutiliza en el render
// completo y en la actualizacion incremental (updateTimelineCells), para no
// re-renderizar todo el timeline al aplicar un permiso o un reemplazo.
function renderTimelineDayCell(profile, d, {
    year,
    month,
    holidays,
    leaveMaps,
    honorariaSummary,
    rowAux = null
}) {
    const key = `${year}-${month}-${d}`;
    const iso = rowAux?.isoByKey?.get(key) || isoFromKey(key);
    const date = rowAux?.dateByKey?.get(key) || new Date(year, month, d);
    const realTurn = rowAux?.realTurnByKey?.has(key)
        ? rowAux.realTurnByKey.get(key)
        : getTurnoReal(profile.name, key);
    const baseTurn = rowAux?.baseTurnByKey?.has(key)
        ? rowAux.baseTurnByKey.get(key)
        : getTurnoBase(profile.name, key);
    const replacement = rowAux?.replacementByIso?.has(iso)
        ? rowAux.replacementByIso.get(iso)
        : replacementMarker(profile.name, key);
    const color = getColor(
        profile.name,
        key,
        leaveMaps,
        Boolean(replacement),
        realTurn
    );
    const isInhabil = !isBusinessDay(date, holidays);
    const workerBlockedDay = rowAux?.blockedByIso?.has(iso)
        ? rowAux.blockedByIso.get(iso)
        : getBlockedDayForProfile(profile.name, key);
    const hourReturn = rowAux?.hourReturns
        ? rowAux.hourReturns[key] || null
        : getHourReturn(profile.name, key);
    // Mismo esquema de bandas que el calendario (turnos combinados +
    // extension/reduccion de marcaje). Si devuelve gradiente, se usa.
    const dayGradient =
        (!workerBlockedDay && !hourReturn)
            ? getDayColorGradient(
                profile.name,
                key,
                realTurn,
                date,
                holidays,
                leaveMaps.admin?.[key],
                baseTurn
            )
            : null;
    const background = workerBlockedDay
        ? timelineBlockedDayBackground(isInhabil)
        : hourReturn
        ? "linear-gradient(135deg, #0f766e, #14b8a6)"
        : dayGradient
        ? dayGradient
        : timelineCellBackground(color, isInhabil);
    const contractError = rowAux?.contractErrorByKey?.has(key)
        ? rowAux.contractErrorByKey.get(key)
        : contractErrorMarker(profile.name, key);
    const honorariaExcess =
        getHonorariaExcessForKey(
            honorariaSummary,
            key
        );
    const needsReplacement = rowAux?.needsReplacementByKey?.has(key)
        ? rowAux.needsReplacementByKey.get(key)
        : needsReplacementMarker(profile.name, key);
    const pendingManualExtra = rowAux?.pendingManualExtraByKey?.has(key)
        ? rowAux.pendingManualExtraByKey.get(key)
        : pendingManualExtraMarker(profile.name, key);
    const clockMark = rowAux?.clockMarks
        ? rowAux.clockMarks[key] || null
        : null;
    const severeClockIncident = clockMark
        ? timelineClockMarkHasSevereIncident(clockMark)
        : hasSevereClockIncident(profile.name, key);
    const simpleClockIncident =
        !severeClockIncident &&
        (
            clockMark
                ? timelineClockMarkHasSimpleIncident(clockMark)
                : hasSimpleClockIncident(profile.name, key)
        );
    const clockIncidentDetail =
        severeClockIncident || simpleClockIncident
            ? getClockIncidentDetail(
                profile.name,
                key,
                date,
                realTurn,
                holidays
            )
            : "";
    const clockExtra = rowAux?.clockMarks
        ? (
            clockMark &&
            hasClockExtra(
                profile.name,
                key,
                date,
                realTurn,
                holidays
            )
        )
        : hasClockExtra(
            profile.name,
            key,
            date,
            realTurn,
            holidays
        );
    const hasClockExtraBackup = rowAux?.clockExtraBackupByIso?.has(iso)
        ? Boolean(rowAux.clockExtraBackupByIso.get(iso))
        : Boolean(getClockExtraBackupForWorker(profile.name, key));
    const showClockExtra =
        clockExtra &&
        !hasClockExtraBackup;
    const showExtraReason =
        !contractError &&
        !needsReplacement &&
        pendingManualExtra;
    const showHonorariaLimit =
        Boolean(honorariaExcess) &&
        !contractError &&
        !severeClockIncident &&
        !needsReplacement;
    const marker = contractError
        ? "X"
        : severeClockIncident
            ? "!!!"
            : needsReplacement
                ? "!"
                : showHonorariaLimit
                    ? "!"
                : showExtraReason || showClockExtra
                    ? "?"
                    : simpleClockIncident
                    ? "*"
                    : (hourReturn
                        ? hourReturnTimelineMarker(hourReturn)
                        : replacement
                        ? (replacement.isLoan ? "P" : "R")
                        : "");
    const title = contractError
        ? "No tiene contrato vigente en la fecha seleccionada"
        : severeClockIncident
            ? (
                clockIncidentDetail ||
                "Incidencia grave de marcaje"
            )
            : needsReplacement
                ? "Requiere reemplazo de turno base"
                : showHonorariaLimit
                    ? getHonorariaLimitMessage(honorariaSummary)
                : showExtraReason
                ? "Requiere motivo de horas extras"
                : showClockExtra
                    ? "Requiere motivo por horas extras de marcaje"
                    : simpleClockIncident
                        ? (
                            clockIncidentDetail ||
                            "Incidencia de marcaje"
                        )
                : hourReturn
                    ? `${hourReturn.fullTurn ? "Devolución" : "Dev. Parcial"}: ${hourReturn.hours || 0} hrs.`
                : replacement
                    ? (
                        replacement.replaced
                            ? `${replacement.isLoan ? "Prestamo cubriendo a" : "Reemplazo de"} ${replacement.replaced} por ${replacement.absenceType || "ausencia"}`
                            : `Motivo HHEE: ${replacement.reason || replacement.absenceType || "sin detalle"}`
                    )
                    : "";
    const leaveTitle = leaveApplicationHoverTitle(
        profile.name,
        key,
        leaveMaps
    );
    const titleText = [
        title,
        leaveTitle,
        workerBlockedDay
            ? workerBlockedDay.message ||
                "El trabajador solicito no hacer reemplazos ni cambios de turno en esta fecha."
            : ""
    ].filter(Boolean).join("\n");

    return `
        <td
            data-timeline-profile="${escapeHtml(profile.name)}"
            data-timeline-key="${escapeHtml(key)}"
            class="mini ${workerBlockedDay ? "worker-blocked-mini" : ""} ${isInhabil ? "timeline-inhabil" : ""} ${contractError ? "contract-error-day" : ""} ${honorariaExcess ? "honoraria-limit-day" : ""} ${severeClockIncident ? "clock-severe-day" : ""} ${simpleClockIncident ? "clock-incident-day" : ""} ${needsReplacement ? "needs-replacement" : ""} ${showExtraReason || showClockExtra ? "needs-extra-reason" : ""} ${hourReturn ? "hours-return-mini" : ""} ${replacement ? "replacement-day" : ""}"
            style="background:${escapeHtml(background)}"
            title="${escapeHtml(titleText)}"
            ${contractError ? `data-contract-error-profile="${escapeHtml(profile.name)}" data-contract-error-key="${escapeHtml(key)}"` : ""}
            ${showHonorariaLimit ? `data-honoraria-limit-profile="${escapeHtml(profile.name)}" data-honoraria-limit-key="${escapeHtml(key)}" data-honoraria-limit-message="${escapeHtml(getHonorariaLimitMessage(honorariaSummary))}"` : ""}
            ${needsReplacement ? `data-replacement-profile="${escapeHtml(profile.name)}" data-replacement-key="${escapeHtml(key)}"` : ""}
            ${replacement ? `data-worker-replacement-profile="${escapeHtml(profile.name)}" data-worker-replacement-key="${escapeHtml(key)}" data-worker-replacement-id="${escapeHtml(replacement.id || "")}"` : ""}
            ${showExtraReason ? `data-extra-profile="${escapeHtml(profile.name)}" data-extra-key="${escapeHtml(key)}" data-extra-turn="${escapeHtml(showExtraReason)}"` : ""}
            ${showClockExtra && !showExtraReason ? `data-clock-extra-profile="${escapeHtml(profile.name)}" data-clock-extra-key="${escapeHtml(key)}" data-clock-extra-turn="${escapeHtml(realTurn)}"` : ""}
        >
            ${marker ? `<span class="timeline-replacement-marker">${marker}</span>` : ""}
        </td>
    `;
}

function timelineRowInnerHTML(rowData, {
    year,
    month,
    diasMes,
    holidays,
    renderCache = null
}) {
    const finishHTML = startPerformanceSpan(
        "timeline:row-html",
        {
            profile: rowData?.profile?.name || "",
            year,
            month,
            days: diasMes
        }
    );
    const {
        profile,
        stats,
        honorariaSummary
    } = rowData;
    const dayHhee = honorariaSummary
        ? honorariaSummary.overtimeDay
        : stats.hheeDiurnas;
    const nightHhee = honorariaSummary
        ? honorariaSummary.overtimeNight
        : stats.hheeNocturnas;
    const honorariaHheeClass =
        honorariaSummary?.overtimeHours > 0
            ? " honoraria-hhee-excess"
            : "";
    const effectiveRenderCache = rowData.renderCache || renderCache;
    const leaveMaps = getTimelineCachedLeaveMaps(
        profile.name,
        effectiveRenderCache
    );
    const rowAux = buildTimelineRowAuxiliaryContext(
        profile.name,
        year,
        month,
        diasMes,
        leaveMaps,
        rowData,
        effectiveRenderCache
    );
    let html = `
        <td class="namecol">
            <button
                class="timeline-profile-link"
                type="button"
                data-profile-name="${escapeHtml(profile.name)}"
                title="Abrir perfil de ${escapeHtml(profile.name)}"
            >
                ${escapeHtml(profile.name)}
            </button>
        </td>
        <td class="timeline-hhee timeline-hhee--day${dayExtraAlertClass(profile.name, dayHhee, new Date(year, month, 1))}${honorariaHheeClass}">
            ${formatTimelineHours(dayHhee)}
        </td>
        <td class="timeline-hhee timeline-hhee--night${honorariaHheeClass}">
            ${formatTimelineHours(nightHhee)}
        </td>
    `;

    for (let d = 1; d <= diasMes; d++) {
        html += renderTimelineDayCell(profile, d, {
            year,
            month,
            holidays,
            leaveMaps,
            honorariaSummary,
            rowAux
        });
    }

    finishHTML();
    return html;
}

function timelineRowHash(innerHTML) {
    return timelineCacheHash(innerHTML);
}

function timelineBlankDayCell(profile, d, {
    year,
    month,
    baseTurn = TURNO.LIBRE
}) {
    const key = `${year}-${month}-${d}`;
    const turn = Number(baseTurn) || TURNO.LIBRE;
    const background =
        getTurnoColor(turn, false) || TURNO_COLOR[turn] || TURNO_COLOR[0];

    return `
        <td
            data-timeline-profile="${escapeHtml(profile.name)}"
            data-timeline-key="${escapeHtml(key)}"
            class="mini timeline-cell-pending timeline-base-cell"
            style="background:${escapeHtml(background)}"
            title="${turn ? "Vista base de rotativa. Actualizando detalles..." : ""}"
        ></td>
    `;
}

function timelineRowSkeletonInnerHTML(profile, {
    year,
    month,
    diasMes,
    keys = null,
    renderCache = null,
    sortContext = null
}) {
    const monthKeyList = keys || renderCache?.keys ||
        monthKeys(year, month, diasMes);
    const baseSequence = timelineBaseSequence(
        profile.name,
        monthKeyList,
        sortContext?.baseCache || renderCache?.baseSequenceByProfile,
        renderCache
    );
    let html = `
        <td class="namecol">
            <button
                class="timeline-profile-link"
                type="button"
                data-profile-name="${escapeHtml(profile.name)}"
                title="Abrir perfil de ${escapeHtml(profile.name)}"
            >
                ${escapeHtml(profile.name)}
            </button>
        </td>
        <td class="timeline-hhee timeline-hhee--day"></td>
        <td class="timeline-hhee timeline-hhee--night"></td>
    `;

    for (let d = 1; d <= diasMes; d++) {
        html += timelineBlankDayCell(profile, d, {
            year,
            month,
            baseTurn: baseSequence[d - 1] || TURNO.LIBRE
        });
    }

    return html;
}

function timelineSkeletonRowElement(profile, context) {
    const workerId = timelineWorkerId(profile);
    const innerHTML = timelineRowSkeletonInnerHTML(profile, context);

    return timelineRowElement({
        workerId,
        profileName: profile.name,
        innerHTML,
        rowHash: `skeleton:${context.monthKey}:${workerId}`,
        cacheKey: ""
    });
}

function timelineRowElement({
    workerId,
    profileName,
    innerHTML,
    rowHash,
    cacheKey = ""
}) {
    const template = document.createElement("tbody");

    template.innerHTML = `
        <tr
            data-timeline-row="1"
            data-worker-id="${escapeHtml(workerId)}"
            data-profile-name="${escapeHtml(profileName)}"
            data-timeline-row-hash="${escapeHtml(rowHash)}"
            data-timeline-row-cache-key="${escapeHtml(cacheKey)}"
        >${innerHTML}</tr>
    `;

    return template.firstElementChild;
}

function createTimelineRow(rowData, renderContext) {
    const innerHTML = typeof rowData.innerHTML === "string"
        ? rowData.innerHTML
        : timelineRowInnerHTML(rowData, renderContext);
    const rowHash = rowData.rowHash || timelineRowHash(innerHTML);

    return timelineRowElement({
        workerId: rowData.workerId,
        profileName: rowData.profile.name,
        innerHTML,
        rowHash,
        cacheKey: rowData.cacheKey || ""
    });
}

function createTimelineRowFromCache(profile, cached) {
    return timelineRowElement({
        workerId: cached.workerId || timelineWorkerId(profile),
        profileName: cached.profileName || profile.name,
        innerHTML: cached.innerHTML,
        rowHash: cached.rowHash,
        cacheKey: cached.cacheKey || ""
    });
}

function updateTimelineRow(existingRow, rowData, renderContext) {
    const innerHTML = typeof rowData.innerHTML === "string"
        ? rowData.innerHTML
        : timelineRowInnerHTML(rowData, renderContext);
    const rowHash = rowData.rowHash || timelineRowHash(innerHTML);

    if (existingRow.dataset.timelineRowHash === rowHash) {
        return false;
    }

    existingRow.innerHTML = innerHTML;
    existingRow.dataset.timelineRowHash = rowHash;
    existingRow.dataset.workerId = rowData.workerId;
    existingRow.dataset.profileName = rowData.profile.name;
    existingRow.dataset.timelineRowCacheKey = rowData.cacheKey || "";
    return true;
}

function updateTimelineRowFromCache(existingRow, profile, cached) {
    if (existingRow.dataset.timelineRowHash === cached.rowHash) {
        return false;
    }

    existingRow.innerHTML = cached.innerHTML;
    existingRow.dataset.timelineRowHash = cached.rowHash;
    existingRow.dataset.workerId = cached.workerId || timelineWorkerId(profile);
    existingRow.dataset.profileName = cached.profileName || profile.name;
    existingRow.dataset.timelineRowCacheKey = cached.cacheKey || "";
    return true;
}

function timelineRowsTbody(container) {
    return container?.querySelector(".timeline-table tbody") || null;
}

function timelineExistingRow(container, workerId) {
    return container?.querySelector(
        `[data-timeline-row][data-worker-id="${cssAttr(workerId)}"]`
    );
}

function resetTimelineRowToSkeleton(row, profile, context) {
    if (!row || !profile) return false;

    const workerId = timelineWorkerId(profile);

    row.innerHTML = timelineRowSkeletonInnerHTML(profile, context);
    row.dataset.workerId = workerId;
    row.dataset.profileName = profile.name;
    row.dataset.timelineRowHash = `skeleton:${context.monthKey}:${workerId}`;
    row.dataset.timelineRowCacheKey = "";
    return true;
}

function ensureTimelineSkeletonRows(container, context, options = {}) {
    const tbody = timelineRowsTbody(container);

    if (!tbody) return 0;

    const reset = options.reset === true;
    const existingByWorkerId = new Map(
        Array.from(tbody.querySelectorAll("[data-timeline-row]"))
            .map(row => [row.dataset.workerId || "", row])
            .filter(([workerId]) => Boolean(workerId))
    );
    const fragment = document.createDocumentFragment();
    let changed = 0;

    context.orderedGroup.forEach(profile => {
        const workerId = timelineWorkerId(profile);
        const existing = existingByWorkerId.get(workerId);

        if (existing) {
            if (reset) {
                changed += resetTimelineRowToSkeleton(
                    existing,
                    profile,
                    context
                )
                    ? 1
                    : 0;
            }
            fragment.appendChild(existing);
            existingByWorkerId.delete(workerId);
            return;
        }

        fragment.appendChild(timelineSkeletonRowElement(profile, context));
        changed++;
    });

    existingByWorkerId.forEach(row => row.remove());
    tbody.appendChild(fragment);
    syncTimelineActiveProfile(container);
    return changed;
}

function reconcileTimelineRows(container, allowedWorkerIds) {
    const allowed = new Set(allowedWorkerIds);

    container
        ?.querySelectorAll("[data-timeline-row]")
        .forEach(row => {
            if (!allowed.has(row.dataset.workerId)) {
                row.remove();
            }
        });
}

function timelineTableHeadHTML(context) {
    const {
        groups,
        selectedKeys,
        baseGroup,
        diasMes
    } = context;
    let html = `
        <tr>
            <th class="timeline-name-head">
                ${timelineFilterHTML(groups, selectedKeys)}
            </th>
            <th class="timeline-hhee-head timeline-hhee--day" title="HHEE Diurnas">
                <span class="timeline-hhee-label" aria-label="HHEE Diurnas">
                    <span>HHEE</span>
                    <svg class="timeline-hhee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="4"></circle>
                        <path d="M12 2v2"></path>
                        <path d="M12 20v2"></path>
                        <path d="M4.93 4.93l1.41 1.41"></path>
                        <path d="M17.66 17.66l1.41 1.41"></path>
                        <path d="M2 12h2"></path>
                        <path d="M20 12h2"></path>
                        <path d="M6.34 17.66l-1.41 1.41"></path>
                        <path d="M17.66 6.34l1.41-1.41"></path>
                    </svg>
                </span>
            </th>
            <th class="timeline-hhee-head timeline-hhee--night" title="HHEE Nocturnas">
                <span class="timeline-hhee-label" aria-label="HHEE Nocturnas">
                    <span>HHEE</span>
                    <svg class="timeline-hhee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z"></path>
                    </svg>
                </span>
            </th>
    `;

    for (let d = 1; d <= diasMes; d++) {
        html += `<th>${d}</th>`;
    }

    return `${html}</tr>`;
}

function timelineShellHTML(context) {
    return `
        <div class="timeline-shell">
            <table class="timeline-table">
                <thead>${timelineTableHeadHTML(context)}</thead>
                <tbody></tbody>
            </table>
        </div>
        <div
            class="empty-state empty-state--compact timeline-progress"
            data-timeline-progress
            hidden
        ></div>
    `;
}

function bindTimelineControls(container) {
    const select = container.querySelector("[data-timeline-filter-select]");

    if (!select) return;

    select.onchange = () => {
        const key = select.value;

        if (!key) return;

        timelineFilterState.selectedKeys = new Set([key]);
        timelineFilterState.open = false;

        const groupProfiles = getProfiles()
            .filter(profile =>
                timelineGroupForProfile(profile).key === key
            );
        const year = calendar.currentDate.getFullYear();
        const month = calendar.currentDate.getMonth();
        const diasMes = new Date(year, month + 1, 0).getDate();
        const renderCache = createTimelineRenderCache(year, month, diasMes);
        const sortContext =
            timelineSortContext(year, month, diasMes, renderCache);
        const firstProfile = orderTimelineProfiles(
            groupProfiles,
            getCurrentProfile(),
            year,
            month,
            diasMes,
            sortContext
        )[0];

        if (
            firstProfile &&
            firstProfile.name !== getCurrentProfile() &&
            typeof window.selectProfileByName === "function"
        ) {
            window.selectProfileByName(firstProfile.name, {
                openTurns: true,
                scrollToTop: false
            });
            return;
        }

        renderTimeline();
    };
}

function ensureTimelineShell(div, context, targetMonthKey, options = {}) {
    const structureSignature = timelineStructureSignature(
        context,
        targetMonthKey
    );
    const hasShell = Boolean(timelineRowsTbody(div));

    if (
        !hasShell ||
        div.dataset.timelineStructureSignature !== structureSignature
    ) {
        div.innerHTML = timelineShellHTML(context);
        div.dataset.timelineStructureSignature = structureSignature;
    } else {
        const head = div.querySelector(".timeline-table thead");

        if (head) {
            head.innerHTML = timelineTableHeadHTML(context);
        }
    }

    if (!div.querySelector("[data-timeline-progress]")) {
        const progress = document.createElement("div");

        progress.className =
            "empty-state empty-state--compact timeline-progress";
        progress.dataset.timelineProgress = "1";
        progress.hidden = true;
        div.appendChild(progress);
    }

    div.dataset.timelineMonthKey = targetMonthKey;
    div.dataset.timelineViewSignature = context.viewSignature || "";
    div.dataset.timelineFastSignature =
        timelineFastSignature(context.year, context.month);
    div.dataset.timelineState = options.state || "ready";
    div.setAttribute("aria-busy", options.busy ? "true" : "false");
    bindTimelineControls(div);
    ensureTimelineCellDelegation(div);
    syncTimelineStickyOffsets(div);
    requestAnimationFrame(() => syncTimelineStickyOffsets(div));
    bindTimelineOutsideClickListener(div);
}

function timelineStructureSignature(context, targetMonthKey = context.monthKey) {
    return context.structureSignature || [
        context.diasMes,
        context.baseGroup.key,
        context.filtersSignature
    ].join("\u001f");
}

function updateTimelineProgress(container, message = "") {
    const progress = container?.querySelector("[data-timeline-progress]");

    if (!progress) return;

    if (!message) {
        progress.hidden = true;
        progress.textContent = "";
        return;
    }

    progress.hidden = false;
    progress.textContent = message;
}

function updateTimelineLoadMoreButton(container, visibleCount, totalCount) {
    let button = container?.querySelector("[data-timeline-load-more]");

    if (!container) return;

    button?.remove();
}

function activateTimelineHTML(div, html, targetMonthKey, options = {}) {
    div.innerHTML = html;
    div.dataset.timelineMonthKey = targetMonthKey;
    div.dataset.timelineState = options.state || "ready";
    div.setAttribute("aria-busy", options.busy ? "true" : "false");
    bindTimelineControls(div);
    ensureTimelineCellDelegation(div);
    syncTimelineStickyOffsets(div);
    requestAnimationFrame(() => syncTimelineStickyOffsets(div));
    syncTimelineActiveProfile(div);
    if (Number.isFinite(Number(options.revealRowIndex))) {
        revealTimelineRow(div, Number(options.revealRowIndex));
    }
    bindTimelineOutsideClickListener(div);
}

function buildTimelineContext(year, month) {
    const finishContext = startPerformanceSpan(
        "timeline:build-context",
        {
            year,
            month
        }
    );
    const profiles = getProfiles();
    const actual = getCurrentProfile();
    const perfilActual =
        profiles.find(x => x.name === actual);

    if (!perfilActual) {
        finishContext({
            empty: true,
            profileCount: profiles.length
        });
        return {
            empty: "Selecciona un colaborador para ver el reporte mensual."
        };
    }

    const groups = timelineFilterGroups(profiles);
    const { baseGroup, selectedKeys } =
        ensureTimelineFilter(perfilActual, groups);
    const grupo = profiles
        .filter(profile =>
            selectedKeys.has(timelineGroupForProfile(profile).key)
        );

    if (!grupo.length) {
        finishContext({
            empty: true,
            profileCount: profiles.length,
            groupCount: 0
        });
        return {
            empty: "No hay colaboradores compatibles para comparar este mes."
        };
    }

    const diasMes =
        new Date(year, month + 1, 0).getDate();
    const renderCache =
        createTimelineRenderCache(year, month, diasMes);
    const sortContext =
        timelineSortContext(year, month, diasMes, renderCache);
    const orderedGroup =
        orderTimelineProfiles(
            grupo,
            actual,
            year,
            month,
            diasMes,
            sortContext
        );
    const filtersSignature = timelineFiltersSignature(selectedKeys);
    const contractSignature =
        timelineMonthContractSignature(year, month);
    const structureSignature = [
        diasMes,
        baseGroup.key,
        filtersSignature,
        contractSignature,
        orderedGroup
            .map(profile =>
                timelineProfileStructuralSignature(
                    profile,
                    renderCache
                )
            )
            .join("\u001f")
    ].join("\u001e");
    const viewSignature = [
        year,
        month,
        structureSignature,
        filtersSignature,
        orderedGroup.map(profile => profile.name).join("\u001f")
    ].join("\u001e");

    finishContext({
        profileCount: profiles.length,
        groupCount: grupo.length,
        orderedCount: orderedGroup.length,
        actual
    });

    return {
        actual,
        year,
        month,
        groups,
        baseGroup,
        selectedKeys,
        filtersSignature,
        contractSignature,
        diasMes,
        renderCache,
        sortContext,
        orderedGroup,
        structureSignature,
        viewSignature,
        monthKey: timelineMonthKey(year, month),
        workspaceId: timelineWorkspaceId()
    };
}

function timelineRowCacheInfo(profile, context) {
    const workerId = timelineWorkerId(profile);
    const cacheKey = timelineRowCacheKey({
        workspaceId: context.workspaceId,
        monthKey: context.monthKey,
        workerId,
        filtersSignature: context.filtersSignature,
        dependencySignature: context.contractSignature
    });

    return {
        workerId,
        cacheKey
    };
}

function timelineMetricsCacheInfo(profile, context) {
    const workerId = timelineWorkerId(profile);
    const cacheKey = timelineMetricsCacheKey({
        workspaceId: context.workspaceId,
        monthKey: context.monthKey,
        workerId
    });

    return {
        workerId,
        cacheKey
    };
}

function timelineProfilesMissingMetrics(profiles, context) {
    return profiles.filter(profile => {
        const { workerId, cacheKey } =
            timelineMetricsCacheInfo(profile, context);

        return !readTimelineMetricsCache(cacheKey, {
            monthKey: context.monthKey,
            workerId
        });
    });
}

function buildFreshTimelineRow(profile, context, holidays, options = {}) {
    const sortContext = context.sortContext ||
        timelineSortContext(
            context.year,
            context.month,
            context.diasMes,
            context.renderCache || null
        );
    const cacheInfo = timelineRowCacheInfo(profile, context);
    const metricsCacheKey =
        timelineMetricsCacheInfo(profile, context).cacheKey;
    // Mide el costo TOTAL de construir la fila (incluye el cálculo de HHEE cuando
    // forceFreshMetrics). Instrumentación para localizar los bloques de ~11s que
    // no aparecían con los sub-spans row-aux-context/row-html.
    const rowData = measurePerformance(
        "timeline:build-fresh-row",
        () => buildTimelineRowData({
            profile,
            actual: context.actual,
            year: context.year,
            month: context.month,
            diasMes: context.diasMes,
            holidays,
            keys: sortContext.keys,
            sortContext,
            workerId: cacheInfo.workerId,
            monthKey: context.monthKey,
            metricsCacheKey,
            forceFreshMetrics: options.forceFreshMetrics === true,
            renderCache: context.renderCache || null
        }),
        {
            profile: profile?.name || "",
            forceFreshMetrics: options.forceFreshMetrics === true,
            year: context.year,
            month: context.month
        },
        { threshold: 400 }
    );

    rowData.workerId = cacheInfo.workerId;
    rowData.cacheKey = cacheInfo.cacheKey;
    rowData.metricsCacheKey = metricsCacheKey;
    return rowData;
}

function writeFreshTimelineRowCache(rowData, context, renderContext) {
    const innerHTML = timelineRowInnerHTML(rowData, renderContext);
    const rowHash = timelineRowHash(innerHTML);

    writeTimelineRowCache(rowData.cacheKey, {
        monthKey: context.monthKey,
        workerId: rowData.workerId,
        profileName: rowData.profile.name,
        filtersSignature: context.filtersSignature,
        rowHash,
        innerHTML,
        metricsStale: Boolean(rowData.metricsStale)
    });

    return {
        ...rowData,
        rowHash,
        innerHTML
    };
}

function insertOrUpdateTimelineRow(container, row, beforeNode = null) {
    const tbody = timelineRowsTbody(container);

    if (!tbody || !row) return false;

    const existing = timelineExistingRow(container, row.dataset.workerId);

    if (existing) {
        if (
            existing.dataset.timelineRowHash !==
            row.dataset.timelineRowHash
        ) {
            existing.innerHTML = row.innerHTML;
            existing.dataset.timelineRowHash =
                row.dataset.timelineRowHash;
            existing.dataset.profileName = row.dataset.profileName || "";
            existing.dataset.timelineRowCacheKey =
                row.dataset.timelineRowCacheKey || "";
        }
        return false;
    }

    tbody.insertBefore(row, beforeNode);
    return true;
}

async function refreshTimelineRowsInBackground({
    profiles,
    context,
    holidays,
    requestId
}) {
    if (!profiles.length) return;

    await waitTimelineIdle(240);

    const container = document.getElementById("teamTimeline");
    const renderContext = {
        year: context.year,
        month: context.month,
        diasMes: context.diasMes,
        holidays,
        renderCache: context.renderCache || null
    };

    for (const profile of profiles) {
        await pauseTimelineIfHidden(container);

        if (
            !timelineRenderIsCurrent(
                requestId,
                context.year,
                context.month
            )
        ) {
            return;
        }

        const existing = timelineExistingRow(
            container,
            timelineWorkerId(profile)
        );

        if (!existing) continue;

        const rowData = buildFreshTimelineRow(
            profile,
            context,
            holidays,
            {
                forceFreshMetrics: true
            }
        );
        const cachedRow = writeFreshTimelineRowCache(
            rowData,
            context,
            renderContext
        );

        updateTimelineRow(existing, cachedRow, renderContext);
        syncTimelineActiveProfile(container);
        await waitTimelineIdle(180);
    }
}

function scheduleTimelineMetricsRefresh(options = {}, delay = TIMELINE_METRICS_RETRY_MS) {
    const context = options.context || {};
    const key = [
        context.year,
        context.month,
        options.requestId || 0
    ].join(":");

    clearTimeout(timelineMetricsRefreshTimers.get(key));
    timelineMetricsRefreshRequests.set(key, options);
    timelineMetricsRefreshTimers.set(
        key,
        setTimeout(() => {
            timelineMetricsRefreshTimers.delete(key);
            const queuedOptions =
                timelineMetricsRefreshRequests.get(key) || options;

            timelineMetricsRefreshRequests.delete(key);
            void refreshTimelineMetricsInBackground(queuedOptions);
        }, Math.max(0, Number(delay) || TIMELINE_METRICS_RETRY_MS))
    );
}

async function refreshTimelineMetricsInBackground({
    profiles,
    context,
    holidays,
    requestId
}) {
    if (!profiles.length) return;

    const initialDelay = timelineInteractiveDelay();

    if (initialDelay > 0) {
        scheduleTimelineMetricsRefresh(
            {
                profiles,
                context,
                holidays,
                requestId
            },
            initialDelay
        );
        return;
    }

    await waitTimelineBackgroundIdle(900);

    const missingProfiles = timelineProfilesMissingMetrics(
        profiles,
        context
    );

    if (!missingProfiles.length) return;

    const container = document.getElementById("teamTimeline");
    const renderContext = {
        year: context.year,
        month: context.month,
        diasMes: context.diasMes,
        holidays,
        renderCache: context.renderCache || null
    };

    updateTimelineProgress(
        container,
        "Actualizando HHEE del timeline en segundo plano..."
    );

    try {
        for (let index = 0; index < missingProfiles.length; index++) {
            const deferredDelay = timelineInteractiveDelay();

            if (deferredDelay > 0) {
                updateTimelineProgress(container, "");
                scheduleTimelineMetricsRefresh(
                    {
                        profiles: missingProfiles.slice(index),
                        context,
                        holidays,
                        requestId
                    },
                    deferredDelay
                );
                return;
            }

            const profile = missingProfiles[index];

            if (
                !timelineRenderIsCurrent(
                    requestId,
                    context.year,
                    context.month
                )
            ) {
                return;
            }

            const existing = timelineExistingRow(
                container,
                timelineWorkerId(profile)
            );

            if (!existing) continue;

            await waitTimelineBackgroundIdle(1200);

            const rowData = buildFreshTimelineRow(
                profile,
                context,
                holidays,
                {
                    forceFreshMetrics: true
                }
            );
            const cachedRow = writeFreshTimelineRowCache(
                rowData,
                context,
                renderContext
            );

            updateTimelineRow(existing, cachedRow, renderContext);
            syncTimelineActiveProfile(container);
            await waitTimelineBackgroundIdle(1800);
        }
    } finally {
        if (
            timelineRenderIsCurrent(
                requestId,
                context.year,
                context.month
            )
        ) {
            updateTimelineProgress(container, "");
            syncTimelineStickyOffsets(container);
        }
    }
}

async function buildTimelineBatchRows({
    profiles,
    context,
    holidays,
    requestId,
    skipCache = false
}) {
    const renderContext = {
        year: context.year,
        month: context.month,
        diasMes: context.diasMes,
        holidays,
        renderCache: context.renderCache || null
    };
    const rows = [];
    const cachedProfiles = [];
    const finishBatch = startPerformanceSpan(
        "timeline:build-batch",
        {
            profileCount: profiles.length,
            year: context.year,
            month: context.month,
            skipCache
        },
        {
            type: "async-span",
            threshold: 80
        }
    );

    for (const profile of profiles) {
        await pauseTimelineIfHidden(document.getElementById("teamTimeline"));

        if (
            !timelineRenderIsCurrent(
                requestId,
                context.year,
                context.month
            )
        ) {
            finishBatch({
                cancelled: true,
                rowCount: rows.length,
                cachedCount: cachedProfiles.length
            });
            return null;
        }

        const { workerId, cacheKey } =
            timelineRowCacheInfo(profile, context);
        const cached = skipCache
            ? null
            : readTimelineRowCache(cacheKey, {
                monthKey: context.monthKey,
                workerId,
                filtersSignature: context.filtersSignature
            });

        if (cached) {
            rows.push(createTimelineRowFromCache(profile, {
                ...cached,
                cacheKey
            }));
            cachedProfiles.push(profile);
            continue;
        }

        const rowData = buildFreshTimelineRow(
            profile,
            context,
            holidays,
            {
                forceFreshMetrics: true
            }
        );
        const cachedRow = writeFreshTimelineRowCache(
            rowData,
            context,
            renderContext
        );

        rows.push(createTimelineRow(cachedRow, renderContext));
        await waitTimelineIdle(120);
    }

    if (cachedProfiles.length) {
        void refreshTimelineRowsInBackground({
            profiles: cachedProfiles,
            context,
            holidays,
            requestId
        });
    }

    finishBatch({
        rowCount: rows.length,
        cachedCount: cachedProfiles.length
    });
    return rows;
}

function appendTimelineRowElements(container, rows) {
    return measurePerformance(
        "timeline:append-rows-dom",
        () => {
            const tbody = timelineRowsTbody(container);

            if (!tbody || !rows.length) return 0;

            const fragment = document.createDocumentFragment();
            let appended = 0;

            rows.forEach(row => {
                const existing = timelineExistingRow(
                    container,
                    row.dataset.workerId
                );

                if (existing) {
                    updateTimelineRowFromCache(existing, {
                        name: row.dataset.profileName
                    }, {
                        workerId: row.dataset.workerId,
                        profileName: row.dataset.profileName,
                        innerHTML: row.innerHTML,
                        rowHash: row.dataset.timelineRowHash,
                        cacheKey: row.dataset.timelineRowCacheKey
                    });
                    return;
                }

                fragment.appendChild(row);
                appended++;
            });

            tbody.appendChild(fragment);
            syncTimelineActiveProfile(container);
            return appended;
        },
        {
            rowCount: rows?.length || 0,
            existingRows:
                container?.querySelectorAll?.("[data-timeline-row]")?.length || 0
        }
    );
}

async function appendTimelineRows(options = {}) {
    const container = document.getElementById("teamTimeline");

    if (!container || container.dataset.timelineAppending === "1") {
        return;
    }

    const year = calendar.currentDate.getFullYear();
    const month = calendar.currentDate.getMonth();
    const requestId = Number.isFinite(Number(options.requestId))
        ? Number(options.requestId)
        : timelineRenderRequest;
    const context = buildTimelineContext(year, month);

    if (context.empty) return;

    const total = context.orderedGroup.length;
    const startIndex = Math.max(0, Number(options.startIndex) || 0);
    const targetLimit = Math.min(timelineRowLimit, total);
    const holidays = timelineViewState?.year === year &&
        timelineViewState?.month === month
        ? timelineViewState.holidays
        : await fetchHolidays(year);

    container.dataset.timelineAppending = "1";
    updateTimelineProgress(container, "Cargando m\u00e1s trabajadores...");

    let completed = false;

    try {
        for (
            let index = startIndex;
            index < targetLimit;
            index += TIMELINE_INCREMENTAL_BATCH_SIZE
        ) {
            await pauseTimelineIfHidden(container);

            if (!timelineRenderIsCurrent(requestId, year, month)) return;

            const batchProfiles = context.orderedGroup.slice(
                index,
                Math.min(
                    index + TIMELINE_INCREMENTAL_BATCH_SIZE,
                    targetLimit
                )
            );
            const rows = await buildTimelineBatchRows({
                profiles: batchProfiles,
                context,
                holidays,
                requestId
            });

            if (!rows) return;

            appendTimelineRowElements(container, rows);
            updateTimelineLoadMoreButton(
                container,
                Math.min(
                    index + TIMELINE_INCREMENTAL_BATCH_SIZE,
                    targetLimit
                ),
                total
            );
            syncTimelineStickyOffsets(container);

            if (
                Number.isFinite(Number(options.revealRowIndex)) &&
                index === startIndex
            ) {
                revealTimelineRow(
                    container,
                    Number(options.revealRowIndex)
                );
            }

            await waitTimelineIdle(180);
        }
        completed = true;
    } finally {
        delete container.dataset.timelineAppending;
        updateTimelineProgress(container, "");
        updateTimelineLoadMoreButton(container, targetLimit, total);
        syncTimelineStickyOffsets(container);
    }

    if (completed) {
        const appendedProfiles = context.orderedGroup.slice(
            startIndex,
            targetLimit
        );
        const profilesMissingMetrics =
            timelineProfilesMissingMetrics(appendedProfiles, context);

        if (profilesMissingMetrics.length) {
            void refreshTimelineMetricsInBackground({
                profiles: profilesMissingMetrics,
                context,
                holidays,
                requestId
            });
        }
    }
}

async function refreshVisibleTimelineRows(profileNames = new Set(), options = {}) {
    if (!profileNames.size || !timelineViewState) return false;

    const container = document.getElementById("teamTimeline");

    if (!container || !timelineIsVisibleView()) return false;

    const { year, month, holidays } = timelineViewState;
    const context = buildTimelineContext(year, month);

    if (context.empty) return false;

    const visibleProfiles = context.orderedGroup
        .slice(0, timelineRowLimit)
        .filter(profile => profileNames.has(profile.name));

    if (!visibleProfiles.length) return false;

    const requestId = timelineRenderRequest;
    const renderContext = {
        year,
        month,
        diasMes: context.diasMes,
        holidays,
        renderCache: context.renderCache || null
    };

    for (const profile of visibleProfiles) {
        await pauseTimelineIfHidden(container);

        if (!timelineRenderIsCurrent(requestId, year, month)) {
            return false;
        }

        const existing = timelineExistingRow(
            container,
            timelineWorkerId(profile)
        );

        if (!existing) continue;

        const rowData = buildFreshTimelineRow(
            profile,
            context,
            holidays,
            {
                forceFreshMetrics: options.forceFreshMetrics === true
            }
        );
        const cachedRow = writeFreshTimelineRowCache(
            rowData,
            context,
            renderContext
        );

        updateTimelineRow(existing, cachedRow, renderContext);
        syncTimelineActiveProfile(container);
        await waitTimelineIdle(120);
    }

    syncTimelineStickyOffsets(container);
    const profilesMissingMetrics =
        timelineProfilesMissingMetrics(visibleProfiles, context);

    if (profilesMissingMetrics.length) {
        void refreshTimelineMetricsInBackground({
            profiles: profilesMissingMetrics,
            context,
            holidays,
            requestId
        });
    }

    return true;
}

// Observa la última fila renderizada; cuando entra al viewport, carga la
// siguiente página (TIMELINE_PAGE_SIZE) llamando a appendTimelineRows y se
// re-arma sobre la nueva última fila. Así solo se construyen las filas que el
// usuario realmente ve, en vez de las 100 de golpe.
function armTimelineLazyLoad(container) {
    timelineLazyObserver?.disconnect();
    timelineLazyObserver = null;

    if (
        !container ||
        typeof IntersectionObserver !== "function"
    ) {
        return;
    }

    const total = Number(container.dataset.timelineTotal) || 0;

    if (timelineRowLimit >= total) return;

    const rows = container.querySelectorAll("[data-timeline-row]");
    const lastRow = rows[rows.length - 1];

    if (!lastRow) return;

    timelineLazyObserver = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        if (container.dataset.timelineAppending) return;

        const currentTotal = Number(container.dataset.timelineTotal) || 0;

        if (timelineRowLimit >= currentTotal) {
            timelineLazyObserver?.disconnect();
            timelineLazyObserver = null;
            return;
        }

        const startIndex = timelineRowLimit;
        timelineRowLimit = Math.min(
            timelineRowLimit + TIMELINE_PAGE_SIZE,
            currentTotal
        );

        void appendTimelineRows({ startIndex }).then(() =>
            armTimelineLazyLoad(container)
        );
    }, { rootMargin: "800px 0px" });

    timelineLazyObserver.observe(lastRow);
}

async function renderTimelineRowsIncrementally({
    container,
    context,
    holidays,
    requestId,
    visibleGroup,
    targetMonthKey,
    cacheKey,
    options = {},
    year,
    month
}) {
    await waitTimelineIdle(350);

    for (let index = 0; index < visibleGroup.length;) {
        await pauseTimelineIfHidden(container);

        if (
            !timelineRenderIsCurrent(requestId, year, month) ||
            !["turnos", "timeline"].includes(document.body.dataset.activeView)
        ) {
            return;
        }

        const batchSize = TIMELINE_VISIBLE_BATCH_SIZE;
        const batchProfiles = visibleGroup.slice(
            index,
            Math.min(index + batchSize, visibleGroup.length)
        );
        const rows = await buildTimelineBatchRows({
            profiles: batchProfiles,
            context,
            holidays,
            requestId,
            skipCache: options.skipCache
        });

        if (!rows) return;

        appendTimelineRowElements(container, rows);
        updateTimelineLoadMoreButton(
            container,
            Math.min(index + batchSize, visibleGroup.length),
            context.orderedGroup.length
        );
        syncTimelineStickyOffsets(container);
        const indexedRowCount =
            container.querySelectorAll("[data-timeline-row]").length;

        if (
            indexedRowCount === 1 ||
            indexedRowCount % TIMELINE_MONTH_INDEX_WRITE_EVERY === 0
        ) {
            writeTimelineMonthIndexFromDOM(container, context, {
                fastSignature: timelineFastSignature(year, month),
                complete: indexedRowCount >= context.orderedGroup.length
            });
        }
        await waitTimelineIdle(260);
        index += batchSize;
    }

    if (!timelineRenderIsCurrent(requestId, year, month)) {
        return;
    }

    updateTimelineProgress(container, "");
    container.dataset.timelineViewSignature = context.viewSignature;
    container.dataset.timelineFastSignature =
        timelineFastSignature(year, month);
    container.dataset.timelineState = "ready";
    container.setAttribute("aria-busy", "false");
    updateTimelineLoadMoreButton(
        container,
        visibleGroup.length,
        context.orderedGroup.length
    );

    // Carga el resto de las filas a medida que el usuario baja (viewport).
    armTimelineLazyLoad(container);

    syncTimelineActiveProfile(container, "");
    const neutralTimelineHTML = container.innerHTML;
    const fastSignature = timelineFastSignature(year, month);
    const timelineComplete =
        timelineRowLimit >= context.orderedGroup.length;

    writeTimelineCache(cacheKey, {
        viewSignature: context.viewSignature,
        rowLimit: timelineRowLimit,
        monthKey: targetMonthKey,
        html: neutralTimelineHTML
    });
    writeTimelineMonthIndexFromDOM(container, context, {
        fastSignature,
        complete: timelineComplete
    });
    const fastViewSignature =
        timelineFastCacheViewSignature(fastSignature);
    const fastCacheKey = timelineFastCacheKey(fastSignature);

    if (fastCacheKey && fastViewSignature) {
        writeTimelineCache(fastCacheKey, {
            viewSignature: fastViewSignature,
            rowLimit: -1,
            monthKey: targetMonthKey,
            html: neutralTimelineHTML
        });
    }
    syncTimelineActiveProfile(container);

    const profilesMissingMetrics =
        timelineProfilesMissingMetrics(visibleGroup, context);

    if (profilesMissingMetrics.length) {
        void refreshTimelineMetricsInBackground({
            profiles: profilesMissingMetrics,
            context,
            holidays,
            requestId
        });
    }

    if (Number.isFinite(Number(options.revealRowIndex))) {
        revealTimelineRow(container, Number(options.revealRowIndex));
    }
}

async function hydrateTimelineCachedView({
    container,
    requestId,
    year,
    month,
    targetMonthKey,
    options = {}
}) {
    await waitTimelineIdle(900);

    if (
        !container ||
        !timelineRenderIsCurrent(requestId, year, month) ||
        !["turnos", "timeline"].includes(document.body.dataset.activeView)
    ) {
        return;
    }

    const context = buildTimelineContext(year, month);

    if (context.empty) return;

    const timelineViewChanged =
        timelinePageSignature !== context.viewSignature;
    timelinePageSignature = context.viewSignature;
    timelineRowLimit = timelineViewChanged
        ? Math.min(TIMELINE_PAGE_SIZE, context.orderedGroup.length)
        : Math.min(
            Math.max(timelineRowLimit, TIMELINE_PAGE_SIZE),
            context.orderedGroup.length
        );

    const holidays = await fetchHolidays(year);

    if (!timelineRenderIsCurrent(requestId, year, month)) {
        return;
    }

    timelineViewState = {
        year,
        month,
        diasMes: context.diasMes,
        holidays,
        renderCache: context.renderCache || null
    };

    ensureTimelineShell(container, context, targetMonthKey, {
        state: "cached",
        busy: false
    });

    // Solo la primera página; el resto se carga por scroll (armTimelineLazyLoad).
    container.dataset.timelineTotal = String(context.orderedGroup.length);
    const visiblePage = context.orderedGroup.slice(0, timelineRowLimit);
    const visibleWorkerIds = visiblePage.map(timelineWorkerId);

    reconcileTimelineRows(container, visibleWorkerIds);

    const existingWorkerIds = new Set(
        Array.from(container.querySelectorAll("[data-timeline-row]"))
            .map(row => row.dataset.workerId || "")
            .filter(Boolean)
    );
    const missingProfiles = visiblePage.filter(profile =>
        !existingWorkerIds.has(timelineWorkerId(profile))
    );

    if (missingProfiles.length) {
        updateTimelineProgress(
            container,
            "Completando timeline desde cach\u00e9..."
        );

        await renderTimelineRowsIncrementally({
            container,
            context,
            holidays,
            requestId,
            visibleGroup: missingProfiles,
            targetMonthKey,
            cacheKey: timelineCacheKey(
                context.viewSignature,
                timelineRowLimit
            ),
            options: {
                ...options,
                skipCache: false
            },
            year,
            month
        });
        return;
    }

    updateTimelineProgress(container, "");
    container.dataset.timelineViewSignature = context.viewSignature;
    container.dataset.timelineFastSignature =
        timelineFastSignature(year, month);
    container.dataset.timelineState = "ready";
    container.setAttribute("aria-busy", "false");
    syncTimelineActiveProfile(container);
    syncTimelineStickyOffsets(container);
    armTimelineLazyLoad(container);
    writeTimelineMonthIndexFromDOM(container, context, {
        fastSignature: timelineFastSignature(year, month),
        complete: timelineRowLimit >= context.orderedGroup.length
    });

    const profilesMissingMetrics =
        timelineProfilesMissingMetrics(visiblePage, context);

    if (profilesMissingMetrics.length) {
        void refreshTimelineMetricsInBackground({
            profiles: profilesMissingMetrics,
            context,
            holidays,
            requestId
        });
    }
}

function renderTimelineEmpty(div, message, targetMonthKey) {
    stopTimelineOutsideClickListener();
    div.innerHTML = `
        <div class="empty-state empty-state--compact">
            ${escapeHtml(message)}
        </div>
    `;
    div.dataset.timelineMonthKey = targetMonthKey;
    div.dataset.timelineState = "empty";
    div.setAttribute("aria-busy", "false");
}

async function renderTimelineImpl(options = {}){
    const div = document.getElementById("teamTimeline");
    const requestId = ++timelineRenderRequest;

    if (!div) return;

    const year = calendar.currentDate.getFullYear();
    const month = calendar.currentDate.getMonth();
    const targetMonthKey = timelineMonthKey(year, month);
    const previousMonthKey = div.dataset.timelineMonthKey || "";
    const monthChanged =
        Boolean(previousMonthKey) && previousMonthKey !== targetMonthKey;

    if (TIMELINE_DISABLED_FOR_SPEED_TEST) {
        renderTimelineDisabledState(div, year, month);
        return;
    }

    if (
        div.dataset.timelineMonthKey &&
        div.dataset.timelineMonthKey !== targetMonthKey
    ) {
        showTimelinePendingMonth(year, month);
    }

    syncTimelineFilterToCurrentProfile();
    const fastSignature = timelineFastSignature(year, month);

    if (
        !options.skipCache &&
        !options.forceRefresh &&
        fastSignature &&
        div.dataset.timelineFastSignature === fastSignature &&
        div.dataset.timelineMonthKey === targetMonthKey &&
            div.dataset.timelineState === "ready"
    ) {
        div.setAttribute("aria-busy", "false");
        syncTimelineActiveProfile(div);
        return;
    }

    const fastCacheViewSignature =
        timelineFastCacheViewSignature(fastSignature);
    const fastCacheKey = timelineFastCacheKey(fastSignature);
    const fastCached =
        !options.skipCache &&
        !options.forceRefresh &&
        false &&
        fastCacheKey
            ? readTimelineCache(fastCacheKey, {
                viewSignature: fastCacheViewSignature,
                rowLimit: -1,
                monthKey: targetMonthKey
            })
            : null;

    if (fastCached) {
        activateTimelineHTML(div, fastCached.html, targetMonthKey, {
            ...options,
            state: "cached",
            busy: false
        });
        div.dataset.timelineFastSignature = fastSignature;
        div.dataset.timelineState = "ready";
        div.setAttribute("aria-busy", "false");
        updateTimelineProgress(div, "");
        syncTimelineActiveProfile(div);
        return;
    }

    const monthIndexCacheKey = timelineMonthIndexCacheKey({
        monthKey: targetMonthKey,
        fastSignature
    });
    const monthIndexCached =
        !options.skipCache &&
        !options.forceRefresh &&
        monthIndexCacheKey
            ? readTimelineMonthIndex(monthIndexCacheKey, {
                monthKey: targetMonthKey,
                fastSignature
            })
            : null;
    const monthIndexHTML = monthIndexCached
        ? timelineHTMLFromMonthIndex(monthIndexCached)
        : "";

    if (monthIndexHTML) {
        activateTimelineHTML(div, monthIndexHTML, targetMonthKey, {
            ...options,
            state: "cached",
            busy: false
        });
        div.dataset.timelineStructureSignature =
            monthIndexCached.structureSignature || "";
        div.dataset.timelineViewSignature =
            monthIndexCached.viewSignature || "";
        div.dataset.timelineFastSignature = fastSignature;
        div.dataset.timelineState =
            monthIndexCached.complete ? "ready" : "cached";
        div.setAttribute("aria-busy", "false");
        updateTimelineProgress(
            div,
            monthIndexCached.complete
                ? ""
                : "Completando timeline en segundo plano..."
        );
        syncTimelineActiveProfile(div);
        void hydrateTimelineCachedView({
            container: div,
            requestId,
            year,
            month,
            targetMonthKey,
            options
        });
        return;
    }

    const context = buildTimelineContext(year, month);

    if (context.empty) {
        renderTimelineEmpty(div, context.empty, targetMonthKey);
        return;
    }

    if (
        !options.skipCache &&
        !options.forceRefresh &&
        div.dataset.timelineViewSignature === context.viewSignature &&
        div.dataset.timelineMonthKey === targetMonthKey &&
        div.dataset.timelineState === "ready" &&
        div.querySelectorAll("[data-timeline-row]").length >=
            context.orderedGroup.length
    ) {
        div.setAttribute("aria-busy", "false");
        syncTimelineActiveProfile(div);
        if (
            timelineViewState?.year === year &&
            timelineViewState?.month === month &&
            timelineViewState?.holidays
        ) {
            const profilesMissingMetrics =
                timelineProfilesMissingMetrics(
                    context.orderedGroup,
                    context
                );

            if (profilesMissingMetrics.length) {
                void refreshTimelineMetricsInBackground({
                    profiles: profilesMissingMetrics,
                    context,
                    holidays: timelineViewState.holidays,
                    requestId
                });
            }
        }
        return;
    }

    // Solo reseteamos a la primera página cuando cambia la vista (mes, unidad,
    // filtros). En un re-render por cambio de datos conservamos cuántas filas
    // había cargadas el usuario para no colapsar el scroll.
    const timelineViewChanged =
        timelinePageSignature !== context.viewSignature;
    timelinePageSignature = context.viewSignature;
    timelineRowLimit = timelineViewChanged
        ? Math.min(TIMELINE_PAGE_SIZE, context.orderedGroup.length)
        : Math.min(
            Math.max(timelineRowLimit, TIMELINE_PAGE_SIZE),
            context.orderedGroup.length
        );

    const cacheKey = timelineCacheKey(
        context.viewSignature,
        timelineRowLimit
    );
    const cached = options.skipCache
        ? null
        : readTimelineCache(cacheKey, {
            viewSignature: context.viewSignature,
            rowLimit: timelineRowLimit,
            monthKey: targetMonthKey
        });

    if (cached) {
        activateTimelineHTML(div, cached.html, targetMonthKey, {
            ...options,
            state: "cached",
            busy: true
        });
        div.dataset.timelineStructureSignature =
            timelineStructureSignature(context, targetMonthKey);
        div.dataset.timelineViewSignature = context.viewSignature;
        div.dataset.timelineFastSignature =
            timelineFastSignature(year, month);
    }

    const holidays = await fetchHolidays(year);
    // Solo la primera página se renderiza de entrada; el resto se carga al hacer
    // scroll (ver armTimelineLazyLoad). Antes se renderizaban las 100 filas de
    // golpe (~300ms c/u => 30-40s de congelamiento al abrir).
    div.dataset.timelineTotal = String(context.orderedGroup.length);
    const visibleGroup = context.orderedGroup.slice(0, timelineRowLimit);
    const visibleWorkerIds = visibleGroup.map(timelineWorkerId);

    timelineViewState = {
        year,
        month,
        diasMes: context.diasMes,
        holidays,
        renderCache: context.renderCache || null
    };

    if (
        requestId !== timelineRenderRequest ||
        !["turnos", "timeline"].includes(
            document.body.dataset.activeView
        )
    ) {
        return;
    }

    if (cached) {
        updateTimelineProgress(div, "");
        updateTimelineLoadMoreButton(
            div,
            visibleGroup.length,
            context.orderedGroup.length
        );
        div.dataset.timelineViewSignature = context.viewSignature;
        div.dataset.timelineFastSignature =
            timelineFastSignature(year, month);
        div.dataset.timelineState = "ready";
        div.setAttribute("aria-busy", "false");
        syncTimelineActiveProfile(div);
        syncTimelineStickyOffsets(div);
        requestAnimationFrame(() => syncTimelineStickyOffsets(div));

        // Tambien en cache-hit se arma la carga por scroll (el HTML cacheado solo
        // trae la primera pagina).
        armTimelineLazyLoad(div);

        const rowRefreshDelay = timelineInteractiveDelay();
        const refreshRows = () => refreshTimelineRowsInBackground({
            profiles: visibleGroup,
            context,
            holidays,
            requestId
        });

        if (rowRefreshDelay > 0) {
            setTimeout(() => {
                if (timelineRenderIsCurrent(requestId, year, month)) {
                    void refreshRows();
                }
            }, rowRefreshDelay);
        } else {
            void refreshRows();
        }

        const profilesMissingMetrics =
            timelineProfilesMissingMetrics(visibleGroup, context);

        if (profilesMissingMetrics.length) {
            void refreshTimelineMetricsInBackground({
                profiles: profilesMissingMetrics,
                context,
                holidays,
                requestId
            });
        }

        if (Number.isFinite(Number(options.revealRowIndex))) {
            revealTimelineRow(div, Number(options.revealRowIndex));
        }

        return;
    }

    ensureTimelineShell(div, context, targetMonthKey, {
        state: cached ? "cached" : "ready",
        busy: true
    });
    ensureTimelineSkeletonRows(div, context, {
        reset: monthChanged
    });
    reconcileTimelineRows(div, visibleWorkerIds);
    updateTimelineLoadMoreButton(
        div,
        Math.min(
            div.querySelectorAll("[data-timeline-row]").length,
            visibleGroup.length
        ),
        context.orderedGroup.length
    );
    updateTimelineProgress(
        div,
        cached
            ? "Actualizando timeline..."
            : "Cargando trabajadores..."
    );

    div.dataset.timelineState = "loading";
    div.setAttribute("aria-busy", "false");
    void renderTimelineRowsIncrementally({
        container: div,
        context,
        holidays,
        requestId,
        visibleGroup,
        targetMonthKey,
        cacheKey,
        options,
        year,
        month
    });
}

export async function renderTimeline(options = {}) {
    return measurePerformance(
        "timeline:render",
        () => renderTimelineImpl(options),
        {
            year: calendar.currentDate.getFullYear(),
            month: calendar.currentDate.getMonth(),
            skipCache: options.skipCache === true,
            revealRowIndex: options.revealRowIndex ?? ""
        },
        {
            asyncThreshold: 120
        }
    );
}

if (typeof window !== "undefined") {
    [
        "pointerdown",
        "keydown",
        "wheel",
        "touchstart",
        "input"
    ].forEach(eventName => {
        window.addEventListener(
            eventName,
            markTimelineUserActivity,
            { capture: true, passive: true }
        );
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            const queued = Array.from(
                timelineMetricsRefreshRequests.entries()
            );

            queued.forEach(([key, options]) => {
                clearTimeout(timelineMetricsRefreshTimers.get(key));
                timelineMetricsRefreshTimers.delete(key);
                timelineMetricsRefreshRequests.delete(key);
                void refreshTimelineMetricsInBackground(options);
            });
            return;
        }

        if (document.visibilityState !== "visible") return;

        const resolvers = Array.from(timelineVisibilityResolvers);

        timelineVisibilityResolvers.clear();
        resolvers.forEach(resolve => resolve());
    });
    window.addEventListener("proturnos:persistenceChanged", event => {
        const keys = event.detail?.keys || [];

        if (
            keys.length &&
            keys.every(key =>
                String(key || "").startsWith("proturnos_ui_cache_")
            )
        ) {
            return;
        }

        const affectedProfiles = timelineAffectedProfilesFromKeys(
            keys,
            event.detail?.changes || {}
        );

        clearLegacyTimelineCache();

        if (affectedProfiles.size) {
            clearTimelineRowCacheForProfiles(affectedProfiles);
            void refreshVisibleTimelineRows(affectedProfiles);
            return;
        }

        clearTimelineCache();
    });
    window.addEventListener("proturnos:calendarDirectEditCommitted", event => {
        const affectedProfiles = new Set(
            (event.detail?.batches || [])
                .map(batch => String(batch?.profileName || "").trim())
                .filter(Boolean)
        );

        if (!affectedProfiles.size) return;

        clearTimelineRowCacheForProfiles(affectedProfiles);
        void refreshVisibleTimelineRows(affectedProfiles, {
            forceFreshMetrics: true
        });
    });
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type === "app-state-applied") {
            clearTimelineCache();
            if (timelineIsVisibleView()) {
                void renderTimeline({ skipCache: true });
            }
        }
    });
}
