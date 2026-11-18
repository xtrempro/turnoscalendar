La segunda versión cierra los tres P2 de mi auditoría anterior y no encontré ningún P1. Quedan dos P2 nuevos, los dos del despliegue y no del código, y cuatro P3. Tampoco esta vez modifiqué el repositorio, ni escribí en producción, ni desplegué. Las comprobaciones contra producción fueron solo lecturas, con scripts guardados en el scratchpad.

## Lo que comprobé que quedó resuelto

- **P2-1 (gente escondida en casillas cerradas o fusionadas):** corregido.
  - Ahora las altas y retiros se aplican a la casilla dueña del grupo, y una casilla cerrada que recibe gente queda abierta.
  - Pasé `normalizeTaskAssignmentWeek` por todas las semanas reales de las cuatro unidades de producción: no cambia la gente de **ninguna** casilla y no reabre ninguna cerrada. El primer guardado después del despliegue no va a mover nombres por sorpresa.
- **P2-2 (vista vieja y relojes distintos):**
  - El acuse completo ya no deja una semana entera protegida durante 30 minutos.
  - El orden lo decide `taskRevision`, que asigna la transacción, y no el reloj del computador.
  - `applyRemoteModule` y la hidratación reconstruyen desde el último documento confirmado y le aplican encima los deltas pendientes.
- **P2-3 (escritores viejos):**
  - Con `merge:true`, una pestaña vieja hereda el `taskWriteId` del documento; como la regla exige uno distinto, la rechaza. Aceptar una revisión igual es correcto, porque la precondición de la transacción obliga a releer.
  - Corrí `npm run test:rules` (38 pass) y `npm run test:storage-emulator` (1 pass, con dos clientes SDK reales).
- **P3 anteriores:**
  - Un documento que falla ya no bloquea a los demás. La reencolada doble que ocurre en `flushPartialStateEntries` es idempotente y no hace daño.
  - El envío pendiente se confirma en su unidad de origen.
  - Un error al planificar ahora se avisa en pantalla.
  - El script de reconciliación escribe `updatedAt` con la hora del servidor (`REQUEST_TIME`), con la precondición `updateTime` en la misma escritura.
- **Pruebas que corrí:** `test:storage-concurrency` 285 pass, `tests/*.test.mjs` 3488 pass, 0 fail, 4 skipped.

## P2 nuevos (despliegue)

**P2-A. Durante la transición, las pestañas viejas pierden también cambios que no son de tareas.**
- **Por qué:** el escritor viejo junta en **una sola transacción** documentos de varios módulos ([js/firebaseAppState.js](js/firebaseAppState.js), `commitPartialStateSliceNow`, que en el código viejo es `commitPartialStateSlice`). Si el lote incluye el documento de asignaciones, las reglas nuevas rechazan la transacción entera.
- **Escritura de respaldo:** su respaldo sin transacción (`commitPartialStateFields`) también lleva ese documento, así que también se rechaza.
- **Ejemplo:** un supervisor con pestaña vieja mueve una casilla y en el mismo minuto aplica un permiso. Ninguno de los dos queda guardado. La pestaña reintenta en bucle con la cola en memoria, y al recargar los pierde.
- **Qué cambia en el plan de despliegue:** la respuesta de GPT dice que los clientes viejos no podrán confirmar **tareas**. En realidad no podrán confirmar nada de lo que viaje junto con una tarea. La pausa tiene que ser de **toda** edición, no solo de tareas, desde el despliegue de reglas hasta recargar cada sesión que escribe.
- **Para verificar:** la versión de escritura de la bitácora (`writer.buildId`) sirve para comprobar que ya no quedan pestañas viejas escribiendo.

**P2-B. Un script de mantenimiento sigue pudiendo pisar asignaciones.**
- **Qué script:** [scripts/reparar-deltas-por-elemento.mjs](scripts/reparar-deltas-por-elemento.mjs) incluye el módulo `tasks`. Reescribe `value`, borra `items` y no usa precondición. Además, `--apply` sigue habilitado.
- **Por qué las reglas no lo frenan:** escribe por REST con la credencial OAuth del dueño, que pasa por IAM y no por las reglas. Un cliente que escriba entre su lectura y su `PATCH` pierde ese cambio.
- **Qué falta:** es la misma clase de riesgo que se cerró en los tres scripts de rescate, pero en este no se cerró. Hay que excluir `tasks` o exigir `updateTime`.
- **Otro script:** `mirror-workspace.mjs` tampoco usa precondición, pero escribe en la unidad espejo.

## P3

1. **La normalización acepta fusiones que la grilla no muestra.**
   - `taskAssignmentParents` ([js/taskAssignmentSync.js](js/taskAssignmentSync.js)) toma cualquier `mergedNextTaskId` como fusión. La grilla (`columnGroups`) y la proyección (`mergedGroupFor`) exigen además que sea la tarea **siguiente** del turno.
   - En Imagenología hay 12 enlaces así, en semanas de agosto y septiembre. Todos apuntan a tareas borradas y sin casillas, así que hoy no hacen nada.
   - Si un enlace queda apuntando a una tarea existente que ya no es contigua, una alta en esa casilla se iría a la de arriba. Hoy ese enlace se limpia al abrir la semana (`cleanAssignmentsForWeek`), lo que reduce el riesgo.
   - Arreglo: aplicar la misma regla de contigüidad con el catálogo, o ignorar enlaces cuya casilla destino no existe.
2. **Un retiro puede no aplicarse si se cruzó con una fusión remota.**
   - Caso: un delta compuesto conserva "X entra en la casilla de abajo" (alta hecha antes de una fusión remota y todavía sin acuse) y el usuario después saca a X de la casilla de arriba.
   - La resolución por grupo (`grouped[...] === true || present`) gana la alta y X sigue asignado.
   - Requiere un delta sin acuse que atraviese una fusión hecha por otra sesión.
3. **Semanas que vivieran solo en chunks:**
   - `mergeLocalDirtyStateEntries` reemplaza la clave con lo que diga solo el documento de entradas (líneas 92-98 del diff). Una semana que existiera únicamente en chunks desaparecería de la vista.
   - Si luego alguien edita esa semana, se escribiría un item con solo la casilla nueva, y ese item taparía al chunk: el resto de la semana se perdería.
   - Revisé producción y test: ninguna unidad tiene semanas en chunks, y las reglas nuevas impiden que aparezcan. Queda latente. Conviene una comprobación al hidratar que lo detecte si alguna vez ocurre.
4. **Costo de reconstruir el documento:** cada bajada o acuse de tareas reconstruye el documento completo, 393 KB en Imagenología, `value` heredado más 19 semanas. No es un error, pero crece con el documento, y ya hubo incidentes de lentitud.

## Qué impide publicar

- **Código:** nada lo impide.
- **Antes de desplegar:**
  - Cerrar P2-B: bloquear o restringir `reparar-deltas-por-elemento.mjs`.
  - Desplegar reglas y luego hosting, con una **pausa de toda edición** y la recarga verificada de cada sesión que escribe (P2-A).
  - El presupuesto de `security:client` sigue sin resolverse y requiere aceptación explícita.
- **Reconciliación de anulaciones:** recién cuando todas las sesiones estén actualizadas.
- **Fase posterior:** los cuatro P3.