// Honorarios con MULTIPLES contratos: cada uno con su vigencia, valor hora y tope
// mensual. La rotativa solo aplica dentro de un contrato; el valor hora y el tope
// del resumen salen del contrato vigente por fecha; y los campos antiguos del
// perfil se migran a un contrato de solo lectura.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    removeItem(k) { this.values.delete(k); }
    setItem(k, v) { this.values.set(k, String(v)); }
}

globalThis.localStorage = new MemoryStorage();

const { setJSON } = await import("../js/persistence.js");
const contracts = await import("../js/contracts.js");
const { getValorHora } = await import("../js/storage.js");
const { getTurnoBase } = await import("../js/turnEngine.js");
const { getHonorariaMonthlySummary } = await import("../js/honoraria.js");
const { TURNO } = await import("../js/constants.js");

const N = "Hono";

function seedTwoContracts() {
    localStorage.clear();
    setJSON("profiles", [
        { name: N, contractType: "Honorarios", estamento: "Profesional" }
    ]);
    setJSON("rotativa_" + N, {
        type: "diurno", start: "2026-07-01", firstTurn: "larga"
    });
    setJSON("honorariaContracts_" + N, [
        { id: "c1", start: "2026-07-01", end: "2026-07-31", hourlyRate: 5000, maxHours: 20, limitPeriod: "weekly" },
        { id: "c2", start: "2026-08-01", end: "2026-08-31", hourlyRate: 8000, maxMonthlyHours: 44 }
    ]);
}

beforeEach(() => localStorage.clear());

test("resuelve el contrato y el valor hora por fecha", () => {
    seedTwoContracts();

    assert.equal(contracts.isHonorariaProfile(N), true);
    assert.equal(contracts.getHonorariaContractForDate(N, "2026-6-10").hourlyRate, 5000);
    assert.equal(contracts.getHonorariaContractForDate(N, "2026-7-10").hourlyRate, 8000);
    assert.equal(contracts.hasHonorariaContractForDate(N, "2026-8-10"), false);

    // Julio (mes 6) y agosto (mes 7)
    assert.equal(getValorHora(N, new Date(2026, 6, 10)), 5000);
    assert.equal(getValorHora(N, new Date(2026, 7, 10)), 8000);
});

test("los turnos de honorarios solo se ven dentro de un contrato vigente", () => {
    seedTwoContracts();
    // En honorarios los turnos van EXPLICITOS (no se computan): se guarda uno
    // dentro del contrato de julio y otro en septiembre (sin contrato).
    setJSON("baseData_" + N, {
        "2026-6-6": TURNO.DIURNO,   // 6 de julio, dentro del contrato
        "2026-8-7": TURNO.DIURNO    // 7 de septiembre, sin contrato
    });

    // Dentro del contrato se ve el turno guardado.
    assert.equal(getTurnoBase(N, "2026-6-6"), TURNO.DIURNO);
    // Fuera de todo contrato queda libre aunque haya turno guardado (enmascarado).
    assert.equal(getTurnoBase(N, "2026-8-7"), TURNO.LIBRE);
});

test("un cambio futuro de Honorarios a Contrata respeta la fecha efectiva", () => {
    localStorage.clear();
    setJSON("profiles", [
        {
            name: N,
            contractType: "Contrata",
            estamento: "Profesional",
            grade: "12"
        }
    ]);
    setJSON("gradeHistory_" + N, [
        {
            start: "1900-01-01",
            contractType: "Honorarios",
            estamento: "Profesional",
            grade: ""
        },
        {
            start: "2026-08-01",
            contractType: "Contrata",
            estamento: "Profesional",
            grade: "12"
        }
    ]);
    setJSON("contractHistory_" + N, [
        {
            id: "contract-change",
            createdAt: "2026-07-20T12:00:00.000Z",
            effectiveDate: "2026-08-01",
            summary: "Cambio de datos contractuales",
            changes: [
                {
                    field: "contractType",
                    label: "Tipo de contrato",
                    from: "Honorarios",
                    to: "Contrata",
                    effectiveDate: "2026-08-01"
                }
            ]
        }
    ]);
    setJSON("rotativa_" + N, {
        type: "diurno", start: "2026-08-01", firstTurn: "larga"
    });
    setJSON("honorariaContracts_" + N, [
        { id: "c1", start: "2026-07-01", end: "2026-07-31", hourlyRate: 5000, maxWeeklyHours: 20 }
    ]);
    setJSON("baseData_" + N, {
        "2026-6-6": TURNO.DIURNO
    });

    assert.equal(contracts.isHonorariaProfile(N, "2026-6-10"), true);
    assert.equal(contracts.isHonorariaProfile(N, "2026-7-3"), false);
    assert.equal(getTurnoBase(N, "2026-6-6"), TURNO.DIURNO);
    assert.equal(getTurnoBase(N, "2026-7-3"), TURNO.DIURNO);
    assert.equal(getValorHora(N, new Date(2026, 6, 10)), 5000);
    assert.notEqual(getValorHora(N, new Date(2026, 7, 3)), 5000);
    assert.ok(getHonorariaMonthlySummary(N, 2026, 6, {}));
    assert.equal(getHonorariaMonthlySummary(N, 2026, 7, {}), null);
});

