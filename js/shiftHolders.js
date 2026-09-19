// "Titulares de Turnos": quien pertenece a cada uno de los cuatro grupos del
// 4to turno.
//
// El 4to turno es un ciclo de CUATRO dias -Largo, Noche, Libre, Libre-, asi que
// solo existen cuatro fases posibles y cada trabajador esta en una. Dos
// trabajadores comparten grupo cuando, cualquier dia, van en la misma fase.
//
// La columna NO se lee de la rotativa configurada sino del calendario: se mira
// hacia atras, dia por dia, hasta donde deje de calzar. Asi la pantalla dice lo
// que el trabajador VIENE HACIENDO y no lo que alguien dejo escrito en su ficha.
// La ventana llega hasta tres meses; si el trabajador entro despues, o su
// rotativa empieza mas tarde, se usa lo que haya.
//
// Las letras A-D son FIJAS: se calculan contra una fecha ancla, no contra hoy.
// Si dependieran del turno del dia, cada trabajador cambiaria de columna cada 24
// horas y el listado dejaria de ser un listado de titulares. Lo que si cambia
// cada dia es el subtitulo de la columna ("hoy Largo"), que es lo que permite
// leerla de un vistazo.
//
// Solo entran trabajadores de 4to turno: el diurno no tiene fases y el 3er turno
// tiene un ciclo de seis dias, que serian otras tantas columnas.

import {
    getProfiles,
    getRotativa,
    getSwaps,
    isProfileActive
} from "./storage.js";
import { getJSON } from "./persistence.js";
import { getHourReturns } from "./hourReturns.js";
import { isBusinessDay } from "./calculations.js";
import { fetchHolidays } from "./holidays.js";
import { protectedLeaveKeys } from "./leaveProtection.js";
import { cambioEstaAnulado } from "./swaps.js";
import { getTurnoBase } from "./turnEngine.js";
import { rotationStartIndex } from "./rotationUtils.js";
import { keyFromDate, keyToDate, toISODate } from "./dateUtils.js";
import { runCooperativeRange } from "./mainThreadScheduler.js";
import { escapeHTML } from "./htmlUtils.js";
import { TURNO } from "./constants.js";

// Ciclo del 4to turno, sin rotar. El indice dentro de este arreglo es la "fase".
const CYCLE = [TURNO.LARGA, TURNO.NOCHE, TURNO.LIBRE, TURNO.LIBRE];
const CYCLE_TURN_LABEL = ["Largo", "Noche", "Libre", "Libre"];
export const COLUMN_LETTERS = ["A", "B", "C", "D"];

// Hasta donde se mira hacia atras. Tres meses del requerimiento; se corta antes
// si el trabajador no tiene tanta historia.
const LOOKBACK_DAYS = 92;

// Ancla de las letras. Cualquier fecha fija sirve: lo unico que importa es que
// no se mueva, para que un trabajador conserve su columna manana. Es anterior a
// cualquier rotativa del sistema.
const ANCHOR = new Date(2000, 0, 3);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayDiff(from, to) {
    const fromUTC = Date.UTC(
        from.getFullYear(),
        from.getMonth(),
        from.getDate()
    );
    const toUTC = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());

    return Math.floor((toUTC - fromUTC) / MS_PER_DAY);
}

function mod4(value) {
    return ((value % 4) + 4) % 4;
}

function addDays(date, amount) {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + amount
    );
}

function parseISODate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));

    if (!match) return null;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Fase del ciclo en `targetDate`, sabiendo que en `baseDate` iba en
 * `basePosition`.
 */
export function cyclePositionAt(basePosition, baseDate, targetDate) {
    return mod4(basePosition + dayDiff(baseDate, targetDate));
}

/* ==========================================================================
   Deteccion de la columna
   ========================================================================== */

/**
 * Ubica a un trabajador de 4to turno en su grupo mirando su calendario hacia
 * atras.
 *
 * Se compara contra el turno BASE y no contra el programado: un reemplazo, un
 * permiso o un turno extra son excepciones de un dia, no un cambio de grupo, y
 * ensuciarian la lectura.
 *
 * Devuelve null si el trabajador no es de 4to turno.
 */
