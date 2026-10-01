# Auditoria de almacenamiento Firestore

Este cambio prepara una migracion compatible. No cambia aun la fuente oficial
de lectura y no elimina datos automaticamente.

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

- El formato antiguo sigue siendo la fuente oficial.
- La bitacora fragmentada solo escribe si la unidad tiene
  `auditLogStorage: "shards-shadow-v1"`.
- Los reemplazos nuevos guardan `date` y `month` sin cambiar la lectura actual.
- Los scripts que pueden escribir son dry-run por defecto, exigen identificar
  exactamente la unidad y crean un respaldo antes de modificar datos.
- Las escrituras de mantenimiento usan una precondicion `updateTime`; si el
  documento cambio desde la lectura, Firestore rechaza la operacion.
- Quitar `value` exige comprobar primero que `items` reconstruye exactamente el
  mismo estado logico.
- Compactar tombstones requiere ademas `--compatibility-window-closed`.

## Orden de activacion propuesto

1. Revisar este commit y desplegar primero reglas y aplicacion.
2. Activar `shards-shadow-v1` solo en una unidad de prueba.
3. Ejecutar el backfill de bitacora en dry-run y luego con `--apply`.
4. Comparar formato antiguo y fragmentado durante una ventana acordada.
5. Incorporar la lectura fragmentada en otro cambio; no esta incluida aqui.
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
- Confirmar que no existe aun ningun cambio de lectura ni borrado automatico.
