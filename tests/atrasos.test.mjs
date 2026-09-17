// Atrasos: minutos entre la hora de ingreso del turno y la marca de entrada.
//
// Las reglas, en las palabras del usuario:
//   - el atraso empieza a contar DESDE EL MINUTO 6, y cuando empieza se cuentan
//     TODOS los minutos, no solo los que exceden el margen: con entrada a las
//     8:00, marcar 8:06 son 6 minutos de atraso, no 1;
//   - diurno y larga entran a las 8:00, noche a las 20:00;
//   - solo cuentan los turnos BASE. Un turno extra no genera atraso aunque se
//     llegue tarde;
//   - un turno cambiado se mide en la fecha a la que se movio;
//   - sin marca de entrada, la celda Entrada muestra una cruz.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
    querySelector: () => null,
    querySelectorAll: () => []
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { TURNO } = await import("../js/constants.js");
const {
    DELAY_GRACE_MINUTES,
    delayMinutes,
    entryDelayForDay,
    exitDriftMinutes,
    formatDelayCell,
    groupMarkEvents,
    isMarkMissing,
    minutesFromTime,
    scheduledEntryTime,
    shiftEndsNextMorning,
    shiftHasSeparateSegments,
    shiftHasTwoParts,
    shiftStartsInTheMorning
} = await import("../js/attendanceDelay.js");
const { CONTINUES_MARK, getAttendanceCells, getEntryMarkTime } =
    await import("../js/attendanceImport.js");

async function leer(ruta) {
    const fuente = await readFile(new URL(ruta, import.meta.url), "utf8");

    return fuente.replace(/\r\n/g, "\n");
}

const motor = await leer("../js/attendanceDelay.js");
const reporte = await leer("../js/hoursReport.js");
const estilos = await leer("../styles.css");
const marcajes = await leer("../js/clockMarks.js");
const importacion = await leer("../js/attendanceImport.js");
const modulos = await leer("../js/firebaseStateModules.js");

// Los tres constructores de filas del reporte. Se miran uno por uno y no
// contando ocurrencias sueltas: el resumen de incidencias del inicio usa las
// mismas piezas, asi que un conteo global mezclaria a los cuatro.
const CONSTRUCTORES = [
    "buildNoAssignmentDayRows",
    "buildAssignedShiftDayRows",
    "buildDayRows"
];

function cuerpoDe(nombre) {
    const inicio = reporte.indexOf(`function ${nombre}`);

    assert.notEqual(inicio, -1, `falta ${nombre}`);

    return reporte.slice(inicio, inicio + 9000);
}


/* =========================================================
   El margen de cortesia
========================================================= */

test("hasta el minuto 5 no hay atraso", () => {
    assert.equal(DELAY_GRACE_MINUTES, 5);
    assert.equal(delayMinutes("08:00", "08:00"), 0);
    assert.equal(delayMinutes("08:01", "08:00"), 0);
    assert.equal(delayMinutes("08:05", "08:00"), 0);
});

test("desde el minuto 6 se cuentan TODOS los minutos, no solo el exceso", () => {
    // Es el detalle que el usuario subrayo: 8:06 son 6 minutos, no 1.
    assert.equal(delayMinutes("08:06", "08:00"), 6);
    assert.equal(delayMinutes("08:20", "08:00"), 20);
});

test("llegar antes no resta", () => {
    assert.equal(delayMinutes("07:50", "08:00"), 0);
    assert.equal(delayMinutes("06:00", "08:00"), 0);
});

test("los ejemplos exactos del turno de noche", () => {
    assert.equal(delayMinutes("20:05", "20:00"), 0);
    assert.equal(delayMinutes("20:40", "20:00"), 40);
});

/* =========================================================
   A que hora entra cada turno
========================================================= */

test("diurno y larga a las 8, noche a las 20", () => {
    assert.equal(scheduledEntryTime(TURNO.DIURNO), "08:00");
    assert.equal(scheduledEntryTime(TURNO.LARGA), "08:00");
    assert.equal(scheduledEntryTime(TURNO.NOCHE), "20:00");
});

test("un dia libre no tiene hora de entrada", () => {
    assert.equal(scheduledEntryTime(TURNO.LIBRE), "");
});

test("los turnos sin horario definido no miden atraso", () => {
    // 24h, D+N, 1/2M, Extension horaria y 18 horas todavia no tienen hora de
    // ingreso acordada. Inventarsela en un reporte que puede afectar el
    // registro de una persona es peor que dejar la celda vacia.
    [
        TURNO.TURNO24,
        TURNO.DIURNO_NOCHE,
        TURNO.MEDIA_MANANA,
        TURNO.MEDIA_TARDE,
        TURNO.TURNO18
    ].forEach(turno => {
        assert.equal(scheduledEntryTime(turno), "", `turno ${turno}`);
    });
});

test("el horario personalizado manda cuando exista", () => {
    // Todavia no se configura en ninguna parte; el parametro ya esta para que
    // habilitarlo despues sea cambiar quien llama y nada mas.
    assert.equal(scheduledEntryTime(TURNO.DIURNO, "09:30"), "09:30");
    // Una hora ilegible no puede dejar sin medir: se cae al horario por defecto.
    assert.equal(scheduledEntryTime(TURNO.DIURNO, "tarde"), "08:00");
});

test("una hora ilegible no inventa un atraso", () => {
    assert.equal(minutesFromTime("08:00"), 480);
    assert.equal(minutesFromTime("8:05"), 485);
    assert.equal(minutesFromTime(""), null);
    assert.equal(minutesFromTime("25:00"), null);
    assert.equal(minutesFromTime("08:70"), null);
    assert.equal(delayMinutes("", "08:00"), 0);
});

/* =========================================================
   El dia completo
========================================================= */

test("un turno base con atraso lo registra", () => {
    const dia = entryDelayForDay({
        baseShift: TURNO.DIURNO,
        workedShift: TURNO.DIURNO,
        entryTime: "08:18"
    });

    assert.equal(dia.minutes, 18);
    assert.equal(dia.scheduled, "08:00");
    assert.equal(dia.missingEntry, false);
});

test("un turno EXTRA no genera atraso aunque llegue tarde", () => {
    // La base es libre: ese dia no le tocaba. Es la regla que el usuario pidio.
    const dia = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.DIURNO,
        entryTime: "09:30"
    });

    assert.equal(dia.minutes, 0);
});

test("un cambio de turno se mide en la fecha a la que se movio", () => {
    // El turno viajo a otro dia: alli la base es Noche y el atraso se mide
    // contra las 20:00. En la fecha original la base quedo libre y no mide.
    const donde = entryDelayForDay({
        baseShift: TURNO.NOCHE,
        workedShift: TURNO.NOCHE,
        entryTime: "20:25"
    });
    const original = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.LIBRE,
        entryTime: ""
    });

    assert.equal(donde.minutes, 25);
    assert.equal(original.minutes, 0);
    assert.equal(original.missingEntry, false);
});

/* =========================================================
   Base y extra el mismo dia

   Los cuatro casos, tal como los planteo el usuario. Lo que decide no es que
   haya un extra, sino CUAL empieza primero: el que empieza antes se lleva la
   llegada del dia.
========================================================= */

test("base Larga sola: se mide a las 8:00", () => {
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            extraShift: TURNO.LIBRE,
            workedShift: TURNO.LARGA,
            entryTime: "08:12"
        }).minutes,
        12
    );
});

test("base Noche + extra Larga (hace un 24): NO se mide", () => {
    // Entro a las 8 por la Larga extra y siguio de largo hasta su Noche. Su
    // base empieza a las 20:00, pero a esa hora ya estaba adentro.
    const dia = entryDelayForDay({
        baseShift: TURNO.NOCHE,
        extraShift: TURNO.LARGA,
        workedShift: TURNO.TURNO24,
        entryTime: "08:40"
    });

    assert.equal(dia.minutes, 0);
    assert.equal(dia.missingEntry, false);
});

