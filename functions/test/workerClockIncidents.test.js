"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkerClockIncidentRequestHandler
} = require("../workerClockIncidents");

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

  create(value) {
    if (this.db.documents.has(this.path)) {
      return Promise.reject(new Error("already exists"));
    }

    this.db.setData(this.path, value);
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

  data(path) {
    return this.documents.get(path);
  }
}

class FakeBucket {
  constructor() {
    this.name = "test-bucket";
    this.uploads = [];
  }

  file(path) {
    return {
      save: async (buffer, options) => {
        this.uploads.push({ path, buffer, options });
      }
    };
  }
}

const WORKSPACE = "workspace-a";
const UID = "worker-a";

function baseDocuments(overrides = {}) {
  return {
    [`workspaces/${WORKSPACE}/workerLinks/${UID}`]: {
      uid: UID,
      workspaceId: WORKSPACE,
      profileName: "Ana Perez",
      profileRut: "12.345.678-9",
      workerEmail: "ana@example.com",
      status: "active"
    },
    ...overrides
  };
}

function dependencies(db, bucket = new FakeBucket()) {
  return {
    db,
    HttpsError: FakeHttpsError,
    serverTimestamp: () => "server-timestamp",
    storageBucket: () => bucket,
    idFactory: () => "clock-fixed",
    attachmentIdFactory: () => "attachment-fixed",
    nowISO: () => "2026-08-01T12:00:00.000Z",
    nowDate: () => new Date(2026, 7, 1, 12)
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

test("crea solicitud de incidencia de marcaje con adjunto en Storage", async () => {
  const db = new FakeFirestore(baseDocuments());
  const bucket = new FakeBucket();
  const dataUrl = `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`;

  const result = await createWorkerClockIncidentRequestHandler(
    request(UID, {
      workspaceId: WORKSPACE,
      requestId: "clock-123",
      date: "2026-08-01",
      entryTime: "08:05",
      missingExit: true,
      note: "Olvide marcar salida.",
      files: [
        {
          name: "respaldo.png",
          type: "image/png",
          size: 10,
          dataUrl
        }
      ]
    }),
    dependencies(db, bucket)
  );

  assert.equal(result.ok, true);
  assert.equal(result.requestId, "clock-123");
  assert.equal(bucket.uploads.length, 1);
  assert.match(
    bucket.uploads[0].path,
    /workspaces\/workspace-a\/attachments\/clockmarks\/worker-a\/clock-123\/attachment-fixed_respaldo\.png/
  );
  assert.equal(
    bucket.uploads[0].options.metadata.metadata.moduleId,
    "clockmarks"
  );
  assert.match(
    bucket.uploads[0].options.metadata.metadata.firebaseStorageDownloadTokens,
    /^[a-f0-9]{48}$/
  );

  const stored = db.data(
    `workspaces/${WORKSPACE}/workerRequests/clock-123`
  );
  assert.equal(stored.type, "clock_incident");
  assert.equal(stored.status, "pending");
  assert.equal(stored.profile, "Ana Perez");
  assert.equal(stored.profileRut, "12.345.678-9");
  assert.equal(stored.date, "2026-08-01");
  assert.equal(stored.entryTime, "08:05");
  assert.equal(stored.missingExit, true);
  assert.equal(stored.documents.length, 1);
  assert.equal(stored.documents[0].name, "respaldo.png");
  assert.equal(stored.documents[0].storagePath, bucket.uploads[0].path);
  assert.match(
    stored.documents[0].downloadURL,
    /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/test-bucket\/o\/.+\?alt=media&token=[a-f0-9]{48}$/
  );
});

test("rechaza incidencia sin sesion autenticada", async () => {
  const db = new FakeFirestore(baseDocuments());

  await rejectsWithCode(
    createWorkerClockIncidentRequestHandler(
      request("", {
        workspaceId: WORKSPACE,
        date: "2026-08-01",
        entryTime: "08:05"
      }),
      dependencies(db)
    ),
    "unauthenticated"
  );
});

test("rechaza incidencia si el trabajador no esta enlazado", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerLinks/${UID}`]: undefined
  }));

  await rejectsWithCode(
    createWorkerClockIncidentRequestHandler(
      request(UID, {
        workspaceId: WORKSPACE,
        date: "2026-08-01",
        entryTime: "08:05"
      }),
      dependencies(db)
    ),
    "permission-denied"
  );
});

test("rechaza sobrescribir una solicitud existente", async () => {
  const db = new FakeFirestore(baseDocuments({
    [`workspaces/${WORKSPACE}/workerRequests/clock-123`]: {
      id: "clock-123",
      createdByUid: "otro-uid"
    }
  }));

  await rejectsWithCode(
    createWorkerClockIncidentRequestHandler(
      request(UID, {
        workspaceId: WORKSPACE,
        requestId: "clock-123",
        date: "2026-08-01",
        entryTime: "08:05"
      }),
      dependencies(db)
    ),
    "already-exists"
  );
});
