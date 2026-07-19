// Regresion: en Android el badge de la notificacion se pinta como SILUETA a
// partir del canal alfa del PNG. Si se apunta a un icono a color y opaco, la
// silueta es un cuadrado blanco (bug reportado dos veces). El badge debe ser
// siempre el PNG monocromo con transparencia (badge-calendar.png).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const functionsIndex = await readFile(
    new URL("../functions/index.js", import.meta.url),
    "utf8"
);

// Iconos a color/opacos que NO sirven como badge de Android.
const COLOR_ICONS = [
    "favicon-turnoplus-calendar.png",
    "logo-turnoplus.png",
    "logo-turnoplus-transparent.png",
    "icon-turnoplus-192.png"
];

test("APP_BADGE apunta al PNG monocromo, no a un icono a color", () => {
    const line = functionsIndex.match(/const APP_BADGE = .*/)?.[0] || "";

    assert.match(line, /badge-calendar\.png/);

    for (const icon of COLOR_ICONS) {
        assert.doesNotMatch(
            line,
            new RegExp(icon.replace(/\./g, "\\.")),
            `APP_BADGE no debe usar ${icon}: es opaco y Android lo muestra como cuadrado blanco`
        );
    }
});

test("el payload webpush envia el badge en la notificacion", () => {
    const build = functionsIndex.match(
        /function buildMessage\([\s\S]*?\n}/
    )?.[0] || "";

    assert.notEqual(build, "", "no se encontro buildMessage");
    // El badge debe viajar tanto en webpush.notification (lo que muestra el
    // navegador) como en data (fallback que usa el service worker).
    assert.match(build, /webpush:[\s\S]*notification:[\s\S]*badge: APP_BADGE/);
    assert.match(build, /badge: APP_BADGE/);
});
