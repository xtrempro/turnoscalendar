"use strict";

const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  onDocumentCreated,
  onDocumentWritten
} = require("firebase-functions/v2/firestore");
const {
  confirmationMatches,
  countProfiles,
  isAuthorizedAdminIdentity,
  nonNegativeCount,
  normalizeAdminPlanAssignment,
  normalizeEmail,
  summarizeAccount,
  summarizeSubscription,
  timestampToMillis
} = require("./getAccountsAndUnitsCore");

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const REGION = "southamerica-west1";
const DEFAULT_ADMIN_EMAILS = ["tm.alanplaza@gmail.com"];
const ENFORCE_APP_CHECK = true;
const MAX_PAGE_SIZE = 50;

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function configuredAdminEmails() {
  const configured = cleanText(process.env.ADMIN_EMAILS, 4000)
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_ADMIN_EMAILS.map(normalizeEmail);
}

async function isAdminCaller(auth) {
  if (!auth?.uid) return false;

  let hasAdminDocument = false;
  try {
    const adminDoc = await db.collection("adminUsers").doc(auth.uid).get();
    hasAdminDocument = adminDoc.exists && adminDoc.data()?.active !== false;
  } catch (error) {
    logger.warn("No se pudo consultar adminUsers.", { message: error.message });
  }

  return isAuthorizedAdminIdentity({
    token: auth.token || {},
    hasAdminDocument,
    configuredEmails: configuredAdminEmails()
  });
}

async function requireAdmin(auth) {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
  }

  if (!await isAdminCaller(auth)) {
    throw new HttpsError(
      "permission-denied",
      "Esta cuenta no tiene permisos de administrador global."
    );
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

async function readProfileCounts(workspaceRef) {
  const [chunksSnap, profileEntrySnap] = await Promise.all([
    workspaceRef
      .collection("stateModules")
      .doc("profile")
      .collection("chunks")
      .get(),
    workspaceRef
      .collection("stateModules")
      .doc("profile")
      .collection("entries")
      .doc("profiles")
      .get()
  ]);
  const text = chunksSnap.docs
    .map((doc) => ({
      index: Number(doc.data()?.index) || 0,
      text: String(doc.data()?.text || "")
    }))
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.text)
    .join("");

  let snapshot = {};
  try {
    snapshot = JSON.parse(text || "{}");
  } catch (error) {
    logger.warn("Módulo profile inválido al calcular contadores.", {
      workspaceId: workspaceRef.id,
      message: error.message
    });
  }

  return countProfiles(
    snapshot,
    profileEntrySnap.exists ? profileEntrySnap.data() : null
  );
}

async function readPwaUsersCount(workspaceRef) {
  const links = workspaceRef.collection("workerLinks");

  try {
    const aggregate = await links.count().get();
    return Number(aggregate.data()?.count) || 0;
  } catch (error) {
    logger.warn("Aggregation count no disponible; se usa fallback select().", {
      workspaceId: workspaceRef.id,
      message: error.message
    });
    return (await links.select().get()).size;
  }
}

