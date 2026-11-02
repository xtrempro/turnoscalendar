import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { annexOneGroupFor } from "../js/tensReport.js";

const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
const extract = (start, end) => main.slice(main.indexOf(start), main.indexOf(end));
const source = extract("async function deliverReport(", "async function printTensConsolidatedReport(") +
    extract("async function printCoverageAuthorizationReport(", "// Inyecta la lupa");

const workers = [
    { name: "Ana", estamento: "Profesional" },
    { name: "Beto", estamento: "Técnico" },
    { name: "Carla", estamento: "TENS" },
    { name: "Diana", estamento: "Auxiliar" },
    { name: "Elena", estamento: "Administrativo" },
    { name: "Fabio", estamento: "Profesional", noOvertime: true }
];

async function run(answers, profiles = workers) {
    const dialogs = [], prints = [], downloads = [], builds = [];
    const context = vm.createContext({
        console,
        ensureCanDownloadReports: () => true,
        getProfiles: () => profiles,
        getReplacements: () => [],
        isAnnexMonthCandidate: () => true,
        isCoverageAuthorizationCandidate: () => true,
        getActiveWorkspace: () => ({ name: "Unidad" }),
        buildCoverageAuthorizationRow: async profile => profile,
        hasCoverageAuthorizationOvertime: row => !row.noOvertime,
        annexOneGroupFor,
        formatReportPlanillaTitle: () => "PLANILLA NOVIEMBRE 2026",
        showChoice: async (message, options) => {
            dialogs.push({ message, ...options });
            return answers.shift() ?? null;
        },
        buildCoverageAuthorizationReportHTML: rows => {
            const names = rows.map(row => row.name).join(", ");
            builds.push(names);
            return names;
        },
        printReportPreviewHTML: (html, title) => prints.push({ html, title }),
        downloadReportAsWord: (html, title) => downloads.push({ html, title }),
        alert: message => { throw new Error(message); }
    });
    vm.runInContext(source, context);
    await vm.runInContext("printCoverageAuthorizationReport(new Date(2026, 10, 1))", context);
    return { dialogs, prints, downloads, builds };
}

for (const [key, expected, label] of [
    ["profesional", "Ana", "Profesional"],
    ["tecnico", "Beto, Carla", "Técnico / TENS"],
    ["auxiliar", "Diana", "Auxiliar"],
    ["administrativo", "Elena", "Administrativo"]
]) {
    test(`PDF de ${key} incluye solo su estamento`, async () => {
        const result = await run(["pdf", key]);
        assert.equal(result.dialogs.length, 2);
        assert.equal(result.dialogs[1].choices.length, 4);
        assert.deepEqual(result.builds, [expected]);
        assert.deepEqual(result.prints, [{
            html: expected,
            title: `Anexo 2 cobertura de turnos PLANILLA NOVIEMBRE 2026 - ${label}`
        }]);
        assert.equal(result.downloads.length, 0);
    });
}

test("cancelar cualquiera de los pasos no genera ni imprime documentos", async () => {
    for (const answers of [[null], ["pdf", null]]) {
        const result = await run(answers);
        assert.deepEqual(result.builds, []);
        assert.deepEqual(result.prints, []);
        assert.deepEqual(result.downloads, []);
    }
});

test("Word conserva todos los estamentos y solo pregunta el formato", async () => {
    const result = await run(["word"]);
    assert.equal(result.dialogs.length, 1);
    assert.equal(result.downloads[0].html, "Ana, Beto, Carla, Diana, Elena");
    assert.equal(result.prints.length, 0);
});

test("solo ofrece estamentos con horas y conserva perfiles sin estamento", async () => {
    const result = await run(["pdf", "sin-estamento"], [
        { name: "Ana", estamento: "Profesional", noOvertime: true },
        { name: "Beto", estamento: "" }
    ]);
    assert.equal(result.dialogs[1].choices.length, 1);
    assert.equal(result.dialogs[1].choices[0].label, "Sin estamento");
    assert.equal(result.prints[0].html, "Beto");
});