export function detectHolderPlacement(profileName, today = new Date()) {
    const rotativa = getRotativa(profileName);

    if (rotativa.type !== "4turno") return null;

    const start = parseISODate(rotativa.start);
    // Una rotativa que EMPIEZA EN EL FUTURO no puede borrar a nadie del tablero.
    // Pasa al ampliar una rotativa: el inicio vigente queda despues de la
    // ventana aplicada -el dia siguiente al fin del tramo historico-, hoy es
    // anterior a el, y el barrido de abajo se cortaba en la PRIMERA vuelta. El
    // trabajador desaparecia sin ningun aviso aunque llevara meses haciendo el
    // ciclo, que es justo lo que este recuadro promete mostrar.
    //
    // Con el inicio por delante se mira igual hacia atras. Lo que no se regala
    // es la evidencia: mas abajo, sin calce con el ciclo sigue sin entrar.
    const startsLater = Boolean(start) && start > today;

    // Turnos base observados, de hoy hacia atras. Se corta en el inicio de la
    // rotativa: antes de esa fecha el motor devuelve Libre para todo, y eso no
    // es evidencia de nada.
    const lowerBound = startsLater ? null : start;
    const observed = [];

    for (let back = 0; back < LOOKBACK_DAYS; back++) {
        const date = addDays(today, -back);

        if (lowerBound && date < lowerBound) break;

        observed.push(getTurnoBase(profileName, keyFromDate(date)));
    }

    if (!observed.length) return null;

    // Fase que dice la ficha. Sirve para desempatar y como respaldo cuando el
    // calendario no calza con ninguna (por ejemplo, si le editaron la base de
    // hoy a un turno que no pertenece al ciclo).
    const configured = start
        ? mod4(
            rotationStartIndex("4turno", rotativa.firstTurn) +
            dayDiff(start, today)
        )
        : null;

    let best = null;

    for (let position = 0; position < 4; position++) {
        let streak = 0;

        while (
            streak < observed.length &&
            observed[streak] === CYCLE[mod4(position - streak)]
        ) {
            streak++;
        }

        const isBetter =
            !best ||
            streak > best.streak ||
            // Empate: gana la fase que dice la ficha. Sin este desempate, dos
            // trabajadores del mismo grupo podrian caer en columnas distintas
            // segun el orden del bucle.
            (streak === best.streak && position === configured);

        if (isBetter) best = { position, streak };
    }

    // Con el inicio por delante, lo unico que prueba que hace este ciclo es el
    // calce con su calendario, y se exige un CICLO COMPLETO: un calendario vacio
    // -todo Libre- calza por casualidad uno o dos dias contra las dos fases
    // libres, y con eso entraria al tablero gente cuya rotativa ni siquiera ha
    // empezado.
    if (startsLater && best.streak < CYCLE.length) return null;

    const position = best.streak > 0
        ? best.position
        : (configured ?? best.position);
    const streakDays = best.streak > 0 ? best.streak : 0;
    const letterIndex = cyclePositionAt(position, today, ANCHOR);

    return {
        profileName,
        letterIndex,
        letter: COLUMN_LETTERS[letterIndex],
        position,
        todayTurn: CYCLE[position],
        todayTurnLabel: CYCLE_TURN_LABEL[position],
        streakDays,
        historyDays: observed.length,
        // Cambio de grupo dentro de la ventana: la racha se corta antes de que
        // se acabe la historia disponible.
        changedGroup: streakDays > 0 && streakDays < observed.length,
        // No hay tres meses para mirar (ingreso reciente o rotativa nueva). El
        // requerimiento lo contempla: se usa lo que haya.
        shortHistory: observed.length < LOOKBACK_DAYS,
        unmatched: streakDays === 0
    };
}

/**
 * Cuanto lleva en el grupo, en la unidad que se lee de un vistazo.
 */
export function formatHolderStreak(days) {
    const value = Number(days) || 0;

    if (value <= 0) return "sin coincidencias";
    if (value < 14) return value === 1 ? "1 día" : `${value} días`;

    if (value < 60) {
        const weeks = Math.floor(value / 7);

        return weeks === 1 ? "1 semana" : `${weeks} semanas`;
    }

    const months = Math.round((value / 30.4) * 10) / 10;

    return `${String(months).replace(".", ",")} meses`;
}

/* ==========================================================================
   Colores por estamento / profesion
   ========================================================================== */

const ESTAMENTO_ORDER = [
    "Profesional",
    "Técnico",
    "Administrativo",
    "Auxiliar"
];

function profileEstamento(profile) {
    return String(profile?.estamento || "").trim() || "Sin estamento";
}

function profileProfession(profile) {
    return String(profile?.profession || "").trim() || "Sin profesión";
}

/**
 * Clave de color de un trabajador.
 *
 * Un color por estamento; dentro de Profesional, uno por profesion cuando hay
 * mas de una. Es lo que pidio el requerimiento y tiene sentido practico: en una
 * unidad los "profesionales" pueden ser enfermeria, kinesiologia y matroneria a
 * la vez, y verlos todos del mismo color no dice nada.
 */
export function holderColorKey(profile, splitProfessions) {
    const estamento = profileEstamento(profile);

    if (estamento === "Profesional" && splitProfessions) {
        return `Profesional · ${profileProfession(profile)}`;
    }

    return estamento;
}

/**
 * Posicion del estamento en el orden del listado. Uno fuera del catalogo -dato
 * antiguo- va al final y no al principio, que es lo que haria el -1 de indexOf.
 */
function estamentoRank(profile) {
    const index = ESTAMENTO_ORDER.indexOf(profileEstamento(profile));

    return index === -1 ? ESTAMENTO_ORDER.length : index;
}

/**
 * Orden dentro de la columna: primero el estamento -profesionales, tecnicos,
 * administrativos y al final auxiliares-, dentro de cada uno por profesion, y
 * dentro de la profesion por abecedario.
 *
 * Es el mismo criterio con el que se reparten los colores, asi que la columna se
 * lee por bloques de color en vez de alternarlos linea por linea.
 */
export function compareHolders(left, right) {
    return (
        estamentoRank(left.profile) - estamentoRank(right.profile) ||
        profileProfession(left.profile).localeCompare(
            profileProfession(right.profile),
            "es"
        ) ||
        String(left.profile.name).localeCompare(
            String(right.profile.name),
            "es"
        )
    );
}