async function calculateAndStoreCounters(workspaceRef, options = {}) {
  const includeWorkers = options.workers !== false;
  const includePwa = options.pwa !== false;
  const [profileCounts, pwaUsersCount] = await Promise.all([
    includeWorkers ? readProfileCounts(workspaceRef) : null,
    includePwa ? readPwaUsersCount(workspaceRef) : null
  ]);
  const patch = {
    countersUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (profileCounts) Object.assign(patch, profileCounts);
  if (pwaUsersCount !== null) patch.pwaUsersCount = pwaUsersCount;

  try {
    await workspaceRef.update(patch);
  } catch (error) {
    // Un borrado recursivo también elimina workerLinks/stateModules y puede
    // disparar estos contadores. update() evita recrear una unidad ya borrada.
    if (error?.code === 5 || error?.code === "not-found") return null;
    throw error;
  }
  return patch;
}

async function ensureWorkspaceCounters(workspaceDoc) {
  const data = workspaceDoc.data() || {};
  let workersCount = nonNegativeCount(data.workersCount);
  let activeWorkersCount = nonNegativeCount(data.activeWorkersCount);
  let pwaUsersCount = nonNegativeCount(data.pwaUsersCount);
  const missingWorkers = workersCount === null || activeWorkersCount === null;
  const missingPwa = pwaUsersCount === null;

  if (missingWorkers || missingPwa) {
    const calculated = await calculateAndStoreCounters(workspaceDoc.ref, {
      workers: missingWorkers,
      pwa: missingPwa
    });

    if (!calculated) {
      return {
        workersCount: workersCount || 0,
        activeWorkersCount: activeWorkersCount || 0,
        pwaUsersCount: pwaUsersCount || 0,
        counterSource: "deleted"
      };
    }

    if (missingWorkers) {
      workersCount = calculated.workersCount;
      activeWorkersCount = calculated.activeWorkersCount;
    }
    if (missingPwa) pwaUsersCount = calculated.pwaUsersCount;
  }

  return {
    workersCount: workersCount || 0,
    activeWorkersCount: activeWorkersCount || 0,
    pwaUsersCount: pwaUsersCount || 0,
    counterSource: missingWorkers || missingPwa ? "calculated" : "stored"
  };
}

async function getAllInChunks(refs, chunkSize = 100) {
  const docs = [];

  for (let index = 0; index < refs.length; index += chunkSize) {
    docs.push(...await db.getAll(...refs.slice(index, index + chunkSize)));
  }

  return docs;
}

async function loadWorkspaceMap(workspaceIds) {
  const ids = [...new Set(workspaceIds.filter(Boolean))];
  const refs = ids.map((id) => db.collection("workspaces").doc(id));
  const docs = refs.length ? await getAllInChunks(refs) : [];
  const summaries = await mapLimit(docs.filter((doc) => doc.exists), 4, async (doc) => {
    const data = doc.data() || {};
    const counters = await ensureWorkspaceCounters(doc);

    return {
      id: doc.id,
      name: String(data.name || data.title || doc.id),
      ownerUid: String(data.ownerUid || ""),
      workersCount: counters.workersCount,
      activeWorkersCount: counters.activeWorkersCount,
      pwaUsersCount: counters.pwaUsersCount,
      counterSource: counters.counterSource,
      createdAt: timestampToMillis(data.createdAt),
      updatedAt: timestampToMillis(data.lastActivityAt || data.updatedAt),
      deletionStatus: String(data.deletionStatus || "")
    };
  });

  return new Map(summaries.map((summary) => [summary.id, summary]));
}

async function loadAccounts(userDocs) {
  const membershipsByUid = new Map();
  const workspaceIds = [];

  await mapLimit(userDocs, 8, async (userDoc) => {
    const memberships = await userDoc.ref.collection("workspaces").get();
    const items = memberships.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    membershipsByUid.set(userDoc.id, items);
    items.forEach((item) => workspaceIds.push(item.id));
  });

  const workspaceMap = await loadWorkspaceMap(workspaceIds);
  const subscriptionDocs = userDocs.length
    ? await getAllInChunks(
      userDocs.map((userDoc) => db.collection("accounts").doc(userDoc.id))
    )
    : [];
  const subscriptionsByUid = new Map(
    subscriptionDocs.map((doc) => [doc.id, doc])
  );

  return userDocs.map((userDoc) => {
    const units = (membershipsByUid.get(userDoc.id) || []).map((membership) => {
      const workspace = workspaceMap.get(membership.id);
      const fallbackRole = workspace?.ownerUid === userDoc.id ? "owner" : "member";

      if (!workspace) {
        return {
          id: membership.id,
          name: String(membership.name || membership.id),
          role: String(membership.role || fallbackRole),
          workersCount: 0,
          activeWorkersCount: 0,
          pwaUsersCount: 0,
          createdAt: null,
          updatedAt: null,
          missing: true
        };
      }

      return {
        ...workspace,
        role: String(membership.role || fallbackRole)
      };
    });

    units.sort((a, b) => a.name.localeCompare(b.name, "es"));
    const account = summarizeAccount(userDoc.id, userDoc.data() || {}, units);
    const subscriptionDoc = subscriptionsByUid.get(userDoc.id);

    return {
      ...account,
      subscription: {
        ...summarizeSubscription(
          subscriptionDoc?.exists ? subscriptionDoc.data() || {} : {}
        ),
        hasAccountDocument: Boolean(subscriptionDoc?.exists)
      }
    };
  });
}

async function safeQuery(query, label) {
  try {
    return (await query.get()).docs;
  } catch (error) {
    logger.warn("Consulta de búsqueda omitida.", { label, message: error.message });
    return [];
  }
}

function searchVariants(search) {
  const values = new Set([search, search.toLowerCase()]);
  if (search) values.add(search[0].toUpperCase() + search.slice(1));
  return [...values].filter(Boolean);
}

async function searchUserDocs(search, pageSize) {
  const users = db.collection("users");
  const workspaces = db.collection("workspaces");
  const limit = Math.min(pageSize * 2, 100);
  const variants = searchVariants(search);
  const queries = [];

  variants.forEach((variant) => {
    queries.push(safeQuery(
      users.orderBy("email").startAt(variant).endAt(`${variant}\uf8ff`).limit(limit),
      "users.email"
    ));
    queries.push(safeQuery(
      users.orderBy("displayName").startAt(variant).endAt(`${variant}\uf8ff`).limit(limit),
      "users.displayName"
    ));
    queries.push(safeQuery(
      workspaces.orderBy("name").startAt(variant).endAt(`${variant}\uf8ff`).limit(limit),
      "workspaces.name"
    ));
  });

  const results = await Promise.all(queries);
  const userDocsById = new Map();
  const matchingWorkspaces = new Map();

  results.forEach((docs) => {
    docs.forEach((doc) => {
      if (doc.ref.parent.id === "users") userDocsById.set(doc.id, doc);
      if (doc.ref.parent.id === "workspaces") matchingWorkspaces.set(doc.id, doc);
    });
  });

  const memberUids = new Set();
  await mapLimit([...matchingWorkspaces.values()], 6, async (workspaceDoc) => {
    const data = workspaceDoc.data() || {};
    if (data.ownerUid) memberUids.add(String(data.ownerUid));
    const members = await workspaceDoc.ref.collection("members").select().get();
    members.docs.forEach((member) => memberUids.add(member.id));
  });

  const missingUserRefs = [...memberUids]
    .filter((uid) => !userDocsById.has(uid))
    .map((uid) => users.doc(uid));
  const memberUserDocs = missingUserRefs.length
    ? await getAllInChunks(missingUserRefs)
    : [];

  memberUserDocs.filter((doc) => doc.exists).forEach((doc) => {
    userDocsById.set(doc.id, doc);
  });

  return [...userDocsById.values()]
    .sort((a, b) => {
      const left = String(a.data()?.email || a.data()?.displayName || a.id);
      const right = String(b.data()?.email || b.data()?.displayName || b.id);
      return left.localeCompare(right, "es", { sensitivity: "base" });
    })
    .slice(0, pageSize);
}

async function listUserDocs(pageSize, pageToken) {
  let query = db
    .collection("users")
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(pageSize + 1);

  if (pageToken) query = query.startAfter(pageToken);

  const docs = (await query.get()).docs;
  const hasMore = docs.length > pageSize;
  const page = docs.slice(0, pageSize);

  return {
    docs: page,
    nextPageToken: hasMore ? page[page.length - 1]?.id || null : null
  };
}

const getAccountsAndUnits = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 180,
    memory: "512MiB"
  },
  async (request) => {
    await requireAdmin(request.auth);

    const data = request.data || {};
    const pageSize = Math.min(
      Math.max(Math.round(Number(data.pageSize) || 20), 1),
      MAX_PAGE_SIZE
    );
    const pageToken = cleanText(data.pageToken, 160) || null;
    const search = cleanText(data.search, 160);
    const uid = cleanText(data.uid, 160);

    try {
      if (uid) {
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) {
          throw new HttpsError("not-found", "Cuenta no encontrada.");
        }

        const [account] = await loadAccounts([userDoc]);
        return { account };
      }

      if (search) {
        const userDocs = await searchUserDocs(search, pageSize);
        return {
          accounts: await loadAccounts(userDocs),
          nextPageToken: null,
          searchMode: true
        };
      }

      const page = await listUserDocs(pageSize, pageToken);
      return {
        accounts: await loadAccounts(page.docs),
        nextPageToken: page.nextPageToken,
        searchMode: false
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("No se pudieron cargar cuentas y unidades.", error);
      throw new HttpsError(
        "internal",
        "No se pudo cargar la información de cuentas. Intenta nuevamente."
      );
    }
  }
);

