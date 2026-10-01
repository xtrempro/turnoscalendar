// Escanear el Anexo 4 firmado desde el panel de Cambios de turno.
//
// Dos caminos: la camara del equipo (computador o celular) o subir un PDF o
// fotos. Con la camara se busca la hoja en la imagen -la parte clara sobre un
// fondo mas oscuro- y al capturar se recorta a ella y se pasa a escala de
// grises con el contraste estirado, para que se lea como un escaneo. Las
// paginas se juntan en UN PDF (js/imagesToPdf.js) y se adjuntan al memorandum
// del cambio: es el mismo documento que se ve en el menu Memorandum.
//
// No endereza la hoja: solo la recorta a su rectangulo. Apoyarla derecha sobre
// una superficie oscura es lo que da el mejor resultado.

import { escapeHTML } from "./htmlUtils.js";
import { imagesToPdf } from "./imagesToPdf.js";
import {
    addMemoDocument,
    downloadSwapAnexo4,
    ensureSwapMemo
} from "./memos.js";
import { swapCodeLabel } from "./swaps.js";

const DETECT_WIDTH = 240;
const MAX_PAGE_SIDE = 2000;
const JPEG_QUALITY = 0.82;

let active = null;

function surname(name) {
    const parts = String(name || "").trim().split(/\s+/);

    // "Nombre Nombre Apellido Apellido": el primer apellido es el penultimo.
    return parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1] || "";
}

function cleanFilePart(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function swapScanFileName(swap = {}) {
    return `Anexo4_${cleanFilePart(surname(swap.from))}-${cleanFilePart(surname(swap.to))}_${swap.fecha || ""}.pdf`;
}

function shortName(name) {
    const parts = String(name || "").trim().split(/\s+/);

    if (parts.length < 2) return parts[0] || "";

    return `${parts[0][0]}. ${surname(name)}`;
}

function dayLabel(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);

    if (Number.isNaN(date.getTime())) return iso || "";

    return date.toLocaleDateString("es-CL", {
        weekday: "short",
        day: "numeric"
    }).replace(".", "");
}

/* ---------- Deteccion y procesado de la hoja ---------- */

function grayscaleOf(context, width, height) {
    const { data } = context.getImageData(0, 0, width, height);
    const gray = new Uint8ClampedArray(width * height);

    for (let index = 0, pixel = 0; index < gray.length; index++, pixel += 4) {
        gray[index] =
            (data[pixel] * 77 + data[pixel + 1] * 150 + data[pixel + 2] * 29) >> 8;
    }

    return gray;
}

function otsuThreshold(gray) {
    const histogram = new Array(256).fill(0);

    gray.forEach(value => { histogram[value]++; });

    const total = gray.length;
    let sum = 0;

    for (let level = 0; level < 256; level++) sum += level * histogram[level];

    let sumBackground = 0;
    let weightBackground = 0;
    let best = 0;
    let threshold = 128;

    for (let level = 0; level < 256; level++) {
        weightBackground += histogram[level];
        if (!weightBackground) continue;

        const weightForeground = total - weightBackground;
        if (!weightForeground) break;

        sumBackground += level * histogram[level];

        const meanBackground = sumBackground / weightBackground;
        const meanForeground = (sum - sumBackground) / weightForeground;
        const between =
            weightBackground * weightForeground *
            (meanBackground - meanForeground) ** 2;

        if (between > best) {
            best = between;
            threshold = level;
        }
    }

    return threshold;
}

// La banda mas larga de filas (o columnas) con suficiente papel. Tolera
// cortes de hasta `maxGap`: un renglon de texto o el borde de una tabla
// oscurecen unas pocas filas y no pueden partir la hoja en dos.
function longestBand(fractions, minimum, maxGap = 0) {
    let bestStart = -1;
    let bestEnd = -1;
    let start = -1;
    let lastGood = -1;

    fractions.forEach((fraction, index) => {
        if (fraction < minimum) {
            if (start >= 0 && index - lastGood > maxGap) start = -1;
            return;
        }

        if (start < 0) start = index;
        lastGood = index;

        if (index - start > bestEnd - bestStart) {
            bestStart = start;
            bestEnd = index;
        }
    });

    return bestStart < 0 ? null : [bestStart, bestEnd];
}

/**
 * El rectangulo de la hoja en una imagen en escala de grises, en fracciones
 * (0..1) del ancho y el alto, o null si no hay una hoja clara que recortar.
 */
