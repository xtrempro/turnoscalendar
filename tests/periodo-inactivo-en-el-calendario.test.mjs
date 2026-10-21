// Que se ve en el calendario de alguien que estuvo inactivo.
//
// Dos cosas, pedidas el 2026-10-21:
//
//   1. MIENTRAS esta inactivo, sus turnos se seguian viendo pero sin color: la
//      casilla quedaba lavada y no se distinguia una Larga de una Noche. Lo
//      que hay que poder leer de alguien que se fue es justamente que trabajo.
//      Ahora conservan su color, oscurecido y casi gris.
//
//   2. Al REACTIVARLO, los dos tramos en que si estuvo vuelven a verse
//      normales, y el tramo en que no estuvo queda bloqueado -con las mismas
//      barras grises que los dias anteriores a un ingreso por traspaso-. Antes
//      ese tramo se veia como cualquier dia libre, y nada decia que esa
//      persona no era de la unidad.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    profileInactivePeriods,
    dayOutsideUnitReason
} from "../js/profileQueries.js";

const leer = ruta => readFile(new URL(ruta, import.meta.url), "utf8");

const main = await leer("../js/main.js");
const calendario = await leer("../js/calendar.js");
const timeline = await leer("../js/timeline.js");
const estilos = await leer("../styles.css");

function extraer(fuente, nombre) {
    const inicio = fuente.indexOf(`function ${nombre}(`);

    assert.notEqual(inicio, -1, `no encontre ${nombre}`);

    const asincrona = fuente.lastIndexOf("async function", inicio);
    const desde = asincrona === inicio - 6 ? asincrona : inicio;
    let parentesis = 0;
    let cuerpo = -1;

    for (let i = fuente.indexOf("(", inicio); i < fuente.length; i += 1) {
        if (fuente[i] === "(") parentesis += 1;
        else if (fuente[i] === ")") {
            parentesis -= 1;
            if (!parentesis) {
                cuerpo = fuente.indexOf("{", i);
                break;
            }
        }
    }

    assert.notEqual(cuerpo, -1, `no encontre el cuerpo de ${nombre}`);

    let profundidad = 0;

    for (let i = cuerpo; i < fuente.length; i += 1) {
        if (fuente[i] === "{") profundidad += 1;
        else if (fuente[i] === "}") {
            profundidad -= 1;
            if (!profundidad) return fuente.slice(desde, i + 1);
        }
    }

    throw new Error(`sin cierre: ${nombre}`);
}

const GABRIEL = {
    name: "Gabriel Flores",
    inactivePeriods: [{ from: "2026-09-16", to: "2026-10-07" }]
};

// --- Los tramos ---

test("un tramo mal formado no cuenta como tramo", () => {
    assert.deepEqual(
        profileInactivePeriods({
            inactivePeriods: [
                { from: "2026-09-16", to: "2026-10-07" },
                { from: "", to: "2026-10-07" },
                { from: "2026-10-07", to: "" },
                // Al reves: no describe ningun tramo.
                { from: "2026-10-07", to: "2026-09-16" },
                null
            ]
        }),
        [{ from: "2026-09-16", to: "2026-10-07" }]
    );
    assert.deepEqual(profileInactivePeriods(null), []);
    assert.deepEqual(profileInactivePeriods({}), []);
});

test("los dias del tramo no son de esta unidad, y se dice por que", () => {
    const motivo = dayOutsideUnitReason(GABRIEL, "2026-09-20");

    assert.match(motivo, /estuvo inactivo/);
    assert.match(motivo, /16\/09\/2026/);
    assert.match(motivo, /07\/10\/2026/);
});

test("los bordes del tramo tambien quedan bloqueados", () => {
    assert.notEqual(dayOutsideUnitReason(GABRIEL, "2026-09-16"), "");
    assert.notEqual(dayOutsideUnitReason(GABRIEL, "2026-10-07"), "");
    // Su ultimo dia trabajado y el de su regreso son suyos.
    assert.equal(dayOutsideUnitReason(GABRIEL, "2026-09-15"), "");
    assert.equal(dayOutsideUnitReason(GABRIEL, "2026-10-08"), "");
});

test("sigue avisando del ingreso por traspaso", () => {
    // El motivo viejo no se perdio al agregar el nuevo.
    const traspasado = {
        name: "Helena",
        unitEntryLocked: true,
        unitEntryDate: "2026-10-09"
    };

    assert.match(dayOutsideUnitReason(traspasado, "2026-10-01"), /traspaso/);
    assert.equal(dayOutsideUnitReason(traspasado, "2026-10-09"), "");
});

// --- Cuando se anota ---

function montarTramos() {
    return new Function(
        "profileInactivePeriods",
        "nextCalendarISO",
        "previousCalendarISO",
        "normalizeStoredStart",
        "compareISODate",
        `${extraer(main, "nextProfileInactivePeriods")}
         return nextProfileInactivePeriods;`
    )(
        profileInactivePeriods,
        iso => {
            if (!iso) return "";
            const fecha = new Date(`${iso}T00:00:00Z`);
            fecha.setUTCDate(fecha.getUTCDate() + 1);
            return fecha.toISOString().slice(0, 10);
        },
        iso => {
            if (!iso) return "";
            const fecha = new Date(`${iso}T00:00:00Z`);
            fecha.setUTCDate(fecha.getUTCDate() - 1);
            return fecha.toISOString().slice(0, 10);
        },
        valor => String(valor || ""),
        (a, b) => String(a).localeCompare(String(b))
    );
}

