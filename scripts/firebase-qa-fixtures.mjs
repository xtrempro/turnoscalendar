import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const PROJECT_ID = "calendarioturnos-7c4d9";
const ADMIN_EMAIL = "tm.alanplaza@gmail.com";
const FIXTURE_ID = "turnoplus-admin-scale-v1";
const MANIFEST_PATH = `qaFixtures/${FIXTURE_ID}`;
const PROFILE_COUNT = 100;
const PWA_COUNT = 70;
// Multiplo de tres: cada trabajador PWA genera enlace canonico, espejo y datos.
const WRITE_BATCH_SIZE = 150;

const WORKSPACES = [
    { id: "qa_scale_ws_01", name: "[QA] UCI Adulto" },
    { id: "qa_scale_ws_02", name: "[QA] Urgencia" },
    { id: "qa_scale_ws_03", name: "[QA] Imagenología" },
    { id: "qa_scale_ws_04", name: "[QA] Pabellón" },
    { id: "qa_scale_ws_05", name: "[QA] Hospitalización" }
];

const WORKSPACE_LINKS = [
    [0, 1],
    [1, 2],
    [3, 4]
];

const PROFESSIONS = {
    Profesional: [
        "Enfermería",
        "Kinesiología",
        "TM Imagenología",
        "Terapia Ocupacional",
        "Obstetricia",
        "Nutricionista"
    ],
    Técnico: [
        "Técnico en Enfermería",
        "Técnico en Farmacia",
        "Técnico en Imagenología",
        "Técnico en Laboratorio"
    ],
    Administrativo: [
        "Técnico en Administración de Empresas",
        "Técnico en Contabilidad",
        "Técnico en Logística"
    ],
    Auxiliar: [
        "Auxiliar de servicio",
        "Auxiliar de alimentación",
        "Auxiliar de apoyo clínico"
    ]
};

const FIRST_NAMES = [
    "Camila", "Mateo", "Javiera", "Vicente", "Antonia",
    "Benjamín", "Fernanda", "Tomás", "Daniela", "Nicolás",
    "Valentina", "Sebastián", "Constanza", "Felipe", "Francisca",
    "Diego", "Catalina", "Martín", "Paula", "Ignacio"
];

const LAST_NAMES = [
    "González", "Muñoz", "Rojas", "Díaz", "Pérez",
    "Soto", "Contreras", "Silva", "Martínez", "Sepúlveda",
    "Morales", "Rodríguez", "López", "Fuentes", "Hernández",
    "Torres", "Araya", "Flores", "Espinoza", "Valdés"
];

const DB_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)";
const DOCUMENTS_ROOT = `${DB_ROOT}/documents`;

let cachedAccessToken = "";

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();

    return require(path.join(npmRoot, "firebase-tools", "lib", relativePath));
}

async function accessToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const auth = firebaseToolsModule("auth.js");
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    const tokens = await auth.getAccessToken(account.tokens.refresh_token, []);
    cachedAccessToken = tokens.access_token;
    return cachedAccessToken;
}

async function api(url, options = {}, { allowNotFound = false } = {}) {
    const token = await accessToken();
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID,
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    let body = {};

    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        body = { raw: text };
    }

    if (allowNotFound && response.status === 404) return null;

    if (!response.ok) {
        const message = body?.error?.message || text || `HTTP ${response.status}`;
        throw new Error(`${response.status} ${message}`);
    }

    return body;
}

function encodedPath(documentPath) {
    return String(documentPath)
        .split("/")
        .map(segment => encodeURIComponent(segment))
        .join("/");
}

function resourceName(documentPath) {
    return `projects/${PROJECT_ID}/databases/(default)/documents/${documentPath}`;
}

