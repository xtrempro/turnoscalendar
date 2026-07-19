import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
    new URL("../js/main.js", import.meta.url),
    "utf8"
);

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

test("los clicks de menu no hacen scroll si el guard bloquea", () => {
    assert.match(
        source,
        /button\.onclick = async \(\) => \{[\s\S]*const navigated = await setActiveShortcut\([\s\S]*if \(!navigated\) return;[\s\S]*target\.scrollIntoView/
    );
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