/**
 * Asigna un indice de paleta a cada clave presente, en un orden estable: los
 * estamentos en el orden de siempre y, dentro de Profesional, las profesiones
 * alfabeticamente. Sin esto, agregar un trabajador podria recolorear la
 * pantalla entera.
 */
export function buildColorAssignments(profiles) {
    const professions = [...new Set(
        profiles
            .filter(profile => profileEstamento(profile) === "Profesional")
            .map(profileProfession)
    )].sort((left, right) => left.localeCompare(right, "es"));
    const splitProfessions = professions.length > 1;
    const keys = [];

    ESTAMENTO_ORDER.forEach(estamento => {
        const present = profiles.some(profile =>
            profileEstamento(profile) === estamento
        );

        if (!present) return;

        if (estamento === "Profesional" && splitProfessions) {
            professions.forEach(profession => {
                keys.push(`Profesional · ${profession}`);
            });
            return;
        }

        keys.push(estamento);
    });

    // Estamentos fuera del catalogo (datos antiguos) al final, para que no
    // desordenen los colores de los conocidos.
    [...new Set(profiles.map(profileEstamento))]
        .filter(estamento => !ESTAMENTO_ORDER.includes(estamento))
        .sort((left, right) => left.localeCompare(right, "es"))
        .forEach(estamento => keys.push(estamento));

    const colors = new Map();

    keys.forEach((key, index) => colors.set(key, index));

    return { colors, splitProfessions };
}

/* ==========================================================================
   Mapa de grupos para las otras pantallas
   ========================================================================== */

let groupMapMemo = { key: "", map: null };

// Claves cuyo cambio puede mover a alguien de grupo: su rotativa, su
// calendario, o la lista de perfiles.
const GROUP_MAP_PREFIXES = [
    "rotativa_",
    "data_",
    "baseData_",
    "shift_",
    "shiftAssignmentHistory_"
];
const GROUP_MAP_KEYS = new Set(["profiles", "swaps", "shiftMoves"]);

/**
 * Nombre -> letra del grupo, para quienes hacen 4to turno.
 *
 * Se calcula UNA vez y se guarda: cada trabajador mira hasta 92 dias de
 * calendario, y preguntarlo por celda congelaria una pantalla que se repinta
 * al cambiar de semana.
 *
 * La letra esta anclada a una fecha fija, asi que no cambia de un dia para
 * otro: basta con rehacer el mapa cuando cambia el dia o los datos de los que
 * sale.
 */
export function getShiftGroupMap(today = new Date()) {
    const memoKey = keyFromDate(today);

    if (groupMapMemo.key === memoKey && groupMapMemo.map) {
        return groupMapMemo.map;
    }

    const map = new Map();

    getProfiles()
        .filter(isProfileActive)
        .forEach(profile => {
            const placement = detectHolderPlacement(profile.name, today);

            if (placement) map.set(profile.name, placement.letter);
        });

    groupMapMemo = { key: memoKey, map, gaps: null };

    return map;
}

/**
 * Que le falta a cada grupo frente a los demas, por estamento.
 *
 * Es la misma comparacion del tablero de Titulares, disponible para las otras
 * pantallas. Se guarda junto al mapa de grupos porque sale de el y se invalida
 * con lo mismo.
 */
export function getShiftGroupGaps(today = new Date()) {
    const map = getShiftGroupMap(today);

    if (groupMapMemo.gaps) return groupMapMemo.gaps;

    const byName = new Map(
        getProfiles().map(profile => [profile.name, profile])
    );
    const columns = COLUMN_LETTERS.map(letter => ({
        letter,
        workers: [...map.entries()]
            .filter(([, group]) => group === letter)
            .map(([name]) => ({ profile: byName.get(name) }))
            .filter(item => item.profile)
    }));
    const gaps = new Map();

    buildEstamentoGaps(columns).forEach((columnGaps, index) => {
        if (columnGaps.length) gaps.set(COLUMN_LETTERS[index], columnGaps);
    });

    groupMapMemo.gaps = gaps;

    return gaps;
}

export function invalidateShiftGroupMap() {
    groupMapMemo = { key: "", map: null };
}

function affectsShiftGroups(keys = []) {
    return keys.some(key => {
        const clean = String(key || "");

        return GROUP_MAP_KEYS.has(clean) ||
            GROUP_MAP_PREFIXES.some(prefix => clean.startsWith(prefix));
    });
}

if (typeof window !== "undefined") {
    const alCambiar = event => {
        if (affectsShiftGroups(event.detail?.keys || [])) {
            invalidateShiftGroupMap();
        }
    };

    window.addEventListener("proturnos:persistenceChanged", alCambiar);
    // Los cambios de otro supervisor entran por aqui.
    window.addEventListener("proturnos:firebaseAppState", event => {
        if (event.detail?.type !== "app-state-entries-applied") return;

        alCambiar({ detail: { keys: event.detail.keys || [] } });
    });
}

/* ==========================================================================
   Cupos disponibles
   ========================================================================== */

function countEstamento(column, estamento) {
    return column.workers.filter(
        worker => profileEstamento(worker.profile) === estamento
    ).length;
}