function encodeValue(value) {
    if (value === null) return { nullValue: null };
    if (value instanceof Date) return { timestampValue: value.toISOString() };

    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map(encodeValue)
            }
        };
    }

    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "string") return { stringValue: value };

    if (typeof value === "number") {
        return Number.isInteger(value)
            ? { integerValue: String(value) }
            : { doubleValue: value };
    }

    if (value && typeof value === "object") {
        return {
            mapValue: {
                fields: Object.fromEntries(
                    Object.entries(value)
                        .filter(([, item]) => item !== undefined)
                        .map(([key, item]) => [key, encodeValue(item)])
                )
            }
        };
    }

    throw new Error(`Valor Firestore no soportado: ${typeof value}`);
}

function encodeFields(data) {
    return Object.fromEntries(
        Object.entries(data)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, encodeValue(value)])
    );
}

function decodeValue(value = {}) {
    if ("nullValue" in value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("timestampValue" in value) return value.timestampValue;
    if ("arrayValue" in value) {
        return (value.arrayValue.values || []).map(decodeValue);
    }
    if ("mapValue" in value) {
        return decodeFields(value.mapValue.fields || {});
    }
    return null;
}

function decodeFields(fields = {}) {
    return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
    );
}

function writeDocument(documentPath, data) {
    return {
        update: {
            name: resourceName(documentPath),
            fields: encodeFields(data)
        }
    };
}

function deleteDocument(documentPath) {
    return { delete: resourceName(documentPath) };
}

async function commitWrites(writes, label) {
    for (let index = 0; index < writes.length; index += WRITE_BATCH_SIZE) {
        const slice = writes.slice(index, index + WRITE_BATCH_SIZE);
        await api(`${DB_ROOT}/documents:commit`, {
            method: "POST",
            body: JSON.stringify({ writes: slice })
        });
        const completed = Math.min(index + slice.length, writes.length);
        console.log(`${label}: ${completed}/${writes.length}`);
    }
}

async function getDocument(documentPath) {
    const doc = await api(
        `${DOCUMENTS_ROOT}/${encodedPath(documentPath)}`,
        {},
        { allowNotFound: true }
    );

    if (!doc) return null;
    return {
        name: doc.name,
        id: doc.name.split("/").at(-1),
        data: decodeFields(doc.fields || {})
    };
}

async function listDocuments(collectionPath) {
    const body = await api(
        `${DOCUMENTS_ROOT}/${encodedPath(collectionPath)}?pageSize=1000`
    );

    return (body.documents || []).map(doc => ({
        id: doc.name.split("/").at(-1),
        data: decodeFields(doc.fields || {})
    }));
}

