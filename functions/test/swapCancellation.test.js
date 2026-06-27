"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSwapKind,
  canCancelSwapStatus,
  isFinalSwapStatus
} = require("../swapCancellation");

test("solo acepta tipos de cambio conocidos", () => {
  assert.equal(normalizeSwapKind("direct"), "direct");
  assert.equal(normalizeSwapKind("open"), "open");
  assert.equal(normalizeSwapKind("legacy"), "");
});

test("permite anular mientras no exista resolucion final", () => {
  [
    "open",
    "distributed",
    "assigned",
    "pending_colleague",
    "colleague_accepted",
    "pending_supervisor"
  ].forEach((status) => assert.equal(canCancelSwapStatus(status), true));
});

test("bloquea la anulacion de estados finales", () => {
  ["supervisor_accepted", "supervisor_rejected", "canceled"].forEach((status) => {
    assert.equal(canCancelSwapStatus(status), false);
    assert.equal(isFinalSwapStatus(status), true);
  });
});
