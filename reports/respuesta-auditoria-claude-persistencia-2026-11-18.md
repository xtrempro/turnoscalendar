# Segunda corrección tras la auditoría de Claude

18 de noviembre de 2026, Chile. Cambios locales sobre HEAD `7b07bbb`, sin
commit ni despliegue. No se escribieron datos de producción.

Auditoría recibida: `reports/auditoria-claude-persistencia-2026-11-18.md`.
Contexto inicial: `reports/contexto-claude-persistencia-2026-11-18.md`.
Esta segunda implementación fue auditada por Claude: los tres P2 anteriores
quedaron cerrados, sin P1. La segunda auditoría y el cierre de sus pendientes
de publicación se documentan en
`reports/cierre-segunda-auditoria-persistencia-2026-11-18.md`.

## Respuesta a los P2

### P2-1: personas ocultas en casillas cerradas o fusionadas

Corregido en `js/taskAssignmentSync.js`:

- Si al materializar un cierre sobrevive una incorporación concurrente, se
  conserva la persona y la casilla queda abierta. Un cierre sin personas
  continúa cerrado.
- Primero se resuelven los enlaces de fusión; altas y retiros de personas se
  aplican a la casilla dueña del grupo. Esto incluye retirar desde una copia
  anterior a la fusión a una persona que ya se trasladó a la dueña.
- El traslado de una persona tiene un alta arriba y un retiro abajo dentro
  del mismo delta; se resuelve como traslado, sin cancelar su propia alta.
- La normalización reúne personas, notas y exclusiones de predefinidos en la
  dueña. Las casillas ocultas no conservan personas. Se cortan enlaces
  cíclicos o ambiguos para no esconder casillas.

Pruebas en ambos órdenes de llegada: cierre frente a alta y fusión frente a
alta. Se agregó además una prueba de **la proyección real a la PWA**: la
persona ve RX/TAC después de fusionar y RX después del conflicto de cierre.

### P2-2: semana local vieja y relojes distintos

Corregido en `js/firebaseAppState.js`:

- Un acuse completo retira el delta de la protección local; ya no convierte
  la semana materializada en una protección de 30 minutos.
- Los acuses parciales conservan solo las operaciones todavía pendientes.
- Se conserva una copia autoritativa del último documento confirmado, con
  su revisión transaccional. La hidratación de un manifiesto anterior no
  reemplaza esa copia por una versión más vieja. Sobre ella se reaplican
  exclusivamente los deltas pendientes.
- Las tareas dejan de decidir frescura comparando `Date.now()` o el ISO
  del cliente con `updatedAt` del servidor. La revisión decide el orden.
- Al confirmar se materializa también la vista local, sin esperar al eco del
  listener para ver las personas que la transacción fusionó. Un fallo de
  refresco de vista no se convierte en un falso fallo de escritura ni provoca
  el reenvío de operaciones ya confirmadas.

Pruebas nuevas: `applyRemoteModule(..., {force:true})` después del acuse con
otra persona agregada remotamente; rechazo de una versión anterior; reloj
cliente adelantado una hora; recepción de nombres remotos mientras hay un
delta local sin confirmar.

### P2-3: escritores antiguos y scripts de rescate

Corregido con una barrera de escritura en `firebase.rules` y metadatos del
escritor nuevo:

- Documento protegido:
  `workspaces/{id}/stateModules/tasks/entries/weekly_task_assignment_entries`.
- El escritor emite `writerSchemaVersion: 2`, una `taskRevision` calculada
  como la leída + 1 dentro del callback de transacción, un `taskWriteId`
  nuevo por envío y `updatedAt: serverTimestamp()`.
- Las reglas exigen protocolo v2, revisión positiva sin retroceso, nonce
  distinto y timestamp de servidor. **Exigir solo la marca v2 no bastaba:**
  una escritura antigua con `merge:true` heredaría la marca. El nonce distinto
  bloquea esa ruta aunque herede todos los metadatos.
- No se permite escribir la clave de asignaciones en un alias de documento
  ni eliminar el documento protegido desde un cliente.