async function deleteWorkspaceCascade(workspaceId) {
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const workspaceDoc = await workspaceRef.get();
  if (!workspaceDoc.exists) return { deleted: false, workspaceId };

  const workspace = workspaceDoc.data() || {};
  const [membersSnap, workerLinksSnap, invitesSnap, linksFrom, linksTo] =
    await Promise.all([
      workspaceRef.collection("members").get(),
      workspaceRef.collection("workerLinks").get(),
      workspaceRef.collection("workerAppInvites").get(),
      db.collection("workspaceLinks").where("fromWorkspaceId", "==", workspaceId).get(),
      db.collection("workspaceLinks").where("toWorkspaceId", "==", workspaceId).get()
    ]);
  const writer = db.bulkWriter();
  const scheduledDeletes = new Set();

  function scheduleDelete(ref) {
    if (scheduledDeletes.has(ref.path)) return;
    scheduledDeletes.add(ref.path);
    writer.delete(ref);
  }

  membersSnap.docs.forEach((member) => {
    scheduleDelete(
      db.collection("users").doc(member.id).collection("workspaces").doc(workspaceId)
    );
  });
  workerLinksSnap.docs.forEach((link) => {
    scheduleDelete(
      db.collection("users").doc(link.id).collection("workerLinks").doc(workspaceId)
    );
  });
  invitesSnap.docs.forEach((invite) => {
    const email = normalizeEmail(invite.data()?.email);
    if (!email || !email.includes("@")) return;

    scheduleDelete(
      db.collection("workerAppEmailInvites").doc(email).collection("items").doc(invite.id)
    );
  });
  [...linksFrom.docs, ...linksTo.docs].forEach((link) => scheduleDelete(link.ref));

  await writer.close();
  await db.recursiveDelete(workspaceRef);

  logger.info("Unidad eliminada por administrador global.", {
    workspaceId,
    ownerUid: workspace.ownerUid || "",
    members: membersSnap.size,
    workerLinks: workerLinksSnap.size
  });

  return {
    deleted: true,
    workspaceId,
    workspaceName: String(workspace.name || workspaceId),
    membersRemoved: membersSnap.size,
    pwaLinksRemoved: workerLinksSnap.size
  };
}