async function findOwner() {
    try {
        const authLookup = await api(
            `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}` +
                "/accounts:lookup",
            {
                method: "POST",
                body: JSON.stringify({ email: [ADMIN_EMAIL] })
            }
        );
        const authUsers = authLookup.users || [];

        if (authUsers.length === 1 && authUsers[0].localId) {
            return {
                uid: authUsers[0].localId,
                email: authUsers[0].email || ADMIN_EMAIL,
                displayName:
                    authUsers[0].displayName || "Administrador QA"
            };
        }
    } catch (error) {
        console.warn(`Lookup de Firebase Auth no disponible: ${error.message}`);
    }

    const results = await api(`${DB_ROOT}/documents:runQuery`, {
        method: "POST",
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: "users" }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: "email" },
                        op: "EQUAL",
                        value: { stringValue: ADMIN_EMAIL }
                    }
                },
                limit: 2
            }
        })
    });
    const docs = results.filter(item => item.document).map(item => ({
        uid: item.document.name.split("/").at(-1),
        data: decodeFields(item.document.fields || {})
    }));

    if (docs.length === 1) {
        return {
            uid: docs[0].uid,
            email: docs[0].data.email || ADMIN_EMAIL,
            displayName: docs[0].data.displayName || "Administrador QA"
        };
    }

    const normalizedAdminEmail = normalizeEmail(ADMIN_EMAIL);
    const userMatches = (await listDocuments("users")).filter(item =>
        normalizeEmail(item.data.email) === normalizedAdminEmail
    );

    if (userMatches.length === 1) {
        return {
            uid: userMatches[0].id,
            email: userMatches[0].data.email || ADMIN_EMAIL,
            displayName:
                userMatches[0].data.displayName || "Administrador QA"
        };
    }

    const workspaceResults = await api(`${DB_ROOT}/documents:runQuery`, {
        method: "POST",
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: "workspaces" }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: "createdByEmail" },
                        op: "EQUAL",
                        value: { stringValue: ADMIN_EMAIL }
                    }
                },
                limit: 100
            }
        })
    });
    const listedWorkspaceMatches = (await listDocuments("workspaces"))
        .filter(item =>
            normalizeEmail(item.data.createdByEmail) === normalizedAdminEmail
        );
    const ownerUids = [
        ...new Set(
            [
                ...workspaceResults
                    .filter(item => item.document)
                    .map(item => decodeFields(item.document.fields || {})),
                ...listedWorkspaceMatches.map(item => item.data)
            ]
                .map(item => item.ownerUid)
                .filter(Boolean)
        )
    ];

    if (ownerUids.length !== 1) {
        throw new Error(
            `No se pudo resolver un UID único para ${ADMIN_EMAIL}; ` +
            `encontrados: ${ownerUids.length}.`
        );
    }

    const ownerDoc = await getDocument(`users/${ownerUids[0]}`);

    return {
        uid: ownerUids[0],
        email: ownerDoc?.data?.email || ADMIN_EMAIL,
        displayName: ownerDoc?.data?.displayName || "Administrador QA"
    };
}

