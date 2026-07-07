"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkerSwapRequestHandler,
  respondWorkerSwapRequestHandler
} = require("../workerSwapRequests");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FakeDocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this.value = value;
  }

  data() {
    return this.value;
  }
}

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollectionReference(this.db, `${this.path}/${name}`);
  }

  get() {
    return Promise.resolve(this.db.snapshot(this));
  }

  set(value, options = {}) {
    this.db.setData(this.path, value, options);
    return Promise.resolve();
  }
}

class FakeCollectionReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`);
  }
}

class FakeFirestore {
  constructor(documents = {}) {
    this.documents = new Map(Object.entries(documents));
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  snapshot(ref) {
    return new FakeDocumentSnapshot(ref, this.documents.get(ref.path));
  }

  setData(path, value, options = {}) {
    const current = this.documents.get(path) || {};
    this.documents.set(
      path,
      options.merge ? { ...current, ...value } : value
    );
  }

  async runTransaction(callback) {
    const transaction = {
      get: (ref) => Promise.resolve(this.snapshot(ref)),
      set: (ref, value, options = {}) => {
        this.setData(ref.path, value, options);
      }
    };

    return callback(transaction);
  }

  data(path) {
    return this.documents.get(path);
  }
}

const WORKSPACE = "workspace-a";
const UID_A = "worker-a";
const UID_B = "worker-b";

function baseDocuments(overrides = {}) {
  const docs = {
    [`workspaces/${WORKSPACE}/workerLinks/${UID_A}`]: {
      uid: UID_A,
      workspaceId: WORKSPACE,
      profileName: "Ana",
      status: "active"
    },
    [`workspaces/${WORKSPACE}/workerLinks/${UID_B}`]: {
      uid: UID_B,
      workspaceId: WORKSPACE,
      profileName: "Beto",
      status: "active"
    },
    [`workspaces/${WORKSPACE}/workerSwapCandidates/${UID_A}`]: {
      uid: UID_A,
      profileName: "Ana",
      status: "active",
      compatibleWorkerUids: [UID_B],
      blockedDayDates: [],
      days: {
        "2026-07-10": {
          label: "Larga",
          displayLabel: "Larga",
          className: "larga"
        }
      }
    },
    [`workspaces/${WORKSPACE}/workerSwapCandidates/${UID_B}`]: {
      uid: UID_B,
      profileName: "Beto",
      status: "active",
      compatibleWorkerUids: [UID_A],
      blockedDayDates: [],
      days: {
        "2026-07-10": {
          label: "Libre",
          displayLabel: "Libre",
          className: "libre"
        },
        "2026-07-15": {
          label: "Noche",
          displayLabel: "Noche",
          className: "noche"
        }
      }
    },
    [`workspaces/${WORKSPACE}/workerAppData/${UID_A}`]: {
      swapLimit: {
        enabled: true,
        limit: 2,
        used: 1,
        year: 2026,
        month: 6
      }
    },
    [`workspaces/${WORKSPACE}/workerAppData/${UID_B}`]: {
      swapOptIn: { allowSwapRequests: true },
      swapLimit: { enabled: false }
    }
  };

  return { ...docs, ...overrides };
}

function dependencies(db) {
  return {
    db,
    HttpsError: FakeHttpsError,
    serverTimestamp: () => "server-timestamp",
    idFactory: (prefix) => `${prefix}-fixed`,
    nowISO: () => "2026-07-07T12:00:00.000Z",
    nowDate: () => new Date(2026, 6, 7, 12)
  };
}

function request(uid, data) {
  return {
    auth: uid
      ? { uid, token: { email: `${uid}@example.com` } }
      : null,
    data
  };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("rechaza crear cambio sin enlace activo", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerLinks/${UID_A}`]: undefined
  }));

  await rejectsWithCode(
    createWorkerSwapRequestHandler(
      request(UID_A, {
        workspaceId: WORKSPACE,
        targetUid: UID_B,
        ownDate: "2026-07-10",
        returnDate: "2026-07-15"
      }),
      dependencies(db)
    ),
    "permission-denied"
  );
});

test("rechaza cambios de trabajadores incompatibles", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerSwapCandidates/${UID_B}`]: {
      uid: UID_B,
      profileName: "Beto",
      status: "active",
      compatibleWorkerUids: [],
      blockedDayDates: [],
      days: {
        "2026-07-15": {
          label: "Noche",
          className: "noche"
        }
      }
    }
  }));

  await rejectsWithCode(
    createWorkerSwapRequestHandler(
      request(UID_A, {
        workspaceId: WORKSPACE,
        targetUid: UID_B,
        ownDate: "2026-07-10",
        returnDate: "2026-07-15"
      }),
      dependencies(db)
    ),
    "failed-precondition"
  );
});

test("rechaza crear cambio si el turno entregado ya paso", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerSwapCandidates/${UID_A}`]: {
      uid: UID_A,
      profileName: "Ana",
      status: "active",
      compatibleWorkerUids: [UID_B],
      blockedDayDates: [],
      days: {
        "2026-07-01": {
          label: "Larga",
          displayLabel: "Larga",
          className: "larga"
        }
      }
    },
    [`workspaces/${WORKSPACE}/workerSwapCandidates/${UID_B}`]: {
      uid: UID_B,
      profileName: "Beto",
      status: "active",
      compatibleWorkerUids: [UID_A],
      blockedDayDates: [],
      days: {
        "2026-07-01": {
          label: "Libre",
          displayLabel: "Libre",
          className: "libre"
        },
        "2026-07-15": {
          label: "Noche",
          displayLabel: "Noche",
          className: "noche"
        }
      }
    }
  }));

  await rejectsWithCode(
    createWorkerSwapRequestHandler(
      request(UID_A, {
        workspaceId: WORKSPACE,
        targetUid: UID_B,
        ownDate: "2026-07-01",
        returnDate: "2026-07-15"
      }),
      dependencies(db)
    ),
    "failed-precondition"
  );
});

