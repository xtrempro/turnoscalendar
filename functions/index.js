const admin = require("firebase-admin");
const { createHash, randomBytes } = require("node:crypto");
const logger = require("firebase-functions/logger");
const { setGlobalOptions } = require("firebase-functions/v2");
const {
  onDocumentCreated,
  onDocumentUpdated
} = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  defineSecret,
  defineString
} = require("firebase-functions/params");
const { cancelWorkerSwapHandler } = require("./workerSwapCancellation");
const {
  chooseWorkerSwapProposalHandler,
  createWorkerSwapOpenRequestHandler,
  createWorkerSwapRequestHandler,
  respondWorkerSwapRequestHandler
} = require("./workerSwapRequests");
const {
  createWorkerClockIncidentRequestHandler
} = require("./workerClockIncidents");
const {
  createWorkerMedicalEquipmentReportHandler
} = require("./medicalEquipmentReports");
const {
  findCompatibleReplacementCandidates
} = require("./linkedReplacementSearch");
const {
  advanceAutoCoverageCampaigns
} = require("./autoCoverageScheduler");
const {
  memberCanManageRequests,
  memberCanReadWorkerCalendar,
  memberHasExplicitAccess
} = require("./authorization");
const { resolveBillingAccountUid } = require("./billingAccount");
const {
  WebpayPlus,
  Options: TbkOptions,
  IntegrationApiKeys,
  IntegrationCommerceCodes,
  Environment: TbkEnvironment
} = require("transbank-sdk");

// API key de Resend. Configurar con: firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
// Remitente verificado en Resend. Para produccion, verificar un dominio propio
// y usar algo como "TurnoPlus <noreply@tudominio.cl>". Configurable en
// functions/.env (MAIL_FROM=...). Por defecto usa el remitente de pruebas de
// Resend, que solo entrega a la propia cuenta del API key.
const MAIL_FROM = defineString("MAIL_FROM", {
  default: "TurnoPlus <onboarding@resend.dev>"
});
// TurnoPlus, la PWA y TurnoPlus Test tienen proveedor App Check registrado.
// Todos los endpoints callable deben rechazar clientes sin token valido.
const ENFORCE_APP_CHECK = true;
// Capacidad preparada pero apagada durante el lanzamiento comercial. Activar
// solo junto al enrolamiento del cliente y las reglas del entorno objetivo.
const REQUIRE_PRIVILEGED_MFA = false;
// Flujo preparado para centros que pidan doble chequeo por correo en la PWA.
// En etapa comercial queda apagado: el correo de invitacion lleva directamente
// al token de enlace y la PWA no debe mandar un segundo correo passwordless.
const WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED = false;

admin.initializeApp();
setGlobalOptions({
  region: "southamerica-west1",
  // Evita que una ráfaga de eventos dispare instancias sin límite y eleve
  // innecesariamente el costo o el impacto de un abuso.
  maxInstances: 10,
  // Los preflight CORS deben alcanzar el runtime de Firebase. La autorizacion
  // real de los callable se mantiene en Auth + App Check dentro del runtime.
  invoker: "public"
});
Object.assign(exports, require("./getAccountsAndUnits"));
// Dashboard RRHH: agregación de métricas e imputación de costo de préstamos.
Object.assign(exports, require("./getRrhhDashboard"));
Object.assign(exports, require("./attributeInterUnitCost"));
// Dashboard RRHH: enlace director↔unidades (admin arma cada dashboard).
Object.assign(exports, require("./rrhhDashboards"));
// Proyección del worker-app en el servidor (reemplaza el pipeline del navegador).
Object.assign(exports, require("./workerAppProjection"));

const db = admin.firestore();
const WORKER_APP_BASE_URL = process.env.GCLOUD_PROJECT === "turnoplus-test-7c4d9"
  ? "https://turnoplusfunc-test.web.app/"
  : "https://turnoplusfuncionarios.web.app/";
const PROTURNOS_APP_BASE_URL = process.env.GCLOUD_PROJECT === "turnoplus-test-7c4d9"
  ? "https://turnoplus-test-7c4d9.firebaseapp.com/"
  : "https://calendarioturnos-7c4d9.firebaseapp.com/";
const DEFAULT_MAIL_FROM = "TurnoPlus <onboarding@resend.dev>";
const APP_URL = `${WORKER_APP_BASE_URL}?screen=solicitudes`;
const SWAPS_APP_URL = `${WORKER_APP_BASE_URL}?screen=cambios`;
const APP_ICON = `${WORKER_APP_BASE_URL}img/logo-turnoplus.png`;
// El badge de Android se pinta como SILUETA a partir del canal alfa: debe ser
// un PNG monocromo con transparencia. Si se apunta a un icono a color y opaco
// (p.ej. favicon-turnoplus-calendar.png, 512x512 sin alfa), Android lo dibuja
// como un cuadrado blanco. badge-calendar.png es 96x96, monocromo y 71% alfa.
const APP_BADGE = `${WORKER_APP_BASE_URL}img/badge-calendar.png`;
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);
const VALID_INTER_UNIT_TURNS = new Set([
  "L",
  "N",
  "24",
  "D",
  "D+N",
  "HM",
  "HT",
  "18"
]);
const SUPERVISOR_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SUPERVISOR_INVITE_REVOKED_HISTORY_LIMIT = 3;
const SUPERVISOR_INVITE_EXPIRED_HISTORY_LIMIT = 5;
const MENU_PERMISSION_KEYS = [
  "turnos",
  "weekly",
  "tasks",
  "informations",
  "medicalEquipment",
  "kanban",
  "agenda",
  "profile",
  "qualifications",
  "clockmarks",
  "requests",
  "memos",
  "swap",
  "hours",
  "reports",
  "dashboard",
  "log"
];
const LEGACY_FULL_ADMIN_PERMISSION_KEYS = MENU_PERMISSION_KEYS
  .filter(key => !["informations", "medicalEquipment", "qualifications"].includes(key));
const SCHEDULE_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;
const SCHEDULE_OCR_MAX_TEXT_LENGTH = 30000;
const SCHEDULE_OCR_TIMEOUT_MS = 20000;
const SCHEDULE_OCR_MAX_WORDS = 900;
const VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";
const SCHEDULE_ATTACHMENT_MODULE_ID = "tasks";
const SCHEDULE_ATTACHMENT_OWNER_ID = "weekly-schedule";
const SCHEDULE_ATTACHMENT_RECORD_ID = "published-schedule";
const INFORMATION_ATTACHMENT_MODULE_ID = "informations";
const INFORMATION_ATTACHMENT_OWNER_ID = "published";
const INFORMATION_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;
const MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID = "medicalEquipment";
const QUALIFICATION_ATTACHMENT_MODULE_ID = "qualifications";
const SCHEDULE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif"
]);
const SCHEDULE_IMAGE_MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif"
};
const INFORMATION_ATTACHMENT_MIME_TYPES = new Set([
  ...SCHEDULE_IMAGE_MIME_TYPES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const INFORMATION_ATTACHMENT_MIME_BY_EXTENSION = {
  ...SCHEDULE_IMAGE_MIME_BY_EXTENSION,
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function cleanCallableText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanManifestParam(value, pattern, maxLength) {
  const clean = String(value || "").trim().slice(0, maxLength);
  return pattern.test(clean) ? clean : "";
}

function hasLegacyFullAdminPermissions(source = {}) {
  return LEGACY_FULL_ADMIN_PERMISSION_KEYS.every(key =>
    source?.[key]?.view === true && source?.[key]?.edit === true
  );
}

function normalizeSupervisorPermissions(input = {}) {
  const source = input && typeof input === "object" ? input : {};

  return MENU_PERMISSION_KEYS.reduce((permissions, key) => {
    const hasExplicitPermission = Object.prototype.hasOwnProperty.call(
      source,
      key
    );
    const raw = hasExplicitPermission ? source[key] || {} : {};
    const enabledByDefault =
      !hasExplicitPermission &&
      (
        key === INFORMATION_ATTACHMENT_MODULE_ID ||
        (
          key === MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID &&
          hasLegacyFullAdminPermissions(source)
        ) ||
        (
          key === "qualifications" &&
          hasLegacyFullAdminPermissions(source)
        )
      );
    const view = enabledByDefault || raw.view === true;

    permissions[key] = {
      view,
      edit: view && (enabledByDefault || raw.edit === true)
    };

    return permissions;
  }, {});
}

function hasAnyPermission(permissions = {}) {
  return MENU_PERMISSION_KEYS.some(key =>
    permissions[key]?.view === true || permissions[key]?.edit === true
  );
}

function memberCanPublishInformations(member = {}) {
  if (member.role === "owner") return true;

  const permissions = member.permissions && typeof member.permissions === "object"
    ? member.permissions
    : {};

  if (permissions.informations?.edit === true) return true;

  return !Object.prototype.hasOwnProperty.call(permissions, "informations");
}

function memberCanPublishQualifications(member = {}) {
  if (member.role === "owner") return true;

  const permissions = member.permissions && typeof member.permissions === "object"
    ? member.permissions
    : {};

  if (permissions.qualifications?.edit === true) return true;
  if (Object.prototype.hasOwnProperty.call(permissions, "qualifications")) {
    return false;
  }

  return hasLegacyFullAdminPermissions(permissions);
}

function memberCanPublishMedicalEquipment(member = {}) {
  if (member.role === "owner") return true;

  const permissions = member.permissions && typeof member.permissions === "object"
    ? member.permissions
    : {};

  if (permissions.medicalEquipment?.edit === true) return true;
  if (Object.prototype.hasOwnProperty.call(permissions, "medicalEquipment")) {
    return false;
  }

  return hasLegacyFullAdminPermissions(permissions);
}

function createSupervisorInviteToken() {
  return randomBytes(32).toString("base64url");
}

function supervisorInviteIdFromToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function validISODate(value) {
  const text = String(value || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;

  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text;
}

function memberRequiresMfa(member = {}) {
  const permissions = member.permissions || {};

  return member.role === "owner" ||
    Object.values(permissions).some(permission =>
      permission?.edit === true
    );
}

function tokenHasMfa(token = {}) {
  return Boolean(token.firebase?.sign_in_second_factor);
}

function requireMemberMfa(member, token) {
  if (
    REQUIRE_PRIVILEGED_MFA &&
    memberRequiresMfa(member) &&
    !tokenHasMfa(token)
  ) {
    throw new HttpsError(
      "permission-denied",
      "Los propietarios y supervisores deben validar TOTP para continuar."
    );
  }
}

async function requireWorkspaceRequestManager(
  workspaceId,
  uid,
  token
) {
  const memberSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get();

  if (!memberSnap.exists || !memberCanManageRequests(memberSnap.data())) {
    throw new HttpsError(
      "permission-denied",
      "No tienes permisos para gestionar prestamos en esta unidad."
    );
  }

  const member = memberSnap.data();

  requireMemberMfa(member, token);
  return member;
}

async function requireWorkspaceMember(workspaceId, uid, token) {
  const memberSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get();

  if (
    !memberSnap.exists ||
    !memberHasExplicitAccess(memberSnap.data() || {})
  ) {
    throw new HttpsError(
      "permission-denied",
      "No perteneces a la unidad solicitante."
    );
  }

  const member = memberSnap.data();

  requireMemberMfa(member, token);
  return member;
}

async function requireWorkspaceOwner(workspaceId, uid, token) {
  const member = await requireWorkspaceMember(workspaceId, uid, token);

  if (member.role !== "owner") {
    throw new HttpsError(
      "permission-denied",
      "Solo el propietario puede administrar invitaciones de supervisor."
    );
  }

  return member;
}

async function requireWorkspaceInformationPublisher(workspaceId, uid, token) {
  const member = await requireWorkspaceMember(workspaceId, uid, token);

  if (!memberCanPublishInformations(member)) {
    throw new HttpsError(
      "permission-denied",
      "No tienes permisos para publicar informaciones en esta unidad."
    );
  }

  return member;
}

async function requireWorkspaceQualificationPublisher(workspaceId, uid, token) {
  const member = await requireWorkspaceMember(workspaceId, uid, token);

  if (!memberCanPublishQualifications(member)) {
    throw new HttpsError(
      "permission-denied",
      "No tienes permisos para adjuntar calificaciones en esta unidad."
    );
  }

  return member;
}

async function requireWorkspaceMedicalEquipmentPublisher(workspaceId, uid, token) {
  const member = await requireWorkspaceMember(workspaceId, uid, token);

  if (!memberCanPublishMedicalEquipment(member)) {
    throw new HttpsError(
      "permission-denied",
      "No tienes permisos para administrar equipos medicos en esta unidad."
    );
  }

  return member;
}

function scheduleFileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function safeStoragePathSegment(value, fallback = "item") {
  const clean = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return clean || fallback;
}

function normalizeScheduleImageType(type) {
  const clean = cleanCallableText(type, 160).toLowerCase();

  return clean === "image/jpg" || clean === "image/pjpeg"
    ? "image/jpeg"
    : clean;
}

function scheduleContentTypeFor(name, type) {
  const cleanType = normalizeScheduleImageType(type);
  const extension = scheduleFileExtension(name);

  if (SCHEDULE_IMAGE_MIME_TYPES.has(cleanType)) return cleanType;
  return SCHEDULE_IMAGE_MIME_BY_EXTENSION[extension] || "";
}

function normalizeInformationAttachmentType(type) {
  const clean = cleanCallableText(type, 160)
    .toLowerCase()
    .split(";")[0]
    .trim();

  return clean === "image/jpg" || clean === "image/pjpeg"
    ? "image/jpeg"
    : clean;
}

function informationContentTypeFor(name, ...types) {
  const extension = scheduleFileExtension(name);

  for (const type of types) {
    const cleanType = normalizeInformationAttachmentType(type);

    if (INFORMATION_ATTACHMENT_MIME_TYPES.has(cleanType)) {
      return cleanType;
    }
  }

  return INFORMATION_ATTACHMENT_MIME_BY_EXTENSION[extension] || "";
}

function decodeScheduleAttachmentPayload(data = {}) {
  const name = cleanCallableText(data.name || "programacion.jpg", 180);
  const dataUrl = String(data.dataUrl || "");
  const base64Value = String(data.base64 || "");
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/s);
  const base64 = (match ? match[2] : base64Value).replace(/\s/g, "");
  const dataUrlType = normalizeScheduleImageType(match?.[1]);
  const contentType = scheduleContentTypeFor(name, dataUrlType || data.type);

  if (!name || !base64 || !contentType) {
    throw new HttpsError(
      "invalid-argument",
      "La programacion debe adjuntarse como imagen."
    );
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new HttpsError(
      "invalid-argument",
      "No se pudo leer la imagen adjunta."
    );
  }

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length || buffer.length > SCHEDULE_ATTACHMENT_MAX_SIZE) {
    throw new HttpsError(
      "invalid-argument",
      "La imagen debe pesar hasta 10 MB."
    );
  }

  return {
    buffer,
    contentType,
    originalName: name,
    safeName: safeStoragePathSegment(
      name,
      `programacion.${scheduleFileExtension(name) || "jpg"}`
    )
  };
}

function decodeInformationAttachmentPayload(data = {}) {
  const name = cleanCallableText(data.name || "informacion", 180);
  const dataUrl = String(data.dataUrl || "");
  const base64Value = String(data.base64 || "");
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/s);
  const base64 = (match ? match[2] : base64Value).replace(/\s/g, "");
  const contentType = informationContentTypeFor(name, match?.[1], data.type);

  if (!name || !base64 || !contentType) {
    throw new HttpsError(
      "invalid-argument",
      "Adjunta una imagen, PDF, texto, Word o Excel valido."
    );
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new HttpsError(
      "invalid-argument",
      "No se pudo leer el archivo adjunto."
    );
  }

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length || buffer.length > INFORMATION_ATTACHMENT_MAX_SIZE) {
    throw new HttpsError(
      "invalid-argument",
      "El archivo debe pesar hasta 10 MB."
    );
  }

  return {
    buffer,
    contentType,
    originalName: name,
    safeName: safeStoragePathSegment(
      name,
      `informacion.${scheduleFileExtension(name) || "bin"}`
    )
  };
}

function isInformationAttachmentStoragePath(workspaceId, storagePath) {
  const parts = String(storagePath || "").split("/");

  return parts.length === 7 &&
    parts[0] === "workspaces" &&
    parts[1] === safeStoragePathSegment(workspaceId, "workspace") &&
    parts[2] === "attachments" &&
    parts[3] === INFORMATION_ATTACHMENT_MODULE_ID &&
    parts[4] === INFORMATION_ATTACHMENT_OWNER_ID &&
    Boolean(parts[5]) &&
    Boolean(parts[6]);
}

function isQualificationAttachmentStoragePath(workspaceId, storagePath) {
  const parts = String(storagePath || "").split("/");

  return parts.length === 7 &&
    parts[0] === "workspaces" &&
    parts[1] === safeStoragePathSegment(workspaceId, "workspace") &&
    parts[2] === "attachments" &&
    parts[3] === QUALIFICATION_ATTACHMENT_MODULE_ID &&
    Boolean(parts[4]) &&
    Boolean(parts[5]) &&
    Boolean(parts[6]);
}

function isMedicalEquipmentAttachmentStoragePath(workspaceId, storagePath) {
  const parts = String(storagePath || "").split("/");

  return parts.length === 7 &&
    parts[0] === "workspaces" &&
    parts[1] === safeStoragePathSegment(workspaceId, "workspace") &&
    parts[2] === "attachments" &&
    parts[3] === MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID &&
    Boolean(parts[4]) &&
    Boolean(parts[5]) &&
    Boolean(parts[6]);
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

let visionAuthClientPromise = null;

function cleanScheduleOcrText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, SCHEDULE_OCR_MAX_TEXT_LENGTH);
}

function scheduleOcrBaseStatus(status, requestedAtISO) {
  return {
    status,
    engine: "google-cloud-vision",
    source: "automatic_upload",
    reviewRequired: false,
    requestedAtISO,
    extractedAtISO: "",
    text: "",
    textLength: 0,
    truncated: false,
    error: "",
    // Geometria del OCR: cada palabra con su caja normalizada (0..1000 por eje)
    // para reconstruir la grilla fila x dia en la PWA. Vacio si no hay layout.
    words: []
  };
}

// Extrae las palabras del OCR con su posicion (bounding box) normalizada a
// 0..1000 en cada eje, a partir de fullTextAnnotation de Vision.
function extractScheduleOcrWords(annotation) {
  const page = annotation?.fullTextAnnotation?.pages?.[0];
  if (!page) return [];

  const pw = Number(page.width) || 0;
  const ph = Number(page.height) || 0;
  if (!pw || !ph) return [];

  const norm = (v, size) => {
    const n = Math.round((Number(v) / size) * 1000);
    return n < 0 ? 0 : (n > 1000 ? 1000 : n);
  };

  const words = [];
  for (const block of page.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const word of para.words || []) {
        const text = (word.symbols || [])
          .map((s) => s.text || "")
          .join("")
          .trim();
        if (!text) continue;

        const verts = word.boundingBox?.vertices || [];
        if (verts.length < 2) continue;

        const xs = verts.map((v) => Number(v.x) || 0);
        const ys = verts.map((v) => Number(v.y) || 0);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        words.push({
          t: text.slice(0, 60),
          x: norm(minX, pw),
          y: norm(minY, ph),
          w: norm(maxX - minX, pw),
          h: norm(maxY - minY, ph)
        });

        if (words.length >= SCHEDULE_OCR_MAX_WORDS) return words;
      }
    }
  }

  return words;
}

async function getVisionAuthClient() {
  if (!visionAuthClientPromise) {
    const { GoogleAuth } = require("google-auth-library");

    visionAuthClientPromise = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    }).getClient();
  }

  return visionAuthClientPromise;
}

