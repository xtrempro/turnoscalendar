// SOLO LECTURA. Revisión diaria de las tres cosas que, cuando fallan, no se
// quejan solas.
//
// Nace del 2026-09-09: el cliente pedía un stateModule (`medicalEquipment`)
// cuyas reglas nunca se desplegaron, y ese único permiso denegado dejó a TODOS
// los supervisores en solo escritura durante dos días, con un warning en la
// consola como única señal. Se perdió la programación de tareas de una unidad.
//
// Comprueba:
//   A. Que las reglas VIVAS conozcan cada módulo que el cliente pide.
//   B. Que la publicación de los documentos de enlazados esté sana.
//   C. Que no haya trabajadores enlazados sin proyección.
//
// Uso:
//   node scripts/revision-diaria.mjs
//   node scripts/revision-diaria.mjs --project turnoplus-test-7c4d9

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function arg(name, fallback = "") {
    const index = process.argv.indexOf(name);

    return index !== -1 && process.argv[index + 1]
        ? process.argv[index + 1]
        : fallback;
}

const PROJECT_ID = arg("--project", "calendarioturnos-7c4d9");
const HORAS = Number(arg("--horas", "72")) || 72;
const RAIZ = new URL("..", import.meta.url);

let cachedToken = "";
const problemas = [];
const avisos = [];

function marcar(lista, texto) {
    lista.push(texto);
}

async function accessToken() {
    if (cachedToken) return cachedToken;

    const auth = require(path.join(
        process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib", "auth.js"
    ));
    const account =
        auth.getProjectDefaultAccount(process.cwd()) ||
        auth.getGlobalDefaultAccount();

    if (!account?.tokens?.refresh_token) {
        throw new Error("Ejecuta firebase login antes de continuar.");
    }

    cachedToken = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
    return cachedToken;
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "Content-Type": "application/json",
            "X-Goog-User-Project": PROJECT_ID,
            ...(options.headers || {})
        }
    });
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${response.status} ${url.slice(0, 90)}\n${text.slice(0, 300)}`);
    }

    return text ? JSON.parse(text) : {};
}

// ───────── A. Reglas vivas vs. lo que el cliente pide ─────────

async function revisarReglas() {
    console.log("A. Reglas vivas");

    const releases = await api(
        `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`
    );
    const release = (releases.releases || [])
        .find(item => item.name.endsWith("cloud.firestore"));

    if (!release) {
        marcar(problemas, "No hay release de reglas de Firestore.");
        return;
    }

    const ruleset = await api(
        `https://firebaserules.googleapis.com/v1/${release.rulesetName}`
    );
    const vivo = (ruleset.source?.files || []).map(file => file.content).join("\n");

    console.log(`   desplegadas el ${ruleset.createTime}`);

    // Los módulos que el cliente pide al arrancar. Uno sin cláusula se deniega,
    // y con eso basta para tumbar la sincronización entera.
    const modulos = readFileSync(new URL("js/firebaseStateModules.js", RAIZ), "utf8");
    const declarados = [...modulos.matchAll(/^\s{4}(\w+): \{ permission: "(\w+)"/gm)]
        .filter(([, , permiso]) => permiso !== "owner")
        .map(([, moduleId]) => moduleId);
    const sinRegla = declarados.filter(
        moduleId => !vivo.includes(`moduleId == "${moduleId}"`)
    );

    if (sinRegla.length) {
        marcar(
            problemas,
            `Modulos que el cliente pide y las reglas VIVAS no conocen: ` +
            `${sinRegla.join(", ")}. Es lo que dejo la app en solo escritura el ` +
            `2026-09-09. Arreglo: firebase deploy --only firestore:rules,storage ` +
            `--project ${PROJECT_ID}`
        );
    } else {
        console.log(`   ${declarados.length} modulos, todos con clausula  OK`);
    }

    // Y si el repo tiene reglas que no estan desplegadas, conviene saberlo.
    const repo = readFileSync(new URL("firebase.rules", RAIZ), "utf8");
    const normalizar = (texto) => texto.replace(/\s+/g, " ").trim();

    if (normalizar(repo) !== normalizar(vivo)) {
        marcar(
            avisos,
            "Las reglas del repo NO son identicas a las desplegadas. Puede ser " +
            "trabajo en curso, o un deploy que falto."
        );
    } else {
        console.log("   repo y produccion coinciden  OK");
    }
}

// ───────── B. Publicación de los documentos de enlazados ─────────

