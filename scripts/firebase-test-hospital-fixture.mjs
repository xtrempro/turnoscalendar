import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const PROJECT_ID = "turnoplus-test-7c4d9";
const ADMIN_EMAIL = "tm.alanplaza@gmail.com";
const FIXTURE_ID = "turnoplus-hospital-demo-v1";
const MANIFEST_PATH = `qaFixtures/${FIXTURE_ID}`;
const WRITE_BATCH_SIZE = 150;
const MAX_CHUNK_CHARS = 700000;
const BASE_ROTATION_START = "2026-01-01";

const DB_ROOT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    "/databases/(default)";
const DOCUMENTS_ROOT = `${DB_ROOT}/documents`;

const UNIT_SPECS = [
    {
        id: "demo_urgencia_adulto_v1",
        name: "Urgencia Adulto",
        roles: [
            fourthTurn("Enfermera", "Profesional", 8),
            fourthTurn("Técnico en Enfermería", "Técnico", 6),
            fourthTurn("Auxiliar", "Auxiliar", 2),
            fourthTurn("Kinesiólogo", "Profesional", 1)
        ]
    },
    {
        id: "demo_urgencia_infantil_v1",
        name: "Urgencia Infantil",
        roles: [
            fourthTurn("Enfermera", "Profesional", 3),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1),
            fourthTurn("Kinesiólogo", "Profesional", 1)
        ]
    },
    {
        id: "demo_urgencia_gineco_obstetra_v1",
        name: "Urgencia Gineco-Obstetra",
        roles: [
            fourthTurn("Matrona", "Profesional", 2),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1)
        ]
    },
    {
        id: "demo_pabellon_v1",
        name: "Pabellón",
        roles: [
            fourthTurn("Enfermera", "Profesional", 4),
            fourthTurn("Técnico en Enfermería", "Técnico", 3),
            fourthTurn("Auxiliar", "Auxiliar", 2)
        ]
    },
    {
        id: "demo_imagenologia_v1",
        name: "Imagenología",
        roles: [
            fourthTurn("TM Imagenología", "Profesional", 3),
            fourthTurn("Técnico en Imagenología", "Técnico", 3),
            fourthTurn("Auxiliar", "Auxiliar", 1)
        ]
    },
    {
        id: "demo_samu_v1",
        name: "SAMU",
        roles: [
            fourthTurn("Enfermera", "Profesional", 2),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1),
            fourthTurn("Kinesiólogo", "Profesional", 1)
        ]
    },
    {
        id: "demo_laboratorio_v1",
        name: "Laboratorio",
        roles: [
            fourthTurn("TM Laboratorio", "Profesional", 7),
            fourthTurn("Técnico en Laboratorio", "Técnico", 3)
        ]
    },
    {
        id: "demo_anatomia_patologica_v1",
        name: "Anatomía Patológica",
        roles: [
            dayTurn("TM Morfofisiopatología", "Profesional", 2),
            dayTurn("Técnico en Enfermería", "Técnico", 2)
        ]
    },
    {
        id: "demo_medico_quirurgico_ala_norte_v1",
        name: "Médico Quirúrgico Ala Norte",
        roles: [
            fourthTurn("Enfermera", "Profesional", 2),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1)
        ]
    },
    {
        id: "demo_medico_quirurgico_ala_sur_v1",
        name: "Médico Quirúrgico Ala Sur",
        roles: [
            fourthTurn("Enfermera", "Profesional", 2),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1)
        ]
    },
    {
        id: "demo_aislamiento_v1",
        name: "Aislamiento",
        roles: [
            fourthTurn("Enfermera", "Profesional", 2),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1)
        ]
    },
    {
        id: "demo_hospitalizacion_domiciliaria_v1",
        name: "Hospitalización Domiciliaria",
        roles: [
            fourthTurn("Enfermera", "Profesional", 2),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1),
            fourthTurn("Kinesiólogo", "Profesional", 1)
        ]
    },
    {
        id: "demo_pediatria_v1",
        name: "Pediatría",
        roles: [
            fourthTurn("Enfermera", "Profesional", 2),
            fourthTurn("Técnico en Enfermería", "Técnico", 2),
            fourthTurn("Auxiliar", "Auxiliar", 1),
            fourthTurn("Kinesiólogo", "Profesional", 1)
        ]
    },
    {
        id: "demo_rrhh_v1",
        name: "RRHH",
        roles: [
            dayTurn("Administrativo", "Administrativo", 30)
        ]
    }
];