async function automaticScheduleImageOcr(decoded, context = {}) {
  const requestedAtISO = new Date().toISOString();
  const base = scheduleOcrBaseStatus("failed", requestedAtISO);

  try {
    const authClient = await getVisionAuthClient();
    const accessToken = await authClient.getAccessToken();
    const token = typeof accessToken === "string"
      ? accessToken
      : accessToken?.token;

    if (!token) {
      throw new Error("No se pudo obtener token para OCR.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCHEDULE_OCR_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(VISION_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: decoded.buffer.toString("base64")
              },
              features: [
                {
                  type: "DOCUMENT_TEXT_DETECTION",
                  maxResults: 1
                }
              ],
              imageContext: {
                languageHints: ["es"]
              }
            }
          ]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Vision OCR ${response.status}: ${cleanCallableText(body, 240)}`
      );
    }

    const body = await response.json();
    const annotation = body?.responses?.[0] || {};

    if (annotation.error) {
      throw new Error(
        cleanCallableText(
          annotation.error.message || annotation.error.code,
          240
        )
      );
    }

    const rawText =
      annotation.fullTextAnnotation?.text ||
      annotation.textAnnotations?.[0]?.description ||
      "";
    const text = cleanScheduleOcrText(rawText);
    const textLength = String(rawText || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u0000/g, "")
      .trim()
      .length;

    return {
      ...scheduleOcrBaseStatus(text ? "completed" : "empty", requestedAtISO),
      extractedAtISO: new Date().toISOString(),
      text,
      textLength,
      truncated: textLength > text.length,
      words: extractScheduleOcrWords(annotation)
    };
  } catch (error) {
    logger.warn("No se pudo ejecutar OCR automatico de programacion.", {
      workspaceId: context.workspaceId,
      storagePath: context.storagePath,
      errorMessage: cleanCallableText(error?.message || error?.code, 240),
      errorCode: cleanCallableText(error?.code, 80)
    });

    return {
      ...base,
      error: cleanCallableText(
        error?.message || "No se pudo ejecutar OCR automatico.",
        240
      )
    };
  }
}

const SCHEDULE_MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const SCHEDULE_TEXT_NORM = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Modelo de hoja para el parser (celdas por dirección + rangos combinados).
// cell.text da el texto ya formateado (no el objeto crudo de valor).
function worksheetToScheduleSheetModel(ws) {
  const cells = {};

  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cell.text;
      if (text != null && String(text).trim() !== "") {
        cells[cell.address] = String(text);
      }
    });
  });

  return {
    cells,
    merges: (ws.model && ws.model.merges) || [],
    maxRow: ws.rowCount || 0,
    maxCol: ws.columnCount || 0
  };
}

// Elige la hoja de la semana pedida (por día + mes en el título, p. ej.
// "17 AL 23 DE AGOSTO"). Si el libro trae una sola hoja, la usa; si no hay
// coincidencia, cae a la última con datos (la más reciente).
// Busca la hoja de esa semana por su nombre: tiene que traer el dia Y el mes en
// palabras. "18 AGOSTO" calza para la semana del 18 de agosto; "S34" o "17-08"
// no, porque les falta el mes.
function guessScheduleWorksheet(sheets, weekStartISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(weekStartISO || ""));

  if (!m) return null;

  const day = Number(m[3]);
  const monthName = SCHEDULE_MONTHS_ES[Number(m[2]) - 1] || "";
  const dayRe = new RegExp(`(^|\\D)0*${day}(\\D|$)`);

  return sheets.find((ws) => {
    const t = SCHEDULE_TEXT_NORM(ws.name);
    return dayRe.test(t) && (!monthName || t.includes(monthName));
  }) || null;
}

/**
 * Que hoja del libro se publica.
 *
 * Antes, cuando la corazonada del nombre fallaba, se publicaba la ULTIMA hoja
 * del libro sin avisar. Eso publicaba en silencio la semana equivocada -y en la
 * PWA se veia como turnos que no corresponden-, asi que ahora ese caso se
 * devuelve como ambiguo para que el supervisor elija.
 *
 * @returns {{worksheet?: object, sheets: object[], ambiguous?: boolean,
 *            notFound?: boolean}}
 */
function pickScheduleWorksheet(workbook, weekStartISO, sheetName = "") {
  const sheets = (workbook.worksheets || []).filter(
    (ws) => ws && (ws.rowCount || 0) > 1
  );

  if (!sheets.length) return { sheets: [] };

  // Si el supervisor ya eligio, manda su eleccion.
  const chosen = String(sheetName || "").trim();

  if (chosen) {
    const exact = sheets.find((ws) => String(ws.name).trim() === chosen);

    return exact
      ? { worksheet: exact, sheets }
      : { sheets, notFound: true };
  }

  if (sheets.length === 1) return { worksheet: sheets[0], sheets };

  const guess = guessScheduleWorksheet(sheets, weekStartISO);

  return guess
    ? { worksheet: guess, sheets }
    : { sheets, ambiguous: true };
}

// Publica la programación desde un EXCEL (.xlsx). Reemplazo determinista del OCR
// de imagen: la hoja de la semana se convierte a la grilla estructurada
// (scheduleGridFromSheet) que la PWA renderiza tal cual, sin reconstrucción por
// coordenadas. No usa Storage ni Vision: el grid es autocontenido y viaja en el
// adjunto publicado.
exports.uploadScheduleWorkbook = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para publicar la programacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona una unidad antes de publicar la programacion."
      );
    }

    await requireWorkspaceMember(workspaceId, uid, request.auth.token || {});

    const name = cleanCallableText(request.data?.name || "programacion.xlsx", 180);
    const dataUrl = String(request.data?.dataUrl || "");
    const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/s);
    const base64 = (match ? match[2] : String(request.data?.base64 || ""))
      .replace(/\s/g, "");

    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
      throw new HttpsError("invalid-argument", "No se pudo leer el archivo Excel.");
    }

    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length || buffer.length > SCHEDULE_ATTACHMENT_MAX_SIZE) {
      throw new HttpsError("invalid-argument", "El Excel debe pesar hasta 10 MB.");
    }

    // Firma ZIP ("PK\x03\x04"): un .xlsx es un zip.
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new HttpsError(
        "invalid-argument",
        "El archivo no es un Excel (.xlsx) valido."
      );
    }

    const weekStartISO = cleanCallableText(request.data?.weekStartISO, 32);
    const sheetName = cleanCallableText(request.data?.sheetName, 180);
    let grid;
    let publishedSheet = "";
    let choice = null;

    try {
      const ExcelJS = require("exceljs");
      const { scheduleGridFromSheet } = require("./engine/scheduleGridFromSheet.cjs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      choice = pickScheduleWorksheet(workbook, weekStartISO, sheetName);

      if (!choice.sheets.length) {
        throw new Error("El Excel no tiene hojas con datos.");
      }

      if (choice.notFound) {
        throw new HttpsError(
          "invalid-argument",
          `La hoja "${sheetName}" ya no esta en el archivo.`
        );
      }

      // Varias hojas y ninguna calza con la semana: se pregunta en vez de
      // publicar la que toque por descarte.
      if (choice.ambiguous) {
        return {
          needsSheet: true,
          sheets: choice.sheets.map((ws) => String(ws.name))
        };
      }

      publishedSheet = String(choice.worksheet.name || "");
      grid = scheduleGridFromSheet(
        worksheetToScheduleSheetModel(choice.worksheet)
      );
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("uploadScheduleWorkbook: no se pudo parsear el Excel", {
        message: error?.message,
        workspaceId
      });
      throw new HttpsError(
        "invalid-argument",
        "No se pudo leer la programacion del Excel. Revisa el formato de la planilla."
      );
    }

    if (!grid || !Array.isArray(grid.rows) || !grid.rows.length) {
      throw new HttpsError(
        "invalid-argument",
        "No se encontraron filas de programacion en el Excel."
      );
    }

    return {
      id: `schedule_${Date.now()}_${randomBytes(6).toString("hex")}`,
      name,
      type: "xlsx",
      mode: "grid",
      weekStartISO,
      addedAtISO: new Date().toISOString(),
      // Que hoja se publico. Viaja de vuelta para poder decirlo en la
      // confirmacion: asi, cuando la hoja la eligio el nombre y no el
      // supervisor, una corazonada equivocada se ve en el momento.
      sheetName: publishedSheet,
      grid
    };
  }
);

exports.uploadScheduleAttachment = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para adjuntar la programacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona una unidad antes de adjuntar la programacion."
      );
    }

    await requireWorkspaceMember(workspaceId, uid, request.auth.token || {});

    const decoded = decodeScheduleAttachmentPayload(request.data || {});
    const bucket = admin.storage().bucket();

    if (!bucket) {
      throw new HttpsError(
        "failed-precondition",
        "El almacenamiento de programaciones no esta disponible."
      );
    }

    const id = `schedule_${Date.now()}_${randomBytes(6).toString("hex")}`;
    const downloadToken = randomBytes(24).toString("hex");
    const storagePath = [
      "workspaces",
      safeStoragePathSegment(workspaceId, "workspace"),
      "attachments",
      SCHEDULE_ATTACHMENT_MODULE_ID,
      SCHEDULE_ATTACHMENT_OWNER_ID,
      SCHEDULE_ATTACHMENT_RECORD_ID,
      `${safeStoragePathSegment(id, "schedule")}_${decoded.safeName}`
    ].join("/");
    const addedAt = new Date().toISOString();

    await bucket.file(storagePath).save(decoded.buffer, {
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-cache",
        contentType: decoded.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          workspaceId,
          moduleId: SCHEDULE_ATTACHMENT_MODULE_ID,
          ownerId: SCHEDULE_ATTACHMENT_OWNER_ID,
          recordId: SCHEDULE_ATTACHMENT_RECORD_ID,
          uploadedByUid: uid,
          originalName: decoded.originalName
        }
      }
    });

    const ocr = await automaticScheduleImageOcr(decoded, {
      workspaceId,
      storagePath
    });

    return {
      id,
      name: decoded.originalName,
      type: decoded.contentType,
      size: decoded.buffer.length,
      addedAt,
      updatedAtISO: addedAt,
      uploadedByUid: uid,
      storagePath,
      downloadURL: storageDownloadURL(bucket.name, storagePath, downloadToken),
      mode: "image",
      source: "supervisor_image",
      ocr
    };
  }
);

exports.uploadInformationAttachment = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para adjuntar informacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const recordId = safeStoragePathSegment(
      cleanCallableText(request.data?.recordId, 160),
      "information"
    );

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona una unidad antes de adjuntar informacion."
      );
    }

    await requireWorkspaceInformationPublisher(
      workspaceId,
      uid,
      request.auth.token || {}
    );

    const decoded = decodeInformationAttachmentPayload(request.data || {});
    const bucket = admin.storage().bucket();

    if (!bucket) {
      throw new HttpsError(
        "failed-precondition",
        "El almacenamiento de informaciones no esta disponible."
      );
    }

    const id = `information_${Date.now()}_${randomBytes(6).toString("hex")}`;
    const downloadToken = randomBytes(24).toString("hex");
    const storagePath = [
      "workspaces",
      safeStoragePathSegment(workspaceId, "workspace"),
      "attachments",
      INFORMATION_ATTACHMENT_MODULE_ID,
      INFORMATION_ATTACHMENT_OWNER_ID,
      recordId,
      `${safeStoragePathSegment(id, "information")}_${decoded.safeName}`
    ].join("/");
    const addedAt = new Date().toISOString();

    await bucket.file(storagePath).save(decoded.buffer, {
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-cache",
        contentType: decoded.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          workspaceId,
          moduleId: INFORMATION_ATTACHMENT_MODULE_ID,
          ownerId: INFORMATION_ATTACHMENT_OWNER_ID,
          recordId,
          uploadedByUid: uid,
          originalName: decoded.originalName
        }
      }
    });

    return {
      id,
      name: decoded.originalName,
      type: decoded.contentType,
      size: decoded.buffer.length,
      addedAt,
      uploadedByUid: uid,
      storagePath,
      downloadURL: storageDownloadURL(bucket.name, storagePath, downloadToken)
    };
  }
);

exports.deleteInformationAttachment = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para eliminar informacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const storagePath = cleanCallableText(request.data?.storagePath, 500);

    if (!workspaceId || !isInformationAttachmentStoragePath(workspaceId, storagePath)) {
      throw new HttpsError(
        "invalid-argument",
        "El archivo de informacion no es valido para esta unidad."
      );
    }

    await requireWorkspaceInformationPublisher(
      workspaceId,
      uid,
      request.auth.token || {}
    );

    const bucket = admin.storage().bucket();

    if (!bucket) {
      throw new HttpsError(
        "failed-precondition",
        "El almacenamiento de informaciones no esta disponible."
      );
    }

    try {
      await bucket.file(storagePath).delete();
    } catch (error) {
      if (Number(error?.code) !== 404) {
        throw new HttpsError(
          "internal",
          "No se pudo eliminar el archivo adjunto de informacion."
        );
      }
    }

    return { deleted: true };
  }
);

exports.uploadMedicalEquipmentAttachment = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para adjuntar equipos medicos."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const rawOwnerId = cleanCallableText(request.data?.ownerId, 160);
    const rawRecordId = cleanCallableText(request.data?.recordId, 160);
    const ownerId = safeStoragePathSegment(rawOwnerId, "equipment");
    const recordId = safeStoragePathSegment(rawRecordId, "medical_equipment");

    if (!workspaceId || !rawOwnerId || !rawRecordId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona equipo y seccion antes de adjuntar el archivo."
      );
    }

    await requireWorkspaceMedicalEquipmentPublisher(
      workspaceId,
      uid,
      request.auth.token || {}
    );

    const decoded = decodeInformationAttachmentPayload(request.data || {});
    const bucket = admin.storage().bucket();

    if (!bucket) {
      throw new HttpsError(
        "failed-precondition",
        "El almacenamiento de equipos medicos no esta disponible."
      );
    }

    const id = `medical_equipment_${Date.now()}_${randomBytes(6).toString("hex")}`;
    const downloadToken = randomBytes(24).toString("hex");
    const storagePath = [
      "workspaces",
      safeStoragePathSegment(workspaceId, "workspace"),
      "attachments",
      MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID,
      ownerId,
      recordId,
      `${safeStoragePathSegment(id, "medical_equipment")}_${decoded.safeName}`
    ].join("/");
    const addedAt = new Date().toISOString();

    await bucket.file(storagePath).save(decoded.buffer, {
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-cache",
        contentType: decoded.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          workspaceId,
          moduleId: MEDICAL_EQUIPMENT_ATTACHMENT_MODULE_ID,
          ownerId,
          recordId,
          uploadedByUid: uid,
          originalName: decoded.originalName
        }
      }
    });

    return {
      id,
      name: decoded.originalName,
      type: decoded.contentType,
      size: decoded.buffer.length,
      addedAt,
      uploadedByUid: uid,
      storagePath,
      downloadURL: storageDownloadURL(bucket.name, storagePath, downloadToken)
    };
  }
);

exports.deleteMedicalEquipmentAttachment = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para eliminar adjuntos de equipos medicos."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const storagePath = cleanCallableText(request.data?.storagePath, 500);

    if (!workspaceId || !isMedicalEquipmentAttachmentStoragePath(workspaceId, storagePath)) {
      throw new HttpsError(
        "invalid-argument",
        "El archivo de equipos medicos no es valido para esta unidad."
      );
    }

    await requireWorkspaceMedicalEquipmentPublisher(
      workspaceId,
      uid,
      request.auth.token || {}
    );

    const bucket = admin.storage().bucket();

    if (!bucket) {
      throw new HttpsError(
        "failed-precondition",
        "El almacenamiento de equipos medicos no esta disponible."
      );
    }

    try {
      await bucket.file(storagePath).delete();
    } catch (error) {
      if (Number(error?.code) !== 404) {
        throw new HttpsError(
          "internal",
          "No se pudo eliminar el archivo adjunto de equipos medicos."
        );
      }
    }

    return { deleted: true };
  }
);

exports.uploadQualificationAttachment = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para adjuntar la calificacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const rawOwnerId = cleanCallableText(request.data?.ownerId, 160);
    const rawRecordId = cleanCallableText(request.data?.recordId, 160);
    const ownerId = safeStoragePathSegment(rawOwnerId, "worker");
    const recordId = safeStoragePathSegment(rawRecordId, "qualification");

    if (!workspaceId || !rawOwnerId || !rawRecordId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona trabajador y periodo antes de adjuntar la calificacion."
      );
    }

    await requireWorkspaceQualificationPublisher(
      workspaceId,
      uid,
      request.auth.token || {}
    );

    const decoded = decodeInformationAttachmentPayload(request.data || {});
    const bucket = admin.storage().bucket();

    if (!bucket) {
      throw new HttpsError(
        "failed-precondition",
        "El almacenamiento de calificaciones no esta disponible."
      );
    }

    const id = `qualification_${Date.now()}_${randomBytes(6).toString("hex")}`;
    const downloadToken = randomBytes(24).toString("hex");
    const storagePath = [
      "workspaces",
      safeStoragePathSegment(workspaceId, "workspace"),
      "attachments",
      QUALIFICATION_ATTACHMENT_MODULE_ID,
      ownerId,
      recordId,
      `${safeStoragePathSegment(id, "qualification")}_${decoded.safeName}`
    ].join("/");
    const addedAt = new Date().toISOString();

    await bucket.file(storagePath).save(decoded.buffer, {
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-cache",
        contentType: decoded.contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          workspaceId,
          moduleId: QUALIFICATION_ATTACHMENT_MODULE_ID,
          ownerId,
          recordId,
          uploadedByUid: uid,
          originalName: decoded.originalName
        }
      }
    });

    return {
      id,
      name: decoded.originalName,
      type: decoded.contentType,
      size: decoded.buffer.length,
      addedAt,
      uploadedByUid: uid,
      storagePath,
      downloadURL: storageDownloadURL(bucket.name, storagePath, downloadToken)
    };
  }
);

exports.deleteQualificationAttachment = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para eliminar la calificacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const storagePath = cleanCallableText(request.data?.storagePath, 500);

    if (!workspaceId || !isQualificationAttachmentStoragePath(workspaceId, storagePath)) {
      throw new HttpsError(
        "invalid-argument",
        "El archivo de calificacion no es valido para esta unidad."
      );
    }

    await requireWorkspaceQualificationPublisher(
      workspaceId,
      uid,
      request.auth.token || {}
    );

    const bucket = admin.storage().bucket();

    if (!bucket) {
      throw new HttpsError(
        "failed-precondition",
        "El almacenamiento de calificaciones no esta disponible."
      );
    }

    try {
      await bucket.file(storagePath).delete();
    } catch (error) {
      if (Number(error?.code) !== 404) {
        throw new HttpsError(
          "internal",
          "No se pudo eliminar el archivo adjunto de calificacion."
        );
      }
    }

    return { deleted: true };
  }
);

// Reintenta el OCR de una programacion YA subida (sin re-subir la imagen):
// lee el archivo desde Storage y ejecuta Vision otra vez. Devuelve solo el
// objeto ocr; el cliente actualiza el adjunto y re-publica la proyeccion.
exports.reprocessScheduleOcr = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para reprocesar la programacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona una unidad antes de reprocesar la programacion."
      );
    }

    await requireWorkspaceMember(workspaceId, uid, request.auth.token || {});

    const storagePath = cleanCallableText(request.data?.storagePath, 500);

    if (!storagePath) {
      throw new HttpsError(
        "invalid-argument",
        "Falta la ruta de la programacion a reprocesar."
      );
    }

    const expectedPrefix = [
      "workspaces",
      safeStoragePathSegment(workspaceId, "workspace"),
      "attachments",
      SCHEDULE_ATTACHMENT_MODULE_ID
    ].join("/");

    if (!storagePath.startsWith(`${expectedPrefix}/`)) {
      throw new HttpsError(
        "permission-denied",
        "La programacion indicada no pertenece a esta unidad."
      );
    }

    const bucket = admin.storage().bucket();
    let buffer;

    try {
      const [contents] = await bucket.file(storagePath).download();
      buffer = contents;
    } catch (error) {
      logger.warn("No se pudo leer la programacion para reprocesar OCR.", {
        workspaceId,
        storagePath,
        errorMessage: cleanCallableText(error?.message || error?.code, 240)
      });
      throw new HttpsError(
        "not-found",
        "No se encontro la imagen de la programacion en el almacenamiento."
      );
    }

    const ocr = await automaticScheduleImageOcr(
      { buffer },
      { workspaceId, storagePath }
    );

    return { ocr };
  }
);

function scheduleNotificationEventId(value) {
  const clean = cleanCallableText(value, 160)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return clean || `schedule_attachment_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function scheduleNotificationAttachment(data = {}) {
  if (!data || typeof data !== "object") return null;

  return {
    id: cleanCallableText(data.id, 160),
    name: cleanCallableText(data.name || "programacion", 180),
    storagePath: cleanCallableText(data.storagePath, 500),
    updatedAtISO: cleanCallableText(data.updatedAtISO, 40),
    mode: cleanCallableText(data.mode, 40),
    ocrStatus: cleanCallableText(data.ocrStatus, 40),
    weekStartISO: cleanCallableText(data.weekStartISO, 40),
    weekEndISO: cleanCallableText(data.weekEndISO, 40),
    weekLabel: cleanCallableText(data.weekLabel, 120)
  };
}

function informationNotificationEventId(informationId, publishedAt) {
  const source = `${cleanCallableText(informationId, 180)}:${cleanCallableText(publishedAt, 80)}`;
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 24);

  return `information_${hash}`;
}

function publishedInformationItems(data = {}) {
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.informations)) return data.informations;

  return [];
}

function isInformationVisibleForNotification(item = {}, now = Date.now()) {
  const status = String(item.status || "published").trim().toLowerCase();

  if (status === "draft" || status === "archived") return false;

  const publishAt = Date.parse(String(item.publishAt || ""));
  const expiresAt = Date.parse(String(item.expiresAt || ""));

  if (!Number.isNaN(publishAt) && publishAt > now) return false;
  if (!Number.isNaN(expiresAt) && expiresAt <= now) return false;

  return true;
}

function informationNotificationBody(item = {}) {
  const title = cleanCallableText(item.title || "Nueva informacion", 180);
  const body = cleanCallableText(item.body || item.message, 180);

  return body && body !== title
    ? `${title}: ${body}`
    : title;
}

function informationDeepLink(informationId) {
  const params = new URLSearchParams({
    screen: "informaciones",
    informationId: cleanCallableText(informationId, 180)
  });

  return `${WORKER_APP_BASE_URL}?${params.toString()}`;
}

exports.notifyInformationPublished = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para notificar la informacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const informationId = cleanCallableText(request.data?.informationId, 180);

    if (!workspaceId || !informationId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona una unidad y una informacion para notificar."
      );
    }

    const member = await requireWorkspaceMember(
      workspaceId,
      uid,
      request.auth.token || {}
    );

    if (!memberCanPublishInformations(member)) {
      throw new HttpsError(
        "permission-denied",
        "No tienes permisos para notificar informaciones en esta unidad."
      );
    }

    const requestedRecipientUids = new Set(
      Array.isArray(request.data?.recipientUids)
        ? uniqueValues(request.data.recipientUids)
        : []
    );

    if (!requestedRecipientUids.size) {
      return {
        ok: true,
        informationId,
        recipients: 0,
        notified: 0,
        sent: 0,
        skippedReason: "no_recipients"
      };
    }

    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const [workspaceSnap, informationsSnap, linksSnap] = await Promise.all([
      workspaceRef.get(),
      workspaceRef.collection("published").doc("informations").get(),
      workspaceRef.collection("workerLinks").get()
    ]);
    const informationsDoc = informationsSnap.data() || {};
    const information = publishedInformationItems(informationsDoc)
      .find((item) => cleanCallableText(item?.id, 180) === informationId);

    if (!information || !isInformationVisibleForNotification(information)) {
      return {
        ok: true,
        informationId,
        recipients: 0,
        notified: 0,
        sent: 0,
        skippedReason: information ? "not_visible" : "not_published"
      };
    }

    const workspace = workspaceSnap.data() || {};
    const workspaceName = cleanCallableText(
      workspace.name || workspace.displayName || informationsDoc.workspaceName,
      160
    );
    const publishedAt = cleanCallableText(
      information.publishedAt ||
      information.updatedAt ||
      informationsDoc.updatedAtISO,
      80
    );
    const eventId = informationNotificationEventId(informationId, publishedAt);
    const title = "Nueva informacion";
    const body = informationNotificationBody(information);
    const deepLink = informationDeepLink(informationId);
    const activeLinks = linksSnap.docs
      .map((docSnap) => {
        const link = docSnap.data() || {};
        const workerUid = cleanCallableText(link.uid || docSnap.id, 160);

        return workerUid &&
          requestedRecipientUids.has(workerUid) &&
          String(link.status || "active") === "active"
          ? {
              uid: workerUid,
              profileName: cleanCallableText(link.profileName, 180),
              profileRut: cleanCallableText(link.profileRut, 32),
              workerEmail: cleanCallableText(link.workerEmail, 254)
            }
          : null;
      })
      .filter(Boolean);
    const uniqueLinks = Array.from(
      new Map(activeLinks.map((link) => [link.uid, link])).values()
    );
    const notificationRefs = uniqueLinks.map((link) => ({
      link,
      ref: workspaceRef
        .collection("workerNotifications")
        .doc(link.uid)
        .collection("items")
        .doc(eventId)
    }));
    const existingSnaps = notificationRefs.length
      ? await db.getAll(...notificationRefs.map((item) => item.ref))
      : [];
    const missing = notificationRefs.filter((item, index) =>
      !existingSnaps[index]?.exists
    );
    const createdAt = admin.firestore.FieldValue.serverTimestamp();

    for (let index = 0; index < missing.length; index += 400) {
      const batch = db.batch();

      missing.slice(index, index + 400).forEach(({ link, ref }) => {
        batch.set(ref, {
          type: "information_published",
          category: "informations",
          title,
          message: body,
          workspaceId,
          workspaceName,
          workerId: link.profileName,
          profileName: link.profileName,
          profileRut: link.profileRut,
          workerEmail: link.workerEmail,
          affectedDates: [],
          changeType: "information_published",
          source: "informations_publish",
          informationId,
          informationTitle: cleanCallableText(information.title, 180),
          categoryId: cleanCallableText(information.category, 80),
          publishedAt,
          createdAt,
          clientCreatedAtISO: cleanCallableText(
            request.data?.clientCreatedAtISO,
            40
          ),
          readAt: null,
          isRead: false,
          eventId,
          entityId: informationId,
          batchId: eventId,
          operationId: eventId,
          createdByUid: uid,
          createdByName: cleanCallableText(
            request.auth.token?.name || member.displayName || member.name,
            160
          ),
          deepLink,
          tag: `information-${eventId}`,
          pushStatus: "pending"
        }, { merge: false });
      });

      await batch.commit();
    }

    const results = await Promise.all(missing.map(({ link }) =>
      sendWorkerPush({
        workspaceId,
        uid: link.uid,
        category: "informations",
        title,
        body,
        data: {
          type: "worker_information_published",
          category: "informations",
          eventId,
          informationId,
          informationTitle: cleanCallableText(information.title, 180),
          workspaceId,
          workspaceName,
          workerId: link.profileName,
          profileName: link.profileName,
          screen: "informaciones",
          url: deepLink,
          tag: `information-${eventId}`,
          requireInteraction: "false",
          vibrate: "true"
        }
      })
    ));
    const sentByUid = new Map(
      missing.map((item, index) => [item.link.uid, results[index] || {}])
    );

    for (let index = 0; index < missing.length; index += 400) {
      const batch = db.batch();

      missing.slice(index, index + 400).forEach(({ link, ref }) => {
        const result = sentByUid.get(link.uid) || {};
        batch.set(ref, {
          pushStatus: Number(result.sent) > 0 ? "push_sent" : "push_not_sent",
          pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
          pushSentCount: Number(result.sent) || 0,
          pushError: cleanCallableText(result.error, 240)
        }, { merge: true });
      });

      await batch.commit();
    }

    logger.info("Notificacion de informacion procesada.", {
      workspaceId,
      informationId,
      recipients: uniqueLinks.length,
      created: missing.length,
      sent: results.reduce((total, result) => total + (Number(result.sent) || 0), 0)
    });

    return {
      ok: true,
      eventId,
      informationId,
      recipients: uniqueLinks.length,
      notified: missing.length,
      sent: results.reduce((total, result) => total + (Number(result.sent) || 0), 0)
    };
  }
);