async function revisarPublicacion() {
    console.log("\nB. Publicacion de enlazados (ultimas " + HORAS + " h)");

    const desde = new Date(Date.now() - HORAS * 3600e3).toISOString();
    const respuesta = await api(
        "https://logging.googleapis.com/v2/entries:list",
        {
            method: "POST",
            body: JSON.stringify({
                resourceNames: [`projects/${PROJECT_ID}`],
                filter:
                    `jsonPayload.message="worker-app linked docs published" ` +
                    `AND timestamp >= "${desde}"`,
                orderBy: "timestamp desc",
                pageSize: 50
            })
        }
    );
    const entradas = (respuesta.entries || []).map(item => item.jsonPayload || {});

    if (!entradas.length) {
        marcar(
            avisos,
            "Ninguna publicacion de enlazados en la ventana. Puede ser normal " +
            "si nadie edito nada, pero conviene mirarlo si se repite."
        );
        return;
    }

    const suma = (campo) => entradas.reduce((total, item) => total + (Number(item[campo]) || 0), 0);
    const escritas = suma("written");
    const fallidas = suma("failed");
    const sinPerfil = suma("unmatchedLinks");

    console.log(
        `   ${entradas.length} corridas | escritas ${escritas} | ` +
        `omitidas ${suma("skipped")} | fallidas ${fallidas} | sin perfil ${sinPerfil}`
    );

    // El detalle por corrida es lo que deja juzgar si converge o diverge: los
    // totales solos no lo dicen.
    console.log("   ultimas corridas (escritas de cuantas armadas):");
    entradas.slice(0, 8).forEach((item, indice) => {
        const marca = indice === 0 ? "mas reciente" : "";
        console.log(
            `     ${String(item.written).padStart(4)} / ${String(item.built).padStart(4)}` +
            `   ${String(item.workspaceId || "").slice(0, 24).padEnd(24)} ${marca}`
        );
    });

    if (fallidas > 0) {
        marcar(problemas, `${fallidas} documentos no se pudieron armar (failed).`);
    }

    if (sinPerfil > 0) {
        marcar(
            problemas,
            `${sinPerfil} enlaces sin perfil que calce (unmatchedLinks): esa ` +
            "gente dejo de recibir en la PWA y no se queja sola."
        );
    }

    // En regimen normal casi todo deberia omitirse. Que se reescriba SIEMPRE
    // significa que servidor y cliente no producen lo mismo.
    // Escribir algo es NORMAL: cada edicion cambia a unos cuantos. Lo que
    // delata una divergencia es reescribir una porcion grande una y otra vez,
    // sin bajar. Justo despues de un despliegue tambien pasa, pero baja.
    const ultimas = entradas.slice(0, 4);
    const porcion = (item) => {
        const built = Number(item.built) || 0;
        return built ? Number(item.written) / built : 0;
    };
    const reescribeMucho = ultimas.length >= 3 &&
        ultimas.every(item => porcion(item) > 0.25);

    if (reescribeMucho) {
        marcar(
            avisos,
            "Las ultimas corridas reescriben mas de un cuarto de los documentos " +
            "cada vez. Si viene bajando es la convergencia tras un despliegue; " +
            "si se queda plano, servidor y cliente no producen lo mismo y hay " +
            "que verlo ANTES de quitar el publicador del cliente."
        );
    } else if (!fallidas && !sinPerfil) {
        console.log("   sano  OK");
    }
}

// ───────── C. Enlazados sin proyección ─────────

async function revisarProyecciones() {
    console.log("\nC. Trabajadores enlazados sin proyeccion");

    const raiz =
        `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
        "/databases/(default)/documents";
    const workspaces = await api(`${raiz}/workspaces?pageSize=300&mask.fieldPaths=name`);
    let totalFaltantes = 0;

    for (const doc of (workspaces.documents || [])) {
        const id = doc.name.split("/").pop();
        const nombre = doc.fields?.name?.stringValue || id;
        const [links, data] = await Promise.all([
            api(`${raiz}/workspaces/${id}/workerLinks?pageSize=300&mask.fieldPaths=profileName`),
            api(`${raiz}/workspaces/${id}/workerAppData?pageSize=300&mask.fieldPaths=uid`)
        ]);
        const enlazados = (links.documents || []).length;

        if (!enlazados) continue;

        const conDatos = new Set(
            (data.documents || []).map(item => item.name.split("/").pop())
        );
        const faltan = (links.documents || [])
            .map(item => item.name.split("/").pop())
            .filter(uid => !conDatos.has(uid));

        if (faltan.length) {
            totalFaltantes += faltan.length;
            console.log(`   ${nombre}: faltan ${faltan.length} de ${enlazados}`);
        }
    }

    if (totalFaltantes) {
        marcar(
            avisos,
            `${totalFaltantes} enlazados sin proyeccion. El backfill diario los ` +
            "recoge; si siguen manana, hay que mirarlo."
        );
    } else {
        console.log("   ninguno  OK");
    }
}

async function main() {
    console.log(`Revision de ${PROJECT_ID}  ${new Date().toISOString()}\n`);

    for (const paso of [revisarReglas, revisarPublicacion, revisarProyecciones]) {
        try {
            await paso();
        } catch (error) {
            marcar(problemas, `${paso.name} no se pudo comprobar: ${error.message}`);
        }
    }

    console.log("\n" + "─".repeat(60));

    if (!problemas.length && !avisos.length) {
        console.log("TODO EN ORDEN.");
        return;
    }

    problemas.forEach(texto => console.log(`\nPROBLEMA  ${texto}`));
    avisos.forEach(texto => console.log(`\nAVISO     ${texto}`));

    if (problemas.length) process.exitCode = 1;
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
