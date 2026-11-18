import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
    TASK_ASSIGNMENTS_KEY as KEY,
    acknowledgeTaskAssignmentPatch,
    applyTaskAssignmentPatch,
    composeTaskAssignmentPatches,
    diffTaskAssignmentWeek,
    guardTaskAssignmentEntry,
    mergeTaskAssignmentEntries
} from "../js/taskAssignmentSync.js";
import {
    groupPartialStateEntries,
    mergePartialStateEntries,
    planPartialStateEntries
} from "../js/firebasePartialState.js";
import { commitPartialStateSlice, normalizeQueuedStateEntries } from "../js/firebaseAppState.js";
const { applyEntry } = createRequire(import.meta.url)("../functions/lib/stateReader.js");
const WEEK = "2026-11-16";
const CELL_A = "day|resonador|2026-10-17";
const CELL_B = "day|escaner|2026-10-18";
const cell = (...workers) => ({ workers, note: "", removedDefaults: [], mergedNextTaskId: "" });
const snapshot = week => ({ [WEEK]: week });
function plan(before, after) {
    return planPartialStateEntries({ keys: [KEY], moduleForKey: () => "tasks",
        changes: { [KEY]: { previous: JSON.stringify(before), next: JSON.stringify(after) } } });
}
function document(weeks) {
    return { moduleId: "tasks", storageKey: KEY,
        items: Object.fromEntries(Object.entries(weeks).map(([week, cells]) => [week, JSON.stringify(cells)])),
        deletedItems: {} };
}
function read(doc) {
    const server = {};
    applyEntry(server, doc);
    const client = {};
    const entries = [
        ...(Object.hasOwn(doc,"value") ? [{ storageKey:KEY,itemKey:"",value:doc.value,deleted:doc.deleted===true }] : []),
        ...normalizeQueuedStateEntries([{ ...doc, taskPatches: undefined }])
    ];
    mergePartialStateEntries(client, entries);
    assert.deepEqual(JSON.parse(client[KEY]), JSON.parse(server[KEY]));
    return JSON.parse(server[KEY]);
}
function commit(doc, changes) {
    for (const group of groupPartialStateEntries(changes)) {
        const guarded = guardTaskAssignmentEntry(group, doc);
        // Mismo formato persistido que partialStateDocumentPayload; el delta es local.
        doc = { ...doc, items: { ...doc.items, ...guarded.items },
            deletedItems: { ...doc.deletedItems, ...guarded.deletedItems } };
    }
    return doc;
}

test("dos casillas de la misma semana sobreviven en ambos ordenes", () => {
    const base = snapshot({});
    const a = plan(base, snapshot({ [CELL_A]: cell("ANA") }));
    const b = plan(base, snapshot({ [CELL_B]: cell("BETO") }));
    for (const [first, second] of [[a,b],[b,a]]) {
        const final = read(commit(commit(document(base), first), second))[WEEK];
        assert.deepEqual(final[CELL_A].workers, ["ANA"]);
        assert.deepEqual(final[CELL_B].workers, ["BETO"]);
    }
});

test("dos altas en la misma casilla conservan las dos personas", () => {
    const base = snapshot({});
    const a = plan(base, snapshot({ [CELL_A]: cell("ANA") }));
    const b = plan(base, snapshot({ [CELL_A]: cell("BETO") }));
    const final = read(commit(commit(document(base), a), b))[WEEK];
    assert.deepEqual(final[CELL_A].workers, ["ANA", "BETO"]);
});

test("retirar a la ultima persona no borra una incorporacion concurrente", () => {
    const base = snapshot({ [CELL_A]: cell("ANA") });
    const remove = plan(base, snapshot({}));
    const add = plan(base, snapshot({ [CELL_A]: cell("ANA", "BETO") }));
    for (const [first,second] of [[add,remove],[remove,add]]) {
        assert.deepEqual(read(commit(commit(document(base), first), second))[WEEK][CELL_A].workers, ["BETO"]);
    }
});

