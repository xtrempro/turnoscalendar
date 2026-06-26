/* ======================================================
   UI ENGINE
   Todo lo visual (labels, colores, clases)
====================================================== */

import {
   TURNO_LABEL,
   TURNO_CLASS
} from "./constants.js";

/* ==========================================
   LABEL DE TURNO
========================================== */

export function turnoLabel(state){
   return TURNO_LABEL[state] || "";
}

// Turnos que se pintan con DOS colores (mitad superior / inferior), porque son
// la union de dos tipos de turno. El color de cada mitad deriva de los colores
// configurables de sus componentes (no del codigo combinado):
//   - 3 (TURNO24):       larga (arriba)  + noche (abajo), 50/50
//   - 5 (DIURNO_NOCHE):  diurno (arriba) + noche (abajo), 50/50
//   - 8 (TURNO18):       extension (arriba, 6h) + noche (abajo, 12h), 1/3 - 2/3
const TURNO_SPLIT_CLASS = {
   3: "turno-split--24",
   5: "turno-split--dn",
   8: "turno-split--18"
};

// Todas las clases de color de turno (solidas + de division). Se quitan antes de
// aplicar la nueva para que aplicarClaseTurno sea idempotente: al cambiar el
// turno de una celda no quedan clases viejas acumuladas (ej: pasar de 24 a Noche).
const ALL_TURNO_CLASSES = [
   ...Object.values(TURNO_CLASS).filter(Boolean),
   "turno-split",
   ...Object.values(TURNO_SPLIT_CLASS)
];

export function aplicarClaseTurno(div,state){
   div.classList.remove(...ALL_TURNO_CLASSES);
   // Limpia un posible gradiente inline (bandas proporcionales) para que al
   // reaplicar el color la celda no conserve el fondo anterior.
   div.style.removeProperty("background");

   const split = TURNO_SPLIT_CLASS[state];

   if(split){
      div.classList.add("turno-split", split);
      return;
   }

   const clase = TURNO_CLASS[state];
   if(clase) div.classList.add(clase);
}

let sidePanelSyncFrame = 0;

export function syncTurnosSidePanelHeight(){
   if(sidePanelSyncFrame){
      cancelAnimationFrame(sidePanelSyncFrame);
   }

   sidePanelSyncFrame = requestAnimationFrame(() => {
      sidePanelSyncFrame = 0;

      const root = document.documentElement;
      const leavePanel = document.getElementById("leavePanel");
      const staffingPanel = document.getElementById("staffingReportPanel");
      const isDesktop = window.matchMedia("(min-width: 1101px)").matches;
      const isTurnosView = document.body.dataset.activeView === "turnos";

      if(
         !leavePanel ||
         !staffingPanel ||
         !isDesktop ||
         !isTurnosView ||
         leavePanel.offsetParent === null ||
         staffingPanel.offsetParent === null
      ){
         root.style.removeProperty("--turnos-side-panel-height");
         return;
      }

      root.style.setProperty(
         "--turnos-side-panel-height",
         `${Math.ceil(leavePanel.getBoundingClientRect().height)}px`
      );
   });
}

export function initTurnosSidePanelSync(){
   syncTurnosSidePanelHeight();
   window.addEventListener("resize", syncTurnosSidePanelHeight);

   const leavePanel = document.getElementById("leavePanel");
   if(!leavePanel || typeof ResizeObserver === "undefined") return;

   const observer = new ResizeObserver(() => {
      syncTurnosSidePanelHeight();
   });

   observer.observe(leavePanel);
}