test("base Larga + extra Noche (tambien un 24): SI se mide, a las 8:05", () => {
    // El mismo 24 horas, pero al reves: la llegada de la manana es la de su
    // turno base, asi que el margen corre sobre las 8:00.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            extraShift: TURNO.NOCHE,
            workedShift: TURNO.TURNO24,
            entryTime: "08:05"
        }).minutes,
        0
    );
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            extraShift: TURNO.NOCHE,
            workedShift: TURNO.TURNO24,
            entryTime: "08:06"
        }).minutes,
        6
    );
});

test("base Noche + extra Diurno tampoco se mide", () => {
    // Mismo principio que el 24: el extra de la manana se lleva la llegada.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.NOCHE,
            extraShift: TURNO.DIURNO,
            workedShift: TURNO.DIURNO_NOCHE,
            entryTime: "08:30"
        }).minutes,
        0
    );
});

test("base Diurno + extra Noche si se mide", () => {
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.DIURNO,
            extraShift: TURNO.NOCHE,
            workedShift: TURNO.DIURNO_NOCHE,
            entryTime: "08:20"
        }).minutes,
        20
    );
});

test("una extension horaria no se lleva la llegada", () => {
    // Extension horaria alarga el turno por el otro extremo: la entrada sigue
    // siendo la del turno base.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.DIURNO,
            extraShift: TURNO.MEDIA_TARDE,
            workedShift: TURNO.LARGA,
            entryTime: "08:15"
        }).minutes,
        15
    );
});

test("una licencia no genera atraso ni cruz", () => {
    const dia = entryDelayForDay({
        baseShift: TURNO.DIURNO,
        workedShift: TURNO.LIBRE,
        entryTime: "",
        absent: true
    });

    assert.equal(dia.minutes, 0);
    assert.equal(dia.missingEntry, false);
});

/* =========================================================
   La cruz de "sin registro de entrada"
========================================================= */

test("trabajo y no marco: cruz", () => {
    const dia = entryDelayForDay({
        baseShift: TURNO.DIURNO,
        workedShift: TURNO.DIURNO,
        entryTime: ""
    });

    assert.equal(dia.missingEntry, true);
    // Sin marca no se puede saber cuanto se atraso: no se inventa un numero.
    assert.equal(dia.minutes, 0);
});

test("un turno extra sin marca tambien lleva cruz", () => {
    // No genera atraso, pero que falte el registro igual hay que verlo.
    const dia = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.NOCHE,
        entryTime: ""
    });

    assert.equal(dia.missingEntry, true);
    assert.equal(dia.minutes, 0);
});

test("la salida sin registro lleva la misma cruz que la entrada", () => {
    // Misma regla, otra columna: se trabajo y no hay marca.
    assert.equal(
        isMarkMissing({ mark: "", workedShift: TURNO.NOCHE }),
        true
    );
    assert.equal(
        isMarkMissing({ mark: "08:08", workedShift: TURNO.NOCHE }),
        false
    );
});

test("un dia que TODAVIA no ocurre no tiene marcas que falten", () => {
    // Sin esto, el reporte del mes en curso salia lleno de cruces de manana en
    // adelante: turnos programados que nadie podia haber marcado aun.
    assert.equal(
        isMarkMissing({
            mark: "",
            workedShift: TURNO.LARGA,
            hasPassed: false
        }),
        false
    );
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            workedShift: TURNO.LARGA,
            entryTime: "",
            hasPassed: false
        }).missingEntry,
        false
    );
});

test("con ausencia tampoco falta ninguna marca", () => {
    assert.equal(
        isMarkMissing({ mark: "", workedShift: TURNO.LARGA, absent: true }),
        false
    );
});

test("el reporte corta las cruces en la ultima planilla subida", () => {
    // El corte NO es hoy: es la hora en que se cargo el ultimo archivo del
    // reloj. Si pasan cinco dias sin subir nada, esos cinco dias no generan
    // faltas; se juzgan cuando llegue la planilla que los cubre.
    assert.match(reporte, /function shiftEndedByLastImport\(/);
    assert.match(reporte, /hasPassed: shiftEndedByLastImport\(/);
    assert.match(reporte, /const importedAt = coverage\?\.at \? new Date\(coverage\.at\) : null;/);
    assert.match(reporte, /return end \? end <= importedAt : date < importedAt;/);
    // Y ademas exige tener datos del reloj para ese dia: sin la planilla
    // cargada, que falte una marca no significa nada.
    assert.match(
        reporte,
        /isAttendanceCovered\(isoFromKey\(keyDay\), day\.coverage\)/
    );

    // Sin momento guardado -planillas de antes- se sigue usando el dia de hoy.
    assert.match(reporte, /function startOfToday\(\)/);
    assert.match(reporte, /return date < today;/);

    CONSTRUCTORES.forEach(nombre => {
        assert.match(
            cuerpoDe(nombre),
            /const today = startOfToday\(\);/,
            `${nombre} no sabe que dia es hoy`
        );
    });
});

test("un turno que aun no termina no cuenta, aunque el dia este cargado", () => {
    // La planilla se sube a las 10 y el turno largo sale a las 20: a esa hora
    // no hay salida que exigir. El turno de la noche anterior, que cerro a las
    // 08, si se juzga.
    assert.match(reporte, /function shiftEndInstant\(date, scheduledExit, workedShift\)/);
    assert.match(reporte, /if \(shiftEndsNextMorning\(workedShift\)\) \{/);
    assert.match(reporte, /end\.setDate\(end\.getDate\(\) \+ 1\);/);
});

test("la hora de la carga viaja con las marcas", () => {
    // El motor del servidor la lee del mismo estado sincronizado; sin esto la
    // PWA seguiria juzgando hasta hoy.
    assert.match(importacion, /const IMPORTED_AT_KEY = "attendanceMarksImportedAt";/);
    assert.match(importacion, /setJSON\(IMPORTED_AT_KEY, new Date\(\)\.toISOString\(\)\);/);
    assert.match(importacion, /return \{ from, to, at: attendanceImportedAt\(\) \};/);
    assert.match(modulos, /\["attendanceMarksImportedAt", "clockmarks"\]/);
});

test("la cruz de salida usa el mismo estilo que la de entrada", () => {
    assert.match(
        reporte,
        /title: MISSING_EXIT_TITLE,\s*\n\s*className: "report-cell--missing-entry"/
    );
});

test("un dia libre sin marca NO lleva cruz", () => {
    // No habia nada que marcar; una cruz ahi seria ruido en todo el mes.
    const dia = entryDelayForDay({
        baseShift: TURNO.LIBRE,
        workedShift: TURNO.LIBRE,
        entryTime: ""
    });

    assert.equal(dia.missingEntry, false);
});

/* =========================================================
   Que marca se toma como entrada
========================================================= */

test("se toma la entrada mas temprana, nunca una salida", () => {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "17816632-8": {
            // Caso real del reloj: sale de la noche anterior y entra a la suya.
            "2026-08-13": [
                { time: "08:08", type: "out" },
                { time: "19:54", type: "in" }
            ],
            "2026-08-15": [
                { time: "07:57", type: "in" },
                { time: "20:06", type: "out" }
            ],
            // Solo salida: para el atraso es como no tener entrada.
            "2026-08-17": [{ time: "08:18", type: "out" }]
        }
    }));

    assert.equal(getEntryMarkTime("17816632-8", "2026-08-13"), "19:54");
    assert.equal(getEntryMarkTime("17816632-8", "2026-08-15"), "07:57");
    assert.equal(getEntryMarkTime("17816632-8", "2026-08-17"), "");
    assert.equal(getEntryMarkTime("17816632-8", "2026-08-20"), "");
});