exports.notifyScheduleAttachmentUpdated = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para notificar la programacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona una unidad antes de notificar la programacion."
      );
    }

    const member = await requireWorkspaceMember(
      workspaceId,
      uid,
      request.auth.token || {}
    );
    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const [workspaceSnap, linksSnap] = await Promise.all([
      workspaceRef.get(),
      workspaceRef.collection("workerLinks").get()
    ]);
    const workspace = workspaceSnap.data() || {};
    const eventId = scheduleNotificationEventId(request.data?.eventId);
    const action = cleanCallableText(request.data?.action, 40) === "removed"
      ? "removed"
      : "published";
    const attachment = scheduleNotificationAttachment(request.data?.attachment);
    const title = action === "removed"
      ? "Programacion retirada"
      : "Programacion actualizada";
    const attachmentName = cleanCallableText(attachment?.name, 120);
    const workspaceName = cleanCallableText(
      workspace.name || workspace.displayName || request.data?.workspaceName,
      160
    );
    const requestedRecipientUids = new Set(
      Array.isArray(request.data?.recipientUids)
        ? request.data.recipientUids
            .map((value) => cleanCallableText(value, 160))
            .filter(Boolean)
        : []
    );
    const body = action === "removed"
      ? attachment?.weekLabel
        ? `La programacion de ${attachment.weekLabel} ya no esta disponible.`
        : "La programacion semanal ya no esta disponible."
      : attachmentName
        ? `La programacion de ${attachment?.weekLabel || "la semana"} fue actualizada: ${attachmentName}.`
        : attachment?.weekLabel
          ? `La programacion de ${attachment.weekLabel} fue actualizada.`
          : "La programacion semanal fue actualizada.";
    // Al tocar la notificación de "Programacion actualizada", la PWA abre la
    // programación publicada directamente (openSchedule=1) en la semana notificada.
    // Para "retirada" no se abre (ya no hay nada que mostrar): solo lleva a Turnos.
    const scheduleWeekParam = attachment?.weekStartISO
      ? `&scheduleWeek=${encodeURIComponent(attachment.weekStartISO)}`
      : "";
    const deepLink = action === "removed"
      ? `${WORKER_APP_BASE_URL}?screen=turnos`
      : `${WORKER_APP_BASE_URL}?screen=turnos&openSchedule=1${scheduleWeekParam}`;
    const activeLinks = linksSnap.docs
      .map((docSnap) => {
        const link = docSnap.data() || {};
        const workerUid = cleanCallableText(link.uid || docSnap.id, 160);

        return workerUid && String(link.status || "active") === "active"
          && (!requestedRecipientUids.size || requestedRecipientUids.has(workerUid))
          ? {
              uid: workerUid,
              profileName: cleanCallableText(link.profileName, 180),
              profileRut: cleanCallableText(link.profileRut, 32),
              workerEmail: cleanCallableText(link.workerEmail, 254)
            }
          : null;
      })
      .filter(Boolean);
    const uniqueLinks = Array.from(
      new Map(activeLinks.map((link) => [link.uid, link])).values()
    );
    const notificationRefs = uniqueLinks.map((link) => ({
      link,
      ref: workspaceRef
        .collection("workerNotifications")
        .doc(link.uid)
        .collection("items")
        .doc(eventId)
    }));
    const existingSnaps = notificationRefs.length
      ? await db.getAll(...notificationRefs.map((item) => item.ref))
      : [];
    const missing = notificationRefs.filter((item, index) =>
      !existingSnaps[index]?.exists
    );
    const createdAt = admin.firestore.FieldValue.serverTimestamp();

    for (let index = 0; index < missing.length; index += 400) {
      const batch = db.batch();

      missing.slice(index, index + 400).forEach(({ link, ref }) => {
        batch.set(ref, {
          type: "schedule_attachment_updated",
          category: "calendar_changes",
          title,
          message: body,
          workspaceId,
          workspaceName,
          workerId: link.profileName,
          profileName: link.profileName,
          profileRut: link.profileRut,
          workerEmail: link.workerEmail,
          affectedDates: [],
          changeType: "schedule_attachment",
          source: "schedule_attachment_publish",
          attachment,
          action,
          publishedCount: Number(request.data?.publishedCount) || 0,
          createdAt,
          clientCreatedAtISO: cleanCallableText(
            request.data?.clientCreatedAtISO,
            40
          ),
          readAt: null,
          isRead: false,
          eventId,
          entityId: cleanCallableText(attachment?.id || attachment?.storagePath, 500),
          batchId: eventId,
          operationId: eventId,
          createdByUid: uid,
          createdByName: cleanCallableText(
            request.auth.token?.name || member.displayName || member.name,
            160
          ),
          deepLink,
          tag: `schedule-attachment-${eventId}`,
          pushStatus: "pending"
        }, { merge: false });
      });

      await batch.commit();
    }

    const results = await Promise.all(missing.map(({ link }) =>
      sendWorkerPush({
        workspaceId,
        uid: link.uid,
        category: "calendar_changes",
        title,
        body,
        data: {
          type: "worker_schedule_attachment_updated",
          category: "calendar_changes",
          eventId,
          workspaceId,
          workspaceName,
          workerId: link.profileName,
          profileName: link.profileName,
          changeType: "schedule_attachment",
          weekStartISO: attachment?.weekStartISO || "",
          weekEndISO: attachment?.weekEndISO || "",
          weekLabel: attachment?.weekLabel || "",
          screen: "turnos",
          url: deepLink,
          tag: `schedule-attachment-${eventId}`,
          requireInteraction: "false",
          vibrate: "true"
        }
      })
    ));
    const sentByUid = new Map(
      missing.map((item, index) => [item.link.uid, results[index] || {}])
    );

    for (let index = 0; index < missing.length; index += 400) {
      const batch = db.batch();

      missing.slice(index, index + 400).forEach(({ link, ref }) => {
        const result = sentByUid.get(link.uid) || {};
        batch.set(ref, {
          pushStatus: Number(result.sent) > 0 ? "push_sent" : "push_not_sent",
          pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
          pushSentCount: Number(result.sent) || 0,
          pushError: cleanCallableText(result.error, 240)
        }, { merge: true });
      });

      await batch.commit();
    }

    logger.info("Notificacion de programacion semanal procesada.", {
      workspaceId,
      eventId,
      action,
      recipients: uniqueLinks.length,
      created: missing.length,
      sent: results.reduce((total, result) => total + (Number(result.sent) || 0), 0)
    });

    return {
      ok: true,
      eventId,
      recipients: uniqueLinks.length,
      notified: missing.length,
      sent: results.reduce((total, result) => total + (Number(result.sent) || 0), 0)
    };
  }
);

async function requireAcceptedWorkspaceLink(
  linkId,
  sourceWorkspaceId,
  hostWorkspaceId
) {
  const linkSnap = await db.collection("workspaceLinks").doc(linkId).get();
  const link = linkSnap.data() || {};
  const matchesPair =
    (
      link.fromWorkspaceId === sourceWorkspaceId &&
      link.toWorkspaceId === hostWorkspaceId
    ) ||
    (
      link.fromWorkspaceId === hostWorkspaceId &&
      link.toWorkspaceId === sourceWorkspaceId
    );

  if (!linkSnap.exists || link.status !== "accepted" || !matchesPair) {
    throw new HttpsError(
      "failed-precondition",
      "El enlace entre unidades no esta activo."
    );
  }

  return link;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskedEmail(value) {
  const [local = "", domain = ""] = normalizeEmail(value).split("@");
  if (!domain) return "correo-invalido";

  return `${local.slice(0, 2)}***@${domain}`;
}

function normalizeWorkerIdentityName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function workerLinkMatchesInviteIdentity(link = {}, invite = {}) {
  const inviteRut = normalizeRutForBackup(invite.profileRut);
  const linkRut = normalizeRutForBackup(link.profileRut);

  if (inviteRut && linkRut) return inviteRut === linkRut;

  const inviteName = normalizeWorkerIdentityName(invite.profileName);
  const linkName = normalizeWorkerIdentityName(link.profileName);
  const inviteEmail = normalizeEmail(invite.email);
  const linkEmail = normalizeEmail(link.workerEmail);

  return Boolean(inviteName) &&
    inviteName === linkName &&
    (!inviteEmail || inviteEmail === linkEmail);
}

async function acceptWorkerAppInviteImpl({
  uid,
  authToken = {},
  workspaceId,
  inviteId
}) {
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const inviteRef = workspaceRef.collection("workerAppInvites").doc(inviteId);
  const userLinkRef = db
    .collection("users")
    .doc(uid)
    .collection("workerLinks")
    .doc(workspaceId);
  const workspaceLinkRef = workspaceRef.collection("workerLinks").doc(uid);
  let result = null;

  await db.runTransaction(async (transaction) => {
    const [workspaceSnap, inviteSnap, linksSnap] = await Promise.all([
      transaction.get(workspaceRef),
      transaction.get(inviteRef),
      transaction.get(workspaceRef.collection("workerLinks"))
    ]);

    if (!workspaceSnap.exists) {
      throw new HttpsError(
        "not-found",
        "La unidad de la invitacion no existe."
      );
    }

    if (!inviteSnap.exists) {
      throw new HttpsError(
        "not-found",
        "La invitacion ya no esta disponible."
      );
    }

    const workspace = workspaceSnap.data() || {};
    const invite = inviteSnap.data() || {};

    if (invite.workspaceId !== workspaceId || invite.token !== inviteId) {
      throw new HttpsError(
        "permission-denied",
        "La invitacion no corresponde a esta unidad."
      );
    }

    const inviteStatus = String(invite.status || "");

    // Al reenviar una invitacion, la anterior queda "superseded". Sin este
    // mensaje el trabajador que abria el correo viejo leia "ya fue utilizada" y
    // no tenia como saber que le habia llegado uno nuevo.
    if (inviteStatus === "superseded") {
      throw new HttpsError(
        "failed-precondition",
        "Este enlace fue reemplazado por uno mas nuevo. Abre el ultimo correo de invitacion o pideselo a tu supervisor."
      );
    }

    if (inviteStatus !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "Esta invitacion ya fue utilizada. Solicita una nueva al supervisor."
      );
    }

    const expiresAtMs = timestampToMillis(invite.expiresAt);
    if (expiresAtMs && expiresAtMs <= Date.now()) {
      throw new HttpsError(
        "failed-precondition",
        "La invitacion expiro. Solicita una nueva al supervisor."
      );
    }

    if (WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED) {
      const authEmail = normalizeEmail(authToken.email);
      const inviteEmail = normalizeEmail(invite.email);

      if (!authEmail || authEmail !== inviteEmail) {
        throw new HttpsError(
          "permission-denied",
          "Debes iniciar sesion con el correo de la invitacion."
        );
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const workerEmail = WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED
      ? normalizeEmail(authToken.email)
      : normalizeEmail(invite.email) || normalizeEmail(authToken.email);
    const workerDisplayName =
      cleanCallableText(authToken.name || invite.profileName, 160);
    const workspaceName =
      cleanCallableText(invite.workspaceName || workspace.name, 160);
    const linkPayload = {
      uid,
      workspaceId,
      workspaceName,
      inviteId,
      profileName: cleanCallableText(invite.profileName, 180),
      profileRut: cleanCallableText(invite.profileRut, 32),
      workerEmail,
      workerDisplayName,
      status: "active",
      linkedAt: now,
      updatedAt: now
    };
    const duplicateDocs = linksSnap.docs.filter((docSnap) => {
      if (docSnap.id === uid) return false;

      const link = docSnap.data() || {};
      const status = String(link.status || "active");

      return status === "active" &&
        workerLinkMatchesInviteIdentity(link, invite);
    });

    duplicateDocs.forEach((docSnap) => {
      const link = docSnap.data() || {};
      const duplicateUid = cleanCallableText(link.uid || docSnap.id, 160);
      if (!duplicateUid || duplicateUid === uid) return;

      transaction.delete(docSnap.ref);
      transaction.set(
        db
          .collection("users")
          .doc(duplicateUid)
          .collection("workerLinks")
          .doc(workspaceId),
        {
          workspaceId,
          status: "unlinked",
          unlinkedAt: now,
          unlinkedBy: "duplicate_worker_invite",
          workspaceName,
          profileName: link.profileName || invite.profileName || ""
        },
        { merge: true }
      );
      transaction.set(
        workspaceRef.collection("workerMessageDirectory").doc(duplicateUid),
        {
          uid: duplicateUid,
          workspaceId,
          profileName: link.profileName || invite.profileName || "",
          status: "unlinked",
          unlinkedAt: now,
          updatedAt: now,
          updatedAtISO: new Date().toISOString()
        },
        { merge: true }
      );
      transaction.delete(
        workspaceRef.collection("workerSwapCandidates").doc(duplicateUid)
      );
    });

    transaction.update(inviteRef, {
      status: "accepted",
      workerUid: uid,
      workerEmail,
      workerDisplayName,
      acceptedAt: now,
      consumedAt: now,
      consumedByUid: uid,
      updatedAt: now
    });

    const emailKey = normalizeEmail(invite.email);
    if (emailKey) {
      transaction.set(
        db
          .collection("workerAppEmailInvites")
          .doc(emailKey)
          .collection("items")
          .doc(inviteId),
        {
          status: "accepted",
          workerUid: uid,
          workerEmail,
          workerDisplayName,
          acceptedAt: now,
          consumedAt: now,
          consumedByUid: uid,
          updatedAt: now
        },
        { merge: true }
      );
    }

    transaction.set(userLinkRef, linkPayload, { merge: true });
    transaction.set(workspaceLinkRef, linkPayload, { merge: true });

    result = {
      ok: true,
      workspaceId,
      workspaceName,
      profileName: linkPayload.profileName,
      revokedLinks: duplicateDocs.length
    };
  });

  await workspaceRef.collection("projectionRequests").add({
    profiles: [result.profileName],
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: "worker_invite_accepted"
  }).catch((error) => {
    logger.warn("No se pudo encolar proyeccion tras aceptar invitacion.", {
      workspaceId,
      inviteId,
      error: error?.message || String(error)
    });
  });

  return result;
}

exports.acceptWorkerAppInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para aceptar la invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const inviteId = cleanCallableText(request.data?.inviteId, 160);

    if (!workspaceId || !inviteId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la invitacion."
      );
    }

    return acceptWorkerAppInviteImpl({
      uid,
      authToken: request.auth.token || {},
      workspaceId,
      inviteId
    });
  }
);

function safeMailFrom() {
  const value = String(MAIL_FROM.value() || DEFAULT_MAIL_FROM).trim();

  return value && !/[\r\n]/.test(value)
    ? value.slice(0, 320)
    : DEFAULT_MAIL_FROM;
}

function workerInviteUrl(workspaceId, token, email) {
  const url = new URL(WORKER_APP_BASE_URL);

  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("invite", token);
  if (email) url.searchParams.set("email", email);

  return url.toString();
}

function supervisorInviteUrl(workspaceId, token) {
  const url = new URL(PROTURNOS_APP_BASE_URL);

  url.searchParams.set("joinWorkspace", workspaceId);
  url.searchParams.set("supervisorInvite", token);

  return url.toString();
}

function proturnosRequestsUrl() {
  const url = new URL(PROTURNOS_APP_BASE_URL);

  url.hash = "workerRequestsPanel";
  return url.toString();
}

