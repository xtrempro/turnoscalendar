"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { cancelWorkerSwapHandler } = require("../workerSwapCancellation");

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
}

class FakeCollectionReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`);
  }

  where(field, operator, value) {
    return { kind: "query", collection: this, field, operator, value };
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

  querySnapshot(query) {
    assert.equal(query.operator, "==");
    const prefix = `${query.collection.path}/`;
    const docs = [];

    this.documents.forEach((value, path) => {
      const suffix = path.startsWith(prefix) ? path.slice(prefix.length) : "";
      if (!suffix || suffix.includes("/")) return;
      if (value?.[query.field] !== query.value) return;

      docs.push(this.snapshot(new FakeDocumentReference(this, path)));
    });

    return { docs };
  }

  async runTransaction(callback) {
    const transaction = {
      get: (target) => Promise.resolve(
        target?.kind === "query"
          ? this.querySnapshot(target)
          : this.snapshot(target)
      ),
      set: (ref, value, options = {}) => {
        const current = this.documents.get(ref.path) || {};
        this.documents.set(
          ref.path,
          options.merge ? { ...current, ...value } : value
        );
      }
    };

    return callback(transaction);
  }

  data(path) {
    return this.documents.get(path);
  }
}

const WORKSPACE = "workspace-a";
const UID = "worker-a";
const LINK_PATH = `workspaces/${WORKSPACE}/workerLinks/${UID}`;

function dependencies(db) {
  return {
    db,
    HttpsError: FakeHttpsError,
    serverTimestamp: () => "server-timestamp"
  };
}

function request(kind = "direct", requestId = "swap-a", uid = UID) {
  return {
    auth: uid ? { uid } : null,
    data: { workspaceId: WORKSPACE, kind, requestId }
  };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("rechaza una anulacion sin autenticacion", async () => {
  const db = new FakeFirestore();

  await rejectsWithCode(
    cancelWorkerSwapHandler(request("direct", "swap-a", ""), dependencies(db)),
    "unauthenticated"
  );
});

test("rechaza a un trabajador que ya no esta enlazado", async () => {
  const db = new FakeFirestore();

  await rejectsWithCode(
    cancelWorkerSwapHandler(request(), dependencies(db)),
    "permission-denied"
  );
});

test("impide anular el cambio creado por otro trabajador", async () => {
  const swapPath = `workspaces/${WORKSPACE}/workerSwapRequests/swap-a`;
  const db = new FakeFirestore({
    [LINK_PATH]: { status: "active" },
    [swapPath]: { createdByUid: "worker-b", status: "pending_colleague" }
  });

  await rejectsWithCode(
    cancelWorkerSwapHandler(request(), dependencies(db)),
    "permission-denied"
  );
  assert.equal(db.data(swapPath).status, "pending_colleague");
});

test("impide anular un cambio con estado final", async () => {
  const swapPath = `workspaces/${WORKSPACE}/workerSwapRequests/swap-a`;
  const db = new FakeFirestore({
    [LINK_PATH]: { status: "active" },
    [swapPath]: { createdByUid: UID, status: "supervisor_accepted" }
  });

  await rejectsWithCode(
    cancelWorkerSwapHandler(request(), dependencies(db)),
    "failed-precondition"
  );
  assert.equal(db.data(swapPath).status, "supervisor_accepted");
});

test("impide anular cuando el supervisor ya tomo una decision final", async () => {
  const swapPath = `workspaces/${WORKSPACE}/workerSwapRequests/swap-a`;
  const supervisorPath = `workspaces/${WORKSPACE}/workerRequests/supervisor-a`;
  const db = new FakeFirestore({
    [LINK_PATH]: { status: "active" },
    [swapPath]: {
      createdByUid: UID,
      status: "pending_supervisor",
      supervisorRequestId: "supervisor-a"
    },
    [supervisorPath]: { status: "accepted" }
  });

  await rejectsWithCode(
    cancelWorkerSwapHandler(request(), dependencies(db)),
    "failed-precondition"
  );
  assert.equal(db.data(swapPath).status, "pending_supervisor");
});

test("anula coordinadamente un cambio directo y su solicitud al supervisor", async () => {
  const swapPath = `workspaces/${WORKSPACE}/workerSwapRequests/swap-a`;
  const supervisorPath = `workspaces/${WORKSPACE}/workerRequests/supervisor-a`;
  const db = new FakeFirestore({
    [LINK_PATH]: { status: "active" },
    [swapPath]: {
      createdByUid: UID,
      status: "pending_supervisor",
      supervisorRequestId: "supervisor-a"
    },
    [supervisorPath]: { status: "pending" }
  });

  const result = await cancelWorkerSwapHandler(request(), dependencies(db));

  assert.deepEqual(result, {
    ok: true,
    requestId: "swap-a",
    kind: "direct",
    status: "canceled"
  });
  assert.equal(db.data(swapPath).status, "canceled");
  assert.equal(db.data(supervisorPath).status, "canceled");
  assert.equal(db.data(swapPath).canceledByUid, UID);
});

test("anula coordinadamente un cambio abierto y solo sus ofertas pendientes", async () => {
  const openPath = `workspaces/${WORKSPACE}/workerSwapOpenRequests/open-a`;
  const offersBase = `workspaces/${WORKSPACE}/workerSwapRequests`;
  const supervisorPath = `workspaces/${WORKSPACE}/workerRequests/supervisor-a`;
  const db = new FakeFirestore({
    [LINK_PATH]: { status: "active" },
    [openPath]: { createdByUid: UID, status: "assigned", winnerRequestId: "offer-a" },
    [`${offersBase}/offer-a`]: {
      groupId: "open-a",
      status: "pending_supervisor",
      supervisorRequestId: "supervisor-a"
    },
    [`${offersBase}/offer-b`]: { groupId: "open-a", status: "pending_colleague" },
    [`${offersBase}/offer-c`]: { groupId: "open-a", status: "superseded" },
    [supervisorPath]: { status: "pending" }
  });

  const result = await cancelWorkerSwapHandler(
    request("open", "open-a"),
    dependencies(db)
  );

  assert.equal(result.status, "canceled");
  assert.equal(db.data(openPath).status, "canceled");
  assert.equal(db.data(`${offersBase}/offer-a`).status, "canceled");
  assert.equal(db.data(`${offersBase}/offer-b`).status, "canceled");
  assert.equal(db.data(`${offersBase}/offer-c`).status, "superseded");
  assert.equal(db.data(supervisorPath).status, "canceled");
});
