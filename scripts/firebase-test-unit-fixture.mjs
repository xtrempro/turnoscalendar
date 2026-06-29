import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const PROJECT_ID = "turnoplus-test-7c4d9";
const ADMIN_EMAIL = "tm.alanplaza@gmail.com";
const FIXTURE_ID = "turnoplus-test-unit-60-v1";
const WORKSPACE = {
    id: "test_unit_60_workers_v1",
    name: "[TEST] Unidad 60 Trabajadores"
};
const PROFILE_COUNT = 60;
const PWA_COUNT = 50;
const WRITE_BATCH_SIZE = 150;
const MANIFEST_PATH = `qaFixtures/${FIXTURE_ID}`;
const DB_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)";
const DOCUMENTS_ROOT = `${DB_ROOT}/documents`;

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

let cachedAccessToken = "";

function firebaseToolsModule(relativePath) {
    const npmRoot = process.platform === "win32"
        ? path.join(process.env.APPDATA, "npm", "node_modules")
        : execFileSync("npm", ["root", "-g"], {
            encoding: "utf8"
        }).trim();

    return require(path.join(
        npmRoot,
        "firebase-tools",
        "lib",
        relativePath
    ));
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

    const tokens = await auth.getAccessToken(
        account.tokens.refresh_token,
        []
    );
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
        const message =
            body?.error?.message || text || `HTTP ${response.status}`;
        throw new Error(`${response.status} ${message}`);
    }

    return body;
}

function encodeValue(value) {
    if (value === null) return { nullValue: null };
    if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
    }
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

function encodeFields(data) {
    return Object.fromEntries(
        Object.entries(data)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, encodeValue(value)])
    );
}

