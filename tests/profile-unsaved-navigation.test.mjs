import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);
const { getViewTopTarget } = await import("../js/navigation.js");

function sourceBlock(start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);

    assert.notEqual(startIndex, -1, `No se encontro ${start}`);
    assert.notEqual(endIndex, -1, `No se encontro ${end}`);

    return source.slice(startIndex, endIndex);
}

test("la navegacion de perfil espera el modal de cambios sin guardar", () => {
    const setActiveShortcut = sourceBlock(
        "async function setActiveShortcut",
        "const PROFILE_LIST_PAGE_SIZE"
    );

    assert.match(
        setActiveShortcut,
        /previousView === "profile"[\s\S]*nextView !== "profile"[\s\S]*!await confirmProfileDraftBeforeLeaving\(\)/
    );
    assert.match(setActiveShortcut, /return false;/);
    assert.match(setActiveShortcut, /return true;/);
});

test("el cambio de trabajador pasa por el mismo guard de perfil", () => {
    const selectProfileByName = sourceBlock(
        "async function selectProfileByName",
        "window.selectProfileByName"
    );

    assert.match(
        selectProfileByName,
        /isProfileEditing\(\)[\s\S]*confirmProfileDraftBeforeLeaving/
    );
    assert.match(
        selectProfileByName,
        /if \(!await confirmProfileDraftBeforeLeaving\(\)\) \{[\s\S]*return false;/
    );
    assert.match(selectProfileByName, /const profileInactive = !isProfileActive\(profile\)/);
    assert.match(selectProfileByName, /const openProfile = options\.openProfile \|\| profileInactive/);
    assert.match(selectProfileByName, /const openTurns = options\.openTurns && !profileInactive/);
    assert.match(selectProfileByName, /return true;/);
});

test("guardarPerfil comunica exito o bloqueo al guard", () => {
    const guardarPerfil = sourceBlock(
        "async function guardarPerfil",
        "function handleAvailabilityEdit"
    );

    assert.match(guardarPerfil, /return true;/);
    assert.match(
        guardarPerfil,
        /catch \(error\) \{[\s\S]*return false;/
    );
    assert.doesNotMatch(guardarPerfil, /^\s*return;$/m);
});

test("guardar un perfil sin cambios no dispara guardado remoto", () => {
    const guardarPerfil = sourceBlock(
        "async function guardarPerfil",
        "function handleAvailabilityEdit"
    );

    const noChangesIndex = guardarPerfil.indexOf(
        "!hasUnsavedProfileDraftChanges()"
    );
    const validationIndex = guardarPerfil.indexOf("validateDraft()");
    const sealIndex = guardarPerfil.indexOf("sealCriticalProfileState");

    assert.ok(noChangesIndex >= 0, "falta salida para perfil sin cambios");
    assert.ok(
        noChangesIndex < validationIndex,
        "el caso sin cambios debe salir antes de validar/guardar"
    );
    assert.ok(
        noChangesIndex < sealIndex,
        "el caso sin cambios no debe confirmar estado remoto"
    );
    assert.match(
        guardarPerfil,
        /profileDraft\.mode === PROFILE_MODE\.EDIT &&\s*\n\s*!hasUnsavedProfileDraftChanges\(\)[\s\S]{0,140}discardProfileDraftChangesBeforeLeaving\(\);\s*\n\s*return true;/
    );
});

test("guardar cambios confirma solo las claves que realmente variaron", () => {
    const guardarPerfil = sourceBlock(
        "async function guardarPerfil",
        "function handleAvailabilityEdit"
    );
    const seal = sourceBlock(
        "async function sealCriticalProfileState",
        "function renderContractHistory"
    );

    assert.match(
        guardarPerfil,
        /const profileStateBeforeSave =\s*\n\s*snapshotCriticalProfileState\(profileSaveSealNames\);/
    );
    assert.match(
        guardarPerfil,
        /const profileStateChanges = changedCriticalProfileState\(\s*\n\s*profileStateBeforeSave,\s*\n\s*profileSaveSealNames\s*\n\s*\);/
    );
    assert.match(
        guardarPerfil,
        /sealCriticalProfileState\(\s*\n\s*profileSaveSealNames,\s*\n\s*"profile-save",\s*\n\s*profileStateChanges\s*\n\s*\)/
    );
    assert.match(seal, /const keys = hasExplicitChanges\s*\? Object\.keys\(changes\)/);
    assert.match(seal, /changes: hasExplicitChanges \? changes : \{\}/);
    assert.match(seal, /reason: "unchanged"/);
});

test("al guardar un perfil desactivado se selecciona otro activo", () => {
    const selectionHelpers = sourceBlock(
        "function activeProfileNameAfterSave",
        "function normalizeProfileDraftText"
    );
    const guardarPerfil = sourceBlock(
        "async function guardarPerfil",
        "function handleAvailabilityEdit"
    );

    assert.match(selectionHelpers, /savedProfile\.active !== false/);
    assert.match(selectionHelpers, /isProfileActive\(profile\)/);
    assert.match(selectionHelpers, /setCurrentProfile\(selectedName \|\| null\)/);
    assert.match(guardarPerfil, /selectProfileAfterSave\(nextName, nextProfilePayload\)/);
});

test("mover turno habilita deshacer al terminar la accion", () => {
    const moveShiftTarget = sourceBlock(
        "function handleMoveShiftTargetSelection",
        "function startCreateMode"
    );

    assert.match(
        moveShiftTarget,
        /pushHistory\(\)[\s\S]*clearSelectionMode\(\);\s*updateHistoryNavState\(\);/
    );
});

test("los clicks de menu no hacen scroll si el guard bloquea", () => {
    assert.match(
        source,
        /button\.onclick = async \(\) => \{[\s\S]*const navigated = await setActiveShortcut\([\s\S]*if \(!navigated\) return;[\s\S]*\.scrollIntoView/
    );
});

test("cada menu se entra por el comienzo de su vista", () => {
    // El tile de Perfiles apunta a "Datos personales", que tiene arriba el
    // encabezado del trabajador y sus tarjetas: entrar ahi se ve como una
    // pagina que quedo a medio scroll.
    assert.match(
        source,
        /getElementById\(\s*getViewTopTarget\(button\.dataset\.target\)\s*\)/
    );
    assert.equal(getViewTopTarget("profileSection"), "profileHero");
    assert.equal(getViewTopTarget("reportsPanel"), "reportsPanel");
    assert.equal(getViewTopTarget("homePanel"), "homePanel");
});

test("los saldos editados en perfil marcan el borrador como modificado", () => {
    const availabilityRender = sourceBlock(
        "function renderDisponibilidadVacaciones",
        "function renderDashboardState"
    );

    assert.match(
        availabilityRender,
        /input\.oninput = \(\) => \{[\s\S]*profileAvailabilityDraftTouched = true;/
    );
});