/**
 * Estamentos presentes en el tablero, en el orden en que se muestran: primero
 * los del catalogo y despues los que no lo estan -datos antiguos-, igual que
 * como ordena compareHolders dentro de la columna.
 */
function estamentoBuckets(columns) {
    const present = [...new Set(
        columns.flatMap(column =>
            column.workers.map(worker => profileEstamento(worker.profile))
        )
    )];
    const known = ESTAMENTO_ORDER.filter(estamento => present.includes(estamento));
    const unknown = present
        .filter(estamento => !ESTAMENTO_ORDER.includes(estamento))
        .sort((left, right) => left.localeCompare(right, "es"));

    return [...known, ...unknown];
}

/**
 * Cuantos trabajadores le faltan a cada grupo, estamento por estamento.
 *
 * La referencia es el grupo MEJOR DOTADO de ese estamento: si tres grupos
 * tienen 4 auxiliares y el cuarto tiene 2, a ese cuarto le faltan 2. Es una
 * regla que no esconde huecos -cualquier grupo bajo el maximo los muestra- y
 * que el supervisor puede reproducir de cabeza mirando las cuatro columnas.
 *
 * Los estamentos fuera del catalogo quedan fuera de la comparacion: decir que a
 * un grupo "le falta un sin estamento" no le sirve a nadie, y el hueco real
 * aparece igual cuando ese trabajador tenga su ficha completa.
 */
export function buildEstamentoGaps(columns) {
    // La referencia es del estamento, no de la columna: se calcula una vez y
    // las cuatro se miden contra ella. Un estamento que no existe en la unidad
    // no entra -no hay contra que compararlo-, y el orden del catalogo se
    // conserva porque un Map recuerda en que orden se llenó.
    const reference = new Map();

    ESTAMENTO_ORDER.forEach(estamento => {
        const most = Math.max(
            ...columns.map(column => countEstamento(column, estamento))
        );

        if (most > 0) reference.set(estamento, most);
    });

    return columns.map(column => {
        // Un grupo sin NINGUN titular no esta corto de personal: o no se usa en
        // esta unidad, o el calendario todavia no alcanza para reconocerlo.
        // Llenarlo de cupos seria ruido, y la columna ya dice que esta vacia.
        if (!column.workers.length) return [];

        return [...reference].reduce((gaps, [estamento, most]) => {
            const count = countEstamento(column, estamento);

            if (count < most) {
                gaps.push({
                    estamento,
                    count,
                    reference: most,
                    missing: most - count
                });
            }

            return gaps;
        }, []);
    });
}

/**
 * Contenido de la columna en orden de pantalla: cada bloque de estamento con
 * sus titulares y, cerrando el bloque, un cupo por cada trabajador que falta.
 *
 * Se recorre la lista de estamentos en vez de insertar dentro de la lista ya
 * ordenada porque un grupo puede no tener NINGUN trabajador del estamento que
 * le falta, y entonces no habria bloque donde colgar el cupo.
 */
function columnItems(workers, gaps, buckets) {
    const items = [];

    buckets.forEach(estamento => {
        workers
            .filter(worker => profileEstamento(worker.profile) === estamento)
            .forEach(worker => items.push({ type: "worker", worker }));

        const gap = gaps.find(item => item.estamento === estamento);

        if (!gap) return;

        for (let i = 0; i < gap.missing; i += 1) items.push({ type: "gap", gap });
    });

    return items;
}

/* ==========================================================================
   Armado del tablero
   ========================================================================== */

/**
 * Recorre los trabajadores de 4to turno y los reparte en las cuatro columnas.
 *
 * El barrido cede el hilo entre trabajador y trabajador: cada uno mira hasta 92
 * dias de calendario, y en una unidad grande hacerlo de corrido congelaria la
 * pagina.
 */
export async function buildShiftHolders(today = new Date()) {
    const profiles = getProfiles().filter(isProfileActive);
    const placements = [];

    await runCooperativeRange(0, profiles.length - 1, index => {
        const profile = profiles[index];
        const placement = detectHolderPlacement(profile.name, today);

        if (placement) placements.push({ ...placement, profile });
    });

    const { colors, splitProfessions } = buildColorAssignments(
        placements.map(item => item.profile)
    );
    const columns = COLUMN_LETTERS.map((letter, letterIndex) => {
        const workers = placements
            .filter(item => item.letterIndex === letterIndex)
            .map(item => ({
                ...item,
                colorKey: holderColorKey(item.profile, splitProfessions),
                colorIndex: colors.get(
                    holderColorKey(item.profile, splitProfessions)
                ) ?? 0
            }))
            .sort(compareHolders);
        // El turno de hoy se saca de cualquiera de sus integrantes: por
        // definicion todos van en la misma fase. Si la columna esta vacia se
        // proyecta desde el ancla, para que el encabezado no quede mudo.
        const position = workers.length
            ? workers[0].position
            : cyclePositionAt(letterIndex, ANCHOR, today);

        return {
            letter,
            letterIndex,
            todayTurnLabel: CYCLE_TURN_LABEL[position],
            todayTurn: CYCLE[position],
            workers
        };
    });

    const gaps = buildEstamentoGaps(columns);
    const buckets = estamentoBuckets(columns);

    columns.forEach((column, index) => {
        column.gaps = gaps[index];
        column.items = columnItems(column.workers, gaps[index], buckets);
    });

    return {
        columns,
        total: placements.length,
        legend: [...colors.entries()]
            .sort((left, right) => left[1] - right[1])
            .map(([key, index]) => ({ key, index })),
        splitProfessions
    };
}

