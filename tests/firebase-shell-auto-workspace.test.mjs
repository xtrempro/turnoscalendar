import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseShell = readFileSync("js/firebaseShell.js", "utf8");
const main = readFileSync("js/main.js", "utf8");
const calendar = readFileSync("js/calendar.js", "utf8");

test("escucha cambios en unidades del usuario autenticado", () => {
    assert.match(firebaseShell, /startUserWorkspacesListener/);
    assert.match(firebaseShell, /stopUserWorkspacesListener/);
    assert.match(
        firebaseShell,
        /"users"[\s\S]*user\.uid[\s\S]*"workspaces"/
    );
    assert.match(firebaseShell, /onSnapshot/);
    assert.match(firebaseShell, /handleUserWorkspacesChanged/);
});

test("activa automaticamente la unica unidad disponible", () => {
    assert.match(firebaseShell, /maybeActivateSingleWorkspace/);
    assert.match(firebaseShell, /workspaceList\.length !== 1/);
    assert.match(firebaseShell, /activateWorkspace\(workspaceList\[0\]\)/);
    assert.match(firebaseShell, /await maybeActivateSingleWorkspace\(\)/);
});

test("el boton Usar reutiliza la misma activacion de unidad", () => {
    assert.match(
        firebaseShell,
        /data-workspace-select[\s\S]*await activateWorkspace\(workspace\)/
    );
});

test("cambiar de unidad no repinta con datos del entorno anterior", () => {
    assert.match(
        firebaseShell,
        /await options\.onWorkspaceChange\?\.\(null,\s*\{\s*skipViewRefresh: true\s*\}\);\s*\n\s*replaceLocalSnapshot\(\{\}, \{ silent: true \}\);\s*\n\s*await options\.onWorkspaceChange\?\.\(currentWorkspace\)/
    );
    // Con entorno, el refresco va agendado para cuando hidrate; hacerlo tambien
    // en la cola pintaria con el estado del entorno ANTERIOR, que es el defecto
    // que este test vigila.
    assert.match(
        main,
        /if \(changeOptions\.skipViewRefresh === true\) \{\s*\n\s*return;\s*\n\s*\}[\s\S]{0,400}if \(workspace\?\.id\) return;\s*\n\s*refrescarVistasDelEntorno\(\);/
    );
});

test("la hidratacion arranca ANTES que los demas oyentes", () => {
    // Firestore multiplexa todo sobre una sola sesion WebChannel y un `getDoc`
    // es un objetivo mas en ese canal. Medido el 2026-09-22 en prod: cada
    // lectura tardaba 14 ms y aun asi las 17 resolvian juntas a los 43,5 s,
    // detras de una descarga de 529 kB. Arrancaban ocho grupos de oyentes antes
    // que el estado, que es lo unico que hace util la app.
    const hidrata = main.indexOf("const estadoHidratado = measurePerformance(");

    assert.notEqual(hidrata, -1, "ya no se guarda la promesa de hidratacion");

    [
        "startWorkerAppDataSync",
        "startInterUnitLoanSync",
        "startWorkerAvailabilitySync",
        "startSupervisorMessages",
        "startFirebaseWorkerRequestSync",
        "startFirebaseReplacementRequestSync",
        "startHomeTasksSync",
        "startFirebaseAutoCoverageSync"
    ].forEach(oyente => {
        const donde = main.indexOf(oyente + "(workspace");

        assert.notEqual(donde, -1, `ya no se inicia ${oyente}`);
        assert.ok(
            donde > hidrata,
            `${oyente} arranca ANTES que la hidratacion y le ocupa el canal`
        );
    });
});

test("pero DESPUES de los permisos y del MFA", () => {
    // `canReadModule` depende de los permisos: adelantar la hidratacion a ellos
    // haria que se leyeran menos modulos de los que tocan, y en silencio.
    const permisos = main.indexOf("await startWorkspacePermissionListener(");
    const mfa = main.indexOf("await enforceWorkspaceMfa(workspace);");
    const hidrata = main.indexOf("const estadoHidratado = measurePerformance(");

    assert.notEqual(permisos, -1);
    assert.notEqual(mfa, -1);
    assert.ok(permisos < hidrata, "la hidratacion se adelanto a los permisos");
    assert.ok(mfa < hidrata, "la hidratacion se adelanto al MFA");
});

test("la vista se refresca despues de hidratar la unidad nueva", () => {
    // La intencion no cambia -refrescar CON el estado hidratado, no con el
    // viejo-; cambia el mecanismo. Se agenda en vez de esperar.
    //
    // Esperarlo costaba la carga entera: medido el 2026-09-22 en prod,
    // `start-sync` tardo 128 SEGUNDOS, y como activateWorkspace espera a
    // onWorkspaceChange, el modal de seleccion de unidad no se cerraba hasta
    // entonces.
    assert.match(
        main,
        /const estadoHidratado = measurePerformance\(\s*\n\s*"firebase-app-state:start-sync"/
    );
    assert.doesNotMatch(
        main,
        /await measurePerformance\(\s*\n\s*"firebase-app-state:start-sync"/
    );
    assert.match(
        main,
        /void estadoHidratado\.then\(\(\) => \{[\s\S]{0,400}refrescarVistasDelEntorno\(\);/
    );
});

test("una hidratacion en vuelo no repinta con la unidad que se dejo", () => {
    // Cambiar de unidad dos veces seguidas deja la primera hidratacion en
    // camino: al llegar, sus vistas ya no son las de la unidad activa.
    assert.match(main, /const generacion = \+\+workspaceChangeGeneration;/);
    assert.match(
        main,
        /if \(generacion !== workspaceChangeGeneration\) return;/
    );
});

test("el calendario invalida cache al aplicar la foto inicial del entorno", () => {
    assert.match(
        calendar,
        /event\.detail\?\.type === "app-state-applied"[\s\S]{0,220}clearCalendarCache\(\);[\s\S]{0,260}skipCache: true/
    );
});
