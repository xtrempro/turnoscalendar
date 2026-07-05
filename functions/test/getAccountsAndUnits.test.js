"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  confirmationMatches,
  countProfiles,
  isAuthorizedAdminIdentity,
  normalizeEmail,
  summarizeAccount,
  timestampToMillis
} = require("../getAccountsAndUnitsCore");

test("la confirmación destructiva exige correo, nombre o ID exacto", () => {
  assert.equal(
    confirmationMatches(" Urgencias ", "workspace-1", "Urgencias"),
    true
  );
  assert.equal(
    confirmationMatches("workspace-1", "workspace-1", "Urgencias"),
    true
  );
  assert.equal(
    confirmationMatches("Urg", "workspace-1", "Urgencias"),
    false
  );
});

test("normaliza alias y puntos de Gmail para la lista administrativa", () => {
  assert.equal(
    normalizeEmail("Tm.Alan.Plaza+panel@googlemail.com"),
    "tmalanplaza@gmail.com"
  );
});

test("autoriza claim, adminUsers o email; rechaza cuentas normales", () => {
  const configuredEmails = ["admin@example.com"];

  assert.equal(isAuthorizedAdminIdentity({
    token: { email: "normal@example.com", email_verified: true },
    configuredEmails
  }), false);
  assert.equal(isAuthorizedAdminIdentity({
    token: { admin: true, email_verified: true }
  }), true);
  assert.equal(isAuthorizedAdminIdentity({
    token: { email_verified: true },
    hasAdminDocument: true
  }), true);
  assert.equal(isAuthorizedAdminIdentity({
    token: { email: "ADMIN@example.com", email_verified: true },
    configuredEmails
  }), true);
  assert.equal(isAuthorizedAdminIdentity({
    token: { admin: true, email_verified: false },
    hasAdminDocument: true,
    configuredEmails
  }), false);
});

test("resume una cuenta sin unidades", () => {
  assert.deepEqual(
    summarizeAccount("user-0", { email: "cero@example.com" }, []),
    {
      uid: "user-0",
      email: "cero@example.com",
      displayName: "",
      unitsCount: 0,
      totalWorkers: 0,
      totalPWA: 0,
      units: []
    }
  );
});

test("conserva una unidad, su rol y sus contadores", () => {
  const unit = {
    id: "unit-1",
    name: "Urgencias",
    role: "owner",
    workersCount: 80,
    pwaUsersCount: 57
  };
  const account = summarizeAccount(
    "user-1",
    { email: "owner@example.com", displayName: "Cuenta Uno" },
    [unit]
  );

  assert.equal(account.unitsCount, 1);
  assert.equal(account.totalWorkers, 80);
  assert.equal(account.totalPWA, 57);
  assert.equal(account.units[0].role, "owner");
});

test("suma múltiples unidades, incluidas unidades vacías", () => {
  const account = summarizeAccount("user-2", {}, [
    { id: "a", workersCount: 0, pwaUsersCount: 0 },
    { id: "b", workersCount: 420, pwaUsersCount: 315 },
    { id: "c", workersCount: 650, pwaUsersCount: 640 }
  ]);

  assert.equal(account.unitsCount, 3);
  assert.equal(account.totalWorkers, 1070);
  assert.equal(account.totalPWA, 955);
});

test("cuenta trabajadores registrados y activos desde el snapshot real", () => {
  const snapshot = {
    profiles: JSON.stringify([
      "Perfil legacy",
      { id: "active", active: true },
      { id: "inactive", active: false }
    ])
  };

  assert.deepEqual(countProfiles(snapshot), {
    workersCount: 3,
    activeWorkersCount: 2
  });
});

test("la entrada parcial profiles prevalece sobre los chunks legacy", () => {
  const snapshot = { profiles: JSON.stringify([{ id: "old" }]) };
  const profileEntry = {
    storageKey: "profiles",
    value: JSON.stringify([
      { id: "new-1" },
      { id: "new-2", active: false }
    ])
  };

  assert.deepEqual(countProfiles(snapshot, profileEntry), {
    workersCount: 2,
    activeWorkersCount: 1
  });
});

test("serializa timestamps de Firestore y fechas ISO", () => {
  assert.equal(timestampToMillis({ seconds: 10 }), 10000);
  assert.equal(
    timestampToMillis({ toMillis: () => 123456 }),
    123456
  );
  assert.equal(
    timestampToMillis("2026-07-05T12:00:00.000Z"),
    Date.parse("2026-07-05T12:00:00.000Z")
  );
});