export function detectSheet(gray, width, height) {
    if (!gray?.length || !width || !height) return null;

    const threshold = otsuThreshold(gray);
    const rows = new Array(height).fill(0);
    const columns = new Array(width).fill(0);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (gray[y * width + x] > threshold) {
                rows[y]++;
                columns[x]++;
            }
        }
    }

    const rowBand = longestBand(
        rows.map(count => count / width),
        0.3,
        Math.round(height * 0.12)
    );
    const columnBand = longestBand(
        columns.map(count => count / height),
        0.3,
        Math.round(width * 0.12)
    );

    if (!rowBand || !columnBand) return null;

    const box = {
        x: columnBand[0] / width,
        y: rowBand[0] / height,
        w: (columnBand[1] - columnBand[0] + 1) / width,
        h: (rowBand[1] - rowBand[0] + 1) / height
    };
    const area = box.w * box.h;

    // Muy chica: no es la hoja. Casi toda la imagen: ya viene recortada (o no
    // hay fondo que la separe) y recortar no aporta nada.
    if (area < 0.15 || area > 0.96) return null;

    return box;
}

function detectInSource(source, sourceWidth, sourceHeight) {
    const width = DETECT_WIDTH;
    const height = Math.max(1, Math.round(DETECT_WIDTH * sourceHeight / sourceWidth));
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    context.drawImage(source, 0, 0, width, height);

    return detectSheet(grayscaleOf(context, width, height), width, height);
}

function canvasToJpeg(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) {
                reject(new Error("No se pudo procesar la imagen."));
                return;
            }

            resolve(blob);
        }, "image/jpeg", JPEG_QUALITY);
    });
}

/**
 * Recorta la hoja (si se encuentra), la pasa a grises con el contraste
 * estirado y la deja en JPEG. Sirve para un cuadro de video o una foto subida.
 */
async function processPage(source, sourceWidth, sourceHeight) {
    const box = detectInSource(source, sourceWidth, sourceHeight) ||
        { x: 0, y: 0, w: 1, h: 1 };
    // Un margen chico para no comerse el borde del formulario.
    const margin = 0.008;
    const sx = Math.max(0, (box.x - margin) * sourceWidth);
    const sy = Math.max(0, (box.y - margin) * sourceHeight);
    const sw = Math.min(sourceWidth - sx, (box.w + margin * 2) * sourceWidth);
    const sh = Math.min(sourceHeight - sy, (box.h + margin * 2) * sourceHeight);
    const scale = Math.min(1, MAX_PAGE_SIDE / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);

    const image = context.getImageData(0, 0, width, height);
    const { data } = image;
    const histogram = new Array(256).fill(0);
    const pixels = width * height;

    for (let pixel = 0; pixel < data.length; pixel += 4) {
        histogram[(data[pixel] * 77 + data[pixel + 1] * 150 + data[pixel + 2] * 29) >> 8]++;
    }

    // Negro y blanco de la hoja: el 2 % mas oscuro y el 8 % mas claro.
    let low = 0;
    let high = 255;
    let accumulated = 0;

    for (let level = 0; level < 256; level++) {
        accumulated += histogram[level];
        if (accumulated >= pixels * 0.02) {
            low = level;
            break;
        }
    }

    accumulated = 0;

    for (let level = 255; level >= 0; level--) {
        accumulated += histogram[level];
        if (accumulated >= pixels * 0.08) {
            high = level;
            break;
        }
    }

    const range = Math.max(40, high - low);

    for (let pixel = 0; pixel < data.length; pixel += 4) {
        const gray = (data[pixel] * 77 + data[pixel + 1] * 150 + data[pixel + 2] * 29) >> 8;
        const value = Math.max(0, Math.min(255, ((gray - low) * 255) / range));

        data[pixel] = value;
        data[pixel + 1] = value;
        data[pixel + 2] = value;
    }

    context.putImageData(image, 0, 0);

    const blob = await canvasToJpeg(canvas);

    return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width,
        height,
        url: URL.createObjectURL(blob)
    };
}

/* ---------- Modal ---------- */