const FIRST_NAMES = [
    "Ana", "Bruno", "Carla", "Diego", "Elena", "Felipe", "Gloria", "Hugo",
    "Isabel", "Javier", "Karina", "Luis", "Mariana", "Nicolas", "Olivia",
    "Pablo", "Rosa", "Sergio", "Tamara", "Victor", "Amanda", "Cristian",
    "Daniela", "Emilio", "Francisca", "Gabriel", "Helena", "Ignacio",
    "Jose", "Laura", "Manuel", "Paula", "Rafael", "Silvia", "Tomas",
    "Valeria", "Camilo", "Lorena", "Rodrigo", "Natalia"
];

const LAST_NAMES = [
    "Rojas", "Soto", "Silva", "Torres", "Flores", "Araya", "Morales",
    "Fuentes", "Vargas", "Castro", "Pizarro", "Reyes", "Navarro",
    "Aguilera", "Campos", "Vega", "Molina", "Cortes", "Bravo", "Leiva",
    "Gallardo", "Paredes", "Saavedra", "Tapia", "Carrasco", "Miranda",
    "Escobar", "Salinas", "Figueroa", "Bustos", "Valenzuela", "Medina",
    "Vera", "Godoy", "Herrera", "Caceres", "Arias", "Parra", "Mendez",
    "Sepulveda"
];

const SECOND_LAST_NAMES = [
    "Campos", "Vega", "Molina", "Cortes", "Bravo", "Leiva", "Gallardo",
    "Paredes", "Saavedra", "Tapia", "Carrasco", "Miranda", "Escobar",
    "Salinas", "Figueroa", "Bustos", "Valenzuela", "Medina", "Vera",
    "Godoy", "Herrera", "Caceres", "Arias", "Parra", "Mendez", "Rojas",
    "Soto", "Silva", "Torres", "Flores", "Araya", "Morales", "Fuentes",
    "Vargas", "Castro", "Pizarro", "Reyes", "Navarro", "Aguilera",
    "Sepulveda"
];

let cachedAccessToken = "";

function fourthTurn(profession, estamento, perTurn) {
    return { profession, estamento, rotation: "4turno", perTurn };
}

function dayTurn(profession, estamento, total) {
    return { profession, estamento, rotation: "diurno", total };
}

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

