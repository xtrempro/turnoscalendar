import {
    getCurrentProfile,
    getProfiles
} from "./storage.js";
import { getRaw, setRaw } from "./persistence.js";
import { TURNO_LABEL } from "./constants.js";

let undoStack = [];
let redoStack = [];

const PROFILE_BUCKET_LABELS = {
    admin: "permisos administrativos",
    legal: "feriados legales",
    comp: "feriados compensatorios",
    leaveBalances: "saldos de vacaciones",
    hourReturns: "devolucion de horas",
    hheeReturnTransfers: "horas extras a devolucion",
    abs: "permisos o ausencias",
    blocked: "bloqueos del calendario",
    shift: "asignacion de turno",
    clockMarks: "marcajes",
    replacementContracts: "contratos de reemplazo",
    gradeHistory: "historial de grado",
    contractHistory: "historial contractual"
};

const GLOBAL_BUCKET_LABELS = {
    replacements: "reemplazos",
    memos: "memorandum"
};

function key(nombre,tipo){
    return tipo + "_" + nombre;
}

function safeJSON(raw, fallback) {
    if (raw === null || raw === undefined || raw === "") {
        return fallback;
    }

    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function rawChanged(before, after) {
    return String(before ?? "") !== String(after ?? "");
}

function formatKeyDate(keyDay) {
    const parts = String(keyDay || "")
        .split("-")
        .map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return String(keyDay || "");
    }

    return [
        String(parts[2]).padStart(2, "0"),
        String(parts[1] + 1).padStart(2, "0"),
        parts[0]
    ].join("/");
}

function formatISODate(value) {
    const match = String(value || "")
        .match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) return String(value || "");

    return [
        match[3],
        match[2],
        match[1]
    ].join("/");
}

function turnValueLabel(value) {
    const number = Number(value);

    if (Number.isFinite(number) && TURNO_LABEL[number] !== undefined) {
        return TURNO_LABEL[number] || "Libre";
    }

    return String(value || "Libre");
}

function mapChanges(beforeRaw, afterRaw) {
    const before = safeJSON(beforeRaw, {});
    const after = safeJSON(afterRaw, {});
    const keys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after || {})
    ]);

    return Array.from(keys)
        .filter(itemKey =>
            JSON.stringify(before?.[itemKey]) !==
            JSON.stringify(after?.[itemKey])
        )
        .sort((a, b) => {
            const [ay, am, ad] = String(a).split("-").map(Number);
            const [by, bm, bd] = String(b).split("-").map(Number);

            return (
                (ay || 0) - (by || 0) ||
                (am || 0) - (bm || 0) ||
                (ad || 0) - (bd || 0)
            );
        });
}

function actionPrefix(type) {
    return type === "redo"
        ? "Se rehizo"
        : "Se deshizo";
}

function describeCalendarChange(profile, beforeRaw, afterRaw, type) {
    const before = safeJSON(beforeRaw, {});
    const after = safeJSON(afterRaw, {});
    const changes = mapChanges(beforeRaw, afterRaw);
    const prefix = actionPrefix(type);

    if (!changes.length) return "";

    if (changes.length === 1) {
        const dayKey = changes[0];
        const visibleValue = type === "redo"
            ? after?.[dayKey]
            : before?.[dayKey];

        return `${prefix} la modificacion turno ${turnValueLabel(visibleValue)} del ${formatKeyDate(dayKey)} en el calendario de ${profile}.`;
    }

    return `${prefix} la modificacion de ${changes.length} turnos en el calendario de ${profile}.`;
}

function describeSwapChange(beforeRaw, afterRaw, type) {
    const before = safeJSON(beforeRaw, []);
    const after = safeJSON(afterRaw, []);
    const source = type === "redo" ? after : before;
    const sourceMap = new Map(
        (Array.isArray(source) ? source : [])
            .map(item => [String(item?.id || ""), item])
            .filter(([id]) => id)
    );
    const compare = type === "redo" ? before : after;
    const compareMap = new Map(
        (Array.isArray(compare) ? compare : [])
            .map(item => [String(item?.id || ""), item])
            .filter(([id]) => id)
    );
    const changed = Array.from(sourceMap.values()).find(item =>
        JSON.stringify(item) !==
        JSON.stringify(compareMap.get(String(item?.id || "")))
    );

    if (!changed) return "";

    return `${actionPrefix(type)} el cambio de turno entre ${changed.from || "un trabajador"} y ${changed.to || "otro trabajador"} del ${formatISODate(changed.fecha)} con devolucion ${formatISODate(changed.devolucion)}.`;
}

function collectProfileChanges(current, target) {
    const profileNames = new Set([
        ...Object.keys(current?.profiles || {}),
        ...Object.keys(target?.profiles || {})
    ]);
    const changes = [];

    profileNames.forEach(profile => {
        const before = current?.profiles?.[profile] || {};
        const after = target?.profiles?.[profile] || {};

        Object.keys(before).forEach(bucket => {
            if (rawChanged(before[bucket], after[bucket])) {
                changes.push({
                    profile,
                    bucket,
                    before: before[bucket],
                    after: after[bucket]
                });
            }
        });
    });

    return changes;
}

