"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  memberCanManageRequests,
  memberCanReadWorkerCalendar,
  memberHasExplicitAccess
} = require("../authorization");

test("solo una membresia explicita habilita el acceso", () => {
  assert.equal(memberHasExplicitAccess({ role: "owner" }), true);
  assert.equal(memberHasExplicitAccess({
    role: "member",
    permissions: {}
  }), true);
  assert.equal(memberHasExplicitAccess({ role: "member" }), false);
  assert.equal(memberHasExplicitAccess({
    role: "member",
    permissions: []
  }), false);
  assert.equal(memberHasExplicitAccess({ role: "owner-forged" }), false);
});

test("administrar solicitudes exige edicion de solicitudes o turnos", () => {
  assert.equal(memberCanManageRequests({ role: "owner" }), true);
  assert.equal(memberCanManageRequests({
    role: "member",
    permissions: { requests: { view: true, edit: true } }
  }), true);
  assert.equal(memberCanManageRequests({
    role: "member",
    permissions: { turnos: { view: true, edit: true } }
  }), true);
  assert.equal(memberCanManageRequests({
    role: "member",
    permissions: { agenda: { view: true, edit: true } }
  }), false);
  assert.equal(memberCanManageRequests({
    role: "member",
    permissions: { requests: { view: true, edit: false } }
  }), false);
});

test("los calendarios PWA solo se exponen a modulos relacionados", () => {
  assert.equal(memberCanReadWorkerCalendar({ role: "owner" }), true);
  for (const key of ["turnos", "profile", "requests"]) {
    assert.equal(memberCanReadWorkerCalendar({
      role: "member",
      permissions: { [key]: { view: true, edit: false } }
    }), true);
  }
  assert.equal(memberCanReadWorkerCalendar({
    role: "member",
    permissions: { agenda: { view: true, edit: true } }
  }), false);
  assert.equal(memberCanReadWorkerCalendar({ role: "member" }), false);
});
