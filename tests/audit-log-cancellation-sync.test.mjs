import test from "node:test";
import assert from "node:assert/strict";
import { guardAuditLogCancellations, preserveAuditLogCancellation } from "../js/auditLogCancellation.js";
import { commitPartialStateSlice } from "../js/firebaseAppState.js";
const log = { id:"log1",createdAt:"2026-11-09T14:09:57.199Z",action:"Aplico permiso" };
const canceled = { ...log,canceledAt:"2026-11-17T20:06:35.958Z",canceledBy:"Supervisor",cancellationDetails:"Anulado" };

test("una copia atrasada conserva la anulacion del mismo id",()=>{
    assert.deepEqual(preserveAuditLogCancellation(log,canceled),canceled);
    assert.deepEqual(preserveAuditLogCancellation({...log,details:"Otro campo"},canceled),{...canceled,details:"Otro campo"});
});
test("una anulacion mas reciente se conserva y otro permiso con otro id no se mezcla",()=>{
    const newer={...canceled,canceledAt:"2026-11-18T11:00:00.000Z",cancellationDetails:"Actualizado"};
    assert.deepEqual(preserveAuditLogCancellation(newer,canceled),newer);
    assert.deepEqual(preserveAuditLogCancellation(canceled,newer),newer);
    const other={...log,id:"nuevo-permiso"};
    assert.deepEqual(preserveAuditLogCancellation(other,canceled),other);
});
test("el documento antiguo protege las anulaciones de items y de value",()=>{
    const entry={storageKey:"auditLog",container:"array",items:{log1:JSON.stringify(log)},deletedItems:{log1:false}};
    for(const current of [{items:{log1:JSON.stringify(canceled)}},{value:JSON.stringify([canceled])}]) {
        const guarded=guardAuditLogCancellations(entry,current);
        assert.deepEqual(JSON.parse(guarded.items.log1),canceled);
        assert.deepEqual(JSON.parse(entry.items.log1),log);
    }
});
test("la poda no restaura eventos y un elemento eliminado no se toma como version vigente",()=>{
    const entry={storageKey:"auditLog",items:{log1:"null"},deletedItems:{log1:true}};
    assert.deepEqual(guardAuditLogCancellations(entry,{items:{log1:JSON.stringify(canceled)}}),entry);
    const restore={...entry,items:{log1:JSON.stringify(log)},deletedItems:{log1:false}};
    assert.deepEqual(JSON.parse(guardAuditLogCancellations(restore,{items:{log1:JSON.stringify(canceled)},deletedItems:{log1:true}}).items.log1),log);
});
test("el guardado real protege auditLog y no usa fallback sin lectura",async()=>{
    let payload,batchCalls=0;
    const module={collection:(_db,...parts)=>parts.join("/"),doc:(parent,id)=>parent+"/"+id,serverTimestamp:()=>"now",
        runTransaction:async(_db,fn)=>fn({get:async()=>({exists:()=>true,data:()=>({items:{log1:JSON.stringify(canceled)}})}),set:(_ref,next)=>{payload=next;}}),
        writeBatch:()=>{batchCalls++;throw new Error("fallback");}};
    const entry={moduleId:"log",storageKey:"auditLog",container:"array",items:{log1:JSON.stringify(log)},deletedItems:{log1:false}};
    await commitPartialStateSlice({},module,"ws",[entry]);
    assert.deepEqual(JSON.parse(payload.items.log1),canceled);
    module.runTransaction=async()=>{throw new Error("offline");};
    await assert.rejects(commitPartialStateSlice({},module,"ws",[entry]),/offline/);
    assert.equal(batchCalls,0);
});
