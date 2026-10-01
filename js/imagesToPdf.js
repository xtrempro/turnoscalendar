// Junta varias fotos JPEG en un solo PDF, una por pagina, sin dependencias.
//
// Lo usa el escaneo del Anexo 4 firmado (js/swapScan.js): cada pagina que se
// captura con la camara llega como JPEG, y el memorandum guarda UN documento.
// El JPEG va tal cual dentro del PDF (filtro DCTDecode): no se recomprime.

// Ancho de pagina en puntos: A4 (595 x 842). El alto sale de la proporcion de
// la foto, asi la hoja escaneada no queda estirada ni con bandas.
const PAGE_WIDTH = 595.28;

function latin1(text) {
    const bytes = new Uint8Array(text.length);

    for (let index = 0; index < text.length; index++) {
        bytes[index] = text.charCodeAt(index) & 0xff;
    }

    return bytes;
}

/**
 * Tamano y canales de un JPEG, leidos de su encabezado (marcador SOF).
 * @returns {{width: number, height: number, components: number}|null}
 */
export function jpegInfo(bytes) {
    if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

    let offset = 2;

    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset++;
            continue;
        }

        const marker = bytes[offset + 1];
        const size = (bytes[offset + 2] << 8) | bytes[offset + 3];

        // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
        if (
            marker >= 0xc0 && marker <= 0xcf &&
            marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        ) {
            return {
                height: (bytes[offset + 5] << 8) | bytes[offset + 6],
                width: (bytes[offset + 7] << 8) | bytes[offset + 8],
                components: bytes[offset + 9]
            };
        }

        offset += 2 + size;
    }

    return null;
}

function formatNumber(value) {
    return (Math.round(value * 100) / 100).toString();
}

/**
 * @param {Array<{bytes: Uint8Array, width: number, height: number}>} pages
 *   JPEG de cada pagina con su tamano en pixeles
 * @returns {Uint8Array} el PDF
 */
export function imagesToPdf(pages = []) {
    const list = pages.filter(page =>
        page?.bytes?.length && page.width > 0 && page.height > 0
    );

    if (!list.length) throw new Error("No hay paginas para armar el PDF.");

    const chunks = [];
    const offsets = [];
    let length = 0;

    const push = part => {
        const bytes = typeof part === "string" ? latin1(part) : part;

        chunks.push(bytes);
        length += bytes.length;
    };
    const startObject = number => {
        offsets[number] = length;
        push(`${number} 0 obj\n`);
    };

    // 1 catalogo, 2 arbol de paginas, despues 3 objetos por pagina:
    // la pagina, su contenido y su imagen.
    const pageObject = index => 3 + index * 3;
    const total = 2 + list.length * 3;

    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    startObject(1);
    push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    startObject(2);
    push(
        `<< /Type /Pages /Count ${list.length} /Kids [${
            list.map((_, index) => `${pageObject(index)} 0 R`).join(" ")
        }] >>\nendobj\n`
    );

    list.forEach((page, index) => {
        const pageNumber = pageObject(index);
        const contentNumber = pageNumber + 1;
        const imageNumber = pageNumber + 2;
        const info = jpegInfo(page.bytes);
        const colorSpace = info?.components === 1
            ? "/DeviceGray"
            : info?.components === 4
                ? "/DeviceCMYK"
                : "/DeviceRGB";
        const width = PAGE_WIDTH;
        const height = PAGE_WIDTH * (page.height / page.width);
        const content =
            `q ${formatNumber(width)} 0 0 ${formatNumber(height)} 0 0 cm /Im0 Do Q`;

        startObject(pageNumber);
        push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(width)} ${formatNumber(height)}] ` +
            `/Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>\nendobj\n`
        );

        startObject(contentNumber);
        push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

        startObject(imageNumber);
        push(
            `<< /Type /XObject /Subtype /Image /Width ${Math.round(page.width)} /Height ${Math.round(page.height)} ` +
            `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`
        );
        push(page.bytes);
        push("\nendstream\nendobj\n");
    });

    const xref = length;

    push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);

    for (let number = 1; number <= total; number++) {
        push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
    }

    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let position = 0;

    chunks.forEach(chunk => {
        out.set(chunk, position);
        position += chunk.length;
    });

    return out;
}
