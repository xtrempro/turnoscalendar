"use strict";

function normalizeEmail(email) {
  const clean = String(email || "").trim().toLowerCase();
  const at = clean.indexOf("@");

  if (at < 0) return clean;

  let local = clean.slice(0, at);
  const domain = clean.slice(at + 1);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "").split("+")[0];
    return `${local}@gmail.com`;
  }

  return clean;
}

function isAuthorizedAdminIdentity({
  token = {},
  hasAdminDocument = false,
  configuredEmails = []
} = {}) {
  if (token.email_verified !== true) return false;
  if (token.admin === true || token.globalAdmin === true) return true;
  if (hasAdminDocument) return true;

  const email = normalizeEmail(token.email);
  return Boolean(email) && configuredEmails.map(normalizeEmail).includes(email);
}

function confirmationMatches(value, ...acceptedValues) {
  const confirmation = String(value || "").trim().toLocaleLowerCase("es");
  return Boolean(confirmation) && acceptedValues.some((accepted) =>
    String(accepted || "").trim().toLocaleLowerCase("es") === confirmation
  );
}

function nonNegativeCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const ADMIN_ASSIGNABLE_PLANS = new Set(["free", "p1", "p2", "p3"]);

function normalizeAdminPlanAssignment(planValue, durationValue) {
  const plan = String(planValue || "").trim().toLowerCase();

  if (!ADMIN_ASSIGNABLE_PLANS.has(plan)) {
    throw new TypeError("invalid-plan");
  }

  if (plan === "free") {
    return { plan, durationDays: 0 };
  }

  const durationDays = Number(durationValue);
  if (
    !Number.isInteger(durationDays) ||
    durationDays < 1 ||
    durationDays > 3650
  ) {
    throw new RangeError("invalid-duration");
  }

  return { plan, durationDays };
}

function summarizeSubscription(accountData = {}, now = Date.now()) {
  const plan = typeof accountData.plan === "string" && accountData.plan
    ? accountData.plan
    : "free";
  const currentPeriodEnd = timestampToMillis(accountData.currentPeriodEnd);
  const expired = plan !== "free" && currentPeriodEnd > 0 && now > currentPeriodEnd;

  return {
    plan,
    effectivePlan: expired ? "free" : plan,
    currentPeriodEnd: currentPeriodEnd || null,
    source: typeof accountData.source === "string" ? accountData.source : null,
    expired,
    assignedAt: timestampToMillis(
      accountData.adminAssignedAt || accountData.updatedAt
    ) || null,
    assignedByEmail:
      typeof accountData.adminAssignedByEmail === "string"
        ? accountData.adminAssignedByEmail
        : null
  };
}

function parseJSON(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function profilesFromState(snapshot = {}, profileEntry = null) {
  let rawProfiles = snapshot?.profiles;

  if (profileEntry?.storageKey === "profiles") {
    rawProfiles = profileEntry.deleted === true ? [] : profileEntry.value;
  }

  const profiles = parseJSON(rawProfiles, []);
  return Array.isArray(profiles) ? profiles : [];
}

function countProfiles(snapshot = {}, profileEntry = null) {
  const profiles = profilesFromState(snapshot, profileEntry);
  const activeWorkersCount = profiles.filter((profile) => {
    if (typeof profile === "string") return true;
    return profile && profile.active !== false;
  }).length;

  return {
    workersCount: profiles.length,
    activeWorkersCount
  };
}

function summarizeAccount(uid, userData = {}, units = []) {
  const normalizedUnits = Array.isArray(units) ? units : [];
  const totalWorkers = normalizedUnits.reduce(
    (total, unit) => total + (nonNegativeCount(unit?.workersCount) || 0),
    0
  );
  const totalPWA = normalizedUnits.reduce(
    (total, unit) => total + (nonNegativeCount(unit?.pwaUsersCount) || 0),
    0
  );

  return {
    uid,
    email: String(userData.email || userData.ownerEmail || ""),
    displayName: String(userData.displayName || userData.name || ""),
    unitsCount: normalizedUnits.length,
    totalWorkers,
    totalPWA,
    units: normalizedUnits
  };
}

module.exports = {
  confirmationMatches,
  countProfiles,
  isAuthorizedAdminIdentity,
  nonNegativeCount,
  normalizeEmail,
  normalizeAdminPlanAssignment,
  profilesFromState,
  summarizeAccount,
  summarizeSubscription,
  timestampToMillis
};