const deleteAdminWorkspace = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 540,
    memory: "512MiB"
  },
  async (request) => {
    await requireAdmin(request.auth);
    const workspaceId = cleanText(request.data?.workspaceId, 160);
    if (!workspaceId) {
      throw new HttpsError("invalid-argument", "Unidad inválida.");
    }

    const workspaceDoc = await db.collection("workspaces").doc(workspaceId).get();
    if (!workspaceDoc.exists) return { deleted: false, workspaceId };

    const workspaceName = String(workspaceDoc.data()?.name || workspaceId);
    if (!confirmationMatches(request.data?.confirmation, workspaceId, workspaceName)) {
      throw new HttpsError(
        "failed-precondition",
        "La confirmación no coincide con el nombre o ID de la unidad."
      );
    }

    return deleteWorkspaceCascade(workspaceId);
  }
);

const setAdminAccountPlan = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    await requireAdmin(request.auth);

    const uid = cleanText(request.data?.uid, 160);
    if (!uid) {
      throw new HttpsError("invalid-argument", "Usuario inválido.");
    }

    let assignment;
    try {
      assignment = normalizeAdminPlanAssignment(
        request.data?.plan,
        request.data?.durationDays
      );
    } catch (error) {
      if (error instanceof RangeError) {
        throw new HttpsError(
          "invalid-argument",
          "La duración debe ser un número entero entre 1 y 3650 días."
        );
      }
      throw new HttpsError(
        "invalid-argument",
        "El plan debe ser Gratis, Plan 1, Plan 2 o Plan 3."
      );
    }

    const userRef = db.collection("users").doc(uid);
    const accountRef = db.collection("accounts").doc(uid);
    const nowMs = Date.now();
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const currentPeriodEnd = assignment.plan === "free"
      ? null
      : admin.firestore.Timestamp.fromMillis(
        nowMs + assignment.durationDays * 86400000
      );
    const payload = {
      plan: assignment.plan,
      period: null,
      source: "admin",
      couponCode: null,
      currentPeriodEnd,
      adminAssignedAt: now,
      adminAssignedByUid: request.auth.uid,
      adminAssignedByEmail: cleanText(request.auth.token?.email, 254),
      updatedAt: now
    };

    const previousPlan = await db.runTransaction(async (transaction) => {
      const [userDoc, accountDoc] = await Promise.all([
        transaction.get(userRef),
        transaction.get(accountRef)
      ]);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "Cuenta no encontrada.");
      }

      transaction.set(accountRef, payload, { merge: true });
      return String(accountDoc.data()?.plan || "free");
    });

    logger.info("Plan modificado por administrador global.", {
      uid,
      previousPlan,
      plan: assignment.plan,
      durationDays: assignment.durationDays,
      currentPeriodEnd: currentPeriodEnd?.toMillis() || null,
      adminUid: request.auth.uid
    });

    return {
      ok: true,
      uid,
      subscription: {
        ...summarizeSubscription(payload, nowMs),
        hasAccountDocument: true
      }
    };
  }
);