function workspaceLinkOwnerRequestId(fromWorkspaceId, ownerUid, ownerEmail) {
  const from = cleanCallableText(fromWorkspaceId, 160).replace(/\//g, "");
  const target = createHash("sha256")
    .update(`${ownerUid || ""}|${ownerEmail || ""}`)
    .digest("hex")
    .slice(0, 40);

  return `${from}__owner_${target}`;
}

function workspaceIsActiveForLinks(workspace = {}) {
  return !["pending_deletion", "deleted"].includes(
    String(workspace.deletionStatus || "")
  );
}

function inviteHistoryTimestampMillis(invite = {}, status = "") {
  const statusField = status === "revoked" ? invite.revokedAt : invite.expiredAt;
  const value =
    statusField ||
    invite.updatedAt ||
    invite.createdAt ||
    invite.expiresAt;

  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function deleteRefsInBatches(refs) {
  let deleted = 0;

  for (let index = 0; index < refs.length; index += 450) {
    const batch = db.batch();
    const slice = refs.slice(index, index + 450);

    slice.forEach(ref => batch.delete(ref));
    await batch.commit();
    deleted += slice.length;
  }

  return deleted;
}

async function trimSupervisorInviteHistory(workspaceId) {
  const invitesRef = db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("supervisorInvites");
  const limits = {
    revoked: SUPERVISOR_INVITE_REVOKED_HISTORY_LIMIT,
    expired: SUPERVISOR_INVITE_EXPIRED_HISTORY_LIMIT
  };
  const result = {};

  await Promise.all(Object.entries(limits).map(async ([status, limit]) => {
    const snap = await invitesRef
      .where("status", "==", status)
      .get();
    const staleRefs = snap.docs
      .map(docSnap => ({
        ref: docSnap.ref,
        millis: inviteHistoryTimestampMillis(docSnap.data(), status),
        id: docSnap.id
      }))
      .sort((a, b) => {
        const byTime = b.millis - a.millis;

        return byTime || b.id.localeCompare(a.id);
      })
      .slice(limit)
      .map(item => item.ref);

    result[status] = await deleteRefsInBatches(staleRefs);
  }));

  return result;
}

async function resolveOwnerUidByEmail(email) {
  try {
    const userRecord = await admin.auth().getUserByEmail(email);

    if (userRecord?.uid) return userRecord.uid;
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      logger.warn("No se pudo buscar usuario por correo en Auth.", {
        recipient: maskedEmail(email),
        message: error.message
      });
    }
  }

  const usersSnap = await db
    .collection("users")
    .where("email", "==", email)
    .limit(2)
    .get();

  return usersSnap.docs[0]?.id || "";
}

async function resolveWorkspaceLinkOwner(email, fromWorkspaceId) {
  let ownerUid = await resolveOwnerUidByEmail(email);
  const workspaces = new Map();

  async function addWorkspaceDocs(query) {
    const snap = await query.get();

    snap.docs.forEach(docSnap => {
      const data = docSnap.data() || {};

      if (!workspaceIsActiveForLinks(data)) return;
      if (docSnap.id === fromWorkspaceId) return;
      workspaces.set(docSnap.id, {
        id: docSnap.id,
        ...data
      });
      if (!ownerUid && data.ownerUid) {
        ownerUid = String(data.ownerUid || "");
      }
    });
  }

  if (ownerUid) {
    await addWorkspaceDocs(
      db.collection("workspaces")
        .where("ownerUid", "==", ownerUid)
        .limit(20)
    );
  }

  await addWorkspaceDocs(
    db.collection("workspaces")
      .where("createdByEmail", "==", email)
      .limit(20)
  );

  if (!ownerUid || workspaces.size === 0) {
    throw new HttpsError(
      "not-found",
      "No encontramos una unidad activa cuyo owner use ese correo."
    );
  }

  return {
    ownerUid,
    ownerEmail: email,
    workspaceCount: workspaces.size,
    workspaceNames: [...workspaces.values()]
      .map(workspace => cleanCallableText(workspace.name, 160))
      .filter(Boolean)
      .slice(0, 5)
  };
}

async function reserveInviteEmailSend(senderUid, email) {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const senderRef = db.collection("securityRateLimits").doc(
    `invite_sender_${senderUid}`
  );
  const recipientHash = createHash("sha256")
    .update(email)
    .digest("hex")
    .slice(0, 40);
  const recipientRef = db.collection("securityRateLimits").doc(
    `invite_recipient_${recipientHash}`
  );

  return db.runTransaction(async transaction => {
    const [senderSnap, recipientSnap] = await Promise.all([
      transaction.get(senderRef),
      transaction.get(recipientRef)
    ]);
    const sender = senderSnap.data() || {};
    const recipient = recipientSnap.data() || {};
    const windowStartedAt = Number(sender.windowStartedAtMs) || now;
    const withinWindow = now - windowStartedAt < hourMs;
    const count = withinWindow ? Number(sender.count) || 0 : 0;
    const recipientLastSentAt = Number(recipient.lastSentAtMs) || 0;

    if (count >= 100 || now - recipientLastSentAt < 60 * 1000) {
      return false;
    }

    transaction.set(senderRef, {
      windowStartedAtMs: withinWindow ? windowStartedAt : now,
      count: count + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(recipientRef, {
      lastSentAtMs: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return true;
  });
}

exports.sendWorkerAppInviteEmail = onDocumentCreated(
  {
    document: "workspaces/{workspaceId}/workerAppInvites/{token}",
    secrets: [RESEND_API_KEY]
  },
  async (event) => {
    const invite = event.data?.data() || {};
    const { workspaceId, token } = event.params;
    const email = normalizeEmail(invite.email);
    const senderUid = String(invite.createdByUid || "").trim();

    if (
      invite.status !== "pending" ||
      !isValidEmail(email) ||
      !senderUid ||
      invite.workspaceId !== workspaceId ||
      invite.token !== token
    ) {
      await event.data?.ref.set(
        { emailStatus: "skipped_invalid_invite" },
        { merge: true }
      );
      return;
    }

    if (!await reserveInviteEmailSend(senderUid, email)) {
      logger.warn("Invitacion omitida por limite de envio.", {
        senderUid,
        recipient: maskedEmail(email)
      });
      await event.data.ref.set(
        { emailStatus: "rate_limited" },
        { merge: true }
      );
      return;
    }

    const apiKey = RESEND_API_KEY.value();

    if (!apiKey) {
      logger.warn("RESEND_API_KEY no configurada; no se envia el correo.");
      await event.data.ref.set(
        { emailStatus: "skipped_no_api_key" },
        { merge: true }
      );
      return;
    }

    const workerName =
      String(invite.profileName || "trabajador").trim().slice(0, 160);
    const unit =
      String(invite.workspaceName || "TurnoPlus").trim().slice(0, 160);
    // Nunca se confia en enlaces almacenados por el cliente: se reconstruyen
    // con el dominio oficial para impedir correos de phishing desde Firestore.
    const inviteUrl = workerInviteUrl(workspaceId, token, email);
    const installUrl = WORKER_APP_BASE_URL;

    // El boton del correo usa siempre el enlace directo de invitacion.
    // El enlace passwordless queda preparado, pero apagado por defecto para
    // evitar un segundo correo durante la etapa comercial.
    const isGoogleEmail = /@(?:gmail|googlemail)\.com$/i.test(email);
    let ctaUrl = inviteUrl;

    if (
      WORKER_PASSWORDLESS_INVITE_EMAIL_ENABLED &&
      !isGoogleEmail &&
      inviteUrl
    ) {
      try {
        ctaUrl = await admin.auth().generateSignInWithEmailLink(email, {
          url: inviteUrl,
          handleCodeInApp: true
        });
      } catch (linkError) {
        logger.warn(
          "No se pudo generar enlace de ingreso; se usa el enlace normal.",
          { email, message: linkError.message }
        );
        ctaUrl = inviteUrl;
      }
    }

    const { html, text } = buildInviteEmail({
      workerName,
      unit,
      ctaUrl,
      installUrl,
      isGoogleEmail
    });

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: safeMailFrom(),
          to: [email],
          subject: "Invitacion a TurnoPlus Trabajador",
          html,
          text
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Resend ${response.status}: ${detail}`);
      }

      const result = await response.json().catch(() => ({}));

      await event.data.ref.set(
        {
          emailStatus: "sent",
          emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          emailProviderId: result?.id || "",
          emailError: ""
        },
        { merge: true }
      );

      logger.info("Correo de invitacion enviado.", {
        recipient: maskedEmail(email),
        id: result?.id || ""
      });
    } catch (error) {
      logger.error("No se pudo enviar correo de invitacion.", {
        recipient: maskedEmail(email),
        message: error.message
      });
      await event.data.ref.set(
        {
          emailStatus: "error",
          emailError: String(error.message || error).slice(0, 500)
        },
        { merge: true }
      );
    }
  }
);

async function createSupervisorInviteDocument({
  workspaceId,
  uid,
  authToken = {},
  permissions,
  extraData = {},
  ownerChecked = false
}) {
  if (!ownerChecked) {
    await requireWorkspaceOwner(workspaceId, uid, authToken);
  }

  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const workspaceSnap = await workspaceRef.get();

  if (!workspaceSnap.exists) {
    throw new HttpsError(
      "not-found",
      "La unidad no existe."
    );
  }

  const token = createSupervisorInviteToken();
  const inviteId = supervisorInviteIdFromToken(token);
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + SUPERVISOR_INVITE_TTL_MS
  );
  const workspace = workspaceSnap.data() || {};
  const workspaceName = cleanCallableText(workspace.name, 160);

  await workspaceRef
    .collection("supervisorInvites")
    .doc(inviteId)
    .set({
      workspaceId,
      workspaceName,
      tokenHash: inviteId,
      status: "open",
      permissions,
      createdAt: now,
      createdByUid: uid,
      createdByEmail: cleanCallableText(authToken.email, 254),
      createdByName: cleanCallableText(authToken.name, 160),
      expiresAt,
      updatedAt: now,
      ...extraData
    });

  return {
    inviteId,
    token,
    workspaceId,
    workspaceName,
    expiresAt: expiresAt.toMillis(),
    permissions
  };
}

exports.createSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para crear una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const permissions =
      normalizeSupervisorPermissions(request.data?.permissions || {});

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la unidad."
      );
    }

    if (!hasAnyPermission(permissions)) {
      throw new HttpsError(
        "invalid-argument",
        "La invitacion debe incluir al menos un permiso visible."
      );
    }

    return createSupervisorInviteDocument({
      workspaceId,
      uid,
      authToken: request.auth.token || {},
      permissions
    });
  }
);

// Respaldo personal del trabajador (recordatorios, agenda propia, colores)
// anclado al RUT, para que sus datos lo sigan aunque cambie de correo o de
// cuenta de Google. El RUT NO lo declara el cliente: se deriva del enlace
// canonico del uid (workerLinks/{uid}.inviteId) y de la invitacion, cuyo
// profileRut lo fija el supervisor y el trabajador no puede alterar. Asi un
// trabajador solo puede tocar el respaldo de SU propio RUT.
function normalizeRutForBackup(value) {
  return String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

// Deriva el RUT de confianza para (uid, workspace). Devuelve "" si no hay un
// vinculo verificable: en ese caso el cliente se queda con el respaldo por uid.
async function trustedRutForWorker(uid, workspaceId) {
  const linkSnap = await db
    .doc(`workspaces/${workspaceId}/workerLinks/${uid}`)
    .get();

  if (!linkSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No estas enlazado a esta unidad."
    );
  }

  const inviteId = String(linkSnap.data()?.inviteId || "").trim();
  if (!inviteId) return "";

  const inviteSnap = await db
    .doc(`workspaces/${workspaceId}/workerAppInvites/${inviteId}`)
    .get();

  if (!inviteSnap.exists) return "";

  return normalizeRutForBackup(inviteSnap.data()?.profileRut);
}

// El payload es del propio trabajador, pero se acota para no aceptar escrituras
// arbitrarias enormes en Firestore.
function sanitizePersonalBackupPayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  const serialized = JSON.stringify(payload);
  if (serialized.length > 700000) {
    throw new HttpsError(
      "invalid-argument",
      "El respaldo es demasiado grande."
    );
  }

  return JSON.parse(serialized);
}

exports.personalBackupSync = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para respaldar tus datos."
      );
    }

    const action = cleanCallableText(request.data?.action, 16);
    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la unidad."
      );
    }

    if (action !== "read" && action !== "write") {
      throw new HttpsError("invalid-argument", "Accion no valida.");
    }

    const rut = await trustedRutForWorker(uid, workspaceId);

    // Sin RUT de confianza (perfil antiguo sin RUT): no hay respaldo por RUT.
    // El cliente conserva su respaldo por uid, que igual sobrevive a reinstalar.
    if (!rut) return { rut: null, backup: null };

    const ref = db.doc(`personalBackups/${rut}`);

    if (action === "read") {
      const snap = await ref.get();
      return {
        rut,
        backup: snap.exists ? snap.data()?.payload || null : null
      };
    }

    const payload = sanitizePersonalBackupPayload(request.data?.payload);

    await ref.set(
      {
        payload,
        uid,
        rut,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { rut, ok: true };
  }
);

exports.sendSupervisorInviteEmail = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30,
    secrets: [RESEND_API_KEY]
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para enviar una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const email = normalizeEmail(request.data?.email);
    const permissions =
      normalizeSupervisorPermissions(request.data?.permissions || {});

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la unidad."
      );
    }

    if (!isValidEmail(email)) {
      throw new HttpsError(
        "invalid-argument",
        "Ingresa un correo valido para enviar la invitacion."
      );
    }

    if (!hasAnyPermission(permissions)) {
      throw new HttpsError(
        "invalid-argument",
        "La invitacion debe incluir al menos un permiso visible."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    if (!await reserveInviteEmailSend(uid, email)) {
      throw new HttpsError(
        "resource-exhausted",
        "Se alcanzo el limite de envios. Espera un minuto antes de enviar otra invitacion a este correo."
      );
    }

    const invite = await createSupervisorInviteDocument({
      workspaceId,
      uid,
      authToken: request.auth.token || {},
      permissions,
      extraData: {
        deliveryEmail: email,
        emailStatus: "pending"
      },
      ownerChecked: true
    });
    const inviteRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("supervisorInvites")
      .doc(invite.inviteId);
    const inviteUrl = supervisorInviteUrl(workspaceId, invite.token);
    const { html, text } = buildSupervisorInviteEmail({
      workspaceName: invite.workspaceName || "TurnoPlus",
      inviteUrl,
      expiresAtMs: invite.expiresAt,
      senderName:
        cleanCallableText(
          request.auth.token?.name || request.auth.token?.email,
          160
        )
    });

    let sent;

    try {
      sent = await sendResendEmail({
        to: email,
        subject: `Invitacion a TurnoPlus - ${invite.workspaceName || workspaceId}`,
        html,
        text
      });
    } catch (error) {
      logger.error("No se pudo enviar correo de invitacion de supervisor.", {
        recipient: maskedEmail(email),
        message: error.message
      });
      await inviteRef.set(
        {
          emailStatus: "error",
          emailError: String(error.message || error).slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      throw new HttpsError(
        "unavailable",
        "No se pudo enviar el correo. Intenta nuevamente."
      );
    }

    if (!sent?.ok) {
      await inviteRef.set(
        {
          emailStatus: sent?.skipped ? "skipped_no_api_key" : "error",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      throw new HttpsError(
        "failed-precondition",
        "El servicio de correo no esta configurado."
      );
    }

    await inviteRef.set(
      {
        emailStatus: "sent",
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailProviderId: sent.id || "",
        emailError: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    logger.info("Correo de invitacion de supervisor enviado.", {
      recipient: maskedEmail(email),
      inviteId: invite.inviteId,
      id: sent.id || ""
    });

    return {
      ok: true,
      inviteId: invite.inviteId,
      workspaceId,
      workspaceName: invite.workspaceName,
      email
    };
  }
);

exports.requestWorkspaceLinkByOwnerEmail = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30,
    secrets: [RESEND_API_KEY]
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para solicitar un enlace."
      );
    }

    const fromWorkspaceId =
      cleanCallableText(request.data?.fromWorkspaceId, 160);
    const ownerEmail = normalizeEmail(request.data?.ownerEmail);

    if (!fromWorkspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la unidad solicitante."
      );
    }

    if (!isValidEmail(ownerEmail)) {
      throw new HttpsError(
        "invalid-argument",
        "Ingresa un correo valido para solicitar el enlace."
      );
    }

    const fromMember = await requireWorkspaceRequestManager(
      fromWorkspaceId,
      uid,
      request.auth.token || {}
    );
    const fromWorkspaceRef = db.collection("workspaces").doc(fromWorkspaceId);
    const fromWorkspaceSnap = await fromWorkspaceRef.get();

    if (!fromWorkspaceSnap.exists) {
      throw new HttpsError(
        "not-found",
        "La unidad solicitante no existe."
      );
    }

    const fromWorkspace = fromWorkspaceSnap.data() || {};
    const targetOwner = await resolveWorkspaceLinkOwner(
      ownerEmail,
      fromWorkspaceId
    );

    if (
      targetOwner.ownerUid === fromWorkspace.ownerUid &&
      targetOwner.workspaceCount === 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "No puedes enlazar la unidad activa consigo misma."
      );
    }

    if (!await reserveInviteEmailSend(uid, ownerEmail)) {
      throw new HttpsError(
        "resource-exhausted",
        "Se alcanzo el limite de envios. Espera un minuto antes de enviar otra solicitud a este correo."
      );
    }

    const linkId = workspaceLinkOwnerRequestId(
      fromWorkspaceId,
      targetOwner.ownerUid,
      ownerEmail
    );
    const linkRef = db.collection("workspaceLinks").doc(linkId);
    const now = admin.firestore.Timestamp.now();
    const requesterName =
      cleanCallableText(request.auth.token?.name, 160) ||
      cleanCallableText(fromMember.displayName, 160) ||
      cleanCallableText(request.auth.token?.email, 254) ||
      "Usuario";
    const fromWorkspaceName =
      cleanCallableText(fromWorkspace.name, 160) || "Unidad solicitante";

    await db.runTransaction(async transaction => {
      const linkSnap = await transaction.get(linkRef);
      const previous = linkSnap.data() || {};

      if (
        linkSnap.exists &&
        previous.status === "accepted" &&
        previous.toWorkspaceId
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Ya existe un enlace activo con una unidad de ese owner."
        );
      }

      transaction.set(linkRef, {
        fromWorkspaceId,
        fromWorkspaceName,
        fromOwnerUid: cleanCallableText(fromWorkspace.ownerUid, 160),
        toOwnerUid: targetOwner.ownerUid,
        toOwnerEmail: ownerEmail,
        toWorkspaceId: "",
        toWorkspaceName: "",
        status: "pending",
        requestMode: "owner_email",
        requestedByUid: uid,
        requestedByName: requesterName,
        requestedByEmail: cleanCallableText(request.auth.token?.email, 254),
        createdAt: previous.createdAt || now,
        updatedAt: now,
        emailStatus: "pending",
        emailError: ""
      }, { merge: true });
    });

    const requestsUrl = proturnosRequestsUrl();
    const { html, text } = buildWorkspaceLinkRequestEmail({
      fromWorkspaceName,
      requesterName,
      requestsUrl
    });
    let sent;

    try {
      sent = await sendResendEmail({
        to: ownerEmail,
        subject: `Solicitud de enlace de unidad - ${fromWorkspaceName}`,
        html,
        text
      });
    } catch (error) {
      logger.error("No se pudo enviar correo de solicitud de enlace.", {
        recipient: maskedEmail(ownerEmail),
        linkId,
        message: error.message
      });
      await linkRef.set(
        {
          emailStatus: "error",
          emailError: String(error.message || error).slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      throw new HttpsError(
        "unavailable",
        "No se pudo enviar el correo. Intenta nuevamente."
      );
    }

    if (!sent?.ok) {
      await linkRef.set(
        {
          emailStatus: sent?.skipped ? "skipped_no_api_key" : "error",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      throw new HttpsError(
        "failed-precondition",
        "El servicio de correo no esta configurado."
      );
    }

    await linkRef.set(
      {
        emailStatus: "sent",
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailProviderId: sent.id || "",
        emailError: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    logger.info("Solicitud de enlace entre unidades enviada.", {
      recipient: maskedEmail(ownerEmail),
      linkId,
      id: sent.id || ""
    });

    return {
      ok: true,
      linkId,
      fromWorkspaceId,
      fromWorkspaceName,
      ownerEmail
    };
  }
);

exports.claimSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para solicitar acceso."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const token = cleanCallableText(request.data?.token, 200);

    if (!workspaceId || !token) {
      throw new HttpsError(
        "invalid-argument",
        "La invitacion no esta completa."
      );
    }

    const inviteId = supervisorInviteIdFromToken(token);
    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const inviteRef =
      workspaceRef.collection("supervisorInvites").doc(inviteId);
    const result = await db.runTransaction(async transaction => {
      const workspaceSnap = await transaction.get(workspaceRef);
      const inviteSnap = await transaction.get(inviteRef);

      if (!workspaceSnap.exists || !inviteSnap.exists) {
        throw new HttpsError(
          "not-found",
          "La invitacion no existe o ya no esta disponible."
        );
      }

      const invite = inviteSnap.data() || {};
      const workspace = workspaceSnap.data() || {};
      const now = admin.firestore.Timestamp.now();
      const expiresAtMs = invite.expiresAt?.toMillis
        ? invite.expiresAt.toMillis()
        : 0;

      if (invite.workspaceId !== workspaceId || invite.tokenHash !== inviteId) {
        throw new HttpsError(
          "permission-denied",
          "La invitacion no corresponde a esta unidad."
        );
      }

      if (invite.status === "claimed" && invite.claimedByUid === uid) {
        return {
          status: "claimed",
          inviteId,
          workspaceId,
          workspaceName:
            cleanCallableText(invite.workspaceName || workspace.name, 160)
        };
      }

      if (invite.status !== "open") {
        throw new HttpsError(
          "failed-precondition",
          "Esta invitacion ya fue utilizada o cerrada."
        );
      }

      if (!expiresAtMs || expiresAtMs <= Date.now()) {
        transaction.update(inviteRef, {
          status: "expired",
          expiredAt: now,
          updatedAt: now
        });

        return {
          status: "expired",
          inviteId,
          workspaceId,
          workspaceName:
            cleanCallableText(invite.workspaceName || workspace.name, 160)
        };
      }

      transaction.update(inviteRef, {
        status: "claimed",
        claimedAt: now,
        claimedByUid: uid,
        claimedByEmail: cleanCallableText(request.auth.token?.email, 254),
        claimedByName: cleanCallableText(request.auth.token?.name, 160),
        updatedAt: now
      });

      return {
        status: "claimed",
        inviteId,
        workspaceId,
        workspaceName:
          cleanCallableText(invite.workspaceName || workspace.name, 160)
      };
    });

    if (result.status === "expired") {
      await trimSupervisorInviteHistory(result.workspaceId);
      throw new HttpsError(
        "failed-precondition",
        "Esta invitacion vencio. Solicita una nueva al propietario."
      );
    }

    return result;
  }
);

exports.approveSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para aprobar una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const inviteId = cleanCallableText(request.data?.inviteId, 100);
    const overrideProvided =
      request.data &&
      Object.prototype.hasOwnProperty.call(
        request.data,
        "permissionsOverride"
      );

    if (!workspaceId || !inviteId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la invitacion."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    return db.runTransaction(async transaction => {
      const workspaceRef = db.collection("workspaces").doc(workspaceId);
      const inviteRef =
        workspaceRef.collection("supervisorInvites").doc(inviteId);
      const workspaceSnap = await transaction.get(workspaceRef);
      const inviteSnap = await transaction.get(inviteRef);

      if (!workspaceSnap.exists || !inviteSnap.exists) {
        throw new HttpsError(
          "not-found",
          "La solicitud de invitacion no existe."
        );
      }

      const workspace = workspaceSnap.data() || {};
      const invite = inviteSnap.data() || {};

      if (invite.workspaceId !== workspaceId || invite.status !== "claimed") {
        throw new HttpsError(
          "failed-precondition",
          "Solo se pueden aprobar invitaciones reclamadas y pendientes."
        );
      }

      const memberUid = cleanCallableText(invite.claimedByUid, 160);
      const permissions = normalizeSupervisorPermissions(
        overrideProvided
          ? request.data.permissionsOverride || {}
          : invite.permissions || {}
      );

      if (!memberUid) {
        throw new HttpsError(
          "failed-precondition",
          "La invitacion no tiene usuario solicitante."
        );
      }

      if (!hasAnyPermission(permissions)) {
        throw new HttpsError(
          "invalid-argument",
          "La aprobacion debe incluir al menos un permiso visible."
        );
      }

      const memberRef =
        workspaceRef.collection("members").doc(memberUid);
      const memberSnap = await transaction.get(memberRef);

      if (memberSnap.exists) {
        throw new HttpsError(
          "already-exists",
          "Este usuario ya tiene acceso a la unidad."
        );
      }

      const now = admin.firestore.Timestamp.now();
      const workspaceName = cleanCallableText(workspace.name, 160);

      transaction.set(memberRef, {
        role: "member",
        email: cleanCallableText(invite.claimedByEmail, 254),
        displayName: cleanCallableText(invite.claimedByName, 160),
        permissions,
        supervisorInviteId: inviteId,
        joinedAt: now,
        approvedAt: now,
        approvedByUid: uid,
        permissionsUpdatedAt: now
      });
      transaction.set(
        db.collection("users")
          .doc(memberUid)
          .collection("workspaces")
          .doc(workspaceId),
        {
          name: workspaceName || workspaceId,
          role: "member",
          joinedAt: now
        },
        { merge: true }
      );
      transaction.update(inviteRef, {
        status: "approved",
        approvedAt: now,
        approvedByUid: uid,
        approvedByEmail: cleanCallableText(request.auth.token?.email, 254),
        approvedByName: cleanCallableText(request.auth.token?.name, 160),
        finalPermissions: permissions,
        updatedAt: now
      });

      return {
        status: "approved",
        inviteId,
        workspaceId,
        memberUid,
        permissions
      };
    });
  }
);

exports.rejectSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para rechazar una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const inviteId = cleanCallableText(request.data?.inviteId, 100);
    const reason = cleanCallableText(request.data?.reason, 500);

    if (!workspaceId || !inviteId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la invitacion."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    const inviteRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("supervisorInvites")
      .doc(inviteId);
    const now = admin.firestore.Timestamp.now();

    await db.runTransaction(async transaction => {
      const inviteSnap = await transaction.get(inviteRef);
      const invite = inviteSnap.data() || {};

      if (!inviteSnap.exists || invite.workspaceId !== workspaceId) {
        throw new HttpsError(
          "not-found",
          "La solicitud de invitacion no existe."
        );
      }

      if (invite.status !== "claimed") {
        throw new HttpsError(
          "failed-precondition",
          "Solo se pueden rechazar solicitudes pendientes."
        );
      }

      transaction.update(inviteRef, {
        status: "rejected",
        rejectedAt: now,
        rejectedByUid: uid,
        rejectedByEmail: cleanCallableText(request.auth.token?.email, 254),
        rejectedByName: cleanCallableText(request.auth.token?.name, 160),
        rejectReason: reason,
        updatedAt: now
      });
    });

    return {
      status: "rejected",
      inviteId,
      workspaceId
    };
  }
);

exports.revokeSupervisorInvite = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para revocar una invitacion."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const inviteId = cleanCallableText(request.data?.inviteId, 100);

    if (!workspaceId || !inviteId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la invitacion."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    const inviteRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("supervisorInvites")
      .doc(inviteId);
    const now = admin.firestore.Timestamp.now();

    await db.runTransaction(async transaction => {
      const inviteSnap = await transaction.get(inviteRef);
      const invite = inviteSnap.data() || {};

      if (!inviteSnap.exists || invite.workspaceId !== workspaceId) {
        throw new HttpsError(
          "not-found",
          "La invitacion no existe."
        );
      }

      if (!["open", "claimed"].includes(invite.status)) {
        throw new HttpsError(
          "failed-precondition",
          "Esta invitacion ya esta cerrada."
        );
      }

      transaction.update(inviteRef, {
        status: "revoked",
        revokedAt: now,
        revokedByUid: uid,
        revokedByEmail: cleanCallableText(request.auth.token?.email, 254),
        revokedByName: cleanCallableText(request.auth.token?.name, 160),
        updatedAt: now
      });
    });

    await trimSupervisorInviteHistory(workspaceId);

    return {
      status: "revoked",
      inviteId,
      workspaceId
    };
  }
);

exports.trimSupervisorInviteHistory = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para limpiar invitaciones."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);

    if (!workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar la unidad."
      );
    }

    await requireWorkspaceOwner(workspaceId, uid, request.auth.token || {});

    const deleted = await trimSupervisorInviteHistory(workspaceId);

    return {
      ok: true,
      workspaceId,
      deleted,
      limits: {
        revoked: SUPERVISOR_INVITE_REVOKED_HISTORY_LIMIT,
        expired: SUPERVISOR_INVITE_EXPIRED_HISTORY_LIMIT
      }
    };
  }
);

exports.createInterUnitLoan = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para registrar un prestamo."
      );
    }

    const data = request.data || {};
    const linkId = cleanCallableText(data.linkId, 220);
    const sourceWorkspaceId =
      cleanCallableText(data.sourceWorkspaceId, 160);
    const hostWorkspaceId =
      cleanCallableText(data.hostWorkspaceId, 160);
    const workerProfileId =
      cleanCallableText(data.workerProfileId, 120);
    const replacedProfileId =
      cleanCallableText(data.replacedProfileId, 120);
    const replacedProfileName =
      cleanCallableText(data.replacedProfileName, 160);
    const date = cleanCallableText(data.date, 10);
    const turnCode = cleanCallableText(data.turnCode, 8);
    const absenceType = cleanCallableText(data.absenceType, 160);
    const rawOvertimeHours =
      data.overtimeHours && typeof data.overtimeHours === "object"
        ? data.overtimeHours
        : null;
    const overtimeHours = rawOvertimeHours
      ? {
          d: Math.max(0, Number(rawOvertimeHours.d) || 0),
          n: Math.max(0, Number(rawOvertimeHours.n) || 0)
        }
      : null;
    const normalizedOvertimeHours =
      overtimeHours && (overtimeHours.d || overtimeHours.n)
        ? overtimeHours
        : null;

    if (
      !linkId ||
      !sourceWorkspaceId ||
      !hostWorkspaceId ||
      sourceWorkspaceId === hostWorkspaceId ||
      !workerProfileId ||
      !replacedProfileName ||
      !validISODate(date) ||
      !VALID_INTER_UNIT_TURNS.has(turnCode)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Los datos del prestamo no son validos."
      );
    }

    await Promise.all([
      requireWorkspaceRequestManager(
        hostWorkspaceId,
        uid,
        request.auth.token
      ),
      requireAcceptedWorkspaceLink(
        linkId,
        sourceWorkspaceId,
        hostWorkspaceId
      )
    ]);

    // La disponibilidad remota se valida en vivo y solo como parte de esta
    // accion explicita. No depende de meses precalculados por el navegador.
    const targetProfile = {
      estamento: cleanCallableText(data.targetEstamento, 100),
      profession: cleanCallableText(data.targetProfession, 160)
    };
    const [availability, sourceWorkspaceSnap, hostWorkspaceSnap] =
      await Promise.all([
        findCompatibleReplacementCandidates({
          db,
          requesterWorkspaceId: hostWorkspaceId,
          targetProfile,
          dateISO: date,
          turnCode,
          sourceWorkspaceId,
          linkId
        }),
        db.collection("workspaces").doc(sourceWorkspaceId).get(),
        db.collection("workspaces").doc(hostWorkspaceId).get()
      ]);

    if (
      !sourceWorkspaceSnap.exists ||
      !hostWorkspaceSnap.exists
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Una de las unidades ya no se encuentra disponible."
      );
    }

    const worker = availability.candidates.find(item =>
      cleanCallableText(item?.workerId, 120) === workerProfileId
    ) || null;

    if (!worker || worker.availability?.available !== true) {
      throw new HttpsError(
        "failed-precondition",
        "El trabajador ya no esta disponible para ese turno."
      );
    }

    const loanId = `loan_${createHash("sha256")
      .update(`${sourceWorkspaceId}|${workerProfileId}|${date}`)
      .digest("hex")
      .slice(0, 32)}`;
    const sourceAssignmentRef = db
      .collection("workspaces")
      .doc(sourceWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const hostAssignmentRef = db
      .collection("workspaces")
      .doc(hostWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const sourceWorkspace = sourceWorkspaceSnap.data() || {};
    const hostWorkspace = hostWorkspaceSnap.data() || {};
    const createdAtISO = new Date().toISOString();

    await db.runTransaction(async transaction => {
      const sourceAssignmentSnap =
        await transaction.get(sourceAssignmentRef);
      const currentAssignment = sourceAssignmentSnap.data() || {};

      if (
        sourceAssignmentSnap.exists &&
        currentAssignment.status === "active"
      ) {
        throw new HttpsError(
          "already-exists",
          "El trabajador ya tiene un prestamo activo en esa fecha."
        );
      }

      const assignment = {
        loanId,
        linkId,
        status: "active",
        sourceWorkspaceId,
        sourceWorkspaceName:
          cleanCallableText(sourceWorkspace.name, 160),
        hostWorkspaceId,
        hostWorkspaceName:
          cleanCallableText(hostWorkspace.name, 160),
        workerProfileId,
        workerName: cleanCallableText(worker.name, 160),
        workerEstamento: cleanCallableText(worker.estamento, 100),
        workerProfession: cleanCallableText(worker.profession, 160),
        replacedProfileId,
        replacedProfileName,
        date,
        turnCode,
        absenceType,
        overtimeHours: normalizedOvertimeHours,
        createdByUid: uid,
        createdByName: cleanCallableText(
          request.auth.token.name ||
          request.auth.token.email ||
          "Supervisor",
          160
        ),
        createdAtISO,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      transaction.set(sourceAssignmentRef, {
        ...assignment,
        workspaceRole: "source"
      });
      transaction.set(hostAssignmentRef, {
        ...assignment,
        workspaceRole: "host"
      });
    });

    logger.info("Prestamo entre unidades creado.", {
      loanId,
      sourceWorkspaceId,
      hostWorkspaceId,
      createdByUid: uid
    });

    return {
      ok: true,
      loanId,
      workerName: cleanCallableText(worker.name, 160)
    };
  }
);

exports.findCompatibleReplacementInLinkedUnits = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para consultar unidades enlazadas."
      );
    }

    const data = request.data || {};
    const requesterWorkspaceId =
      cleanCallableText(data.requesterWorkspaceId, 160);
    const date = cleanCallableText(data.date, 10);
    const turnCode = cleanCallableText(data.turnCode, 8);
    const targetProfile = {
      estamento: cleanCallableText(data.targetProfile?.estamento, 100),
      profession: cleanCallableText(data.targetProfile?.profession, 160)
    };

    if (
      !requesterWorkspaceId ||
      !validISODate(date) ||
      !VALID_INTER_UNIT_TURNS.has(turnCode) ||
      !targetProfile.estamento
    ) {
      throw new HttpsError(
        "invalid-argument",
        "La consulta de disponibilidad no es valida."
      );
    }

    await requireWorkspaceRequestManager(
      requesterWorkspaceId,
      uid,
      request.auth.token
    );
    const result = await findCompatibleReplacementCandidates({
      db,
      requesterWorkspaceId,
      targetProfile,
      dateISO: date,
      turnCode
    });
    let message = "";

    if (!result.units.length && !result.failedUnits.length) {
      message = "No hay unidades enlazadas aceptadas para esta unidad.";
    } else if (!result.candidates.length && result.failedUnits.length) {
      message = `No se pudo consultar: ${result.failedUnits.join(", ")}.`;
    } else if (!result.candidates.length) {
      message = "No hay trabajadores compatibles y disponibles en las unidades enlazadas para esa fecha.";
    }

    return {
      date,
      candidates: result.candidates,
      units: result.units.map(unit => ({
        workspaceId: unit.workspaceId,
        workspaceName: unit.workspaceName,
        candidateCount: unit.candidates.length
      })),
      failedUnits: result.failedUnits,
      message
    };
  }
);

// Entrega un mes historico de la PWA bajo demanda. Los documentos nuevos se
// guardan por mes; durante la migracion, si falta el mes se extrae una sola vez
// desde el documento legacy sin recalcular 24 meses en el navegador supervisor.
exports.getWorkerAppMonth = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const authUid = request.auth?.uid;

    if (!authUid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para consultar el calendario."
      );
    }

    const workspaceId = cleanCallableText(request.data?.workspaceId, 160);
    const requestedUid = cleanCallableText(request.data?.uid, 160) || authUid;
    const month = cleanCallableText(request.data?.month, 7);

    if (!workspaceId || !/^\d{4}-\d{2}$/.test(month)) {
      throw new HttpsError(
        "invalid-argument",
        "El mes solicitado no es valido."
      );
    }

    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const [memberSnap, workerLinkSnap] = await Promise.all([
      workspaceRef.collection("members").doc(authUid).get(),
      workspaceRef.collection("workerLinks").doc(authUid).get()
    ]);
    const member = memberSnap.data() || {};
    const canRead = (
      memberSnap.exists &&
      memberCanReadWorkerCalendar(member)
    ) ||
      (authUid === requestedUid && workerLinkSnap.exists);

    if (!canRead) {
      throw new HttpsError(
        "permission-denied",
        "No tienes acceso a este calendario."
      );
    }

    if (memberSnap.exists) {
      requireMemberMfa(member, request.auth.token);
    }

    const appRef = workspaceRef.collection("workerAppData").doc(requestedUid);
    const monthRef = appRef.collection("months").doc(month);
    const monthSnap = await monthRef.get();

    if (monthSnap.exists) {
      const stored = monthSnap.data() || {};

      return {
        exists: true,
        month,
        scheduleStart: cleanCallableText(stored.scheduleStart, 10),
        scheduleEnd: cleanCallableText(stored.scheduleEnd, 10),
        days: stored.days || {},
        source: "monthly"
      };
    }

    const legacySnap = await appRef.get();
    const legacy = legacySnap.data() || {};
    const days = Object.fromEntries(
      Object.entries(legacy.days || {})
        .filter(([iso]) => String(iso).startsWith(`${month}-`))
    );
    const dates = Object.keys(days).sort();

    if (!dates.length) return { exists: false, month, days: {} };

    const payload = {
      uid: requestedUid,
      workspaceId,
      month,
      profileName: cleanCallableText(legacy.profileName, 160),
      profileRut: cleanCallableText(legacy.profileRut, 32),
      scheduleStart: dates[0],
      scheduleEnd: dates[dates.length - 1],
      days,
      materializedFromLegacy: true,
      updatedAtISO: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await monthRef.set(payload, { merge: true });

    return {
      exists: true,
      month,
      scheduleStart: payload.scheduleStart,
      scheduleEnd: payload.scheduleEnd,
      days,
      source: "legacy"
    };
  }
);

exports.cancelInterUnitLoan = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para anular un prestamo."
      );
    }

    const loanId = cleanCallableText(request.data?.loanId, 160);
    const workspaceId =
      cleanCallableText(request.data?.workspaceId, 160);

    if (!loanId || !workspaceId) {
      throw new HttpsError(
        "invalid-argument",
        "Falta identificar el prestamo."
      );
    }

    await requireWorkspaceRequestManager(
      workspaceId,
      uid,
      request.auth.token
    );

    const localRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const localSnap = await localRef.get();
    const assignment = localSnap.data() || {};

    if (!localSnap.exists) {
      throw new HttpsError(
        "not-found",
        "El prestamo ya no existe."
      );
    }

    if (
      workspaceId !== assignment.sourceWorkspaceId &&
      workspaceId !== assignment.hostWorkspaceId
    ) {
      throw new HttpsError(
        "permission-denied",
        "El prestamo no pertenece a esta unidad."
      );
    }

    const sourceRef = db
      .collection("workspaces")
      .doc(assignment.sourceWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const hostRef = db
      .collection("workspaces")
      .doc(assignment.hostWorkspaceId)
      .collection("loanAssignments")
      .doc(loanId);
    const canceledAtISO = new Date().toISOString();

    await db.runTransaction(async transaction => {
      const [sourceSnap, hostSnap] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(hostRef)
      ]);

      if (!sourceSnap.exists && !hostSnap.exists) {
        throw new HttpsError(
          "not-found",
          "El prestamo ya no existe."
        );
      }

      const cancellation = {
        status: "canceled",
        canceledByUid: uid,
        canceledByName: cleanCallableText(
          request.auth.token.name ||
          request.auth.token.email ||
          "Supervisor",
          160
        ),
        canceledAtISO,
        canceledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (sourceSnap.exists) {
        transaction.set(sourceRef, cancellation, { merge: true });
      }
      if (hostSnap.exists) {
        transaction.set(hostRef, cancellation, { merge: true });
      }
    });

    logger.info("Prestamo entre unidades anulado.", {
      loanId,
      workspaceId,
      canceledByUid: uid
    });

    return { ok: true, loanId };
  }
);

// Manifiesto PWA dinamico. Conserva exclusivamente los parametros necesarios
// para abrir una invitacion desde el icono instalado; nunca registra tokens.
exports.workerInstallManifest = onRequest(
  { cors: false, maxInstances: 10 },
  (request, response) => {
    const workspace = cleanManifestParam(
      request.query.workspace,
      /^[A-Za-z0-9_-]{1,160}$/,
      160
    );
    const invite = cleanManifestParam(
      request.query.invite,
      /^[A-Za-z0-9_-]{1,220}$/,
      220
    );
    const email = cleanManifestParam(
      request.query.email,
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      254
    );
    const startParams = new URLSearchParams({ installed: "1" });

    if (workspace && invite) {
      startParams.set("workspace", workspace);
      startParams.set("invite", invite);
    }
    if (email) startParams.set("email", email);

    response.set({
      "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
      "Content-Type": "application/manifest+json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    });
    response.status(200).send(JSON.stringify({
      id: "/",
      name: "TurnoPlus Trabajador",
      short_name: "TurnoPlus",
      description: "Aplicacion movil para trabajadores TurnoPlus.",
      start_url: `/?${startParams.toString()}`,
      scope: "/",
      display: "standalone",
      background_color: "#f6f8fb",
      theme_color: "#1d6cff",
      orientation: "portrait",
      icons: [
        {
          src: "/img/icon-turnoplus-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable"
        },
        {
          src: "/img/favicon-turnoplus-calendar.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ]
    }));
  }
);

exports.cancelWorkerSwap = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  (request) => cancelWorkerSwapHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
  })
);

exports.createWorkerSwapRequest = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  (request) => createWorkerSwapRequestHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
  })
);

exports.respondWorkerSwapRequest = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  (request) => respondWorkerSwapRequestHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
  })
);

exports.chooseWorkerSwapProposal = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  (request) => chooseWorkerSwapProposalHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
  })
);

exports.createWorkerSwapOpenRequest = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  (request) => createWorkerSwapOpenRequestHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
  })
);

exports.createWorkerClockIncidentRequest = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 60
  },
  (request) => createWorkerClockIncidentRequestHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    storageBucket: () => admin.storage().bucket()
  })
);

exports.createWorkerMedicalEquipmentReport = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  (request) => createWorkerMedicalEquipmentReportHandler(request, {
    db,
    HttpsError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    storageBucket: () => admin.storage().bucket()
  })
);

exports.notifyReplacementRequestCreated = onDocumentCreated(
  "workspaces/{workspaceId}/replacementRequests/{requestId}",
  async (event) => {
    const request = event.data?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      request.status !== "pending" ||
      request.channel !== "app" ||
      !request.workerUid
    ) {
      return;
    }

    const title = `Turno extra ${request.turnoLabel || ""}`.trim();
    const body = [
      request.date ? `Fecha ${formatDateCL(request.date)}` : "",
      request.replaced ? `cubre a ${request.replaced}` : "",
      request.absenceType ? `motivo: ${request.absenceType}` : ""
    ].filter(Boolean).join(". ");

    const result = await sendWorkerPush({
      workspaceId,
      uid: request.workerUid,
      category: "overtime",
      title,
      body: body || "Tienes una solicitud de turno extra pendiente.",
      data: {
        type: "replacement_request_created",
        category: "overtime",
        requestId,
        workspaceId,
        screen: "solicitudes",
        url: APP_URL,
        tag: `replacement-${requestId}`,
        requireInteraction: "true"
      }
    });

    await event.data.ref.set({
      notificationStatus: result.sent > 0 ? "push_sent" : "push_not_sent",
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || ""
    }, { merge: true });
  }
);

exports.notifyWorkerRequestResolved = onDocumentUpdated(
  "workspaces/{workspaceId}/workerRequests/{requestId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      before.status === after.status ||
      before.status !== "pending" ||
      !["accepted", "rejected"].includes(after.status) ||
      after.source !== "worker_app" ||
      !after.createdByUid
    ) {
      return;
    }

    const accepted = after.status === "accepted";
    const title = accepted ? "Solicitud aceptada" : "Solicitud rechazada";
    const isSwap = after.type === "swap";
    const body = accepted
      ? `${requestTypeLabel(after.type)} fue aceptada por supervisor.`
      : `${requestTypeLabel(after.type)} fue rechazada por supervisor.`;
    const recipients = uniqueValues([
      after.createdByUid,
      isSwap ? after.targetUid : ""
    ]);
    const category = isSwap
      ? "swaps"
      : accepted
        ? "leaveApproved"
        : "leaveCancelled";
    const results = await Promise.all(recipients.map(uid =>
      sendWorkerPush({
        workspaceId,
        uid,
        category,
        title,
        body,
        data: {
          type: "worker_request_resolved",
          category,
          requestId,
          workspaceId,
          status: after.status,
          screen: isSwap ? "cambios" : "solicitudes",
          url: isSwap ? SWAPS_APP_URL : APP_URL,
          tag: `worker-request-${requestId}`
        }
      })
    ));
    const sent = results.reduce((total, result) => total + result.sent, 0);
    const error = results.find((result) => result.error)?.error || "";

    if (isSwap && after.swapRequestId) {
      const workspaceRef = db.collection("workspaces").doc(workspaceId);
      const resolution = {
        status: accepted ? "supervisor_accepted" : "supervisor_rejected",
        supervisorResponseAt: admin.firestore.FieldValue.serverTimestamp(),
        supervisorRequestId: requestId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const batch = db.batch();
      batch.set(
        workspaceRef.collection("workerSwapRequests").doc(after.swapRequestId),
        resolution,
        { merge: true }
      );
      if (after.openRequestId) {
        batch.set(
          workspaceRef.collection("workerSwapOpenRequests").doc(after.openRequestId),
          resolution,
          { merge: true }
        );
      }
      await batch.commit();
    }

    await event.data.after.ref.set({
      pushResponseSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushResponseSentCount: sent,
      pushResponseError: error
    }, { merge: true });
  }
);

exports.notifyWorkerSwapRequestCreated = onDocumentCreated(
  "workspaces/{workspaceId}/workerSwapRequests/{requestId}",
  async (event) => {
    const request = event.data?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      request.status !== "pending_colleague" ||
      request.source !== "worker_app" ||
      request.type !== "swap" ||
      !request.targetUid
    ) {
      return;
    }

    const body = [
      request.from ? `${request.from} solicita cambio directo` : "Solicitud de cambio directo",
      request.fecha ? `turno ${formatDateCL(request.fecha)}` : "",
      request.devolucion ? `devolucion ${formatDateCL(request.devolucion)}` : ""
    ].filter(Boolean).join(". ");

    const result = await sendWorkerPush({
      workspaceId,
      uid: request.targetUid,
      category: "swaps",
      title: "Cambio de turno",
      body: body || "Tienes una solicitud de cambio de turno pendiente.",
      data: {
        type: "worker_swap_request_created",
        category: "swaps",
        requestId,
        workspaceId,
        screen: "cambios",
        url: SWAPS_APP_URL,
        tag: `worker-swap-${requestId}`,
        requireInteraction: "true"
      }
    });

    await event.data.ref.set({
      notificationStatus: result.sent > 0 ? "push_sent" : "push_not_sent",
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || ""
    }, { merge: true });
  }
);

exports.processWorkerSwapResponse = onDocumentUpdated(
  "workspaces/{workspaceId}/workerSwapRequests/{requestId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (
      before.status !== "pending_colleague" ||
      !["colleague_accepted", "colleague_rejected"].includes(after.status) ||
      after.source !== "worker_app" ||
      after.type !== "swap"
    ) {
      return;
    }

    if (after.status === "colleague_rejected") {
      const result = await sendWorkerPush({
        workspaceId,
        uid: after.createdByUid,
        category: "swaps",
        title: "Cambio rechazado",
        body: `${after.to || "El trabajador"} rechazo el cambio de turno.`,
        data: {
          type: "worker_swap_rejected_by_colleague",
          category: "swaps",
          requestId,
          workspaceId,
          screen: "cambios",
          url: SWAPS_APP_URL,
          tag: `worker-swap-${requestId}`
        }
      });

      await event.data.after.ref.set({
        requesterPushSentAt: admin.firestore.FieldValue.serverTimestamp(),
        requesterPushSentCount: result.sent,
        requesterPushError: result.error || ""
      }, { merge: true });
      return;
    }

    const supervisorRequestId = after.supervisorRequestId || `swap_${requestId}`;
    const createdAt = new Date().toISOString();
    const workerRequestRef = db
      .collection("workspaces")
      .doc(workspaceId)
      .collection("workerRequests")
      .doc(supervisorRequestId);
    let submitted = false;

    await db.runTransaction(async (transaction) => {
      const currentSnap = await transaction.get(event.data.after.ref);
      const current = currentSnap.data() || {};

      // Una anulacion puede competir con este trigger. Solo se crea la
      // solicitud del supervisor si el cambio sigue aceptado por el colega.
      if (current.status !== "colleague_accepted") return;

      transaction.set(workerRequestRef, {
        id: supervisorRequestId,
        type: "swap",
        title: "Cambio directo",
        profile: after.from || after.profile || "",
        from: after.from || after.profile || "",
        to: after.to || after.targetProfile || "",
        targetProfile: after.to || after.targetProfile || "",
        targetUid: after.targetUid || "",
        createdByUid: after.createdByUid || "",
        createdByEmail: after.createdByEmail || "",
        source: "worker_app",
        status: "pending",
        date: after.fecha || after.date || "",
        fecha: after.fecha || after.date || "",
        returnDate: after.devolucion || after.returnDate || "",
        devolucion: after.devolucion || after.returnDate || "",
        ownTurnLabel: after.ownTurnLabel || "",
        returnTurnLabel: after.returnTurnLabel || "",
        detail: after.detail || "",
        swapRequestId: requestId,
        colleagueAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(event.data.after.ref, {
        status: "pending_supervisor",
        supervisorRequestId,
        supervisorSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      submitted = true;
    });

    if (!submitted) return;

    await sendWorkerPush({
      workspaceId,
      uid: after.createdByUid,
      category: "swaps",
      title: "Cambio aceptado por colega",
      body: "La solicitud fue enviada al supervisor para aprobacion.",
      data: {
        type: "worker_swap_sent_to_supervisor",
        category: "swaps",
        requestId,
        supervisorRequestId,
        workspaceId,
        screen: "cambios",
        url: SWAPS_APP_URL,
        tag: `worker-swap-${requestId}`
      }
    });
  }
);

// Cambio de turno ABIERTO: el trabajador crea una solicitud abierta y esta CF
// la reparte a los companeros elegibles (compatibles, con opt-in, libres ese dia
// y bajo el limite mensual), creando una oferta type="open_swap" a cada uno.
exports.fanOutOpenSwapRequest = onDocumentCreated(
  "workspaces/{workspaceId}/workerSwapOpenRequests/{openId}",
  async (event) => {
    const openReq = event.data?.data() || {};
    const { workspaceId, openId } = event.params;

    if (
      openReq.status !== "open" ||
      openReq.source !== "worker_app" ||
      !openReq.createdByUid ||
      !openReq.ownDate
    ) {
      return;
    }

    const requesterUid = openReq.createdByUid;
    const ownDate = String(openReq.ownDate);
    const wsRef = db.collection("workspaces").doc(workspaceId);

    const requesterCandSnap = await wsRef
      .collection("workerSwapCandidates")
      .doc(requesterUid)
      .get();
    const compatibleUids = Array.isArray(requesterCandSnap.data()?.compatibleWorkerUids)
      ? requesterCandSnap.data().compatibleWorkerUids
      : [];

    const eligible = [];

    for (const colleagueUid of compatibleUids) {
      if (!colleagueUid || colleagueUid === requesterUid) continue;

      const candSnap = await wsRef
        .collection("workerSwapCandidates")
        .doc(colleagueUid)
        .get();
      const cand = candSnap.data() || {};
      const appSnap = await wsRef
        .collection("workerAppData")
        .doc(colleagueUid)
        .get();
      const app = appSnap.data() || {};

      // Opt-in de cambios de turno activado.
      if (app.swapOptIn?.allowSwapRequests !== true) continue;
      // Perfil activo.
      if (cand.status && cand.status !== "active") continue;
      // No tiene ese dia bloqueado.
      const blocked = Array.isArray(cand.blockedDayDates) ? cand.blockedDayDates : [];
      if (blocked.includes(ownDate)) continue;
      // Esta libre ese dia.
      const day = cand.days?.[ownDate];
      const dayClass = String(day?.className || "").toLowerCase();
      const dayLabel = String(day?.label || "").toLowerCase();
      if (dayClass !== "libre" && dayLabel !== "libre") continue;
      // Bajo el limite mensual de cambios.
      const limit = app.swapLimit;
      if (limit?.enabled && Number(limit.used) >= Number(limit.limit)) continue;

      eligible.push({
        uid: colleagueUid,
        profileName: cand.profileName || app.profileName || "Companero"
      });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    let distributed = false;

    await db.runTransaction(async (transaction) => {
      const currentSnap = await transaction.get(event.data.ref);
      const current = currentSnap.data() || {};

      if (current.status !== "open") return;

      eligible.forEach((colleague) => {
        const offerId = `${openId}_${colleague.uid}`;
        const offerRef = wsRef.collection("workerSwapRequests").doc(offerId);

        transaction.set(offerRef, {
          id: offerId,
          workspaceId,
          type: "open_swap",
          source: "worker_app",
          status: "pending_colleague",
          openRequestId: openId,
          groupId: openId,
          createdByUid: requesterUid,
          createdByEmail: openReq.createdByEmail || "",
          from: openReq.profileName || "",
          to: colleague.profileName || "",
          targetUid: colleague.uid,
          fecha: ownDate,
          date: ownDate,
          ownTurnLabel: openReq.ownTurnLabel || "",
          ownTurnClassName: openReq.ownTurnClassName || "",
          returnDate: "",
          returnTurnLabel: "",
          createdAt: now,
          updatedAt: now
        }, { merge: true });
      });
      transaction.set(event.data.ref, {
        status: "distributed",
        recipientUids: eligible.map((colleague) => colleague.uid),
        recipientCount: eligible.length,
        distributedAt: now,
        updatedAt: now
      }, { merge: true });
      distributed = true;
    });

    if (!distributed) return;

    const pushResults = await Promise.all(eligible.map((colleague) =>
      sendWorkerPush({
        workspaceId,
        uid: colleague.uid,
        category: "swaps",
        title: "Cambio de turno disponible",
        body: `${openReq.profileName || "Un companero"} ofrece su turno ${openReq.ownTurnLabel || ""} del ${formatDateCL(ownDate)}.`,
        data: {
          type: "open_swap_offer",
          category: "swaps",
          openRequestId: openId,
          workspaceId,
          screen: "cambios",
          url: SWAPS_APP_URL,
          tag: `open-swap-${openId}`,
          requireInteraction: "true"
        }
      })
    ));
    const sent = pushResults.reduce((total, result) => total + result.sent, 0);

    await event.data.ref.set({
      pushSentCount: sent,
      updatedAt: now
    }, { merge: true });
  }
);

// Cambio abierto: el colega no "gana" de inmediato; envia una propuesta de
// devolucion al trabajador que origino la solicitud. Ese trabajador elige una
// propuesta desde la PWA y recien ahi se crea la solicitud del supervisor.
exports.processOpenSwapResponse = onDocumentUpdated(
  "workspaces/{workspaceId}/workerSwapRequests/{requestId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId, requestId } = event.params;

    if (after.type !== "open_swap") return;

    const groupId = after.groupId || after.openRequestId;

    if (
      before.status === "pending_colleague" &&
      after.status === "proposal_sent"
    ) {
      await sendWorkerPush({
        workspaceId,
        uid: after.createdByUid,
        category: "swaps",
        title: "Nueva propuesta de cambio",
        body: `${after.to || "Un companero"} propuso devolverte el turno el ${formatDateCL(after.returnDate || after.devolucion || "")}.`,
        data: {
          type: "open_swap_proposal_sent",
          category: "swaps",
          requestId,
          openRequestId: groupId,
          workspaceId,
          screen: "cambios",
          url: SWAPS_APP_URL,
          tag: `open-swap-${groupId}`
        }
      });
      return;
    }

    if (
      before.status !== "proposal_sent" ||
      after.status !== "pending_supervisor"
    ) {
      return;
    }

    const wsRef = db.collection("workspaces").doc(workspaceId);
    const siblingsSnap = await wsRef
      .collection("workerSwapRequests")
      .where("groupId", "==", groupId)
      .get();
    const batch = db.batch();

    siblingsSnap.docs.forEach((docSnap) => {
      if (docSnap.id === requestId) return;

      const sibling = docSnap.data() || {};

      if (["pending_colleague", "proposal_sent"].includes(sibling.status)) {
        batch.set(docSnap.ref, {
          status: "superseded",
          supersededAt: admin.firestore.FieldValue.serverTimestamp(),
          supersededByRequestId: requestId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });

    await batch.commit();

    await sendWorkerPush({
      workspaceId,
      uid: after.targetUid,
      category: "swaps",
      title: "Propuesta elegida",
      body: "Tu propuesta fue elegida y se envio al supervisor para aprobacion.",
      data: {
        type: "open_swap_proposal_chosen",
        category: "swaps",
        requestId,
        openRequestId: groupId,
        supervisorRequestId: after.supervisorRequestId || "",
        workspaceId,
        screen: "cambios",
        url: SWAPS_APP_URL,
        tag: `open-swap-${groupId}`
      }
    });
  }
);

// Eliminacion de entorno programada/anulada: avisa a los trabajadores enlazados
// (push) y propaga el estado a su workerAppData para mostrar el banner/cuenta
// regresiva en la app del trabajador.
exports.notifyWorkspaceDeletion = onDocumentUpdated(
  "workspaces/{workspaceId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { workspaceId } = event.params;
    const wasPending = before.deletionStatus === "pending_deletion";
    const isPending = after.deletionStatus === "pending_deletion";

    if (wasPending === isPending) return;

    const wsRef = db.collection("workspaces").doc(workspaceId);
    const linksSnap = await wsRef.collection("workerLinks").get();
    const uids = linksSnap.docs.map((docSnap) => docSnap.id).filter(Boolean);
    const workspaceName = after.name || before.name || "tu unidad";
    const scheduledMs = after.deletionScheduledAt?.toMillis
      ? after.deletionScheduledAt.toMillis()
      : null;

    const deletionValue = isPending
      ? { status: "pending_deletion", scheduledAtMs: scheduledMs, workspaceName }
      : admin.firestore.FieldValue.delete();

    const batch = db.batch();
    uids.forEach((uid) => {
      batch.set(
        wsRef.collection("workerAppData").doc(uid),
        { workspaceDeletion: deletionValue, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    });
    await batch.commit();

    const title = isPending ? "Tu unidad sera eliminada" : "Eliminacion anulada";
    const body = isPending
      ? "Tu supervisor programo eliminar la unidad. Descarga tus datos (turnos, HH.EE) antes del cierre."
      : "Se anulo la eliminacion de tu unidad. Todo sigue normal.";

    await Promise.all(uids.map((uid) =>
      sendWorkerPush({
        workspaceId,
        uid,
        category: "messages",
        title,
        body,
        data: {
          type: "workspace_deletion",
          category: "messages",
          workspaceId,
          status: isPending ? "pending_deletion" : "canceled",
          screen: "turnos",
          url: APP_URL,
          tag: `workspace-deletion-${workspaceId}`,
          requireInteraction: isPending ? "true" : "false"
        }
      })
    ));
  }
);

// Ejecuta el borrado definitivo de los entornos cuyo plazo de gracia vencio.
// Nota: Cloud Scheduler no opera en southamerica-west1, por eso esta funcion
// corre en us-central1 (la region solo define donde corre el job; el acceso a
// Firestore es global).
exports.purgeWorkspaceDeletions = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1" },
  async () => {
    const nowMs = Date.now();
    const snap = await db
      .collection("workspaces")
      .where("deletionStatus", "==", "pending_deletion")
      .get();

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const scheduledMs = data.deletionScheduledAt?.toMillis
        ? data.deletionScheduledAt.toMillis()
        : null;

      // Guarda: solo borrar si sigue pendiente y el plazo realmente vencio.
      if (!scheduledMs || scheduledMs > nowMs) continue;

      const wsId = docSnap.id;
      const wsRef = db.collection("workspaces").doc(wsId);

      try {
        // 1. Quitar el entorno del indice de cada miembro (users/{uid}/workspaces).
        const [membersSnap, workerLinksSnap, invitesSnap] = await Promise.all([
          wsRef.collection("members").get(),
          wsRef.collection("workerLinks").get(),
          wsRef.collection("workerAppInvites").get()
        ]);
        const writer = db.bulkWriter();

        membersSnap.docs.forEach((member) => {
          writer.delete(
            db.collection("users").doc(member.id).collection("workspaces").doc(wsId)
          );
        });
        workerLinksSnap.docs.forEach((link) => {
          writer.delete(
            db.collection("users").doc(link.id).collection("workerLinks").doc(wsId)
          );
        });
        invitesSnap.docs.forEach((invite) => {
          const email = normalizeEmail(invite.data()?.email);

          if (isValidEmail(email)) {
            writer.delete(
              db.collection("workerAppEmailInvites")
                .doc(email)
                .collection("items")
                .doc(invite.id)
            );
          }
        });

        // 2. Eliminar los enlaces con otras unidades (ambos lados).
        const linksFrom = await db
          .collection("workspaceLinks")
          .where("fromWorkspaceId", "==", wsId)
          .get();
        const linksTo = await db
          .collection("workspaceLinks")
          .where("toWorkspaceId", "==", wsId)
          .get();
        [...linksFrom.docs, ...linksTo.docs].forEach((link) =>
          writer.delete(link.ref)
        );

        await writer.close();

        // 3. Borrado recursivo del entorno (doc + subcolecciones).
        await db.recursiveDelete(wsRef);

        logger.info(`Entorno eliminado definitivamente: ${wsId}`);
      } catch (error) {
        logger.error(`No se pudo eliminar el entorno ${wsId}`, error);
      }
    }
  }
);

exports.notifySupervisorMessageCreated = onDocumentCreated(
  "workspaces/{workspaceId}/workerMessages/{workerUid}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data() || {};
    const { workspaceId, workerUid, messageId } = event.params;

    if (
      message.sender !== "supervisor" ||
      !workerUid ||
      !message.text
    ) {
      return;
    }

    const result = await sendWorkerPush({
      workspaceId,
      uid: workerUid,
      category: "messages",
      title: "Mensaje de supervisor",
      body: String(message.text).slice(0, 140),
      data: {
        type: "supervisor_message_created",
        category: "messages",
        messageId,
        workspaceId,
        screen: "mensajes",
        url: `${WORKER_APP_BASE_URL}?screen=mensajes`,
        tag: `supervisor-message-${messageId}`,
        requireInteraction: "true",
        vibrate: "true"
      }
    });

    await event.data.ref.set({
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || "",
      pushStatus: result.sent > 0 ? "push_sent" : "push_not_sent"
    }, { merge: true });
  }
);

exports.notifyWorkerPeerMessageCreated = onDocumentCreated(
  "workspaces/{workspaceId}/workerPeerThreads/{threadId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data() || {};
    const { workspaceId, threadId, messageId } = event.params;
    const senderUid = String(message.senderUid || "");
    const targetUid = String(message.targetUid || "");
    const text = String(message.text || "").trim().slice(0, 2000);

    if (
      !senderUid ||
      !targetUid ||
      senderUid === targetUid ||
      !text
    ) {
      return;
    }

    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const [threadSnap, senderLinkSnap, targetLinkSnap] = await Promise.all([
      workspaceRef.collection("workerPeerThreads").doc(threadId).get(),
      workspaceRef.collection("workerLinks").doc(senderUid).get(),
      workspaceRef.collection("workerLinks").doc(targetUid).get()
    ]);
    const participants = threadSnap.data()?.participantUids || [];

    if (
      !threadSnap.exists ||
      !senderLinkSnap.exists ||
      !targetLinkSnap.exists ||
      !Array.isArray(participants) ||
      !participants.includes(senderUid) ||
      !participants.includes(targetUid)
    ) {
      logger.warn("Mensaje entre trabajadores con relacion invalida.", {
        workspaceId,
        threadId,
        messageId
      });
      return;
    }

    const senderName = String(
      senderLinkSnap.data()?.profileName || "trabajador"
    ).trim().slice(0, 160);

    const result = await sendWorkerPush({
      workspaceId,
      uid: targetUid,
      category: "messages",
      title: `Mensaje de ${senderName}`,
      body: text.slice(0, 140),
      data: {
        type: "worker_peer_message_created",
        category: "messages",
        messageId,
        threadId,
        senderUid,
        targetUid,
        workspaceId,
        screen: "mensajes",
        url: `${WORKER_APP_BASE_URL}?screen=mensajes&peer=${encodeURIComponent(senderUid)}`,
        tag: `worker-peer-message-${messageId}`,
        requireInteraction: "true",
        vibrate: "true"
      }
    });

    await event.data.ref.set({
      pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
      pushSentCount: result.sent,
      pushError: result.error || "",
      pushStatus: result.sent > 0 ? "push_sent" : "push_not_sent"
    }, { merge: true });
  }
);

async function sendWorkerPush({ workspaceId, uid, category, title, body, data }) {
  const tokens = await getWorkerTokens(workspaceId, uid, category);

  if (!tokens.length) {
    logger.info("Sin tokens push activos para trabajador.", {
      workspaceId,
      uid,
      category
    });
    return { sent: 0, error: "Sin tokens activos o permitidos." };
  }

  let sent = 0;
  let firstError = "";

  await Promise.all(tokens.map(async (item) => {
    try {
      await admin.messaging().send(buildMessage(item, {
        title,
        body,
        data
      }));
      sent += 1;
    } catch (error) {
      firstError ||= error.message || String(error);
      logger.warn("No se pudo enviar push FCM.", {
        workspaceId,
        uid,
        category,
        code: error.code,
        message: error.message
      });

      if (INVALID_TOKEN_CODES.has(error.code)) {
        await item.ref.set({
          active: false,
          disabledAt: admin.firestore.FieldValue.serverTimestamp(),
          lastError: error.code || error.message || "invalid_token"
        }, { merge: true });
      }
    }
  }));

  logger.info("Push FCM procesado.", {
    workspaceId,
    uid,
    category,
    tokenCount: tokens.length,
    sent,
    error: sent ? "" : firstError
  });

  return { sent, error: sent ? "" : firstError };
}

async function getWorkerTokens(workspaceId, uid, category) {
  const snapshot = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("workerPushTokens")
    .doc(uid)
    .collection("tokens")
    .where("active", "==", true)
    .get();

  return snapshot.docs
    .map((doc) => ({
      ref: doc.ref,
      id: doc.id,
      ...doc.data()
    }))
    .filter((item) => item.token && tokenAllows(item, category));
}

// ─────────── Alertas de recordatorio (push programado) ───────────
// Los recordatorios con alerta viven en reminderAlerts/{uid} (los escribe la
// PWA). Esta funcion, cada 15 min, revisa cuales tocan AHORA (hora de Chile) y
// envia el push, evitando reenviar con el mapa "sent".

function reminderTz(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(date).map(part => [part.type, part.value])
  );
  const iso = `${parts.year}-${parts.month}-${parts.day}`;

  return { iso, hhmm: `${parts.hour}:${parts.minute}`, tomorrowIso: addDaysIso(iso, 1) };
}

function addDaysIso(iso, amount) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function parseReminderIso(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

function reminderDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function normalizeReminderPeriodicity(value) {
  return String(value || "una sola vez")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

// ¿La fecha isoDate es una ocurrencia del recordatorio? (misma logica que la PWA)
function isReminderOccurrence(reminder, isoDate) {
  const origin = parseReminderIso(reminder?.date);
  const target = parseReminderIso(isoDate);
  if (!origin || !target) return false;

  const period = normalizeReminderPeriodicity(reminder?.periodicity);
  const originDate = new Date(origin.year, origin.month, origin.day);
  const targetDate = new Date(target.year, target.month, target.day);

  if (period === "diaria") {
    return targetDate >= originDate;
  }
  if (period === "semanal") {
    return targetDate >= originDate && targetDate.getDay() === originDate.getDay();
  }
  if (period === "mensual") {
    if (target.year < origin.year ||
      (target.year === origin.year && target.month < origin.month)) return false;
    return target.day === Math.min(origin.day, reminderDaysInMonth(target.year, target.month));
  }
  if (period === "anual") {
    if (target.year < origin.year || target.month !== origin.month) return false;
    return target.day === Math.min(origin.day, reminderDaysInMonth(target.year, target.month));
  }
  return isoDate === reminder?.date;
}

// Recordatorios que deben avisar AHORA (aun no enviados). Puro, para testear.
function remindersDueNow(reminders, now, sent = {}) {
  const due = [];

  for (const reminder of (Array.isArray(reminders) ? reminders : [])) {
    const alertTime = /^\d{2}:\d{2}$/.test(reminder?.alertTime) ? reminder.alertTime : "09:00";
    if (now.hhmm < alertTime) continue; // aun no llega la hora hoy

    if (isReminderOccurrence(reminder, now.iso)) {
      const key = `${reminder.id}:${now.iso}:day_of`;
      if (!sent[key]) due.push({ key, title: "Recordatorio", body: String(reminder.title || "Recordatorio") });
    }

    if (reminder?.alertDayBefore && isReminderOccurrence(reminder, now.tomorrowIso)) {
      const key = `${reminder.id}:${now.tomorrowIso}:day_before`;
      if (!sent[key]) due.push({ key, title: "Recordatorio (mañana)", body: `Mañana: ${String(reminder.title || "Recordatorio")}` });
    }
  }

  return due;
}

// Descarta marcas de envio de ocurrencias viejas (> 2 dias) para no crecer.
function pruneReminderSent(sent, todayIso) {
  const cutoff = addDaysIso(todayIso, -2);
  const out = {};
  for (const [key, value] of Object.entries(sent || {})) {
    const occ = String(key).split(":")[1] || "";
    if (occ >= cutoff) out[key] = value;
  }
  return out;
}

exports.sendReminderAlerts = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "us-central1",
    timeZone: "America/Santiago",
    timeoutSeconds: 300
  },
  async () => {
    const now = reminderTz();
    const snap = await db.collection("reminderAlerts").get();
    let pushed = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const uid = String(data.uid || docSnap.id || "").trim();
      const workspaceId = String(data.workspaceId || "").trim();
      const reminders = Array.isArray(data.reminders) ? data.reminders : [];

      if (!uid || !workspaceId || !reminders.length) continue;

      const sent = (data.sent && typeof data.sent === "object") ? { ...data.sent } : {};
      const due = remindersDueNow(reminders, now, sent);
      let dirty = false;

      try {
        for (const item of due) {
          const result = await sendWorkerPush({
            workspaceId,
            uid,
            category: "reminders",
            title: item.title,
            body: item.body,
            data: {
              category: "reminders",
              screen: "turnos",
              tag: item.key,
              requireInteraction: "true",
              vibrate: "true"
            }
          });

          if (result.sent > 0) {
            sent[item.key] = now.iso;
            dirty = true;
            pushed += 1;
          }
        }

        // Solo se escribe si cambio algo (se envio un push o se podo una marca
        // vieja). Sin esto, cada corrida escribiria el doc de cada trabajador
        // aunque no haya nada que hacer (96 escrituras/dia por trabajador).
        const beforeCount = Object.keys(sent).length;
        const nextSent = pruneReminderSent(sent, now.iso);

        if (dirty || Object.keys(nextSent).length !== beforeCount) {
          await docSnap.ref.set({ sent: nextSent }, { merge: true });
        }
      } catch (error) {
        logger.error("reminder alerts: fallo por trabajador", {
          uid,
          error: error?.message || String(error)
        });
      }
    }

    logger.info("reminder alerts procesados", { workers: snap.size, pushed });
  }
);

// Temporizador de la cobertura automatica por etapas.
//
// El navegador arranca la campaña y manda la primera oleada; de la segunda en
// adelante manda esto, porque las etapas son de 24 horas y no pueden depender de
// que alguien tenga la pagina abierta.
//
// Cada 15 minutos: una etapa que vencia a las 03:00 sale a mas tardar 03:15. Con
// etapas de 24 h ese desfase no cambia nada, y bajar el intervalo multiplicaria
// el barrido de campañas sin ganar nada.
//
// La memoria va en 1 GiB porque una oleada recorre TODOS los trabajadores del
// entorno calculando sus horas extras del mes: es el mismo trabajo que en el
// navegador dispara el barrido cooperativo.
exports.advanceAutoCoverage = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "us-central1",
    timeZone: "America/Santiago",
    timeoutSeconds: 540,
    memory: "1GiB"
  },
  async () => {
    const summary = await advanceAutoCoverageCampaigns({
      db,
      logger,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info("cobertura automatica procesada", summary);
  }
);

function buildMessage(tokenInfo, payload) {
  const settings = tokenInfo.settings || {};
  const alertMode = settings.alertMode === "vibration" ? "vibration" : "sound";
  const silent = false;
  const vibrate = [320, 120, 320, 120, 220];
  const data = stringifyData({
    ...payload.data,
    title: payload.title,
    body: payload.body,
    icon: APP_ICON,
    badge: APP_BADGE,
    alertMode,
    vibrate: "true",
    silent: "false",
    requireInteraction: payload.data?.requireInteraction || "false"
  });

  return {
    token: tokenInfo.token,
    notification: {
      title: payload.title || "TurnoPlus",
      body: payload.body || "Nueva notificacion."
    },
    data,
    webpush: {
      headers: {
        Urgency: "high",
        TTL: "300"
      },
      notification: {
        title: payload.title || "TurnoPlus",
        body: payload.body || "Nueva notificacion.",
        icon: APP_ICON,
        badge: APP_BADGE,
        tag: data.tag || data.requestId || "turnoplus-notification",
        renotify: true,
        requireInteraction: data.requireInteraction === "true",
        silent,
        vibrate,
        data
      },
      fcmOptions: {
        link: data.url || APP_URL
      }
    }
  };
}

function tokenAllows(tokenInfo, category) {
  const settings = tokenInfo.settings || {};
  const categories = settings.categories || {};
  const alertWindow = settings.alertWindow || "24/7";

  if (category && categories[category] === false) return false;
  if (alertWindow === "Nunca") return false;

  if (alertWindow === "08:00 a 21:00") {
    const hour = Number(new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      hour12: false
    }).format(new Date()));

    return hour >= 8 && hour < 21;
  }

  return true;
}

function uniqueValues(values) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function stringifyData(value) {
  return Object.fromEntries(
    Object.entries(value || {}).map(([key, entry]) => [
      key,
      String(entry ?? "")
    ])
  );
}

function normalizeEventDates(value) {
  const source = Array.isArray(value) ? value : [value];

  return [...new Set(
    source
      .map((item) => String(item || "").trim())
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
      .sort()
  )].slice(0, 120);
}

function calendarEventDeepLink(event) {
  const params = new URLSearchParams({
    screen: "turnos",
    workspace: event.workspaceId || ""
  });

  if (event.affectedDates?.[0]) {
    params.set("date", event.affectedDates[0]);
  }
  if (event.eventId) {
    params.set("notification", event.eventId);
  }

  return `${WORKER_APP_BASE_URL}?${params.toString()}`;
}

function normalizeCalendarEvent(raw = {}, workspaceId, eventId) {
  const affectedDates = normalizeEventDates(raw.affectedDates);
  const changeType = cleanCallableText(
    raw.changeType || "calendar_bulk_updated",
    80
  );
  const title = cleanCallableText(
    raw.title || "Tu calendario fue modificado",
    120
  );
  const message = cleanCallableText(
    raw.message || "Revisa tu calendario actualizado en TurnoPlus.",
    300
  );

  return {
    eventId,
    workspaceId,
    workerId: cleanCallableText(raw.workerId || raw.profileName, 180),
    profileName: cleanCallableText(raw.profileName || raw.workerId, 180),
    affectedUserId: cleanCallableText(
      raw.affectedUserId || raw.userId || raw.uid,
      160
    ),
    changeType,
    affectedDates,
    source: cleanCallableText(raw.source || "supervisor_action", 80),
    title,
    message,
    entityId: cleanCallableText(raw.entityId, 180),
    batchId: cleanCallableText(raw.batchId, 180),
    operationId: cleanCallableText(raw.operationId, 180),
    version: Number(raw.version) || 1,
    createdByUid: cleanCallableText(raw.createdByUid || raw.createdBy?.uid, 160),
    createdByName: cleanCallableText(raw.createdBy?.name || raw.createdByName, 160),
    clientCreatedAtISO: cleanCallableText(raw.clientCreatedAtISO, 40)
  };
}

async function requestWorkerCalendarProjection(workspaceRef, calendarEvent, eventId) {
  const profileName = cleanCallableText(
    calendarEvent.profileName || calendarEvent.workerId,
    180
  );

  if (!profileName) return;

  await workspaceRef
    .collection("projectionRequests")
    .doc(`calendar_${eventId}`)
    .set({
      profiles: [profileName],
      source: "calendar_event",
      eventId,
      requestedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: false })
    .catch((error) => {
      // Si el marcador ya existe por reintento, la proyeccion ya quedo
      // solicitada. No se debe bloquear la notificacion por este respaldo.
      if (String(error?.code || "") !== "6" &&
          String(error?.message || "").toLowerCase().includes("already exists") === false) {
        logger.warn("No se pudo solicitar proyeccion PWA desde evento de calendario.", {
          workspaceId: calendarEvent.workspaceId,
          eventId,
          profileName,
          error: error?.message || String(error)
        });
      }
    });
}

exports.processWorkerCalendarEvent = onDocumentCreated(
  {
    document: "workspaces/{workspaceId}/calendarEvents/{eventId}",
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (event) => {
    const { workspaceId, eventId } = event.params;
    const ref = event.data?.ref;
    const raw = event.data?.data() || {};
    const calendarEvent = normalizeCalendarEvent(raw, workspaceId, eventId);
    const uid = calendarEvent.affectedUserId;

    if (!ref || !uid) {
      if (ref) {
        await ref.set({
          status: "failed",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: "missing_affected_user"
        }, { merge: true });
      }
      return;
    }

    const workspaceRef = db.collection("workspaces").doc(workspaceId);
    const linkRef = workspaceRef.collection("workerLinks").doc(uid);
    const notificationRef = workspaceRef
      .collection("workerNotifications")
      .doc(uid)
      .collection("items")
      .doc(eventId);
    const linkSnap = await linkRef.get();

    if (!linkSnap.exists) {
      await ref.set({
        status: "skipped",
        skippedReason: "worker_not_linked",
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }

    const link = linkSnap.data() || {};
    const profileName = calendarEvent.profileName ||
      cleanCallableText(link.profileName, 180);
    const deepLink = calendarEventDeepLink(calendarEvent);

    await requestWorkerCalendarProjection(workspaceRef, calendarEvent, eventId);

    let shouldSendPush = false;

    await db.runTransaction(async (transaction) => {
      const notificationSnap = await transaction.get(notificationRef);

      if (notificationSnap.exists) {
        transaction.set(ref, {
          status: "sent",
          duplicateAvoided: true,
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }

      transaction.set(notificationRef, {
        type: "calendar_change",
        title: calendarEvent.title,
        message: calendarEvent.message,
        workerId: calendarEvent.workerId || profileName,
        profileName,
        workspaceId,
        affectedDates: calendarEvent.affectedDates,
        changeType: calendarEvent.changeType,
        source: calendarEvent.source,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        clientCreatedAtISO: calendarEvent.clientCreatedAtISO || "",
        readAt: null,
        isRead: false,
        eventId,
        entityId: calendarEvent.entityId,
        batchId: calendarEvent.batchId,
        operationId: calendarEvent.operationId,
        createdByUid: calendarEvent.createdByUid,
        createdByName: calendarEvent.createdByName,
        deepLink,
        pushStatus: "pending"
      }, { merge: false });
      transaction.set(ref, {
        status: "processing",
        notificationPath: notificationRef.path,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      shouldSendPush = true;
    });

    if (!shouldSendPush) return;

    let pushResult;

    try {
      pushResult = await sendWorkerPush({
        workspaceId,
        uid,
        category: "calendar_changes",
        title: calendarEvent.title,
        body: calendarEvent.message,
        data: {
          type: "worker_calendar_changed",
          category: "calendar_changes",
          eventId,
          workspaceId,
          workerId: calendarEvent.workerId || profileName,
          profileName,
          changeType: calendarEvent.changeType,
          affectedDate: calendarEvent.affectedDates[0] || "",
          affectedDates: calendarEvent.affectedDates.join(","),
          screen: "turnos",
          url: deepLink,
          tag: `calendar-change-${eventId}`,
          requireInteraction: "false",
          vibrate: "true"
        }
      });
    } catch (error) {
      logger.warn("No se pudo enviar push de cambio de calendario.", {
        workspaceId,
        uid,
        eventId,
        error: error?.message || String(error)
      });
      pushResult = {
        sent: 0,
        error: error?.message || String(error)
      };
    }

    const pushStatus = pushResult.sent > 0 ? "push_sent" : "push_not_sent";

    await Promise.all([
      notificationRef.set({
        pushStatus,
        pushSentAt: admin.firestore.FieldValue.serverTimestamp(),
        pushSentCount: pushResult.sent,
        pushError: pushResult.error || ""
      }, { merge: true }),
      ref.set({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        pushStatus,
        pushSentCount: pushResult.sent,
        pushError: pushResult.error || ""
      }, { merge: true })
    ]);
  }
);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildInviteEmail({ workerName, unit, ctaUrl, installUrl, isGoogleEmail }) {
  const safeName = escapeHtml(workerName);
  const safeUnit = escapeHtml(unit);
  const safeCta = escapeHtml(ctaUrl);
  const safeInstall = escapeHtml(installUrl);
  const ctaLabel = "Enlazar mi app";
  const accessNote =
    "Toca el boton para abrir tu invitacion y enlazar la app. No enviaremos un segundo correo de verificacion; el enlace es personal, no lo compartas.";

  const text = [
    `Hola ${workerName}.`,
    `Te invitamos a enlazar tu aplicacion TurnoPlus Trabajador con ${unit}.`,
    `Abre este enlace personal para enlazar tu app: ${ctaUrl}`,
    `Para tenerla como app en tu celular: abre ${installUrl} y, en el menu del navegador, elige "Agregar a pantalla de inicio" o "Instalar app".`,
    "Si no esperabas esta invitacion, puedes ignorar este correo."
  ].join("\n\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2933; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">TurnoPlus Trabajador</h2>
      <p>Hola <strong>${safeName}</strong>,</p>
      <p>Te invitamos a enlazar tu aplicacion <strong>TurnoPlus Trabajador</strong> con <strong>${safeUnit}</strong> para revisar tus turnos, permisos y solicitudes desde tu celular.</p>
      <p>${accessNote}</p>
      <p style="margin: 24px 0;">
        <a href="${safeCta}" style="background: #1d6cff; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: bold; display: inline-block;">${ctaLabel}</a>
      </p>
      <p style="font-size: 14px; color: #52606d;">Si el boton no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${safeCta}">${safeCta}</a>
      </p>
      <div style="font-size: 14px; color: #52606d; background: #f1f5f9; border-radius: 10px; padding: 12px 14px; margin-top: 8px;">
        <strong>Instalala como app en tu celular</strong><br>
        Abre <a href="${safeInstall}">${safeInstall}</a> en tu navegador y elige <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong>. Asi la tendras como una app normal, sin pasar por una tienda.
      </div>
      <hr style="border: none; border-top: 1px solid #e4e7eb; margin: 24px 0;">
      <p style="font-size: 12px; color: #9aa5b1;">Si no esperabas esta invitacion, puedes ignorar este correo.</p>
    </div>
  `;

  return { html, text };
}

function buildSupervisorInviteEmail({
  workspaceName,
  inviteUrl,
  expiresAtMs,
  senderName
}) {
  const unit = String(workspaceName || "TurnoPlus").trim();
  const sender = String(senderName || "un propietario").trim();
  const expiresAt = expiresAtMs ? new Date(expiresAtMs) : null;
  const expiresText =
    expiresAt && !Number.isNaN(expiresAt.getTime())
      ? expiresAt.toLocaleString("es-CL", {
          timeZone: "America/Santiago",
          dateStyle: "medium",
          timeStyle: "short"
        })
      : "";
  const safeUnit = escapeHtml(unit);
  const safeSender = escapeHtml(sender);
  const safeInviteUrl = escapeHtml(inviteUrl);
  const safeExpiresText = escapeHtml(expiresText);

  const text = [
    "Hola.",
    `${sender} te invito a solicitar acceso como supervisor a la unidad "${unit}" en TurnoPlus.`,
    `Abre este enlace seguro: ${inviteUrl}`,
    "Inicia sesion con Google. La invitacion es de un solo uso y el propietario debe aprobar tu solicitud antes de que puedas entrar.",
    expiresText ? `Vence el ${expiresText}.` : "",
    "Si no esperabas esta invitacion, puedes ignorar este correo."
  ].filter(Boolean).join("\n\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2933; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">TurnoPlus</h2>
      <p>Hola,</p>
      <p><strong>${safeSender}</strong> te invito a solicitar acceso como supervisor a la unidad <strong>${safeUnit}</strong>.</p>
      <p>El enlace es de un solo uso. Despues de abrirlo e iniciar sesion con Google, el propietario debera aprobar tu solicitud.</p>
      <p style="margin: 24px 0;">
        <a href="${safeInviteUrl}" style="background: #15559a; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: bold; display: inline-block;">Abrir invitacion</a>
      </p>
      <p style="font-size: 14px; color: #52606d;">Si el boton no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${safeInviteUrl}">${safeInviteUrl}</a>
      </p>
      ${safeExpiresText ? `
        <p style="font-size: 14px; color: #52606d;">Vence el ${safeExpiresText}.</p>
      ` : ""}
      <hr style="border: none; border-top: 1px solid #e4e7eb; margin: 24px 0;">
      <p style="font-size: 12px; color: #9aa5b1;">Si no esperabas esta invitacion, puedes ignorar este correo.</p>
    </div>
  `;

  return { html, text };
}

function buildWorkspaceLinkRequestEmail({
  fromWorkspaceName,
  requesterName,
  requestsUrl
}) {
  const unit = String(fromWorkspaceName || "una unidad").trim();
  const requester = String(requesterName || "un administrador").trim();
  const safeUnit = escapeHtml(unit);
  const safeRequester = escapeHtml(requester);
  const safeRequestsUrl = escapeHtml(requestsUrl);

  const text = [
    "Hola.",
    `${requester} solicito enlazar la unidad "${unit}" con una de tus unidades en TurnoPlus.`,
    "La solicitud ya esta disponible en el menu Solicitudes.",
    `Abre TurnoPlus para revisarla: ${requestsUrl}`,
    "Si no esperabas esta solicitud, puedes rechazarla desde TurnoPlus."
  ].join("\n\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2933; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">TurnoPlus</h2>
      <p>Hola,</p>
      <p><strong>${safeRequester}</strong> solicito enlazar la unidad <strong>${safeUnit}</strong> con una de tus unidades.</p>
      <p>La solicitud ya esta disponible en el menu <strong>Solicitudes</strong>. Al aceptarla, quedara enlazada con la unidad que tengas activa.</p>
      <p style="margin: 24px 0;">
        <a href="${safeRequestsUrl}" style="background: #15559a; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: bold; display: inline-block;">Abrir Solicitudes</a>
      </p>
      <p style="font-size: 14px; color: #52606d;">Si el boton no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${safeRequestsUrl}">${safeRequestsUrl}</a>
      </p>
      <hr style="border: none; border-top: 1px solid #e4e7eb; margin: 24px 0;">
      <p style="font-size: 12px; color: #9aa5b1;">Si no esperabas esta solicitud, puedes rechazarla desde TurnoPlus.</p>
    </div>
  `;

  return { html, text };
}

function formatDateCL(value) {
  const [year, month, day] = String(value || "").split("-");

  if (!year || !month || !day) return String(value || "");
  return `${day}-${month}-${year}`;
}

function requestTypeLabel(type) {
  const labels = {
    legal: "F. Legal",
    admin: "P. Administrativo",
    comp: "P. Compensatorio",
    half_admin_morning: "1/2 ADM manana",
    half_admin_afternoon: "1/2 ADM tarde",
    unpaid_leave: "Permiso sin goce",
    clock_incident: "Incidencia de marcaje",
    missing_clock: "Incidencia de marcaje",
    swap: "Cambio de turno"
  };

  return labels[type] || "Solicitud";
}

// ===========================================================================
// Suscripciones / Planes: uso autoritativo de la cuenta del dueño (ownerUid).
// La PWA del trabajador es gratis; el cobro y los limites viven en la cuenta
// del dueño en ProTurnos y cubren TODOS sus entornos.
// ===========================================================================

// Entornos que no deben contar para el uso (marcados para eliminacion).
const BILLING_EXCLUDED_WORKSPACE_STATES = new Set([
  "pending_deletion",
  "deleted"
]);

function subscriptionPeriodEndMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Reconstruye los perfiles de un entorno desde el snapshot modular sincronizado
// (modulo "profile") y cuenta los activos. Es autoritativo: lee la misma fuente
// que usa la app (no un contador escrito aparte), por lo que no se puede evadir
// el limite manipulando un contador en el cliente.
async function countActiveWorkersInWorkspace(workspaceId) {
  const chunksSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("stateModules")
    .doc("profile")
    .collection("chunks")
    .get();

  if (chunksSnap.empty) return 0;

  const text = chunksSnap.docs
    .map((doc) => ({
      index: Number(doc.data()?.index) || 0,
      text: String(doc.data()?.text || "")
    }))
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.text)
    .join("");

  let snapshot;
  try {
    snapshot = JSON.parse(text || "{}");
  } catch (error) {
    logger.warn("No se pudo parsear el modulo profile.", { workspaceId });
    return 0;
  }

  const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];

  // Activo = no desactivado explicitamente (coincide con isProfileActive del
  // cliente: profile.active !== false). Un perfil legacy como string cuenta.
  return profiles.filter((profile) => {
    if (typeof profile === "string") return true;
    return profile && profile.active !== false;
  }).length;
}

// Devuelve el uso real de la cuenta del dueño: plan vigente, vencimiento,
// trabajadores activos (sumando todos los entornos) y cantidad de entornos.
// El cliente compara estos numeros contra los limites de plans.js.
exports.getAccountUsage = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 60
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesion para ver tu suscripcion."
      );
    }

    // El entorno activo decide la cuenta: dentro de un entorno ajeno manda el
    // plan de su dueño, no el del miembro invitado.
    const billingUid = await resolveBillingAccountUid(
      db,
      uid,
      request.data?.workspaceId
    );

    // Suscripcion almacenada. Si no hay documento, la cuenta es gratis.
    const accountSnap = await db.collection("accounts").doc(billingUid).get();
    const account = accountSnap.exists ? accountSnap.data() || {} : {};
    const plan = typeof account.plan === "string" ? account.plan : "free";
    const period =
      account.period === "annual" || account.period === "monthly"
        ? account.period
        : null;
    const periodEndMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
    const now = Date.now();
    const expired = plan !== "free" && periodEndMs > 0 && now > periodEndMs;
    const effectivePlan = expired ? "free" : plan;

    // Entornos del dueño que no estan marcados para eliminacion.
    const workspacesSnap = await db
      .collection("workspaces")
      .where("ownerUid", "==", billingUid)
      .get();
    const ownedWorkspaces = workspacesSnap.docs.filter(
      (doc) =>
        !BILLING_EXCLUDED_WORKSPACE_STATES.has(
          String(doc.data()?.deletionStatus || "")
        )
    );

    // Suma autoritativa de trabajadores activos entre TODOS los entornos.
    let activeWorkers = 0;
    for (const workspaceDoc of ownedWorkspaces) {
      activeWorkers += await countActiveWorkersInWorkspace(workspaceDoc.id);
    }

    const pendingDiscount =
      account.pendingDiscount && typeof account.pendingDiscount === "object"
        ? {
            code: String(account.pendingDiscount.code || ""),
            percentOff: Number(account.pendingDiscount.percentOff) || 0,
            amountOff: Number(account.pendingDiscount.amountOff) || 0,
            plan:
              typeof account.pendingDiscount.plan === "string"
                ? account.pendingDiscount.plan
                : null
          }
        : null;

    const gatingEnabled = await readGatingEnabled();

    return {
      plan,
      effectivePlan,
      // false = el plan lo paga el dueño del entorno, no quien consulta: la UI
      // muestra el plan pero esconde pagar / canjear cupon.
      isAccountOwner: billingUid === uid,
      period,
      currentPeriodEnd: periodEndMs || null,
      source: typeof account.source === "string" ? account.source : null,
      couponCode:
        typeof account.couponCode === "string" ? account.couponCode : null,
      pendingDiscount,
      gatingEnabled,
      expired,
      activeWorkers,
      entornos: ownedWorkspaces.length,
      generatedAt: now
    };
  }
);

// ===========================================================================
// Cupones de suscripcion: acceso temporal a un plan, o descuento al pagar.
// Crear/listar/desactivar es solo para el admin; canjear lo hace cualquier
// dueno autenticado. Toda la coleccion "coupons" se accede solo via estas
// funciones (las reglas la cierran al cliente).
// ===========================================================================

// Admin(s) habilitados para gestionar cupones. Gmail ignora los puntos y el
// sufijo +alias, por eso se normaliza antes de comparar.
const COUPON_ADMIN_EMAILS = ["tm.alanplaza@gmail.com"];
const COUPON_CODE_PATTERN = /^[A-Z0-9]{4,24}$/;
const COUPON_PLANS = new Set(["p1", "p2", "p3"]);

function normalizeEmailForAdmin(email) {
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

function isCouponAdmin(token = {}) {
  if (token.email_verified !== true) return false;

  const email = normalizeEmailForAdmin(token.email);

  if (!email) return false;

  return COUPON_ADMIN_EMAILS.some(
    (adminEmail) => normalizeEmailForAdmin(adminEmail) === email
  );
}

// Flag global de activacion del gating (config/billing.gatingEnabled). Si no
// existe el documento, se considera APAGADO (gating inactivo): permite desplegar
// el codigo de gating sin afectar a nadie hasta encenderlo.
async function readGatingEnabled() {
  const snap = await db.collection("config").doc("billing").get();
  return snap.exists ? snap.data()?.gatingEnabled === true : false;
}

function generateCouponCode() {
  // 8 caracteres legibles (sin 0/O/1/I) desde bytes aleatorios.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";

  for (let index = 0; index < 8; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }

  return code;
}

function serializeCoupon(code, data = {}) {
  return {
    code,
    type: data.type === "discount" ? "discount" : "access",
    plan: typeof data.plan === "string" ? data.plan : null,
    durationDays: Number(data.durationDays) || 0,
    percentOff: Number(data.percentOff) || 0,
    amountOff: Number(data.amountOff) || 0,
    maxRedemptions: Number(data.maxRedemptions) || 0,
    redemptionsCount: Number(data.redemptionsCount) || 0,
    active: data.active !== false,
    expiresAt: subscriptionPeriodEndMillis(data.expiresAt) || null,
    note: typeof data.note === "string" ? data.note : "",
    createdByEmail:
      typeof data.createdByEmail === "string" ? data.createdByEmail : "",
    createdAt: subscriptionPeriodEndMillis(data.createdAt) || null
  };
}

exports.createCoupon = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede crear cupones."
      );
    }

    const data = request.data || {};
    const type = data.type === "discount" ? "discount" : "access";
    const plan = COUPON_PLANS.has(data.plan) ? data.plan : "";
    const durationDays = Math.max(
      0,
      Math.min(3650, Math.round(Number(data.durationDays) || 0))
    );
    const percentOff = Math.max(
      0,
      Math.min(100, Math.round(Number(data.percentOff) || 0))
    );
    const amountOff = Math.max(0, Math.round(Number(data.amountOff) || 0));
    const maxRedemptions = Math.max(
      0,
      Math.min(100000, Math.round(Number(data.maxRedemptions) || 0))
    );
    const expiresInDays = Math.max(
      0,
      Math.min(3650, Math.round(Number(data.expiresInDays) || 0))
    );
    const note = cleanCallableText(data.note, 200);

    if (type === "access") {
      if (!plan) {
        throw new HttpsError(
          "invalid-argument",
          "Elige el plan que otorga el cupon de acceso."
        );
      }
      if (durationDays <= 0) {
        throw new HttpsError(
          "invalid-argument",
          "Indica cuantos dias de acceso otorga el cupon."
        );
      }
    } else if (percentOff <= 0 && amountOff <= 0) {
      throw new HttpsError(
        "invalid-argument",
        "Indica un descuento en porcentaje o en monto."
      );
    }

    let requestedCode = String(data.code || "").trim().toUpperCase();

    if (requestedCode && !COUPON_CODE_PATTERN.test(requestedCode)) {
      throw new HttpsError(
        "invalid-argument",
        "El codigo debe tener entre 4 y 24 letras o numeros."
      );
    }

    const now = admin.firestore.Timestamp.now();
    const expiresAt =
      expiresInDays > 0
        ? admin.firestore.Timestamp.fromMillis(
            Date.now() + expiresInDays * 86400000
          )
        : null;
    const payload = {
      type,
      plan: plan || null,
      durationDays,
      percentOff,
      amountOff,
      maxRedemptions,
      redemptionsCount: 0,
      redeemedBy: [],
      active: true,
      expiresAt,
      note,
      createdByUid: request.auth.uid,
      createdByEmail: cleanCallableText(request.auth.token?.email, 254),
      createdAt: now,
      updatedAt: now
    };

    // create() falla si el documento ya existe -> garantiza unicidad del codigo.
    if (requestedCode) {
      try {
        await db
          .collection("coupons")
          .doc(requestedCode)
          .create({ code: requestedCode, ...payload });
      } catch (error) {
        if (error.code === 6 || error.code === "already-exists") {
          throw new HttpsError(
            "already-exists",
            "Ese codigo de cupon ya existe."
          );
        }
        throw error;
      }

      return { code: requestedCode };
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateCouponCode();

      try {
        await db
          .collection("coupons")
          .doc(candidate)
          .create({ code: candidate, ...payload });

        return { code: candidate };
      } catch (error) {
        if (error.code !== 6 && error.code !== "already-exists") throw error;
      }
    }

    throw new HttpsError(
      "internal",
      "No se pudo generar un codigo unico. Reintenta."
    );
  }
);