test("el tope mensual del resumen sale del contrato vigente", () => {
    seedTwoContracts();

    const allowed = summary => Object.values(summary.periods)[0]?.allowedHours;

    assert.equal(allowed(getHonorariaMonthlySummary(N, 2026, 6, {})), 20);
    assert.equal(allowed(getHonorariaMonthlySummary(N, 2026, 7, {})), 44);
});

test("migra el contrato legado (campos del perfil) a la lista", () => {
    localStorage.clear();
    setJSON("profiles", [{
        name: N, contractType: "Honorarios", estamento: "Profesional",
        honorariaStart: "2026-07-01", honorariaEnd: "2026-07-31",
        honorariaHourlyRate: 6000, honorariaMaxMonthlyHours: 30
    }]);

    const list = contracts.getHonorariaContractsForProfile(N);

    assert.equal(list.length, 1);
    assert.equal(list[0].hourlyRate, 6000);
    assert.equal(list[0].maxMonthlyHours, 30);
    assert.equal(list[0].maxWeeklyHours, 0);
    assert.equal(list[0].limitPeriod, "monthly");
    assert.equal(getValorHora(N, new Date(2026, 6, 10)), 6000);
});

test("agregar un contrato materializa el legado y no lo pierde", () => {
    localStorage.clear();
    setJSON("profiles", [{
        name: N, contractType: "Honorarios", estamento: "Profesional",
        honorariaStart: "2026-07-01", honorariaEnd: "2026-07-31",
        honorariaHourlyRate: 6000, honorariaMaxMonthlyHours: 30
    }]);

    contracts.addHonorariaContract(N, {
        start: "2026-09-01", end: "2026-09-30", hourlyRate: 9000, maxWeeklyHours: 44
    });

    const list = contracts.getHonorariaContractsForProfile(N);

    assert.equal(list.length, 2);
    assert.deepEqual(
        list.map(c => c.hourlyRate).sort((a, b) => a - b),
        [6000, 9000]
    );
});

test("un contrato antiguo marcado semanal se calcula como mensual", () => {
    function summaryFor(period) {
        localStorage.clear();
        setJSON("profiles", [
            { name: N, contractType: "Honorarios", estamento: "Profesional" }
        ]);
        setJSON("honorariaContracts_" + N, [
            { id: "c1", start: "2026-07-01", end: "2026-07-31", hourlyRate: 3000, maxHours: 40, limitPeriod: period }
        ]);
        setJSON("rotativa_" + N, { type: "libre", start: "", firstTurn: "larga" });
        // 8 dias diurnos (~35 h por semana en 2 semanas, ~70 en el mes).
        const data = {};
        for (const d of [6, 7, 8, 9, 13, 14, 15, 16]) {
            data[`2026-6-${d}`] = TURNO.DIURNO;
        }
        setJSON("data_" + N, data);

        return getHonorariaMonthlySummary(N, 2026, 6, {});
    }

    const legacyWeekly = summaryFor("weekly");
    const monthly = summaryFor("monthly");

    assert.equal(legacyWeekly.contract.limitPeriod, "monthly");
    assert.ok(legacyWeekly.overtimeHours > 0);
    assert.equal(legacyWeekly.overtimeHours, monthly.overtimeHours);
});

test("los turnos guardados se ven aunque la rotativa quede desalineada", () => {
    localStorage.clear();
    setJSON("profiles", [
        { name: N, contractType: "Honorarios", estamento: "Profesional" }
    ]);
    // Contrato 01-17/07 con turnos guardados, y una rotativa con start desalineado
    // (30/07, p.ej. de un contrato eliminado): los turnos guardados igual se ven
    // porque no dependen del ancla de la rotativa.
    setJSON("honorariaContracts_" + N, [
        { id: "c1", start: "2026-07-01", end: "2026-07-17", hourlyRate: 3000, maxWeeklyHours: 44 }
    ]);
    setJSON("rotativa_" + N, {
        type: "4turno", start: "2026-07-30", firstTurn: "larga"
    });
    setJSON("baseData_" + N, {
        "2026-6-5": TURNO.LARGA,
        "2026-6-6": TURNO.NOCHE
    });

    assert.equal(getTurnoBase(N, "2026-6-5"), TURNO.LARGA);
    assert.equal(getTurnoBase(N, "2026-6-6"), TURNO.NOCHE);
    // Fuera del contrato sigue libre.
    assert.equal(getTurnoBase(N, "2026-6-18"), TURNO.LIBRE);
});

