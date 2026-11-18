# Contexto para auditoría de Claude: persistencia y asignación de tareas

**Histórico de la primera implementación.** La auditoría recibida y la segunda
corrección se documentan en `reports/respuesta-auditoria-claude-persistencia-2026-11-18.md`.
Esa respuesta reemplaza el estado de implementación y las instrucciones de
publicación de este documento; aquí se conserva el contexto inicial.

Fecha: 18 de noviembre de 2026, Chile.
Repositorio: `C:\Users\tmala\OneDrive\Escritorio\ProTurnos`.
HEAD de referencia: `7b07bbb`.
Los cambios están en el árbol de trabajo, **sin commit ni despliegue**.

## Solicitud de auditoría

Auditar la corrección de pérdida de nombres en asignaciones y la protección
de anulaciones de bitácora. Buscar defectos reproducibles de concurrencia,
regresiones y riesgos de despliegue. No modificar archivos ni ejecutar
operaciones de escritura en producción durante la auditoría. Entregar los
hallazgos por severidad, con archivo, línea, escenario mínimo y consecuencia;
indicar expresamente qué impide publicar y qué requiere una fase posterior.

No basta revisar `git diff`: varios archivos de esta corrección son nuevos y
aún aparecen como `??`. Revisar también los archivos nuevos enumerados abajo.
Hay informes y scripts de otras auditorías ya presentes antes de este trabajo;
no son parte de esta corrección.

## Incidente y evidencia

El usuario recibió un correo que decía:
`Diferencias en bitacora (formato viejo vs fragmentos): Imagenologia: 1 (viejo 573, nuevo 2080)`.
Se encontró el evento exacto en `storageHealthEvents`, fechado el 13/11/2026.
Además le informaron que el **17/11 desaparecían nombres de las casillas** al
preparar la asignación de tareas; no desaparecían las filas del catálogo.

La revisión de solo lectura de producción encontró:

- Proyecto `calendarioturnos-7c4d9`, unidad Imagenologia,
  `Boh7mvO5ku9quFFsPcIq`.
- Marcas: `stateStorage: entries-v1`, `auditLogStorage: shards-read-v1`,
  `replacementStorage: records-shadow-v1`.
- Bitácora antigua: 573 eventos. Fragmentos: 2.137 eventos, 221 documentos,
  sin fragmentos rotos ni ids duplicados. Dos diferencias, ambas anulaciones
  que el archivo conserva y que faltan en el evento antiguo:
  `1794486661611_ui9ht3n4sje` (licencia, anulación del 12/11) y
  `1794233397199_no6o1kfao` (permiso administrativo, anulación del 17/11).
- Catálogo: 17 tareas activas. Semana 16–22/11: 112 casillas, 116 nombres
  asignados, sin referencias a tareas ausentes del catálogo.
- Reemplazos: 1.127 coincidentes en ambos formatos; documento antiguo al
  83,9 % del límite de 1 MiB; 521 documentos individuales sin `date` superior.

No se identificó la casilla/persona específica denunciada y la bitácora solo
guarda resúmenes de edición, algunos truncados. **El defecto se reprodujo,
pero no se probó que fuera la causa exacta del incidente del 17/11.**

Diagnóstico anterior y evidencia local:
`reports/auditoria-persistencia-2026-11-18.md`,
`reports/auditoria-persistencia-live.json`,
`reports/auditoria-persistencia-live.mjs` (solo lectura).

## Problema corregido

`weekly_task_assignment_entries` tiene forma:

```js
{
  "2026-11-16": {
    "day|task-id|2026-10-17": { workers: ["PERSONA"] }
  }
}
```

El mes de la clave interna del día es base cero; la clave de semana es ISO.
El planificador genérico partía por primer nivel, es decir, por semana.
Firestore almacenaba cada semana como un string JSON en `items[semana]`.
Una transacción fusionaba el mapa `items`, pero sustituía ese string entero.
Dos sesiones editando casillas distintas de la misma semana perdían el cambio
de la primera al confirmar la segunda. Dos pestañas de una misma cuenta bastan.
El saneado automático y la preparación de publicaciones a la PWA también pueden
generar guardados; no se requiere que ambas sesiones hagan clic a la vez.

## Implementación

### Archivos de aplicación

1. **Nuevo `js/taskAssignmentSync.js`.**
   Calcula cambios por casilla/campo a partir de `previous` y `next` reales.
   `workers` y `removedDefaults` cambian por pertenencia de cada persona;
   notas, cierres y fusiones cambian por campo. Compone operaciones pendientes,
   resta únicamente lo que un acuse efectivamente confirmó y materializa el
   delta sobre la última semana leída en la transacción. Los reintentos son
   idempotentes. Retirar una persona respeta ese retiro y conserva otras altas.
   Si se elimina una casilla o semana, retira los datos conocidos sin borrar
   casillas/personas concurrentes que esa sesión nunca tuvo.
