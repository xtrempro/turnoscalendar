// Unidad de practica: los trabajadores ficticios contestan las solicitudes de
// cobertura como si fueran personas (js/practiceResponder.js).

import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
    constructor() { this.values = new Map(); }
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) { this.values.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, location: { hostname: "localhost" } };
globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };

const { practiceResponsePlan, duePracticeResponses } = await import("../js/practiceResponder.js");
const { practiceProfiles, PRACTICE_SEED_VERSION } = await import("../js/practiceSeed.js");
const { upgradePracticeUnit } = await import("../js/practiceUnit.js");

const created = Date.parse("2026-10-05T12:00:00Z");
const request = (id, overrides = {}) => ({
    id,
    status: "pending",
    channel: "app",
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(created + 60 * 60 * 1000).toISOString(),
    ...overrides
});
const many = Array.from({ length: 400 }, (_, index) => request(`req_${index}`));

test("unos aceptan, otros rechazan y algunos no contestan, en proporciones de personas", () => {
    const plans = many.map(practiceResponsePlan);
    const count = outcome => plans.filter(plan => plan.outcome === outcome).length;

    assert.ok(count("accepted") > 160 && count("accepted") < 240, `aceptan ${count("accepted")}`);
    assert.ok(count("rejected") > 100 && count("rejected") < 180, `rechazan ${count("rejected")}`);
    assert.ok(count("none") > 30 && count("none") < 100, `no contestan ${count("none")}`);
});

test("unos contestan a los segundos y otros a los minutos", () => {
    const delays = many
        .map(practiceResponsePlan)
        .filter(plan => plan.outcome !== "none")
        .map(plan => plan.respondAt - created);

    assert.ok(delays.every(delay => delay >= 4000 && delay <= 12 * 60 * 1000));
    assert.ok(delays.filter(delay => delay < 60 * 1000).length > 60, "rapidos");
    assert.ok(delays.filter(delay => delay > 5 * 60 * 1000).length > 20, "lentos");
});

test("la misma solicitud recibe siempre la misma respuesta", () => {
    assert.deepEqual(practiceResponsePlan(request("abc")), practiceResponsePlan(request("abc")));
});

test("nadie contesta despues del vencimiento", () => {
    const short = many.map(item => request(item.id, { expiresAt: new Date(created + 30 * 1000).toISOString() }));

    short.map(practiceResponsePlan).forEach(plan => {
        if (plan.outcome !== "none") assert.ok(plan.respondAt <= created + 10 * 1000);
    });
});

test("solo contestan las pendientes enviadas a la app, y cuando les toca", () => {
    const answering = many.find(item => practiceResponsePlan(item).outcome !== "none");
    const { respondAt } = practiceResponsePlan(answering);
    const list = [
        answering,
        request(answering.id + "w", { channel: "whatsapp" }),
        { ...answering, id: answering.id + "c", status: "canceled" }
    ];

    assert.deepEqual(duePracticeResponses(list, respondAt - 1), []);
    assert.deepEqual(duePracticeResponses(list, respondAt).map(item => item.request.id), [answering.id]);
});

test("los ficticios tienen app, menos tres (para ver el camino por WhatsApp)", () => {
    const profiles = practiceProfiles();

    assert.equal(profiles.filter(profile => !profile.appUid).length, 3);
    assert.ok(profiles.every(profile => !profile.appUid || profile.appUid.startsWith("practice-app-")));
});

test("una unidad de practica llenada con la version 1 se pone al dia sin tocar lo demas", () => {
    const store = new Map([
        ["practiceSeedVersion", "1"],
        ["profiles", JSON.stringify([
            ...practiceProfiles().map(({ appUid, ...profile }) => profile),
            { id: "propio", name: "Agregado por la persona" }
        ])]
    ]);
    const io = { read: (key, fallback) => store.get(key) ?? fallback, write: (key, value) => store.set(key, value) };

    assert.equal(upgradePracticeUnit({ id: "practice_u1", practice: true }, io), true);

    const profiles = JSON.parse(store.get("profiles"));

    assert.equal(profiles.filter(profile => profile.appUid).length, practiceProfiles().length - 3);
    assert.equal(profiles.at(-1).appUid, undefined, "lo que agrego la persona no se toca");
    assert.equal(store.get("practiceSeedVersion"), String(PRACTICE_SEED_VERSION));
    // Ya al dia, o una unidad real: no hace nada.
    assert.equal(upgradePracticeUnit({ id: "practice_u1", practice: true }, io), false);
    assert.equal(upgradePracticeUnit({ id: "C3SGdWKXzN0cWsXJFmq4" }, io), false);
});
