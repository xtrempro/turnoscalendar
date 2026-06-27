"use strict";

const CANCELLABLE_SWAP_STATUSES = new Set([
  "open",
  "distributed",
  "assigned",
  "pending_colleague",
  "colleague_accepted",
  "pending_supervisor"
]);

const FINAL_SWAP_STATUSES = new Set([
  "accepted",
  "supervisor_accepted",
  "supervisor_rejected",
  "canceled",
  "rejected",
  "approved"
]);

function normalizeSwapKind(value) {
  return value === "direct" || value === "open" ? value : "";
}

function canCancelSwapStatus(value) {
  return CANCELLABLE_SWAP_STATUSES.has(String(value || ""));
}

function isFinalSwapStatus(value) {
  return FINAL_SWAP_STATUSES.has(String(value || ""));
}

module.exports = {
  CANCELLABLE_SWAP_STATUSES,
  FINAL_SWAP_STATUSES,
  normalizeSwapKind,
  canCancelSwapStatus,
  isFinalSwapStatus
};