test("cambiar nombres respeta el retiro deliberado y las incorporaciones ajenas", () => {
    const base = snapshot({ [CELL_A]: cell("ANA") });
    const replacement = plan(base, snapshot({ [CELL_A]: cell("CARLA") }));
    const add = plan(base, snapshot({ [CELL_A]: cell("ANA", "BETO") }));
    const result = read(commit(commit(document(base), add), replacement))[WEEK][CELL_A];
    assert.deepEqual(result.workers, ["BETO", "CARLA"]);
});

test("notas, cierre, fusion y exclusiones de predefinidos no pisan otros campos", () => {
    const original = cell("ANA");
    const base = snapshot({ [CELL_A]: original });
    let doc = document(base);
    for (const fields of [{note:"Equipo en revision"}, {closed:true}, {mergedNextTaskId:"task-b"},
        {removedDefaults:["ANA"]}, {workers:["ANA","BETO"]}]) {
        doc = commit(doc, plan(base,snapshot({ [CELL_A]:{...original,...fields} })));
    }
    assert.deepEqual(read(doc)[WEEK][CELL_A], {
        workers:["ANA","BETO"],note:"Equipo en revision",closed:false,
        removedDefaults:["ANA"],mergedNextTaskId:"task-b"
    });
});

test("la ultima edicion gana en el mismo campo y repetir el delta es idempotente", () => {
    const base=snapshot({ [CELL_A]:cell("ANA") });
    const a=plan(base,snapshot({ [CELL_A]:{...cell("ANA"),note:"Primera"} }));
    const b=plan(base,snapshot({ [CELL_A]:{...cell("ANA"),note:"Segunda"} }));
    const doc=commit(commit(document(base),a),b);
    assert.equal(read(doc)[WEEK][CELL_A].note,"Segunda");
    assert.deepEqual(commit(doc,b),doc);
});

test("vaciar la semana retira las casillas conocidas y conserva una nueva ajena", () => {
    const base=snapshot({ [CELL_A]:cell("ANA") });
    const remove=plan(base,{});
    const add=plan(base,snapshot({ ...base[WEEK],[CELL_B]:cell("BETO") }));
    const final=read(commit(commit(document(base),add),remove))[WEEK];
    assert.equal(final[CELL_A],undefined);
    assert.deepEqual(final[CELL_B].workers,["BETO"]);
});

test("leer value antiguo, items y lapidas conserva la compatibilidad de lectura", () => {
    const base=snapshot({ [CELL_A]:cell("ANA") });
    const edit=plan(base,snapshot({ ...base[WEEK],[CELL_B]:cell("BETO") }));
    const old={storageKey:KEY,value:JSON.stringify(base)};
    assert.deepEqual(read(commit(old,edit))[WEEK][CELL_A].workers,["ANA"]);
    const tombstone={...document(base),deletedItems:{[WEEK]:true}};
    const result=read(commit(tombstone,edit))[WEEK];
    assert.equal(result[CELL_A],undefined);
    assert.deepEqual(result[CELL_B].workers,["BETO"]);
    // Primera escritura cuando la semana aun solo estaba en chunks.
    assert.deepEqual(read(commit({storageKey:KEY},edit))[WEEK][CELL_A].workers,["ANA"]);
});

test("colas, agrupacion y desagrupacion conservan todas las operaciones", () => {
    const a=plan(snapshot({}),snapshot({ [CELL_A]:cell("ANA") }))[0];
    const b=plan(snapshot({}),snapshot({ [CELL_B]:cell("BETO") }))[0];
    const merged=mergeTaskAssignmentEntries(a,b);
    const roundtrip=normalizeQueuedStateEntries(groupPartialStateEntries([merged]));
    assert.deepEqual(roundtrip[0].taskPatch,merged.taskPatch);
    assert.deepEqual(groupPartialStateEntries([a,b])[0].taskPatches[WEEK],merged.taskPatch);
    assert.deepEqual(Object.keys(read(commit(document(snapshot({})),roundtrip))[WEEK]).sort(),[CELL_A,CELL_B].sort());
});

