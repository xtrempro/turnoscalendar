# Revisión de persistencia y nombres desaparecidos

Este documento conserva el diagnóstico previo a la corrección. La implementación
y el contexto para su revisión están en `reports/contexto-claude-persistencia-2026-11-18.md`.

Revisión del 18 de noviembre de 2026 de Imagenologia, unidad
`Boh7mvO5ku9quFFsPcIq`, proyecto de producción `calendarioturnos-7c4d9`.
Se consultó Firestore en modo de solo lectura y se reprodujo un conflicto
localmente. No se modificaron datos remotos, marcas de migración ni código de
la aplicación. Las cifras corresponden a la lectura de las 08:33 de Chile;
pueden variar con el uso de la aplicación.

## Hallazgo principal: los nombres pueden perderse al sobrescribir una semana

**Prioridad alta. Defecto reproducido; causa del incidente del 17 de noviembre
aún no confirmada.**

`saveWeekAssignments` guarda `weekly_task_assignment_entries` con esta forma:
`{ semana: { casilla: { workers: [...] } } }`.
`planObjectStateEntries` sincroniza las claves del primer nivel, por lo que
la unidad de escritura es **la semana entera**, aunque se modifique un solo
nombre de una casilla. En Firestore cada semana es un string JSON dentro de
`items`. La transacción de `commitPartialStateSlice` conserva otras semanas,
pero reemplaza el string de la semana editada: no fusiona sus casillas.

Reproducción con las funciones reales del cliente y del lector del servidor:

1. Dos sesiones parten de la misma semana vacía.
2. A agrega PERSONA A a Resonador.
3. B, que todavía tiene la copia anterior, agrega PERSONA B a Escáner.
4. Se guardan A y luego B.
5. Queda solamente PERSONA B. Desaparece PERSONA A aunque B nunca la quitó.

El control con ediciones en semanas diferentes conserva ambos cambios.
Dos pestañas de una misma cuenta bastan; no se necesitan dos usuarios.
Además, `cleanAssignmentsForWeek` puede guardar desde el pintado del tablero
y desde la preparación de la publicación a trabajadores, así que una escritura
no necesariamente representa una edición manual simultánea.

Ubicaciones del código: `js/taskAssignments.js` (`saveWeekAssignments`,
`cleanAssignmentsForWeek`), `js/firebasePartialState.js`
(`planObjectStateEntries`, `applyMapStateEntries`), `js/firebaseAppState.js`
(`partialStateDocumentPayload`, `commitPartialStateSlice`) y
`functions/lib/stateReader.js` (`applyEntry`).

La solución debe conservar el detalle de los cambios por casilla y aplicarlo
sobre el estado actual en la transacción, o introducir almacenamiento por
casilla con una transición compatible entre lectores, escritores y clientes
anteriores. Fusionar simplemente todos los nombres impediría los borrados
deliberados y no sería una corrección válida.

## El correo identificado y las diferencias de bitácora

Se encontró el evento de salud del **13 de noviembre de 2026** cuyo texto
coincide exactamente con la captura: `1 (viejo 573, nuevo 2080)`.

En la lectura actual hay 573 registros antiguos y 2.137 archivados en 221
fragmentos. Hay **dos diferencias de contenido**, ningún registro faltante
entre esos dos casos, y cero fragmentos rotos o registros duplicados.

| Registro | Acción original | Diferencia observada |
| --- | --- | --- |
| `1794486661611_ui9ht3n4sje` | Licencia médica del 12/11 | El archivo incluye anulación del 12/11 a las 10:07 de Chile; la copia antigua carece de `canceledAt`, `canceledBy` y `cancellationDetails`. |
| `1794233397199_no6o1kfao` | Permiso administrativo del 09/11 | El archivo incluye anulación del 17/11 a las 17:06 de Chile; la copia antigua carece de los mismos tres campos. |

Que el archivo tenga más registros es esperable: conserva los eventos que la
bitácora antigua poda. El aviso no compara solo las cantidades; compara el
contenido de los registros que todavía existen en la antigua.

La doble escritura usa colas independientes y no constituye una sola operación
atómica entre las dos ubicaciones. Se confirmó la divergencia; esta revisión
no identifica cuál de las escrituras o sesiones hizo que quedara así.
No conviene reconciliar ejecutando ciegamente el backfill desde la antigua:
`scripts/audit-audit-log-shards.mjs --apply` tomaría la antigua como referencia
y podría quitar de estos fragmentos los metadatos de anulación más recientes.
La reconciliación debe preservar las anulaciones verificadas.

