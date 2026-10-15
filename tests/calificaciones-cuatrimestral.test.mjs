import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    FORM_HEADER,
    FORM_PERIOD_LINES,
    qualificationFormHTML
} from "../js/qualificationForm.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// El menu de Calificaciones tiene DOS instrumentos y es facil volver a
// mezclarlos:
//
//   - el informe CUATRIMESTRAL, tres veces al ano, con apreciaciones escritas
//     y SIN notas, en el formulario que reparte la unidad de personal;
//   - la calificacion ANUAL de septiembre, que si lleva notas, coeficientes,
//     puntaje y lista.
//
// Estas pruebas cuidan esa separacion y la fidelidad del papel.

/* ==========================================================================
   El formulario impreso
   ========================================================================== */

const SAMPLE = {
    folio: "ABC123",
    periodId: "jan-apr",
    year: 2026,
    profile: {
        name: "Soto Herrera, Amanda",
        planta: "Administrativos",
        unidad: "Imagenologia"
    },
    supervisor: { name: "Reyes Fuentes, Carolina", cargo: "Coordinadora" },
    factors: [
        {
            title: "RENDIMIENTO",
            formText: "Mide el trabajo ejecutado durante el periodo",
            text: "Cumple con la carga asignada."
        }
    ]
};

test("el impreso lleva el membrete y los titulos del formulario de personal", () => {
    const html = qualificationFormHTML(SAMPLE);

    assert.match(html, /MINISTERIO DE SALUD/);
    assert.match(html, /HOSPITAL CLAUDIO VICU/);
    assert.match(html, /FORMULARIO DE EVALUACI[OÓ]N CUATRIMESTRAL/);
    assert.match(html, /ANTECEDENTES PERSONALES/);
    assert.match(html, /FACTORES A EVALUAR/);
    assert.match(html, /NOTIFICACION AL FUNCIONARIO/);
    assert.match(html, /RECEPCION DE OFICINA DE PERSONAL/);
    assert.match(html, /Firma del Funcionario/);
    assert.match(html, /Firma y Timbre/);
});

test("se conservan las erratas del documento original", async () => {
    const html = qualificationFormHTML(SAMPLE);
    const source = await read("../js/qualifications.js");

    // El papel que archiva personal tiene que ser el que ellos reparten. Si
    // algun dia lo corrigen, se corrige aqui y esta prueba avisa.
    //
    // El titulo en plural vive en la plantilla; la errata del tercer factor
    // ("la conducta del funcionamiento" por "del funcionario") viaja en su
    // `formText`, que es lo que se imprime bajo el nombre del factor.
    assert.match(html, /ANTECEDENTES JEFE DIRECTOS/);
    assert.match(source, /Evaluar la conducta del funcionamiento en el cumplimiento/);
});

test("el impreso NO inventa casilleros de nota", () => {
    const html = qualificationFormHTML({
        ...SAMPLE,
        factors: [
            { title: "RENDIMIENTO", formText: "Mide", text: "Cumple." },
            { title: "CONDICIONES PERSONALES", formText: "Evaluar", text: "Buena." },
            { title: "COMPORTAMIENTO DEL FUNCIONARIO", formText: "Evaluar", text: "Correcto." }
        ]
    });

    // El original es texto con guiones bajos: no tiene tablas ni columnas de
    // nota. Agregarlas seria otro documento.
    assert.doesNotMatch(html, /<table|<th\b|<td\b/);
    assert.doesNotMatch(html, />\s*Nota\s*</);
    assert.doesNotMatch(html, />\s*Fundamento\s*</);
    assert.doesNotMatch(html, /Puntaje|Lista N|coeficiente/i);
});

test("el periodo evaluado va marcado con X y los otros dos en blanco", () => {
    const html = qualificationFormHTML(SAMPLE);
    const marks = html.match(/class="mark">([^<]*)</g) || [];

    assert.equal(marks.length, FORM_PERIOD_LINES.length);
    assert.equal(marks.filter(mark => mark.includes("X")).length, 1);
    assert.match(html, /Enero a abril del a[nñ]o[\s\S]{0,80}2026/);
});

