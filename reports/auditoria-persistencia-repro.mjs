// Reproduccion local del riesgo actual: no usa red ni datos de produccion.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planPartialStateEntries, groupPartialStateEntries, mergePartialStateEntries } from '../js/firebasePartialState.js';
import { guardTaskAssignmentEntry } from '../js/taskAssignmentSync.js';
const require = createRequire(import.meta.url);
const { applyEntry } = require('../functions/lib/stateReader.js');
const storageKey = 'weekly_task_assignment_entries';
const week = '2026-11-16';
const firstCell = 'day|resonador|2026-10-17';
const secondCell = 'day|escaner|2026-10-18';
const original = { [week]: {} };
const sessionA = { [week]: { [firstCell]: { workers: ['PERSONA A'] } } };
const sessionB = { [week]: { [secondCell]: { workers: ['PERSONA B'] } } };
function plan(before, after) {
  return planPartialStateEntries({ keys:[storageKey], changes:{[storageKey]:{previous:JSON.stringify(before),next:JSON.stringify(after)}},moduleForKey:()=> 'tasks' });
}
// La transaccion fusiona el mapa items; cada valor de semana es un STRING JSON,
// por lo que Firestore no puede fusionar sus casillas interiores.
function commit(document, entries, corrected = false) {
  for(const planned of groupPartialStateEntries(entries)) {
    const group = corrected ? guardTaskAssignmentEntry(planned, document) : planned;
    document = {...document,...group,items:{...document.items,...group.items},deletedItems:{...document.deletedItems,...group.deletedItems}};
  }
  return document;
}
const a = plan(original, sessionA);
const b = plan(original, sessionB);
assert.equal(a[0].itemKey, week);
assert.equal(b[0].itemKey, week);
const serverDocument = commit(commit({storageKey},a),b);
const serverState = {};
applyEntry(serverState,serverDocument);
const final = JSON.parse(serverState[storageKey]);
assert.deepEqual(final,sessionB);
assert.equal(final[week][firstCell],undefined);
const browserState = {[storageKey]:JSON.stringify(original)};
mergePartialStateEntries(browserState,[...a,...b].map(({taskPatch,...entry})=>entry));
assert.deepEqual(JSON.parse(browserState[storageKey]),sessionB);
// Control: dos semanas distintas SI se conservan.
const otherWeek = '2026-11-23';
const c = plan(original,{...original,[otherWeek]:sessionB[week]});
const controlState = {};
applyEntry(controlState,commit(commit({storageKey},a),c));
const control=JSON.parse(controlState[storageKey]);
assert.deepEqual(control[week],sessionA[week]);
assert.deepEqual(control[otherWeek],sessionB[week]);
console.log('ANTES: reemplazar semanas desde copias desactualizadas pierde PERSONA A, en el lector cliente y en el servidor.');
console.log('CONTROL OK: editar semanas distintas conserva ambas.');
const correctedDocument=commit(commit({storageKey},a,true),b,true);
const correctedState={};
applyEntry(correctedState,correctedDocument);
const expected={[week]:{...sessionA[week],...sessionB[week]}};
assert.deepEqual(JSON.parse(correctedState[storageKey]),expected);
const correctedBrowser={[storageKey]:JSON.stringify(original)};
mergePartialStateEntries(correctedBrowser,[...a,...b]);
assert.deepEqual(JSON.parse(correctedBrowser[storageKey]),expected);
console.log('DESPUES: los deltas por casilla conservan PERSONA A y PERSONA B, en cliente y servidor.');
