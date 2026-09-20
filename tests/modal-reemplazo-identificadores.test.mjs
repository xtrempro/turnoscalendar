// El armador del modal de sugerencias y quien lo llama tienen que estar de
// acuerdo sobre lo que recibe.
//
// `rota` quedo usado DENTRO de replacementDialogHTML sin ser parametro suyo:
// vivia en openReplacementDialog, que es otra funcion. Eso es sintaxis
// perfectamente valida -`node --check` la acepta- y solo revienta al dibujar,
// asi que el modal dejo de cargar por completo, tambien desde el calendario
// principal, donde nada de esto se habia tocado.
//
// La leccion es que una prueba que solo LEE el codigo no puede ver un nombre
// suelto. Esta compara la firma con la llamada, que es donde estuvo el desacuerdo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (await readFile(
    new URL("../js/calendar.js", import.meta.url),
    "utf8"
)).replace(/\r\n/g, "\n");

/** Los nombres que la funcion destructura de su unico argumento. */
function paramNames(name) {
    const start = source.indexOf(`function ${name}({`);

    assert.notEqual(start, -1, `no se encontro: ${name}`);

    const open = source.indexOf("{", start);
    const close = source.indexOf("}) {", open);

    assert.notEqual(close, -1, `no se encontro el cierre de: ${name}`);

    return source
        .slice(open + 1, close)
        .split("\n")
        .map(line => line.replace(/\/\/.*$/, "").trim())
        .filter(Boolean)
        .map(line => line.split(/[=:]/)[0].replace(",", "").trim())
        .filter(part => /^[A-Za-z_$][\w$]*$/.test(part));
}

/** Las claves del objeto que se le pasa en la llamada. */
function callKeys(name) {
    // La LLAMADA, no la declaracion: buscar `nombre({` a secas encontraba
    // primero `function nombre({` y terminaba comparando la firma consigo misma.
    const start = source.indexOf(`= ${name}({`);

    assert.notEqual(start, -1, `no se encontro la llamada a: ${name}`);

    const open = source.indexOf("{", start);
    let depth = 0;
    let end = open;

    for (; end < source.length; end += 1) {
        if (source[end] === "{") depth += 1;
        else if (source[end] === "}") {
            depth -= 1;
            if (!depth) break;
        }
    }

    return source
        .slice(open + 1, end)
        .split("\n")
        .map(line => line.replace(/\/\/.*$/, "").trim())
        .filter(Boolean)
        .map(line => line.split(":")[0].replace(",", "").trim())
        .filter(part => /^[A-Za-z_$][\w$]*$/.test(part));
}

const params = paramNames("replacementDialogHTML");
const keys = callKeys("replacementDialogHTML");

test("todo lo que se pasa en la llamada lo recibe la firma", () => {
    const sobrantes = keys.filter(key => !params.includes(key));

    assert.deepEqual(
        sobrantes,
        [],
        `se pasan y no se reciben: ${sobrantes.join(", ")}`
    );
});

test("y la firma no espera nada que nadie le pase", () => {
    // Con valor por omision es legitimo no pasarlo; sin el, es un olvido.
    const sinDefecto = params.filter(name =>
        !new RegExp(`\\n\\s*${name}\\s*=`).test(
            source.slice(
                source.indexOf("function replacementDialogHTML({"),
                source.indexOf("}) {", source.indexOf("function replacementDialogHTML({"))
            )
        )
    );
    const faltantes = sinDefecto.filter(name => !keys.includes(name));

    assert.deepEqual(
        faltantes,
        [],
        `se reciben y nadie los pasa: ${faltantes.join(", ")}`
    );
});

test("el cupo de rotativa viaja como parametro, no como nombre suelto", () => {
    // Fue exactamente lo que fallo.
    assert.ok(params.includes("rota"), "rota no esta en la firma");
    assert.ok(keys.includes("rota"), "rota no se pasa en la llamada");
    assert.match(source, /rota = null/);
});

test("el encabezado del modal distingue los dos casos", () => {
    // Un cupo de rotativa no tiene a quien nombrar: no falto nadie.
    assert.match(
        source,
        /El grupo \$\{escapeHTML\(rota\.group\)\} requiere 1 \$\{escapeHTML\(rota\.label \|\| rota\.estamento\)\}/
    );
    assert.match(
        source,
        /\$\{escapeHTML\(profileName\)\} requiere cobertura para/
    );
});