test("el papel conserva las tres lineas, aunque el menu ofrezca dos", async () => {
    // El formulario es la reproduccion del documento del ministerio: alli estan
    // los tres cuatrimestres y se marca el que corresponde. Que la aplicacion
    // ya no ofrezca mayo a agosto -lo cubre la calificacion anual- no cambia el
    // papel, y borrarle la linea lo haria distinto del oficial.
    const { qualificationPeriods } = await import("../js/qualifications.js");

    assert.equal(FORM_PERIOD_LINES.length, 3);
    assert.ok(
        FORM_PERIOD_LINES.some(period => period.id === "may-aug"),
        "la linea de mayo a agosto se queda en el papel"
    );
    assert.equal(qualificationPeriods(2026).length, 2);
    assert.equal(
        qualificationPeriods(2026).some(period => period.id === "may-aug"),
        false
    );

    // Y sin periodo marcado, el papel sale igual: ninguna X.
    const sinMarcar = qualificationFormHTML({ ...SAMPLE, periodId: "may-aug" });
    const marcas = sinMarcar.match(/class="mark">([^<]*)</g) || [];

    assert.equal(marcas.filter(marca => marca.includes("X")).length, 1);
});

test("el texto escrito por la jefatura viaja al papel, escapado", () => {
    const html = qualificationFormHTML({
        ...SAMPLE,
        factors: [{
            title: "RENDIMIENTO",
            formText: "Mide",
            text: "Entrego <b>tarde</b> el informe & lo corrigio."
        }]
    });

    assert.match(html, /Entrego &lt;b&gt;tarde&lt;\/b&gt; el informe &amp; lo corrigio\./);
});

test("el membrete esta en un solo lugar para poder adaptarlo a otra unidad", () => {
    assert.ok(Array.isArray(FORM_HEADER.lines) && FORM_HEADER.lines.length === 4);
    assert.match(FORM_HEADER.establishment, /Claudio Vicu/);
});

/* ==========================================================================
   La separacion entre los dos instrumentos
   ========================================================================== */

test("el informe cuatrimestral se guarda sin notas", async () => {
    const source = await read("../js/qualifications.js");

    // Las apreciaciones son lo unico del cuatrimestre; las notas quedan para
    // la anual. Si esto se pierde, vuelven los seis campos de nota por
    // trabajador y por cuatrimestre, que es lo que se quiso sacar.
    assert.match(source, /function normalizeAppraisals/);
    assert.match(source, /appraisals: normalizeAppraisals\(record\.appraisals\)/);
    assert.match(source, /factors: annual \? factors : previous\.factors/);
    assert.match(source, /appraisals: annual \? previous\.appraisals : appraisals/);
});

test("la calificacion anual es un periodo mas del ciclo", async () => {
    const source = await read("../js/qualifications.js");

    assert.match(source, /export const ANNUAL_PERIOD_ID = "anual"/);
    assert.match(source, /export function annualPeriod/);
    assert.match(source, /export function qualificationCycleSteps/);
    // La anual se apoya en los tres informes ya escritos (art. 19).
    assert.match(source, /function quarterReportsHTML/);
});

test("los antecedentes se reparten por factor y se copian al texto", async () => {
    const source = await read("../js/qualifications.js");

    assert.match(source, /function evidenceByFactor/);
    assert.match(source, /data-qual-insert=/);
    // Se agrega al final, no reemplaza lo escrito.
    assert.match(source, /current \? `\$\{current\} \$\{item\.text\}` : item\.text/);
});