test("la noche del 13 de agosto: entro 19:54, sin atraso", () => {
    // Cierra el circuito con datos reales de produccion.
    const dia = entryDelayForDay({
        baseShift: TURNO.NOCHE,
        workedShift: TURNO.NOCHE,
        entryTime: getEntryMarkTime("17816632-8", "2026-08-13")
    });

    assert.equal(dia.minutes, 0);
});

/* =========================================================
   La salida del turno de noche viaja al dia del turno

   El reloj deja la salida de un turno con noche en el dia SIGUIENTE, que suele
   ser un libre. Es correcto pero se lee mal: la fila del turno queda sin
   salida y un dia libre aparece con una. Se la trae al dia en que se entro.
========================================================= */

function marcasDelEjemplo() {
    // Las tres filas de la imagen del usuario.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            // 03-08: hizo un 24 (Larga + Noche). Entra y no sale ese dia.
            "2026-08-03": [{ time: "07:57", type: "in" }],
            // 04-08: la salida de las 08:10 cierra el 24 del dia 3. A las
            // 19:40 entra a SU turno de noche.
            "2026-08-04": [
                { time: "08:10", type: "out" },
                { time: "19:40", type: "in" }
            ],
            // 05-08 es libre: esta salida cierra la noche del dia 4.
            "2026-08-05": [{ time: "08:08", type: "out" }]
        }
    }));
}

test("el 24 muestra su salida del dia siguiente, con la fecha original", () => {
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-03", {
        endsNextMorning: true
    });

    assert.equal(dia.entrada, "07:57");
    assert.equal(dia.salida, "08:10");
    assert.equal(dia.salidaFrom, "2026-08-04");
});

test("la noche del dia 4 toma la salida del 5, no la del 4", () => {
    // La del 4 a las 08:10 es del turno de anoche; la suya es la del 5.
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-04", {
        endsNextMorning: true,
        previousEndsNextMorning: true
    });

    assert.equal(dia.entrada, "19:40");
    assert.equal(dia.salida, "08:08");
    assert.equal(dia.salidaFrom, "2026-08-05");
});

test("el libre siguiente queda SIN salida: ya se mostro en su turno", () => {
    // Sin esto la misma marca apareceria dos veces en el reporte.
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-05", {
        previousEndsNextMorning: true
    });

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "");
});

test("un turno de dia no mueve nada", () => {
    marcasDelEjemplo();

    const dia = getAttendanceCells("1-9", "2026-08-04");

    // Comportamiento de siempre: lo que se marco ese dia, tal cual.
    assert.equal(dia.salida, "08:10");
    assert.equal(dia.salidaFrom, undefined);
});

test("sin salida al dia siguiente la celda queda vacia", () => {
    // Entro a su Noche y nunca marco el termino. La celda queda vacia -y con
    // cruz en el reporte-: una marca de mitad de turno no es el termino, y
    // mostrarla como tal seria peor que dejarla en blanco.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { "2026-08-10": [{ time: "19:55", type: "in" }] }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-10", {
        endsNextMorning: true,
        workedShift: TURNO.NOCHE,
        scheduledEntry: "20:00"
    });

    assert.equal(dia.entrada, "19:55");
    assert.equal(dia.salida, "");
    assert.equal(dia.salidaFrom, undefined);
});

test("el traslado cruza el fin de mes", () => {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-31": [{ time: "19:50", type: "in" }],
            "2026-09-01": [{ time: "08:05", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-31", {
        endsNextMorning: true
    });

    assert.equal(dia.salida, "08:05");
    assert.equal(dia.salidaFrom, "2026-09-01");
});

test("el reporte marca la salida movida y dice de que dia viene", () => {
    assert.match(reporte, /const MOVED_EXIT_MARK = "\*";/);
    assert.match(reporte, /const MOVED_EXIT_TITLE = "Marcado el";/);
    assert.match(
        reporte,
        /`\$\{MOVED_EXIT_TITLE\} \$\{formatDate\(cells\.salidaFrom\)\}`/
    );
    assert.match(estilos, /\.report-table td\.report-cell--moved-exit,/);
});

test("los tres constructores informan el turno de anoche", () => {
    // Sin el, la salida de un turno de noche saldria dos veces: en la fila del
    // turno y otra vez en el libre del dia siguiente.
    assert.match(
        reporte,
        /previousWorkedShift: actualStateForReport\(\s*\n\s*profileName, data, previousDayKey\(keyDay\)\s*\n\s*\)/
    );
});

test("los tres constructores informan tambien el turno de manana", () => {
    // Sin el no se puede saber si la noche continua en el turno siguiente, que
    // es lo que decide entre poner una flecha o una cruz.
    assert.match(
        reporte,
        /nextWorkedShift: actualStateForReport\(\s*\n\s*profileName, data, nextDayKey\(keyDay\)\s*\n\s*\)/
    );
});

test("los dias vecinos se calculan cruzando meses", () => {
    // parseKey/setDate cruzan mes y anio solos; construir la clave a mano
    // fallaria el dia 1 y el ultimo de cada mes.
    assert.match(
        reporte,
        /function previousDayKey\(keyDay\) \{\s*\n\s*const date = parseKey\(keyDay\);\s*\n\s*\n\s*date\.setDate\(date\.getDate\(\) - 1\);/
    );
});

/* =========================================================
   El 24 con marcaje entre los dos tramos

   Hay quien marca al pasar de la Larga a la Noche: sale 20:00 y vuelve a
   entrar 20:00. Son cuatro marcas para un solo turno. En la tabla quedan la
   primera entrada y la ultima salida; las otras, en el hover.
========================================================= */

function marcasDelVeinticuatro() {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-20": [
                { time: "08:00", type: "in" },
                { time: "20:00", type: "out" },
                { time: "20:00", type: "in" }
            ],
            "2026-08-21": [{ time: "08:00", type: "out" }]
        }
    }));
}

test("el 24 con marcaje intermedio muestra 08:00 y 08:00", () => {
    marcasDelVeinticuatro();

    const dia = getAttendanceCells("1-9", "2026-08-20", {
        endsNextMorning: true
    });

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.salida, "08:00");
    assert.equal(dia.salidaFrom, "2026-08-21");
});

test("las cuatro marcas del 24 quedan disponibles, en orden", () => {
    // La del dia siguiente va al final aunque su hora sea menor: cierra el
    // turno. Ordenarlas por hora la pondria primera y mentiria.
    marcasDelVeinticuatro();

    const dia = getAttendanceCells("1-9", "2026-08-20", {
        endsNextMorning: true
    });

    assert.deepEqual(
        dia.marks.map(marca => `${marca.time} ${marca.type}`),
        ["08:00 in", "20:00 out", "20:00 in", "08:00 out"]
    );
});

test("el atraso del 24 se mide con la PRIMERA entrada", () => {
    // Si tomara la de las 20:00 -la del segundo tramo- un turno puntual
    // apareceria con doce horas de atraso.
    marcasDelVeinticuatro();

    assert.equal(getEntryMarkTime("1-9", "2026-08-20"), "08:00");
});

test("un turno normal sin marcas intermedias no arma hover", () => {
    // Solo se esconde algo cuando hay algo que esconder.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-20": [
                { time: "07:58", type: "in" },
                { time: "20:04", type: "out" }
            ]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-20");

    assert.equal(dia.marks.length, 2);
    assert.equal(dia.entrada, "07:58");
    assert.equal(dia.salida, "20:04");
});

