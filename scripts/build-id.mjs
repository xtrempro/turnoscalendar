// Identificador de build que viaja en cada registro nuevo de la bitacora
// (js/auditLogVersion.js). Lo genera build.mjs ANTES de empaquetar: el hash del
// bundle no sirve porque se conoce recien despues de construirlo.
//
// Formato: AAAAMMDDTHHMMSSZ-<sha corto>[-dirty]
//   20261002T154300Z-c78d032        build desde un commit limpio
//   20261002T154300Z-c78d032-dirty  build con cambios sin commitear
//   20261002T154300Z-nogit          sin git disponible

import { execSync } from "node:child_process";

export function formatBuildTimestamp(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createBuildId({ now = new Date(), gitSha = "", dirty = false } = {}) {
    const sha = String(gitSha || "").trim().replace(/[^0-9a-f]/gi, "").slice(0, 12);

    return `${formatBuildTimestamp(now)}-${sha || "nogit"}${sha && dirty ? "-dirty" : ""}`;
}

function git(command) {
    try {
        return execSync(`git ${command}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
        return "";
    }
}

export function currentBuildId(now = new Date()) {
    return createBuildId({
        now,
        gitSha: git("rev-parse --short HEAD"),
        dirty: git("status --porcelain --untracked-files=no") !== ""
    });
}
