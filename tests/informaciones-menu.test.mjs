import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
    return readFile(new URL(path, import.meta.url), "utf8");
}

function sourceBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start);

    assert.notEqual(start, -1, `no se encontro ${startNeedle}`);
    assert.notEqual(end, -1, `no se encontro el limite de ${startNeedle}`);

    return source.slice(start, end);
}

test("Informaciones queda enganchado al panel supervisor y a permisos", async () => {
    const [
        html,
        main,
        navigation,
        permissions,
        modules,
        attachments,
        functionsIndex,
        css
    ] = await Promise.all([
        read("../index.html"),
        read("../js/main.js"),
        read("../js/navigation.js"),
        read("../js/workspacePermissions.js"),
        read("../js/firebaseStateModules.js"),
        read("../js/attachmentUtils.js"),
        read("../functions/index.js"),
        read("../styles.css")
    ]);

    const tasksNavIndex = html.indexOf('data-target="taskAssignmentsPanel"');
    const informationsNavIndex = html.indexOf('data-target="informationsPanel"');
    const medicalEquipmentNavIndex = html.indexOf('data-target="medicalEquipmentPanel"');
    const tendersNavIndex = html.indexOf('data-target="tendersPanel"');
    const kanbanNavIndex = html.indexOf('data-target="kanbanPanel"');

    assert.match(html, /data-target="informationsPanel"[\s\S]{0,900}Informaciones/);
    assert.ok(tasksNavIndex > -1);
    assert.ok(informationsNavIndex > tasksNavIndex);
    assert.ok(medicalEquipmentNavIndex > informationsNavIndex);
    assert.ok(tendersNavIndex > medicalEquipmentNavIndex);
    assert.ok(kanbanNavIndex > tendersNavIndex);
    assert.match(html, /<section id="informationsPanel" class="panel informations-panel"><\/section>/);
    assert.match(navigation, /targetId === "informationsPanel"[\s\S]{0,80}return "informations";/);
    assert.match(main, /renderInformationsPanel/);
    assert.match(main, /nextView === "informations"[\s\S]{0,100}renderInformationsPanel\(\)/);
    assert.match(permissions, /key: "informations"[\s\S]{0,90}target: "informationsPanel"/);
    assert.match(modules, /informations:\s*\{\s*permission:\s*"informations"\s*\}/);
    assert.match(modules, /\["informations",\s*"informations"\]/);
    assert.match(attachments, /"informations"/);
    assert.match(attachments, /uploadInformationAttachment/);
    assert.match(attachments, /deleteInformationAttachment/);
    assert.match(functionsIndex, /exports\.uploadInformationAttachment\s*=\s*onCall/);
    assert.match(functionsIndex, /exports\.deleteInformationAttachment\s*=\s*onCall/);
    assert.match(functionsIndex, /"informations"/);
    assert.match(css, /body:not\(\[data-active-view="informations"\]\) #informationsPanel/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="taskAssignmentsPanel"\]\s*\{[\s\S]{0,80}order:\s*11/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="informationsPanel"\]\s*\{[\s\S]{0,80}order:\s*12/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="medicalEquipmentPanel"\]\s*\{[\s\S]{0,80}order:\s*13/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="tendersPanel"\]\s*\{[\s\S]{0,80}order:\s*14/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="kanbanPanel"\]\s*\{[\s\S]{0,80}order:\s*15/);
});

test("Informaciones queda activo por defecto en permisos legados", async () => {
    const { normalizeMenuPermissions } =
        await import("../js/workspacePermissions.js");
    const functionsIndex = await read("../functions/index.js");

    const legacy = normalizeMenuPermissions({
        tasks: { view: true, edit: false }
    });
    const explicitOff = normalizeMenuPermissions({
        informations: { view: false, edit: false }
    });
    const explicitReadOnly = normalizeMenuPermissions({
        informations: { view: true, edit: false }
    });

    assert.deepEqual(legacy.informations, { view: true, edit: true });
    assert.deepEqual(explicitOff.informations, { view: false, edit: false });
    assert.deepEqual(explicitReadOnly.informations, {
        view: true,
        edit: false
    });
    assert.match(functionsIndex, /key === INFORMATION_ATTACHMENT_MODULE_ID/);
    assert.match(
        functionsIndex,
        /edit:\s*view && \(enabledByDefault \|\| raw\.edit === true\)/
    );
});

test("Informaciones publica a trabajadores enlazados con reglas dedicadas", async () => {
    const firestoreRules = await read("../firebase.rules");
    const storageRules = await read("../storage.rules");
    const source = await read("../js/informations.js");

    assert.match(source, /"workspaces",[\s\S]{0,120}"published",[\s\S]{0,80}PUBLISHED_DOC_ID/);
    assert.match(source, /moduleId:\s*"informations"[\s\S]{0,120}ownerId:\s*"published"/);
    assert.match(source, /publicInformationsPayload/);
    assert.doesNotMatch(source, /dataUrl:[\s\S]{0,80}publicAttachmentPayload/);

    const firestoreEditAny =
        sourceBlock(firestoreRules, "function memberCanEditSomething", "function memberRequiresMfa");
    const firestoreEditInformations =
        sourceBlock(firestoreRules, "function canEditInformationsMenu", "function canReadStateModule");
    const storageRequiresMfa =
        sourceBlock(storageRules, "function memberRequiresMfa", "function memberHasExplicitAccess");
    const storagePublishInformations =
        sourceBlock(storageRules, "function canPublishInformationAttachment", "function canPublishScheduleAttachment");

    assert.match(firestoreRules, /function canViewInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /function canEditInformationsMenu\(workspaceId\)/);
    assert.match(firestoreEditAny, /!\("informations" in permissions\)/);
    assert.match(firestoreEditInformations, /!\("informations" in permissions\)/);
    assert.doesNotMatch(firestoreEditInformations, /memberCanEditSomething\(workspaceId\)/);
    assert.match(firestoreRules, /docId == "informations" && canViewInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /docId == "informations" && canEditInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /moduleId == "informations" && canViewInformationsMenu\(workspaceId\)/);
    assert.match(firestoreRules, /moduleId == "informations" && canEditInformationsMenu\(workspaceId\)/);

    assert.match(storageRules, /function isPublishedInformationAttachment\(moduleId, ownerId\)/);
    assert.match(storageRules, /moduleId == "informations"[\s\S]{0,80}ownerId == "published"/);
    assert.match(storageRules, /function canPublishInformationAttachment\(workspaceId\)/);
    assert.match(storageRequiresMfa, /!\("informations" in permissions\)/);
    assert.match(storagePublishInformations, /!\("informations" in permissions\)/);
    assert.doesNotMatch(storagePublishInformations, /memberRequiresMfa\(workspaceId\)/);
    assert.match(storageRules, /isPublishedInformationAttachment\(moduleId, ownerId\)[\s\S]{0,160}canPublishInformationAttachment\(workspaceId\)[\s\S]{0,80}allowedFile\(\)/);
    assert.match(storageRules, /isPublishedInformationAttachment\(moduleId, ownerId\)[\s\S]{0,180}workerLinks/);
});