test("el hover se arma solo cuando la fila esconde marcas", () => {
    assert.match(reporte, /const ALL_MARKS_TITLE = "Marcas del turno:";/);
    assert.match(reporte, /function hiddenMarksTitle\(cells\)/);
    // La cuenta es contra lo que SE MUESTRA, no contra un numero fijo, y lo
    // que se muestra son las marcas de cada tramo: un dia sin salida muestra
    // una sola y con dos marcas ya esconde una; un 24 con el traspaso marcado
    // muestra cuatro horas en dos lineas y no esconde ninguna.
    assert.match(
        reporte,
        /total \+ \(segment\.entry \? 1 : 0\) \+ \(segment\.exit \? 1 : 0\)/
    );
    assert.match(reporte, /if \(marks\.length <= shown\) return "";/);
    assert.match(estilos, /\.report-table td\.report-cell--more-marks \{/);
});

test("el hover dice cada marca entera y bien separada", () => {
    // "Entrada a las 07:57  |  Salida a las 20:00  |  ...". De corrido, en un
    // 24 con cuatro marcas, no se distingue cual cierra un tramo y cual abre
    // el otro.
    assert.match(
        reporte,
        /`\$\{mark\.type === "out" \? "Salida" : "Entrada"\} a las \$\{mark\.time\}`/
    );
    assert.match(reporte, /\.join\("  \|  "\)/);
});

/* =========================================================
   Cuando el trabajador aprieta el boton equivocado

   El reloj guarda lo que apretaron, no lo que hicieron. Si ese dia tenia turno
   programado, una "salida" a la hora de llegar fue un error involuntario: lo
   importante es que marco. La hora vale y la etiqueta equivocada se reporta
   como incidencia.
========================================================= */

const larga = { workedShift: TURNO.LARGA, scheduledEntry: "08:00" };

function marcar(dia, marcas) {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { [dia]: marcas }
    }));
}

test("marco salida al llegar y volvio a marcar: vale la PRIMERA", () => {
    // El usuario fue explicito: se muestra el primer marcaje, el segundo al
    // hover. Aunque la segunda sea la que dice "entrada".
    marcar("2026-08-10", [
        { time: "08:00", type: "out" },
        { time: "08:02", type: "in" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.entryIncident, true);
    assert.equal(dia.salida, "20:05");
    assert.equal(dia.exitIncident, false);
    // La segunda no se pierde: queda en marks, que alimenta el hover.
    assert.equal(dia.marks.length, 3);
});

test("marco salida al llegar y NO volvio a marcar: vale igual", () => {
    marcar("2026-08-10", [
        { time: "08:00", type: "out" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.entryIncident, true);
    assert.equal(dia.salida, "20:05");
});

test("marco entrada al irse: se registra como salida", () => {
    marcar("2026-08-10", [
        { time: "07:58", type: "in" },
        { time: "20:05", type: "in" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "07:58");
    assert.equal(dia.entryIncident, false);
    assert.equal(dia.salida, "20:05");
    assert.equal(dia.exitIncident, true);
});

test("con una sola marca decide la hora, no la etiqueta", () => {
    // A la hora de entrar es la entrada, aunque diga salida.
    marcar("2026-08-10", [{ time: "08:03", type: "out" }]);
    let dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:03");
    assert.equal(dia.entryIncident, true);
    assert.equal(dia.salida, "");

    // Doce horas despues es la salida, y ahi la etiqueta "salida" esta bien:
    // lo que falta es la entrada.
    marcar("2026-08-10", [{ time: "20:05", type: "out" }]);
    dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "20:05");
    assert.equal(dia.exitIncident, false);
});

test("un dia SIN turno no se corrige: manda el reloj", () => {
    // La correccion se apoya en que habia turno programado. Sin turno no hay
    // nada contra que contrastar y reinterpretar seria inventar.
    marcar("2026-08-10", [{ time: "08:00", type: "out" }]);

    const dia = getAttendanceCells("1-9", "2026-08-10");

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "08:00");
    assert.equal(dia.entryIncident, false);
});

test("sin horario de ingreso conocido y una sola marca, manda el reloj", () => {
    // Turnos como 24h o D+N todavia no tienen hora de ingreso acordada.
    marcar("2026-08-10", [{ time: "08:00", type: "out" }]);

    const dia = getAttendanceCells("1-9", "2026-08-10", {
        workedShift: TURNO.TURNO24
    });

    assert.equal(dia.entrada, "");
    assert.equal(dia.salida, "08:00");
});

test("el atraso se mide con la entrada corregida", () => {
    // Es la consecuencia que importa: si tomara solo las marcas con etiqueta
    // "entrada", quien se equivoco al llegar apareceria sin marca y con cruz,
    // en vez de con sus minutos de atraso.
    marcar("2026-08-10", [
        { time: "08:20", type: "out" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);
    const atraso = entryDelayForDay({
        baseShift: TURNO.LARGA,
        workedShift: TURNO.LARGA,
        entryTime: dia.entrada
    });

    assert.equal(atraso.minutes, 20);
    assert.equal(atraso.missingEntry, false);
});

test("si anoche hubo Noche, la salida temprana NO es una incidencia", () => {
    // Encontrado al probar el reporte completo: con turno de noche el dia
    // anterior, una "salida" a las 08:00 es su cierre, no un boton mal
    // apretado. Gana el cierre del turno de anoche, que es lo unico que
    // explica una salida a esa hora.
    marcar("2026-08-10", [
        { time: "08:00", type: "out" },
        { time: "08:02", type: "in" },
        { time: "20:05", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", {
        ...larga,
        previousEndsNextMorning: true,
        // Una Larga empieza por la manana, y eso es lo que decide si la
        // etiqueta manda: con turno de manana, una "entrada" a las 08:02 es la
        // llegada de hoy y solo la "salida" se va con la noche de anoche.
        startsInTheMorning: true
    });

    assert.equal(dia.entrada, "08:02");
    assert.equal(dia.entryIncident, false);
    // Y la de las 08:00 no aparece: se muestra en la fila del turno de anoche.
    assert.equal(dia.marks.length, 2);
});

test("el reporte usa la entrada resuelta para el atraso", () => {
    assert.match(reporte, /entryTime: cells\.entrada,/);
    assert.doesNotMatch(reporte, /entryTime: getEntryMarkTime\(/);
});

test("la incidencia tiene simbolo, explicacion y estilo propios", () => {
    assert.match(reporte, /const INCIDENT_MARK = "⚠";/);
    assert.match(
        reporte,
        /const ENTRY_INCIDENT_TITLE =\s*\n?\s*"Incidencia: marco salida en vez de entrada";/
    );
    assert.match(
        reporte,
        /const EXIT_INCIDENT_TITLE =\s*\n?\s*"Incidencia: marco entrada en vez de salida";/
    );
    assert.match(estilos, /\.report-table td\.report-cell--mark-incident \{/);
});

/* =========================================================
   El turno que continua sin marcaje

   Una noche termina a las 8 y el turno de la manana empieza a las 8: el
   trabajador no sale, asi que no hay nada que marcar. La celda lleva una
   flecha, no una cruz, y no se mide atraso.
========================================================= */

const noche = {
    workedShift: TURNO.NOCHE,
    scheduledEntry: "20:00",
    endsNextMorning: true
};

test("caso 1: no marca la salida de la noche ni la entrada de la Larga", () => {
    marcar("2026-08-15", [{ time: "20:08", type: "in" }]);
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-15": [{ time: "20:08", type: "in" }],
            "2026-08-16": [{ time: "20:00", type: "out" }]
        }
    }));

    const laNoche = getAttendanceCells("1-9", "2026-08-15", {
        ...noche,
        nextStartsInTheMorning: true
    });

    assert.equal(laNoche.entrada, "20:08");
    assert.equal(laNoche.salida, CONTINUES_MARK);
    assert.equal(laNoche.exitArrow, true);

    const laLarga = getAttendanceCells("1-9", "2026-08-16", {
        workedShift: TURNO.LARGA,
        scheduledEntry: "08:00",
        previousEndsNextMorning: true,
        startsInTheMorning: true
    });

    assert.equal(laLarga.entrada, CONTINUES_MARK);
    assert.equal(laLarga.entryArrow, true);
    // Y su salida de las 20:00 NO se la lleva el turno de anoche.
    assert.equal(laLarga.salida, "20:00");
});

test("caso 2: no marca la salida pero si la entrada del diurno", () => {
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-18": [{ time: "20:00", type: "in" }],
            "2026-08-19": [
                { time: "08:00", type: "in" },
                { time: "17:00", type: "out" }
            ]
        }
    }));

    const laNoche = getAttendanceCells("1-9", "2026-08-18", {
        ...noche,
        nextStartsInTheMorning: true
    });

    // La entrada del diurno no se confunde con el cierre de la noche: ese dia
    // empieza turno por la manana, asi que la etiqueta manda.
    assert.equal(laNoche.salida, CONTINUES_MARK);

    const elDiurno = getAttendanceCells("1-9", "2026-08-19", {
        workedShift: TURNO.DIURNO,
        scheduledEntry: "08:00",
        previousEndsNextMorning: true,
        startsInTheMorning: true
    });

    // Aqui NO va flecha: si marco su entrada.
    assert.equal(elDiurno.entrada, "08:00");
    assert.equal(elDiurno.entryArrow, false);
    assert.equal(elDiurno.salida, "17:00");
});

test("si el dia siguiente es libre, la salida sin marcar es una falta", () => {
    // La flecha significa que el turno continua. Sin turno al que continuar,
    // lo que hay es un registro que falta.
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { "2026-08-18": [{ time: "20:00", type: "in" }] }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-18", {
        ...noche,
        nextStartsInTheMorning: false
    });

    assert.equal(dia.salida, "");
    assert.equal(dia.exitArrow, false);
});

