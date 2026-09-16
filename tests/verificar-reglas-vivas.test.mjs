// Antes de desplegar la web, las reglas vivas tienen que conocer lo que la app
// pide (scripts/verificar-reglas-vivas.mjs).
//
// Dos caidas por lo mismo: 2026-09-09 (`medicalEquipment`) y 2026-09-15
// (`tenders`, Licitaciones). Se desplego la web sin las reglas y ningun
// computador cargaba datos: "Sin sincronizacion con el servidor".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    declaredStateModules,
    missingModuleClauses,
    normalizeRules,
    sameRules
} from "../scripts/verificar-reglas-vivas.mjs";

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("lee los modulos que declara la app, sin los del dueño", () => {
    const modules = declaredStateModules(read("js/firebaseStateModules.js"));

    assert.ok(modules.includes("tenders"));
    assert.ok(modules.includes("medicalEquipment"));
    assert.ok(!modules.includes("system"), "system entra por isOwner");
});

test("detecta un modulo que las reglas vivas no conocen", () => {
    // Las reglas de produccion del 09-10: sin Licitaciones.
    const viejas = 'x || (moduleId == "turnos" && a) || (moduleId == "log" && b)';

    assert.deepEqual(missingModuleClauses(viejas, ["turnos", "tenders", "log"]), ["tenders"]);
});

test("las reglas del repositorio conocen todos los modulos declarados", () => {
    assert.deepEqual(
        missingModuleClauses(read("firebase.rules"), declaredStateModules(read("js/firebaseStateModules.js"))),
        []
    );
});

test("el fin de linea de Windows no cuenta como diferencia; un cambio real si", () => {
    const repo = "rules_version = '2';\r\nservice cloud.firestore {  \r\n}\r\n";
    const viva = "rules_version = '2';\nservice cloud.firestore {\n}";

    assert.equal(normalizeRules(repo), normalizeRules(viva));
    assert.equal(sameRules(repo, viva), true);
    assert.equal(sameRules(repo, viva.replace("{", "{ allow read;")), false);
});

test("corre antes de CADA deploy de la web, en produccion y en test", () => {
    // En el predeploy de hosting y no solo en un script de npm: tambien cubre
    // `firebase deploy --only hosting` escrito a mano.
    [
        JSON.parse(read("firebase.json")),
        JSON.parse(read("firebase.test.json"))
    ].forEach(config => {
        assert.deepEqual(config.hosting.predeploy, ["node scripts/verificar-reglas-vivas.mjs"]);
    });
});

test("en produccion exige Firestore y Storage iguales al repositorio", () => {
    const script = read("scripts/verificar-reglas-vivas.mjs");

    assert.match(script, /sameRules\(liveFirestore, readFileSync\(path\.join\(ROOT, "firebase\.rules"\)/);
    assert.match(script, /sameRules\(liveStorage, readFileSync\(path\.join\(ROOT, "storage\.rules"\)/);
    // Y dice que comando falta.
    assert.match(script, /firebase deploy --only firestore:rules,storage --project production/);
});

test("corta con codigo 2: el 1 en Windows sale como 'spawn node ENOENT'", () => {
    const script = read("scripts/verificar-reglas-vivas.mjs");

    assert.match(script, /const EXIT_BLOCKED = 2;/);
    assert.doesNotMatch(script, /exitCode = 1\b|process\.exit\(1\)/);
});

test("el deploy de seguridad publica las reglas ANTES que la web", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    const security = scripts["deploy:security"];

    assert.ok(
        security.indexOf("--only firestore:rules,storage") < security.indexOf("--only hosting"),
        security
    );
});
