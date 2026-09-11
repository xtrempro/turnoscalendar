import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

const noopEl = {
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    click() {}, remove() {}, dataset: {}
};

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
    location: { hostname: "localhost" }
};
globalThis.CustomEvent = class {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    body: noopEl, documentElement: noopEl,
    createElement: () => ({ ...noopEl }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};

const insights = await import("../js/medicalEquipmentInsights.js");
const print = await import("../js/medicalEquipmentPrint.js");
const { setJSON } = await import("../js/persistence.js");
const {
    MEDICAL_EQUIPMENT_KEY,
    medicalEquipmentOutagesForRange,
    normalizeMedicalEquipmentContract,
    normalizeMedicalEquipmentItem
} = await import("../js/medicalEquipment.js");

const TODAY = "2026-09-10";
const NOW = "2026-09-10T12:00";

function equipo(extra = {}) {
    return normalizeMedicalEquipmentItem({
        id: "osteo",
        name: "OSTEO C 90",
        code: "712034",
        status: "operational",
        ionizing: true,
        installedAt: "2021-03-15",
        maintenanceFrequencyDays: 181,
        nextMaintenanceAt: "2026-09-22",
        taskIds: ["t_rayos1"],
        ...extra
    });
}

function reporte(extra = {}) {
    return {
        id: "r1",
        equipmentId: "osteo",
        title: "Detector no se conecta",
        detail: "Pierde la conexión",
        severity: "high",
        status: "open",
        date: "2026-09-04",
        createdAt: "2026-09-04T12:12:00.000Z",
        reportedByName: "Camila Rojas",
        attachments: [],
        ...extra
    };
}

function foto(prefix, type = "image/jpeg") {
    return { id: `foto_${prefix}`, name: `${prefix}.jpg`, type, downloadURL: `https://storage.example/${prefix}.jpg` };
}

test("la mantencion sin termino esta en curso y la futura, programada", () => {
    assert.equal(insights.maintenanceState({ startAt: "2026-09-08T08:00", endAt: "" }, NOW), "ongoing");
    assert.equal(insights.maintenanceState({ startAt: "2026-09-22T08:00", endAt: "2026-09-22T12:00" }, NOW), "scheduled");
    assert.equal(insights.maintenanceState({ startAt: "2026-03-20T08:00", endAt: "2026-03-20T12:00" }, NOW), "done");
    assert.equal(insights.maintenanceState({ date: "2026-10-01" }, NOW), "scheduled");
    assert.equal(insights.maintenanceHours({ startAt: "2026-09-08T08:00", endAt: "" }, NOW), 52);
});

test("la disponibilidad se trunca: 99,97 % no se lee como 100 %", () => {
    assert.equal(insights.formatPercent(99.97), "99,9 %");
    assert.equal(insights.formatDuration(30), "30 h");
    assert.equal(insights.formatDuration(72), "3 d");
});

test("indicadores de 12 meses: horas fuera, reparacion, falla recurrente", () => {
    const equipment = equipo({
        maintenances: [
            { id: "m1", type: "corrective", date: "2026-06-13", startAt: "2026-06-12T18:00", endAt: "2026-06-13T14:00", resolvesFailureIds: ["r2"], attachments: [{ id: "a", name: "inf.pdf", downloadURL: "x" }] },
            { id: "m2", type: "preventive", date: "2026-03-20", startAt: "2026-03-20T08:00", endAt: "2026-03-20T12:00", attachments: [{ id: "b", name: "pm.pdf", downloadURL: "x" }] },
            { id: "m3", type: "preventive", date: "2025-03-20", startAt: "2025-03-20T08:00", endAt: "2025-03-20T12:00" }
        ]
    });
    const reports = [
        reporte(),
        reporte({ id: "r2", date: "2026-06-12", createdAt: new Date(2026, 5, 12, 8, 0).toISOString(), status: "resolved" }),
        reporte({ id: "r3", date: "2025-12-18", createdAt: new Date(2025, 11, 18, 22, 0).toISOString(), status: "resolved", resolvedAt: new Date(2025, 11, 21, 22, 0).toISOString() })
    ];
    const failures = insights.buildFailures(equipment, reports, NOW);
    const metrics = insights.equipmentMetrics(equipment, failures, null, { today: TODAY, now: NOW });

    assert.equal(metrics.downtime, 24);
    assert.equal(metrics.failures12, 3);
    assert.equal(metrics.previous12, 0);
    assert.equal(metrics.recurrent.length, 1);
    assert.equal(metrics.recurrent[0].count, 3);
    // r2: 08:00 -> 14:00 del dia siguiente = 30 h; r3: 72 h.
    assert.equal(metrics.mttr, 51);
    assert.equal(metrics.responseAverage, 10);
    assert.equal(metrics.preventiveDue, 2);
    assert.equal(metrics.preventiveDone, 1);
    assert.equal(failures.find(item => item.id === "r2").maintenance.id, "m1");
});

test("los avisos se ordenan por urgencia y el contrato por vencer es uno solo", () => {
    const contract = normalizeMedicalEquipmentContract({ id: "philips", provider: "Philips", endDate: "2026-10-31" });
    const osteo = equipo({ contractId: "philips", nextMaintenanceAt: "2026-09-01" });
    const movil = equipo({ id: "movil", name: "Portátil", contractId: "philips", nextMaintenanceAt: "2026-12-02" });
    const all = [osteo, movil];
    const snapshots = all.map(item => insights.equipmentSnapshot(item, {
        reports: [reporte({ equipmentId: item.id, id: `r_${item.id}` })],
        contracts: [contract],
        allEquipment: all,
        taskTitles: ["RAYOS 1"],
        today: TODAY,
        now: NOW
    }));
    const osteoAlerts = snapshots[0].alerts;

    assert.equal(osteoAlerts[0].level, 3);
    assert.equal(osteoAlerts[0].short, "Preventiva vencida");
    assert.ok(osteoAlerts.some(alert => alert.key === "contract:philips" && alert.level === 1));
    assert.equal(
        insights.unitQueue(snapshots).filter(alert => alert.key === "contract:philips").length,
        1
    );
    assert.equal(snapshots[0].contractEquipment.length, 2);
});

test("sin contrato ni garantia vigente es un aviso de atencion", () => {
    const snapshot = insights.equipmentSnapshot(
        equipo({ warrantyUntil: "2026-05-10", ionizing: false }),
        { today: TODAY, now: NOW }
    );
    const alert = snapshot.alerts.find(item => item.short === "Sin contrato");

    assert.equal(alert.level, 2);
    assert.match(alert.text, /10-05-2026/);
});

test("la carpeta pide proteccion radiologica solo si el equipo emite radiacion", () => {
    const docs = [
        { id: "d1", name: "seremi.pdf", downloadURL: "x", docType: "seremi_authorization", addedAt: "2023-01-14T12:00:00Z", expiresAt: "2026-10-15" },
        { id: "d2", name: "cc.pdf", downloadURL: "x", docType: "quality_control", addedAt: "2025-08-20T12:00:00Z", expiresAt: "2026-08-20" }
    ];
    const rx = insights.documentChecklist(equipo({ documents: docs }), TODAY);
    const noRx = insights.documentChecklist(equipo({ ionizing: false, documents: docs }), TODAY);

    assert.equal(rx.summary.total, 10);
    assert.equal(rx.summary.expired.length, 1);
    assert.equal(rx.summary.expiring.length, 1);
    assert.equal(noRx.summary.total, 7);
    assert.equal(noRx.others.length, 2);
    assert.equal(
        insights.documentChecklist(equipo({ documentsNotApplicable: ["warranty"] }), TODAY).summary.total,
        9
    );
});

test("un equipo fuera de servicio deja sus tareas inactivas hasta el fin del rango", () => {
    localStorage.clear();
    setJSON(MEDICAL_EQUIPMENT_KEY, [
        { id: "scan", name: "Escáner", status: "maintenance", downSince: "2026-09-08", taskIds: ["t_scan"] },
        {
            id: "rx",
            name: "Rayos",
            taskIds: ["t_rx"],
            maintenances: [{ id: "m", type: "corrective", date: "2020-01-01", startAt: "2020-01-01T08:00", endAt: "" }]
        }
    ]);

    const outages = medicalEquipmentOutagesForRange("2026-09-07", "2026-09-13");
    const down = outages.find(item => item.equipmentId === "scan");
    const ongoing = outages.find(item => item.equipmentId === "rx");

    assert.equal(down.type, "outOfService");
    assert.equal(down.startAt, "2026-09-08");
    assert.equal(down.endAt, "2026-09-13");
    assert.deepEqual(down.taskIds, ["t_scan"]);
    assert.equal(ongoing.endAt, "2026-09-13");
});

test("los campos nuevos del equipo y del contrato sobreviven la normalizacion", () => {
    const item = normalizeMedicalEquipmentItem({
        name: "Arco en C",
        criticality: "critical",
        ionizing: false,
        usefulLifeYears: 10,
        warrantyUntil: "2027-01-01",
        documents: [{ id: "d", name: "manual.pdf", downloadURL: "x", docType: "user_manual", expiresAt: "2030-01-01" }],
        maintenances: [{ id: "m", resolvesFailureIds: ["f1"], confirmed: true }],
        errors: [{ id: "e", title: "Falla", note: "Caso 123", outOfService: true }]
    });
    const contract = normalizeMedicalEquipmentContract({
        id: "c1",
        provider: "Philips",
        responseHours: "24",
        guaranteedAvailability: "97.5",
        previous: [{ provider: "Garantía", startDate: "2021-01-01", endDate: "2023-01-01" }]
    });

    assert.equal(item.criticality, "critical");
    assert.equal(item.ionizing, false);
    assert.equal(item.documents[0].docType, "user_manual");
    assert.equal(item.documents[0].expiresAt, "2030-01-01");
    assert.deepEqual(item.maintenances[0].resolvesFailureIds, ["f1"]);
    assert.equal(item.errors[0].note, "Caso 123");
    assert.equal(item.errors[0].outOfService, true);
    assert.equal(normalizeMedicalEquipmentItem({ name: "X" }).ionizing, null);
    assert.equal(contract.responseHours, 24);
    assert.equal(contract.guaranteedAvailability, 97.5);
    assert.equal(contract.previous[0].provider, "Garantía");
});

test("el historial impreso trae las fotos de los trabajadores y escapa el texto", () => {
    const equipment = equipo({ name: "OSTEO <C90>" });
    const reports = [reporte({
        detail: "Pantalla <b>negra</b>",
        attachments: [foto("pantalla"), foto("iphone", "image/heic"), { id: "pdf", name: "guia.pdf", type: "application/pdf", downloadURL: "x" }]
    })];
    const snapshot = insights.equipmentSnapshot(equipment, { reports, today: TODAY, now: NOW });
    const html = print.failureHistoryPrintHTML({
        snapshot,
        unitName: "Imagenología",
        printedBy: "Supervisora",
        printedAt: "10-09-2026 12:00",
        now: NOW,
        imageUrls: new Map([["foto_pantalla", "https://storage.example/pantalla.jpg"]])
    });

    assert.match(html, /OSTEO &lt;C90&gt;/);
    assert.match(html, /Pantalla &lt;b&gt;negra&lt;\/b&gt;/);
    assert.match(html, /<img src="https:\/\/storage\.example\/pantalla\.jpg"/);
    assert.match(html, /Camila Rojas desde la app de trabajadores/);
    assert.match(html, /Otros adjuntos \(se abren desde TurnoPlus\): iphone\.jpg · guia\.pdf/);
    assert.equal(print.isPrintableImage(foto("x", "image/heic")), false);
    assert.equal(print.isPrintableImage({ name: "foto.png", type: "" }), true);
});