test("con el dia siguiente libre, la etiqueta equivocada no estorba", () => {
    // Es la pregunta del usuario: si se equivoca al cerrar la noche, se mira
    // su programacion. Ese dia no empieza turno, asi que una marca temprana
    // solo puede ser el cierre, diga entrada o salida.
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-18": [{ time: "20:00", type: "in" }],
            "2026-08-19": [{ time: "08:05", type: "in" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-18", {
        ...noche,
        nextStartsInTheMorning: false
    });

    assert.equal(dia.salida, "08:05");
    assert.equal(dia.salidaFrom, "2026-08-19");
    assert.equal(dia.exitIncident, true);
});

/* =========================================================
   D+N: dos tramos, dos lineas

   Un 24 es continuo -la Larga termina a las 20 y la Noche empieza a las 20- y
   por eso se resume en una linea. Un D+N no: el diurno termina a las 17 y la
   noche empieza a las 20. Son dos llegadas y dos salidas.
========================================================= */

test("caso 3: el D+N muestra el diurno arriba y la noche abajo", () => {
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-21": [
                { time: "08:00", type: "in" },
                { time: "17:00", type: "out" },
                { time: "19:57", type: "in" }
            ],
            "2026-08-22": [{ time: "08:01", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-21", {
        workedShift: TURNO.DIURNO_NOCHE,
        endsNextMorning: true,
        splitSegments: true,
        nextStartsInTheMorning: true
    });

    assert.equal(dia.multiline, true);
    assert.equal(dia.entrada, "08:00\n19:57");
    assert.equal(dia.salida, "17:00\n08:01");
    assert.equal(dia.salidaFrom, "2026-08-22");
});

test("caso 4: el D+N que continua deja flecha en la noche", () => {
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-24": [
                { time: "08:01", type: "in" },
                { time: "17:00", type: "out" },
                { time: "19:54", type: "in" }
            ],
            "2026-08-25": [{ time: "17:00", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-24", {
        workedShift: TURNO.DIURNO_NOCHE,
        endsNextMorning: true,
        splitSegments: true,
        nextStartsInTheMorning: true
    });

    assert.equal(dia.entrada, "08:01\n19:54");
    assert.equal(dia.salida, `17:00\n${CONTINUES_MARK}`);
    assert.equal(dia.exitArrow, true);
});

test("un 24 se parte en dos SI marco el traspaso", () => {
    // Es continuo -no hace falta marcar al cambiar de tramo-, pero si marco,
    // esas horas se muestran: arriba la Larga y abajo la Noche.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-20": [
                { time: "08:00", type: "in" },
                { time: "20:00", type: "out" },
                { time: "20:02", type: "in" }
            ],
            "2026-08-21": [{ time: "08:05", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-20", {
        workedShift: TURNO.TURNO24,
        endsNextMorning: true,
        canSplitOnMarks: true
    });

    assert.equal(dia.multiline, true);
    assert.equal(dia.entrada, "08:00\n20:02");
    assert.equal(dia.salida, "20:00\n08:05");
});

test("sale y vuelve a entrar en el MISMO minuto", () => {
    // Es lo normal en un 24: apreta salida y entrada seguidas, a las 20:01
    // las dos. Las marcas se guardan sin segundos, asi que no hay orden que
    // valga: cual cierra y cual abre lo dice el boton que apreto.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-16": [
                { time: "07:57", type: "in" },
                { time: "20:01", type: "in" },
                { time: "20:01", type: "out" }
            ],
            "2026-08-17": [{ time: "08:02", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-16", {
        workedShift: TURNO.TURNO24,
        endsNextMorning: true,
        canSplitOnMarks: true
    });

    // Antes la entrada de la Noche se perdia -quedaba solo en el hover-
    // porque se buscaba DESPUES de la salida en la lista.
    assert.equal(dia.entrada, "07:57\n20:01");
    assert.equal(dia.salida, "20:01\n08:02");
    assert.equal(dia.entryIncident, false);
    assert.equal(dia.exitIncident, false);
});

test("el traspaso no se confunde con dos marcas al llegar", () => {
    // Marco dos veces al llegar: esas dos son una sola llegada y ninguna
    // puede pasar por la entrada del segundo tramo.
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-20": [
                { time: "07:57", type: "in" },
                { time: "07:58", type: "in" },
                { time: "20:00", type: "out" },
                { time: "20:01", type: "in" }
            ],
            "2026-08-21": [{ time: "08:05", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-20", {
        workedShift: TURNO.TURNO24,
        endsNextMorning: true,
        canSplitOnMarks: true
    });

    assert.equal(dia.entrada, "07:57\n20:01");
    assert.equal(dia.salida, "20:00\n08:05");
});

test("y sigue en una sola linea si NO lo marco", () => {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-20": [{ time: "08:00", type: "in" }],
            "2026-08-21": [{ time: "08:05", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-20", {
        workedShift: TURNO.TURNO24,
        endsNextMorning: true,
        canSplitOnMarks: true
    });

    assert.equal(dia.multiline, false);
    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.salida, "08:05");
});

test("el cambio de tramo no se confunde con una remarcacion", () => {
    // La salida de la Larga y la entrada de la Noche pueden ir con un minuto
    // de diferencia. Agruparlas por cercania las tomaria por una sola marca.
    assert.match(
        reporte,
        /canSplitOnMarks: shiftHasTwoParts\(day\.workedShift\)/
    );
    assert.equal(shiftHasTwoParts(TURNO.TURNO24), true);
    assert.equal(shiftHasTwoParts(TURNO.TURNO18), true);
    assert.equal(shiftHasTwoParts(TURNO.LARGA), false);
    assert.equal(shiftHasTwoParts(TURNO.NOCHE), false);
});

test("un D+N se parte SIEMPRE, con traspaso marcado o sin el", () => {
    // La diferencia con el D+N no es capricho: en un 24 el trabajador nunca se
    // va, en un D+N si.
    assert.equal(shiftHasSeparateSegments(TURNO.TURNO24), false);
    assert.equal(shiftHasSeparateSegments(TURNO.DIURNO_NOCHE), true);
    assert.equal(shiftHasSeparateSegments(TURNO.NOCHE), false);
});