- Se rechazan las escrituras de chunks antiguos del módulo `tasks`. Su lectura
  histórica continúa permitida; los clientes actuales escriben entradas.
- `scripts/rescatar-asignaciones.mjs`,
  `scripts/reparar-semanas-tareas-renombradas.mjs` y
  `scripts/rescatar-catalogo-tareas.mjs` rechazan `--apply` antes de autenticarse
  o escribir. Conservan la inspección. Sus reposiciones por semanas completas
  quedan deshabilitadas hasta reemplazarlas por una herramienta segura.

**Detalle descubierto con el SDK real:** la primera versión de la barrera
exigía exactamente `request.taskRevision == resource.taskRevision + 1`.
Con dos transacciones que habían leído la misma revisión, el emulador
evaluaba esa condición antes de resolver la precondición del commit y la
segunda recibía `permission-denied`, sin reintento del SDK. Por eso la regla
admite revisión igual o mayor, junto con el nonce nuevo. El callback del
escritor sigue calculando +1 y su precondición de transacción obliga a releer
y recalcular cuando otra sesión confirma primero. El test de SDK fuerza que
los dos clientes lean la misma revisión y exige un reintento real.

Esto es una barrera de compatibilidad para clientes anteriores, no una nueva
autorización. Se mantienen los permisos originales de la unidad. Un miembro
autorizado que fabrique solicitudes nuevas manualmente no equivale a una
pestaña antigua que reutiliza sus metadatos.

## Respuesta a los P3 operativos

- **Documento corrupto dentro de un lote:** el flush manual intenta la
  transacción conjunta y, si falla, aísla las claves para confirmar las sanas.
  Reconoce lo confirmado y reencola solamente lo fallido. La cola automática
  también conserva la clave fallida y avanza con las demás. Un JSON ilegible
  no se interpreta como vacío ni se reemplaza ciegamente.
- **Cambio de unidad con envío ya capturado:** la cola serial confirma en
  la unidad de origen; no borra el envío ni cambia el destino. Su acuse no
  modifica protecciones ni colas de la unidad nueva. Si ya confirmó, el flush
  devuelve éxito con `saved-origin-workspace`.
- **Error al planificar un evento:** se informa mediante `app-state-error`,
  indicando que los cambios de esa clave siguen solo en el equipo. Las otras
  claves del evento continúan encolándose. No se deja el fallo solo en consola.
