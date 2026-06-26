import {
    FIREBASE_REQUIRE_PRIVILEGED_MFA
} from "./firebaseConfig.js";
import {
    getCurrentFirebaseUser,
    getFirebaseServices,
    isFirebaseConfigured
} from "./firebaseClient.js";
import { getActiveWorkspace } from "./workspaces.js";

export const MENU_PERMISSION_DEFS = [
    { key: "turnos", label: "Turnos", target: "calendarPanel" },
    {
        key: "weekly",
        label: "Calendario Semanal",
        target: "staffingWeeklyCalendar"
    },
    {
        key: "tasks",
        label: "Asignaci\u00f3n de Tareas",
        target: "taskAssignmentsPanel"
    },
    { key: "kanban", label: "Kanban", target: "kanbanPanel" },
    { key: "agenda", label: "Agenda", target: "agendaPanel" },
    { key: "profile", label: "Perfiles", target: "profileSection" },
    { key: "clockmarks", label: "Marcajes", target: "clockMarksPanel" },
    { key: "requests", label: "Solicitudes", target: "workerRequestsPanel" },
    { key: "memos", label: "Memorándum", target: "memosPanel" },
    { key: "swap", label: "Cambios de Turno", target: "turnChangesView" },
    { key: "hours", label: "HH.EE", target: "hoursPanel" },
    { key: "reports", label: "Reportes", target: "reportsPanel" },
    { key: "dashboard", label: "Dashboard", target: "dashboardPanel" },
    { key: "log", label: "LOG", target: "auditLogPanel" }
];

const TARGET_TO_MENU = MENU_PERMISSION_DEFS.reduce((map, menu) => {
    map[menu.target] = menu.key;
    return map;
}, {
    timelinePanel: "turnos"
});

let permissionState = {
    ready: false,
    workspaceId: "",
    uid: "",
    role: "owner",
    isOwner: true,
    permissions: defaultMenuPermissions()
};
let unsubscribePermissions = null;

function defaultMenuPermissions() {
    return MENU_PERMISSION_DEFS.reduce((map, menu) => {
        map[menu.key] = {
            view: true,
            edit: true
        };
        return map;
    }, {});
}

function readOnlyMenuPermissions() {
    return MENU_PERMISSION_DEFS.reduce((map, menu) => {
        map[menu.key] = {
            view: true,
            edit: false
        };
        return map;
    }, {});
}

function noAccessMenuPermissions() {
    return MENU_PERMISSION_DEFS.reduce((map, menu) => {
        map[menu.key] = {
            view: false,
            edit: false
        };
        return map;
    }, {});
}

function dispatchPermissionsChanged() {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
        new CustomEvent("proturnos:workspacePermissionsChanged", {
            detail: getWorkspacePermissionState()
        })
    );
}

export function normalizeMenuPermissions(permissions = {}) {
    const normalized = noAccessMenuPermissions();

    MENU_PERMISSION_DEFS.forEach(menu => {
        const raw = permissions?.[menu.key] || {};
        const view = raw.view === true;
        const edit = view && raw.edit === true;

        normalized[menu.key] = {
            view,
            edit
        };
    });

    return normalized;
}

export function getWorkspacePermissionState() {
    return {
        ...permissionState,
        permissions: normalizeMenuPermissions(permissionState.permissions)
    };
}

export function isWorkspaceOwner() {
    return Boolean(permissionState.isOwner);
}

export function workspaceRequiresMfa() {
    if (!FIREBASE_REQUIRE_PRIVILEGED_MFA) return false;
    if (permissionState.isOwner) return true;

    return MENU_PERMISSION_DEFS.some(menu =>
        permissionState.permissions?.[menu.key]?.edit === true
    );
}

export function menuKeyForTarget(targetId) {
    return TARGET_TO_MENU[targetId] || "";
}

export function canViewMenu(menuKey) {
    if (!menuKey || permissionState.isOwner) return true;

    return permissionState.permissions?.[menuKey]?.view !== false;
}

export function canEditMenu(menuKey) {
    if (!menuKey || permissionState.isOwner) return true;

    const permission = permissionState.permissions?.[menuKey];

    return permission?.view !== false && permission?.edit !== false;
}

export function canViewTarget(targetId) {
    return canViewMenu(menuKeyForTarget(targetId));
}

export function canEditTarget(targetId) {
    return canEditMenu(menuKeyForTarget(targetId));
}

export function canEditAnyMenu() {
    if (permissionState.isOwner) return true;

    return MENU_PERMISSION_DEFS.some(menu =>
        canEditMenu(menu.key)
    );
}

export function firstViewableTarget() {
    return MENU_PERMISSION_DEFS.find(menu =>
        canViewTarget(menu.target)
    )?.target || "calendarPanel";
}

