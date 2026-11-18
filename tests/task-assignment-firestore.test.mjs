import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import * as firestore from "firebase/firestore";
import { planPartialStateEntries, groupPartialStateEntries } from "../js/firebasePartialState.js";
import { TASK_ASSIGNMENTS_KEY as KEY } from "../js/taskAssignmentSync.js";

test("dos clientes SDK reales materializan sus deltas bajo las reglas v2", async t => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) { t.skip("Requiere npm run test:storage-emulator"); return; }
    const env = await initializeTestEnvironment({projectId:"demo-proturnos",firestore:{rules:await readFile(new URL("../firebase.rules",import.meta.url),"utf8")}});
    t.after(()=>env.cleanup());
    const workspace="task-delta-sdk";
    const refFor=db=>firestore.doc(db,"workspaces",workspace,"stateModules","tasks","entries",KEY);
    await env.withSecurityRulesDisabled(async context=>{
        const db=context.firestore();
        await firestore.setDoc(firestore.doc(db,"workspaces",workspace),{name:"Prueba",ownerUid:"owner"});
        await firestore.setDoc(firestore.doc(db,"workspaces",workspace,"members","owner"),{role:"owner",permissions:{}});
        await firestore.setDoc(refFor(db),{moduleId:"tasks",storageKey:KEY,items:{},deletedItems:{}});
    });
    const source=await readFile(new URL("../js/firebaseAppState.js",import.meta.url),"utf8");
    const bundle=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL("../js/",import.meta.url)),sourcefile:"firebaseAppState.js"},
        bundle:true,write:false,format:"esm",platform:"node",logLevel:"silent"});
    const url=`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
    const [clientA,clientB]=await Promise.all([import(url+"#clientA"),import(url+"#clientB")]);
    const claims={email:"owner@example.com",firebase:{sign_in_provider:"google.com",sign_in_second_factor:"totp"}};
    const dbA=env.authenticatedContext("owner",claims).firestore();
    const dbB=env.authenticatedContext("owner",claims).firestore();
    await firestore.updateDoc(refFor(dbA),{writerSchemaVersion:2,taskRevision:1,taskWriteId:"bootstrap",updatedAt:firestore.serverTimestamp()});
    await env.withSecurityRulesDisabled(context=>firestore.setDoc(refFor(context.firestore()),{moduleId:"tasks",storageKey:KEY,items:{},deletedItems:{}}));
    let reads=0,releaseReads;
    const firstReads=new Promise(resolve=>{releaseReads=resolve;});
    const sdk = { ...firestore, runTransaction: (db, callback) => firestore.runTransaction(db, transaction => callback({
        async get(reference) {
            const snapshot=await transaction.get(reference);
            if (++reads<=2) { if (reads===2) releaseReads(); await firstReads; }
            return snapshot;
        },
        set(reference, payload, options) {
            assert.equal(payload.writerSchemaVersion,2);
            assert.ok(Number.isSafeInteger(payload.taskRevision));
            assert.ok(payload.taskWriteId);
            return transaction.set(reference,payload,options);
        }
    })) };
    const plan=next=>groupPartialStateEntries(planPartialStateEntries({keys:[KEY],moduleForKey:()=>"tasks",
        changes:{[KEY]:{previous:"{}",next:JSON.stringify(next)}}}));
    await Promise.all([
        clientA.commitPartialStateSlice(dbA,sdk,workspace,plan({"2026-11-16":{"day|rx|2026-10-17":{workers:["ANA"]}}})),
        clientB.commitPartialStateSlice(dbB,sdk,workspace,plan({"2026-11-16":{"day|tac|2026-10-17":{workers:["BETO"]}}}))
    ]);
    const saved=(await firestore.getDocFromServer(refFor(dbA))).data();
    const week=JSON.parse(saved.items["2026-11-16"]);
    assert.ok(reads>=3,"ambos clientes leyeron la misma revision y uno debe reintentar");
    assert.deepEqual(week["day|rx|2026-10-17"].workers,["ANA"]);
    assert.deepEqual(week["day|tac|2026-10-17"].workers,["BETO"]);
    assert.equal(saved.taskRevision,2);assert.equal(saved.writerSchemaVersion,2);
    assert.equal(saved.taskPatches,undefined);
    await assertFails(firestore.setDoc(refFor(dbB),{items:{"2026-11-16":"{}"}},{merge:true}));
    assert.equal((await firestore.getDocFromServer(refFor(dbA))).data().taskRevision,2);
});