test("que turnos empiezan por la manana sale del modelo", () => {
    [TURNO.LARGA, TURNO.DIURNO, TURNO.TURNO24, TURNO.DIURNO_NOCHE,
        TURNO.MEDIA_MANANA]
        .forEach(turno => {
            assert.equal(shiftStartsInTheMorning(turno), true, `turno ${turno}`);
        });
    [TURNO.LIBRE, TURNO.NOCHE, TURNO.MEDIA_TARDE, TURNO.TURNO18]
        .forEach(turno => {
            assert.equal(shiftStartsInTheMorning(turno), false, `turno ${turno}`);
        });
});

test("la flecha no cuenta como marca que falta ni genera atraso", () => {
    assert.match(reporte, /hasPassed: day\.hasPassed && !cells\.entryArrow/);
    assert.match(reporte, /hasPassed: day\.hasPassed && !cells\.exitArrow/);
    assert.match(estilos, /\.report-table td\.report-cell--stacked \{/);
    assert.match(estilos, /white-space: pre-line;/);
});

/* =========================================================
   Marcar dos veces el mismo momento

   Vale la PRIMERA de cada tanda, tanto al entrar como al salir: es la hora en
   que efectivamente llego o se fue. Las demas van al hover.
========================================================= */

test("dos marcas al salir: vale la primera", () => {
    // Antes se tomaba la ultima del dia y la salida quedaba en 20:04.
    marcar("2026-08-10", [
        { time: "08:00", type: "in" },
        { time: "20:00", type: "out" },
        { time: "20:04", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.salida, "20:00");
    // Ninguna se pierde.
    assert.equal(dia.marks.length, 3);
});

test("dos marcas al entrar: vale la primera", () => {
    marcar("2026-08-10", [
        { time: "07:58", type: "in" },
        { time: "08:01", type: "in" },
        { time: "20:00", type: "out" }
    ]);

    assert.equal(
        getAttendanceCells("1-9", "2026-08-10", larga).entrada,
        "07:58"
    );
});

test("dos marcas y ademas confundio los botones: primera, con incidencia", () => {
    marcar("2026-08-10", [
        { time: "08:00", type: "out" },
        { time: "08:02", type: "in" },
        { time: "20:00", type: "in" },
        { time: "20:03", type: "out" }
    ]);

    const dia = getAttendanceCells("1-9", "2026-08-10", larga);

    assert.equal(dia.entrada, "08:00");
    assert.equal(dia.entryIncident, true);
    assert.equal(dia.salida, "20:00");
    assert.equal(dia.exitIncident, true);
});

test("lo que marque en mitad de un 24 no se toma por salida", () => {
    // El 24 pasa de largo: si marca al cambiar de tramo, esa marca es
    // informativa y va al hover, no a la celda.
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": {
            "2026-08-10": [
                { time: "07:58", type: "in" },
                { time: "20:00", type: "out" },
                { time: "20:02", type: "in" }
            ],
            "2026-08-11": [{ time: "08:05", type: "out" }]
        }
    }));

    const dia = getAttendanceCells("1-9", "2026-08-10", {
        workedShift: TURNO.TURNO24,
        endsNextMorning: true,
        nextStartsInTheMorning: false
    });

    assert.equal(dia.entrada, "07:58");
    assert.equal(dia.salida, "08:05");
    // Una sola linea: el 24 es continuo, a diferencia del D+N.
    assert.equal(dia.multiline, false);
    assert.equal(dia.marks.length, 4);
});

test("las tandas se agrupan por cercania, no por cantidad", () => {
    const events = groupMarkEvents([
        { time: "08:00" },
        { time: "08:02" },
        { time: "17:00" },
        { time: "19:57" },
        { time: "08:01", iso: "2026-08-11" }
    ]);

    assert.deepEqual(
        events.map(evento => evento.map(marca => marca.time)),
        [["08:00", "08:02"], ["17:00"], ["19:57"], ["08:01"]]
    );
});

test("el cierre del dia siguiente no se confunde con la manana de hoy", () => {
    // Sin sumarle 24 horas, un cierre a las 08:01 pareceria anterior a una
    // entrada de las 19:57 y se agruparia con la llegada de la manana.
    const events = groupMarkEvents([
        { time: "08:00" },
        { time: "08:10", iso: "2026-08-11" }
    ]);

    assert.equal(events.length, 2);
});

/* =========================================================
   La jornada partida por una entrada movida a mano

   Una noche continua en la Larga de la manana siguiente y por eso lleva
   flecha. Pero si el supervisor autorizo entrar mas tarde -13:00-, la jornada
   se parte: el trabajador tuvo que marcar la salida de su noche, irse, y
   volver a marcar su entrada. Las dos marcas pasan a ser obligatorias, asi que
   lo que falta no es continuidad sino registro: cruz, no flecha.
========================================================= */

test("con la entrada movida, la noche pierde su flecha de salida", () => {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { "2026-08-20": [{ time: "20:00", type: "in" }] }
    }));

    const conFlecha = getAttendanceCells("1-9", "2026-08-20", {
        ...noche,
        nextStartsInTheMorning: true
    });

    assert.equal(conFlecha.salida, CONTINUES_MARK);

    const partida = getAttendanceCells("1-9", "2026-08-20", {
        ...noche,
        nextStartsInTheMorning: true,
        nextEntryMoved: true
    });

    assert.equal(partida.salida, "");
    assert.equal(partida.exitArrow, false);
});

test("y la Larga del dia siguiente pierde su flecha de entrada", () => {
    localStorage.clear();
    localStorage.setItem("attendanceMarks", JSON.stringify({
        "1-9": { "2026-08-21": [] }
    }));

    const comun = {
        workedShift: TURNO.LARGA,
        scheduledEntry: "08:00",
        previousEndsNextMorning: true,
        startsInTheMorning: true
    };

    assert.equal(
        getAttendanceCells("1-9", "2026-08-21", comun).entrada,
        CONTINUES_MARK
    );
    assert.equal(
        getAttendanceCells("1-9", "2026-08-21", {
            ...comun,
            entryMoved: true
        }).entrada,
        ""
    );
});

test("la senal es que el marcaje autorizado trae hora de entrada", () => {
    assert.match(
        marcajes,
        /export function hasModifiedEntryTime\(profile, keyDay\)/
    );
    assert.match(
        marcajes,
        /segments\)\.some\(segment => segment\?\.entryTime\)/
    );
});

test("los tres constructores miran hoy y manana", () => {
    // Hoy, para su propia flecha de entrada. Manana, para la flecha de salida
    // de la noche de hoy: la que se parte es la jornada del dia siguiente.
    assert.match(reporte, /entryMoved: hasModifiedEntryTime\(profileName, keyDay\)/);
    assert.match(
        reporte,
        /nextEntryMoved: hasModifiedEntryTime\(profileName, nextDayKey\(keyDay\)\)/
    );
});

/* =========================================================
   Los horarios salen del turno programado, no de una tabla aparte
========================================================= */

const { getClockScheduleState, getScheduledSegmentsForProfile } =
    await import("../js/clockMarks.js");

function horario(rotativa, turno, dia, permiso) {
    localStorage.clear();
    localStorage.setItem(
        "rotativa_X",
        JSON.stringify({ type: rotativa, start: "2026-08-01" })
    );
    if (permiso) {
        localStorage.setItem("admin_X", JSON.stringify({ [dia.key]: permiso }));
    }

    const hhmm = fecha => `${String(fecha.getHours()).padStart(2, "0")}:`
        + `${String(fecha.getMinutes()).padStart(2, "0")}`;

    return getScheduledSegmentsForProfile(
        "X",
        dia.key,
        dia.date,
        getClockScheduleState("X", dia.key, turno),
        {}
    ).map(segmento => `${hhmm(segmento.start)}-${hhmm(segmento.end)}`);
}