test("el escaneado firmado cierra el circuito", async () => {
    const [source, attachments, functionsIndex] = await Promise.all([
        read("../js/qualifications.js"),
        read("../js/attachmentUtils.js"),
        read("../functions/index.js")
    ]);

    assert.match(source, /function normalizeScan/);
    assert.match(source, /moduleId: "qualifications"/);
    // El escaneo manda sobre el estado guardado: es la prueba de que se firmo.
    assert.match(source, /if \(record\.scan\) return STATUS_ARCHIVED/);
    // Sin esto, attachmentUtils rechaza la subida en silencio.
    assert.match(attachments, /"qualifications"/);
    assert.match(attachments, /uploadQualificationAttachment/);
    assert.match(attachments, /deleteQualificationAttachment/);
    assert.match(functionsIndex, /exports\.uploadQualificationAttachment\s*=\s*onCall/);
    assert.match(functionsIndex, /exports\.deleteQualificationAttachment\s*=\s*onCall/);
});

test("imprimir no manda la pagina entera a la impresora", async () => {
    const [source, form] = await Promise.all([
        read("../js/qualifications.js"),
        read("../js/qualificationForm.js")
    ]);

    // `window.print()` imprimia el panel completo. Ahora se arma el documento
    // y se manda a un iframe oculto, como la programacion semanal.
    assert.doesNotMatch(source, /window\.print\(\)/);
    assert.match(source, /printQualificationForm\(/);
    assert.match(form, /export function printQualificationForm/);
    assert.match(form, /view\.onafterprint = remove/);
});

test("el estado sigue el camino del papel", async () => {
    const source = await read("../js/qualifications.js");

    assert.match(source, /const STATUS_PRINTED = "printed"/);
    assert.match(source, /const STATUS_ARCHIVED = "archived"/);
    // El estado viejo se sigue leyendo para no invalidar lo ya guardado.
    assert.match(source, /status === STATUS_PRINTED \|\| status === STATUS_EVALUATED/);
});

test("toda clase qual-* que se emite tiene estilo", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // Misma guardia que en Informaciones: una clase sin regla no da error, solo
    // se ve mal.
    const emitted = new Set();
    const classAttr = /class="([^"]*)"/g;
    let match;

    while ((match = classAttr.exec(source))) {
        match[1]
            .split(/\s+/)
            .map(name => name.split("${")[0])
            .filter(name => name.startsWith("qual-") && !name.includes("$"))
            .forEach(name => emitted.add(name));
    }

    ["ok", "warn", "bad"].forEach(tone => emitted.add(`qual-chip--${tone}`));
    emitted.add("qual-period--annual");

    const missing = [...emitted].filter(name => !css.includes(`.${name}`));

    assert.deepEqual(
        missing,
        [],
        `clases sin estilo en styles.css: ${missing.join(", ")}`
    );
});

/* ==========================================================================
   Cosas que ya se rompieron una vez
   ========================================================================== */

test("la pestana anual se puede alcanzar de verdad", async () => {
    const source = await read("../js/qualifications.js");

    // La cabecera pintaba cuatro botones pero el pintado resolvia el periodo
    // contra los TRES cuatrimestres, asi que "Anual" caia siempre en el
    // primero y su pantalla no se veia nunca.
    assert.match(source, /const period = periodById\(selectedPeriodId, selectedCycleStartYear\)/);
    assert.doesNotMatch(
        source,
        /const periods = qualificationPeriods\(selectedCycleStartYear\);\s*\n\s*const period = periods\.find/
    );
});

test("los recuentos y el filtro miran los estados que existen", async () => {
    const source = await read("../js/qualifications.js");

    // Preguntaban por `evaluated`, que ya no se devuelve: quedaban en cero y
    // el filtro mostraba una lista vacia.
    assert.match(source, /function isClosedStatus/);
    assert.match(source, /isClosedStatus\(summary\.status\)/);
    assert.doesNotMatch(source, /summary\.status === STATUS_EVALUATED/);
});

test("el orden de la lista no se rompe con los estados nuevos", async () => {
    const source = await read("../js/qualifications.js");

    // Sin printed/archived en el mapa, la resta daba NaN.
    assert.match(source, /\[STATUS_PRINTED\]: 2/);
    assert.match(source, /\[STATUS_ARCHIVED\]: 3/);
    assert.match(source, /\(order\[a\.status\] \|\| 0\) - \(order\[b\.status\] \|\| 0\)/);
});