test("al reactivar queda anotado desde el dia siguiente a su salida", () => {
    const tramos = montarTramos()(
        { unitExitDate: "2026-09-15" },
        { isReactivating: true, returnISO: "2026-10-08" }
    );

    assert.deepEqual(tramos, [{ from: "2026-09-16", to: "2026-10-07" }]);
});

test("los tramos anteriores se conservan", () => {
    const tramos = montarTramos()(
        {
            unitExitDate: "2026-09-15",
            inactivePeriods: [{ from: "2025-01-10", to: "2025-03-04" }]
        },
        { isReactivating: true, returnISO: "2026-10-08" }
    );

    assert.equal(tramos.length, 2);
    assert.deepEqual(tramos[0], { from: "2025-01-10", to: "2025-03-04" });
});

test("guardar sin reactivar no inventa tramos", () => {
    assert.deepEqual(
        montarTramos()(
            { unitExitDate: "2026-09-15" },
            { isReactivating: false, returnISO: "2026-10-08" }
        ),
        []
    );
});

test("volver al dia siguiente -o antes- no deja tramo", () => {
    const tramos = montarTramos();

    // Se fue el 15 y vuelve el 16: no falto ningun dia.
    assert.deepEqual(
        tramos({ unitExitDate: "2026-09-15" }, { isReactivating: true, returnISO: "2026-09-16" }),
        []
    );
    // Vuelve ANTES de irse (correccion hacia atras, con su aviso aparte).
    assert.deepEqual(
        tramos({ unitExitDate: "2026-09-15" }, { isReactivating: true, returnISO: "2026-09-10" }),
        []
    );
    // Y sin fecha de salida registrada no hay de donde sacarlo.
    assert.deepEqual(
        tramos({ unitExitDate: "" }, { isReactivating: true, returnISO: "2026-10-08" }),
        []
    );
});

test("el tramo viaja en el perfil que se guarda", () => {
    const guardar = extraer(main, "saveProfileNow");

    assert.match(
        guardar,
        /const nextInactivePeriods = nextProfileInactivePeriods\(previousSnapshot, \{\s*\n\s*isReactivating,\s*\n\s*returnISO: nextRotationStart\s*\n\s*\}\);/
    );
    assert.match(guardar, /inactivePeriods: nextInactivePeriods,/);
});

// --- Como se ve ---

test("el calendario bloquea esos dias con las barras de siempre", () => {
    assert.match(calendario, /import \{ dayOutsideUnitReason \} from "\.\/profileQueries\.js";/);
    assert.match(calendario, /const beforeUnitEntry = dayOutsideUnitReason\(activeWorker, isoDay\);/);
    // Las mismas clases que un ingreso por traspaso.
    assert.match(calendario, /div\.classList\.add\("day-before-unit-entry"\);/);
    assert.doesNotMatch(calendario, /unitEntryBlockReason\(/);
});

test("un perfil inactivo conserva el color del turno", () => {
    // mpa-disabled apaga el fondo de la casilla: con el puesto, el turno
    // quedaba sin color. Ahora solo se agrega si hay OTRO motivo.
    const pintar = calendario.slice(
        calendario.indexOf("const otroMotivoDeBloqueo ="),
        calendario.indexOf("calendarCellHandlers.set(div,")
    );

    assert.match(pintar, /if \(otroMotivoDeBloqueo \|\| window\.selectionMode\) \{/);
    assert.match(pintar, /otroMotivoDeBloqueo \|\| !activeProfileEnabled\s*\n\s*\? "mpa-disabled"/);
    // Y la casilla sigue marcada como de perfil inactivo.
    assert.match(calendario, /div\.classList\.add\("inactive-profile-day"\);/);
});

test("el estilo oscurece sin desteñir", () => {
    const regla = estilos.slice(
        estilos.indexOf(".day.inactive-profile-day {"),
        estilos.indexOf("}", estilos.indexOf(".day.inactive-profile-day {"))
    );

    assert.match(regla, /brightness\(0\.\d+\)/, "se oscurece");
    assert.match(regla, /grayscale\(0\.\d+\)/, "queda casi gris, pero no del todo");
    assert.doesNotMatch(regla, /grayscale\(1\)/, "sin color no se distingue un turno de otro");
    assert.match(regla, /opacity: 1;/, "y no se destiñe");
});

test("el timeline bloquea el mismo tramo", () => {
    const celda = extraer(timeline, "renderTimelineDayCell");

    assert.match(celda, /const outsideUnit = profileInactivePeriods\(profile\)/);
    assert.match(celda, /iso >= periodo\.from && iso <= periodo\.to/);
    assert.match(celda, /const workerBlockedDay = outsideUnit \|\|/);
    // Y usa el fondo de dia bloqueado que ya existia.
    assert.match(celda, /timelineBlockedDayBackground\(isInhabil\)/);
});