export async function loadWorkspacePermissions(workspace = getActiveWorkspace()) {
    const user = getCurrentFirebaseUser();

    if (!isFirebaseConfigured() || !workspace?.id || !user?.uid) {
        permissionState = {
            ready: true,
            workspaceId: workspace?.id || "",
            uid: user?.uid || "",
            role: "owner",
            isOwner: true,
            permissions: defaultMenuPermissions()
        };
        dispatchPermissionsChanged();
        return getWorkspacePermissionState();
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const memberSnap = await firestoreModule.getDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            workspace.id,
            "members",
            user.uid
        )
    );
    const memberExists = memberSnap.exists();
    const member = memberExists ? memberSnap.data() || {} : {};
    const role = memberExists
        ? member.role || workspace.role || "member"
        : workspace.role === "owner"
            ? "owner"
            : "removed";
    const isOwner = role === "owner";

    permissionState = {
        ready: true,
        workspaceId: workspace.id,
        uid: user.uid,
        role,
        isOwner,
        permissions: isOwner
            ? defaultMenuPermissions()
            : memberExists
                ? normalizeMenuPermissions(member.permissions)
                : noAccessMenuPermissions()
    };

    dispatchPermissionsChanged();
    return getWorkspacePermissionState();
}

export function stopWorkspacePermissionListener() {
    if (typeof unsubscribePermissions === "function") {
        unsubscribePermissions();
    }

    unsubscribePermissions = null;
}

export async function startWorkspacePermissionListener(
    workspace = getActiveWorkspace(),
    onChange = () => {}
) {
    stopWorkspacePermissionListener();

    const user = getCurrentFirebaseUser();

    if (!isFirebaseConfigured() || !workspace?.id || !user?.uid) {
        const state = await loadWorkspacePermissions(workspace);
        onChange(state);
        return () => {};
    }

    const { db, firestoreModule } = await getFirebaseServices();
    const initialOwner = workspace.role === "owner";

    permissionState = {
        ready: false,
        workspaceId: workspace.id,
        uid: user.uid,
        role: workspace.role || "member",
        isOwner: initialOwner,
        permissions: initialOwner
            ? defaultMenuPermissions()
            : readOnlyMenuPermissions()
    };
    dispatchPermissionsChanged();

    const memberRef = firestoreModule.doc(
        db,
        "workspaces",
        workspace.id,
        "members",
        user.uid
    );

    const applyMemberSnapshot = snap => {
        const memberExists = snap.exists();
        const member = memberExists ? snap.data() || {} : {};
        const role = memberExists
            ? member.role || workspace.role || "member"
            : initialOwner
                ? "owner"
                : "removed";
        const isOwner = role === "owner";

        permissionState = {
            ready: true,
            workspaceId: workspace.id,
            uid: user.uid,
            role,
            isOwner,
            permissions: isOwner
                ? defaultMenuPermissions()
                : memberExists
                    ? normalizeMenuPermissions(member.permissions)
                    : noAccessMenuPermissions()
        };

        dispatchPermissionsChanged();
        onChange(getWorkspacePermissionState());
    };

    applyMemberSnapshot(await firestoreModule.getDoc(memberRef));

    unsubscribePermissions = firestoreModule.onSnapshot(
        memberRef,
        applyMemberSnapshot,
        error => {
            console.warn(
                "No se pudieron sincronizar permisos del entorno.",
                error
            );
        }
    );

    return unsubscribePermissions;
}

export async function listWorkspaceMembersForPermissions(
    workspace = getActiveWorkspace()
) {
    if (!isFirebaseConfigured() || !workspace?.id) return [];

    const { db, firestoreModule } = await getFirebaseServices();
    const snap = await firestoreModule.getDocs(
        firestoreModule.collection(
            db,
            "workspaces",
            workspace.id,
            "members"
        )
    );

    return snap.docs
        .map(docSnap => {
            const data = docSnap.data() || {};

            return {
                uid: docSnap.id,
                role: data.role || "member",
                email: data.email || "",
                displayName: data.displayName || "",
                joinedAt: data.joinedAt || "",
                permissions: normalizeMenuPermissions(data.permissions)
            };
        })
        .sort((a, b) => {
            if (a.role === "owner" && b.role !== "owner") return -1;
            if (a.role !== "owner" && b.role === "owner") return 1;

            return (a.displayName || a.email || a.uid)
                .localeCompare(b.displayName || b.email || b.uid);
        });
}

export async function saveWorkspaceMemberPermissions(
    workspaceId,
    userId,
    permissions
) {
    if (!workspaceId || !userId) {
        throw new Error("Falta el entorno o usuario para guardar permisos.");
    }

    const { db, firestoreModule } = await getFirebaseServices();

    await firestoreModule.updateDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            workspaceId,
            "members",
            userId
        ),
        {
            permissions: normalizeMenuPermissions(permissions),
            permissionsUpdatedAt: firestoreModule.serverTimestamp()
        }
    );
}

export async function deleteWorkspaceMember(workspaceId, userId) {
    if (!workspaceId || !userId) {
        throw new Error("Falta el entorno o usuario para eliminar el acceso.");
    }

    const currentUser = getCurrentFirebaseUser();
    if (currentUser?.uid === userId) {
        throw new Error("No puedes eliminar tu propio acceso al entorno.");
    }

    const { db, firestoreModule } = await getFirebaseServices();

    await firestoreModule.deleteDoc(
        firestoreModule.doc(
            db,
            "workspaces",
            workspaceId,
            "members",
            userId
        )
    );
}
