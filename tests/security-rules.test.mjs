import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    updateDoc,
    where
} from "firebase/firestore";
import {
    deleteObject,
    getBytes,
    ref,
    uploadBytes
} from "firebase/storage";

const PROJECT_ID = "demo-proturnos";
const WORKSPACE_ID = "workspace-security-test";
const TARGET_WORKSPACE_ID = "workspace-security-target";
const TEST_MFA_RULES =
    process.env.TURNOPLUS_RULES_VARIANT === "test-mfa";
const FIRESTORE_RULES_PATH = TEST_MFA_RULES
    ? ".firebase/turnoplus-test/firebase.rules"
    : "firebase.rules";
const STORAGE_RULES_PATH = TEST_MFA_RULES
    ? ".firebase/turnoplus-test/storage.rules"
    : "storage.rules";
const LEGACY_FULL_ADMIN_PERMISSION_KEYS = [
    "turnos",
    "weekly",
    "tasks",
    "kanban",
    "agenda",
    "profile",
    "requests",
    "memos",
    "swap",
    "hours",
    "reports",
    "dashboard",
    "log"
];

function permissions(editable = [], hidden = []) {
    const keys = [
        "turnos",
        "weekly",
        "tasks",
        "kanban",
        "agenda",
        "profile",
        "qualifications",
        "requests",
        "memos",
        "informations",
        "medicalEquipment",
        "tenders",
        "swap",
        "hours",
        "reports",
        "dashboard",
        "log"
    ];

    return Object.fromEntries(
        keys.map(key => [
            key,
            {
                view: !hidden.includes(key),
                edit:
                    !hidden.includes(key) &&
                    editable.includes(key)
            }
        ])
    );
}

function legacyPermissions(editable = [], hidden = []) {
    const next = permissions(editable, hidden);

    delete next.informations;
    delete next.medicalEquipment;
    delete next.tenders;
    delete next.qualifications;
    return next;
}

function manifest(moduleId, permission) {
    return {
        moduleId,
        permission,
        chunkCount: 1,
        charCount: 2,
        hash: "2-test",
        clientId: "rules-test",
        updatedAtISO: new Date().toISOString()
    };
}

function chunk(moduleId) {
    return {
        moduleId,
        index: 0,
        text: "{}"
    };
}

function stateEntry(moduleId, storageKey) {
    return {
        moduleId,
        storageKey,
        items: {
            "2026-5-10": "2"
        },
        deletedItems: {
            "2026-5-10": false
        },
        clientId: "rules-test",
        updatedAtISO: new Date().toISOString()
    };
}

function attachmentMetadata(
    moduleId,
    ownerId,
    recordId,
    uploadedByUid,
    contentType = "application/pdf"
) {
    return {
        contentType,
        customMetadata: {
            workspaceId: WORKSPACE_ID,
            moduleId,
            ownerId,
            recordId,
            uploadedByUid,
            originalName: contentType.startsWith("image/")
                ? "programacion.jpg"
                : "prueba.pdf"
        }
    };
}