Las dos diferencias son eventos de permisos y licencias, no asignaciones de
tareas. No hay evidencia suficiente para atribuir la desaparición de nombres
al correo. El conflicto de escritura semanal es una vía independiente y
reproducida para producir ese síntoma.

## Estado real de las migraciones

| Área | Marca vigente | Lectura y persistencia |
| --- | --- | --- |
| Estado modular | `stateStorage: entries-v1` | La unidad está marcada para leer el estado por entradas. |
| Bitácora | `auditLogStorage: shards-read-v1` | El menú LOG ya lee fragmentos. La copia antigua y la doble escritura siguen por compatibilidad. |
| Reemplazos | `replacementStorage: records-shadow-v1` | La lista antigua sigue siendo la referencia; los documentos individuales son una copia paralela. |
| Asignación de tareas | Entradas del módulo `tasks` | Cada semana sigue siendo un valor completo, sin aislamiento de escritura por casilla. |

La migración, por tanto, **no está terminada**. Cambiar únicamente la lectura
del LOG no retira la persistencia antigua ni corrige el conflicto de tareas.

Los 1.127 reemplazos coinciden entre ambos formatos. Hay 521 documentos
individuales sin `date` en el nivel superior, pendiente de resolver antes de
depender de consultas por fecha. El documento antiguo ocupa aproximadamente
879.815 bytes, **83,9 % del límite de 1 MiB**. El 85 % es el umbral crítico
interno del monitor, no el punto en que Firestore deja de escribir.

Ese documento conserva también un `value` antiguo de aproximadamente 92,7 kB.
Su retirada solo puede evaluarse verificando cobertura exacta y compatibilidad;
no se realizó limpieza. El documento de tareas ocupa aproximadamente
393.750 bytes (37,6 % del límite), por lo que su tamaño actual no explica por
sí solo la pérdida de nombres.

## Lo que se pudo comprobar del 17 de noviembre

- El catálogo mantiene 17 tareas activas; no se observó una eliminación reciente
  del catálogo completo.
- La semana del 16 al 22 de noviembre tiene 112 casillas guardadas y 116
  asignaciones de personas. No tiene casillas que apunten a tareas ausentes
  del catálogo. Esto no demuestra que todos los nombres esperados estén.
- Se encontraron siete resúmenes de edición de esa semana durante el día
  chileno 17/11: 12:33, 12:37, 12:40, 13:32, 13:37, 22:01 y 22:04.
  Todos llevan el build `20261111T202727Z-7b07bbb`.
- Los resúmenes registran altas, retiros y movimientos, pero no guardan una
  versión completa de cada escritura. Algunos textos se truncan a ocho
  cambios. Las limpiezas automáticas tampoco quedan atribuidas como edición
  deliberada. No permiten reconstruir con certeza la secuencia de nombres
  que habría desaparecido.
- Para atribuir el caso concreto falta identificar al menos una persona y
  casilla afectada, y contrastarla con ausencias, inactivaciones, fusiones,
  filtros y las sesiones usadas. No se restauró ninguna asignación por
  inferencia.

## Validación y siguientes acciones

La reproducción local confirmó pérdida de un cambio de otra casilla dentro
de la misma semana, tanto al reconstruir en el cliente como en el servidor.
Pasaron las 122 pruebas existentes seleccionadas sobre comparación de
almacenamiento, reintentos de sincronización, copias anteriores, catálogo,
borrado de tareas y bitácora. Esas pruebas no cubrían el conflicto semanal
reproducido; que pasen no elimina ese defecto.

Orden recomendado:

1. Corregir la concurrencia de asignaciones, incluyendo guardados automáticos
   y compatibilidad con pestañas anteriores.
2. Reconciliar las dos anulaciones de bitácora con respaldo y comprobación de
   las acciones efectivas, conservando los metadatos válidos.
3. Completar la migración de reemplazos y planificar la retirada de los datos
   redundantes, dada la ocupación del documento antiguo.
4. Añadir historial suficiente por casilla para poder atribuir y recuperar
   futuros incidentes sin depender de resúmenes truncados.

Archivos de evidencia: `reports/auditoria-persistencia-live.json`, script de
solo lectura `reports/auditoria-persistencia-live.mjs` y reproducción sin red
`reports/auditoria-persistencia-repro.mjs`.