const deleteAdminUser = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 540,
    memory: "512MiB"
  },
  async (request) => {
    await requireAdmin(request.auth);
    const uid = cleanText(request.data?.uid, 160);
    if (!uid) throw new HttpsError("invalid-argument", "Usuario inválido.");
    if (uid === request.auth.uid) {
      throw new HttpsError(
        "failed-precondition",
        "No puedes eliminar la cuenta administrativa con la sesión activa."
      );
    }

    const userRef = db.collection("users").doc(uid);
    const [userDoc, adminDoc] = await Promise.all([
      userRef.get(),
      db.collection("adminUsers").doc(uid).get()
    ]);
    let authUser = null;
    try {
      authUser = await admin.auth().getUser(uid);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }

    const userData = userDoc.exists ? userDoc.data() || {} : {};
    const email = String(authUser?.email || userData.email || "");
    if (!confirmationMatches(request.data?.confirmation, uid, email)) {
      throw new HttpsError(
        "failed-precondition",
        "La confirmación no coincide con el correo o UID del usuario."
      );
    }

    const targetIsAdmin = isAuthorizedAdminIdentity({
      token: {
        ...(authUser?.customClaims || {}),
        email,
        email_verified: authUser ? authUser.emailVerified : true
      },
      hasAdminDocument: adminDoc.exists && adminDoc.data()?.active !== false,
      configuredEmails: configuredAdminEmails()
    });
    if (targetIsAdmin) {
      throw new HttpsError(
        "failed-precondition",
        "Quita primero los permisos globales antes de eliminar otro administrador."
      );
    }

    const ownedWorkspaces = await db
      .collection("workspaces")
      .where("ownerUid", "==", uid)
      .get();
    if (!ownedWorkspaces.empty && request.data?.deleteOwnedUnits !== true) {
      throw new HttpsError(
        "failed-precondition",
        `El usuario posee ${ownedWorkspaces.size} unidades. Confirma su eliminación conjunta.`
      );
    }

    const deletedWorkspaces = [];
    for (const workspaceDoc of ownedWorkspaces.docs) {
      deletedWorkspaces.push(await deleteWorkspaceCascade(workspaceDoc.id));
    }

    const [membershipsSnap, userWorkerLinksSnap] = await Promise.all([
      userRef.collection("workspaces").get(),
      userRef.collection("workerLinks").get()
    ]);
    const writer = db.bulkWriter();
    membershipsSnap.docs.forEach((membership) => {
      writer.delete(
        db.collection("workspaces").doc(membership.id).collection("members").doc(uid)
      );
    });
    userWorkerLinksSnap.docs.forEach((link) => {
      writer.delete(
        db.collection("workspaces").doc(link.id).collection("workerLinks").doc(uid)
      );
    });
    await writer.close();

    if (authUser) await admin.auth().deleteUser(uid);
    await Promise.all([
      db.recursiveDelete(userRef),
      db.collection("accounts").doc(uid).delete()
    ]);

    logger.info("Usuario eliminado por administrador global.", {
      uid,
      ownedWorkspacesDeleted: deletedWorkspaces.length,
      membershipsRemoved: membershipsSnap.size,
      workerLinksRemoved: userWorkerLinksSnap.size
    });

    return {
      deleted: true,
      uid,
      ownedWorkspacesDeleted: deletedWorkspaces.length,
      membershipsRemoved: membershipsSnap.size,
      workerLinksRemoved: userWorkerLinksSnap.size
    };
  }
);

