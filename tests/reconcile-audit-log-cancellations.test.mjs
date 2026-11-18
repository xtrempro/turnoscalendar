import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reconcileAuditLogCancellations } from "../scripts/reconcile-audit-log-cancellations.mjs";
import { firestoreValue, plainDocument, firestorePatchWrite } from "../scripts/lib/firebase-rest.mjs";
const log={id:"log1",action:"Permiso",createdAt:"2026-11-09T14:00:00Z"};
const canceled={...log,canceledAt:"2026-11-17T20:00:00Z",canceledBy:"Supervisor",cancellationDetails:"Anulado"};
function raw(name,data){return {name,updateTime:"2026-11-18T00:00:00Z",fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,firestoreValue(v)]))};}
function fixture(source=canceled){
    let legacy=raw("workspaces/ws/stateModules/log/entries/auditLog",{storageKey:"auditLog",container:"array",items:{log1:JSON.stringify(log),kept:JSON.stringify({...log,id:"kept"})},deletedItems:{old:true},value:JSON.stringify([log])});
    const shard=raw("workspaces/ws/auditLogShards/day_0",{items:{log1:JSON.stringify(source),kept:JSON.stringify({...log,id:"kept"})}});
    const calls=[];
    const client={
        getDocument:async target=>target==="workspaces/ws"?raw(target,{name:"Unidad"}):legacy,
        listDocuments:async()=>[shard],
        async patchDocument(target,fields,mask,updateTime,options){
            calls.push({target,fields,mask,updateTime,options});
            assert.equal(updateTime,legacy.updateTime);
            legacy={...legacy,fields:{...legacy.fields,...fields}};
        }
    };
    return {client,calls,get legacy(){return legacy;}};
}
const options=f=>({client:f.client,projectId:"demo",workspaceId:"ws",expectedName:"Unidad",logResult:()=>{}});

test("dry-run identifica anulaciones y no escribe ni necesita respaldo",async()=>{
    const f=fixture();
    const result=await reconcileAuditLogCancellations(options(f));
    assert.equal(result.count,1);assert.equal(f.calls.length,0);
});
test("apply respalda antes de escribir, usa CAS y conserva campos y eventos ajenos",async t=>{
    const directory=await mkdtemp(path.join(tmpdir(),"turnoplus-cancellation-test-"));
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
    t.after(()=>rm(directory,{recursive:true,force:true}));
    const f=fixture();
    const patch=f.client.patchDocument;
    f.client.patchDocument=async(...args)=>{
        const files=await readdir(directory);assert.equal(files.length,1);
        const backup=JSON.parse(await readFile(path.join(directory,files[0]),"utf8"));
        assert.deepEqual(JSON.parse(plainDocument(backup.legacyDoc).items.log1),log);
        return patch(...args);
    };
    const result=await reconcileAuditLogCancellations({...options(f),apply:true,backupDirectory:directory});
    assert.equal(result.count,1);assert.equal(f.calls.length,1);
    const data=plainDocument(f.legacy);
    assert.deepEqual(JSON.parse(data.items.log1),canceled);
    assert.equal(data.deletedItems.old,true);
    assert.ok(data.items.kept);assert.equal(data.value,JSON.stringify([log]));
    assert.equal(f.calls[0].updateTime,"2026-11-18T00:00:00Z");
    assert.deepEqual(f.calls[0].options,{serverTimestampFields:["updatedAt"]});
    assert.equal((await reconcileAuditLogCancellations(options(f))).count,0);
});

test("la escritura REST usa REQUEST_TIME y conserva la precondicion en la misma operacion",()=>{
    const write=firestorePatchWrite("projects/demo/databases/(default)/documents/log",{items:firestoreValue({})},
        ["items","updatedAt"],"2026-11-18T00:00:00Z",{serverTimestampFields:["updatedAt"]});
    assert.deepEqual(write.updateMask.fieldPaths,["items"]);
    assert.deepEqual(write.currentDocument,{updateTime:"2026-11-18T00:00:00Z"});
    assert.deepEqual(write.updateTransforms,[{fieldPath:"updatedAt",setToServerValue:"REQUEST_TIME"}]);
    assert.equal(write.update.fields.updatedAt,undefined);
});
test("rechaza unidad equivocada, otras diferencias y fragmentos corruptos",async()=>{
    const f=fixture();
    await assert.rejects(reconcileAuditLogCancellations({...options(f),expectedName:"Otra"}),/unidad no coincide/);
    const changed=fixture({...canceled,action:"Otra accion"});
    await assert.rejects(reconcileAuditLogCancellations(options(changed)),/otras diferencias/);
    f.client.listDocuments=async()=>[raw("shard",{items:{log1:"broken"}})];
    await assert.rejects(reconcileAuditLogCancellations(options(f)),/integridad/);
    assert.equal(f.calls.length,0);assert.equal(changed.calls.length,0);
});
test("un cambio concurrente rechaza el CAS y deja el respaldo",async t=>{
    const directory=await mkdtemp(path.join(tmpdir(),"turnoplus-cancellation-test-"));
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
    t.after(()=>rm(directory,{recursive:true,force:true}));
    const f=fixture();
    f.client.patchDocument=async()=>{throw new Error("FAILED_PRECONDITION");};
    await assert.rejects(reconcileAuditLogCancellations({...options(f),apply:true,backupDirectory:directory}),/FAILED_PRECONDITION/);
    assert.equal((await readdir(directory)).length,1);
    assert.deepEqual(JSON.parse(plainDocument(f.legacy).items.log1),log);
});