exports.redeemCoupon = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion para canjear el cupon.");
    }

    const code = String(request.data?.code || "").trim().toUpperCase();

    if (!COUPON_CODE_PATTERN.test(code)) {
      throw new HttpsError("invalid-argument", "Ingresa un codigo de cupon valido.");
    }

    const applied = await db.runTransaction(async (transaction) => {
      const couponRef = db.collection("coupons").doc(code);
      const accountRef = db.collection("accounts").doc(uid);
      const couponSnap = await transaction.get(couponRef);
      const accountSnap = await transaction.get(accountRef);

      if (!couponSnap.exists) {
        throw new HttpsError("not-found", "El cupon no existe.");
      }

      const coupon = couponSnap.data() || {};
      const now = Date.now();

      if (coupon.active === false) {
        throw new HttpsError("failed-precondition", "El cupon esta desactivado.");
      }

      const expiresMs = subscriptionPeriodEndMillis(coupon.expiresAt);
      if (expiresMs && now > expiresMs) {
        throw new HttpsError("failed-precondition", "El cupon esta vencido.");
      }

      const max = Number(coupon.maxRedemptions) || 0;
      const count = Number(coupon.redemptionsCount) || 0;
      if (max > 0 && count >= max) {
        throw new HttpsError(
          "resource-exhausted",
          "El cupon ya alcanzo su limite de usos."
        );
      }

      const redeemedBy = Array.isArray(coupon.redeemedBy)
        ? coupon.redeemedBy
        : [];
      if (redeemedBy.includes(uid)) {
        throw new HttpsError("already-exists", "Ya canjeaste este cupon.");
      }

      const nowTs = admin.firestore.Timestamp.now();
      let result;

      if (coupon.type === "discount") {
        const pendingDiscount = {
          code,
          percentOff: Number(coupon.percentOff) || 0,
          amountOff: Number(coupon.amountOff) || 0,
          plan: typeof coupon.plan === "string" ? coupon.plan : null,
          addedAt: nowTs
        };

        transaction.set(
          accountRef,
          { pendingDiscount, updatedAt: nowTs },
          { merge: true }
        );

        result = {
          type: "discount",
          percentOff: pendingDiscount.percentOff,
          amountOff: pendingDiscount.amountOff,
          plan: pendingDiscount.plan
        };
      } else {
        const durationDays = Math.max(1, Number(coupon.durationDays) || 0);
        const account = accountSnap.exists ? accountSnap.data() || {} : {};
        const currentEndMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
        // Si ya tiene vigente el mismo plan, extiende desde el fin; si no, desde hoy.
        const samePlanActive =
          account.plan === coupon.plan && currentEndMs > now;
        const baseMs = samePlanActive ? currentEndMs : now;
        const newEnd = admin.firestore.Timestamp.fromMillis(
          baseMs + durationDays * 86400000
        );

        transaction.set(
          accountRef,
          {
            plan: coupon.plan,
            period: null,
            source: "coupon",
            couponCode: code,
            currentPeriodEnd: newEnd,
            updatedAt: nowTs
          },
          { merge: true }
        );

        result = {
          type: "access",
          plan: coupon.plan,
          currentPeriodEnd: newEnd.toMillis()
        };
      }

      transaction.update(couponRef, {
        redemptionsCount: count + 1,
        redeemedBy: admin.firestore.FieldValue.arrayUnion(uid),
        updatedAt: nowTs
      });

      return result;
    });

    return { ok: true, ...applied };
  }
);