/* ==========================================================================
   Pasar a un trabajador de grupo

   Un grupo NO es un dato guardado: es la fase del ciclo que el calendario del
   trabajador viene haciendo. Asi que sumar a alguien a otro grupo es cambiarle
   la rotativa, y lo unico que hay que preguntar es DESDE CUANDO: con la fecha y
   la columna de destino, el turno con el que parte sale solo.
   ========================================================================== */

// Vocabulario de `rotationStartIndex("4turno", ...)`, en el orden de las fases.
const ROTATION_FIRST_TURNS = ["larga", "noche", "libre1", "libre2"];
const FIRST_TURN_LABEL = [
    "Largo",
    "Noche",
    "Primer libre",
    "Segundo libre"
];

/**
 * Con que turno parte quien se suma a `letter` el dia `date`.
 *
 * La columna es una FASE anclada a una fecha fija, asi que cualquier dia esa
 * columna esta en una fase concreta y el que entra tiene que partir en esa. Por
 * eso el cuadro no pregunta el turno: preguntarlo dejaria elegir uno que pondria
 * al trabajador en otra columna, contradiciendo el arrastre.
 */
export function firstTurnForColumnAt(letter, date) {
    const letterIndex = COLUMN_LETTERS.indexOf(String(letter || "").trim());

    if (letterIndex === -1 || !(date instanceof Date)) return null;

    const position = cyclePositionAt(letterIndex, ANCHOR, date);

    return {
        position,
        firstTurn: ROTATION_FIRST_TURNS[position],
        label: FIRST_TURN_LABEL[position],
        turno: CYCLE[position]
    };
}

const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

/**
 * Que se perderia si la nueva rotativa arranca en `fromDate`.
 *
 * Cambiar la rotativa REESCRIBE el calendario desde esa fecha, y en el camino
 * se lleva los permisos, las ausencias, las devoluciones de horas y los cambios
 * de turno de ese tramo. Se cuentan para poder decirlo con cifras en vez de en
 * prosa.
 *
 * NO se cuentan los turnos de `data_`/`baseData_`: casi todos son los dias que
 * pinta la propia rotativa, y sumarlos daria una cifra enorme y sin sentido.
 * Que el calendario se repinta se dice aparte, con palabras.
 *
 * Las claves se leen DIRECTO: getAdminDays y compania miran el perfil abierto
 * en Perfiles, y aqui se pregunta por otro trabajador.
 */
export function countAffectedFrom(profileName, fromDate, holidays = {}) {
    if (!profileName || !(fromDate instanceof Date)) return [];

    const desde = key => {
        const date = keyToDate(key);

        return !Number.isNaN(date.getTime()) && date >= fromDate;
    };
    const mapa = prefix => getJSON(`${prefix}${profileName}`, {});
    const maps = {
        admin: mapa("admin_"),
        legal: mapa("legal_"),
        comp: mapa("comp_"),
        absences: mapa("absences_")
    };
    // Lo que NO se sobreescribe tampoco se anuncia como perdida. El recuadro
    // contaba las licencias medicas y los bloques a caballo, que justamente se
    // conservan, y avisaba de una perdida que no iba a ocurrir. Se llama a la
    // MISMA funcion que decide el borrado para que el aviso y el efecto no
    // puedan discrepar nunca.
    const conservadas = protectedLeaveKeys(maps, fromDate);
    const claves = name => Object.keys(maps[name])
        .filter(desde)
        .filter(key => !conservadas[name].has(key));
    const contar = name => claves(name).length;
    // F. Legal y F. Compensatorio se piden y se devuelven por dia HABIL: un
    // bloque del 7 al 21 de diciembre son 15 dias corridos pero 10 de saldo, y
    // contar los corridos avisaba de una perdida que no existe. Es el mismo
    // criterio de countBusinessKeys, que es quien devuelve el saldo al borrar.
    const contarHabiles = name => claves(name).filter(key => {
        const date = keyToDate(key);

        return isBusinessDay(date, holidays[date.getFullYear()] || {});
    }).length;
    // El administrativo se guarda como dia entero o medio: contar las claves
    // convertiria dos medios dias en dos dias.
    const admin = claves("admin")
        .reduce((total, key) => total + (maps.admin[key] === 1 ? 1 : 0.5), 0);
    const iso = toISODate(fromDate);
    const cambios = getSwaps().filter(swap =>
        !cambioEstaAnulado(swap) &&
        (swap.from === profileName || swap.to === profileName) &&
        (String(swap.fecha || "") >= iso || String(swap.devolucion || "") >= iso)
    ).length;

    return [
        { label: "P. Administrativo", count: admin },
        { label: "F. Legal", count: contarHabiles("legal") },
        { label: "F. Compensatorio", count: contarHabiles("comp") },
        // Las licencias no se sobreescriben nunca, asi que lo que queda aqui
        // son las demas ausencias: gremial, capacitacion, permiso sin goce.
        { label: "Ausencias", count: contar("absences") },
        {
            label: "Devoluciones de horas",
            count: Object.keys(getHourReturns(profileName) || {})
                .filter(desde).length
        },
        { label: "Cambios de turno", count: cambios }
    ].filter(item => item.count > 0);
}