const initializeWorkspaceUsageCounters = onDocumentCreated(
  { document: "workspaces/{workspaceId}", region: REGION },
  async (event) => {
    await event.data.ref.set({
      workersCount: 0,
      activeWorkersCount: 0,
      pwaUsersCount: 0,
      countersUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
);

const syncWorkspaceWorkerCounters = onDocumentWritten(
  {
    document: "workspaces/{workspaceId}/stateModules/profile/entries/{entryId}",
    region: REGION
  },
  async (event) => {
    const beforeKey = event.data?.before?.data()?.storageKey;
    const afterKey = event.data?.after?.data()?.storageKey;
    if (beforeKey !== "profiles" && afterKey !== "profiles") return;

    await calculateAndStoreCounters(
      db.collection("workspaces").doc(event.params.workspaceId),
      { workers: true, pwa: false }
    );
  }
);

const syncLegacyWorkspaceWorkerCounters = onDocumentWritten(
  {
    document: "workspaces/{workspaceId}/stateModules/profile",
    region: REGION
  },
  async (event) => {
    await calculateAndStoreCounters(
      db.collection("workspaces").doc(event.params.workspaceId),
      { workers: true, pwa: false }
    );
  }
);

const syncWorkspacePwaCounters = onDocumentWritten(
  {
    document: "workspaces/{workspaceId}/workerLinks/{workerUid}",
    region: REGION
  },
  async (event) => {
    await calculateAndStoreCounters(
      db.collection("workspaces").doc(event.params.workspaceId),
      { workers: false, pwa: true }
    );
  }
);

module.exports = {
  deleteAdminUser,
  deleteAdminWorkspace,
  getAccountsAndUnits,
  initializeWorkspaceUsageCounters,
  setAdminAccountPlan,
  syncLegacyWorkspaceWorkerCounters,
  syncWorkspacePwaCounters,
  syncWorkspaceWorkerCounters
};