test("reglas modulares de Firestore y Storage", async t => {
    // Estas pruebas necesitan el emulador de Firestore/Storage. Cuando no esta
    // corriendo (p.ej. al ejecutar `node --test tests/*.test.mjs` suelto) se
    // SALTAN en vez de fallar. Para correrlas completas: `npm run test:rules`
    // (envuelve el runner con `firebase emulators:exec`).
    let env;
    try {
        env = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: {
                rules: fs.readFileSync(FIRESTORE_RULES_PATH, "utf8")
            },
            storage: {
                rules: fs.readFileSync(STORAGE_RULES_PATH, "utf8")
            }
        });
    } catch (error) {
        t.skip(
            "Requiere el emulador de Firestore (usa: npm run test:rules). " +
            (error?.message || error)
        );
        return;
    }

    const owner = env.authenticatedContext("owner", {
        email: "owner@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const turnosEditor = env.authenticatedContext("turnos-editor", {
        email: "turnos@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const profileEditor = env.authenticatedContext("profile-editor", {
        email: "profile@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const qualificationsEditor = env.authenticatedContext("qualifications-editor", {
        email: "qualifications@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const tasksEditor = env.authenticatedContext("tasks-editor", {
        email: "tasks@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const weeklyEditor = env.authenticatedContext("weekly-editor", {
        email: "weekly@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const agendaEditor = env.authenticatedContext("agenda-editor", {
        email: "agenda@example.com"
    });
    const workerA = env.authenticatedContext("worker-a", {
        email: "worker-a@example.com"
    });
    const workerB = env.authenticatedContext("worker-b", {
        email: "worker-b@example.com"
    });
    const legacyMember = env.authenticatedContext("legacy", {
        email: "legacy@example.com"
    });
    const legacyEditor = env.authenticatedContext("legacy-editor", {
        email: "legacy-editor@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const legacyFullAdmin = env.authenticatedContext("legacy-full-admin", {
        email: "legacy-full-admin@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const profileEditorWithoutMfa = env.authenticatedContext(
        "profile-editor-no-mfa",
        { email: "profile-no-mfa@example.com" }
    );
    const qualificationsEditorWithoutMfa = env.authenticatedContext(
        "qualifications-editor-no-mfa",
        { email: "qualifications-no-mfa@example.com" }
    );
    const ownerWithoutMfa = env.authenticatedContext(
        "owner-no-mfa",
        { email: "owner-no-mfa@example.com" }
    );
    const viewer = env.authenticatedContext("viewer", {
        email: "viewer@example.com"
    });
    const targetOwner = env.authenticatedContext("target-owner", {
        email: "target-owner@example.com",
        firebase: {
            sign_in_provider: "google.com",
            sign_in_second_factor: "totp"
        }
    });
    const restrictedViewer = env.authenticatedContext(
        "restricted-viewer",
        { email: "restricted@example.com" }
    );
    const outsider = env.authenticatedContext("outsider", {
        email: "outsider@example.com"
    });

    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();

        await setDoc(doc(db, "workspaces", WORKSPACE_ID), {
            ownerUid: "owner",
            name: "Pruebas"
        });
        await setDoc(doc(db, "workspaces", TARGET_WORKSPACE_ID), {
            ownerUid: "target-owner",
            name: "Unidad destino"
        });
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "members", "owner"),
            { role: "owner", permissions: permissions() }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                TARGET_WORKSPACE_ID,
                "members",
                "target-owner"
            ),
            { role: "owner", permissions: permissions() }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "turnos-editor"
            ),
            { role: "member", permissions: permissions(["turnos"]) }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "profile-editor"
            ),
            { role: "member", permissions: permissions(["profile"]) }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "qualifications-editor"
            ),
            { role: "member", permissions: permissions(["qualifications"]) }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "tasks-editor"
            ),
            { role: "member", permissions: permissions(["tasks"]) }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "weekly-editor"
            ),
            { role: "member", permissions: permissions(["weekly"]) }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "agenda-editor"
            ),
            {
                role: "member",
                permissions: permissions(["agenda"], [
                    "turnos",
                    "weekly",
                    "tasks",
                    "kanban",
                    "profile",
                    "qualifications",
                    "requests",
                    "memos",
                    "swap",
                    "hours",
                    "reports",
                    "dashboard",
                    "log"
                ])
            }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "workerLinks",
                "worker-a"
            ),
            {
                uid: "worker-a",
                workspaceId: WORKSPACE_ID,
                status: "active"
            }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "workerLinks",
                "worker-b"
            ),
            {
                uid: "worker-b",
                workspaceId: WORKSPACE_ID,
                status: "active"
            }
        );
        for (const requestId of ["worker-cancel", "worker-cancel-malicious"]) {
            await setDoc(
                doc(
                    db,
                    "workspaces",
                    WORKSPACE_ID,
                    "workerRequests",
                    requestId
                ),
                {
                    createdByUid: "worker-a",
                    source: "worker_app",
                    status: "pending",
                    type: "leave",
                    targetUid: "worker-a"
                }
            );
        }
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "workerAppData",
                "worker-a"
            ),
            {
                uid: "worker-a",
                workspaceId: WORKSPACE_ID,
                days: { "2026-07-06": 1 }
            }
        );
        await setDoc(
            doc(db, "workspaceLinks", "incoming-security-link"),
            {
                fromWorkspaceId: TARGET_WORKSPACE_ID,
                toWorkspaceId: WORKSPACE_ID,
                status: "pending",
                requestedByUid: "target-owner"
            }
        );
        await setDoc(
            doc(db, "workspaceLinks", "owner-email-link"),
            {
                fromWorkspaceId: WORKSPACE_ID,
                fromWorkspaceName: "Pruebas",
                toOwnerUid: "target-owner",
                toOwnerEmail: "target-owner@example.com",
                toWorkspaceId: "",
                toWorkspaceName: "",
                status: "pending",
                requestMode: "owner_email",
                requestedByUid: "turnos-editor"
            }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "workerRequests", "swap-canceled"),
            { status: "canceled", type: "swap", source: "worker_app" }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "workerSwapRequests", "swap-canceled"),
            { status: "canceled", createdByUid: "worker-a", targetUid: "worker-b" }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "workerSwapRequests", "swap-pending-worker-a"),
            {
                workspaceId: WORKSPACE_ID,
                status: "pending_colleague",
                source: "worker_app",
                type: "swap",
                createdByUid: "worker-b",
                targetUid: "worker-a"
            }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "workerSwapOpenRequests", "open-canceled"),
            { status: "canceled", createdByUid: "worker-a" }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "profile-editor-no-mfa"
            ),
            { role: "member", permissions: permissions(["profile"]) }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "qualifications-editor-no-mfa"
            ),
            { role: "member", permissions: permissions(["qualifications"]) }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "owner-no-mfa"
            ),
            { role: "owner", permissions: permissions() }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "members", "viewer"),
            { role: "member", permissions: permissions() }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "members", "legacy"),
            { role: "member" }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "members", "legacy-editor"),
            { role: "member", permissions: legacyPermissions(["turnos"]) }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "members", "legacy-full-admin"),
            {
                role: "member",
                permissions: legacyPermissions(LEGACY_FULL_ADMIN_PERMISSION_KEYS)
            }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "supervisorInvites",
                "invite-open"
            ),
            {
                workspaceId: WORKSPACE_ID,
                status: "open",
                tokenHash: "invite-open",
                permissions: permissions(),
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 86400000)
            }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "supervisorInvites",
                "invite-claimed"
            ),
            {
                workspaceId: WORKSPACE_ID,
                status: "claimed",
                tokenHash: "invite-claimed",
                claimedByUid: "claimed-user",
                permissions: permissions(["turnos"]),
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 86400000)
            }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "members",
                "restricted-viewer"
            ),
            {
                role: "member",
                permissions: permissions([], ["turnos", "profile"])
            }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "system",
                "appState"
            ),
            { hash: "legacy" }
        );
        await setDoc(
            doc(
                db,
                "workspaces",
                WORKSPACE_ID,
                "system",
                "localStorageSnapshot"
            ),
            { profiles: "datos sensibles heredados" }
        );
    });

    await t.test(
        "Turnos puede escribir solo su modulo",
        async () => {
            const db = turnosEditor.firestore();

            await assertSucceeds(
                setDoc(
                    doc(
                        db,
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "turnos"
                    ),
                    manifest("turnos", "turnos")
                )
            );
            await assertSucceeds(
                setDoc(
                    doc(
                        db,
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "turnos",
                        "chunks",
                        "part_0000"
                    ),
                    chunk("turnos")
                )
            );
            await assertSucceeds(
                setDoc(
                    doc(
                        db,
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "turnos",
                        "entries",
                        "data_Ana"
                    ),
                    stateEntry("turnos", "data_Ana")
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        db,
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "profile"
                    ),
                    manifest("profile", "profile")
                )
            );
        }
    );

    await t.test(
        "el propietario puede listar manifiestos, un editor parcial no",
        async () => {
            const manifests = collection(
                owner.firestore(),
                "workspaces",
                WORKSPACE_ID,
                "stateModules"
            );
            const snapshot = await assertSucceeds(getDocs(manifests));
            assert.ok(snapshot.docs.some(docSnap => docSnap.id === "turnos"));
            await assertFails(getDocs(collection(
                turnosEditor.firestore(),
                "workspaces",
                WORKSPACE_ID,
                "stateModules"
            )));
        }
    );

    await t.test(
        "Perfiles no puede escribir Turnos",
        async () => {
            await assertFails(
                setDoc(
                    doc(
                        profileEditor.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "turnos"
                    ),
                    manifest("turnos", "turnos")
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        profileEditor.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "turnos",
                        "entries",
                        "data_Ana"
                    ),
                    stateEntry("turnos", "data_Ana")
                )
            );
        }
    );

    await t.test(
        "Calificaciones puede escribir solo su modulo",
        async () => {
            const qualificationsPath = [
                "workspaces",
                WORKSPACE_ID,
                "stateModules",
                "qualifications"
            ];

            await assertSucceeds(
                setDoc(
                    doc(qualificationsEditor.firestore(), ...qualificationsPath),
                    manifest("qualifications", "qualifications")
                )
            );
            await assertSucceeds(
                setDoc(
                    doc(
                        qualificationsEditor.firestore(),
                        ...qualificationsPath,
                        "entries",
                        "qualifications"
                    ),
                    stateEntry("qualifications", "qualifications")
                )
            );
            await assertSucceeds(
                setDoc(
                    doc(
                        legacyFullAdmin.firestore(),
                        ...qualificationsPath,
                        "entries",
                        "qualifications_legacy_full"
                    ),
                    stateEntry("qualifications", "qualifications")
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        qualificationsEditor.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "profile"
                    ),
                    manifest("profile", "profile")
                )
            );
            await assertFails(
                setDoc(
                    doc(profileEditor.firestore(), ...qualificationsPath),
                    manifest("qualifications", "qualifications")
                )
            );
        }
    );

    await t.test(
        "las tareas compartidas del inicio: las ve la unidad, las escribe quien puede editar",
        async () => {
            // El inicio no es un menu con permiso propio: lo ve cualquier
            // administrador del entorno. Si su modulo se hubiera colgado de uno
            // que si tiene permiso (weekly, tasks...), a quien no tuviera ese
            // menu no le llegaria la tarea que le compartieron.
            const homePath = [
                "workspaces",
                WORKSPACE_ID,
                "stateModules",
                "home"
            ];

            await assertSucceeds(
                setDoc(
                    doc(profileEditor.firestore(), ...homePath),
                    manifest("home", "home")
                )
            );
            await assertSucceeds(
                setDoc(
                    doc(
                        profileEditor.firestore(),
                        ...homePath,
                        "entries",
                        "home_shared_tasks"
                    ),
                    stateEntry("home", "home_shared_tasks")
                )
            );
            await assertSucceeds(
                getDoc(doc(turnosEditor.firestore(), ...homePath))
            );

            // Solo lectura: ve lo que le compartieron, pero no comparte. Es la
            // unica via por la que podria escribirle al telefono de todos los
            // trabajadores, y no la tiene.
            await assertSucceeds(
                getDoc(doc(viewer.firestore(), ...homePath))
            );
            await assertFails(
                setDoc(
                    doc(viewer.firestore(), ...homePath),
                    manifest("home", "home")
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        viewer.firestore(),
                        ...homePath,
                        "entries",
                        "home_shared_tasks"
                    ),
                    stateEntry("home", "home_shared_tasks")
                )
            );

            // Fuera de la unidad, nada.
            await assertFails(
                getDoc(doc(outsider.firestore(), ...homePath))
            );
            await assertFails(
                setDoc(
                    doc(outsider.firestore(), ...homePath),
                    manifest("home", "home")
                )
            );
        }
    );

    await t.test(
        TEST_MFA_RULES
            ? "Test bloquea operaciones privilegiadas sin MFA"
            : "produccion permite operar sin MFA mientras TOTP esta desactivado",
        async () => {
            const profilePath = [
                "workspaces",
                WORKSPACE_ID,
                "stateModules",
                "profile"
            ];

            const privilegedExpectation = TEST_MFA_RULES
                ? assertFails
                : assertSucceeds;

            await privilegedExpectation(
                getDoc(
                    doc(
                        profileEditorWithoutMfa.firestore(),
                        ...profilePath
                    )
                )
            );
            await privilegedExpectation(
                setDoc(
                    doc(
                        profileEditorWithoutMfa.firestore(),
                        ...profilePath
                    ),
                    manifest("profile", "profile")
                )
            );
            await privilegedExpectation(
                getDoc(
                    doc(
                        ownerWithoutMfa.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "turnos"
                    )
                )
            );
            await assertSucceeds(
                getDoc(
                    doc(
                        ownerWithoutMfa.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "members",
                        "owner-no-mfa"
                    )
                )
            );

            if (TEST_MFA_RULES) {
                const path = [
                    "workspaces",
                    WORKSPACE_ID,
                    "attachments",
                    "profile",
                    "worker-no-mfa",
                    "profile-documents",
                    "mfa-required.pdf"
                ].join("/");

                await assertFails(
                    uploadBytes(
                        ref(profileEditorWithoutMfa.storage(), path),
                        new Uint8Array([37, 80, 68, 70]),
                        attachmentMetadata(
                            "profile",
                            "worker-no-mfa",
                            "profile-documents",
                            "profile-editor-no-mfa"
                        )
                    )
                );

                const qualificationPath = [
                    "workspaces",
                    WORKSPACE_ID,
                    "attachments",
                    "qualifications",
                    "310000213",
                    "2026_sep-dec_310000213",
                    "mfa-required.pdf"
                ].join("/");

                await assertFails(
                    uploadBytes(
                        ref(qualificationsEditorWithoutMfa.storage(), qualificationPath),
                        new Uint8Array([37, 80, 68, 70]),
                        attachmentMetadata(
                            "qualifications",
                            "310000213",
                            "2026_sep-dec_310000213",
                            "qualifications-editor-no-mfa"
                        )
                    )
                );
            }
        }
    );

    await t.test(
        "el modulo system queda reservado al propietario",
        async () => {
            const path = [
                "workspaces",
                WORKSPACE_ID,
                "stateModules",
                "system"
            ];

            await assertSucceeds(
                setDoc(
                    doc(owner.firestore(), ...path),
                    manifest("system", "owner")
                )
            );
            await assertSucceeds(
                getDoc(doc(owner.firestore(), ...path))
            );
            await assertFails(
                getDoc(doc(viewer.firestore(), ...path))
            );
            await assertFails(
                setDoc(
                    doc(viewer.firestore(), ...path),
                    manifest("system", "owner")
                )
            );
        }
    );

    await t.test(
        "el snapshot monolitico queda completamente bloqueado",
        async () => {
            await assertFails(
                setDoc(
                    doc(
                        owner.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "system",
                        "appState"
                    ),
                    { hash: "legacy" }
                )
            );
            await assertFails(
                getDoc(
                    doc(
                        owner.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "system",
                        "appState"
                    )
                )
            );
            await assertFails(
                getDoc(
                    doc(
                        owner.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "system",
                        "localStorageSnapshot"
                    )
                )
            );
        }
    );

    await t.test(
        "los permisos de un modulo no exponen calendarios PWA",
        async () => {
            const appDataPath = [
                "workspaces",
                WORKSPACE_ID,
                "workerAppData",
                "worker-a"
            ];

            await assertFails(
                getDoc(doc(agendaEditor.firestore(), ...appDataPath))
            );
            await assertFails(
                setDoc(
                    doc(
                        agendaEditor.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerAppData",
                        "agenda-write"
                    ),
                    {
                        uid: "agenda-write",
                        workspaceId: WORKSPACE_ID,
                        days: { "2026-07-06": 9 }
                    }
                )
            );
            await assertSucceeds(
                getDoc(doc(profileEditor.firestore(), ...appDataPath))
            );
            await assertSucceeds(
                setDoc(
                    doc(
                        profileEditor.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerAppData",
                        "profile-write"
                    ),
                    {
                        uid: "profile-write",
                        workspaceId: WORKSPACE_ID,
                        days: {}
                    }
                )
            );
        }
    );

    await t.test(
        "eventos y notificaciones de calendario quedan aislados por trabajador",
        async () => {
            const eventPath = [
                "workspaces",
                WORKSPACE_ID,
                "calendarEvents",
                "calendar-event-rules"
            ];
            const notificationPath = [
                "workspaces",
                WORKSPACE_ID,
                "workerNotifications",
                "worker-a",
                "items",
                "calendar-event-rules"
            ];

            await assertSucceeds(
                setDoc(doc(profileEditor.firestore(), ...eventPath), {
                    eventId: "calendar-event-rules",
                    workspaceId: WORKSPACE_ID,
                    affectedUserId: "worker-a",
                    workerId: "Ana",
                    profileName: "Ana",
                    changeType: "shift_added",
                    source: "main_calendar_manual_edit",
                    affectedDates: ["2026-07-18"],
                    title: "Nuevo turno",
                    message: "Se agrego un turno.",
                    status: "pending",
                    createdByUid: "profile-editor"
                })
            );
            await assertFails(
                setDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "calendarEvents",
                        "worker-spoof"
                    ),
                    {
                        eventId: "worker-spoof",
                        workspaceId: WORKSPACE_ID,
                        affectedUserId: "worker-a",
                        status: "pending",
                        createdByUid: "worker-a"
                    }
                )
            );

            await env.withSecurityRulesDisabled(async context => {
                await setDoc(doc(context.firestore(), ...notificationPath), {
                    type: "calendar_change",
                    title: "Nuevo turno",
                    message: "Se agrego un turno.",
                    workspaceId: WORKSPACE_ID,
                    workerId: "Ana",
                    profileName: "Ana",
                    affectedDates: ["2026-07-18"],
                    changeType: "shift_added",
                    isRead: false,
                    readAt: null,
                    eventId: "calendar-event-rules",
                    deepLink: "/?screen=calendario"
                });
            });

            await assertSucceeds(
                getDoc(doc(workerA.firestore(), ...notificationPath))
            );
            await assertFails(
                getDoc(doc(workerB.firestore(), ...notificationPath))
            );
            await assertSucceeds(
                updateDoc(doc(workerA.firestore(), ...notificationPath), {
                    isRead: true,
                    readAt: "2026-07-18T12:00:00.000Z"
                })
            );
            await assertFails(
                updateDoc(doc(workerA.firestore(), ...notificationPath), {
                    message: "mensaje adulterado"
                })
            );
        }
    );

    await t.test(
        "solo gestores de solicitudes responden enlaces entre unidades",
        async () => {
            await assertFails(
                setDoc(
                    doc(viewer.firestore(), "workspaceLinks", "viewer-link"),
                    {
                        fromWorkspaceId: WORKSPACE_ID,
                        toWorkspaceId: TARGET_WORKSPACE_ID,
                        status: "pending",
                        requestedByUid: "viewer"
                    }
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        turnosEditor.firestore(),
                        "workspaceLinks",
                        "manager-link"
                    ),
                    {
                        fromWorkspaceId: WORKSPACE_ID,
                        toWorkspaceId: TARGET_WORKSPACE_ID,
                        status: "pending",
                        requestedByUid: "turnos-editor"
                    }
                )
            );

            const incomingRef = doc(
                viewer.firestore(),
                "workspaceLinks",
                "incoming-security-link"
            );
            await assertFails(
                updateDoc(incomingRef, {
                    status: "accepted",
                    acceptedByUid: "viewer",
                    updatedAt: new Date()
                })
            );
            await assertSucceeds(
                updateDoc(
                    doc(
                        turnosEditor.firestore(),
                        "workspaceLinks",
                        "incoming-security-link"
                    ),
                    {
                        status: "accepted",
                        acceptedByUid: "turnos-editor",
                        updatedAt: new Date()
                    }
                )
            );
            await assertFails(
                updateDoc(incomingRef, {
                    status: "unlinked",
                    unlinkedByUid: "viewer",
                    updatedAt: new Date()
                })
            );
            await assertSucceeds(
                updateDoc(
                    doc(
                        turnosEditor.firestore(),
                        "workspaceLinks",
                        "incoming-security-link"
                    ),
                    {
                        status: "unlinked",
                        unlinkedByUid: "turnos-editor",
                        updatedAt: new Date()
                    }
                )
            );

            const ownerEmailLinkViewerRef = doc(
                viewer.firestore(),
                "workspaceLinks",
                "owner-email-link"
            );
            const ownerEmailLinkTargetRef = doc(
                targetOwner.firestore(),
                "workspaceLinks",
                "owner-email-link"
            );
            const ownerEmailLinkOutsiderRef = doc(
                outsider.firestore(),
                "workspaceLinks",
                "owner-email-link"
            );

            await assertFails(getDoc(ownerEmailLinkOutsiderRef));
            await assertSucceeds(getDoc(ownerEmailLinkTargetRef));
            await assertFails(
                updateDoc(ownerEmailLinkViewerRef, {
                    status: "accepted",
                    toWorkspaceId: TARGET_WORKSPACE_ID,
                    toWorkspaceName: "Unidad destino",
                    acceptedByUid: "viewer",
                    updatedAt: new Date()
                })
            );
            await assertSucceeds(
                updateDoc(ownerEmailLinkTargetRef, {
                    status: "accepted",
                    toWorkspaceId: TARGET_WORKSPACE_ID,
                    toWorkspaceName: "Unidad destino",
                    acceptedByUid: "target-owner",
                    acceptedByName: "Owner destino",
                    updatedAt: new Date()
                })
            );
        }
    );

    await t.test(
        "un trabajador puede desenlazar solo su propia app",
        async () => {
            const selfUnlinkWorkspaceId = "workspace-worker-self-unlink";

            await env.withSecurityRulesDisabled(async context => {
                const db = context.firestore();
                await setDoc(doc(db, "workspaces", selfUnlinkWorkspaceId), {
                    ownerUid: "owner",
                    name: "Autodesenlace"
                });
                await setDoc(
                    doc(
                        db,
                        "workspaces",
                        selfUnlinkWorkspaceId,
                        "members",
                        "profile-editor"
                    ),
                    {
                        role: "member",
                        permissions: permissions(["profile"])
                    }
                );
                await setDoc(
                    doc(
                        db,
                        "workspaces",
                        selfUnlinkWorkspaceId,
                        "workerLinks",
                        "worker-a"
                    ),
                    {
                        uid: "worker-a",
                        workspaceId: selfUnlinkWorkspaceId,
                        status: "active"
                    }
                );
                await setDoc(
                    doc(
                        db,
                        "workspaces",
                        selfUnlinkWorkspaceId,
                        "workerLinks",
                        "worker-b"
                    ),
                    {
                        uid: "worker-b",
                        workspaceId: selfUnlinkWorkspaceId,
                        status: "active"
                    }
                );
                await setDoc(
                    doc(
                        db,
                        "users",
                        "worker-a",
                        "workerLinks",
                        selfUnlinkWorkspaceId
                    ),
                    {
                        uid: "worker-a",
                        workspaceId: selfUnlinkWorkspaceId,
                        status: "active"
                    }
                );
            });

            await assertSucceeds(
                deleteDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        selfUnlinkWorkspaceId,
                        "workerLinks",
                        "worker-a"
                    )
                )
            );
            await assertSucceeds(
                deleteDoc(
                    doc(
                        workerA.firestore(),
                        "users",
                        "worker-a",
                        "workerLinks",
                        selfUnlinkWorkspaceId
                    )
                )
            );
            await assertFails(
                deleteDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        selfUnlinkWorkspaceId,
                        "workerLinks",
                        "worker-b"
                    )
                )
            );
            await assertFails(
                deleteDoc(
                    doc(
                        outsider.firestore(),
                        "workspaces",
                        selfUnlinkWorkspaceId,
                        "workerLinks",
                        "worker-b"
                    )
                )
            );
            await assertSucceeds(
                deleteDoc(
                    doc(
                        profileEditor.firestore(),
                        "workspaces",
                        selfUnlinkWorkspaceId,
                        "workerLinks",
                        "worker-b"
                    )
                )
            );
        }
    );

    await t.test(
        "la invitacion de trabajador aceptada no se puede reutilizar desde cliente",
        async () => {
            const workerReopened = env.authenticatedContext("worker-reopened");

            await env.withSecurityRulesDisabled(async context => {
                const db = context.firestore();

                await setDoc(
                    doc(
                        db,
                        "workspaces",
                        WORKSPACE_ID,
                        "workerAppInvites",
                        "worker-reuse-accepted"
                    ),
                    {
                        token: "worker-reuse-accepted",
                        workspaceId: WORKSPACE_ID,
                        workspaceName: "Pruebas",
                        profileName: "Trabajador A",
                        profileRut: "11111111-1",
                        email: "worker-a@example.com",
                        status: "accepted",
                        workerUid: "previous-anonymous-worker",
                        workerEmail: "worker-a@example.com",
                        workerDisplayName: "Trabajador A"
                    }
                );
            });

            const ownAcceptedInvite = doc(
                workerReopened.firestore(),
                "workspaces",
                WORKSPACE_ID,
                "workerAppInvites",
                "worker-reuse-accepted"
            );

            await assertFails(getDoc(ownAcceptedInvite));
            await assertFails(
                updateDoc(ownAcceptedInvite, {
                    status: "accepted",
                    workerUid: "worker-reopened",
                    workerEmail: "worker-a@example.com",
                    workerDisplayName: "Trabajador A",
                    acceptedAt: new Date(),
                    updatedAt: new Date()
                })
            );
            await assertFails(
                setDoc(
                    doc(
                        workerReopened.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerLinks",
                        "worker-reopened"
                    ),
                    {
                        uid: "worker-reopened",
                        workspaceId: WORKSPACE_ID,
                        inviteId: "worker-reuse-accepted",
                        profileName: "Trabajador A",
                        profileRut: "11111111-1",
                        status: "active",
                        updatedAt: new Date()
                    }
                )
            );
            await assertFails(
                getDoc(
                    doc(
                        workerB.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerAppInvites",
                        "worker-reuse-accepted"
                    )
                )
            );
        }
    );

    await t.test(
        "trabajadores enlazados usan un directorio minimo para mensajes",
        async () => {
            const ownDirectoryDoc = doc(
                workerA.firestore(),
                "workspaces",
                WORKSPACE_ID,
                "workerMessageDirectory",
                "worker-a"
            );
            const peerDirectoryDoc = doc(
                workerB.firestore(),
                "workspaces",
                WORKSPACE_ID,
                "workerMessageDirectory",
                "worker-b"
            );
            const workerADirectoryCollection = collection(
                workerA.firestore(),
                "workspaces",
                WORKSPACE_ID,
                "workerMessageDirectory"
            );

            await assertSucceeds(
                setDoc(ownDirectoryDoc, {
                    uid: "worker-a",
                    workspaceId: WORKSPACE_ID,
                    workspaceName: "Seguridad",
                    profileName: "Trabajador A",
                    worker: {
                        name: "Trabajador A",
                        role: "Enfermeria",
                        profession: "TENS"
                    },
                    status: "active",
                    updatedAt: new Date(),
                    updatedAtISO: new Date().toISOString()
                })
            );
            await assertSucceeds(
                setDoc(peerDirectoryDoc, {
                    uid: "worker-b",
                    workspaceId: WORKSPACE_ID,
                    profileName: "Trabajador B",
                    status: "active",
                    updatedAt: new Date(),
                    updatedAtISO: new Date().toISOString()
                })
            );
            await assertSucceeds(getDocs(workerADirectoryCollection));
            await assertFails(
                setDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerMessageDirectory",
                        "worker-b"
                    ),
                    {
                        uid: "worker-b",
                        workspaceId: WORKSPACE_ID,
                        profileName: "Perfil ajeno",
                        status: "active"
                    }
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerMessageDirectory",
                        "worker-a"
                    ),
                    {
                        uid: "worker-a",
                        workspaceId: TARGET_WORKSPACE_ID,
                        profileName: "Workspace incorrecto",
                        status: "active"
                    }
                )
            );
            await assertFails(
                setDoc(ownDirectoryDoc, {
                    uid: "worker-a",
                    workspaceId: WORKSPACE_ID,
                    profileName: "Dato privado",
                    profileRut: "11111111-1",
                    status: "active"
                })
            );
            await assertSucceeds(deleteDoc(ownDirectoryDoc));
        }
    );

    await t.test(
        "trabajadores enlazados pueden listar hilos propios para badges de mensajes",
        async () => {
            const threadId = "worker-a__worker-b";
            const workerAThreadsQuery = query(
                collection(
                    workerA.firestore(),
                    "workspaces",
                    WORKSPACE_ID,
                    "workerPeerThreads"
                ),
                where("participantUids", "array-contains", "worker-a")
            );

            await assertSucceeds(
                setDoc(
                    doc(
                        workerB.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerPeerThreads",
                        threadId
                    ),
                    {
                        id: threadId,
                        workspaceId: WORKSPACE_ID,
                        participantUids: ["worker-a", "worker-b"],
                        participants: {
                            "worker-a": {
                                uid: "worker-a",
                                name: "Trabajador A",
                                role: "Trabajador"
                            },
                            "worker-b": {
                                uid: "worker-b",
                                name: "Trabajador B",
                                role: "Trabajador"
                            }
                        },
                        createdByUid: "worker-b",
                        targetUid: "worker-a",
                        lastMessage: "Mensaje para A",
                        lastMessageId: "msg-badge",
                        lastSenderUid: "worker-b",
                        lastSenderName: "Trabajador B",
                        unreadFor: {
                            "worker-a": true,
                            "worker-b": false
                        },
                        unreadCounts: {
                            "worker-a": 1,
                            "worker-b": 0
                        },
                        updatedAt: new Date()
                    }
                )
            );
            await assertSucceeds(getDocs(workerAThreadsQuery));
            await assertFails(
                getDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerPeerThreads",
                        "external-thread"
                    )
                )
            );
        }
    );

    await t.test(
        "un trabajador solo cambia campos de cancelacion de su solicitud",
        async () => {
            await assertFails(
                updateDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerRequests",
                        "worker-cancel-malicious"
                    ),
                    {
                        status: "canceled",
                        targetUid: "outsider"
                    }
                )
            );
            await assertSucceeds(
                updateDoc(
                    doc(
                        workerA.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "workerRequests",
                        "worker-cancel"
                    ),
                    {
                        status: "canceled",
                        canceledByUid: "worker-a",
                        updatedAt: new Date()
                    }
                )
            );
        }
    );

    await t.test(
        "los cambios de turno PWA se escriben solo por Cloud Functions",
        async () => {
            const workerDb = workerA.firestore();

            await assertFails(
                setDoc(
                    doc(
                        workerDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "workerSwapRequests",
                        "client-direct-swap"
                    ),
                    {
                        workspaceId: WORKSPACE_ID,
                        createdByUid: "worker-a",
                        targetUid: "worker-b",
                        source: "worker_app",
                        type: "swap",
                        status: "pending_colleague"
                    }
                )
            );
            await assertFails(
                updateDoc(
                    doc(
                        workerDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "workerSwapRequests",
                        "swap-pending-worker-a"
                    ),
                    {
                        status: "colleague_accepted",
                        colleagueAcceptedAt: new Date(),
                        updatedAt: new Date()
                    }
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        workerDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "workerSwapOpenRequests",
                        "client-open-swap"
                    ),
                    {
                        workspaceId: WORKSPACE_ID,
                        createdByUid: "worker-a",
                        source: "worker_app",
                        status: "open",
                        ownDate: "2026-07-10"
                    }
                )
            );
        }
    );

    await t.test(
        "adminUsers no se expone ni siquiera a propietarios autenticados",
        async () => {
            const adminRef = doc(
                owner.firestore(),
                "adminUsers",
                "owner"
            );

            await assertFails(getDoc(adminRef));
            await assertFails(setDoc(adminRef, { active: true }));
        }
    );

    await t.test(
        "el cliente no puede inyectar contadores administrativos",
        async () => {
            await assertFails(
                setDoc(
                    doc(owner.firestore(), "workspaces", "counter-spoof"),
                    {
                        ownerUid: "owner",
                        name: "Unidad manipulada",
                        workersCount: 99999,
                        pwaUsersCount: 99999
                    }
                )
            );
        }
    );

    await t.test(
        "la lectura tambien respeta el permiso del modulo",
        async () => {
            const path = [
                "workspaces",
                WORKSPACE_ID,
                "stateModules",
                "turnos"
            ];

            await assertSucceeds(getDoc(doc(viewer.firestore(), ...path)));
            await assertFails(
                setDoc(
                    doc(viewer.firestore(), ...path),
                    manifest("turnos", "turnos")
                )
            );
            await assertFails(
                getDoc(doc(restrictedViewer.firestore(), ...path))
            );
            await assertFails(
                getDoc(
                    doc(
                        restrictedViewer.firestore(),
                        ...path,
                        "chunks",
                        "part_0000"
                    )
                )
            );
            await assertFails(getDoc(doc(outsider.firestore(), ...path)));
        }
    );

    await t.test(
        "un miembro heredado sin permissions no obtiene acceso amplio",
        async () => {
            const legacy = env.authenticatedContext("legacy", {
                email: "legacy@example.com"
            });

            await assertFails(
                getDoc(
                    doc(
                        legacy.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "stateModules",
                        "turnos"
                    )
                )
            );
        }
    );

    await t.test(
        "una membresia nueva no puede autocrearse con invitacion heredada",
        async () => {
            const noPermissions = env.authenticatedContext("new-no-perms", {
                email: "new@example.com"
            });
            const withPermissions = env.authenticatedContext(
                "new-with-perms",
                { email: "new2@example.com" }
            );

            await assertFails(
                setDoc(
                    doc(
                        noPermissions.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "members",
                        "new-no-perms"
                    ),
                    {
                        role: "member",
                        inviteCode: "invite-secure"
                    }
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        withPermissions.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "members",
                        "new-with-perms"
                    ),
                    {
                        role: "member",
                        inviteCode: "invite-secure",
                        permissions: permissions()
                    }
                )
            );
        }
    );

    await t.test(
        "las invitaciones de supervisor solo se leen por propietario o reclamante",
        async () => {
            const claimedUser = env.authenticatedContext("claimed-user", {
                email: "claimed@example.com"
            });
            const ownerDb = owner.firestore();
            const claimedDb = claimedUser.firestore();
            const outsiderDb = outsider.firestore();

            await assertSucceeds(
                getDocs(
                    collection(
                        ownerDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "supervisorInvites"
                    )
                )
            );
            await assertSucceeds(
                getDoc(
                    doc(
                        claimedDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "supervisorInvites",
                        "invite-claimed"
                    )
                )
            );
            await assertFails(
                getDoc(
                    doc(
                        claimedDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "supervisorInvites",
                        "invite-open"
                    )
                )
            );
            await assertFails(
                getDoc(
                    doc(
                        outsiderDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "supervisorInvites",
                        "invite-claimed"
                    )
                )
            );
            await assertFails(
                setDoc(
                    doc(
                        ownerDb,
                        "workspaces",
                        WORKSPACE_ID,
                        "supervisorInvites",
                        "client-write"
                    ),
                    {
                        workspaceId: WORKSPACE_ID,
                        status: "open"
                    }
                )
            );
        }
    );

    await t.test(
        "una solicitud anulada no puede volver a aceptarse",
        async () => {
            const ownerDb = owner.firestore();

            await assertFails(
                updateDoc(
                    doc(ownerDb, "workspaces", WORKSPACE_ID, "workerRequests", "swap-canceled"),
                    { status: "accepted" }
                )
            );
            await assertFails(
                updateDoc(
                    doc(ownerDb, "workspaces", WORKSPACE_ID, "workerSwapRequests", "swap-canceled"),
                    { status: "supervisor_accepted" }
                )
            );
            await assertFails(
                updateDoc(
                    doc(ownerDb, "workspaces", WORKSPACE_ID, "workerSwapOpenRequests", "open-canceled"),
                    { status: "supervisor_accepted" }
                )
            );
        }
    );

    await t.test(
        "Storage respeta el permiso del modulo",
        async () => {
            const profilePath = [
                "workspaces",
                WORKSPACE_ID,
                "attachments",
                "profile",
                "worker-1",
                "profile-documents",
                "test.pdf"
            ].join("/");
            const invalidPath = [
                "workspaces",
                WORKSPACE_ID,
                "legacy",
                "test.pdf"
            ].join("/");
            const bytes = new Uint8Array([37, 80, 68, 70]);

            await assertFails(
                uploadBytes(
                    ref(turnosEditor.storage(), profilePath),
                    bytes,
                    attachmentMetadata(
                        "profile",
                        "worker-1",
                        "profile-documents",
                        "turnos-editor"
                    )
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(profileEditor.storage(), profilePath),
                    bytes,
                    attachmentMetadata(
                        "profile",
                        "worker-1",
                        "profile-documents",
                        "profile-editor"
                    )
                )
            );
            await assertFails(
                getBytes(ref(restrictedViewer.storage(), profilePath))
            );
            await assertFails(
                getBytes(ref(legacyMember.storage(), profilePath))
            );
            await assertFails(
                uploadBytes(
                    ref(owner.storage(), invalidPath),
                    bytes,
                    attachmentMetadata(
                        "profile",
                        "worker-1",
                        "profile-documents",
                        "owner"
                    )
                )
            );
        }
    );

    await t.test(
        "Storage permite publicar la programacion semanal solo como imagen",
        async () => {
            const schedulePath = [
                "workspaces",
                WORKSPACE_ID,
                "attachments",
                "tasks",
                "weekly-schedule",
                "published-schedule",
                "programacion.jpg"
            ].join("/");
            const pdfPath = [
                "workspaces",
                WORKSPACE_ID,
                "attachments",
                "tasks",
                "weekly-schedule",
                "published-schedule",
                "programacion.pdf"
            ].join("/");
            const bytes = new Uint8Array([255, 216, 255, 224]);

            await assertSucceeds(
                uploadBytes(
                    ref(tasksEditor.storage(), schedulePath),
                    bytes,
                    attachmentMetadata(
                        "tasks",
                        "weekly-schedule",
                        "published-schedule",
                        "tasks-editor",
                        "image/jpeg"
                    )
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(weeklyEditor.storage(), schedulePath.replace(
                        "programacion.jpg",
                        "programacion-weekly.jpg"
                    )),
                    bytes,
                    attachmentMetadata(
                        "tasks",
                        "weekly-schedule",
                        "published-schedule",
                        "weekly-editor",
                        "image/jpg"
                    )
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(turnosEditor.storage(), schedulePath.replace(
                        "programacion.jpg",
                        "programacion-turnos.jpg"
                    )),
                    bytes,
                    attachmentMetadata(
                        "tasks",
                        "weekly-schedule",
                        "published-schedule",
                        "turnos-editor",
                        "image/jpeg"
                    )
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(viewer.storage(), schedulePath.replace(
                        "programacion.jpg",
                        "programacion-viewer.jpg"
                    )),
                    bytes,
                    attachmentMetadata(
                        "tasks",
                        "weekly-schedule",
                        "published-schedule",
                        "viewer",
                        "image/jpeg"
                    )
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(owner.storage(), schedulePath.replace(
                        "programacion.jpg",
                        "programacion-pjpeg.jpg"
                    )),
                    bytes,
                    attachmentMetadata(
                        "tasks",
                        "weekly-schedule",
                        "published-schedule",
                        "owner",
                        "image/pjpeg"
                    )
                )
            );
            await assertFails(
                uploadBytes(
                    ref(tasksEditor.storage(), pdfPath),
                    new Uint8Array([37, 80, 68, 70]),
                    attachmentMetadata(
                        "tasks",
                        "weekly-schedule",
                        "published-schedule",
                        "tasks-editor",
                        "application/pdf"
                    )
                )
            );
        }
    );

    await t.test(
        "La confirmacion de lectura la firma solo su dueno",
        async () => {
            const readsPath = ["workspaces", WORKSPACE_ID, "informationReads"];
            const ack = {
                profileName: "Trabajador A",
                acks: { "info-1": "2026-09-07T12:00:00.000Z" },
                updatedAt: "2026-09-07T12:00:00.000Z"
            };

            // Cada trabajador escribe SU documento.
            await assertSucceeds(
                setDoc(doc(workerA.firestore(), ...readsPath, "worker-a"), ack)
            );

            // Y no el de otro: nadie confirma por un tercero.
            await assertFails(
                setDoc(doc(workerA.firestore(), ...readsPath, "worker-b"), ack)
            );

            // Ni campos fuera de los tres acordados.
            await assertFails(
                setDoc(doc(workerA.firestore(), ...readsPath, "worker-a"), {
                    ...ack,
                    supervisorNote: "no corresponde"
                })
            );

            // El supervisor lee la coleccion entera para armar el informe.
            await assertSucceeds(
                getDocs(collection(owner.firestore(), ...readsPath))
            );

            // Un ajeno al workspace no ve nada.
            await assertFails(
                getDoc(doc(outsider.firestore(), ...readsPath, "worker-a"))
            );

            // Se pueden AGREGAR confirmaciones sobre las que ya estaban.
            await assertSucceeds(
                setDoc(
                    doc(workerA.firestore(), ...readsPath, "worker-a"),
                    {
                        acks: {
                            "info-1": "2026-09-07T12:00:00.000Z",
                            "info-2": "2026-09-07T13:00:00.000Z"
                        },
                        updatedAt: "2026-09-07T13:00:00.000Z"
                    },
                    { merge: true }
                )
            );

            // Pero no vaciarlas: seria borrar el documento por la puerta de al
            // lado.
            await assertFails(
                setDoc(doc(workerA.firestore(), ...readsPath, "worker-a"), {
                    profileName: "Trabajador A",
                    acks: {},
                    updatedAt: "2026-09-07T14:00:00.000Z"
                })
            );

            // Borrar una confirmacion falsearia el informe.
            await assertFails(
                deleteDoc(doc(workerA.firestore(), ...readsPath, "worker-a"))
            );
        }
    );

    await t.test(
        "Storage acepta el formulario escaneado de calificaciones",
        async () => {
            const base = [
                "workspaces",
                WORKSPACE_ID,
                "attachments",
                "qualifications"
            ].join("/");
            const path = `${base}/worker-a/2026_sep-dec_worker-a/firmado.pdf`;
            const explicitEditorPath =
                `${base}/worker-a/2026_sep-dec_worker-a/editor.pdf`;
            const rutPath =
                `${base}/310000213/2026_sep-dec_310000213/Certificado_de_Titulo.pdf`;
            const legacyFullRutPath =
                `${base}/310000213/2026_sep-dec_310000213/legacy-full.pdf`;
            const legacyPath = `${base}/worker-a/2026_sep-dec_worker-a/legacy.pdf`;
            const outsiderPath = `${base}/worker-a/2026_sep-dec_worker-a/ajeno.pdf`;
            const bytes = new Uint8Array([37, 80, 68, 70]);
            const meta = name => attachmentMetadata(
                "qualifications",
                "worker-a",
                "2026_sep-dec_worker-a",
                name,
                "application/pdf"
            );
            const rutMeta = name => attachmentMetadata(
                "qualifications",
                "310000213",
                "2026_sep-dec_310000213",
                name,
                "application/pdf"
            );

            await assertSucceeds(
                uploadBytes(ref(owner.storage(), path), bytes, meta("owner"))
            );

            await assertSucceeds(
                uploadBytes(
                    ref(owner.storage(), rutPath),
                    bytes,
                    rutMeta("owner")
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(qualificationsEditor.storage(), explicitEditorPath),
                    bytes,
                    meta("qualifications-editor")
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(legacyFullAdmin.storage(), legacyFullRutPath),
                    bytes,
                    rutMeta("legacy-full-admin")
                )
            );

            await assertSucceeds(
                getBytes(ref(qualificationsEditor.storage(), path))
            );

            await assertFails(
                uploadBytes(
                    ref(legacyEditor.storage(), legacyPath),
                    bytes,
                    meta("legacy-editor")
                )
            );

            await assertFails(
                uploadBytes(
                    ref(outsider.storage(), outsiderPath),
                    bytes,
                    meta("outsider")
                )
            );
        }
    );

    await t.test(
        "Storage permite publicar adjuntos compartidos de informaciones",
        async () => {
            const infoPath = [
                "workspaces",
                WORKSPACE_ID,
                "attachments",
                "informations",
                "published",
                "info-1",
                "foto.jpg"
            ].join("/");
            const legacyPath = infoPath.replace("foto.jpg", "foto-legacy.jpg");
            const viewerPath = infoPath.replace("foto.jpg", "foto-viewer.jpg");
            const outsiderPath = infoPath.replace("foto.jpg", "foto-outsider.jpg");
            const bytes = new Uint8Array([255, 216, 255, 224]);

            await assertSucceeds(
                uploadBytes(
                    ref(owner.storage(), infoPath),
                    bytes,
                    attachmentMetadata(
                        "informations",
                        "published",
                        "info-1",
                        "owner",
                        "image/jpeg"
                    )
                )
            );
            await assertSucceeds(
                uploadBytes(
                    ref(legacyEditor.storage(), legacyPath),
                    bytes,
                    attachmentMetadata(
                        "informations",
                        "published",
                        "info-1",
                        "legacy-editor",
                        "image/jpeg"
                    )
                )
            );
            await assertSucceeds(
                getBytes(ref(workerA.storage(), infoPath))
            );
            await assertFails(
                uploadBytes(
                    ref(viewer.storage(), viewerPath),
                    bytes,
                    attachmentMetadata(
                        "informations",
                        "published",
                        "info-1",
                        "viewer",
                        "image/jpeg"
                    )
                )
            );
            await assertFails(
                uploadBytes(
                    ref(outsider.storage(), outsiderPath),
                    bytes,
                    attachmentMetadata(
                        "informations",
                        "published",
                        "info-1",
                        "outsider",
                        "image/jpeg"
                    )
                )
            );
        }
    );

    await t.test(
        "el trabajador enlazado lee el adjunto que le mandaron a el",
        async () => {
            // El destinatario NO es miembro del entorno: entra por su enlace de
            // PWA. Lo unico que lo habilita es que el ownerId de la ruta sea su
            // propio uid. Sin esta prueba, un cambio en el orden de los OR de
            // `allow read` deja al trabajador sin poder abrir lo que recibe.
            const messagePath = [
                "workspaces",
                WORKSPACE_ID,
                "attachments",
                "messages",
                "worker-a",
                "msg-1",
                "adjunto_plan.pdf"
            ].join("/");

            await assertSucceeds(
                uploadBytes(
                    ref(owner.storage(), messagePath),
                    new Uint8Array([37, 80, 68, 70]),
                    attachmentMetadata(
                        "messages",
                        "worker-a",
                        "msg-1",
                        "owner"
                    )
                )
            );

            await assertSucceeds(
                getBytes(ref(workerA.storage(), messagePath))
            );
            // Enlazado al mismo entorno, pero no es el destinatario.
            await assertFails(
                getBytes(ref(workerB.storage(), messagePath))
            );
            await assertFails(
                getBytes(ref(outsider.storage(), messagePath))
            );
        }
    );

    await t.test(
        "el cargador original puede borrar tras perder edicion",
        async () => {
            const path = [
                "workspaces",
                WORKSPACE_ID,
                "attachments",
                "profile",
                "worker-2",
                "profile-documents",
                "own.pdf"
            ].join("/");
            const objectRef = ref(profileEditor.storage(), path);

            await assertSucceeds(
                uploadBytes(
                    objectRef,
                    new Uint8Array([37, 80, 68, 70]),
                    attachmentMetadata(
                        "profile",
                        "worker-2",
                        "profile-documents",
                        "profile-editor"
                    )
                )
            );

            await env.withSecurityRulesDisabled(async context => {
                await setDoc(
                    doc(
                        context.firestore(),
                        "workspaces",
                        WORKSPACE_ID,
                        "members",
                        "profile-editor"
                    ),
                    {
                        role: "member",
                        permissions: permissions()
                    }
                );
            });

            await assertSucceeds(deleteObject(objectRef));
        }
    );

    await env.cleanup();
});