/** Una celda del calendario del trabajador. */
function moveDayHTML(profileName, date, selectedKey) {
    const key = keyFromDate(date);
    const turno = Number(getTurnoBase(profileName, key)) || TURNO.LIBRE;
    const clase = turnClass(turno);
    const sigla = turno === TURNO.LARGA
        ? "L"
        : turno === TURNO.NOCHE ? "N" : "·";
    const estado = key === selectedKey
        ? `mini-selected mini-turn-${clase}`
        : `mini-on mini-turn-${clase}`;

    return `
        <div class="mini-day ${estado}" data-tt-day="${escapeHTML(key)}"
            title="${escapeHTML(`${date.getDate()} de ${MESES[date.getMonth()]}`)}">
            <span>${date.getDate()}</span>
            <small>${sigla}</small>
        </div>`;
}

/* ==========================================================================
   Aplicar el cambio de grupo
   ========================================================================== */

// Escribir la rotativa vive en main.js: usa cleanupFutureSchedule,
// applyDraftRotation y el historial, que son privados de ahi. Y main.js importa
// ESTE modulo, de modo que no se puede importar de vuelta. Se inyecta, igual
// que setCalendarSelectionHandler o setAutoCoverageCandidateProvider.
let groupChangeApplier = null;

export function setGroupChangeApplier(applier) {
    groupChangeApplier = typeof applier === "function" ? applier : null;
}

/**
 * Cuadro de "pasar a otro grupo": el calendario del trabajador, la fecha desde
 * la que empieza en la nueva rotativa, y lo que se perderia.
 *
 * Confirmar solo se habilita con una fecha elegida: sin ella no hay desde
 * cuando escribir.
 */
/**
 * Feriados de los anios en que el trabajador tiene F. Legal o F. Compensatorio.
 * Sin ellos el recuento de lo que se perderia contaria dias corridos.
 */
async function loadLeaveHolidays(profileName) {
    const years = new Set();

    ["legal_", "comp_"].forEach(prefix => {
        Object.keys(getJSON(`${prefix}${profileName}`, {})).forEach(key => {
            const date = keyToDate(key);

            if (!Number.isNaN(date.getTime())) years.add(date.getFullYear());
        });
    });

    const map = {};

    for (const year of years) {
        map[year] = await fetchHolidays(year);
    }

    return map;
}

