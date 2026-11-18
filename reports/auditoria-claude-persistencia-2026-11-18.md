No encontré ningún P1, es decir, ningún camino en que las asignaciones o las anulaciones se pierdan en Firestore. Con los cambios probados, ninguna ruta vuelve a escribir semanas completas: el flush manual, la cola, el reencolado tras un fallo y el primer item sobre chunks aplican el delta en la transacción. Encontré tres P2 y varios P3. Uno de los P2, además, puede seguir produciendo el síntoma denunciado, nombres que no se ven en las casillas, aunque el dato exista en la nube.

No modifiqué archivos del repositorio ni hice despliegues; mi único script de reproducción vive en el scratchpad. Corrí `npm run test:storage-concurrency` (273 pass, 0 fail) y la suite completa (3476 pass, 0 fail, 3 skipped).

## P2

**P2-1. La mezcla campo por campo rompe dos invariantes de la casilla y esconde nombres** (reproducido)
- **Dónde:** [js/taskAssignmentSync.js:97-125](js/taskAssignmentSync.js#L97-L125), `applyTaskAssignmentPatch`.
- **Casilla cerrada:**
  - Base `{workers:[ANA]}`. La sesión B agrega a BETO y confirma; la sesión A cierra la casilla y confirma después.
  - Resultado: `{"workers":["BETO"],"closed":true}`.
  - `taskAssignments.js` trata "cerrada con gente" como un estado que la casilla no sabe dibujar. La proyección hacia la PWA corta en `assignmentClosed` ([js/taskAssignmentProjection.js](js/taskAssignmentProjection.js), `dayTaskAssignments`), así que BETO no ve la tarea en su teléfono.
- **Fusión de casillas:**
  - A fusiona RX con TAC: la gente de TAC sube a RX y TAC queda vacía. Al mismo tiempo, B agrega a DIEGO en TAC.
  - Resultado: DIEGO queda en TAC, que es la casilla oculta del grupo.
  - La proyección solo lee la casilla dueña del grupo (`mergedGroupFor` y luego `group.ownerId`). DIEGO desaparece del tablero y de la PWA, justo el caso contra el que advierte el comentario de `collapseGroupWorkers`.
- **Reproducción:** `node C:\Users\tmala\AppData\Local\Temp\claude\c--Users-tmala-OneDrive-Escritorio-ProTurnos\522b3b91-cf2b-46a4-a8d8-7c34380e8ac9\scratchpad\audit-task-invariants.mjs`.
- **Por qué no bloquea:** antes del arreglo, ese alta concurrente se perdía entera; ahora se conserva, pero escondida. La prueba "notas, cierre, fusion…" usa campos distintos y no cruza invariantes.
- **Arreglo sugerido:** que la materialización restituya las invariantes. Por ejemplo, "cerrada ⇒ sin gente" (o abrirla si llegó alguien) y "alta en una casilla fusionada ⇒ va a la casilla dueña". Agregar estos dos casos como prueba.

**P2-2. La vista local puede seguir perdiendo nombres de otras sesiones** (deducido leyendo el código, no reproducido)
- **Copia local que se reaplica entera:**
  - Tras un acuse completo, el registro de protección deja de llevar el delta y pasa a llevar la semana materializada completa ([js/firebaseAppState.js:1368-1371](js/firebaseAppState.js#L1368-L1371)), y sigue protegido 30 minutos.
  - Si en ese plazo corre `applyRemoteModule`, sea por un cambio del manifiesto del módulo o por la hidratación diferida con `force`, `mergeLocalDirtyStateEntries` ([:2196](js/firebaseAppState.js#L2196)) encima esa semana vieja sobre la remota más nueva.
  - Las entradas ya aplicadas por firma no vuelven a aplicarse. Los nombres que otra sesión agregó después de nuestro guardado quedan fuera de la vista hasta que alguien vuelva a escribir el documento.
- **Relojes distintos:**
  - `confirmedAt` y `changedAt` vienen de `Date.parse(payload.updatedAtISO)`, la hora del cliente ([:1366](js/firebaseAppState.js#L1366), [:567](js/firebaseAppState.js#L567)). En cambio, `remoteEntryUpdatedAtMillis` usa la hora del servidor.
  - Con un computador adelantado Δ minutos, durante Δ después de cada guardado se descartan las bajadas de otras sesiones ([:670](js/firebaseAppState.js#L670)), y también el eco de la propia escritura, que es el que trae lo que la transacción mezcló.
  - La comparación genérica ya mezclaba los dos relojes antes de este cambio, pero ahora se aplica a las tareas sin vencimiento mientras quede un delta pendiente.
- **Qué no afecta:** los datos remotos, porque cada edición viaja como delta. Lo que se pierde es lo que ve el supervisor.
- **Arreglo sugerido:** no convertir el acuse en una protección de semana entera, o hacer que `mergeLocalDirtyStateEntries` reaplique solo deltas. Para comparar, usar el `updatedAt` del servidor leído en el eco.

**P2-3. Pestañas antiguas y scripts siguen escribiendo semanas completas, y nada lo impide** (riesgo de despliegue)
- **Pestañas antiguas:** el contexto lo reconoce como límite. Sin una marca de almacenamiento o una regla que rechace escritores viejos, basta un computador de supervisor que nunca recargue para que la pérdida vuelva.
- **Scripts:** `scripts/rescatar-asignaciones.mjs`, `reparar-semanas-tareas-renombradas.mjs` y `rescatar-catalogo-tareas.mjs` escriben `weekly_task_assignment_entries` por semana completa. Usarlos con sesiones abiertas pisa ediciones concurrentes.
- **Recomendación:** exigir en las reglas un `writerSchemaVersion` mínimo para el módulo `tasks`, o al menos forzar la recarga y confirmarla antes de dar el arreglo por publicado.

## P3

- **Un dato remoto corrupto bloquea el lote completo:**
  - Varias lecturas lanzan error dentro de la transacción ante JSON corrupto: [taskAssignmentSync.js:156](js/taskAssignmentSync.js#L156), [:163](js/taskAssignmentSync.js#L163), [:155](js/taskAssignmentSync.js#L155) (falta `taskPatches`), [auditLogCancellation.js:16](js/auditLogCancellation.js#L16), [:21](js/auditLogCancellation.js#L21) y [firebaseAuditLogShards.js:104](js/firebaseAuditLogShards.js#L104).
  - Antes, la bitácora tenía escritura de respaldo; ahora no la tiene ([firebaseAppState.js:1385](js/firebaseAppState.js#L1385)).
  - Resultado: un solo item remoto corrupto haría fallar para siempre el lote entero, incluidos reemplazos y calendarios del mismo envío. Hoy no hay datos corruptos (según el informe vivo), pero conviene aislar el documento que falla.
- **Cambio de unidad durante un envío:**
  - Un envío de tareas que esperaba en la cola serial se descarta si cambia la generación ([firebaseAppState.js:1299](js/firebaseAppState.js#L1299)). El código anterior lo escribía en su unidad de origen, que era el destino correcto.
  - Además, `flushPendingFirebaseAppStateEntries` devuelve `workspace-changed` aunque ya haya confirmado. Eso hace que `sealCriticalProfileState` muestre "No se pudo confirmar el guardado" sobre datos que sí quedaron guardados.
- **Orden de los nombres:** las altas se agregan al final de `workers` ([taskAssignmentSync.js:105-107](js/taskAssignmentSync.js#L105-L107)) sin `sortTaskWorkersByRole`, así que el orden por rol se pierde tras una mezcla. Es cosmético.
- **Error en el oyente de cambios:** un `previous`/`next` que no se puede leer lanza dentro del oyente `proturnos:persistenceChanged`. La edición no se encola y solo queda un aviso en la consola; el usuario cree que guardó.
- **Tamaño del documento:** `weekly_task_assignment_entries` pesa 393.750 bytes con 19 semanas (unos 20 KB por semana, según el informe vivo). A ese ritmo cruza 1 MiB en unos 7 meses, y para las tareas ya no hay escritura de respaldo. Esto es anterior al cambio, pero conviene planificar la poda.
- **Script de reconciliación:** es correcto en lo esencial. Lee en seco por defecto, exige el nombre exacto de la unidad, rechaza cualquier otra diferencia, respalda antes de escribir, usa la precondición `updateTime` y verifica después. Dos observaciones:
  - Escribe `updatedAt` con la hora del script ([scripts/reconcile-audit-log-cancellations.mjs:79](scripts/reconcile-audit-log-cancellations.mjs#L79)). Si va atrasada, las sesiones con cambios locales recientes la toman como bajada vieja y no la aplican. Conviene usar la hora del servidor (`REQUEST_TIME`).
  - No relee los fragmentos de origen antes de escribir. Es aceptable, porque los fragmentos están protegidos contra retrocesos.

**Faltan estas pruebas:** las dos invariantes de P2-1; la reaplicación de la semana entera de P2-2 con un `applyRemoteModule` después del acuse; un reloj de cliente adelantado; un item remoto corrupto dentro de un lote con otros documentos; y el cambio de unidad con un envío ya en la cola serial.

## Qué impide publicar y qué puede esperar

- **Código:** nada lo impide. No hay P1.
- **Proceso de publicación:**
  - Decidir P2-3: forzar la recarga de las sesiones que escriben, o agregar una barrera de versión.
  - `security:client` sigue fallando por el presupuesto de tamaño del bundle. La falla es anterior y hay que aceptarla o resolverla de forma explícita.
  - No usar los scripts de rescate de tareas con sesiones abiertas.
- **Fase posterior:** P2-1 y P2-2, porque mantienen visible el síntoma de nombres que desaparecen aunque los datos estén a salvo. Correr la reconciliación de anulaciones recién cuando todas las sesiones tengan el código nuevo, porque una pestaña antigua puede volver a quitarlas.