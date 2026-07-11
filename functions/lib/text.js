"use strict";

// Utilidades de texto compartidas por el cómputo server-side (lector de estado,
// motor de turnos, proyección del worker-app). Equivalen a las del cliente.

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeText(value) {
  return cleanText(value, 240)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

module.exports = { cleanText, normalizeText };
