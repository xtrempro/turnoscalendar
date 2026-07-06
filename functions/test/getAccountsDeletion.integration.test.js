"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Este test requiere FIRESTORE_EMULATOR_HOST.");
}
if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-proturnos" });
}

const db = admin.firestore();
const {
  deleteAdminUser,
  deleteAdminWorkspace,
  setAdminAccountPlan
} = require("../getAccountsAndUnits");

test("el admin asigna un plan temporal y también puede volver a Gratis", async () => {
  const uid = "admin-plan-assignment-test";
  const accountRef = db.collection("accounts").doc(uid);
  await db.collection("users").doc(uid).set({
    email: "plan-test@example.com",
    displayName: "Cuenta con plan"
  });

  await assert.rejects(
    setAdminAccountPlan.run({
      auth: {
        uid: "normal-user",
        token: { email: "normal@example.com", email_verified: true }
      },
      data: { uid, plan: "p2", durationDays: 45 }
    }),
    /permisos de administrador/i
  );

  const assigned = await setAdminAccountPlan.run({
    auth: { uid: "admin-test", token: { admin: true, email_verified: true } },
    data: { uid, plan: "p2", durationDays: 45 }
  });

  assert.equal(assigned.subscription.plan, "p2");
  assert.equal(assigned.subscription.effectivePlan, "p2");
  assert.equal(assigned.subscription.source, "admin");
  assert.equal(assigned.subscription.expired, false);
  assert.ok(assigned.subscription.currentPeriodEnd > Date.now());

  let account = (await accountRef.get()).data();
  assert.equal(account.plan, "p2");
  assert.equal(account.source, "admin");
  assert.equal(account.adminAssignedByUid, "admin-test");

  const downgraded = await setAdminAccountPlan.run({
    auth: { uid: "admin-test", token: { admin: true, email_verified: true } },
    data: { uid, plan: "free", durationDays: 0 }
  });

  account = (await accountRef.get()).data();
  assert.equal(downgraded.subscription.plan, "free");
  assert.equal(account.plan, "free");
  assert.equal(account.currentPeriodEnd, null);
});

test("el admin elimina una unidad y todas sus referencias", async () => {
  const workspaceId = "delete-workspace-test";
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const email = "worker@example.com";

  await Promise.all([
    workspaceRef.set({ name: "Unidad a eliminar", ownerUid: "owner-1" }),
    workspaceRef.collection("members").doc("owner-1").set({ role: "owner" }),
    workspaceRef.collection("members").doc("supervisor-1").set({ role: "member" }),
    workspaceRef.collection("workerLinks").doc("worker-1").set({ uid: "worker-1" }),
    workspaceRef.collection("workerAppInvites").doc("invite-1").set({ email }),
    workspaceRef.collection("stateModules").doc("profile").set({ chunkCount: 1 }),
    db.collection("users").doc("owner-1").collection("workspaces").doc(workspaceId).set({ role: "owner" }),
    db.collection("users").doc("supervisor-1").collection("workspaces").doc(workspaceId).set({ role: "member" }),
    db.collection("users").doc("worker-1").collection("workerLinks").doc(workspaceId).set({}),
    db.collection("workerAppEmailInvites").doc(email).collection("items").doc("invite-1").set({ workspaceId }),
    db.collection("workspaceLinks").doc("from-link").set({ fromWorkspaceId: workspaceId, toWorkspaceId: "other" }),
    db.collection("workspaceLinks").doc("to-link").set({ fromWorkspaceId: "other", toWorkspaceId: workspaceId })
  ]);

  await assert.rejects(
    deleteAdminWorkspace.run({
      auth: { uid: "admin-test", token: { admin: true, email_verified: true } },
      data: { workspaceId, confirmation: "incorrecto" }
    }),
    /confirmación/i
  );
  assert.equal((await workspaceRef.get()).exists, true);

  const result = await deleteAdminWorkspace.run({
    auth: { uid: "admin-test", token: { admin: true, email_verified: true } },
    data: { workspaceId, confirmation: workspaceId }
  });

  assert.equal(result.deleted, true);
  const documents = await Promise.all([
    workspaceRef.get(),
    db.collection("users").doc("owner-1").collection("workspaces").doc(workspaceId).get(),
    db.collection("users").doc("supervisor-1").collection("workspaces").doc(workspaceId).get(),
    db.collection("users").doc("worker-1").collection("workerLinks").doc(workspaceId).get(),
    db.collection("workerAppEmailInvites").doc(email).collection("items").doc("invite-1").get(),
    db.collection("workspaceLinks").doc("from-link").get(),
    db.collection("workspaceLinks").doc("to-link").get()
  ]);

  documents.forEach((document) => assert.equal(document.exists, false));
});

test("el admin elimina Auth, membresías y unidades propias de un usuario", async () => {
  const uid = "delete-user-test";
  const email = "delete-user@example.com";
  const ownedWorkspaceId = "delete-user-owned-workspace";
  const sharedWorkspaceId = "delete-user-shared-workspace";
  const userRef = db.collection("users").doc(uid);

  await admin.auth().createUser({ uid, email, emailVerified: true });
  await Promise.all([
    userRef.set({ email, displayName: "Usuario eliminable" }),
    db.collection("accounts").doc(uid).set({ plan: "free" }),
    db.collection("workspaces").doc(ownedWorkspaceId).set({ name: "Propia", ownerUid: uid }),
    db.collection("workspaces").doc(ownedWorkspaceId).collection("members").doc(uid).set({ role: "owner" }),
    userRef.collection("workspaces").doc(ownedWorkspaceId).set({ role: "owner" }),
    db.collection("workspaces").doc(sharedWorkspaceId).set({ name: "Compartida", ownerUid: "other-owner" }),
    db.collection("workspaces").doc(sharedWorkspaceId).collection("members").doc(uid).set({ role: "member" }),
    db.collection("workspaces").doc(sharedWorkspaceId).collection("workerLinks").doc(uid).set({ uid }),
    userRef.collection("workspaces").doc(sharedWorkspaceId).set({ role: "member" }),
    userRef.collection("workerLinks").doc(sharedWorkspaceId).set({})
  ]);

  const result = await deleteAdminUser.run({
    auth: { uid: "admin-test", token: { admin: true, email_verified: true } },
    data: {
      uid,
      confirmation: email,
      deleteOwnedUnits: true
    }
  });

  assert.equal(result.deleted, true);
  assert.equal(result.ownedWorkspacesDeleted, 1);
  await assert.rejects(
    admin.auth().getUser(uid),
    (error) => error.code === "auth/user-not-found"
  );

  const documents = await Promise.all([
    userRef.get(),
    db.collection("accounts").doc(uid).get(),
    db.collection("workspaces").doc(ownedWorkspaceId).get(),
    db.collection("workspaces").doc(sharedWorkspaceId).get(),
    db.collection("workspaces").doc(sharedWorkspaceId).collection("members").doc(uid).get(),
    db.collection("workspaces").doc(sharedWorkspaceId).collection("workerLinks").doc(uid).get()
  ]);

  assert.equal(documents[0].exists, false);
  assert.equal(documents[1].exists, false);
  assert.equal(documents[2].exists, false);
  assert.equal(documents[3].exists, true);
  assert.equal(documents[4].exists, false);
  assert.equal(documents[5].exists, false);
});