function normalizeEmail(value) {
    const clean = String(value || "").trim().toLowerCase();
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

function pad(value, size = 2) {
    return String(value).padStart(size, "0");
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function rutCheckDigit(number) {
    let sum = 0;
    let multiplier = 2;
    let value = number;

    while (value > 0) {
        sum += (value % 10) * multiplier;
        value = Math.floor(value / 10);
        multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }

    const digit = 11 - (sum % 11);
    if (digit === 11) return "0";
    if (digit === 10) return "K";
    return String(digit);
}

function formatRut(number) {
    const grouped = String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${grouped}-${rutCheckDigit(number)}`;
}

function estamentoFor(index) {
    if (index < 40) return "Profesional";
    if (index < 70) return "Técnico";
    if (index < 90) return "Administrativo";
    return "Auxiliar";
}

function rotationFor(workspaceIndex, profileIndex) {
    const selector = (profileIndex + workspaceIndex * 7) % 100;
    const type = selector < 45
        ? "4turno"
        : selector < 80
            ? "3turno"
            : "diurno";
    const firstTurns = type === "3turno"
        ? ["larga", "larga2", "noche", "noche2", "libre1", "libre2"]
        : type === "4turno"
            ? ["larga", "noche", "libre1", "libre2"]
            : ["larga"];
    const start = addUtcDays(
        new Date(Date.UTC(2026, 0, 1)),
        (profileIndex + workspaceIndex * 3) % 28
    );

    return {
        type,
        start: isoDate(start),
        firstTurn: firstTurns[(profileIndex + workspaceIndex) % firstTurns.length]
    };
}

function makeProfile(workspaceIndex, profileIndex) {
    const number = profileIndex + 1;
    const estamento = estamentoFor(profileIndex);
    const professions = PROFESSIONS[estamento];
    const firstName = FIRST_NAMES[(profileIndex + workspaceIndex * 3) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(profileIndex * 3 + workspaceIndex) % LAST_NAMES.length];
    const secondLastName = LAST_NAMES[(profileIndex * 7 + workspaceIndex + 5) % LAST_NAMES.length];
    const profileId = `qa_${workspaceIndex + 1}_${pad(number, 3)}`;
    const rutNumber = 26000000 + workspaceIndex * 1000 + number;
    const rotation = rotationFor(workspaceIndex, profileIndex);

    return {
        profile: {
            id: profileId,
            name: `${firstName} ${lastName} ${secondLastName} QA-${workspaceIndex + 1}-${pad(number, 3)}`,
            email: `qa.ws${workspaceIndex + 1}.worker${pad(number, 3)}@example.invalid`,
            rut: formatRut(rutNumber),
            phone: `9${workspaceIndex + 1}${pad(number, 6)}`.slice(0, 8),
            birthDate: `${1975 + (profileIndex % 25)}-${pad((profileIndex % 12) + 1)}-${pad((profileIndex % 27) + 1)}`,
            docs: [],
            active: true,
            unitEntryDate: `2025-${pad((profileIndex % 12) + 1)}-01`,
            contractType: profileIndex % 4 === 0 ? "Planta" : "Contrata",
            honorariaStart: "",
            honorariaEnd: "",
            honorariaHourlyRate: 0,
            honorariaMaxMonthlyHours: 0,
            unionLeaveEnabled: profileIndex % 13 === 0,
            estamento,
            profession: professions[(profileIndex + workspaceIndex) % professions.length],
            grade: estamento === "Profesional"
                ? String(10 + (profileIndex % 6))
                : String(12 + (profileIndex % 13)),
            qaFixtureId: FIXTURE_ID
        },
        rotation
    };
}

function hashString(value) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `${value.length}-${(hash >>> 0).toString(36)}`;
}

function profileModule(workspaceIndex) {
    const entries = Array.from(
        { length: PROFILE_COUNT },
        (_, index) => makeProfile(workspaceIndex, index)
    );
    const snapshot = {
        profiles: JSON.stringify(entries.map(item => item.profile))
    };

    entries.forEach(({ profile, rotation }) => {
        snapshot[`rotativa_${profile.name}`] = JSON.stringify(rotation);
        snapshot[`shift_${profile.name}`] = JSON.stringify(rotation.type !== "diurno");
    });

    const ordered = Object.fromEntries(
        Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right))
    );
    const text = JSON.stringify(ordered);

    return { entries, text, hash: hashString(text) };
}

function rotationSequence(rotation) {
    if (rotation.type === "3turno") {
        const sequence = [1, 1, 2, 2, 0, 0];
        const starts = {
            larga: 0,
            larga2: 1,
            noche: 2,
            noche2: 3,
            libre1: 4,
            libre2: 5
        };
        const start = starts[rotation.firstTurn] || 0;
        return [...sequence.slice(start), ...sequence.slice(0, start)];
    }

    if (rotation.type === "4turno") {
        const sequence = [1, 2, 0, 0];
        const starts = { larga: 0, noche: 1, libre1: 2, libre2: 3 };
        const start = starts[rotation.firstTurn] || 0;
        return [...sequence.slice(start), ...sequence.slice(0, start)];
    }

    return [];
}

function scheduleFor(rotation) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
    const rotationStart = new Date(`${rotation.start}T00:00:00.000Z`);
    const sequence = rotationSequence(rotation);
    const labels = { 0: "Libre", 1: "Larga", 2: "Noche", 4: "Diurno" };
    const classes = { 0: "libre", 1: "larga", 2: "noche", 4: "diurno" };
    const days = {};

    for (let cursor = new Date(start); cursor <= end; cursor = addUtcDays(cursor, 1)) {
        const iso = isoDate(cursor);
        let turn = 0;

        if (rotation.type === "diurno") {
            turn = cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6 ? 0 : 4;
        } else {
            const offset = Math.floor((cursor - rotationStart) / 86400000);
            turn = sequence[((offset % sequence.length) + sequence.length) % sequence.length];
        }

        days[iso] = {
            iso,
            keyDay: `${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}-${cursor.getUTCDate()}`,
            turno: turn,
            programmedTurn: turn,
            baseTurn: turn,
            label: labels[turn],
            displayLabel: labels[turn],
            className: classes[turn],
            colorGradient: "",
            isManualExtra: false,
            hasLeave: false
        };
    }

    return {
        start: isoDate(start),
        end: isoDate(end),
        days
    };
}

function pwaUid(workspaceIndex, profileIndex) {
    return `qa_pwa_ws${workspaceIndex + 1}_${pad(profileIndex + 1, 3)}`;
}

function pwaProfileIndexes(workspaceIndex) {
    return Array.from({ length: PROFILE_COUNT }, (_, index) => index)
        .filter(index => ((index * 37) + (workspaceIndex * 11)) % 100 < 70);
}

function linkId(fromWorkspace, toWorkspace) {
    return `${fromWorkspace.id}__${toWorkspace.id}`;
}

function fixturePaths() {
    const paths = {
        workspaceRoots: [],
        workspaceChildren: [],
        ownerIndexes: [],
        workerMirrors: [],
        links: WORKSPACE_LINKS.map(([fromIndex, toIndex]) =>
            `workspaceLinks/${linkId(WORKSPACES[fromIndex], WORKSPACES[toIndex])}`
        )
    };

    WORKSPACES.forEach((workspace, workspaceIndex) => {
        paths.workspaceRoots.push(`workspaces/${workspace.id}`);
        paths.workspaceChildren.push(
            `workspaces/${workspace.id}/stateModules/profile/chunks/part_0000`,
            `workspaces/${workspace.id}/stateModules/profile`
        );
        paths.ownerIndexes.push(`users/OWNER_UID/workspaces/${workspace.id}`);

        for (const index of pwaProfileIndexes(workspaceIndex)) {
            const uid = pwaUid(workspaceIndex, index);
            paths.workspaceChildren.push(
                `workspaces/${workspace.id}/workerLinks/${uid}`,
                `workspaces/${workspace.id}/workerAppData/${uid}`
            );
            paths.workerMirrors.push(`users/${uid}/workerLinks/${workspace.id}`);
        }
    });

    return paths;
}

async function preflight() {
    const manifest = await getDocument(MANIFEST_PATH);

    if (manifest && manifest.data.fixtureId !== FIXTURE_ID) {
        throw new Error("El manifiesto QA existe pero no coincide con esta versión.");
    }

    for (const workspace of WORKSPACES) {
        const current = await getDocument(`workspaces/${workspace.id}`);
        if (current && current.data.qaFixtureId !== FIXTURE_ID) {
            throw new Error(
                `Colisión: ${workspace.id} ya existe y no pertenece a ${FIXTURE_ID}.`
            );
        }
    }

    for (const [fromIndex, toIndex] of WORKSPACE_LINKS) {
        const id = linkId(WORKSPACES[fromIndex], WORKSPACES[toIndex]);
        const current = await getDocument(`workspaceLinks/${id}`);
        if (current && current.data.qaFixtureId !== FIXTURE_ID) {
            throw new Error(
                `Colisión: workspaceLinks/${id} no pertenece a ${FIXTURE_ID}.`
            );
        }
    }
}

async function seed() {
    requireProductionConfirmation();
    await preflight();

    const owner = await findOwner();
    const now = new Date();
    const coreWrites = [];
    const pwaWrites = [];
    const modules = [];
    const existingPwa = new Set();

    for (const workspace of WORKSPACES) {
        const [links, appData] = await Promise.all([
            listDocuments(`workspaces/${workspace.id}/workerLinks`),
            listDocuments(`workspaces/${workspace.id}/workerAppData`)
        ]);
        const appDataIds = new Set(
            appData
                .filter(item => item.data.qaFixtureId === FIXTURE_ID)
                .map(item => item.id)
        );

        links
            .filter(item =>
                item.data.qaFixtureId === FIXTURE_ID &&
                appDataIds.has(item.id)
            )
            .forEach(item => existingPwa.add(`${workspace.id}/${item.id}`));
    }

    WORKSPACES.forEach((workspace, workspaceIndex) => {
        const module = profileModule(workspaceIndex);
        modules.push(module);

        coreWrites.push(
            writeDocument(`workspaces/${workspace.id}`, {
                id: workspace.id,
                name: workspace.name,
                ownerUid: owner.uid,
                createdByEmail: owner.email,
                createdAt: now,
                updatedAt: now,
                qaFixtureId: FIXTURE_ID,
                synthetic: true,
                testDataNotice: "Entorno ficticio temporal para pruebas del panel admin"
            }),
            writeDocument(`workspaces/${workspace.id}/members/${owner.uid}`, {
                role: "owner",
                email: owner.email,
                displayName: owner.displayName,
                joinedAt: now,
                qaFixtureId: FIXTURE_ID
            }),
            writeDocument(`users/${owner.uid}/workspaces/${workspace.id}`, {
                name: workspace.name,
                role: "owner",
                joinedAt: now,
                qaFixtureId: FIXTURE_ID,
                synthetic: true
            }),
            writeDocument(`workspaces/${workspace.id}/stateModules/profile`, {
                moduleId: "profile",
                permission: "profile",
                chunkCount: 1,
                charCount: module.text.length,
                hash: module.hash,
                clientId: "qa_fixture_generator",
                updatedAtISO: now.toISOString(),
                updatedAt: now,
                qaFixtureId: FIXTURE_ID
            }),
            writeDocument(
                `workspaces/${workspace.id}/stateModules/profile/chunks/part_0000`,
                {
                    moduleId: "profile",
                    index: 0,
                    text: module.text,
                    updatedAt: now,
                    qaFixtureId: FIXTURE_ID
                }
            )
        );

        for (const index of pwaProfileIndexes(workspaceIndex)) {
            const uid = pwaUid(workspaceIndex, index);
            if (existingPwa.has(`${workspace.id}/${uid}`)) continue;

            const { profile, rotation } = module.entries[index];
            const schedule = scheduleFor(rotation);
            const link = {
                uid,
                workspaceId: workspace.id,
                workspaceName: workspace.name,
                inviteId: `qa_invite_${workspaceIndex + 1}_${pad(index + 1, 3)}`,
                profileName: profile.name,
                profileRut: profile.rut,
                workerEmail: profile.email,
                workerDisplayName: profile.name,
                status: "active",
                linkedAt: now,
                updatedAt: now,
                lastActiveAt: now,
                qaFixtureId: FIXTURE_ID,
                synthetic: true
            };

            pwaWrites.push(
                writeDocument(`workspaces/${workspace.id}/workerLinks/${uid}`, link),
                writeDocument(`users/${uid}/workerLinks/${workspace.id}`, link),
                writeDocument(`workspaces/${workspace.id}/workerAppData/${uid}`, {
                    uid,
                    workspaceId: workspace.id,
                    workspaceName: workspace.name,
                    profileName: profile.name,
                    profileRut: profile.rut,
                    status: "active",
                    worker: {
                        name: profile.name,
                        email: profile.email,
                        phone: profile.phone,
                        rut: profile.rut,
                        role: profile.estamento,
                        profession: profile.profession,
                        unit: workspace.name,
                        unitEntryDate: profile.unitEntryDate,
                        active: true
                    },
                    rotativa: rotation,
                    shiftAssigned: rotation.type !== "diurno",
                    leaveBalances: { legal: 15, admin: 6, comp: 10 },
                    leaveBalancesByYear: {
                        [String(now.getUTCFullYear())]: {
                            legal: 15,
                            admin: 6,
                            comp: 10
                        }
                    },
                    scheduleStart: schedule.start,
                    scheduleEnd: schedule.end,
                    days: schedule.days,
                    supervisorReminders: [],
                    overtimeSummaries: [],
                    reportsByMonth: {},
                    swapLimit: {
                        enabled: false,
                        limit: 0,
                        used: 0,
                        year: now.getUTCFullYear(),
                        month: now.getUTCMonth()
                    },
                    simulatedUsage: {
                        active: true,
                        sessionsLast30Days: 4 + (index % 17),
                        lastSeenAt: now.toISOString(),
                        adoptionCohort: "70_percent"
                    },
                    updatedAtISO: now.toISOString(),
                    updatedAt: now,
                    qaFixtureId: FIXTURE_ID,
                    synthetic: true
                })
            );
        }
    });

    WORKSPACE_LINKS.forEach(([fromIndex, toIndex]) => {
        const from = WORKSPACES[fromIndex];
        const to = WORKSPACES[toIndex];
        const id = linkId(from, to);

        coreWrites.push(writeDocument(`workspaceLinks/${id}`, {
            fromWorkspaceId: from.id,
            fromWorkspaceName: from.name,
            toWorkspaceId: to.id,
            toWorkspaceName: to.name,
            status: "accepted",
            requestedByUid: owner.uid,
            requestedByName: owner.displayName,
            acceptedByUid: owner.uid,
            acceptedByName: owner.displayName,
            createdAt: now,
            acceptedAt: now,
            updatedAt: now,
            qaFixtureId: FIXTURE_ID,
            synthetic: true
        }));
    });

    coreWrites.push(writeDocument(MANIFEST_PATH, {
        fixtureId: FIXTURE_ID,
        projectId: PROJECT_ID,
        ownerUid: owner.uid,
        ownerEmail: owner.email,
        workspaceIds: WORKSPACES.map(item => item.id),
        workspaceNames: WORKSPACES.map(item => item.name),
        profilesPerWorkspace: PROFILE_COUNT,
        totalProfiles: PROFILE_COUNT * WORKSPACES.length,
        pwaUsersPerWorkspace: PWA_COUNT,
        totalPwaUsers: PWA_COUNT * WORKSPACES.length,
        pwaAdoptionPercent: 70,
        workspaceLinkIds: WORKSPACE_LINKS.map(([fromIndex, toIndex]) =>
            linkId(WORKSPACES[fromIndex], WORKSPACES[toIndex])
        ),
        createdAt: now,
        cleanupCommand:
            "node scripts/firebase-qa-fixtures.mjs cleanup --confirm-production"
    }));

    await commitWrites(coreWrites, "Entornos y estructura");
    await commitWrites(pwaWrites, "Simulación PWA");

    const result = await status();
    if (
        result.workspaces !== WORKSPACES.length ||
        result.profiles !== PROFILE_COUNT * WORKSPACES.length ||
        result.pwaLinks !== PWA_COUNT * WORKSPACES.length ||
        result.workspaceLinks !== WORKSPACE_LINKS.length
    ) {
        throw new Error("La verificación final no coincide con los totales esperados.");
    }
}

async function readProfiles(workspaceId) {
    const chunk = await getDocument(
        `workspaces/${workspaceId}/stateModules/profile/chunks/part_0000`
    );
    if (!chunk?.data?.text) return [];

    const snapshot = JSON.parse(chunk.data.text);
    const rawProfiles = snapshot.profiles;
    if (Array.isArray(rawProfiles)) return rawProfiles;
    if (typeof rawProfiles !== "string") return [];

    const profiles = JSON.parse(rawProfiles);
    if (!Array.isArray(profiles)) return [];

    return profiles.map(profile => {
        let rotation = {};
        try {
            rotation = JSON.parse(snapshot[`rotativa_${profile.name}`] || "{}");
        } catch {
            rotation = {};
        }

        return { ...profile, _qaRotation: rotation };
    });
}

async function status() {
    const manifest = await getDocument(MANIFEST_PATH);
    let workspaces = 0;
    let profiles = 0;
    let pwaLinks = 0;
    let pwaData = 0;
    const workspaceDetails = [];
    const estamentos = {};
    const rotativas = {};

    for (const workspace of WORKSPACES) {
        const root = await getDocument(`workspaces/${workspace.id}`);
        if (!root || root.data.qaFixtureId !== FIXTURE_ID) continue;

        const workspaceProfiles = await readProfiles(workspace.id);
        const workspacePwaLinks = (await listDocuments(
            `workspaces/${workspace.id}/workerLinks`
        )).filter(item => item.data.qaFixtureId === FIXTURE_ID).length;
        const workspacePwaData = (await listDocuments(
            `workspaces/${workspace.id}/workerAppData`
        )).filter(item => item.data.qaFixtureId === FIXTURE_ID).length;

        workspaces += 1;
        profiles += workspaceProfiles.length;
        pwaLinks += workspacePwaLinks;
        pwaData += workspacePwaData;
        workspaceDetails.push({
            id: workspace.id,
            profiles: workspaceProfiles.length,
            pwaLinks: workspacePwaLinks,
            pwaData: workspacePwaData
        });
        workspaceProfiles.forEach(profile => {
            const role = profile.estamento || "Sin estamento";
            const rotation = profile._qaRotation?.type || "Sin rotativa";
            estamentos[role] = (estamentos[role] || 0) + 1;
            rotativas[rotation] = (rotativas[rotation] || 0) + 1;
        });
    }

    let workspaceLinks = 0;
    for (const [fromIndex, toIndex] of WORKSPACE_LINKS) {
        const id = linkId(WORKSPACES[fromIndex], WORKSPACES[toIndex]);
        const link = await getDocument(`workspaceLinks/${id}`);
        if (link?.data?.qaFixtureId === FIXTURE_ID) workspaceLinks += 1;
    }

    const result = {
        fixtureId: FIXTURE_ID,
        manifest: Boolean(manifest),
        workspaces,
        profiles,
        pwaLinks,
        pwaData,
        pwaAdoptionPercent: profiles ? Math.round(pwaLinks * 100 / profiles) : 0,
        workspaceLinks,
        estamentos,
        rotativas,
        workspaceDetails
    };

    console.log(JSON.stringify(result, null, 2));
    return result;
}

async function cleanup() {
    requireProductionConfirmation();
    const manifest = await getDocument(MANIFEST_PATH);

    if (!manifest || manifest.data.fixtureId !== FIXTURE_ID) {
        throw new Error("No existe un manifiesto válido; se cancela la limpieza.");
    }

    for (const workspace of WORKSPACES) {
        const root = await getDocument(`workspaces/${workspace.id}`);
        if (root && root.data.qaFixtureId !== FIXTURE_ID) {
            throw new Error(
                `Protección activada: ${workspace.id} no pertenece al fixture QA.`
            );
        }
    }

    const ownerUid = manifest.data.ownerUid;
    const paths = fixturePaths();
    const childDeletes = [
        ...paths.workspaceChildren,
        ...paths.workerMirrors,
        ...paths.ownerIndexes.map(item => item.replace("OWNER_UID", ownerUid)),
        ...WORKSPACES.map(workspace =>
            `workspaces/${workspace.id}/members/${ownerUid}`
        ),
        ...paths.links
    ].map(deleteDocument);
    const rootDeletes = [
        ...paths.workspaceRoots,
        MANIFEST_PATH
    ].map(deleteDocument);

    await commitWrites(childDeletes, "Eliminando datos QA relacionados");
    await commitWrites(rootDeletes, "Eliminando entornos QA");
    await status();
}

function requireProductionConfirmation() {
    if (!process.argv.includes("--confirm-production")) {
        throw new Error(
            "Esta operación modifica producción. Agrega --confirm-production."
        );
    }
}

async function main() {
    const action = process.argv[2] || "status";

    if (action === "seed") {
        await seed();
        return;
    }
    if (action === "cleanup") {
        await cleanup();
        return;
    }
    if (action === "status") {
        await status();
        return;
    }

    throw new Error("Uso: seed | status | cleanup [--confirm-production]");
}

main().catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
});