function modalHTML(state) {
    const { swap } = state;
    const camera = state.tab === "camera";
    const pages = state.pages;
    const nextPage = pages.length + 1;
    const checks = [
        ["from", `Firma de quien entrega (${shortName(swap.from)})`],
        ["to", `Firma de quien recibe (${shortName(swap.to)})`],
        ["boss", "Firma y timbre de la jefatura"],
        ["reason", "Motivo escrito por el trabajador"]
    ];

    return `
        <div class="swx-scan" role="dialog" aria-modal="true" aria-labelledby="swxScanTitle">
            <div class="swx-scan__head">
                <span class="swx-scan__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3"></path><path d="M16 4h3a1 1 0 0 1 1 1v3"></path><path d="M20 16v3a1 1 0 0 1-1 1h-3"></path><path d="M8 20H5a1 1 0 0 1-1-1v-3"></path><path d="M4 12h16"></path></svg>
                </span>
                <div class="swx-scan__title">
                    <h2 id="swxScanTitle">Escanear Anexo 4 firmado</h2>
                    <span>${escapeHTML(shortName(swap.from))} → ${escapeHTML(shortName(swap.to))} · ${escapeHTML(swapCodeLabel(swap.turno))} ${escapeHTML(dayLabel(swap.fecha))} ⇄ ${escapeHTML(swapCodeLabel(swap.turnoDevuelto))} ${escapeHTML(dayLabel(swap.devolucion))} · se adjunta a su memorándum</span>
                </div>
                <button class="swx-scan__close" type="button" data-scan-act="close" aria-label="Cerrar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
                </button>
            </div>

            <div class="swx-scan__body">
                <div class="swx-scan__capture">
                    <div class="swx-seg" role="tablist">
                        <button type="button" role="tab" aria-selected="${camera}" class="${camera ? "is-active" : ""}" data-scan-tab="camera">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"></path><circle cx="12" cy="13.5" r="3.5"></circle></svg>
                            Usar la cámara
                        </button>
                        <button type="button" role="tab" aria-selected="${!camera}" class="${camera ? "" : "is-active"}" data-scan-tab="upload">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14"></path></svg>
                            Subir PDF o foto
                        </button>
                    </div>

                    ${camera ? `
                        <div class="swx-scan__viewer">
                            <video data-scan-video playsinline muted autoplay></video>
                            <div class="swx-scan__sheet" data-scan-sheet hidden></div>
                            <span class="swx-scan__badge" data-scan-badge>${escapeHTML(state.cameraError ? "Sin cámara" : "Buscando la hoja…")}</span>
                            ${state.cameraError ? `<p class="swx-scan__error">${escapeHTML(state.cameraError)}</p>` : ""}
                            <span class="swx-scan__tip">Apoya la hoja sobre una superficie oscura, con buena luz</span>
                        </div>
                        <div class="swx-scan__controls">
                            <button class="swx-btn swx-btn--ghost" type="button" data-scan-act="switch-camera">Cambiar cámara</button>
                            <button class="swx-scan__shutter" type="button" data-scan-act="capture" aria-label="Capturar página" ${state.cameraError ? "disabled" : ""}></button>
                            <span class="swx-scan__count">Página ${nextPage}</span>
                        </div>
                    ` : `
                        <label class="swx-scan__drop">
                            <input type="file" accept="image/*,application/pdf" multiple data-scan-file>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14"></path></svg>
                            <strong>Elige el PDF o las fotos del formulario</strong>
                            <span>Las fotos se recortan y se pasan a escala de grises, igual que con la cámara. Un PDF se adjunta tal cual.</span>
                        </label>
                    `}
                </div>

                <div class="swx-scan__review">
                    <div class="swx-scan__pages">
                        <strong>Páginas capturadas</strong>
                        <div class="swx-scan__thumbs">
                            ${state.pdf ? `
                                <div class="swx-scan__thumb swx-scan__thumb--pdf">
                                    <span>PDF</span>
                                    <small>${escapeHTML(state.pdf.name)}</small>
                                    <button type="button" data-scan-act="remove-pdf" aria-label="Quitar el PDF">×</button>
                                </div>
                            ` : pages.map((page, index) => `
                                <div class="swx-scan__thumb" style="background-image: url('${page.url}')">
                                    <span>Pág. ${index + 1}</span>
                                    <button type="button" data-scan-remove="${index}" aria-label="Quitar página ${index + 1}">×</button>
                                </div>
                            `).join("")}
                            ${state.pdf ? "" : `<div class="swx-scan__thumb swx-scan__thumb--empty">Pág. ${nextPage}</div>`}
                        </div>
                    </div>

                    <fieldset class="swx-scan__checks">
                        <legend>Antes de adjuntar, revisa las firmas</legend>
                        ${checks.map(([key, label]) => `
                            <label>
                                <input type="checkbox" data-scan-check="${key}" ${state.checks[key] ? "checked" : ""}>
                                ${escapeHTML(label)}
                            </label>
                        `).join("")}
                    </fieldset>

                    <label class="swx-scan__name">
                        Nombre del archivo
                        <input type="text" data-scan-name value="${escapeHTML(state.fileName)}">
                    </label>
                    <span class="swx-scan__note">Las páginas se unen en un solo PDF. Al adjuntarlo, el memorándum pasa a <strong>Realizado</strong> y el cambio a <strong>Firmado</strong>.</span>
                </div>
            </div>

            <div class="swx-scan__foot">
                <button class="swx-link" type="button" data-scan-act="blank">Descargar otra vez el Anexo 4 en blanco</button>
                <button class="swx-btn swx-btn--ghost" type="button" data-scan-act="close">Cancelar</button>
                <button class="swx-btn swx-btn--primary" type="button" data-scan-act="attach" ${state.busy ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
                    ${state.busy ? "Adjuntando…" : "Adjuntar al memorándum"}
                </button>
            </div>
        </div>
    `;
}

