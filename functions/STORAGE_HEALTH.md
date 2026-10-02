# Vigilancia del almacenamiento

Es una revisión técnica. Supervisores y dueños de unidad no ven nada en la app. Los resultados se revisan en **TurnoPlus-Admin → Salud del sistema** y, si está configurado, llegan por correo a una dirección técnica global.

## Qué corre

| Función | Tipo | Región |
| --- | --- | --- |
| `checkStorageHealth` | programada, todos los días a las 05:30 (America/Santiago). Si el candado está tomado, espera hasta 4 min; si sigue tomado, falla y Cloud Scheduler la reintenta (3 veces, cada ≥ 5 min) | us-central1 |
| `getStorageHealthOverview` | callable, solo admin global | southamerica-west1 |
| `getStorageHealthHistory` | callable, solo admin global; paginada (máx. 30 días y 50 eventos por llamada) | southamerica-west1 |
| `runStorageHealthCheckNow` | callable, solo admin global. Modo `full` (máx. 1 cada 10 min) o `deliveries` (máx. 1 cada 2 min); tiene un candado | southamerica-west1 |
| `sendStorageHealthTestAlert` | callable, solo admin global. Envía un correo de prueba **solo** a `STORAGE_ALERT_EMAIL` (máx. 1 cada 5 min) | southamerica-west1 |

La autorización es la misma que en `getAccountsAndUnits` (`lib/adminAuthorization.js`): token con correo verificado y, además, uno de estos tres: claim `admin`/`globalAdmin`, documento activo en `adminUsers/{uid}` o correo incluido en `ADMIN_EMAILS`. Nunca se usa un correo que mande el cliente.

La revisión solo **lee** las unidades. Escribe únicamente en estas colecciones de la raíz, que ningún cliente puede leer ni escribir (las reglas las niegan):

- `storageHealthUnits/{unidad}`: estado vigente y línea base de las transiciones.
- `storageHealthEvents/{eventId}`: cada transición, con id estable y estado de entrega (`deliveryPending`, `delivery.status`, `attempts`).
- `storageHealthReports/{fecha}`: resumen del día.
- `storageHealthReports/{fecha}/units/{unidad}`: detalle del día por unidad.
- `storageHealthRuns/{runId}`: cada ejecución.
- `storageHealthControl/state`: candado, frecuencia, última entrega, el lote de correo abierto (`outbox`) y la última revisión completa (`lastFullRun`).

Las unidades que ya no existen se marcan `status: "deleted"`. Salen del panel y de los conteos, y el resumen las cruza contra `workspaces` aunque la revisión aún no las haya marcado. Sus informes y eventos se conservan.

## Variables

| Variable | Tipo | Dónde se define | Si falta |
| --- | --- | --- | --- |
| `STORAGE_ALERT_EMAIL` | parámetro | `functions/.env.<proyecto>` | Las entregas quedan `skipped_no_recipient` y se reintentan |
| `MAIL_FROM` | parámetro (compartido con las invitaciones) | `functions/.env` o `.env.<proyecto>` | Se usa el remitente de pruebas de Resend |
| `RESEND_API_KEY` | secreto | `firebase functions:secrets:set RESEND_API_KEY --project <proyecto>` | Las entregas quedan `skipped_no_api_key` y se reintentan |

`STORAGE_ALERT_EMAIL` es una dirección técnica global, **nunca** la del dueño de una unidad. Los archivos `.env*` no se versionan (`.gitignore`). Para separar test y prod:

```
functions/.env.turnoplus-test-7c4d9     STORAGE_ALERT_EMAIL=<direccion tecnica de pruebas>
functions/.env.calendarioturnos-7c4d9   STORAGE_ALERT_EMAIL=<direccion tecnica de produccion>
```

En el proyecto test, `RESEND_API_KEY` tiene un valor provisorio, así que el envío fallará (`failed`) hasta que se configure una clave real.

## Entregas

