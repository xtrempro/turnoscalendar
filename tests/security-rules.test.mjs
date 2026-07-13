import fs from "node:fs";
import test from "node:test";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc
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

function permissions(editable = [], hidden = []) {
    const keys = [
        "turnos",
        "weekly",
        "tasks",
        "kanban",
        "agenda",
        "profile",
        "clockmarks",
        "requests",
        "memos",
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
    uploadedByUid
) {
    return {
        contentType: "application/pdf",
        customMetadata: {
            workspaceId: WORKSPACE_ID,
            moduleId,
            ownerId,
            recordId,
            uploadedByUid,
            originalName: "prueba.pdf"
        }
    };
}

test("reglas modulares de Firestore y Storage", async t => {
    const env = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(FIRESTORE_RULES_PATH, "utf8")
        },
        storage: {
            rules: fs.readFileSync(STORAGE_RULES_PATH, "utf8")
        }
    });

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
    const profileEditorWithoutMfa = env.authenticatedContext(
        "profile-editor-no-mfa",
        { email: "profile-no-mfa@example.com" }
    );
    const ownerWithoutMfa = env.authenticatedContext(
        "owner-no-mfa",
        { email: "owner-no-mfa@example.com" }
    );
    const viewer = env.authenticatedContext("viewer", {
        email: "viewer@example.com"
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
                    "clockmarks",
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
        "solo gestores de solicitudes administran enlaces entre unidades",
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
            await assertSucceeds(
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