2. **`js/firebasePartialState.js`.**
   Planea las asignaciones con su caso específico. Un evento masivo o un flush
   sin `previous`/`next` no republica la copia completa. Agrupa los metadatos
   locales (`taskPatch` / `taskPatches`) y los reaplica sobre snapshots locales.
3. **`js/firebaseAppState.js`.**
   Conserva los deltas al agrupar/desagrupar y reencolar. Compone por orden real
   de edición; un reintento antiguo no pisa cambios posteriores. Serializa los
   envíos locales de tareas para ordenar flush manual y cola automática.
   La transacción aplica el delta a su última lectura y vuelve a calcularlo
   si Firestore reintenta. No permite fallback de tareas/bitácora a escritura
   sin lectura. Una confirmación no descarta operaciones nuevas creadas durante
   el viaje. Un fallo de otro documento del lote no reenvía documentos que ya
   confirmaron. Los cambios de sesión/unidad no reencolan el lote antiguo en
   la sesión nueva. Al bajar estado remoto conserva cambios locales pendientes
   y deja pasar las casillas ajenas. Los deltas sin acuse no vencen a los 30 min.
4. **Nuevo `js/auditLogCancellation.js`.**
   Conserva la anulación más reciente del mismo id frente a copias atrasadas.
   No mezcla permisos nuevos con ids distintos. La poda continúa permitida.
5. **`js/firebaseAuditLogShards.js`.**
   Usa esa protección al escribir fragmentos. El escritor antiguo también la
   usa desde la transacción de `firebaseAppState.js`.

**Esquema remoto conservado:** Firestore recibe semanas completas ya
materializadas, con `items`/`deletedItems` existentes. Los metadatos de delta
solo viven en las colas locales; no se guardan como campos remotos.
`functions/lib/stateReader.js` y los lectores de la PWA siguen leyendo la
misma forma de datos. No se cambiaron reglas ni Cloud Functions.

### Reconciliación de datos existente

**Nuevo `scripts/reconcile-audit-log-cancellations.mjs`.** Por defecto solo
lee y presenta el plan. Exige unidad y nombre exactos, revisa la integridad
de fragmentos y la legibilidad del formato antiguo. Rechaza otras clases de
diferencias. Solo propone llevar anulaciones desde los fragmentos a sus
mismos ids antiguos; nunca hace backfill desde la copia antigua al archivo.

Con `--apply` crea primero un respaldo de la bitácora y fragmentos fuente en
`migration-backups/`, usa precondición `updateTime` sobre el documento antiguo
y verifica el resultado leído. Esta opción **no se ejecutó en producción**.
La simulación de producción identificó exactamente las dos anulaciones citadas.
Los casos `--apply`, respaldo previo y rechazo por escritura concurrente se
probaron con un cliente de Firestore simulado y directorios temporales.

Comando seguro de inspección, que no escribe:

```powershell
node scripts/reconcile-audit-log-cancellations.mjs --workspace Boh7mvO5ku9quFFsPcIq --expected-name Imagenologia
```

No usar el backfill genérico `audit-audit-log-shards.mjs --apply` para estas
dos diferencias: toma la antigua como referencia y quitaría del archivo los
metadatos de anulación que queremos preservar.

### Pruebas y reproducción

Nuevos:

- `tests/task-assignment-concurrency.test.mjs` (19 casos).
- `tests/audit-log-cancellation-sync.test.mjs` (5 casos).
- `tests/reconcile-audit-log-cancellations.test.mjs` (4 casos).

Actualizado `tests/edicion-concurrente-listas.test.mjs`: sus ejemplos de tareas
usaban valores escalares ficticios dentro de una semana. Se reemplazaron por
casillas con `workers`, y el helper de escritura ahora aplica el mismo guardia
que la transacción. Se conserva la prueba de semanas distintas; los nuevos
casos cubren el conflicto dentro de la misma semana que esa prueba no detectaba.

Las pruebas nuevas ejercitan el planificador y la transacción reales con un
SDK simulado. Para probar colas, acuses y aplicación remota se empaqueta el
módulo real con esbuild y se agregan accesos de prueba a su estado privado;
no se sustituye la implementación de esos mecanismos. Incluyen conflicto con
una tercera edición remota que obliga a repetir el callback de transacción,
edición mientras un envío está bloqueado, retiros concurrentes, notas/cierres/
fusiones, reintentos, cambio de sesión y fallo parcial del lote.

`reports/auditoria-persistencia-repro.mjs` demuestra el comportamiento anterior
y el corregido sin red ni datos reales. `package.json` incorpora el comando
reproducible de regresión.

