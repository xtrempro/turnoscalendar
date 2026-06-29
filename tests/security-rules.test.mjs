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
            rules: fs.readFileSync("firebase.rules", "utf8")
        },
        storage: {
            rules: fs.readFileSync("storage.rules", "utf8")
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
            doc(db, "workspaces", WORKSPACE_ID, "workerRequests", "swap-canceled"),
            { status: "canceled", type: "swap", source: "worker_app" }
        );
        await setDoc(
            doc(db, "workspaces", WORKSPACE_ID, "workerSwapRequests", "swap-canceled"),
            { status: "canceled", createdByUid: "worker-a", targetUid: "worker-b" }
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
        "propietarios y supervisores pueden operar sin MFA mientras TOTP esta desactivado",
        async () => {
            const profilePath = [
                "workspaces",
                WORKSPACE_ID,
                "stateModules",
                "profile"
            ];

            await assertSucceeds(
                getDoc(
                    doc(
                        profileEditorWithoutMfa.firestore(),
                        ...profilePath
                    )
                )
            );
            await assertSucceeds(
                setDoc(
                    doc(
                        profileEditorWithoutMfa.firestore(),
                        ...profilePath
                    ),
                    manifest("profile", "profile")
                )
            );
            await assertSucceeds(
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