function describeProfileBucket(change, type) {
    if (!change) return "";

    if (change.bucket === "data") {
        return describeCalendarChange(
            change.profile,
            change.before,
            change.after,
            type
        );
    }

    const label =
        PROFILE_BUCKET_LABELS[change.bucket] ||
        "datos del trabajador";

    return `${actionPrefix(type)} la modificacion de ${label} de ${change.profile}.`;
}

function describeHistoryChange(type, current, target) {
    if (!current || !target) {
        return `${actionPrefix(type)} la ultima accion.`;
    }

    if (rawChanged(current.swaps, target.swaps)) {
        const swapMessage = describeSwapChange(
            current.swaps,
            target.swaps,
            type
        );

        if (swapMessage) return swapMessage;
    }

    const profileChanges = collectProfileChanges(current, target);
    const dataChange = profileChanges.find(change =>
        change.bucket === "data"
    );
    const preferredChange =
        dataChange ||
        profileChanges.find(change =>
            [
                "admin",
                "legal",
                "comp",
                "abs",
                "hourReturns",
                "clockMarks",
                "hheeReturnTransfers"
            ].includes(change.bucket)
        ) ||
        profileChanges[0];

    if (preferredChange) {
        return describeProfileBucket(preferredChange, type);
    }

    const globalChange = Object.keys(GLOBAL_BUCKET_LABELS)
        .find(bucket => rawChanged(current[bucket], target[bucket]));

    if (globalChange) {
        return `${actionPrefix(type)} la modificacion de ${GLOBAL_BUCKET_LABELS[globalChange]}.`;
    }

    return `${actionPrefix(type)} la ultima accion.`;
}

function snapshotProfile(p){
    return {
        data: getRaw(key(p,"data")),
        admin: getRaw(key(p,"admin")),
        legal: getRaw(key(p,"legal")),
        comp: getRaw(key(p,"comp")),
        leaveBalances: getRaw(
            key(p,"leaveBalances")
        ),
        hourReturns: getRaw(key(p,"hourReturns")),
        hheeReturnTransfers: getRaw(
            key(p,"hheeReturnTransfers")
        ),
        abs: getRaw(key(p,"absences")),
        blocked: getRaw(key(p,"blocked")),
        shift: getRaw(key(p,"shift")),
        clockMarks: getRaw(key(p,"clockMarks")),
        replacementContracts: getRaw(
            key(p,"replacementContracts")
        ),
        gradeHistory: getRaw(key(p,"gradeHistory")),
        contractHistory: getRaw(key(p,"contractHistory"))
    };
}

function restoreProfile(p, state){
    setRaw(key(p,"data"), state.data || "{}");
    setRaw(key(p,"admin"), state.admin || "{}");
    setRaw(key(p,"legal"), state.legal || "{}");
    setRaw(key(p,"comp"), state.comp || "{}");
    setRaw(
        key(p,"leaveBalances"),
        state.leaveBalances || "{}"
    );
    setRaw(key(p,"hourReturns"), state.hourReturns || "{}");
    setRaw(
        key(p,"hheeReturnTransfers"),
        state.hheeReturnTransfers || "{}"
    );
    setRaw(key(p,"absences"), state.abs || "{}");
    setRaw(key(p,"blocked"), state.blocked || "{}");
    setRaw(key(p,"shift"), state.shift || "false");
    setRaw(key(p,"clockMarks"), state.clockMarks || "{}");
    setRaw(
        key(p,"replacementContracts"),
        state.replacementContracts || "[]"
    );
    setRaw(key(p,"gradeHistory"), state.gradeHistory || "[]");
    setRaw(key(p,"contractHistory"), state.contractHistory || "[]");
}

function snapshot(){

    const p = getCurrentProfile();
    if(!p) return null;

    const profiles = {};

    getProfiles().forEach(profile => {
        profiles[profile.name] =
            snapshotProfile(profile.name);
    });

    return {
        currentProfile: p,
        profiles,
        ...snapshotProfile(p),
        swaps: getRaw("swaps"),
        replacements: getRaw("replacements"),
        memos: getRaw("memos")
    };
}

function restore(state){

    const p = getCurrentProfile();
    if(!p || !state) return;

    if (state.profiles) {
        Object.entries(state.profiles).forEach(
            ([profile, profileState]) => {
                restoreProfile(profile, profileState);
            }
        );
    } else {
        restoreProfile(p, state);
    }

    setRaw("swaps", state.swaps || "[]");
    setRaw("replacements", state.replacements || "[]");
    setRaw("memos", state.memos || "[]");
}

export function pushHistory(){
    const state = snapshot();

    if (!state) return;

    undoStack.push(state);

    if(undoStack.length > 50){
        undoStack.shift();
    }

    redoStack = [];
}

export function canUndo(){
    return undoStack.length > 0;
}

export function canRedo(){
    return redoStack.length > 0;
}

export function undo(){

    if(!undoStack.length) return false;

    const current = snapshot();
    redoStack.push(current);

    const prev = undoStack.pop();
    const message = describeHistoryChange("undo", current, prev);

    restore(prev);

    return {
        ok: true,
        message
    };
}

export function redo(){

    if(!redoStack.length) return false;

    const current = snapshot();
    undoStack.push(current);

    const next = redoStack.pop();
    const message = describeHistoryChange("redo", current, next);

    restore(next);

    return {
        ok: true,
        message
    };
}