function openGroupChangeDialog(profileName, fromLetter, toLetter) {
    const backdrop = document.createElement("div");
    const hoy = new Date();
    let cursor = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    let selected = null;
    let holidays = {};

    backdrop.className = "turn-change-dialog-backdrop";

    const render = () => {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const dias = new Date(year, month + 1, 0).getDate();
        // La semana parte el lunes, como el resto de los calendarios.
        const primero = (new Date(year, month, 1).getDay() + 6) % 7;
        const selectedKey = selected ? keyFromDate(selected) : "";
        const celdas = [];

        for (let i = 0; i < primero; i++) {
            celdas.push('<div class="mini-day mini-spacer" aria-hidden="true"></div>');
        }

        for (let d = 1; d <= dias; d++) {
            celdas.push(
                moveDayHTML(profileName, new Date(year, month, d), selectedKey)
            );
        }

        const parte = selected ? firstTurnForColumnAt(toLetter, selected) : null;
        const perdidas = selected
            ? countAffectedFrom(profileName, selected, holidays)
            : [];

        backdrop.innerHTML = `
            <section class="turn-change-dialog tt-move-dialog" role="dialog"
                aria-modal="true" aria-labelledby="ttMoveTitle">
                <div class="tt-move-body">
                <strong id="ttMoveTitle">Pasar a otro grupo</strong>
                <p>
                    <b>${escapeHTML(profileName)}</b> pasa del grupo
                    <b>${escapeHTML(fromLetter)}</b> al grupo
                    <b>${escapeHTML(toLetter)}</b>: se suma a esa rotativa como
                    uno más.
                </p>
                <p class="tt-move-note">
                    Elige <b>desde qué fecha</b> empieza en la nueva rotativa.
                    El turno con el que parte lo determina el grupo de destino,
                    así que no hay que elegirlo.
                </p>

                <div class="tt-move-cal">
                    <div class="tt-move-cal-head">
                        <button class="ghost-button" type="button" data-tt-month="-1"
                            aria-label="Mes anterior">&lt;</button>
                        <b>${escapeHTML(`${MESES[month]} de ${year}`)}</b>
                        <button class="ghost-button" type="button" data-tt-month="1"
                            aria-label="Mes siguiente">&gt;</button>
                    </div>
                    <div class="mini-weekdays">
                        <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
                    </div>
                    <div class="mini-grid">${celdas.join("")}</div>
                </div>

                ${parte ? `
                    <p class="tt-move-pick">
                        Desde el
                        <b>${escapeHTML(`${selected.getDate()} de ${MESES[selected.getMonth()]} de ${selected.getFullYear()}`)}</b>
                        parte con <b>${escapeHTML(parte.label)}</b>, que es lo
                        que hace el grupo ${escapeHTML(toLetter)} ese día.
                    </p>
                ` : `
                    <p class="tt-move-note">Todavía no has elegido la fecha.</p>
                `}

                ${selected ? `
                    <div class="tt-move-warn">
                        <b>Su calendario se reescribe desde esa fecha.</b>
                        ${perdidas.length ? `
                            Se perderá lo que tenga aplicado de ahí en adelante:
                            <ul class="tt-move-losses">
                                ${perdidas.map(item => `
                                    <li>${escapeHTML(item.label)}:
                                    <b>${item.count}</b></li>`).join("")}
                            </ul>
                        ` : `
                            No tiene permisos, ausencias ni cambios de turno
                            aplicados después de esa fecha.
                        `}
                    </div>
                ` : ""}

                </div>

                <div class="turn-change-dialog__actions">
                    <button class="primary-button" type="button" data-tt-apply${
                        selected && groupChangeApplier ? "" : " disabled"
                    }>
                        Cambiar de grupo
                    </button>
                    <button class="secondary-button" type="button" data-tt-close>
                        Cerrar
                    </button>
                </div>
            </section>`;

        backdrop.querySelector("[data-tt-close]")
            .addEventListener("click", close);

        backdrop.querySelectorAll("[data-tt-month]").forEach(button => {
            button.addEventListener("click", () => {
                cursor = new Date(
                    cursor.getFullYear(),
                    cursor.getMonth() + Number(button.dataset.ttMonth),
                    1
                );
                render();
            });
        });

        backdrop.querySelectorAll("[data-tt-day]").forEach(cell => {
            cell.addEventListener("click", () => {
                selected = keyToDate(cell.dataset.ttDay);
                render();
            });
        });

        const apply = backdrop.querySelector("[data-tt-apply]");

        if (apply && !apply.disabled) {
            apply.addEventListener("click", async () => {
                const turno = firstTurnForColumnAt(toLetter, selected);

                if (!turno) return;

                // Se cierra ANTES de aplicar: al terminar se repinta el tablero
                // entero y el cuadro quedaria flotando sobre otro tablero.
                close();
                await groupChangeApplier({
                    profile: profileName,
                    startISO: toISODate(selected),
                    firstTurn: turno.firstTurn,
                    toLetter
                });
                await renderShiftHoldersPanel();
            });
        }
    };

    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
    };
    const onKeydown = event => {
        if (event.key === "Escape") close();
    };

    render();
    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);

    // Los feriados llegan por red la primera vez. El cuadro ya se ve: cuando
    // llegan se repinta, y hasta entonces el recuento solo descuenta fines de
    // semana. No se espera para abrir porque la fecha aun no esta elegida.
    void loadLeaveHolidays(profileName).then(map => {
        holidays = map;

        if (backdrop.isConnected) render();
    });
}

let draggedHolder = null;

function clearDragOver(root) {
    root.querySelectorAll(".tt-column.is-drag-over").forEach(column => {
        column.classList.remove("is-drag-over");
    });
}

function wireBoardDrag(root) {
    // El tablero tambien se pinta fuera del navegador -las pruebas capturan el
    // HTML con un nodo de mentira-, y ahi no hay nada que enlazar. Sin esta
    // guarda, agregar el arrastre rompia el render entero en vez de quedarse
    // sin gesto.
    if (typeof root?.querySelectorAll !== "function") return;

    root.querySelectorAll("[data-tt-worker]").forEach(card => {
        card.ondragstart = event => {
            draggedHolder = {
                name: card.dataset.ttWorker,
                from: card.dataset.ttFrom
            };
            card.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedHolder.name);
        };

        card.ondragend = () => {
            card.classList.remove("is-dragging");
            clearDragOver(root);
            draggedHolder = null;
        };
    });

    root.querySelectorAll("[data-tt-column]").forEach(column => {
        const letter = column.dataset.ttColumn;
        // Soltar en la MISMA columna no cambia nada. No se acepta el arrastre,
        // asi el cursor lo dice ANTES de soltar en vez de abrir un cuadro que
        // no tiene nada que ofrecer.
        const accepts = () => Boolean(draggedHolder) && draggedHolder.from !== letter;

        column.ondragover = event => {
            if (!accepts()) return;

            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            column.classList.add("is-drag-over");
        };

        column.ondragleave = () => column.classList.remove("is-drag-over");

        column.ondrop = event => {
            event.preventDefault();
            column.classList.remove("is-drag-over");

            if (!accepts()) return;

            const moved = draggedHolder;

            draggedHolder = null;
            openGroupChangeDialog(moved.name, moved.from, letter);
        };
    });
}

/* ==========================================================================
   Render
   ========================================================================== */

function turnClass(turno) {
    if (Number(turno) === TURNO.LARGA) return "larga";
    if (Number(turno) === TURNO.NOCHE) return "noche";

    return "libre";
}

