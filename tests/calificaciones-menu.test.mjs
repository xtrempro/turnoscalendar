import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
    return readFile(new URL(path, import.meta.url), "utf8");
}

test("Calificaciones queda enganchado como menu supervisor", async () => {
    const [
        html,
        main,
        navigation,
        permissions,
        modules,
        functionsIndex,
        firestoreRules,
        css
    ] = await Promise.all([
        read("../index.html"),
        read("../js/main.js"),
        read("../js/navigation.js"),
        read("../js/workspacePermissions.js"),
        read("../js/firebaseStateModules.js"),
        read("../functions/index.js"),
        read("../firebase.rules"),
        read("../styles.css")
    ]);

    assert.match(html, /data-target="qualificationsPanel"[\s\S]{0,900}Calificaciones/);
    assert.match(html, /<section id="qualificationsPanel" class="panel qualifications-panel"><\/section>/);
    assert.match(navigation, /targetId === "qualificationsPanel"[\s\S]{0,90}return "qualifications";/);
    assert.match(main, /renderQualificationsPanel/);
    assert.match(main, /nextView === "qualifications"[\s\S]{0,100}renderQualificationsPanel\(\)/);
    assert.match(main, /initQualificationsPanel\(\)/);
    assert.match(permissions, /key: "qualifications"[\s\S]{0,100}target: "qualificationsPanel"/);
    assert.match(modules, /qualifications:\s*\{\s*permission:\s*"qualifications"\s*\}/);
    assert.match(modules, /\["qualifications",\s*"qualifications"\]/);
    assert.match(functionsIndex, /"qualifications"/);
    assert.match(firestoreRules, /moduleId == "qualifications" && canViewMenu\(workspaceId, "qualifications"\)/);
    assert.match(firestoreRules, /moduleId == "qualifications" && canEditMenu\(workspaceId, "qualifications"\)/);
    assert.match(css, /body:not\(\[data-active-view="qualifications"\]\) #qualificationsPanel/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="profileSection"\]\s*\{[\s\S]{0,80}order:\s*10/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="qualificationsPanel"\]\s*\{[\s\S]{0,80}order:\s*11/);
    assert.match(css, /\.actionbar \.nav-tile\[data-target="calendarPanel"\]\s*\{[\s\S]{0,80}order:\s*3/);
    assert.match(css, /\.qual-subfactor/);
});

test("Calificaciones usa tres periodos cuatrimestrales del ciclo septiembre-agosto", async () => {
    const {
        evaluationCycleStartYear,
        isISODateInPeriod,
        qualificationPeriods
    } = await import("../js/qualifications.js");
    const periods = qualificationPeriods(2026);

    assert.equal(evaluationCycleStartYear(new Date(2026, 8, 7)), 2026);
    assert.equal(evaluationCycleStartYear(new Date(2027, 7, 31)), 2026);
    assert.deepEqual(
        periods.map(period => [
            period.id,
            period.startISO,
            period.endISO
        ]),
        [
            ["sep-dec", "2026-09-01", "2026-12-31"],
            ["jan-apr", "2027-01-01", "2027-04-30"],
            ["may-aug", "2027-05-01", "2027-08-31"]
        ]
    );
    assert.equal(periods.length, 3);
    assert.equal(isISODateInPeriod("2026-12-31", periods[0]), true);
    assert.equal(isISODateInPeriod("2027-01-01", periods[0]), false);
});

test("Calificaciones calcula puntaje y lista con escala 1-10", async () => {
    const {
        QUALIFICATION_FACTORS,
        normalizeQualificationState,
        qualificationCoefficientGroup,
        qualificationList,
        qualificationPoints,
        qualificationRecordStatus
    } = await import("../js/qualifications.js");
    const recordWithScore = score => ({
        factors: Object.fromEntries(
            QUALIFICATION_FACTORS.map(factor => [
                factor.key,
                {
                    subfactors: Object.fromEntries(
                        factor.subfactors.map(subfactor => [
                            subfactor.key,
                            { score }
                        ])
                    )
                }
            ])
        )
    });
    const state = normalizeQualificationState({
        records: {
            "2026:sep-dec:worker-1": {
                profileKey: "worker-1",
                periodId: "sep-dec",
                cycleStartYear: 2026,
                factors: {
                    rendimiento: {
                        subfactors: {
                            cumplimiento_labor: { score: "" },
                            calidad_labor: { score: 11 }
                        }
                    }
                }
            }
        }
    });

    assert.equal(QUALIFICATION_FACTORS.length, 3);
    assert.deepEqual(
        QUALIFICATION_FACTORS.map(factor => factor.subfactors.length),
        [2, 2, 2]
    );
    assert.equal(
        state.records["2026:sep-dec:worker-1"]
            .factors.rendimiento.subfactors.cumplimiento_labor.score,
        ""
    );
    assert.equal(
        state.records["2026:sep-dec:worker-1"]
            .factors.rendimiento.subfactors.calidad_labor.score,
        10
    );
    assert.equal(qualificationPoints(recordWithScore(8), { estamento: "Tecnico" }), 80);
    assert.equal(qualificationList(""), null);
    assert.deepEqual(qualificationList(80), { number: 2, label: "Buena" });
    assert.equal(qualificationPoints(recordWithScore(9), { estamento: "Profesional" }), 90);
    assert.deepEqual(qualificationList(90), { number: 1, label: "Distincion" });
    assert.equal(
        qualificationCoefficientGroup({ estamento: "Auxiliar" }),
        "administrativos_auxiliares"
    );
    assert.equal(qualificationRecordStatus(null), "pending");
    assert.equal(qualificationRecordStatus({ status: "draft" }), "draft");

    // El cierre ya no lo da la aplicacion sino el PAPEL: se imprime, lo firman
    // las dos partes a mano y vuelve escaneado. Un registro con `evaluatedAt`
    // -o con el estado viejo `evaluated`- se lee ahora como impreso a la
    // espera de firma, y solo el escaneado lo deja archivado.
    assert.equal(
        qualificationRecordStatus({
            status: "draft",
            evaluatedAt: "2026-12-31T12:00:00.000Z"
        }),
        "printed"
    );
    assert.equal(
        qualificationRecordStatus({ status: "evaluated" }),
        "printed"
    );
    assert.equal(
        qualificationRecordStatus({
            status: "printed",
            scan: { id: "s1", name: "firmado.pdf", storagePath: "x/y.pdf" }
        }),
        "archived"
    );
});

test("Calificaciones se activa por defecto solo para admins heredados completos", async () => {
    const { normalizeMenuPermissions } =
        await import("../js/workspacePermissions.js");
    const legacyFullAdmin = {
        turnos: { view: true, edit: true },
        weekly: { view: true, edit: true },
        tasks: { view: true, edit: true },
        kanban: { view: true, edit: true },
        agenda: { view: true, edit: true },
        profile: { view: true, edit: true },
        clockmarks: { view: true, edit: true },
        requests: { view: true, edit: true },
        memos: { view: true, edit: true },
        swap: { view: true, edit: true },
        hours: { view: true, edit: true },
        reports: { view: true, edit: true },
        dashboard: { view: true, edit: true },
        log: { view: true, edit: true }
    };

    const legacy = normalizeMenuPermissions({
        informations: { view: true, edit: true }
    });
    const fullLegacy = normalizeMenuPermissions(legacyFullAdmin);
    const explicitOn = normalizeMenuPermissions({
        qualifications: { view: true, edit: true }
    });
    const explicitReadOnly = normalizeMenuPermissions({
        qualifications: { view: true, edit: false }
    });

    assert.deepEqual(legacy.qualifications, { view: false, edit: false });
    assert.deepEqual(fullLegacy.qualifications, { view: true, edit: true });
    assert.deepEqual(explicitOn.qualifications, { view: true, edit: true });
    assert.deepEqual(explicitReadOnly.qualifications, {
        view: true,
        edit: false
    });
});