const LUNES = { key: "2026-7-17", date: new Date(2026, 7, 17) };
const VIERNES = { key: "2026-7-21", date: new Date(2026, 7, 21) };

test("cada turno entra a la hora que dijo el usuario", () => {
    assert.deepEqual(horario("4turno", TURNO.TURNO24, LUNES), ["08:00-08:00"]);
    assert.deepEqual(horario("4turno", TURNO.TURNO18, LUNES), ["14:00-08:00"]);
    assert.deepEqual(
        horario("4turno", TURNO.DIURNO_NOCHE, LUNES),
        ["08:00-17:00", "20:00-08:00"]
    );
});

test("el diurno del D+N sale a las 16:00 los viernes", () => {
    assert.deepEqual(
        horario("4turno", TURNO.DIURNO_NOCHE, VIERNES),
        ["08:00-16:00", "20:00-08:00"]
    );
});

/* =========================================================
   1/2 ADM: el corte depende de la ROTATIVA, no de la asignacion

   Un 1/2 ADM es media jornada, asi que donde cae el corte lo fija cuanto dura
   el turno base. 3er y 4to turno tienen base Larga (12 h) y cortan a las
   14:00; el diurno dura 9 h y corta a las 12:30.
========================================================= */

test("3er y 4to turno cortan a las 14:00 aunque NO tengan asignacion", () => {
    // Es el defecto que reporto el usuario: sin asignacion salian con el
    // horario del diurno, entrando a las 12:30 en vez de las 14:00.
    ["3turno", "4turno"].forEach(rotativa => {
        assert.deepEqual(
            horario(rotativa, TURNO.LARGA, LUNES, "0.5M"),
            ["14:00-20:00"],
            `${rotativa} manana`
        );
        assert.deepEqual(
            horario(rotativa, TURNO.LARGA, LUNES, "0.5T"),
            ["08:00-14:00"],
            `${rotativa} tarde`
        );
    });
});

test("la rotativa diurno mantiene su corte a las 12:30", () => {
    assert.deepEqual(
        horario("diurno", TURNO.DIURNO, LUNES, "0.5M"),
        ["12:30-17:00"]
    );
    assert.deepEqual(
        horario("diurno", TURNO.DIURNO, LUNES, "0.5T"),
        ["08:00-12:30"]
    );
});

test("y los viernes corre media hora, porque el diurno sale a las 16:00", () => {
    // El viernes la jornada dura 8 h en vez de 9, asi que la mitad cae a las
    // 12:00 y no a las 12:30.
    assert.deepEqual(
        horario("diurno", TURNO.DIURNO, VIERNES, "0.5M"),
        ["12:00-16:00"]
    );
    assert.deepEqual(
        horario("diurno", TURNO.DIURNO, VIERNES, "0.5T"),
        ["08:00-12:00"]
    );
});

test("el viernes NO corre el corte de 3er y 4to turno", () => {
    // Su base es Larga, de 08:00 a 20:00 todos los dias: la mitad son siempre
    // las 14:00.
    assert.deepEqual(
        horario("4turno", TURNO.LARGA, VIERNES, "0.5M"),
        ["14:00-20:00"]
    );
});

test("la asignacion de turno ya no entra en la decision", () => {
    assert.match(
        marcajes,
        /function usesAssignedHalfAdminSchedule\(profile\) \{\s*\n\s*return \["3turno", "4turno"\]\.includes\(getRotativa\(profile\)\.type\);/
    );
    assert.doesNotMatch(marcajes, /getShiftAssigned/);
});

test("el reporte toma la hora de ingreso del horario programado", () => {
    // Sin tabla propia: la misma fuente que alimenta el boton de marcajes del
    // reloj control. Si cambia el horario de un turno, el atraso cambia con el.
    assert.match(reporte, /function scheduledEntryFromShift\(/);
    assert.match(reporte, /entryOverride: day\.baseScheduledEntry,/);
    assert.match(reporte, /baseScheduledEntry: scheduledEntryFromShift\(/);
});

/* =========================================================
   Llegar tarde a un turno que no es el base

   Los atrasos son de la rotativa propia. En un turno extra no se miden, pero
   que haya llegado tarde igual queda senalado como incidencia, igual que
   marcar la salida antes de hora.
========================================================= */

test("llegar tarde a un extra no suma minutos pero si deja incidencia", () => {
    assert.match(reporte, /const LATE_EXTRA_TITLE = "Incidencia: llego despues de las";/);
    // El !libre es el horario libre: en un dia en el que no se le exige una
    // hora de entrada no hay llegada tarde que senalar.
    assert.match(
        reporte,
        /lateOnExtra: Boolean\(!libre && !delay\.minutes && worstLate\)/
    );
    // La llegada tarde se busca frontera por frontera y no en la primera hora
    // de la celda: un D+N tiene dos llegadas y la segunda -la de la noche- no
    // se comparaba contra nada.
    assert.match(
        reporte,
        /late: mideEntrada\s*\n\s*\? delayMinutes\(tramo\.entry\?\.time, start\)/
    );
    // Se mide contra el turno que efectivamente hizo, no contra su base: en un
    // extra la base esta libre y no tiene hora de entrada.
    //
    // El simbolo lo comparte con la entrada anticipada: las dos son la misma
    // celda corrida de su hora, y no pueden darse juntas.
    assert.match(
        reporte,
        /\(lateOnExtra \|\| earlyEntry\) &&\s*\n\s*!cells\.entryIncident && INCIDENT_MARK/
    );
});

test("la incidencia respeta el mismo margen de cortesia", () => {
    // Llegar 20:03 a un turno extra de noche no es incidencia.
    assert.equal(delayMinutes("20:03", "20:00"), 0);
    assert.equal(delayMinutes("20:30", "20:00"), 30);
});

test("un 24 con base Larga SI mide atraso; con base Noche, no", () => {
    // Con base Larga la llegada de la manana es la de su turno base.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.LARGA,
            extraShift: TURNO.NOCHE,
            workedShift: TURNO.TURNO24,
            entryTime: "08:20",
            entryOverride: "08:00"
        }).minutes,
        20
    );
    // Con base Noche entro por el tramo extra y siguio de largo: no hay forma
    // de que marque atraso sobre su Noche, que empieza a las 20:00.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.NOCHE,
            extraShift: TURNO.LARGA,
            workedShift: TURNO.TURNO24,
            entryTime: "08:40",
            entryOverride: "20:00"
        }).minutes,
        0
    );
});

/* =========================================================
   La hora de ingreso que fija el supervisor

   Si con el boton de marcajes del reloj control se mueve la entrada, el atraso
   se mide desde esa hora y no desde la del turno.
========================================================= */

test("el atraso se mide desde la hora autorizada, no la del turno", () => {
    // Un diurno entra a las 8:00, pero le autorizaron entrar a las 10:00. Si
    // llega 10:06 son 6 minutos, no las dos horas anteriores.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.DIURNO,
            workedShift: TURNO.DIURNO,
            entryTime: "10:06",
            entryOverride: "10:00"
        }).minutes,
        6
    );
    // Sin autorizacion, la misma llegada si es un atraso largo.
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.DIURNO,
            workedShift: TURNO.DIURNO,
            entryTime: "10:06",
            entryOverride: "08:00"
        }).minutes,
        126
    );
});

test("el margen de cortesia corre sobre la hora autorizada", () => {
    assert.equal(
        entryDelayForDay({
            baseShift: TURNO.DIURNO,
            workedShift: TURNO.DIURNO,
            entryTime: "10:05",
            entryOverride: "10:00"
        }).minutes,
        0
    );
});