test("un acuse antiguo no elimina altas, retiros o notas posteriores", () => {
    const a={ [CELL_A]:cell("ANA") };
    const b={ [CELL_A]:cell("BETO"),[CELL_B]:{...cell(),note:"Nueva"} };
    const sent=diffTaskAssignmentWeek({},a);
    const later=diffTaskAssignmentWeek(a,b);
    const pending=composeTaskAssignmentPatches(sent,later);
    const remaining=acknowledgeTaskAssignmentPatch(pending,sent);
    assert.deepEqual(applyTaskAssignmentPatch(a,remaining),b);
    assert.deepEqual(acknowledgeTaskAssignmentPatch(pending,pending),{});
});

test("un aviso masivo o flush sin before/after no republica toda la copia local", () => {
    assert.deepEqual(planPartialStateEntries({keys:[KEY],readRaw:()=>JSON.stringify(snapshot({[CELL_A]:cell("ANA")})),moduleForKey:()=>"tasks"}),[]);
});

test("datos corruptos o deltas perdidos no se convierten en vacios destructivos", () => {
    assert.throws(()=>planPartialStateEntries({keys:[KEY],moduleForKey:()=>"tasks",changes:{[KEY]:{previous:"{bad",next:"{}"}}}));
    assert.throws(()=>guardTaskAssignmentEntry({storageKey:KEY,items:{[WEEK]:"{}"}},document(snapshot({}))));
    const planned=groupPartialStateEntries(plan(snapshot({}),snapshot({[CELL_A]:cell("ANA")})))[0];
    assert.throws(()=>guardTaskAssignmentEntry(planned,{items:{[WEEK]:"broken"}}));
});

function fakeFirestore(initial) {
    let data=structuredClone(initial), version=0, batchCalls=0, attempts=0;
    let beforeCommit=async()=>{};
    const module={
        collection:(_db,...parts)=>parts.join("/"),doc:(parent,id)=>`${parent}/${id}`,
        documentId:()=>"id",orderBy:()=>null,limit:()=>null,query:parent=>parent,
        getDocs:async parent=>({docs:parent.endsWith("/chunks")?[]:[{id:KEY,exists:()=>true,data:()=>structuredClone(data),metadata:{hasPendingWrites:false}}]}),
        serverTimestamp:()=>({timestamp:"server"}),
        writeBatch:()=>{batchCalls++;throw new Error("No se permite fallback ciego");},
        async runTransaction(_db,callback) {
            for(let retry=0;retry<5;retry++) {
                attempts++;
                const seen=version;
                let payload;
                const result=await callback({get:async()=>({exists:()=>true,data:()=>structuredClone(data)}),set:(_ref,next)=>{payload=next;}});
                await beforeCommit();
                if(version!==seen) continue;
                data={...data,...payload};version++;
                return result;
            }
            throw new Error("Conflicto persistente");
        }
    };
    return {module,get data(){return data;},get attempts(){return attempts;},get batchCalls(){return batchCalls;},
        mutate(fn){data=fn(data);version++;},
        setBeforeCommit(fn){beforeCommit=fn;}};
}

test("la transaccion real reintenta un conflicto y persiste ambas casillas sin cambiar el esquema",async()=>{
    const base=snapshot({});
    const fs=fakeFirestore(document(base));
    const a=groupPartialStateEntries(plan(base,snapshot({[CELL_A]:cell("ANA")})));
    const b=groupPartialStateEntries(plan(base,snapshot({[CELL_B]:cell("BETO")})));
    let externalEdit=false;
    fs.setBeforeCommit(async()=>{
        if(externalEdit)return;
        externalEdit=true;
        fs.mutate(doc=>commit(doc,plan(base,snapshot({["day|tercera|2026-10-19"]:cell("CARLA")}))));
    });
    await Promise.all([commitPartialStateSlice({},fs.module,"ws",a),commitPartialStateSlice({},fs.module,"ws",b)]);
    assert.ok(fs.attempts>=3,"debe haber reintentado desde el estado mas reciente");
    assert.deepEqual(read(fs.data)[WEEK][CELL_A].workers,["ANA"]);
    assert.deepEqual(read(fs.data)[WEEK][CELL_B].workers,["BETO"]);
    assert.deepEqual(read(fs.data)[WEEK]["day|tercera|2026-10-19"].workers,["CARLA"]);
    assert.equal(fs.data.taskPatches,undefined);
    assert.equal(fs.batchCalls,0);
});