function workerCardHTML(worker) {
    const profession = profileProfession(worker.profile);
    const notes = [];

    if (worker.unmatched) {
        notes.push("sin calce con el ciclo");
    } else {
        notes.push(formatHolderStreak(worker.streakDays));
    }

    if (worker.changedGroup) notes.push("cambió de grupo");

    const warn = worker.changedGroup || worker.unmatched || worker.shortHistory;

    return `
        <li class="tt-worker tt-color-${worker.colorIndex}"
            draggable="true"
            data-tt-worker="${escapeHTML(worker.profile.name)}"
            data-tt-from="${escapeHTML(worker.letter)}"
            title="Arrástralo a otro grupo para sumarlo a esa rotativa">
            <span class="tt-worker-name">${escapeHTML(worker.profile.name)}</span>
            <span class="tt-worker-meta">${escapeHTML(profession)}</span>
            <span class="tt-worker-note ${warn ? "is-warn" : ""}">${
                warn ? "⚠ " : ""
            }${escapeHTML(notes.join(" · "))}</span>
        </li>`;
}

/**
 * Cupo disponible. Se dibuja con el mismo lenguaje que el hueco de reemplazo de
 * la programacion semanal -caja al aire y una insignia roja- para que se lea
 * como "aqui falta alguien" y no como un trabajador mas de la lista.
 */
function gapCardHTML(gap) {
    const detalle = `${gap.estamento}: este grupo tiene ${gap.count} y el grupo con más tiene ${gap.reference}.`;

    return `
        <li class="tt-vacancy" title="${escapeHTML(detalle)}">
            <span class="tt-vacancy-badge" aria-hidden="true">!</span>
            <span class="tt-vacancy-body">
                <span class="tt-vacancy-title">Cupo disponible</span>
                <span class="tt-vacancy-meta">${escapeHTML(gap.estamento)}</span>
            </span>
        </li>`;
}

function itemHTML(item) {
    return item.type === "gap" ? gapCardHTML(item.gap) : workerCardHTML(item.worker);
}

function columnHTML(column) {
    const items = column.items || column.workers.map(worker => ({
        type: "worker",
        worker
    }));
    const body = items.length
        ? `<ul class="tt-list">${items.map(itemHTML).join("")}</ul>`
        : `<p class="tt-empty">Sin titulares en este grupo.</p>`;

    return `
        <section class="tt-column" data-tt-column="${escapeHTML(column.letter)}">
            <header class="tt-column-head tt-column-head--${turnClass(column.todayTurn)}">
                <span class="tt-letter">${escapeHTML(column.letter)}</span>
                <span class="tt-today">hoy ${escapeHTML(column.todayTurnLabel)}</span>
                <span class="tt-count">${column.workers.length}</span>
            </header>
            ${body}
        </section>`;
}

function legendHTML(legend) {
    if (!legend.length) return "";

    return `
        <div class="tt-legend">
            ${legend.map(item => `
                <span class="tt-legend-item tt-color-${item.index}">
                    <i class="tt-legend-dot"></i>${escapeHTML(item.key)}
                </span>`).join("")}
        </div>`;
}

/**
 * La explicacion de los cupos solo aparece cuando hay alguno: si los cuatro
 * grupos estan parejos, no hay nada que explicar.
 */
function gapNoteHTML(board) {
    const missing = board.columns.reduce(
        (total, column) => total + (column.gaps || []).reduce(
            (sum, gap) => sum + gap.missing, 0
        ),
        0
    );

    if (!missing) return "";

    return `
            <p class="tt-note tt-note--gaps">
                Los recuadros con <strong>!</strong> son cupos disponibles: ese
                grupo tiene menos trabajadores de ese estamento que el grupo
                mejor dotado.
            </p>`;
}

function boardHTML(board, today) {
    const fecha = today.toLocaleDateString("es-CL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    if (!board.total) {
        return `
            <div class="tt-root">
                <header class="tt-head">
                    <h2>Titulares de Turnos</h2>
                    <p>Sin trabajadores de 4° turno activos en la unidad.</p>
                </header>
            </div>`;
    }

    return `
        <div class="tt-root">
            <header class="tt-head">
                <h2>Titulares de Turnos</h2>
                <p>
                    Los cuatro grupos del 4° turno, según la rotativa que cada
                    trabajador viene haciendo en los últimos 3 meses.
                    <span class="tt-head-date">${escapeHTML(fecha)}</span>
                </p>
            </header>
            ${legendHTML(board.legend)}
            <div class="tt-board">
                ${board.columns.map(columnHTML).join("")}
            </div>
            <p class="tt-note">
                Las letras no cambian: un trabajador conserva su columna aunque
                el turno del día rote. El subtítulo dice qué le toca hoy a cada
                grupo.
            </p>
            ${gapNoteHTML(board)}
        </div>`;
}

export async function renderShiftHoldersPanel() {
    const root = document.getElementById("shiftHoldersPanel");

    if (!root) return;

    root.innerHTML = `<div class="tt-root"><p class="tt-loading">Revisando el calendario de los últimos 3 meses…</p></div>`;

    const today = new Date();
    const board = await buildShiftHolders(today);
    const node = document.getElementById("shiftHoldersPanel");

    // La vista pudo cambiar mientras se calculaba.
    if (!node) return;

    node.innerHTML = boardHTML(board, today);
    wireBoardDrag(node);
}