function stopCamera(state) {
    if (state.detectTimer) {
        clearInterval(state.detectTimer);
        state.detectTimer = null;
    }

    state.stream?.getTracks?.().forEach(track => track.stop());
    state.stream = null;
}

function attachStream(state) {
    const video = state.root.querySelector("[data-scan-video]");

    if (!video || !state.stream) return;

    video.srcObject = state.stream;
    void video.play().catch(() => {});
}

async function startCamera(state) {
    stopCamera(state);

    if (!state.root.querySelector("[data-scan-video]")) return;

    if (!navigator.mediaDevices?.getUserMedia) {
        state.cameraError = "Este navegador no permite usar la cámara. Sube el PDF o las fotos.";
        render(state);
        return;
    }

    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: state.facing,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
    } catch (error) {
        state.cameraError = error?.name === "NotAllowedError"
            ? "No se dio permiso para usar la cámara. Puedes subir el PDF o las fotos."
            : "No se encontró una cámara. Puedes subir el PDF o las fotos.";
        render(state);
        return;
    }

    // El modal pudo cerrarse (o cambiar de pestana) mientras se pedia el
    // permiso.
    if (active !== state || state.tab !== "camera") {
        stopCamera(state);
        return;
    }

    attachStream(state);

    state.detectTimer = setInterval(() => {
        // Se busca el video en cada vuelta: un repintado del modal lo reemplaza.
        const video = state.root.querySelector("[data-scan-video]");

        if (!video?.videoWidth) return;

        const box = detectInSource(video, video.videoWidth, video.videoHeight);
        const sheet = state.root.querySelector("[data-scan-sheet]");
        const badge = state.root.querySelector("[data-scan-badge]");

        state.lastBox = box;

        if (sheet) {
            sheet.hidden = !box;

            if (box) {
                sheet.style.left = `${box.x * 100}%`;
                sheet.style.top = `${box.y * 100}%`;
                sheet.style.width = `${box.w * 100}%`;
                sheet.style.height = `${box.h * 100}%`;
            }
        }

        if (badge) {
            badge.textContent = box
                ? "Hoja detectada · se recorta sola"
                : "Buscando la hoja…";
            badge.classList.toggle("is-found", Boolean(box));
        }
    }, 450);
}

function render(state) {
    const scrollTop = state.root.querySelector(".swx-scan__review")?.scrollTop || 0;

    state.root.innerHTML = modalHTML(state);

    const review = state.root.querySelector(".swx-scan__review");

    if (review) review.scrollTop = scrollTop;

    if (state.tab !== "camera" || state.cameraError) {
        stopCamera(state);
        return;
    }

    // La camara sigue prendida entre repintados (capturar una pagina, marcar
    // una firma): solo se pide de nuevo al entrar a la pestana o cambiarla.
    if (state.stream) {
        attachStream(state);
        return;
    }

    void startCamera(state);
}

function close(state) {
    stopCamera(state);
    state.pages.forEach(page => URL.revokeObjectURL(page.url));
    state.root.remove();
    document.removeEventListener("keydown", state.onKey);

    if (active === state) active = null;
}

async function capture(state) {
    const video = state.root.querySelector("[data-scan-video]");

    if (!video?.videoWidth) return;

    try {
        state.pages.push(
            await processPage(video, video.videoWidth, video.videoHeight)
        );
        state.pdf = null;
        render(state);
    } catch (error) {
        alert(error?.message || "No se pudo capturar la página.");
    }
}

