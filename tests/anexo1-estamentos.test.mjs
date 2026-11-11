import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
    ANNEX_ONE_GROUPS, annexOneGroupFor, buildAnnexOneDocumentHTML, tensShiftTypeLabel
} from "../js/tensReport.js";

const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
const source = main.slice(
    main.indexOf("async function deliverReport("),
    main.indexOf("async function printCoverageAuthorizationReport(")
);
const workers = [
    { name: "Ana", estamento: "Profesional" },
    { name: "Beto", estamento: "Técnico" },
    { name: "Carla", estamento: "TENS" },
    { name: "Diana", estamento: "Auxiliar" },
    { name: "Elena", estamento: "Administrativo" },
    { name: "Fabio", estamento: "Profesional", noOvertime: true },
    { name: "Honorario", estamento: "Profesional", contractType: "Honorarios" }
];

async function run(answers, profiles = workers) {
    const dialogs = [], prints = [], downloads = [];
    const context = vm.createContext({
        console, ANNEX_ONE_GROUPS, annexOneGroupFor, buildAnnexOneDocumentHTML, tensShiftTypeLabel,
        ensureCanDownloadReports: () => true,
        getProfiles: () => profiles,
        isAnnexMonthCandidate: () => true,
        isHonorariaContractType: value => value === "Honorarios",
        getContractTypeAt: () => "",
        getCompensationProfileAt: () => null,
        getRotativa: () => ({ type: "diurno" }),
        getShiftAssigned: () => false,
        getReplacements: () => [],
        buildCoverageAuthorizationRow: async profile => ({ profile, returnTransfer: false }),
        coverageAuthorizationTotals: row => ({ day: row.profile.noOvertime ? 0 : 2, festive: 0 }),
        getReportSignatureConfig: () => ({ lines: ["Jefa Titular"] }),
        formatReportPlanillaTitle: () => "PLANILLA NOVIEMBRE 2026",
        showChoice: async (message, options) => {
            dialogs.push({ message, ...options });
            return answers.shift() ?? null;
        },
        printReportPreviewHTML: (html, title) => prints.push({ html, title }),
        downloadReportAsWord: (html, title) => downloads.push({ html, title }),
        alert: message => { throw new Error(message); }
    });
    vm.runInContext(source, context);
    await vm.runInContext("printTensConsolidatedReport(new Date(2026, 10, 1))", context);
    return { dialogs, prints, downloads };
}

for (const [key, names, label] of [
    ["profesional", ["Ana"], "Profesional"],
    ["tecnico", ["Beto", "Carla"], "Técnico / TENS"],
    ["auxiliar", ["Diana"], "Auxiliar"],
    ["administrativo", ["Elena"], "Administrativo"]
]) {
    test(`PDF de Anexo 1 para ${key} contiene solo su estamento y el jefe elegido`, async () => {
        const result = await run([{ value: "pdf", text: "Jefa Subrogante" }, key]);
        assert.equal(result.dialogs.length, 2);
        assert.equal(result.dialogs[1].title, "Anexo 1 por estamento");
        assert.equal(result.dialogs[1].choices.length, 4);
        assert.equal(result.prints.length, 1);
        assert.equal(result.prints[0].title, `Anexo 1 PLANILLA NOVIEMBRE 2026 - ${label}`);
        const html = result.prints[0].html;
        for (const worker of workers) {
            assert.equal(html.includes(`<td>${worker.name}</td>`), names.includes(worker.name));
        }
        assert.ok(html.includes("Jefa Subrogante"));
        assert.equal(result.downloads.length, 0);
    });
}

test("Word conserva todos los estamentos y el jefe solicitante", async () => {
    const result = await run([{ value: "word", text: "Jefa Subrogante" }]);
    assert.equal(result.dialogs.length, 1);
    assert.equal(result.prints.length, 0);
    assert.equal(result.downloads.length, 1);
    for (const worker of workers.slice(0, 5)) {
        assert.ok(result.downloads[0].html.includes(`<td>${worker.name}</td>`));
    }
    assert.ok(result.downloads[0].html.includes("Jefa Subrogante"));
});

test("cancelar formato o estamento no imprime ni descarga", async () => {
    for (const answers of [[null], [{ value: "pdf", text: "Jefa" }, null]]) {
        const result = await run(answers);
        assert.equal(result.prints.length, 0);
        assert.equal(result.downloads.length, 0);
    }
});

test("solo ofrece estamentos con horas y usa el firmante si se borra el solicitante", async () => {
    const result = await run([{ value: "pdf", text: "" }, "auxiliar"], [
        workers[3], workers[5], workers[6]
    ]);
    assert.equal(result.dialogs[1].choices.length, 1);
    assert.equal(result.dialogs[1].choices[0].value, "auxiliar");
    assert.ok(result.prints[0].html.includes("Jefa Titular"));
});
