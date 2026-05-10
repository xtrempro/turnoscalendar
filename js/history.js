import {
    getCurrentProfile,
    getProfiles
} from "./storage.js";
import { getRaw, setRaw } from "./persistence.js";

let undoStack = [];
let redoStack = [];

function key(nombre,tipo){
    return tipo + "_" + nombre;
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

    undoStack.push(snapshot());

    if(undoStack.length > 50){
        undoStack.shift();
    }

    redoStack = [];
}

export function undo(){

    if(!undoStack.length) return false;

    const current = snapshot();
    redoStack.push(current);

    const prev = undoStack.pop();

    restore(prev);

    return true;
}

export function redo(){

    if(!redoStack.length) return false;

    const current = snapshot();
    undoStack.push(current);

    const next = redoStack.pop();

    restore(next);

    return true;
}
