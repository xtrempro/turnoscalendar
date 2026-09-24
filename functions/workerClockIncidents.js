"use strict";

const { randomBytes } = require("node:crypto");

const ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENT_FILES = 10;
const MAX_ATTACHMENT_TOTAL_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(
  ATTACHMENT_ACCEPT.split(",").map((extension) => extension.slice(1))
);
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function callableError(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function storageDownloadURL(bucketName, storagePath, token) {
  return [
    "https://firebasestorage.googleapis.com/v0/b/",
    encodeURIComponent(bucketName),
    "/o/",
    encodeURIComponent(storagePath),
    "?alt=media&token=",
    encodeURIComponent(token)
  ].join("");
}

function defaultIdFactory(prefix, uid) {
  const safeUid = safePathSegment(uid, "worker");
  return `${prefix}_${safeUid}_${Date.now()}_${randomBytes(5).toString("hex")}`;
}

function defaultNowISO(nowDate = () => new Date()) {
  return nowDate().toISOString();
}

function fileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function safePathSegment(value, fallback = "item") {
  const clean = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return clean || fallback;
}

function idSafe(value) {
  return cleanText(value, 220).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeISODate(value) {
  const clean = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : "";
}

function parseISODateParts(value) {
  const iso = normalizeISODate(value);
  if (!iso) return null;

  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { iso, year, monthIndex: month - 1, day };
}

function normalizeTime(value) {
  const clean = cleanText(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(clean) ? clean : "";
}

function extensionForMime(type) {
  return Object.entries(MIME_BY_EXTENSION)
    .find(([, mime]) => mime === type)?.[0] || "";
}

function contentTypeFor(name, type) {
  const cleanType = cleanText(type, 160).toLowerCase();
  const extension = fileExtension(name);

  if (ALLOWED_MIME_TYPES.has(cleanType)) return cleanType;
  if (ALLOWED_EXTENSIONS.has(extension)) {
    return MIME_BY_EXTENSION[extension] || "application/octet-stream";
  }

  return "";
}

function decodeAttachment(file, HttpsError) {
  const name = cleanText(file?.name, 180);
  const dataUrl = String(file?.dataUrl || "");
  const base64Value = String(file?.base64 || "");
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/s);
  const base64 = (match ? match[2] : base64Value).replace(/\s/g, "");
  const dataUrlType = cleanText(match?.[1], 160).toLowerCase();
  const contentType = contentTypeFor(name, dataUrlType || file?.type);

  if (!name || !base64 || !contentType) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Uno de los adjuntos no tiene un formato permitido."
    );
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch (error) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No se pudo leer uno de los adjuntos."
    );
  }

  if (!buffer.length || buffer.length > MAX_ATTACHMENT_SIZE) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Cada adjunto debe pesar hasta 10 MB."
    );
  }

  return {
    buffer,
    contentType,
    originalName: name,
    safeName: safePathSegment(
      name,
      `adjunto.${fileExtension(name) || extensionForMime(contentType) || "bin"}`
    )
  };
}

function validateBasePayload(request, HttpsError) {
  const uid = request.auth?.uid || "";

  if (!uid) {
    callableError(
      HttpsError,
      "unauthenticated",
      "Debes iniciar sesion para enviar la incidencia de marcaje."
    );
  }

  const workspaceId = cleanText(request.data?.workspaceId, 160);

  if (!workspaceId) {
    callableError(
      HttpsError,
      "invalid-argument",
      "No fue posible identificar la unidad."
    );
  }

  return { uid, workspaceId };
}

async function readRequiredWorkerLink(workspaceRef, uid, HttpsError) {
  const snap = await workspaceRef.collection("workerLinks").doc(uid).get();

  if (!snap.exists) {
    callableError(
      HttpsError,
      "permission-denied",
      "Tu cuenta ya no esta enlazada con esta unidad."
    );
  }

  return snap.data() || {};
}

async function readWorkerAppData(workspaceRef, uid) {
  const snap = await workspaceRef.collection("workerAppData").doc(uid).get();
  return snap.exists ? snap.data() || {} : {};
}

async function uploadAttachments({
  bucket,
  files,
  workspaceId,
  uid,
  requestId,
  createdAt,
  HttpsError,
  attachmentIdFactory = () => `attachment_${randomBytes(8).toString("hex")}`
}) {
  if (!files.length) return [];

  if (!bucket) {
    callableError(
      HttpsError,
      "failed-precondition",
      "El almacenamiento de adjuntos no esta disponible."
    );
  }

  let totalSize = 0;
  const decodedFiles = files.map((file) => {
    const decoded = decodeAttachment(file, HttpsError);
    totalSize += decoded.buffer.length;
    return decoded;
  });

  if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Los adjuntos no pueden superar 10 MB en total."
    );
  }

  const ownerId = safePathSegment(uid, "worker");
  const recordId = safePathSegment(requestId, "clock_incident");
  const documents = [];

  for (const decoded of decodedFiles) {
    const id = attachmentIdFactory();
    const downloadToken = randomBytes(24).toString("hex");
    const storagePath = [
      "workspaces",
      safePathSegment(workspaceId, "workspace"),
      "attachments",
      "clockmarks",
      ownerId,
      recordId,
      `${safePathSegment(id, "attachment")}_${decoded.safeName}`
    ].join("/");

    await bucket.file(storagePath).save(decoded.buffer, {
      resumable: false,
      metadata: {
        contentType: decoded.contentType,
        metadata: {
          workspaceId,
          moduleId: "clockmarks",
          ownerId,
          recordId,
          uploadedByUid: uid,
          originalName: decoded.originalName,
          firebaseStorageDownloadTokens: downloadToken
        }
      }
    });

    documents.push({
      id,
      name: decoded.originalName,
      type: decoded.contentType,
      size: decoded.buffer.length,
      addedAt: createdAt,
      uploadedByUid: uid,
      storagePath,
      downloadURL: storageDownloadURL(bucket.name, storagePath, downloadToken)
    });
  }

  return documents;
}