async function commitWrites(writes) {
    const filtered = writes.filter(Boolean);

    for (
        let index = 0;
        index < filtered.length;
        index += WRITE_BATCH_SIZE
    ) {
        await api(`${DB_ROOT}/documents:commit`, {
            method: "POST",
            body: JSON.stringify({
                writes: filtered.slice(index, index + WRITE_BATCH_SIZE)
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
        `${DOCUMENTS_ROOT}/${encodedPath(collectionPath)}?pageSize=1000`,
        {},
        { allowNotFound: true }
    );

    return (body?.documents || []).map(doc => ({
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

function rotationSequence(rotation) {
    if (rotation.type === "4turno") return [1, 2, 0, 0];
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

function fourthTurnRotation(phase) {
    return {
        type: "4turno",
        start: isoDate(addUtcDays(new Date(`${BASE_ROTATION_START}T00:00:00.000Z`), phase)),
        firstTurn: "larga"
    };
}

function dayRotation() {
    return {
        type: "diurno",
        start: BASE_ROTATION_START,
        firstTurn: "larga"
    };
}

function makeWorkerName(globalIndex) {
    const first = FIRST_NAMES[globalIndex % FIRST_NAMES.length];
    const last = LAST_NAMES[
        Math.floor(globalIndex / FIRST_NAMES.length) %
            LAST_NAMES.length
    ];
    let second = SECOND_LAST_NAMES[
        (globalIndex * 7) % SECOND_LAST_NAMES.length
    ];

    if (second === last) {
        second = SECOND_LAST_NAMES[
            (globalIndex * 7 + 1) % SECOND_LAST_NAMES.length
        ];
    }

    return `${first} ${last} ${second}`;
}

function expectedProfileCount(unit) {
    return unit.roles.reduce((total, role) =>
        total + (role.rotation === "4turno" ? role.perTurn * 4 : role.total),
        0
    );
}

function makeProfilesForUnit(unit, unitIndex, globalCounter) {
    const entries = [];
    let localIndex = 0;

    for (const role of unit.roles) {
        if (role.rotation === "4turno") {
            for (let phase = 0; phase < 4; phase++) {
                for (let slot = 0; slot < role.perTurn; slot++) {
                    entries.push(makeProfile({
                        unit,
                        unitIndex,
                        localIndex: localIndex++,
                        globalIndex: globalCounter.next++,
                        role,
                        rotation: fourthTurnRotation(phase)
                    }));
                }
            }
            continue;
        }

        for (let slot = 0; slot < role.total; slot++) {
            entries.push(makeProfile({
                unit,
                unitIndex,
                localIndex: localIndex++,
                globalIndex: globalCounter.next++,
                role,
                rotation: dayRotation()
            }));
        }
    }

    return entries;
}

function makeProfile({
    unit,
    unitIndex,
    localIndex,
    globalIndex,
    role,
    rotation
}) {
    const number = localIndex + 1;
    const name = makeWorkerName(globalIndex);

    return {
        profile: {
            id: `${unit.id}_worker_${pad(number, 3)}`,
            name,
            email:
                `demo.${unit.id.replace(/^demo_/, "").replace(/_v1$/, "")}.` +
                `worker${pad(number, 3)}@example.invalid`,
            rut: formatRut(31000000 + unitIndex * 1000 + number),
            phone: `9${pad(unitIndex + 1, 2)}${pad(number, 6)}`.slice(0, 9),
            birthDate:
                `${1978 + (globalIndex % 23)}-${pad((globalIndex % 12) + 1)}-${pad((globalIndex % 27) + 1)}`,
            docs: [],
            active: true,
            unitEntryDate: `2025-${pad((globalIndex % 12) + 1)}-01`,
            contractType: globalIndex % 5 === 0 ? "Planta" : "Contrata",
            honorariaStart: "",
            honorariaEnd: "",
            honorariaHourlyRate: 0,
            honorariaMaxMonthlyHours: 0,
            unionLeaveEnabled: false,
            estamento: role.estamento,
            profession: role.profession,
            grade: role.estamento === "Profesional"
                ? String(10 + (globalIndex % 6))
                : role.estamento === "Administrativo"
                    ? String(14 + (globalIndex % 5))
                    : String(12 + (globalIndex % 10)),
            qaFixtureId: FIXTURE_ID,
            synthetic: true
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

function chunkText(text) {
    if (text.length <= MAX_CHUNK_CHARS) return [text];

    const parts = [];
    for (let index = 0; index < text.length; index += MAX_CHUNK_CHARS) {
        parts.push(text.slice(index, index + MAX_CHUNK_CHARS));
    }
    return parts;
}

function buildAllUnitProfiles() {
    const globalCounter = { next: 0 };
    const seenNames = new Set();
    const result = new Map();

    for (let unitIndex = 0; unitIndex < UNIT_SPECS.length; unitIndex++) {
        const unit = UNIT_SPECS[unitIndex];
        const entries = makeProfilesForUnit(unit, unitIndex, globalCounter);

        for (const { profile } of entries) {
            if (!/^[A-Za-z ]+$/.test(profile.name)) {
                throw new Error(`Nombre invalido: ${profile.name}`);
            }
            if (seenNames.has(profile.name)) {
                throw new Error(`Nombre duplicado: ${profile.name}`);
            }
            seenNames.add(profile.name);
        }

        result.set(unit.id, entries);
    }

    return result;
}

function profileModule(entries) {
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
        text,
        chunks: chunkText(text),
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
            `Se esperaba una cuenta Auth unica para ${ADMIN_EMAIL}.`
        );
    }

    return {
        uid: users[0].localId,
        email: users[0].email || ADMIN_EMAIL,
        displayName: users[0].displayName || "Administrador Test"
    };
}

async function fixtureDeletesForWorkspace(unit, ownerUid = "") {
    const root = await getDocument(`workspaces/${unit.id}`);

    if (root && root.data.qaFixtureId !== FIXTURE_ID) {
        throw new Error(
            `Colision: ${unit.id} existe y no pertenece a ${FIXTURE_ID}.`
        );
    }

    if (!root) return [];

    const [links, appData, chunks] = await Promise.all([
        listDocuments(`workspaces/${unit.id}/workerLinks`),
        listDocuments(`workspaces/${unit.id}/workerAppData`),
        listDocuments(`workspaces/${unit.id}/stateModules/profile/chunks`)
    ]);
    const uids = new Set([
        ...links.filter(item => item.data.qaFixtureId === FIXTURE_ID)
            .map(item => item.id),
        ...appData.filter(item => item.data.qaFixtureId === FIXTURE_ID)
            .map(item => item.id)
    ]);

    return [
        ...links
            .filter(item => item.data.qaFixtureId === FIXTURE_ID)
            .map(item => deleteDocument(`workspaces/${unit.id}/workerLinks/${item.id}`)),
        ...appData
            .filter(item => item.data.qaFixtureId === FIXTURE_ID)
            .map(item => deleteDocument(`workspaces/${unit.id}/workerAppData/${item.id}`)),
        ...[...uids].map(uid =>
            deleteDocument(`users/${uid}/workerLinks/${unit.id}`)
        ),
        ...chunks
            .filter(item => item.data.qaFixtureId === FIXTURE_ID)
            .map(item =>
                deleteDocument(
                    `workspaces/${unit.id}/stateModules/profile/chunks/${item.id}`
                )
            ),
        deleteDocument(`workspaces/${unit.id}/stateModules/profile`),
        ownerUid
            ? deleteDocument(`workspaces/${unit.id}/members/${ownerUid}`)
            : null,
        ownerUid
            ? deleteDocument(`users/${ownerUid}/workspaces/${unit.id}`)
            : null,
        deleteDocument(`workspaces/${unit.id}`)
    ];
}

function unitBaseWrites(unit, entries, owner, now) {
    const module = profileModule(entries);
    const writes = [
        writeDocument(`workspaces/${unit.id}`, {
            id: unit.id,
            name: unit.name,
            ownerUid: owner.uid,
            createdByEmail: owner.email,
            createdAt: now,
            updatedAt: now,
            workersCount: entries.length,
            activeWorkersCount: entries.length,
            pwaUsersCount: entries.length,
            qaFixtureId: FIXTURE_ID,
            synthetic: true,
            testDataNotice:
                "Entorno ficticio hospitalario con dotacion homogenea por rotativa"
        }),
        writeDocument(`workspaces/${unit.id}/members/${owner.uid}`, {
            role: "owner",
            email: owner.email,
            displayName: owner.displayName,
            joinedAt: now,
            qaFixtureId: FIXTURE_ID
        }),
        writeDocument(`users/${owner.uid}/workspaces/${unit.id}`, {
            name: unit.name,
            role: "owner",
            joinedAt: now,
            qaFixtureId: FIXTURE_ID,
            synthetic: true
        }),
        writeDocument(`workspaces/${unit.id}/stateModules/profile`, {
            moduleId: "profile",
            permission: "profile",
            chunkCount: module.chunks.length,
            charCount: module.text.length,
            hash: module.hash,
            clientId: "hospital_fixture_generator",
            updatedAtISO: now.toISOString(),
            updatedAt: now,
            qaFixtureId: FIXTURE_ID
        }),
        ...module.chunks.map((text, chunkIndex) =>
            writeDocument(
                `workspaces/${unit.id}/stateModules/profile/chunks/part_${pad(chunkIndex, 4)}`,
                {
                    moduleId: "profile",
                    index: chunkIndex,
                    text,
                    updatedAt: now,
                    qaFixtureId: FIXTURE_ID
                }
            )
        )
    ];

    return writes;
}

function pwaUid(unit, index) {
    return `${unit.id.replace(/_v1$/, "")}_pwa_${pad(index + 1, 3)}`;
}

function unitPwaWrites(unit, entries, now) {
    return entries.flatMap(({ profile, rotation }, index) => {
        const uid = pwaUid(unit, index);
        const schedule = scheduleFor(rotation);
        const link = {
            uid,
            workspaceId: unit.id,
            workspaceName: unit.name,
            inviteId: `${unit.id}_invite_${pad(index + 1, 3)}`,
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

        return [
            writeDocument(`workspaces/${unit.id}/workerLinks/${uid}`, link),
            writeDocument(`users/${uid}/workerLinks/${unit.id}`, link),
            writeDocument(`workspaces/${unit.id}/workerAppData/${uid}`, {
                uid,
                workspaceId: unit.id,
                workspaceName: unit.name,
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
                    unit: unit.name,
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
                overtimeSummariesStatus: "fresh",
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
                    sessionsLast30Days: 3 + (index % 19),
                    lastSeenAt: now.toISOString(),
                    adoptionCohort: "hospital_demo_all_workers"
                },
                updatedAtISO: now.toISOString(),
                updatedAt: now,
                qaFixtureId: FIXTURE_ID,
                synthetic: true
            })
        ];
    });
}

async function seed() {
    const owner = await findOwner();
    const now = new Date();
    const profilesByUnit = buildAllUnitProfiles();
    const existingManifest = await getDocument(MANIFEST_PATH);

    for (const unit of UNIT_SPECS) {
        await commitWrites(await fixtureDeletesForWorkspace(unit, owner.uid));
    }

    for (const unit of UNIT_SPECS) {
        const entries = profilesByUnit.get(unit.id);
        await commitWrites(unitBaseWrites(unit, entries, owner, now));
        await commitWrites(unitPwaWrites(unit, entries, now));
        console.log(`${unit.name}: ${entries.length} trabajadores creados.`);
    }

    const totalProfiles = [...profilesByUnit.values()]
        .reduce((sum, entries) => sum + entries.length, 0);

    await commitWrites([
        writeDocument(MANIFEST_PATH, {
            fixtureId: FIXTURE_ID,
            projectId: PROJECT_ID,
            ownerUid: owner.uid,
            ownerEmail: owner.email,
            units: UNIT_SPECS.length,
            profiles: totalProfiles,
            pwaLinks: totalProfiles,
            workspaceIds: UNIT_SPECS.map(unit => unit.id),
            workspaceNames: UNIT_SPECS.map(unit => unit.name),
            createdAt: existingManifest?.data?.createdAt
                ? new Date(existingManifest.data.createdAt)
                : now,
            updatedAt: now,
            cleanupCommand:
                "node scripts/firebase-test-hospital-fixture.mjs cleanup --confirm-test-cleanup"
        })
    ]);

    const result = await status();

    if (result.issues.length) {
        throw new Error(`Validacion con errores: ${result.issues.join("; ")}`);
    }
}

async function readProfileSnapshot(unitId) {
    const chunks = await listDocuments(
        `workspaces/${unitId}/stateModules/profile/chunks`
    );

    if (!chunks.length) return { profiles: [], snapshot: {} };

    const text = chunks
        .map(chunk => ({
            index: Number(chunk.data.index) || 0,
            id: chunk.id,
            text: String(chunk.data.text || "")
        }))
        .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
        .map(chunk => chunk.text)
        .join("");
    const snapshot = JSON.parse(text);
    const profiles = JSON.parse(snapshot.profiles || "[]");

    return { profiles, snapshot };
}

function phaseFromRotation(rotation) {
    if (rotation?.type !== "4turno") return "diurno";

    const start = String(rotation.start || "");
    const day = Number(start.slice(8, 10));

    return Number.isFinite(day) ? `fase_${((day - 1) % 4) + 1}` : "fase_?";
}

function summarizeProfiles(unit, profiles, snapshot) {
    const byProfession = {};
    const byPhase = {};
    const invalidNames = [];

    for (const profile of profiles) {
        const profession = profile.profession || "Sin profesion";
        const rotation = JSON.parse(
            snapshot[`rotativa_${profile.name}`] || "{}"
        );
        const phase = phaseFromRotation(rotation);

        byProfession[profession] = (byProfession[profession] || 0) + 1;
        byPhase[profession] ||= {};
        byPhase[profession][phase] = (byPhase[profession][phase] || 0) + 1;

        if (!/^[A-Za-z ]+$/.test(profile.name)) {
            invalidNames.push(profile.name);
        }
    }

    const expected = Object.fromEntries(
        unit.roles.map(role => [
            role.profession,
            role.rotation === "4turno" ? role.perTurn * 4 : role.total
        ])
    );

    return { byProfession, byPhase, expected, invalidNames };
}

async function status() {
    const manifest = await getDocument(MANIFEST_PATH);
    const units = [];
    const issues = [];
    let totalProfiles = 0;
    let totalPwaLinks = 0;
    let totalPwaData = 0;

    for (const unit of UNIT_SPECS) {
        const [root, profileSnapshot, workerLinks, workerAppData] =
            await Promise.all([
                getDocument(`workspaces/${unit.id}`),
                readProfileSnapshot(unit.id),
                listDocuments(`workspaces/${unit.id}/workerLinks`),
                listDocuments(`workspaces/${unit.id}/workerAppData`)
            ]);

        const { profiles, snapshot } = profileSnapshot;
        const summary = summarizeProfiles(unit, profiles, snapshot);
        const expectedCount = expectedProfileCount(unit);
        const fixtureLinks = workerLinks.filter(item =>
            item.data.qaFixtureId === FIXTURE_ID
        ).length;
        const fixtureData = workerAppData.filter(item =>
            item.data.qaFixtureId === FIXTURE_ID
        ).length;

        if (!root) issues.push(`${unit.name}: falta workspace`);
        if (profiles.length !== expectedCount) {
            issues.push(
                `${unit.name}: perfiles ${profiles.length}/${expectedCount}`
            );
        }
        if (fixtureLinks !== expectedCount) {
            issues.push(`${unit.name}: workerLinks ${fixtureLinks}/${expectedCount}`);
        }
        if (fixtureData !== expectedCount) {
            issues.push(`${unit.name}: workerAppData ${fixtureData}/${expectedCount}`);
        }
        if (summary.invalidNames.length) {
            issues.push(
                `${unit.name}: nombres invalidos ${summary.invalidNames.join(", ")}`
            );
        }

        for (const role of unit.roles) {
            const actual = summary.byProfession[role.profession] || 0;
            const expected =
                role.rotation === "4turno" ? role.perTurn * 4 : role.total;

            if (actual !== expected) {
                issues.push(
                    `${unit.name}/${role.profession}: ${actual}/${expected}`
                );
            }

            if (role.rotation === "4turno") {
                for (let phase = 1; phase <= 4; phase++) {
                    const actualPhase =
                        summary.byPhase[role.profession]?.[`fase_${phase}`] || 0;

                    if (actualPhase !== role.perTurn) {
                        issues.push(
                            `${unit.name}/${role.profession}/fase_${phase}: ` +
                            `${actualPhase}/${role.perTurn}`
                        );
                    }
                }
            }
        }

        totalProfiles += profiles.length;
        totalPwaLinks += fixtureLinks;
        totalPwaData += fixtureData;

        units.push({
            id: unit.id,
            name: root?.data?.name || unit.name,
            profiles: profiles.length,
            workerLinks: fixtureLinks,
            workerAppData: fixtureData,
            byProfession: summary.byProfession,
            byPhase: summary.byPhase
        });
    }

    const result = {
        projectId: PROJECT_ID,
        fixtureId: FIXTURE_ID,
        manifest: Boolean(manifest),
        units: units.length,
        profiles: totalProfiles,
        workerLinks: totalPwaLinks,
        workerAppData: totalPwaData,
        details: units,
        issues
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
        throw new Error("No existe un manifiesto valido para este fixture.");
    }

    const ownerUid = manifest.data.ownerUid || "";
    const deletes = [];

    for (const unit of UNIT_SPECS) {
        deletes.push(...await fixtureDeletesForWorkspace(unit, ownerUid));
    }

    deletes.push(deleteDocument(MANIFEST_PATH));

    await commitWrites(deletes);
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