async function addFiles(state, files) {
    const list = [...(files || [])];
    const pdf = list.find(file => file.type === "application/pdf");

    // Un PDF ya es el documento: se adjunta tal cual, sin mezclarlo con fotos.
    if (pdf) {
        state.pages.forEach(page => URL.revokeObjectURL(page.url));
        state.pages = [];
        state.pdf = pdf;
        render(state);
        return;
    }

    for (const file of list) {
        if (!file.type.startsWith("image/")) continue;

        try {
            const bitmap = await createImageBitmap(file);

            state.pages.push(await processPage(bitmap, bitmap.width, bitmap.height));
            bitmap.close?.();
        } catch (error) {
            console.warn("No se pudo leer la imagen.", error);
            alert(`No se pudo leer ${file.name}.`);
        }
    }

    state.pdf = null;
    render(state);
}

function attachmentFile(state) {
    const name = String(state.fileName || "").trim() || swapScanFileName(state.swap);
    const fileName = /\.pdf$/i.test(name) ? name : `${name}.pdf`;

    if (state.pdf) {
        return new File([state.pdf], fileName, { type: "application/pdf" });
    }

    return new File(
        [imagesToPdf(state.pages)],
        fileName,
        { type: "application/pdf" }
    );
}

async function attach(state) {
    if (!state.pdf && !state.pages.length) {
        alert("Captura o sube al menos una página del formulario firmado.");
        return;
    }

    const memo = ensureSwapMemo(state.swap.id);

    if (!memo) {
        alert("No se encontró el memorándum de este cambio de turno.");
        return;
    }

    state.busy = true;
    render(state);

    try {
        await addMemoDocument(memo.id, attachmentFile(state));
        const onDone = state.onDone;

        close(state);
        onDone?.();
    } catch (error) {
        console.warn("No se pudo adjuntar el Anexo 4.", error);
        state.busy = false;
        render(state);
        alert(error?.message || "No se pudo adjuntar el documento. Intenta nuevamente.");
    }
}

/**
 * Abre el escaneo del Anexo 4 firmado de un cambio de turno.
 */
export function openSwapScanDialog(swap, { onDone } = {}) {
    if (!swap?.id || typeof document === "undefined") return;

    if (active) close(active);

    const root = document.createElement("div");

    root.className = "swx-scan-backdrop";
    document.body.appendChild(root);

    const state = {
        root,
        swap,
        onDone,
        // Lo comun es tener el PDF del escaner; la camara queda a un clic.
        tab: "upload",
        facing: "environment",
        pages: [],
        pdf: null,
        checks: {},
        fileName: swapScanFileName(swap),
        stream: null,
        detectTimer: null,
        lastBox: null,
        cameraError: "",
        busy: false,
        onKey: event => {
            if (event.key === "Escape") close(state);
        }
    };

    active = state;
    document.addEventListener("keydown", state.onKey);

    root.addEventListener("click", event => {
        if (event.target === root) {
            close(state);
            return;
        }

        const tab = event.target.closest("[data-scan-tab]");

        if (tab) {
            state.tab = tab.dataset.scanTab;
            state.cameraError = "";
            render(state);
            return;
        }

        const remove = event.target.closest("[data-scan-remove]");

        if (remove) {
            const [page] = state.pages.splice(Number(remove.dataset.scanRemove), 1);

            if (page) URL.revokeObjectURL(page.url);
            render(state);
            return;
        }

        const action = event.target.closest("[data-scan-act]")?.dataset.scanAct;

        if (action === "close") close(state);
        if (action === "capture") void capture(state);
        if (action === "attach") void attach(state);
        if (action === "blank") void downloadSwapAnexo4(state.swap.id);
        if (action === "remove-pdf") {
            state.pdf = null;
            render(state);
        }
        if (action === "switch-camera") {
            state.facing = state.facing === "environment" ? "user" : "environment";
            state.cameraError = "";
            stopCamera(state);
            render(state);
        }
    });

    root.addEventListener("change", event => {
        const check = event.target.closest("[data-scan-check]");

        if (check) state.checks[check.dataset.scanCheck] = check.checked;

        if (event.target.matches("[data-scan-file]")) {
            void addFiles(state, event.target.files);
        }
    });

    root.addEventListener("input", event => {
        if (event.target.matches("[data-scan-name]")) {
            state.fileName = event.target.value;
        }
    });

    render(state);
}
