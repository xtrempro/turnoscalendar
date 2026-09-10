import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
    return readFile(new URL(path, import.meta.url), "utf8");
}

test("Equipos Medicos queda enganchado a ProTurnos, permisos y PWA", async () => {
    const [
        html,
        main,
        navigation,
        permissions,
        modules,
        attachments,
        functionsIndex,
        firestoreRules,
        storageRules,
        css,
        source,
        taskAssignments,
        home
    ] = await Promise.all([
        read("../index.html"),
        read("../js/main.js"),
        read("../js/navigation.js"),
        read("../js/workspacePermissions.js"),
        read("../js/firebaseStateModules.js"),
        read("../js/attachmentUtils.js"),
        read("../functions/index.js"),
        read("../firebase.rules"),
        read("../storage.rules"),
        read("../styles.css"),
        read("../js/medicalEquipment.js"),
        read("../js/taskAssignments.js"),
        read("../js/home.js")
    ]);

    const informationsNavIndex = html.indexOf('data-target="informationsPanel"');
    const equipmentNavIndex = html.indexOf('data-target="medicalEquipmentPanel"');
    const kanbanNavIndex = html.indexOf('data-target="kanbanPanel"');

    assert.match(html, /data-target="medicalEquipmentPanel"[\s\S]{0,900}Equipos M&eacute;dicos/);
    assert.ok(equipmentNavIndex > informationsNavIndex);
    assert.ok(kanbanNavIndex > equipmentNavIndex);
    assert.match(html, /<section id="medicalEquipmentPanel" class="panel medical-equipment-panel"><\/section>/);
    assert.match(navigation, /targetId === "medicalEquipmentPanel"[\s\S]{0,90}return "medicalEquipment";/);
    assert.match(main, /initMedicalEquipmentPanel/);
    assert.match(main, /renderMedicalEquipmentPanel/);
    assert.match(main, /startMedicalEquipmentReportSync/);
    assert.match(permissions, /key: "medicalEquipment"[\s\S]{0,120}target: "medicalEquipmentPanel"/);
    assert.match(modules, /medicalEquipment:\s*\{\s*permission:\s*"medicalEquipment"\s*\}/);
    assert.match(modules, /\["medicalEquipment",\s*"medicalEquipment"\]/);
    assert.match(attachments, /"medicalEquipment"/);
    assert.match(attachments, /uploadMedicalEquipmentAttachment/);
    assert.match(attachments, /deleteMedicalEquipmentAttachment/);
    assert.match(functionsIndex, /"medicalEquipment"/);
    assert.match(functionsIndex, /exports\.uploadMedicalEquipmentAttachment\s*=\s*onCall/);
    assert.match(functionsIndex, /exports\.deleteMedicalEquipmentAttachment\s*=\s*onCall/);
    assert.match(functionsIndex, /exports\.createWorkerMedicalEquipmentReport\s*=\s*onCall/);
    assert.match(firestoreRules, /match \/medicalEquipmentReports\/\{reportId\}/);
    assert.match(firestoreRules, /docId == "medicalEquipment" && canViewMenu\(workspaceId, "medicalEquipment"\)/);
    assert.match(firestoreRules, /docId == "medicalEquipment" && canEditMenu\(workspaceId, "medicalEquipment"\)/);
    assert.match(storageRules, /medicalEquipmentEnabledByDefault/);
    assert.match(css, /body:not\(\[data-active-view="medicalEquipment"\]\) #medicalEquipmentPanel/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="medicalEquipmentPanel"\]\s*\{[\s\S]{0,80}order:\s*13/);
    assert.match(source, /export async function publishMedicalEquipmentToWorkers/);
    assert.match(source, /export function medicalEquipmentOutagesForRange/);
    assert.match(source, /export function medicalEquipmentCalendarEventsForRange/);
    assert.match(source, /REPORTS_COLLECTION = "medicalEquipmentReports"/);
    assert.match(taskAssignments, /medicalEquipmentOutagesForRange/);
    assert.match(taskAssignments, /task-assignment-cell--maintenance/);
    assert.match(taskAssignments, /data-maintenance-blocked="true"/);
    // El equipo en mantenimiento es UNA de las razones por las que una casilla
    // no admite gente -la otra es cerrarla a mano-, y lo que las mira lee el
    // flag comun.
    assert.match(taskAssignments, /data-cell-blocked="true"/);
    assert.match(taskAssignments, /cell\.dataset\.cellBlocked === "true"/);
    assert.match(home, /medicalEquipmentCalendarEventsForRange/);
    assert.match(home, /canViewMenu\("medicalEquipment"\) && canEditMenu\("medicalEquipment"\)/);
    assert.match(home, /data-hm="dt-medeq-row"/);
});

test("Equipos Medicos queda activo para administradores legados con permiso completo", async () => {
    const { normalizeMenuPermissions } =
        await import("../js/workspacePermissions.js");

    const fullLegacy = normalizeMenuPermissions({
        profile: { view: true, edit: true },
        turnos: { view: true, edit: true },
        holders: { view: true, edit: true },
        swap: { view: true, edit: true },
        clockmarks: { view: true, edit: true },
        reports: { view: true, edit: true },
        requests: { view: true, edit: true },
        weekly: { view: true, edit: true },
        tasks: { view: true, edit: true },
        kanban: { view: true, edit: true },
        agenda: { view: true, edit: true },
        hours: { view: true, edit: true },
        memos: { view: true, edit: true },
        dashboard: { view: true, edit: true },
        log: { view: true, edit: true }
    });
    const explicitReadOnly = normalizeMenuPermissions({
        medicalEquipment: { view: true, edit: false }
    });
    const explicitOff = normalizeMenuPermissions({
        medicalEquipment: { view: false, edit: false }
    });

    assert.deepEqual(fullLegacy.medicalEquipment, { view: true, edit: true });
    assert.deepEqual(explicitReadOnly.medicalEquipment, {
        view: true,
        edit: false
    });
    assert.deepEqual(explicitOff.medicalEquipment, { view: false, edit: false });
});
