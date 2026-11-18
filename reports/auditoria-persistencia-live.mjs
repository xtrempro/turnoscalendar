// Solo lectura de produccion. El informe guarda conteos, sin nombres de personal.
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createFirestoreRestClient, plainDocument } from '../scripts/lib/firebase-rest.mjs';
import { entryLogicalState } from '../scripts/lib/entry-migration.mjs';
const require = createRequire(import.meta.url);
const { compareAuditLogFormats, auditShardIntegrity, checkAuditLogVersions, estimateFirestoreDocumentBytes } = require('../functions/lib/storageHealth.js');
const { applyEntry } = require('../functions/lib/stateReader.js');
const client = await createFirestoreRestClient('calendarioturnos-7c4d9');
const id = 'Boh7mvO5ku9quFFsPcIq';
const root = `workspaces/${id}`;
const [workspaceDoc, logDoc, shards, tasks, replacementsDoc, replacementDocs, healthDoc, reportDoc] = await Promise.all([
  client.getDocument(root),
  client.getDocument(`${root}/stateModules/log/entries/auditLog`),
  client.listDocuments(`${root}/auditLogShards`),
  client.listDocuments(`${root}/stateModules/tasks/entries`),
  client.getDocument(`${root}/stateModules/turnos/entries/replacements`),
  client.listDocuments(`${root}/replacementRecords`),
  client.getDocument(`storageHealthUnits/${id}`),
  client.getDocument(`storageHealthReports/2026-11-18/units/${id}`)
]);
const workspace = plainDocument(workspaceDoc);
if (workspace.name !== 'Imagenologia') throw new Error('Unidad inesperada');
const legacyState = {};
applyEntry(legacyState, plainDocument(logDoc));
const legacy = JSON.parse(legacyState.auditLog || '[]');
const shardRows = shards.map(d => ({id: d.name.split('/').pop(),data: plainDocument(d)}));
const archive = shardRows.flatMap(s => Object.values(s.data.items || {}).map(v => {try {return JSON.parse(v);} catch {return null;}})).filter(Boolean);
const comparison = compareAuditLogFormats(legacy, archive);
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
const differences = legacy.filter(l => comparison.missingOrDifferent.includes(l.id)).map(l => {
  const a = archive.find(v => v.id === l.id);
  const keys = [...new Set([...Object.keys(l), ...Object.keys(a || {})])].filter(k => canonical(l[k]) !== canonical(a?.[k]));
  return {id:l.id,type:l.type,action:l.action,createdAt:l.createdAt,canceledAt:l.canceledAt,missing:!a,fields:keys,
    values: Object.fromEntries(keys.filter(k => !/name|worker|details|reason|actor|profile|user/i.test(k)).map(k => [k,{legacy:l[k],archive:a?.[k]}]))};
});
const taskState = {};
for (const doc of tasks) applyEntry(taskState, plainDocument(doc));
const catalog = JSON.parse(taskState.weekly_task_assignment_tasks || '[]');
const weeks = JSON.parse(taskState.weekly_task_assignment_entries || '{}');
const catalogIds = new Set(catalog.map(t=>t.id));
const taskEntries = tasks.map(doc => {const d=plainDocument(doc); return {key:d.storageKey,updatedAt:d.updatedAtISO || d.updatedAt,bytes:estimateFirestoreDocumentBytes(d,doc.name.split('/documents/')[1]),hasValue:Object.hasOwn(d,'value'),container:d.container,items:Object.keys(d.items || {}).length,tombstones:Object.values(d.deletedItems || {}).filter(Boolean).length,deleted:d.deleted};});
const weekStats = Object.entries(weeks).map(([week,cells]) => ({week,cells:Object.keys(cells || {}).length,assignments:Object.values(cells || {}).reduce((n,v)=>n+(v?.workers?.length||0),0),orphanCells:Object.keys(cells || {}).filter(k=>!catalogIds.has(k.split('|')[1])).length}));
const { compareReplacementFormats } = require('../functions/lib/storageHealth.js');
const replacements = entryLogicalState(plainDocument(replacementsDoc));
const replacementComparison = compareReplacementFormats(replacements,replacementDocs.map(plainDocument));
const taskAuditLogs = archive.filter(l => /task|tarea|programaci/i.test(`${l.type} ${l.action} ${l.category}`)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-35).map(l=>({id:l.id,type:l.type,action:l.action,createdAt:l.createdAt,week:l.meta?.week,changes:l.meta?Object.fromEntries(['added','removed','moved','merged','split','closed','opened','notes'].filter(k=>k in l.meta).map(k=>[k,l.meta[k]])):null,buildId:l.writer?.buildId}));
const report = {
  checkedAt:new Date().toISOString(),workspace:{id,name:workspace.name,stateStorage:workspace.stateStorage,auditLogStorage:workspace.auditLogStorage,replacementStorage:workspace.replacementStorage},
  auditLog:{comparison,integrity:auditShardIntegrity(shardRows),versions:checkAuditLogVersions(legacy,archive),differences,legacyLatest:legacy.map(l=>l.createdAt).sort().at(-1),archiveLatest:archive.map(l=>l.createdAt).sort().at(-1)},
  replacements:{...replacementComparison,bytes:estimateFirestoreDocumentBytes(plainDocument(replacementsDoc),`${root}/stateModules/turnos/entries/replacements`)},
  tasks:{catalog:catalog.map(t=>({id:t.id,title:t.title,shift:t.shift,shiftScope:t.shiftScope})),entries:taskEntries,weeks:weekStats},
  monitor:plainDocument(healthDoc).overview,
  dailyAudits:plainDocument(reportDoc).audits,
  taskAuditLogs
};
await writeFile(new URL('./auditoria-persistencia-live.json', import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checkedAt:report.checkedAt,workspace:report.workspace,auditLog:report.auditLog,replacements:report.replacements,tasks:{catalogCount:catalog.length,entries:taskEntries,currentWeek:weekStats.find(w=>w.week==='2026-11-16')},reportFile:'reports/auditoria-persistencia-live.json'},null,2));