test("el reporte lee la hora del marcaje autorizado", () => {
    assert.match(
        reporte,
        /const authorized = findClockMarkEntry\(\s*\n\s*getClockMarks\(profileName\)\[keyDay\],\s*\n\s*first\s*\n\s*\)\?\.value\?\.entryTime;/
    );
    // Y la precedencia: la hora del dia manda sobre el horario propio del
    // trabajador, y este sobre la hora del turno.
    assert.match(
        reporte,
        /return authorized\s*\n\s*\|\| workerEntryTime\(getWorkerScheduleAt\(profileName, date\), state\)\s*\n\s*\|\| formatClockTime\(first\.start\);/
    );
});

/* =========================================================
   Salir antes de hora
========================================================= */

test("marcar la salida antes de la hora del turno es una incidencia", () => {
    assert.match(reporte, /function scheduledExitFromShift\(/);
    assert.match(
        reporte,
        /const EARLY_EXIT_TITLE = "Incidencia: salio antes de las";/
    );
    assert.match(reporte, /earlyExit: Boolean\(exitDrift !== null && exitDrift < 0\)/);
});

test("las horas de salida NO se comparan como texto", () => {
    // Comparar "HH:MM" como texto funciona mientras el turno cabe dentro de su
    // dia y falla en el unico caso que importa: el turno con noche termina a
    // la manana siguiente, y ahi "08:11" parece anterior a "20:00".
    //
    // Cerrar una Noche a las 08:11 es irse 11 minutos DESPUES de hora.
    assert.equal(
        exitDriftMinutes("08:11", "08:00", {
            markIsNextDay: true,
            endsNextMorning: true
        }),
        11
    );
    // Y el nochero que se va a las 23:30 se fue mucho antes, no despues.
    assert.ok(
        exitDriftMinutes("23:30", "08:00", { endsNextMorning: true }) < 0,
        "una salida a las 23:30 de una Noche es irse antes"
    );
    // El turno que cabe en su dia se sigue midiendo igual que siempre.
    assert.equal(exitDriftMinutes("20:10", "20:00"), 10);
    assert.equal(exitDriftMinutes("17:00", "20:00"), -180);
    // Sin una de las dos horas no hay nada que medir.
    assert.equal(exitDriftMinutes("", "20:00"), null);
    assert.equal(exitDriftMinutes("20:00", ""), null);
});

test("no es incidencia si el supervisor autorizo salir antes", () => {
    // Una reduccion de jornada autorizada ya queda registrada como tal.
    assert.match(reporte, /!day\.exitMoved/);
    assert.match(
        marcajes,
        /export function hasModifiedExitTime\(profile, keyDay\)/
    );

    assert.match(reporte, /exitMoved: hasModifiedExitTime\(profileName, keyDay\)/);
});

test("el simbolo de salir antes no se duplica con el de etiqueta equivocada", () => {
    assert.match(
        reporte,
        /\(earlyExit \|\| lateExit\) &&\s*\n\s*!cells\.exitIncident && INCIDENT_MARK/
    );
});

/* =========================================================
   El dia sin turno
========================================================= */

test("un dia libre muestra guion, no una celda en blanco", () => {
    // Una celda vacia se lee como un dato que falta; el guion dice que no
    // habia nada que marcar.
    assert.match(reporte, /const IDLE_DAY_MARK = "-";/);
    assert.match(
        reporte,
        /const idle = Number\(day\.workedShift\) <= TURNO\.LIBRE;/
    );
    assert.match(reporte, /function orDash\(text, idle\)/);
    // Si llego a marcar, se muestra lo que marco y no el guion.
    assert.match(reporte, /return !text && idle \? IDLE_DAY_MARK : text;/);
    assert.match(estilos, /\.report-table td\.report-cell--idle-day \{/);
    assert.match(
        estilos,
        /\.report-table td\.report-cell--idle-day \{\s*\n\s*text-align: center;/
    );
});

/* =========================================================
   La celda
========================================================= */

test("sin atraso la celda queda vacia", () => {
    // Asi la columna se lee de un vistazo y solo saltan los dias con problema.
    assert.equal(formatDelayCell(0), "");
    assert.equal(formatDelayCell(-3), "");
    assert.equal(formatDelayCell(6), "6 min");
    assert.equal(formatDelayCell(40), "40 min");
});

/* =========================================================
   Como queda en el reporte
========================================================= */

test("la columna va entre Salida y las horas, en las dos variantes", () => {
    assert.match(
        reporte,
        /\{ key: "salida", label: "Salida" \},\s*\n\s*\{ key: "atrasos", label: "Atrasos" \},\s*\n\s*\{ key: "horasDiurnas"/
    );
    assert.match(
        reporte,
        /\{ key: "salida", label: "Salida" \},\s*\n\s*\{ key: "atrasos", label: "Atrasos" \},\s*\n\s*\{ key: "hheeDiurnas"/
    );
});

test("los tres constructores miden contra el turno base CON cambios", () => {
    // Si pasaran "actual", un turno extra generaria atraso y un turno cambiado
    // se mediria en la fecha equivocada: las dos reglas del usuario, rotas.
    CONSTRUCTORES.forEach(nombre => {
        assert.match(
            cuerpoDe(nombre),
            /baseShift: baseWithSwaps,/,
            `${nombre} no mide contra la base con cambios`
        );
    });
    assert.doesNotMatch(reporte, /baseShift: actual/);
});

test("los tres constructores informan tambien el turno extra del dia", () => {
    // Sin esto, quien tiene Noche de base y toma una Larga extra apareceria
    // con horas de atraso: su base empieza a las 20:00 pero entro a las 8.
    const usos = reporte.match(/extraShift: extraState,/g) || [];

    assert.equal(usos.length, 3);
    assert.match(reporte, /extraShift: day\.extraShift,/);
});

test("la cruz viaja con su explicacion", () => {
    assert.match(reporte, /const MISSING_MARK = "\\u2715";/);
    assert.match(
        reporte,
        /const MISSING_ENTRY_TITLE = "No existe registro de entrada";/
    );
    assert.match(
        reporte,
        /const MISSING_EXIT_TITLE = "No existe registro de salida";/
    );
    // El renderizador escapa el texto de la celda, asi que el tooltip necesita
    // su propio soporte: sin esto el hover no existiria.
    assert.match(reporte, /title="\$\{escapeHTML\(meta\.title\)\}"/);
    assert.match(estilos, /\.report-table td\.report-cell--missing-entry \{/);
    assert.match(estilos, /cursor: help;/);
});

test("el motor de atrasos no depende de nada del navegador", () => {
    // Igual que el motor de horas extras: sin DOM, sin Firebase y sin estado,
    // para que el calculo se pueda probar solo y no cambie segun donde corra.
    // Solo puede apoyarse en otros modulos igual de puros.
    const permitidos = ["./constants.js", "./rulesEngine.js"];
    const origenes = [...motor.matchAll(/^import .*? from "(.+?)";$/gm)]
        .map(coincidencia => coincidencia[1]);

    assert.ok(origenes.length, "no se detectaron los imports");
    origenes.forEach(origen => {
        assert.ok(permitidos.includes(origen), `import no permitido: ${origen}`);
    });
    assert.doesNotMatch(motor, /document|window|localStorage|firebase/);
});

test("que turnos terminan a la manana siguiente sale del modelo", () => {
    // No hay una lista aparte de turnos nocturnos: se pregunta por el segmento
    // "N". Si manana se agrega un turno con noche, esto lo reconoce solo.
    assert.match(motor, /getTurnoComponentes\(shift\)\.includes\("N"\)/);

    [TURNO.NOCHE, TURNO.TURNO24, TURNO.DIURNO_NOCHE, TURNO.TURNO18]
        .forEach(turno => {
            assert.equal(shiftEndsNextMorning(turno), true, `turno ${turno}`);
        });
    [TURNO.LIBRE, TURNO.LARGA, TURNO.DIURNO, TURNO.MEDIA_MANANA, TURNO.MEDIA_TARDE]
        .forEach(turno => {
            assert.equal(shiftEndsNextMorning(turno), false, `turno ${turno}`);
        });
});