async function createWorkerClockIncidentRequestHandler(request, dependencies) {
  const {
    db,
    HttpsError,
    serverTimestamp,
    storageBucket,
    idFactory = defaultIdFactory,
    nowISO = defaultNowISO,
    nowDate = () => new Date(),
    attachmentIdFactory
  } = dependencies;
  const { uid, workspaceId } = validateBasePayload(request, HttpsError);
  const date = normalizeISODate(request.data?.date);
  const missingEntry = request.data?.missingEntry === true;
  const missingExit = request.data?.missingExit === true;
  const entryTime = missingEntry ? "" : normalizeTime(request.data?.entryTime);
  const exitTime = missingExit ? "" : normalizeTime(request.data?.exitTime);
  const files = Array.isArray(request.data?.files)
    ? request.data.files.slice(0, MAX_ATTACHMENT_FILES + 1)
    : [];

  if (!parseISODateParts(date)) {
    callableError(
      HttpsError,
      "invalid-argument",
      "La fecha de la incidencia no es valida."
    );
  }

  if (files.length > MAX_ATTACHMENT_FILES) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Puedes adjuntar hasta 10 archivos."
    );
  }

  if (!missingEntry && !entryTime && !missingExit && !exitTime) {
    callableError(
      HttpsError,
      "invalid-argument",
      "Ingresa una hora o marca la entrada/salida como sin marcaje."
    );
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const [link, appData] = await Promise.all([
    readRequiredWorkerLink(workspaceRef, uid, HttpsError),
    readWorkerAppData(workspaceRef, uid)
  ]);
  const requestId =
    idSafe(request.data?.requestId) ||
    idFactory("clock_incident", uid);
  const createdAt = cleanText(request.data?.createdAt, 40) ||
    nowISO(nowDate);
  const profileName = cleanText(
    link.profileName || appData.profileName || "Trabajador",
    180
  );
  const profileRut = cleanText(link.profileRut || appData.profileRut || "", 80);
  const createdByEmail = cleanText(
    request.auth?.token?.email || link.workerEmail || appData.workerEmail || "",
    254
  );
  const requestRef = workspaceRef
    .collection("workerRequests")
    .doc(requestId);
  const existingRequest = await requestRef.get();

  if (existingRequest.exists) {
    callableError(
      HttpsError,
      "already-exists",
      "Esta incidencia ya fue enviada."
    );
  }

  const documents = await uploadAttachments({
    bucket: storageBucket ? storageBucket() : null,
    files,
    workspaceId,
    uid,
    requestId,
    createdAt,
    HttpsError,
    attachmentIdFactory
  });
  const note = cleanText(
    request.data?.note || "Incidencia informada por trabajador.",
    2000
  );
  const now = serverTimestamp();
  const requestData = {
    id: requestId,
    workspaceId,
    type: "clock_incident",
    source: "worker_app",
    channel: "app",
    status: "pending",
    profile: profileName,
    profileRut,
    worker: profileName,
    date,
    ...(entryTime ? { entryTime } : {}),
    ...(exitTime ? { exitTime } : {}),
    ...(missingEntry ? { missingEntry: true } : {}),
    ...(missingExit ? { missingExit: true } : {}),
    shiftLabel: cleanText(request.data?.shiftLabel, 80),
    note,
    detail: note,
    documents,
    createdAt,
    updatedAt: now,
    createdByUid: uid,
    createdByEmail
  };

  if (typeof requestRef.create === "function") {
    await requestRef.create(requestData);
  } else {
    await requestRef.set(requestData, { merge: false });
  }

  return {
    ok: true,
    requestId,
    documents,
    request: {
      ...requestData,
      updatedAt: createdAt
    }
  };
}

module.exports = {
  createWorkerClockIncidentRequestHandler,
  _private: {
    ATTACHMENT_ACCEPT,
    MAX_ATTACHMENT_FILES,
    MAX_ATTACHMENT_SIZE,
    MAX_ATTACHMENT_TOTAL_SIZE,
    contentTypeFor,
    normalizeISODate,
    normalizeTime,
    parseISODateParts
  }
};