exports.listCoupons = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede ver los cupones."
      );
    }

    const snap = await db
      .collection("coupons")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    return {
      coupons: snap.docs.map((doc) => serializeCoupon(doc.id, doc.data()))
    };
  }
);

exports.setCouponActive = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede modificar cupones."
      );
    }

    const code = String(request.data?.code || "").trim().toUpperCase();

    if (!COUPON_CODE_PATTERN.test(code)) {
      throw new HttpsError("invalid-argument", "Codigo de cupon invalido.");
    }

    await db.collection("coupons").doc(code).update({
      active: Boolean(request.data?.active),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { ok: true };
  }
);

// ===========================================================================
// Panel de control admin: metricas agregadas de toda la plataforma.
// Solo para el admin y protegido por Auth + App Check.
// ===========================================================================

// Cuenta perfiles activos y totales de un entorno desde el modulo "profile".
async function readWorkspaceProfileCounts(workspaceId) {
  const workspaceRef = db.collection("workspaces").doc(workspaceId);
  const [chunksSnap, workerLinksSnap] = await Promise.all([
    workspaceRef
      .collection("stateModules")
      .doc("profile")
      .collection("chunks")
      .get(),
    workspaceRef.collection("workerLinks").get()
  ]);
  const pwaLinked = workerLinksSnap.docs.filter((doc) => {
    const status = String(doc.data()?.status || "active");
    return status === "active";
  }).length;

  if (chunksSnap.empty) return { active: 0, total: 0, pwaLinked };

  const text = chunksSnap.docs
    .map((doc) => ({
      index: Number(doc.data()?.index) || 0,
      text: String(doc.data()?.text || "")
    }))
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.text)
    .join("");

  let snapshot;
  try {
    snapshot = JSON.parse(text || "{}");
  } catch (error) {
    return { active: 0, total: 0, pwaLinked };
  }

  let profiles = snapshot.profiles;

  // Los modulos sincronizados conservan el valor crudo de localStorage, por
  // lo que `profiles` normalmente llega como un string JSON. Se mantiene
  // compatibilidad con snapshots antiguos que ya contenian un arreglo.
  if (typeof profiles === "string") {
    try {
      profiles = JSON.parse(profiles);
    } catch (error) {
      profiles = [];
    }
  }

  if (!Array.isArray(profiles)) profiles = [];
  const active = profiles.filter((profile) => {
    if (typeof profile === "string") return true;
    return profile && profile.active !== false;
  }).length;

  return { active, total: profiles.length, pwaLinked };
}

