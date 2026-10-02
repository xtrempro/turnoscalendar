# Auditoria de almacenamiento Firestore

Esta migracion mantiene compatibilidad por unidad y no elimina datos
automaticamente. La fuente de lectura del menu LOG cambia solo al activar la
marca explicita `shards-read-v1`.

## Estado medido el 2026-10-01

- La auditoria de solo lectura encontro 3.356 documentos `entries`.
- `workspaces/Boh7mvO5ku9quFFsPcIq/stateModules/log/entries/auditLog`
  se estimo en 931 KiB (90,9 % del limite de Firestore), con 441 tombstones.
- Hay 393 documentos que aun conservan simultaneamente `value` e `items`.
- En 25 documentos, `items` no cubre todo el estado logico de `value`; esos
  documentos no se pueden limpiar automaticamente.
- Los 668 reemplazos de Imagenologia coinciden entre el formato antiguo y los
  documentos individuales. Ninguno tiene aun `date` y `month` en el nivel
  superior.

## Garantias de esta fase

- El formato antiguo sigue siendo la fuente oficial salvo en el menu LOG de
  una unidad marcada `shards-read-v1`.
- La bitacora fragmentada solo escribe si la unidad tiene
  `auditLogStorage: "shards-shadow-v1"` o `"shards-read-v1"`.
- Los reemplazos nuevos guardan `date` y `month` sin cambiar la lectura actual.
- Los scripts que pueden escribir son dry-run por defecto, exigen identificar
  exactamente la unidad y crean un respaldo antes de modificar datos.
- Las escrituras de mantenimiento usan una precondicion `updateTime`; si el
  documento cambio desde la lectura, Firestore rechaza la operacion.
- Quitar `value` exige comprobar primero que `items` reconstruye exactamente el
  mismo estado logico.
- Compactar tombstones requiere ademas `--compatibility-window-closed`.

## Lectura fragmentada

- `shards-shadow-v1` conserva la lectura antigua y duplica las escrituras.
- `shards-read-v1` mantiene esa doble escritura, pero el menu LOG lee los
  fragmentos del mes seleccionado.
- Configurar el lector al entrar a una unidad no ejecuta consultas. La primera
  consulta ocurre al abrir LOG y observa solo el mes elegido.
- La ubicacion puntual se deduce del milisegundo inicial del `logId`. Los IDs
  deterministas que no contienen fecha requieren tambien `createdAt`; nunca se
  recorren meses para encontrarlos. Los permisos usan esa referencia desde su
  memorandum o reemplazo y, para datos historicos sin `logId`, consultan solo
  el mes en que se creo el memorandum.
- Los fragmentos y el backfill mantienen dias UTC. El menu agrupa y filtra por
  `America/Santiago`: consulta tambien el primer dia UTC del mes siguiente para
  que una accion nocturna del ultimo dia siga apareciendo en el mes chileno.
- Salir de LOG, cambiar de unidad o cerrar sesion cancela el listener mensual.
- El formato antiguo sigue activo durante la ventana de compatibilidad para
  permisos, reemplazos, conflictos y clientes que aun no recibieron la version
  nueva.

## Prueba en test del 2026-10-01

- Urgencia Adulto quedo exacta: 700 registros fragmentados, sin faltantes,
  diferencias ni duplicados.
- Los 150 documentos conservaron 61 registros que la poda ya habia retirado
  del formato antiguo.
- Dos pares de escrituras simultaneas cayeron en el mismo fragmento y ambos
  registros persistieron.
- Se comprobaron altas, modificaciones, poda y concurrencia antes de preparar
  `shards-read-v1`.

## Orden de activacion propuesto

1. Revisar este commit y desplegar primero reglas y aplicacion.
2. Activar `shards-shadow-v1` solo en una unidad de prueba.
3. Ejecutar el backfill de bitacora en dry-run y luego con `--apply`.
4. Comparar formato antiguo y fragmentado durante una ventana acordada.
5. Activar `shards-read-v1` primero en la unidad de prueba y comprobar meses,
   deshacer y escrituras desde dos sesiones.
6. Retirar `value` documento por documento solo cuando la verificacion sea
   segura.
7. Compactar tombstones unicamente despues de cerrar la ventana de
   compatibilidad con clientes antiguos.

## Comandos de auditoria

```powershell
npm.cmd run audit:state-health
npm.cmd run audit:replacement-records -- --workspace <id> --expected-name <nombre>
npm.cmd run audit:audit-log-shards -- --workspace <id> --expected-name <nombre>
```

Ninguno de esos comandos escribe sin `--apply`. La limpieza de campos antiguos
usa `npm.cmd run cleanup:entry-legacy` y tambien es dry-run por defecto.

## Puntos para revision independiente

- Validar la estimacion de tamano y los umbrales 70 % / 85 %.
- Revisar permisos y validaciones de `auditLogShards` en `firebase.rules`.
- Confirmar que el dual-write solo agrega o actualiza eventos y no replica la
  poda antigua como eliminacion del archivo.
- Revisar la reconstruccion logica antes de retirar `value`.
- Revisar la precondicion de concurrencia y el respaldo de cada script con
  `--apply`.
- Confirmar que `shards-read-v1` no consulta al arrancar, limita la lectura al
  mes UTC elegido y no ejecuta ningun borrado automatico.
