# Cierre de pendientes de la segunda auditoría

18 de noviembre de 2026, Chile. Repositorio ProTurnos, HEAD `7b07bbb`.
Cambios sin commit ni despliegue. No se modificó producción.

Auditoría recibida:
`reports/auditoria-claude-persistencia-segunda-2026-11-18.md`.
La conclusión de Claude es que la segunda implementación cierra los tres P2
anteriores y no tiene P1. Su revisión incluyó datos reales en modo de lectura,
reglas en emuladores y dos clientes Firebase reales. Esta fase no reabre esa
implementación: cierra el script omitido y corrige el procedimiento de publicación.

## P2-B: script de mantenimiento omitido

Se deshabilitó `--apply` en `scripts/reparar-deltas-por-elemento.mjs`, antes
de validar argumentos, autenticarse o llamar a Firestore. Conserva la inspección
de solo lectura y su mensaje ya no invita a aplicar la reparación antigua.

El bloqueo abarca el script completo: su conversión de `items` a `value` sin
precondición también podía sobrescribir cambios de otros módulos. Esta herramienta
de agosto no debe usarse para reparar el almacenamiento actual. Una futura
reparación necesita deltas o precondición CAS revisados, respaldo y verificación.
No se agregó una excepción que permita pasar el bloqueo mediante otra bandera.

`tests/task-rescue-read-only.test.mjs` incluye ahora los cuatro scripts. Verifica
que `--apply` termine con error antes de autenticarse. La regresión completa
de almacenamiento pasa **286 pruebas, cero fallos**.

El frontend, el protocolo v2 y las reglas auditadas no cambiaron en esta fase.
No se repitieron compilación y emuladores porque el cambio ejecutable se limita
a la entrada del script de mantenimiento, que no forma parte del cliente publicado.

## P2-A: pausa global de edición durante la transición

La pausa tiene que abarcar **toda edición de la aplicación en todas las unidades
afectadas**, incluidos calendarios, permisos, reemplazos, perfiles y tareas.
Una transacción de un cliente antiguo que incluya asignaciones puede ser rechazada
entera por las reglas nuevas; su escritura de respaldo también puede incluir
esa clave. Por tanto, no alcanza con suspender solamente la asignación de tareas.

Procedimiento de publicación corregido:

1. Antes de cambiar reglas, coordinar la pausa de toda edición con los responsables
   de las sesiones escritoras. No enviar avisos ni cerrar sesiones automáticamente.
2. Confirmar que los cambios previos estén sincronizados y, cuando corresponda,
   comprobarlos desde otra sesión actualizada con el servidor. **No recargar ni
   cerrar una pestaña con cambios pendientes:** sus colas actuales son de memoria.
   Si no se confirma el guardado, resolverlo antes de iniciar la transición.
3. Cerrar las sesiones antiguas ya sincronizadas, o mantenerlas sin actividad ni
   nuevas ediciones hasta la recarga coordinada. Deben quedar identificadas las
   sesiones que volverán a escribir; una pestaña olvidada no se considera actualizada
   por el hecho de estar inactiva.
4. Resolver el presupuesto de `security:client` o dejar aceptada su desviación
   preexistente por quien autorice la publicación. No cambiar umbrales ni saltar
   controles silenciosamente.
5. Publicar reglas y luego Hosting, manteniendo la pausa global. El predeploy de
   Hosting verifica las reglas vivas; conservar esa comprobación.
6. Abrir o recargar **cada sesión escritora** con el frontend nuevo y comprobar
   su versión. Los registros nuevos `writer.buildId` sirven como evidencia de
   las sesiones que efectivamente escribieron; la ausencia de un build antiguo
   en registros nuevos no prueba que no haya una pestaña antigua inactiva.
7. Comprobar dos sesiones actualizadas: ediciones en casillas distintas, una alta
   durante un cierre/fusión y un guardado que incluya permiso/calendario. Confirmar
   tanto los datos remotos como lo que muestra la otra sesión y la PWA.
8. Reanudar la edición general solo al confirmar la actualización de las sesiones
   y las escrituras de prueba. Después revisar y aplicar la reconciliación de
   anulaciones, con todos sus escritores actualizados, respaldo y CAS.

Este documento prepara el procedimiento; no ejecuta la pausa, no comprueba las
sesiones activas y no autoriza por sí mismo un despliegue. Ninguna de esas
operaciones se realizó durante este cierre.

## P3 registrados para fase posterior

1. **Contigüidad de fusiones:** el materializador debe coincidir con el catálogo
   del turno al decidir si un enlace une tareas contiguas. Claude encontró enlaces
   históricos a tareas borradas sin casillas y comprobó que la normalización
   actual no cambia personas de las semanas reales revisadas. El caso latente
   de una tarea existente pero no contigua sigue pendiente de prueba y ajuste.
2. **Retiro después de una fusión remota y un delta compuesto:** distinguir un
   traslado interno de un retiro posterior para que una alta antigua del delta
   no prevalezca sobre la decisión más reciente. No se cambió esa resolución
   en esta fase; requiere su reproducción específica y una corrección acotada.
3. **Semanas exclusivas de chunks:** según la comprobación informada por Claude,
   no existen en producción ni test, y las reglas nuevas impiden escribir chunks
   de tareas. Queda pendiente detectar explícitamente esa situación al hidratar
   y preservar la semana si alguna vez se importa una copia histórica así.
4. **Costo de reconstrucción:** la lectura confirmada reconstruye `value` e
   `items` de todo el documento. Quedan pendientes medición y actualización
   incremental conforme crezca el historial. No se podaron semanas.

`scripts/mirror-workspace.mjs` tampoco se modificó. Es una operación de copia
al espejo: no ejecutarla contra un destino que esté siendo editado. Una revisión
del mantenimiento del espejo queda fuera del cierre de P2-B.

## Contexto para la siguiente decisión

El código de aplicación de la segunda versión ya fue auditado. El único cambio
de código posterior a esa auditoría es el bloqueo de un cuarto script legado,
con su prueba. El plan ahora contempla el efecto de los lotes antiguos sobre
todos los módulos. Siguen pendientes el presupuesto de bundle y la coordinación
operativa de publicación; los cuatro P3 y las migraciones de almacenamiento
se conservan como trabajo posterior, sin presentarlos como resueltos.