exports.getAdminDashboard = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 180
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede ver el panel."
      );
    }

    const now = Date.now();

    // Entornos + conteo de trabajadores (autoritativo, por entorno activo).
    const workspacesSnap = await db.collection("workspaces").get();
    const owners = new Set();
    let activeWorkspaces = 0;
    let pendingDeletion = 0;
    const countPromises = [];

    workspacesSnap.docs.forEach((doc) => {
      const data = doc.data() || {};

      if (BILLING_EXCLUDED_WORKSPACE_STATES.has(
        String(data.deletionStatus || "")
      )) {
        pendingDeletion += 1;
        return;
      }

      activeWorkspaces += 1;
      if (data.ownerUid) owners.add(data.ownerUid);
      countPromises.push(readWorkspaceProfileCounts(doc.id));
    });

    const counts = await Promise.all(countPromises);
    let totalActiveWorkers = 0;
    let totalProfiles = 0;
    let totalPwaLinkedWorkers = 0;
    counts.forEach((item) => {
      totalActiveWorkers += item.active;
      totalProfiles += item.total;
      totalPwaLinkedWorkers += Number(item.pwaLinked) || 0;
    });

    // Suscripciones por cuenta (dueno). Plan efectivo considerando vencimiento.
    const accountsSnap = await db.collection("accounts").get();
    const accountByOwner = new Map();
    accountsSnap.docs.forEach((doc) => {
      accountByOwner.set(doc.id, doc.data() || {});
    });

    const allOwners = new Set([...owners, ...accountByOwner.keys()]);
    const byPlan = { free: 0, p1: 0, p2: 0, p3: 0 };
    let expired = 0;
    const upcoming = [];

    allOwners.forEach((uid) => {
      const account = accountByOwner.get(uid) || {};
      const plan = typeof account.plan === "string" ? account.plan : "free";
      const endMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
      const isExpired = plan !== "free" && endMs > 0 && now > endMs;
      const effectivePlan = isExpired ? "free" : plan;

      if (byPlan[effectivePlan] !== undefined) {
        byPlan[effectivePlan] += 1;
      } else {
        byPlan.free += 1;
      }

      if (isExpired) expired += 1;

      if (
        plan !== "free" &&
        endMs > 0 &&
        !isExpired &&
        endMs - now <= 30 * 86400000
      ) {
        upcoming.push({
          ownerUid: uid,
          plan,
          source: typeof account.source === "string" ? account.source : null,
          currentPeriodEnd: endMs
        });
      }
    });

    upcoming.sort((a, b) => a.currentPeriodEnd - b.currentPeriodEnd);

    // Cupones.
    const couponsSnap = await db.collection("coupons").get();
    let activeCoupons = 0;
    let totalRedemptions = 0;
    couponsSnap.docs.forEach((doc) => {
      const coupon = doc.data() || {};
      if (coupon.active !== false) activeCoupons += 1;
      totalRedemptions += Number(coupon.redemptionsCount) || 0;
    });

    const gatingEnabled = await readGatingEnabled();

    return {
      generatedAt: now,
      gatingEnabled,
      owners: { total: owners.size },
      workspaces: {
        active: activeWorkspaces,
        pendingDeletion,
        total: workspacesSnap.size
      },
      workers: {
        totalActive: totalActiveWorkers,
        totalProfiles,
        pwaLinked: totalPwaLinkedWorkers,
        pwaAdoptionPercent: totalActiveWorkers > 0
          ? Math.round(totalPwaLinkedWorkers * 100 / totalActiveWorkers)
          : 0
      },
      subscriptions: {
        byPlan,
        expired,
        withAccountDoc: accountsSnap.size
      },
      expirations: {
        upcoming: upcoming.slice(0, 50)
      },
      coupons: {
        total: couponsSnap.size,
        active: activeCoupons,
        totalRedemptions
      }
    };
  }
);