test("rechaza crear cambio si receptor no esta libre para cubrir el turno", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerSwapCandidates/${UID_B}`]: {
      uid: UID_B,
      profileName: "Beto",
      status: "active",
      compatibleWorkerUids: [UID_A],
      blockedDayDates: [],
      days: {
        "2026-07-10": {
          label: "Larga",
          displayLabel: "Larga",
          className: "larga"
        },
        "2026-07-15": {
          label: "Noche",
          displayLabel: "Noche",
          className: "noche"
        }
      }
    }
  }));

  await rejectsWithCode(
    createWorkerSwapRequestHandler(
      request(UID_A, {
        workspaceId: WORKSPACE,
        targetUid: UID_B,
        ownDate: "2026-07-10",
        returnDate: "2026-07-15"
      }),
      dependencies(db)
    ),
    "failed-precondition"
  );
});

test("crea cambio directo con datos reconstruidos por servidor", async () => {
  const db = new FakeFirestore(baseDocuments());

  const result = await createWorkerSwapRequestHandler(
    request(UID_A, {
      workspaceId: WORKSPACE,
      targetUid: UID_B,
      ownDate: "2026-07-10",
      returnDate: "2026-07-15"
    }),
    dependencies(db)
  );
  const saved = db.data(
    `workspaces/${WORKSPACE}/workerSwapRequests/swap-fixed`
  );

  assert.equal(result.ok, true);
  assert.equal(result.requestId, "swap-fixed");
  assert.equal(saved.createdByUid, UID_A);
  assert.equal(saved.targetUid, UID_B);
  assert.equal(saved.from, "Ana");
  assert.equal(saved.to, "Beto");
  assert.equal(saved.status, "pending_colleague");
  assert.equal(saved.ownTurnLabel, "Larga");
  assert.equal(saved.returnTurnLabel, "Noche");
});

test("rechaza aceptar oferta abierta si receptor ya no esta libre", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerSwapCandidates/${UID_B}`]: {
      uid: UID_B,
      profileName: "Beto",
      status: "active",
      compatibleWorkerUids: [UID_A],
      blockedDayDates: [],
      days: {
        "2026-07-10": {
          label: "Larga",
          displayLabel: "Larga",
          className: "larga"
        },
        "2026-07-15": {
          label: "Noche",
          displayLabel: "Noche",
          className: "noche"
        }
      }
    },
    [`workspaces/${WORKSPACE}/workerSwapRequests/open-offer`]: {
      id: "open-offer",
      workspaceId: WORKSPACE,
      type: "open_swap",
      source: "worker_app",
      status: "pending_colleague",
      createdByUid: UID_A,
      targetUid: UID_B,
      fecha: "2026-07-10",
      ownTurnLabel: "Larga"
    }
  }));

  await rejectsWithCode(
    respondWorkerSwapRequestHandler(
      request(UID_B, {
        workspaceId: WORKSPACE,
        requestId: "open-offer",
        status: "colleague_accepted",
        returnDate: "2026-07-15"
      }),
      dependencies(db)
    ),
    "failed-precondition"
  );
});

test("acepta una oferta abierta validando devolucion en servidor", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerSwapRequests/open-offer`]: {
      id: "open-offer",
      workspaceId: WORKSPACE,
      type: "open_swap",
      source: "worker_app",
      status: "pending_colleague",
      createdByUid: UID_A,
      targetUid: UID_B,
      fecha: "2026-07-10",
      ownTurnLabel: "Larga"
    }
  }));

  const result = await respondWorkerSwapRequestHandler(
    request(UID_B, {
      workspaceId: WORKSPACE,
      requestId: "open-offer",
      status: "colleague_accepted",
      returnDate: "2026-07-15"
    }),
    dependencies(db)
  );
  const saved = db.data(
    `workspaces/${WORKSPACE}/workerSwapRequests/open-offer`
  );

  assert.equal(result.ok, true);
  assert.equal(saved.status, "colleague_accepted");
  assert.equal(saved.returnDate, "2026-07-15");
  assert.equal(saved.returnTurnLabel, "Noche");
  assert.equal(saved.notificationStatus, "accepted_by_colleague");
});