function decodeFields(fields = {}) {
    return Object.fromEntries(
        Object.entries(fields)
            .map(([key, value]) => [key, decodeValue(value)])
    );
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

async function commitWrites(writes) {
    for (
        let index = 0;
        index < writes.length;
        index += WRITE_BATCH_SIZE
    ) {
        await api(`${DB_ROOT}/documents:commit`, {
            method: "POST",
            body: JSON.stringify({
                writes: writes.slice(index, index + WRITE_BATCH_SIZE)
            })
        });
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
    const grouped = String(number)
        .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${grouped}-${rutCheckDigit(number)}`;
}

function estamentoFor(index) {
    if (index < 24) return "Profesional";
    if (index < 42) return "Técnico";
    if (index < 54) return "Administrativo";
    return "Auxiliar";
}

function rotationFor(index) {
    const position = index % 20;
    const type = position < 9
        ? "4turno"
        : position < 16
            ? "3turno"
            : "diurno";
    const firstTurns = type === "3turno"
        ? ["larga", "larga2", "noche", "noche2", "libre1", "libre2"]
        : type === "4turno"
            ? ["larga", "noche", "libre1", "libre2"]
            : ["larga"];

    return {
        type,
        start: `2026-01-${pad((index % 28) + 1)}`,
        firstTurn: firstTurns[index % firstTurns.length]
    };
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
        const starts = {
            larga: 0,
            noche: 1,
            libre1: 2,
            libre2: 3
        };
        const start = starts[rotation.firstTurn] || 0;
        return [...sequence.slice(start), ...sequence.slice(0, start)];
    }

    return [];
}

function scheduleFor(rotation) {
    const now = new Date();
    const start = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1
    ));
    const end = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + 2,
        0
    ));
    const rotationStart = new Date(`${rotation.start}T00:00:00.000Z`);
    const sequence = rotationSequence(rotation);
    const labels = {
        0: "Libre",
        1: "Larga",
        2: "Noche",
        4: "Diurno"
    };
    const classes = {
        0: "libre",
        1: "larga",
        2: "noche",
        4: "diurno"
    };
    const days = {};

    for (
        let cursor = new Date(start);
        cursor <= end;
        cursor = addUtcDays(cursor, 1)
    ) {
        const iso = isoDate(cursor);
        let turn = 0;

        if (rotation.type === "diurno") {
            turn = cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6
                ? 0
                : 4;
        } else {
            const offset = Math.floor(
                (cursor - rotationStart) / 86400000
            );
            turn = sequence[
                ((offset % sequence.length) + sequence.length) %
                    sequence.length
            ];
        }

        days[iso] = {
            iso,
            keyDay:
                `${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}-${cursor.getUTCDate()}`,
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

// Deja uno de cada seis perfiles sin enlace: 50 PWA y 10 controles.
function pwaProfileIndexes() {
    return Array.from(
        { length: PROFILE_COUNT },
        (_, index) => index
    ).filter(index => index % 6 !== 5);
}

function pwaUid(index) {
    return `test_pwa_unit60_${pad(index + 1, 3)}`;
}

function makeProfile(index) {
    const number = index + 1;
    const estamento = estamentoFor(index);
    const professions = PROFESSIONS[estamento];
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
    const firstLastName = LAST_NAMES[(index * 3) % LAST_NAMES.length];
    const secondLastName = LAST_NAMES[(index * 7 + 5) % LAST_NAMES.length];
    const rotation = rotationFor(index);
    const name =
        `${firstName} ${firstLastName} ${secondLastName} TEST-${pad(number, 3)}`;

    return {
        profile: {
            id: `test60_${pad(number, 3)}`,
            name,
            email: `test.unit60.worker${pad(number, 3)}@example.invalid`,
            rut: formatRut(27000000 + number),
            phone: `91${pad(number, 6)}`,
            birthDate:
                `${1975 + (index % 25)}-${pad((index % 12) + 1)}-${pad((index % 27) + 1)}`,
            docs: [],
            active: true,
            unitEntryDate: `2025-${pad((index % 12) + 1)}-01`,
            contractType: index % 4 === 0 ? "Planta" : "Contrata",
            honorariaStart: "",
            honorariaEnd: "",
            honorariaHourlyRate: 0,
            honorariaMaxMonthlyHours: 0,
            unionLeaveEnabled: index % 13 === 0,
            estamento,
            profession: professions[index % professions.length],
            grade: estamento === "Profesional"
                ? String(10 + (index % 6))
                : String(12 + (index % 13)),
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

function profileModule() {
    const entries = Array.from(
        { length: PROFILE_COUNT },
        (_, index) => makeProfile(index)
    );
    const snapshot = {
        profiles: JSON.stringify(entries.map(item => item.profile))
    };

    entries.forEach(({ profile, rotation }) => {
        snapshot[`rotativa_${profile.name}`] = JSON.stringify(rotation);
        snapshot[`shift_${profile.name}`] = JSON.stringify(
            rotation.type !== "diurno"
        );
    });

    const ordered = Object.fromEntries(
        Object.entries(snapshot)
            .sort(([left], [right]) => left.localeCompare(right))
    );
    const text = JSON.stringify(ordered);

    return {
        entries,
        text,
        hash: hashString(text)
    };
}

async function findOwner() {
    const result = await api(
        `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}` +
            "/accounts:lookup",
        {
            method: "POST",
            body: JSON.stringify({ email: [ADMIN_EMAIL] })
        }
    );
    const users = result.users || [];

    if (users.length !== 1 || !users[0].localId) {
        throw new Error(
            `Se esperaba una cuenta Auth única para ${ADMIN_EMAIL}.`
        );
    }

    return {
        uid: users[0].localId,
        email: users[0].email || ADMIN_EMAIL,
        displayName: users[0].displayName || "Administrador Test"
    };
}

async function seed() {
    const [existing, existingManifest] = await Promise.all([
        getDocument(`workspaces/${WORKSPACE.id}`),
        getDocument(MANIFEST_PATH)
    ]);

    if (existing && existing.data.qaFixtureId !== FIXTURE_ID) {
        throw new Error(
            `Colisión: ${WORKSPACE.id} existe y no pertenece a este fixture.`
        );
    }

    const owner = await findOwner();
    const module = profileModule();
    const now = new Date();
    const createdAt = existing?.data?.createdAt
        ? new Date(existing.data.createdAt)
        : now;
    const writes = [
        writeDocument(`workspaces/${WORKSPACE.id}`, {
            id: WORKSPACE.id,
            name: WORKSPACE.name,
            ownerUid: owner.uid,
            createdByEmail: owner.email,
            createdAt,
            updatedAt: now,
            qaFixtureId: FIXTURE_ID,
            synthetic: true,
            testDataNotice:
                "Unidad ficticia temporal con 60 trabajadores para pruebas"
        }),
        writeDocument(
            `workspaces/${WORKSPACE.id}/members/${owner.uid}`,
            {
                role: "owner",
                email: owner.email,
                displayName: owner.displayName,
                joinedAt: now,
                qaFixtureId: FIXTURE_ID
            }
        ),
        writeDocument(
            `users/${owner.uid}/workspaces/${WORKSPACE.id}`,
            {
                name: WORKSPACE.name,
                role: "owner",
                joinedAt: now,
                qaFixtureId: FIXTURE_ID,
                synthetic: true
            }
        ),
        writeDocument(
            `workspaces/${WORKSPACE.id}/stateModules/profile`,
            {
                moduleId: "profile",
                permission: "profile",
                chunkCount: 1,
                charCount: module.text.length,
                hash: module.hash,
                clientId: "test_unit_fixture_generator",
                updatedAtISO: now.toISOString(),
                updatedAt: now,
                qaFixtureId: FIXTURE_ID
            }
        ),
        writeDocument(
            `workspaces/${WORKSPACE.id}/stateModules/profile/chunks/part_0000`,
            {
                moduleId: "profile",
                index: 0,
                text: module.text,
                updatedAt: now,
                qaFixtureId: FIXTURE_ID
            }
        ),
        writeDocument(MANIFEST_PATH, {
            fixtureId: FIXTURE_ID,
            projectId: PROJECT_ID,
            workspaceId: WORKSPACE.id,
            workspaceName: WORKSPACE.name,
            ownerUid: owner.uid,
            ownerEmail: owner.email,
            profiles: PROFILE_COUNT,
            pwaLinks: PWA_COUNT,
            pwaAdoptionPercent: Math.round(PWA_COUNT * 100 / PROFILE_COUNT),
            createdAt: existingManifest?.data?.createdAt
                ? new Date(existingManifest.data.createdAt)
                : now,
            updatedAt: now,
            cleanupCommand:
                "node scripts/firebase-test-unit-fixture.mjs cleanup --confirm-test-cleanup"
        })
    ];
    const pwaWrites = [];

    for (const index of pwaProfileIndexes()) {
        const uid = pwaUid(index);
        const { profile, rotation } = module.entries[index];
        const schedule = scheduleFor(rotation);
        const link = {
            uid,
            workspaceId: WORKSPACE.id,
            workspaceName: WORKSPACE.name,
            inviteId: `test_invite_unit60_${pad(index + 1, 3)}`,
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
            writeDocument(
                `workspaces/${WORKSPACE.id}/workerLinks/${uid}`,
                link
            ),
            writeDocument(
                `users/${uid}/workerLinks/${WORKSPACE.id}`,
                link
            ),
            writeDocument(
                `workspaces/${WORKSPACE.id}/workerAppData/${uid}`,
                {
                    uid,
                    workspaceId: WORKSPACE.id,
                    workspaceName: WORKSPACE.name,
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
                        unit: WORKSPACE.name,
                        unitEntryDate: profile.unitEntryDate,
                        active: true
                    },
                    rotativa: rotation,
                    shiftAssigned: rotation.type !== "diurno",
                    leaveBalances: {
                        legal: 15,
                        admin: 6,
                        comp: 10
                    },
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
                        adoptionCohort: "50_of_60"
                    },
                    updatedAtISO: now.toISOString(),
                    updatedAt: now,
                    qaFixtureId: FIXTURE_ID,
                    synthetic: true
                }
            )
        );
    }

    await commitWrites(writes);
    await commitWrites(pwaWrites);
    const result = await status();

    if (
        result.profiles !== PROFILE_COUNT ||
        result.pwaLinks !== PWA_COUNT ||
        result.pwaData !== PWA_COUNT ||
        result.pwaMirrors !== PWA_COUNT
    ) {
        throw new Error("La verificación PWA no coincide con 50 enlaces.");
    }
}

async function status() {
    const [root, chunk, manifest, workerLinks, workerAppData] =
        await Promise.all([
            getDocument(`workspaces/${WORKSPACE.id}`),
            getDocument(
                `workspaces/${WORKSPACE.id}/stateModules/profile/chunks/part_0000`
            ),
            getDocument(MANIFEST_PATH),
            listDocuments(`workspaces/${WORKSPACE.id}/workerLinks`),
            listDocuments(`workspaces/${WORKSPACE.id}/workerAppData`)
        ]);
    const ownerUid = manifest?.data?.ownerUid || "";
    const [member, userIndex] = ownerUid
        ? await Promise.all([
            getDocument(`workspaces/${WORKSPACE.id}/members/${ownerUid}`),
            getDocument(`users/${ownerUid}/workspaces/${WORKSPACE.id}`)
        ])
        : [null, null];
    let profiles = [];
    let snapshot = {};

    if (chunk?.data?.text) {
        snapshot = JSON.parse(chunk.data.text);
        profiles = JSON.parse(snapshot.profiles || "[]");
    }

    const estamentos = {};
    const rotativas = {};
    const fixtureWorkerLinks = workerLinks.filter(item =>
        item.data.qaFixtureId === FIXTURE_ID
    );
    const fixtureWorkerAppData = workerAppData.filter(item =>
        item.data.qaFixtureId === FIXTURE_ID
    );
    const mirrorDocs = await Promise.all(
        pwaProfileIndexes().map(index =>
            getDocument(
                `users/${pwaUid(index)}/workerLinks/${WORKSPACE.id}`
            )
        )
    );
    const pwaMirrors = mirrorDocs.filter(item =>
        item?.data?.qaFixtureId === FIXTURE_ID
    ).length;

    profiles.forEach(profile => {
        estamentos[profile.estamento] =
            (estamentos[profile.estamento] || 0) + 1;

        const rotation = JSON.parse(
            snapshot[`rotativa_${profile.name}`] || "{}"
        );
        rotativas[rotation.type || "Sin rotativa"] =
            (rotativas[rotation.type || "Sin rotativa"] || 0) + 1;
    });

    const result = {
        projectId: PROJECT_ID,
        fixtureId: FIXTURE_ID,
        workspace: root
            ? { id: WORKSPACE.id, name: root.data.name }
            : null,
        manifest: Boolean(manifest),
        ownerMember: Boolean(member),
        ownerWorkspaceIndex: Boolean(userIndex),
        profiles: profiles.length,
        estamentos,
        rotativas,
        pwaLinks: fixtureWorkerLinks.length,
        pwaData: fixtureWorkerAppData.length,
        pwaMirrors,
        pwaAdoptionPercent: profiles.length
            ? Math.round(fixtureWorkerLinks.length * 100 / profiles.length)
            : 0
    };

    console.log(JSON.stringify(result, null, 2));
    return result;
}

async function cleanup() {
    if (!process.argv.includes("--confirm-test-cleanup")) {
        throw new Error("Agrega --confirm-test-cleanup para eliminar el fixture.");
    }

    const manifest = await getDocument(MANIFEST_PATH);

    if (!manifest || manifest.data.fixtureId !== FIXTURE_ID) {
        throw new Error("No existe un manifiesto válido para este fixture.");
    }

    const root = await getDocument(`workspaces/${WORKSPACE.id}`);

    if (root && root.data.qaFixtureId !== FIXTURE_ID) {
        throw new Error("Protección activada: la unidad no pertenece al fixture.");
    }

    const ownerUid = manifest.data.ownerUid;
    const pwaDeletes = pwaProfileIndexes().flatMap(index => {
        const uid = pwaUid(index);

        return [
            deleteDocument(
                `workspaces/${WORKSPACE.id}/workerLinks/${uid}`
            ),
            deleteDocument(
                `workspaces/${WORKSPACE.id}/workerAppData/${uid}`
            ),
            deleteDocument(
                `users/${uid}/workerLinks/${WORKSPACE.id}`
            )
        ];
    });

    await commitWrites([
        ...pwaDeletes,
        deleteDocument(
            `workspaces/${WORKSPACE.id}/stateModules/profile/chunks/part_0000`
        ),
        deleteDocument(`workspaces/${WORKSPACE.id}/stateModules/profile`),
        deleteDocument(`workspaces/${WORKSPACE.id}/members/${ownerUid}`),
        deleteDocument(`users/${ownerUid}/workspaces/${WORKSPACE.id}`),
        deleteDocument(`workspaces/${WORKSPACE.id}`),
        deleteDocument(MANIFEST_PATH)
    ]);
    await status();
}

async function main() {
    const action = process.argv[2] || "status";

    if (action === "seed") return seed();
    if (action === "status") return status();
    if (action === "cleanup") return cleanup();

    throw new Error(
        "Uso: seed | status | cleanup --confirm-test-cleanup"
    );
}

main().catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
});
