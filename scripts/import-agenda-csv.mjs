import fs from "node:fs/promises";
import path from "node:path";

const REQUIRED_HEADERS = [
    "Establecimiento",
    "Unidad",
    "favorito",
    "Cargo",
    "Nombre",
    "Telefono",
    "marcar desde movil",
    "Correo"
];

function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (quoted) {
            if (char === '"' && text[index + 1] === '"') {
                field += '"';
                index++;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            quoted = true;
        } else if (char === ",") {
            row.push(field);
            field = "";
        } else if (char === "\n") {
            row.push(field.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += char;
        }
    }

    if (field || row.length) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
    }

    return rows.filter(values => values.some(value => value.trim()));
}

function clean(value) {
    return String(value || "").trim();
}

function normalizeDialNumber(value, rowNumber) {
    const raw = clean(value);
    let digits = raw.replace(/\D/g, "");

    if (!digits) return "";
    if (digits.length === 11 && digits.startsWith("56")) {
        digits = digits.slice(2);
    }
    if (digits.length !== 9) {
        throw new Error(
            `Fila ${rowNumber}: el numero para movil debe tener 9 digitos (${raw}).`
        );
    }

    return digits;
}

function favoriteValue(value) {
    return clean(value).toLocaleLowerCase("es") === "favorito";
}

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.resolve("js/agendaSeed.js");

if (!inputPath) {
    throw new Error("Uso: node scripts/import-agenda-csv.mjs <entrada.csv> [salida.js]");
}

const raw = (await fs.readFile(inputPath, "utf8")).replace(/^\uFEFF/, "");
const rows = parseCSV(raw);
const headers = rows.shift()?.map(clean) || [];

if (
    headers.length !== REQUIRED_HEADERS.length ||
    REQUIRED_HEADERS.some((header, index) => headers[index] !== header)
) {
    throw new Error(
        `Encabezados inesperados. Se esperaba: ${REQUIRED_HEADERS.join(", ")}`
    );
}

const contacts = rows.map((values, index) => {
    if (values.length !== headers.length) {
        throw new Error(
            `Fila ${index + 2}: se esperaban ${headers.length} columnas y llegaron ${values.length}.`
        );
    }

    const row = Object.fromEntries(
        headers.map((header, column) => [header, clean(values[column])])
    );

    return {
        id: `agenda_seed_v3_${String(index + 1).padStart(3, "0")}`,
        establishment: row.Establecimiento,
        unidad: row.Unidad,
        favorite: favoriteValue(row.favorito),
        cargo: row.Cargo,
        name: row.Nombre,
        extension: row.Telefono,
        dialNumber: normalizeDialNumber(
            row["marcar desde movil"],
            index + 2
        ),
        email: row.Correo
    };
});

const claveAzul = {
    id: "agenda_clave_azul",
    establishment: "HCV",
    unidad: "Emergencia Adulto",
    favorite: false,
    priority: true,
    cargo: "Emergencia",
    name: "CLAVE AZUL",
    extension: "356427",
    dialNumber: "352206427",
    email: ""
};
const seed = [claveAzul, ...contacts];
const compactSeed = seed.map(contact => [
    contact.id,
    contact.establishment,
    contact.unidad,
    contact.favorite,
    contact.cargo,
    contact.name,
    contact.extension,
    contact.dialNumber,
    contact.email,
    Boolean(contact.priority)
]);
const output = [
    "// Directorio institucional generado desde agenda-contactos.csv.",
    "// Formato: [id, establecimiento, unidad, favorito, cargo, nombre, telefono, numeroMarcable, correo, prioritario].",
    "export const AGENDA_SEED_VERSION = 3;",
    "export const AGENDA_SEED = [",
    compactSeed.map(row => `  ${JSON.stringify(row)}`).join(",\n"),
    "];",
    ""
].join("\n");

await fs.writeFile(outputPath, output, "utf8");

const favoriteCount = seed.filter(contact => contact.favorite).length;
const dialCount = seed.filter(contact => contact.dialNumber).length;

console.log(
    JSON.stringify({
        outputPath,
        contacts: seed.length,
        favorites: favoriteCount,
        dialNumbers: dialCount
    })
);