test("un fallo de transaccion de tareas nunca cae en la escritura sin lectura",async()=>{
    const fs=fakeFirestore(document(snapshot({})));
    fs.module.runTransaction=async()=>{throw new Error("offline");};
    const entries=groupPartialStateEntries(plan(snapshot({}),snapshot({[CELL_A]:cell("ANA")})));
    await assert.rejects(commitPartialStateSlice({},fs.module,"ws",entries),/offline/);
    assert.equal(fs.batchCalls,0);
});

test("los envios locales se serializan y una nota vieja no confirma despues de la nueva",async()=>{
    const base=snapshot({[CELL_A]:cell("ANA")});
    const fs=fakeFirestore(document(base));
    let started,release;
    const start=new Promise(resolve=>{started=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    fs.setBeforeCommit(async()=>{started();await gate;});
    const first=groupPartialStateEntries(plan(base,snapshot({[CELL_A]:{...cell("ANA"),note:"Primera"}})));
    const second=groupPartialStateEntries(plan(base,snapshot({[CELL_A]:{...cell("ANA"),note:"Segunda"}})));
    const a=commitPartialStateSlice({},fs.module,"ws",first);
    const b=commitPartialStateSlice({},fs.module,"ws",second);
    await start;
    assert.equal(fs.attempts,1,"el segundo envio aun no debe haber comenzado");
    release();
    await Promise.all([a,b]);
    assert.equal(read(fs.data)[WEEK][CELL_A].note,"Segunda");
});

// Se empaqueta el modulo real con accesos de prueba al estado privado. No se
// sustituye la cola, el planificador, el guardado ni la aplicacion remota.
const source=await readFile(new URL("../js/firebaseAppState.js",import.meta.url),"utf8");
const bundled=await build({stdin:{contents:source+`
export const testState = {
  setup(services, workspace = "ws") { stopFirebaseAppStateSync(); activeWorkspaceId = workspace; servicesCache = services; },
  queue: queuePartialStateEntries,
  requeue: queueGroupedPartialStateEntries,
  remote: applyRemoteStateEntries,
  remoteDocument(data) { const entries = stateEntriesFromDoc({data: () => data,metadata:{hasPendingWrites:false}}); applyRemoteStateEntries(entries); },
  hydrate() { return applyRemoteModule("tasks", {}, activeWorkspaceId, syncGeneration, {force:true}); },
  background: flushPartialStateEntries,
  expire(now) { cleanupLocalDirtyStateEntries(now); },
  pending() { return [...pendingStateEntries.values()]; },
  dirty() { return [...localDirtyStateEntries.values()].map(x => x.entry); },
  clearTimers() { clearTimeout(entrySyncTimer); entrySyncTimer = null; }
};`,resolveDir:fileURLToPath(new URL("../js/",import.meta.url)),sourcefile:"firebaseAppState.js"},bundle:true,write:false,platform:"node",format:"esm",logLevel:"silent"});
const live=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
function memoryStorage() {
    const values=new Map();
    return {get length(){return values.size;},key:index=>[...values.keys()][index]??null,
        getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

test("un envio manual en vuelo no borra la edicion posterior al confirmar",async()=>{
    globalThis.localStorage=memoryStorage();
    const fs=fakeFirestore(document(snapshot({})));
    live.testState.setup({db:{},firestoreModule:fs.module});
    let started;
    const start=new Promise(resolve=>{started=resolve;});
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    fs.setBeforeCommit(async()=>{started();await gate;});
    const first=snapshot({[CELL_A]:cell("ANA")});
    const a=plan(snapshot({}),first);
    localStorage.setItem(KEY,JSON.stringify(first));
    live.testState.queue(a);live.testState.clearTimers();
    const flush=live.flushPendingFirebaseAppStateEntries({keys:[KEY]});
    await start;
    const second=snapshot({...first[WEEK],[CELL_B]:cell("BETO")});
    localStorage.setItem(KEY,JSON.stringify(second));
    live.testState.queue(plan(first,second));live.testState.clearTimers();
    release();
    try {
        assert.equal((await flush).flushed,true);
        assert.deepEqual(Object.keys(live.testState.pending()[0].taskPatch),[CELL_B]);
        assert.deepEqual(Object.keys(live.testState.dirty()[0].taskPatch),[CELL_B]);
        live.testState.remote([{moduleId:"tasks",storageKey:KEY,itemKey:WEEK,value:"{}",updatedAtMillis:1}]);
        assert.deepEqual(JSON.parse(localStorage.getItem(KEY))[WEEK][CELL_A].workers,["ANA"]);
        // Una bajada antigua conserva el nombre aun pendiente, sin esconder
        // una tercera casilla que agrego otra sesion.
        const remote={ [CELL_A]:cell("ANA"),"day|otra|2026-10-19":cell("CARLA") };
        live.testState.remoteDocument({...document(snapshot(remote)),taskRevision:2,updatedAtISO:new Date().toISOString()});
        const local=JSON.parse(localStorage.getItem(KEY))[WEEK];
        assert.deepEqual(local[CELL_B].workers,["BETO"]);
        assert.deepEqual(local["day|otra|2026-10-19"].workers,["CARLA"]);
    } finally {live.stopFirebaseAppStateSync();delete globalThis.localStorage;}
});

test("si falla otra clave del lote no se vuelve a publicar la semana ya confirmada",async()=>{
    globalThis.localStorage=memoryStorage();
    const fs=fakeFirestore(document(snapshot({})));
    const transaction=fs.module.runTransaction;
    let calls=0;
    fs.module.runTransaction=async(...args)=>{if(++calls>1)throw new Error("offline");return transaction(...args);};
    live.testState.setup({db:{},firestoreModule:fs.module});
    const warn=console.warn;console.warn=()=>{};
    try {
        live.testState.queue([
            ...plan(snapshot({}),snapshot({[CELL_A]:cell("ANA")})),
            {moduleId:"tasks",storageKey:"weekly_task_assignment_updated",itemKey:WEEK,value:'"now"'}
        ],{urgent:true});
        live.testState.clearTimers();
        await live.testState.background();
        live.testState.clearTimers();
        assert.deepEqual(live.testState.pending().map(entry=>entry.storageKey),["weekly_task_assignment_updated"]);
        assert.deepEqual(read(fs.data)[WEEK][CELL_A].workers,["ANA"]);
    } finally {console.warn=warn;live.stopFirebaseAppStateSync();delete globalThis.localStorage;}
});

test("un reintento antiguo conserva la ultima operacion y no vence sin acuse",()=>{
    globalThis.localStorage=memoryStorage();
    live.testState.setup({});
    try {
        const first=snapshot({[CELL_A]:cell("ANA")});
        const old=plan(snapshot({}),first);
        const latest=plan(first,snapshot({[CELL_A]:cell("BETO")}));
        live.testState.queue(latest);live.testState.clearTimers();
        live.testState.requeue(old,{older:true});
        live.testState.expire(Date.now()+60*60*1000);
        assert.ok(live.testState.dirty()[0].taskPatch);
        const week=read(commit(document(snapshot({})),live.testState.pending()))[WEEK];
        assert.deepEqual(week[CELL_A].workers,["BETO"]);
    } finally {live.stopFirebaseAppStateSync();delete globalThis.localStorage;}
});

test("cambiar de sesion confirma la cola en la unidad original sin contaminar la nueva",async()=>{
    const base=snapshot({});
    const fs=fakeFirestore(document(base));
    live.testState.setup({db:{},firestoreModule:fs.module});
    let started,release;
    const start=new Promise(resolve=>{started=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    fs.setBeforeCommit(async()=>{started();await gate;});
    const first=groupPartialStateEntries(plan(base,snapshot({[CELL_A]:cell("ANA")})));
    const second=groupPartialStateEntries(plan(base,snapshot({[CELL_B]:cell("BETO")})));
    const a=live.commitPartialStateSlice({},fs.module,"ws",first);
    const b=live.commitPartialStateSlice({},fs.module,"ws",second).then(()=>null,error=>error);
    await start;
    live.testState.setup({db:{},firestoreModule:fs.module},"otra-unidad");
    release();
    await a;
    assert.equal(await b,null);
    assert.equal(fs.attempts,2);
    assert.deepEqual(read(fs.data)[WEEK][CELL_B].workers,["BETO"]);
    assert.deepEqual(live.testState.pending(),[]);
    live.stopFirebaseAppStateSync();
});

test("cerrar una casilla mientras llega otra persona la deja abierta y visible",()=>{
    const base=snapshot({[CELL_A]:cell("ANA")});
    const close=plan(base,snapshot({[CELL_A]:{...cell(),closed:true}}));
    const add=plan(base,snapshot({[CELL_A]:cell("ANA","BETO")}));
    for(const [a,b] of [[close,add],[add,close]]) {
        const result=read(commit(commit(document(base),a),b))[WEEK][CELL_A];
        assert.deepEqual(result.workers,["BETO"]);
        assert.notEqual(result.closed,true);
    }
});

test("una incorporacion concurrente en casilla fusionada sube a la dueña y admite retiro posterior",()=>{
    const owner="day|rx|2026-10-17",child="day|tac|2026-10-17";
    const base=snapshot({[owner]:cell("ANA"),[child]:cell("BETO")});
    const merge=plan(base,snapshot({[owner]:{...cell("ANA","BETO"),mergedNextTaskId:"tac"}}));
    const add=plan(base,snapshot({...base[WEEK],[child]:cell("BETO","DIEGO")}));
    for(const [a,b] of [[merge,add],[add,merge]]) {
        let stored=commit(commit(document(base),a),b);
        const result=read(stored)[WEEK];
        assert.deepEqual(new Set(result[owner].workers),new Set(["ANA","BETO","DIEGO"]));
        assert.equal(result[child]?.workers?.length||0,0);
        const remove=plan(snapshot({[child]:cell("DIEGO")}),snapshot({}));
        stored=commit(stored,remove);
        assert.ok(!read(stored)[WEEK][owner].workers.includes("DIEGO"));
    }
});

test("hidratar el modulo despues del acuse conserva nombres de una version remota mas nueva",async()=>{
    globalThis.localStorage=memoryStorage();
    const base=snapshot({[CELL_A]:cell("ANA")});
    const fs=fakeFirestore(document(base));
    live.testState.setup({db:{},firestoreModule:fs.module});
    try {
        live.testState.queue(plan(base,snapshot({[CELL_A]:{...cell("ANA"),note:"Local"}})));
        live.testState.clearTimers();
        await live.flushPendingFirebaseAppStateEntries({keys:[KEY]});
        assert.deepEqual(live.testState.dirty(),[]);
        fs.mutate(doc=>({...commit(doc,plan(base,snapshot({...base[WEEK],[CELL_B]:cell("BETO")}))),taskRevision:2}));
        await live.testState.hydrate();
        assert.deepEqual(JSON.parse(localStorage.getItem(KEY))[WEEK][CELL_B].workers,["BETO"]);
        live.testState.remoteDocument({...document(base),taskRevision:0});
        assert.deepEqual(JSON.parse(localStorage.getItem(KEY))[WEEK][CELL_B].workers,["BETO"]);
    } finally {live.stopFirebaseAppStateSync();delete globalThis.localStorage;}
});

test("un reloj cliente adelantado no oculta nombres de una version remota posterior",async()=>{
    globalThis.localStorage=memoryStorage();
    const RealDate=globalThis.Date;
    const base=snapshot({});
    const fs=fakeFirestore(document(base));
    live.testState.setup({db:{},firestoreModule:fs.module});
    try {
        globalThis.Date=class extends RealDate {
            constructor(...args){super(...(args.length?args:[RealDate.now()+3600000]));}
            static now(){return RealDate.now()+3600000;}
        };
        live.testState.queue(plan(base,snapshot({[CELL_A]:cell("ANA")})));
        live.testState.clearTimers();
        await live.flushPendingFirebaseAppStateEntries({keys:[KEY]});
        const newer={...document(snapshot({[CELL_A]:cell("ANA"),[CELL_B]:cell("BETO")})),taskRevision:2,
            updatedAt:{toMillis:()=>RealDate.now()},updatedAtISO:new RealDate().toISOString()};
        live.testState.remoteDocument(newer);
        assert.deepEqual(JSON.parse(localStorage.getItem(KEY))[WEEK][CELL_B].workers,["BETO"]);
    } finally {globalThis.Date=RealDate;live.stopFirebaseAppStateSync();delete globalThis.localStorage;}
});

test("un documento de tareas corrupto no bloquea otro calendario del flush manual",async()=>{
    globalThis.localStorage=memoryStorage();
    const base=snapshot({});
    const fs=fakeFirestore({...document(base),items:{[WEEK]:"JSON roto"}});
    live.testState.setup({db:{},firestoreModule:fs.module});
    try {
        live.testState.queue([
            ...plan(base,snapshot({[CELL_A]:cell("ANA")})),
            {moduleId:"turnos",storageKey:"data_ANA",itemKey:"2026-10-17",value:"2"}
        ]);
        live.testState.clearTimers();
        await assert.rejects(live.flushPendingFirebaseAppStateEntries({keys:[KEY,"data_ANA"]}));
        live.testState.clearTimers();
        assert.equal(fs.data.storageKey,"data_ANA");
        assert.equal(fs.data.items["2026-10-17"],"2");
        assert.deepEqual(live.testState.pending().map(entry=>entry.storageKey),[KEY]);
    } finally {live.stopFirebaseAppStateSync();delete globalThis.localStorage;}
});

test("un guardado confirmado durante el cambio de unidad informa exito de la unidad original",async()=>{
    globalThis.localStorage=memoryStorage();
    const fs=fakeFirestore(document(snapshot({})));
    live.testState.setup({db:{},firestoreModule:fs.module});
    let started,release;
    const start=new Promise(resolve=>{started=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    fs.setBeforeCommit(async()=>{started();await gate;});
    live.testState.queue(plan(snapshot({}),snapshot({[CELL_A]:cell("ANA")})));live.testState.clearTimers();
    const flushing=live.flushPendingFirebaseAppStateEntries({keys:[KEY]});
    await start;
    live.testState.setup({db:{},firestoreModule:fs.module},"otra");
    release();
    try {
        const result=await flushing;
        assert.equal(result.flushed,true);
        assert.equal(result.reason,"saved-origin-workspace");
        assert.deepEqual(live.testState.dirty(),[]);
    } finally {live.stopFirebaseAppStateSync();delete globalThis.localStorage;}
});

test("un evento ilegible avisa por el canal de error y sigue encolando las otras claves",()=>{
    globalThis.localStorage=memoryStorage();
    live.testState.setup({});
    const events=[];
    globalThis.window={dispatchEvent:event=>{events.push(event);}};
    globalThis.CustomEvent=class {constructor(type,{detail}){this.type=type;this.detail=detail;}};
    try {
        live.queueFirebasePersistenceChanges({keys:[KEY,"data_ANA"],changes:{
            [KEY]:{previous:"JSON roto",next:"{}"},
            data_ANA:{previous:"{}",next:'{"2026-10-17":2}'}
        }});
        live.testState.clearTimers();
        assert.ok(events.some(event=>event.detail.type==="app-state-error"&&event.detail.keys.includes(KEY)));
        assert.deepEqual(live.testState.pending().map(entry=>entry.storageKey),["data_ANA"]);
    } finally {live.stopFirebaseAppStateSync();delete globalThis.localStorage;delete globalThis.window;delete globalThis.CustomEvent;}
});