- **Hora del script de reconciliación:** se usa un commit REST con
  `updateTransforms: REQUEST_TIME` para `updatedAt`, junto con la precondición
  `updateTime` de la misma escritura. Se conserva `updatedAtISO` como dato
  diagnóstico. Referencia de la operación:
  [Firestore Write](https://firebase.google.com/docs/firestore/reference/rest/v1/Write).

El orden del array persistido de personas no recibe un nuevo orden global por
rol: las incorporaciones conservan su orden de mezcla y las vistas mantienen
su ordenamiento existente. No se hizo poda histórica ni fragmentación semanal:
el crecimiento del documento requiere una fase de almacenamiento separada.
No se eliminan semanas automáticamente a partir de una proyección de tamaño.

## Archivos adicionales o modificados en esta segunda corrección

- `js/taskAssignmentSync.js`: invariantes y operaciones dentro de grupos.
- `js/firebaseAppState.js`: revisiones, cache confirmado, retiro de deltas,
  aislamiento de fallos, acuses y destinos de envíos.
- `firebase.rules`: barrera de escritores y chunks antiguos.
- Los tres scripts de rescate enumerados arriba: escritura deshabilitada.
- `scripts/lib/firebase-rest.mjs` y
  `scripts/reconcile-audit-log-cancellations.mjs`: timestamp de servidor.
- `tests/task-assignment-concurrency.test.mjs`,
  `tests/task-assignment-projection.test.mjs`,
  `tests/security-rules.test.mjs`,
  `tests/reconcile-audit-log-cancellations.test.mjs`.
- Nuevos `tests/task-assignment-firestore.test.mjs` y
  `tests/task-rescue-read-only.test.mjs`.
- `package.json`: regresión ampliada y `test:storage-emulator`.

Los archivos nuevos de la primera implementación siguen siendo necesarios:
`auditLogCancellation.js`, las pruebas de anulaciones y el script de
reconciliación. Revisar también los `??`; no limitarse a `git diff`.

## Validación

- `npm.cmd run test:storage-concurrency`: **285 aprobadas, cero fallos**.
- Suite unitaria general de `tests/*.test.mjs` y `functions/test/*.test.js`,
  excluyendo los ficheros `*.integration.test.js`: **3.844 aprobadas, cero
  fallos, cuatro omitidas por requerir emuladores**.
- `npm.cmd run test:rules`: **38 aprobadas en los emuladores**, incluidas la
  marca heredada por merge, nonce sin cambio, revisión en retroceso, fecha
  falsa, alias, borrado y chunks antiguos.
- `npm.cmd run test:storage-emulator`: cliente SDK real y reglas reales en
  el proyecto demo local; ambos deltas sobreviven y el escritor viejo falla.
- `npm.cmd run build`: compilación de producción y equivalencia de motores
  ofuscados verificadas. El control de tamaño `security:client` conserva el
  problema previo de presupuesto; no se modificaron umbrales.

La primera invocación indiscriminada de todos los tests incluyó
`functions/test/getAccountsDeletion.integration.test.js`; abortó al cargar
porque exige `FIRESTORE_EMULATOR_HOST`. No es un fallo de la corrección.
La ejecución unitaria posterior excluyó explícitamente los tests de integración;
ese test ajeno no se modificó ni se reporta como aprobado.

Logs de validación local, ignorados por Git, en `.tools/storage-*-20261118.log`.
No se hizo una prueba visual con dos navegadores reales.

## Reauditoría solicitada

Revisar los P2 corregidos, especialmente:

1. La aplicación de altas/retiros sobre la dueña después de un cambio de
   topología; traslado dentro de un delta, cierres y reintentos.
2. La copia autoritativa por revisión, sus actualizaciones durante hidratación,
   listeners y acuses, y el reinicio al cambiar de unidad.
3. La barrera de reglas con nonce y revisión, incluyendo la excepción de
   revisión igual para que el SDK pueda reintentar conflictos reales.
4. El aislamiento de un fallo sin reenviar documentos confirmados ni descartar
   modificaciones que llegaron durante un envío.
5. El comportamiento del envío a la unidad original y del aviso de resultado.
6. El timestamp REST de servidor y la conservación de la precondición CAS.

Entregar hallazgos reproducibles por severidad. No modificar archivos ni
publicar durante la auditoría. No interpretar las pruebas aprobadas como
aprobación de Claude de esta segunda versión.

## Publicación y pendientes

**No se desplegó frontend ni reglas; no se aplicó la reconciliación.**

Ahora hay un cambio de reglas obligatorio. Tras la reauditoría y la resolución
o aceptación explícita del presupuesto de bundle, coordinar una pausa breve
de **toda edición de la aplicación, en todas las unidades afectadas**:
confirmar los guardados pendientes, publicar reglas, publicar frontend y recargar las sesiones
escritoras. El predeploy de Hosting comprueba las reglas vivas, por lo que
no se propone saltar esa verificación ni publicar frontend con reglas distintas.
Mientras dure la transición, una tarea en el lote de un cliente viejo puede
hacer fallar también permisos, calendarios u otros documentos del mismo lote.
La pausa no puede limitarse al menú de tareas. No recargar ni cerrar sesiones
con cambios aún sin confirmar; ver el procedimiento completo en el cierre
de la segunda auditoría.

La barrera añadida protege asignaciones de tareas. La bitácora continúa con
doble escritura y guardias de anulación de la primera corrección: antes de
reconciliar sus dos divergencias hay que confirmar que sus escritores también
estén actualizados. La doble escritura entre ubicaciones no es atómica.

Verificar dos sesiones actualizadas y después ejecutar la simulación de
reconciliación; aplicar solo el plan revisado con respaldo y CAS. La migración
completa de reemplazos, el tamaño histórico de tareas y la durabilidad de la
cola al cerrar la aplicación siguen como fases separadas. No se restauraron
nombres por inferencia ni se cambiaron las marcas de migración de la unidad.