## Validación efectuada

```powershell
npm.cmd run test:storage-concurrency
node reports/auditoria-persistencia-repro.mjs
npm.cmd run build
git diff --check
```

Resultado: **273 pruebas aprobadas, cero fallos**. La reproducción muestra que
antes se pierde PERSONA A y después sobreviven A y B. El build de producción
compila y verifica la equivalencia de los seis motores ofuscados. Diff sin
errores de espacios.

El control adicional `npm.cmd run security:client` **falla por presupuesto de
tamaño del bundle**. Se verificó la misma falla construyendo HEAD `7b07bbb`
en un worktree aislado, sin esta corrección:

| Build | Bytes raw del bundle principal |
| --- | ---: |
| HEAD sin cambios | 2.340.918 |
| Con corrección | 2.347.026 |
| Máximo configurado | 841.559 |

Incremento observado: 6.108 bytes, 0,26 %. La obfuscación/build puede variar
ligeramente entre ejecuciones. La falla del presupuesto ya existía; **no se
ajustó la línea base ni se desactivó el control**. Evidencia en
`reports/auditoria-persistencia-build-budget.json`. Este chequeo no puede
reportarse como aprobado y debe resolverse o aceptarse explícitamente en el
proceso de publicación que corresponda.

No se probaron dos navegadores reales ni se ejecutó esta corrección contra el
emulador de Firestore. Los ensayos concurrentes de transacción usan el SDK
simulado descrito. No hay cambios de reglas ni de esquema remoto.

## Puntos a desafiar durante la auditoría

1. ¿Queda alguna ruta que vuelva a escribir semanas completas sin el delta?
   Revisar flush manual, publicaciones a trabajadores, reencolado de documentos,
   falta de `previous`/`next`, primer item sobre chunks y `value` heredados.
2. ¿Se conserva el orden correcto cuando edición, reintento, flush manual,
   acuse y snapshot llegan en órdenes distintos? Examinar `confirmedAt`,
   protecciones locales, expiración, relojes cliente/servidor y firmas aplicadas.
3. ¿Un retiro explícito o el borrado de una tarea sigue limpiando lo que debe,
   conservando incorporaciones concurrentes? Revisar además fusiones de
   casillas, cambios en el mismo campo y `removedDefaults`.
4. ¿La cola serial de tareas y el manejo de cambio de generación evitan
   confirmar operaciones antiguas después de nuevas o llevarlas a otra unidad?
5. ¿Se mantiene la compatibilidad de lectores servidor/PWA y los límites de
   tamaño y reglas, sin persistir los metadatos locales del parche?
6. ¿Las anulaciones conservan su estado en los dos escritores, con ids
   distintos, poda, `value` heredado y transacción fallida?
7. ¿El script de reconciliación solo toca anulaciones verificadas, respalda
   antes, usa la precondición y verifica? Evaluar cambios concurrentes tanto
   del documento destino como de los fragmentos fuente.
8. ¿Las pruebas verifican el comportamiento relevante o tienen supuestos que
   lo dejan pasar? Proponer casos faltantes con reproducción concreta.

## Límites y tareas posteriores

- **No se desplegó ni reparó producción.** Las dos divergencias siguen
  pendientes hasta ejecutar y verificar la reconciliación revisada.
- La lectura sigue siendo compatible con clientes anteriores; **la escritura
  de una pestaña antigua sigue siendo vulnerable** porque no ejecuta estos
  guardias. El despliegue debe incluir recarga de las sesiones escritoras y
  comprobación de dos sesiones actualizadas. No se incorporó un bloqueo de
  builds antiguos mediante reglas o una nueva marca de almacenamiento.
- Esta corrección no hace atómica la doble escritura de bitácora entre
  ubicaciones; las protege contra retrocesos de anulaciones en cada ruta.
  El monitor continúa detectando divergencias.
- Las colas de sincronización siguen siendo de memoria, como antes. La
  protección de deltas pendientes durante la sesión no equivale a persistir
  una cola recuperable tras cerrar o recargar la aplicación.
- La migración completa de reemplazos y retirada de la lista antigua no está
  incluida: requiere completar fechas, cambiar lectores/escritores y cerrar
  su ventana de compatibilidad. No se cambiaron marcas de migración ni se
  limpiaron `value`, tombstones o documentos históricos.
- No se restauraron nombres por inferencia. La investigación del caso exacto
  necesita al menos una persona/casilla afectada o evidencia de las sesiones.

Después de la auditoría: resolver hallazgos, coordinar sesiones actualizadas,
publicar el frontend con los controles de publicación resueltos, verificar
ediciones concurrentes y reintentos en dos sesiones, y recién entonces aplicar
y verificar la reconciliación de anulaciones. La migración de reemplazos se
planifica como fase separada.