test("perfil nuevo (aun sin guardar) puede agregar y conservar contratos", () => {
    localStorage.clear();
    // El perfil todavia NO esta en getProfiles (modo crear): los contratos se
    // guardan y leen por nombre igual.
    setJSON("profiles", []);

    assert.equal(contracts.getHonorariaContractsForProfile(N).length, 0);

    contracts.addHonorariaContract(N, {
        start: "2026-07-01", end: "2026-07-31", hourlyRate: 5000, maxWeeklyHours: 20
    });
    assert.deepEqual(
        contracts.getHonorariaContractsForProfile(N).map(c => c.hourlyRate),
        [5000]
    );

    contracts.addHonorariaContract(N, {
        start: "2026-08-01", end: "2026-08-31", hourlyRate: 8000, maxWeeklyHours: 44
    });
    assert.deepEqual(
        contracts.getHonorariaContractsForProfile(N)
            .map(c => c.hourlyRate)
            .sort((a, b) => a - b),
        [5000, 8000]
    );
});

test("borrar todos los contratos no re-migra el legado", () => {
    localStorage.clear();
    setJSON("profiles", [{
        name: N, contractType: "Honorarios", estamento: "Profesional",
        honorariaStart: "2026-07-01", honorariaEnd: "2026-07-31",
        honorariaHourlyRate: 6000, honorariaMaxMonthlyHours: 30
    }]);

    // Materializa y luego borra el unico contrato.
    const [legacy] = contracts.getHonorariaContractsForProfile(N);
    contracts.addHonorariaContract(N, {
        start: "2026-09-01", end: "2026-09-30", hourlyRate: 9000, maxWeeklyHours: 44
    });
    let list = contracts.getHonorariaContractsForProfile(N);
    list.forEach(c => contracts.removeHonorariaContract(N, c.id));

    assert.equal(contracts.getHonorariaContractsForProfile(N).length, 0);
    assert.equal(legacy.hourlyRate, 6000);
});

test("extender un contrato conserva su tarifa y tope, solo cambia fechas", () => {
    localStorage.clear();
    setJSON("profiles", [
        { name: N, contractType: "Honorarios", estamento: "Profesional" }
    ]);
    setJSON("honorariaContracts_" + N, [
        { id: "c1", start: "2026-07-01", end: "2026-07-15", hourlyRate: 5000, maxHours: 20, limitPeriod: "monthly" }
    ]);

    const updated = contracts.updateHonorariaContract(N, "c1", {
        start: "2026-07-01",
        end: "2026-07-31"
    });

    assert.equal(updated.end, "2026-07-31");
    assert.equal(updated.hourlyRate, 5000);
    assert.equal(updated.maxHours, 20);
    assert.equal(updated.limitPeriod, "monthly");

    const [stored] = contracts.getHonorariaContractsForProfile(N);
    assert.equal(stored.end, "2026-07-31");
    assert.equal(stored.hourlyRate, 5000);
    assert.equal(stored.maxHours, 20);
});

test("editar un contrato actualiza fechas, tarifa y tope mensual", () => {
    localStorage.clear();
    setJSON("profiles", [
        { name: N, contractType: "Honorarios", estamento: "Profesional" }
    ]);
    setJSON("honorariaContracts_" + N, [
        { id: "c1", start: "2026-07-01", end: "2026-07-15", hourlyRate: 5000, maxHours: 20, limitPeriod: "weekly" }
    ]);

    const updated = contracts.updateHonorariaContract(N, "c1", {
        start: "2026-07-05",
        end: "2026-07-20",
        hourlyRate: 7000,
        maxHours: 44,
        limitPeriod: "monthly"
    });

    assert.equal(updated.start, "2026-07-05");
    assert.equal(updated.end, "2026-07-20");
    assert.equal(updated.hourlyRate, 7000);
    assert.equal(updated.maxHours, 44);
    assert.equal(updated.limitPeriod, "monthly");

    const [stored] = contracts.getHonorariaContractsForProfile(N);
    assert.equal(stored.hourlyRate, 7000);
    assert.equal(stored.limitPeriod, "monthly");
});

test("extender el contrato legado lo materializa con un id real", () => {
    localStorage.clear();
    setJSON("profiles", [{
        name: N, contractType: "Honorarios", estamento: "Profesional",
        honorariaStart: "2026-07-01", honorariaEnd: "2026-07-15",
        honorariaHourlyRate: 6000, honorariaMaxMonthlyHours: 30
    }]);

    const updated = contracts.updateHonorariaContract(N, "legacy", {
        end: "2026-07-31"
    });

    assert.ok(updated);
    assert.notEqual(updated.id, "legacy");
    assert.equal(updated.hourlyRate, 6000);
    assert.equal(updated.end, "2026-07-31");

    const list = contracts.getHonorariaContractsForProfile(N);
    assert.equal(list.length, 1);
    assert.notEqual(list[0].id, "legacy");
    assert.equal(list[0].end, "2026-07-31");
});

test("crear un contrato distinto se recorta para no solaparse", () => {
    const existing = [{ start: "2026-07-10", end: "2026-07-20" }];

    // Solapa por el final -> termina el dia antes del contrato existente.
    assert.deepEqual(
        contracts.clampContractRange("2026-07-01", "2026-07-15", existing),
        { start: "2026-07-01", end: "2026-07-09" }
    );

    // Solapa por el inicio -> empieza el dia despues del contrato existente.
    assert.deepEqual(
        contracts.clampContractRange("2026-07-15", "2026-07-31", existing),
        { start: "2026-07-21", end: "2026-07-31" }
    );
});