- Una transición se registra una sola vez por día. Repetir la revisión ese mismo día no la duplica.
- Un evento queda como `sent` únicamente cuando Resend responde 2xx. Con cualquier otro resultado sigue pendiente y se reintenta en la próxima revisión, o con **Reintentar entregas** desde Admin.
- **Outbox.** Antes de llamar al proveedor, el lote queda guardado en `storageHealthControl/state.outbox`: sus ids y el **cuerpo HTTP completo** ya serializado (`from`, `to`, `subject`, `text`). Si el resultado es ambiguo (`failed`: error del proveedor, red caída, respuesta perdida o la función se cae a mitad de camino), los reintentos mandan **ese mismo lote** con la misma `Idempotency-Key` y exactamente el mismo cuerpo, aunque entretanto cambien `STORAGE_ALERT_EMAIL` o `MAIL_FROM`. La configuración nueva se aplica desde el lote siguiente. Resend rechaza una clave reutilizada con otro cuerpo y recuerda la clave durante 24 horas. Los eventos nuevos esperan al lote siguiente. Un lote **nuevo** cuyo primer intento termina en `skipped_*` se suelta, porque se sabe que nunca llegó al proveedor. Un lote que **ya estaba abierto** se conserva intacto ante cualquier resultado distinto de `sent`, incluido un `skipped_*` de un reintento (por ejemplo, si faltó la clave un rato): el correo original pudo haber salido, y soltarlo cambiaría la clave y podría duplicarlo. Mientras siga abierto, los eventos nuevos esperan.
- Cada correo lleva hasta 50 eventos. Los que no caben salen en el correo siguiente.
- El historial pagina los eventos por id de documento (`eventsCursor` = id del último recibido). El id es único, así que no salta ni repite eventos aunque muchos tengan el mismo milisegundo. Firestore solo recorre `__name__` en orden **ascendente**, por eso el id empieza con la fecha invertida (`99999999 − AAAAMMDD`, luego la fecha y un hash): el orden ascendente queda "más reciente primero". No necesita índice compuesto: la igualdad por `workspaceId` más el orden por `__name__` se resuelve con los índices de un solo campo (verificado en el emulador).

## Versión de escritura de la bitácora

Cada registro **nuevo** de `auditLog` lleva `writer: { schemaVersion, buildId }` (`js/auditLogVersion.js`):

- `schemaVersion`: versión estable del formato del registro. Hoy vale `1` y solo sube cuando cambia la forma del registro.
- `buildId`: lo genera `scripts/build-id.mjs` en cada build (`AAAAMMDDTHHMMSSZ-<sha>[-dirty]`) y esbuild lo inyecta. `build-engine.mjs` hace lo mismo con el prefijo `server-` para los registros que escribe el servidor (cobertura automática). Sin empaquetar vale `dev`.

El registro es el mismo objeto en el formato viejo y en los fragmentos, porque el escritor de fragmentos copia el JSON persistido; por eso los metadatos son idénticos en ambos. Los registros históricos no se modifican.

La revisión calcula `auditLogVersions` por unidad, fuera de `audits`, así que **no** genera eventos ni correos y no cambia el estado de la unidad:

- **Adopción:** el primer registro con versión de la unidad. Todo lo anterior es histórico y no cuenta, así que no hay falsas alertas por registros previos al despliegue.
- **Recientes sin versión:** registros sin `writer` creados después de la adopción y dentro de los últimos 7 días. Indican una pestaña abierta con un build anterior. Pasados los 7 días el aviso desaparece solo.
- **Metadatos distintos entre formatos** para un mismo id.

Se ve en TurnoPlus-Admin y en Cloud Logging (`storage health: incidencias de version de bitacora`). En Admin, la tabla muestra el total de incidencias de versión y el detalle separa "sin versión" de "metadatos distintos". El resumen diario también los cuenta por separado (`unitsWithUnversionedLogs`, `unitsWithWriterMismatch`, `unitsWithAuditLogVersionIssues`). Nunca se muestra a owners ni supervisores.

## Costo

Cada revisión lee todos los documentos de estado y todos los fragmentos de la bitácora. Los fragmentos aumentan con el tiempo: hay uno por día con actividad. Cada informe registra `documentsRead`, `shardDocuments` y `durationMs`, por unidad y en total.

Referencia del 2026-10-02 en prod: 12 unidades, 4.735 documentos leídos, 87 fragmentos y unos 28 s.
