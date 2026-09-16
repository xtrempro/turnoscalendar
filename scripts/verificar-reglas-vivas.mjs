// Antes de desplegar la web: que las reglas VIVAS conozcan lo que la app pide.
//
// Paso dos veces. El 2026-09-09 con `medicalEquipment` y el 2026-09-15 con
// `tenders` (Licitaciones): se desplego la web y no las reglas. Cada computador
// que abria la app pedia un modulo que las reglas denegaban, la carga inicial
// fallaba entera y quedaba el aviso "Sin sincronizacion con el servidor".
//
// Corre solo antes de cada `firebase deploy` que incluya hosting (predeploy en
// firebase.json y firebase.test.json). Si algo falta corta el deploy y dice que
// comando correr. Revisa:
//   - en los dos proyectos, que las reglas vivas de Firestore tengan clausula
//     para cada modulo que declara js/firebaseStateModules.js;
//   - en produccion, ademas, que las reglas vivas de Firestore y Storage sean
//     las del repositorio.
//
// Si las reglas y la web van en el mismo deploy, este paso corre ANTES de
// publicar las reglas y las ve viejas: primero se despliegan las reglas, despues
// la web (npm run deploy:security ya lo hace asi).
//
// Uso manual:  node scripts/verificar-reglas-vivas.mjs --project calendarioturnos-7c4d9
// Emergencia:  SALTAR_VERIFICAR_REGLAS=1 antes del deploy

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_PROJECT = "calendarioturnos-7c4d9";
// Nunca 1: en Windows firebase-tools lanza el hook con cross-spawn, que lee un
// codigo 1 como "el comando no existe" y llena la salida con un
// "spawn node ... ENOENT" que tapa el motivo real.
const EXIT_BLOCKED = 2;

/** Los modulos que la app pide y que necesitan clausula propia en las reglas. */
export function declaredStateModules(modulesSource) {
    // Los del DUEÑO entran por `isOwner(workspaceId) ||` en las reglas.
    return [...String(modulesSource || "").matchAll(/^\s{4}(\w+): \{ permission: "(\w+)"/gm)]
        .filter(([, , permission]) => permission !== "owner")
        .map(([, moduleId]) => moduleId);
}

export function missingModuleClauses(rulesSource, moduleIds = []) {
    const source = String(rulesSource || "");

    return moduleIds.filter(moduleId => !source.includes(`moduleId == "${moduleId}"`));
}

// Fin de linea de Windows y espacios al final no son una diferencia de reglas.
export function normalizeRules(source) {
    return String(source || "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(line => line.trimEnd())
        .join("\n")
        .trim();
}

export function sameRules(left, right) {
    return normalizeRules(left) === normalizeRules(right);
}

function arg(name) {
    const index = process.argv.indexOf(name);

    return index !== -1 ? String(process.argv[index + 1] || "") : "";
}

let cachedAccessToken = "";

async function accessToken() {
    if (cachedAccessToken) return cachedAccessToken;

    const auth = require(path.join(process.env.APPDATA || "", "npm", "node_modules", "firebase-tools", "lib", "auth.js"));
    const account = auth.getProjectDefaultAccount(ROOT) || auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    cachedAccessToken = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
    return cachedAccessToken;
}

async function getJson(url, project) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "X-Goog-User-Project": project
        }
    });
    const text = await response.text();

    if (!response.ok) throw new Error(`${response.status} ${url}\n${text.slice(0, 300)}`);

    return JSON.parse(text);
}

async function rulesetSource(release, project) {
    if (!release?.rulesetName) return "";

    const ruleset = await getJson(
        `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
        project
    );

    return (ruleset.source?.files || []).map(file => file.content || "").join("\n");
}

async function main() {
    if (process.env.SALTAR_VERIFICAR_REGLAS) {
        console.warn("verificar-reglas-vivas: SALTADA (SALTAR_VERIFICAR_REGLAS).");
        return;
    }

    const project = arg("--project") || process.env.GCLOUD_PROJECT || "";

    if (!project) {
        throw new Error("No se sabe a que proyecto se despliega: usa --project o GCLOUD_PROJECT.");
    }

    const production = project === PRODUCTION_PROJECT;
    const modules = declaredStateModules(
        readFileSync(path.join(ROOT, "js", "firebaseStateModules.js"), "utf8")
    );
    const { releases = [] } = await getJson(
        `https://firebaserules.googleapis.com/v1/projects/${project}/releases`,
        project
    );
    const firestoreRelease = releases.find(release => release.name.endsWith("/cloud.firestore"));
    const storageRelease = releases.find(release => release.name.includes("/firebase.storage/"));
    const liveFirestore = await rulesetSource(firestoreRelease, project);
    const problems = [];

    missingModuleClauses(liveFirestore, modules).forEach(moduleId => {
        problems.push(`las reglas vivas de Firestore no conocen el modulo "${moduleId}"`);
    });

    if (production) {
        if (!sameRules(liveFirestore, readFileSync(path.join(ROOT, "firebase.rules"), "utf8"))) {
            problems.push("firebase.rules del repositorio no es la regla viva de Firestore");
        }

        const liveStorage = await rulesetSource(storageRelease, project);

        if (!sameRules(liveStorage, readFileSync(path.join(ROOT, "storage.rules"), "utf8"))) {
            problems.push("storage.rules del repositorio no es la regla viva de Storage");
        }
    }

    if (!problems.length) {
        console.log(
            `verificar-reglas-vivas: ${project} al dia ` +
            `(${modules.length} modulos${production ? ", Firestore y Storage iguales al repositorio" : ""}).`
        );
        return;
    }

    console.error(`\nverificar-reglas-vivas: NO se despliega la web en ${project}.`);
    problems.forEach(problem => console.error(`  - ${problem}`));
    console.error(
        "\nLa app nueva pediria lo que las reglas vivas no permiten y ningun computador cargaria datos." +
        "\nDespliega primero las reglas y despues vuelve a desplegar la web:" +
        (production
            ? "\n  firebase deploy --only firestore:rules,storage --project production"
            : "\n  npm run deploy:security-rules:test") +
        "\n"
    );
    process.exitCode = EXIT_BLOCKED;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(`verificar-reglas-vivas: ${error.message}`);
        process.exitCode = EXIT_BLOCKED;
    });
}