test("un usuario de solo lectura no puede imprimir ni escribir el estado", async () => {
    const source = await read("../js/qualifications.js");

    // Imprimir guarda el registro como impreso, asi que tiene que exigir
    // permiso de edicion y no solo que el texto este completo.
    assert.match(source, /data-qual-print \$\{complete && editable \? "" : "disabled"\}/);
});

test("las observaciones se pueden dejar vacias", async () => {
    const source = await read("../js/qualifications.js");

    // Con `|| previous.observations` al borrarlas volvia el texto anterior.
    assert.match(source, /form\.elements\.observations\s*\n\s*\? form\.elements\.observations\.value/);
});

test("adjuntar el escaneado no borra lo escrito sin guardar", async () => {
    const source = await read("../js/qualifications.js");

    assert.match(source, /async function attachScan\(input, summary, period, form\)/);
    assert.match(source, /const typed = form/);
    assert.match(source, /const previous = typed \|\|/);
});

test("las rayas de firma se imprimen con raya", async () => {
    const form = await read("../js/qualificationForm.js");

    // `line(0)` metia un style="width:0px" en linea que le ganaba al 100% de
    // la hoja: las dos firmas salian sin donde firmar.
    assert.doesNotMatch(form, /\$\{line\(0\)\}/);
    assert.match(form, /<span class="ln"><\/span>\s*\n\s*<small>Firma del Funcionario<\/small>/);
    assert.match(form, /<span class="ln"><\/span>\s*\n\s*<small>Firma y Timbre<\/small>/);
});

test("la anual usa la escala 1-10, no campos numericos", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // La escala del articulo 14 se pone de un clic y la nota queda tenida con
    // su tramo. Antes eran seis <input type="number"> apretados con un
    // "Fundamento" siempre a la vista.
    assert.match(source, /data-qual-note=/);
    assert.doesNotMatch(source, /<input type="number"[\s\S]{0,120}data-qual-sub-score/);
    assert.match(source, /function noteBand/);
    ["deficiente", "insuficiente", "satisfactorio", "buena", "optimo"].forEach(band => {
        assert.match(css, new RegExp(`\.qual-cell--${band}`));
    });
    // El fundamento solo aparece donde el reglamento lo va a exigir.
    assert.match(source, /function needsReason/);
    assert.doesNotMatch(source, /Fundamento del factor/);
});

test("el puntaje y la lista se calculan sin repintar el panel", async () => {
    const source = await read("../js/qualifications.js");

    // Repintar costaria el texto sin guardar de los fundamentos y el foco del
    // recuadro en el que se este escribiendo.
    assert.match(source, /function refreshAnnualTotals/);
    assert.match(source, /\[data-qual-total\]/);
    assert.match(source, /\[data-qual-marker\]/);
    assert.match(source, /function bindNoteScales/);
});