// ===========================================================================
// Activacion segura del gating: flag global + grandfathering de cuentas.
// ===========================================================================

// Enciende/apaga el gating de planes (config/billing.gatingEnabled). Solo admin.
exports.setGatingEnabled = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede cambiar el gating."
      );
    }

    const enabled = request.data?.enabled === true;

    await db.collection("config").doc("billing").set(
      {
        gatingEnabled: enabled,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByEmail: cleanCallableText(request.auth.token?.email, 254)
      },
      { merge: true }
    );

    return { ok: true, gatingEnabled: enabled };
  }
);

// Siembra cuentas "heredadas" (plan sin limites) para los duenos existentes que
// aun no tienen documento en accounts, para que al encender el gating no queden
// capados. graceDays = 0 => sin vencimiento (indefinido); >0 => vence en N dias
// y luego vuelven a "free". No sobrescribe cuentas existentes (pagadas/cupon).
exports.grandfatherAccounts = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 300
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion.");
    }

    if (!isCouponAdmin(request.auth.token || {})) {
      throw new HttpsError(
        "permission-denied",
        "Solo el administrador puede heredar cuentas."
      );
    }

    const graceDays = Math.max(
      0,
      Math.min(3650, Math.round(Number(request.data?.graceDays) || 0))
    );
    const currentPeriodEnd =
      graceDays > 0
        ? admin.firestore.Timestamp.fromMillis(Date.now() + graceDays * 86400000)
        : null;

    // Duenos con entorno activo.
    const workspacesSnap = await db.collection("workspaces").get();
    const owners = new Set();
    workspacesSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (BILLING_EXCLUDED_WORKSPACE_STATES.has(
        String(data.deletionStatus || "")
      )) {
        return;
      }
      if (data.ownerUid) owners.add(data.ownerUid);
    });

    // Cuentas existentes: no se tocan.
    const accountsSnap = await db.collection("accounts").get();
    const existing = new Set(accountsSnap.docs.map((doc) => doc.id));

    const toSeed = [...owners].filter((uid) => !existing.has(uid));
    const nowTs = admin.firestore.Timestamp.now();

    // Escribe en lotes (limite 500 por batch).
    for (let i = 0; i < toSeed.length; i += 400) {
      const batch = db.batch();
      toSeed.slice(i, i + 400).forEach((uid) => {
        batch.set(
          db.collection("accounts").doc(uid),
          {
            plan: "grandfathered",
            period: null,
            source: "grandfathered",
            currentPeriodEnd,
            grandfatheredAt: nowTs,
            updatedAt: nowTs
          },
          { merge: true }
        );
      });
      await batch.commit();
    }

    return {
      ok: true,
      seeded: toSeed.length,
      totalOwners: owners.size,
      alreadyHadAccount: existing.size,
      graceDays
    };
  }
);

// ===========================================================================
// Pagos: Webpay Plus (Transbank) en INTEGRACION (sandbox).
// Webpay Plus es pago unico con redireccion -> la suscripcion se modela como
// periodo prepago (mensual/anual) que vence; la renovacion es manual.
// Para PRODUCCION: usar el commerce code + API key reales y Environment.Production.
// ===========================================================================

// Precios server-side (CLP). Mensual = anual / 10. Espejo de plans.js.
const PLAN_PRICES = {
  p1: { monthly: 36000, annual: 360000 },
  p2: { monthly: 89000, annual: 890000 },
  p3: { monthly: 150000, annual: 1500000 }
};
const PERIOD_DAYS = { monthly: 30, annual: 365 };

// URL publica del retorno (esta misma function). Transbank redirige aqui tras el
// pago. Se confirma con la URL real que entrega el deploy.
const WEBPAY_RETURN_URL =
  "https://southamerica-west1-calendarioturnos-7c4d9.cloudfunctions.net/webpayReturn";
const WEBPAY_DEFAULT_RETURN_TO = "https://app.turnoplus.cl/";

function webpayTransaction() {
  return new WebpayPlus.Transaction(
    new TbkOptions(
      IntegrationCommerceCodes.WEBPAY_PLUS,
      IntegrationApiKeys.WEBPAY,
      TbkEnvironment.Integration
    )
  );
}

function webpayBuyOrder() {
  // <= 26 chars alfanumericos. "to" + timestamp(13) + 6 hex.
  return `to${Date.now()}${randomBytes(3).toString("hex")}`;
}

function webpayRedirect(returnTo, status) {
  const base = returnTo || WEBPAY_DEFAULT_RETURN_TO;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}webpay=${status}`;
}

function computeSubscriptionAmount(plan, period, pendingDiscount) {
  const base = PLAN_PRICES[plan]?.[period] || 0;

  if (base <= 0) return { base: 0, amount: 0, discount: 0 };

  let discount = 0;

  if (pendingDiscount && typeof pendingDiscount === "object") {
    const percent = Math.max(
      0,
      Math.min(100, Number(pendingDiscount.percentOff) || 0)
    );
    const flat = Math.max(0, Number(pendingDiscount.amountOff) || 0);

    if (percent > 0) discount += Math.round((base * percent) / 100);
    if (flat > 0) discount += flat;
  }

  return { base, amount: Math.max(1, base - discount), discount };
}

// Inicia un pago: calcula el monto server-side (con descuento de cupon si hay),
// crea la transaccion Webpay y devuelve {token, url} para redirigir al usuario.
exports.createWebpayTransaction = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 30
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Inicia sesion para pagar.");
    }

    const plan = COUPON_PLANS.has(request.data?.plan) ? request.data.plan : "";
    const period =
      request.data?.period === "annual"
        ? "annual"
        : request.data?.period === "monthly"
          ? "monthly"
          : "";

    if (!plan || !period) {
      throw new HttpsError("invalid-argument", "Plan o periodo invalido.");
    }

    const returnTo =
      cleanCallableText(request.data?.returnTo, 300) || WEBPAY_DEFAULT_RETURN_TO;

    // Descuento pendiente (cupon canjeado) si existe.
    const accountSnap = await db.collection("accounts").doc(uid).get();
    const pendingDiscount = accountSnap.exists
      ? accountSnap.data()?.pendingDiscount
      : null;

    const { base, amount, discount } = computeSubscriptionAmount(
      plan,
      period,
      pendingDiscount
    );

    if (amount <= 0) {
      throw new HttpsError("failed-precondition", "No se pudo calcular el monto.");
    }

    const buyOrder = webpayBuyOrder();
    const sessionId = uid.slice(0, 60);

    let response;
    try {
      response = await webpayTransaction().create(
        buyOrder,
        sessionId,
        amount,
        WEBPAY_RETURN_URL
      );
    } catch (error) {
      logger.error("Webpay create fallo", error);
      throw new HttpsError(
        "internal",
        "No se pudo iniciar el pago. Intenta nuevamente."
      );
    }

    await db.collection("payments").doc(buyOrder).set({
      buyOrder,
      ownerUid: uid,
      plan,
      period,
      baseAmount: base,
      amount,
      discount,
      couponCode:
        pendingDiscount && typeof pendingDiscount.code === "string"
          ? pendingDiscount.code
          : null,
      status: "pending",
      provider: "webpay",
      returnTo,
      createdByEmail: cleanCallableText(request.auth.token?.email, 254),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { token: response.token, url: response.url, amount, buyOrder };
  }
);

// Retorno de Webpay: confirma el pago (commit), verifica monto y estado, activa
// la suscripcion y redirige al usuario de vuelta a la app con ?webpay=ok|error|abort.
exports.webpayReturn = onRequest(
  {
    region: "southamerica-west1",
    timeoutSeconds: 60
  },
  async (req, res) => {
    const token = req.body?.token_ws || req.query?.token_ws;
    const tbkToken = req.body?.TBK_TOKEN || req.query?.TBK_TOKEN;

    // Aborto del usuario: Transbank envia TBK_TOKEN (sin token_ws). No se commitea.
    if (!token && tbkToken) {
      const order =
        req.body?.TBK_ORDEN_COMPRA || req.query?.TBK_ORDEN_COMPRA || "";
      let returnTo = WEBPAY_DEFAULT_RETURN_TO;

      if (order) {
        const snap = await db.collection("payments").doc(String(order)).get();
        if (snap.exists) {
          returnTo = snap.data()?.returnTo || returnTo;
          await snap.ref.set(
            {
              status: "aborted",
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
      }

      return res.redirect(webpayRedirect(returnTo, "abort"));
    }

    if (!token) {
      return res.status(400).send("Falta token_ws.");
    }

    let result;
    try {
      result = await webpayTransaction().commit(token);
    } catch (error) {
      logger.error("Webpay commit fallo", error);
      return res.redirect(webpayRedirect(WEBPAY_DEFAULT_RETURN_TO, "error"));
    }

    const buyOrder = String(result.buy_order || "");
    const paymentRef = db.collection("payments").doc(buyOrder);
    const paymentSnap = await paymentRef.get();
    const payment = paymentSnap.exists ? paymentSnap.data() : null;
    const returnTo = payment?.returnTo || WEBPAY_DEFAULT_RETURN_TO;

    // Aprobado solo si el codigo es 0 y el monto coincide con lo guardado.
    const approved =
      result.response_code === 0 &&
      payment &&
      Number(result.amount) === Number(payment.amount);

    if (!approved) {
      if (payment) {
        await paymentRef.set(
          {
            status: "failed",
            result,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }
      return res.redirect(webpayRedirect(returnTo, "error"));
    }

    // Activa la suscripcion (extiende desde el fin vigente si es el mismo plan).
    const nowTs = admin.firestore.Timestamp.now();
    const now = Date.now();
    const accountRef = db.collection("accounts").doc(payment.ownerUid);
    const accountSnap = await accountRef.get();
    const account = accountSnap.exists ? accountSnap.data() || {} : {};
    const currentEndMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
    const samePlanActive = account.plan === payment.plan && currentEndMs > now;
    const baseMs = samePlanActive ? currentEndMs : now;
    const periodEnd = admin.firestore.Timestamp.fromMillis(
      baseMs + (PERIOD_DAYS[payment.period] || 30) * 86400000
    );

    await accountRef.set(
      {
        plan: payment.plan,
        period: payment.period,
        source: "paid",
        couponCode: null,
        currentPeriodEnd: periodEnd,
        pendingDiscount: admin.firestore.FieldValue.delete(),
        lastPaymentAt: nowTs,
        updatedAt: nowTs
      },
      { merge: true }
    );

    await paymentRef.set(
      {
        status: "paid",
        result,
        authorizationCode: result.authorization_code || null,
        paidAt: nowTs,
        currentPeriodEnd: periodEnd,
        updatedAt: nowTs
      },
      { merge: true }
    );

    return res.redirect(webpayRedirect(returnTo, "ok"));
  }
);

// ===========================================================================
// Recordatorios de vencimiento de suscripcion (correo via Resend).
// ===========================================================================

const SUBSCRIPTION_REMINDER_DAYS = 7;
const SUBSCRIPTION_PLAN_NAMES = {
  free: "Gratis",
  p1: "Plan 1",
  p2: "Plan 2",
  p3: "Plan 3",
  grandfathered: "Heredado"
};

function escapeEmailText(value) {
  return String(value || "").replace(
    /[<>&]/g,
    (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char])
  );
}

async function sendResendEmail({ to, subject, html, text }) {
  const apiKey = RESEND_API_KEY.value();

  if (!apiKey) {
    logger.warn("RESEND_API_KEY no configurada; no se envia el correo.");
    return { ok: false, skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: safeMailFrom(), to: [to], subject, html, text })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend ${response.status}: ${detail}`);
  }

  const result = await response.json().catch(() => ({}));
  return { ok: true, id: result?.id || "" };
}

// Una vez al dia: avisa a los duenos cuando su suscripcion esta por vencer
// (<= 7 dias) o ya vencio. Idempotente por periodo (no repite el mismo aviso).
exports.sendSubscriptionReminders = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "America/Santiago",
    region: "us-central1",
    secrets: [RESEND_API_KEY],
    timeoutSeconds: 300
  },
  async () => {
    const now = Date.now();
    const snap = await db.collection("accounts").get();

    for (const docSnap of snap.docs) {
      const uid = docSnap.id;
      const account = docSnap.data() || {};
      const plan = typeof account.plan === "string" ? account.plan : "free";

      if (plan === "free") continue;

      const periodEndMs = subscriptionPeriodEndMillis(account.currentPeriodEnd);
      if (!periodEndMs) continue;

      const daysLeft = Math.ceil((periodEndMs - now) / 86400000);
      let stage = null;

      if (
        daysLeft > 0 &&
        daysLeft <= SUBSCRIPTION_REMINDER_DAYS &&
        account.upcomingReminderFor !== periodEndMs
      ) {
        stage = "upcoming";
      } else if (daysLeft <= 0 && account.expiredReminderFor !== periodEndMs) {
        stage = "expired";
      }

      if (!stage) continue;

      let email = "";
      let name = "";
      try {
        const user = await admin.auth().getUser(uid);
        email = user.email || "";
        name = user.displayName || "";
      } catch (error) {
        logger.warn("No se pudo obtener el dueno para el recordatorio.", { uid });
      }

      if (!email) continue;

      const planName = SUBSCRIPTION_PLAN_NAMES[plan] || plan;
      const endDate = new Date(periodEndMs).toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
      const subject =
        stage === "upcoming"
          ? `Tu suscripcion TurnoPlus (${planName}) vence en ${daysLeft} dia(s)`
          : `Tu suscripcion TurnoPlus (${planName}) vencio`;
      const body =
        stage === "upcoming"
          ? `Tu plan <strong>${planName}</strong> vence el <strong>${endDate}</strong> (en ${daysLeft} dia(s)).`
          : `Tu plan <strong>${planName}</strong> vencio el <strong>${endDate}</strong>. Tu cuenta volvio al plan Gratis.`;
      const greeting = name ? ` ${escapeEmailText(name)}` : "";
      const html =
        `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a2740">` +
        `<p>Hola${greeting},</p>` +
        `<p>${body}</p>` +
        `<p>Para renovar tu suscripcion, abre TurnoPlus y entra a <strong>Planes</strong> en la barra superior.</p>` +
        `<p style="color:#6b7a90;font-size:13px">TurnoPlus</p></div>`;
      const text =
        `Hola${name ? ` ${name}` : ""},\n\n` +
        (stage === "upcoming"
          ? `Tu plan ${planName} vence el ${endDate} (en ${daysLeft} dia(s)).`
          : `Tu plan ${planName} vencio el ${endDate}. Tu cuenta volvio al plan Gratis.`) +
        `\n\nPara renovar, abre TurnoPlus y entra a Planes.\n\nTurnoPlus`;

      try {
        const sent = await sendResendEmail({ to: email, subject, html, text });
        if (sent.skipped) continue;

        await docSnap.ref.set(
          stage === "upcoming"
            ? {
                upcomingReminderFor: periodEndMs,
                upcomingReminderAt: admin.firestore.FieldValue.serverTimestamp()
              }
            : {
                expiredReminderFor: periodEndMs,
                expiredReminderAt: admin.firestore.FieldValue.serverTimestamp()
              },
          { merge: true }
        );

        logger.info("Recordatorio de suscripcion enviado.", { uid, stage, daysLeft });
      } catch (error) {
        logger.warn("No se pudo enviar el recordatorio.", {
          uid,
          message: error.message
        });
      }
    }
  }
);