test("las bandas del articulo 15 van a escala real", async () => {
    const css = await read("../styles.css");

    // 10-30, 30-46, 46-81 y 81-100 sobre un total de 90 puntos de ancho.
    assert.match(css, /\.qual-band--4 \{ width: 22\.2%/);
    assert.match(css, /\.qual-band--3 \{ width: 17\.8%/);
    assert.match(css, /\.qual-band--2 \{ width: 38\.9%/);
    assert.match(css, /\.qual-band--1 \{ width: 21\.1%/);
});

test("se marca la nota del ciclo anterior", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    assert.match(source, /function previousCycleScores/);
    assert.match(source, /annualPeriod\(cycleStartYear - 1\)/);
    assert.match(css, /\.qual-cell\.is-previous/);
});

/* ==========================================================================
   La cascada del CSS, que es lo que hizo que no se pareciera al mockup
   ========================================================================== */

test("el layout de dos columnas es solo del cuatrimestre", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // La regla estaba en `.qual-factor` a secas, asi que la anual tambien la
    // heredaba y metia sus escalas de diez casillas en la columna de 300 px.
    assert.match(source, /class="qual-factor qual-factor--quarter"/);
    assert.match(
        css,
        /\.qual-factor--quarter \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(240px, 300px\)/
    );
    // La regla general de `.qual-factor` no debe fijar columnas.
    assert.doesNotMatch(
        css,
        /\n\.qual-factor \{[^}]*grid-template-columns/
    );
});

test("la escala de la anual recupera el ancho completo", async () => {
    const css = await read("../styles.css");

    // `.qual-subfactor` reserva una columna de 72 px para el <input number>
    // que se elimino; sin anularla, las diez casillas caben en 72 px.
    assert.match(
        css,
        /\.qual-factor--annual \.qual-subfactor \{[^}]*grid-template-columns: minmax\(0, 1fr\)/
    );
});

test("los recuadros de texto no los pisa la regla generica del formulario", async () => {
    const css = await read("../styles.css");

    // `.qual-form textarea` es (0,1,1) y le ganaba a `.qual-appraisal` (0,1,0):
    // la apreciacion y el fundamento perdian borde y fondo. Se anidan bajo
    // `.qual-form` para quedar por encima.
    assert.match(css, /\.qual-form \.qual-appraisal \{/);
    assert.match(css, /\.qual-form \.qual-reason textarea \{/);
    assert.doesNotMatch(css, /\n\.qual-appraisal \{/);
});

test("la cabecera muestra el ciclo, el avance y los antecedentes de la unidad", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // Los cuatro pasos en UNA fila de pastillas con su etapa, no cuatro
    // tarjetas grandes que se parten en dos filas.
    assert.match(source, /function periodStageLabel/);
    assert.match(source, /qual-period__stage/);
    assert.match(css, /\.qual-periods \{[^}]*display: flex/);

    // Avance y antecedentes lado a lado.
    assert.match(source, /function progressHTML/);
    assert.match(source, /function unitLedgerHTML/);
    assert.match(css, /\.qual-overview \{[^}]*grid-template-columns/);

    // El atajo para no volver a la lista entre trabajador y trabajador.
    assert.match(source, /data-qual-queue/);
});

test("la bandeja y la evaluacion son dos pantallas, no dos columnas", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // Lado a lado ninguna tenia sitio: las escalas de nota y los antecedentes
    // de cada factor quedaban metidos en columnas de trescientos pixeles.
    assert.doesNotMatch(source, /qual-layout/);
    assert.doesNotMatch(css, /\.qual-layout/);
    // Sin trabajador elegido se ve la bandeja; con uno, la ficha la reemplaza.
    assert.match(source, /let openProfileKey = ""/);
    assert.match(source, /\$\{selected\s*\n\s*\? detailHTML/);
    assert.match(source, /data-qual-back/);
});

test("dentro de la ficha, los periodos son pestanas de la misma persona", async () => {
    const source = await read("../js/qualifications.js");

    // Cambiar de cuatrimestre no debe devolver a la lista: obligaria a buscar
    // otra vez a la misma persona para ver su otro periodo.
    const handler = source.slice(
        source.lastIndexOf('panel.querySelectorAll("[data-qual-period]")'),
        source.lastIndexOf('panel.querySelectorAll("[data-qual-status]")')
    );

    assert.doesNotMatch(handler, /openProfileKey = ""/);
    assert.match(source, /qual-periods--compact/);
});

test("la ficha lleva la franja de antecedentes y el pie de la fila", async () => {
    const source = await read("../js/qualifications.js");

    assert.match(source, /function ledgerStripHTML/);
    assert.match(source, /function queueFooterHTML/);
    assert.match(source, /data-qual-next=/);
});

test("las tarjetas de cifras no llevan franja de color al costado", async () => {
    const css = await read("../styles.css");

    // El color va en el rotulo y en la cifra, que es donde se lee. La franja
    // pedia un tono saturado por tarjeta y cuatro seguidas parecian un semaforo.
    assert.doesNotMatch(css, /\.qual-kpi \{[^}]*border-left: 4px/);
    assert.match(css, /\.qual-kpi \{[^}]*--qual-kpi-tone/);
    assert.match(css, /\.qual-kpi strong \{[^}]*color: var\(--qual-kpi-tone\)/);
    assert.match(css, /\.qual-kpi span \{[^}]*text-transform: uppercase/);
    assert.doesNotMatch(css, /\.qual-kpi--green \{ border-left-color/);
});

test("el buscador y los filtros van en una linea", async () => {
    const css = await read("../styles.css");

    // En dos filas ocupaban el doble de alto para decir lo mismo y empujaban
    // la lista fuera de la primera pantalla.
    assert.match(css, /\.qual-list-tools \{[^}]*display: flex/);
    assert.match(css, /\.qual-list-tools \.field-shell \{[^}]*flex: 1 1 260px/);
});

test("la fila del trabajador muestra solo lo que tiene", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // Antes cada fila arrastraba "0 merito 0 demerito 0 atraso 0 capacitacion":
    // cuatro ceros repetidos setenta y tres veces que tapan a quien si tiene
    // antecedentes.
    assert.match(source, /function workerTagsHTML/);
    assert.match(source, /\.filter\(\(\[, count\]\) => count > 0\)/);
    assert.doesNotMatch(source, /\$\{summary\.merits\.length\} merito</);
    // Cada antecedente con su color, y el RUT fuera del subtitulo.
    ["ok", "warn", "bad"].forEach(tone => {
        assert.match(css, new RegExp(`\.qual-tag--${tone}`));
    });
    assert.match(source, /const subtitle = \[\.\.\.new Set\(role\)\]/);
    // Y si esta el formulario escaneado, se ve desde la lista.
    assert.match(source, /qual-scan-badge/);
});

test("en la anual el puntaje es una tarjeta junto a la identidad", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // A lo ancho de la pantalla, el puntaje quedaba lejos de las notas que lo
    // mueven; es el dato que se mira mientras se califica.
    assert.match(source, /function scoreCardHTML/);
    assert.doesNotMatch(source, /function scoreBandHTML/);
    assert.match(css, /\.qual-annual-head \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 340px\)/);
    // Y el encabezado dice la planta, los coeficientes y el plazo de cierre.
    assert.match(source, /coeficientes \$\{escapeHTML\(coefficients\)\}/);
    assert.match(source, /la precalificacion se cierra el/);
});

test("los tres informes se pueden comparar de un vistazo", async () => {
    const [source, css] = await Promise.all([
        read("../js/qualifications.js"),
        read("../styles.css")
    ]);

    // Apilados a lo ancho no se podian mirar juntos, que es lo que hay que
    // hacer para poner la nota del ano.
    assert.match(css, /\.qual-reports__cards \{[^}]*grid-template-columns: repeat\(3/);
    assert.match(source, /function reportExcerpt/);
    assert.match(source, /data-qual-report=/);
    assert.doesNotMatch(source, /<details class="qual-report">/);
});

test("las areas de la rejilla no se escapan del encabezado cuatrimestral", async () => {
    const css = await read("../styles.css");

    // Sueltas, `.qual-detail-id { grid-area: id }` se aplicaba TAMBIEN al
    // encabezado de la anual, cuya rejilla no define esa area: el navegador la
    // mandaba a una fila implicita y la identidad terminaba debajo del puntaje
    // y pegada a la derecha.
    assert.match(css, /\.qual-detail-head > \.qual-detail-id \{ grid-area: id; \}/);
    assert.doesNotMatch(css, /\n\.qual-detail-id \{ grid-area: id; \}/);
});

test("la tarjeta de puntaje compara con el ciclo anterior", async () => {
    const source = await read("../js/qualifications.js");

    // La calificacion se lee contra la del ano pasado, no en el vacio.
    assert.match(source, /function previousCyclePoints/);
    assert.match(source, /Ciclo anterior: \$\{escapeHTML/);
});

test("ninguna insercion parte una lista de selectores del CSS", async () => {
    const css = await read("../styles.css");
    const lines = css.split("\n");
    const broken = [];

    // Insertar un bloque usando como ancla la ULTIMA linea de una lista de
    // selectores la parte: el prefijo se queda colgado y se pega al primer
    // selector del bloque nuevo. Paso de verdad con
    // `.qual-list-head, .qual-subhead, .qual-detail-head, .qual-factor-head`,
    // que perdio sus propiedades y estuvo semanas descuadrando el encabezado.
    lines.forEach((line, index) => {
        if (!line.trimEnd().endsWith(",")) return;

        let next = index + 1;

        while (next < lines.length && !lines[next].trim()) next += 1;

        if (next < lines.length && lines[next].trimStart().startsWith("/*")) {
            broken.push(`${index + 1}: ${line.trim()}`);
        }
    });

    assert.deepEqual(
        broken,
        [],
        `listas de selectores partidas por un comentario: ${broken.join(" | ")}`
    );
});

test("los tres informes van dentro de un recuadro gris", async () => {
    const css = await read("../styles.css");

    // Las tarjetas blancas necesitan un fondo del que despegarse; sueltas
    // sobre el panel el bloque no se leia como una unidad.
    assert.match(css, /\.qual-reports \{[^}]*background: var\(--panel-alt\)/);
    assert.match(css, /\.qual-reports \.qual-subhead h4 \{[^}]*text-transform: uppercase/);
});

test("el recuadro de evaluaciones sale del perfil sin perder lo guardado", async () => {
    const [main, source] = await Promise.all([
        read("../js/main.js"),
        read("../js/qualifications.js")
    ]);

    // El trabajo vive ahora en Calificaciones; tenerlo en los dos sitios
    // invitaba a escribir la evaluacion donde no correspondia.
    assert.match(main, /const HR_LOG_SECTIONS = HR_LOG_CONFIG\.filter\(config => !config\.retired\)/);
    assert.match(main, /key: "performance",\s*\n\s*retired: true/);
    assert.match(main, /DOM\.profileRecordsPanel\.innerHTML = HR_LOG_SECTIONS/);

    // Pero la clave se conserva y se sigue leyendo: quitarla habria dejado los
    // registros guardados y sin ninguna pantalla que los abriera.
    assert.match(main, /HR_LOG_CONFIG\.forEach\(config => \{/);
    assert.match(source, /summary\.performance\.forEach/);
    // El boton del adjunto se generalizo al agregarselo tambien a los eventos.
    assert.match(source, /fileSource: item\.file \? "performance" : ""/);
    assert.match(source, /Evaluacion anterior/);
});

test("los eventos llegan a Calificaciones con su propio texto", async () => {
    const source = await read("../js/qualifications.js");

    // El evento guarda su contenido en `detail`, no en `title`. Leyendo
    // `title` llegaba como una "Anotacion" generica y SIN texto, que es
    // justamente lo que hay que copiar a la apreciacion.
    assert.match(source, /summary\.events\.forEach\(\(item, index\) => \{/);
    assert.match(source, /const detail = String\(item\.detail \|\| item\.title \|\| ""\)/);
    assert.doesNotMatch(source, /title: item\.title \|\| "Anotacion"/);
    // Y se cuentan en la franja del periodo y en el resumen de la unidad.
    assert.match(source, /summary\.events\.length, "evento", "eventos"/);
    assert.match(source, /totals\.events, "eventos registrados"/);
});

test("el evento admite archivo de respaldo", async () => {
    const [main, source] = await Promise.all([
        read("../js/main.js"),
        read("../js/qualifications.js")
    ]);

    // Mismo mecanismo que ya usan merito y demerito: basta con declarar el
    // rotulo del archivo en la seccion.
    assert.match(
        main,
        /key: "events",[\s\S]{0,320}fileLabel: "Archivo de respaldo"/
    );
    // Y se puede abrir desde la ficha, igual que el de la evaluacion retirada.
    assert.match(source, /data-qual-file-source=/);
    assert.match(source, /const entry = \(summary\[source\] \|\| \[\]\)\[index\]/);
});
