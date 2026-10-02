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
- **Outbox.** Antes de llamar al proveedor, el lote queda guardado en `storageHealthControl/state.outbox`: sus ids y el **cuerpo HTTP completo** ya serializado (`from`, `to`, `subject`, `text`). Si el resultado es ambiguo (`failed`: error del proveedor, red caída, respuesta perdida o la función se cae a mitad de camino), los reintentos mandan **ese mismo lote** con la misma `Idempotency-Key` y exactamente el mismo cuerpo, aunque entretanto cambien `STORAGE_ALERT_EMAIL` o `MAIL_FROM`. La configuración nueva se aplica desde el lote siguiente. Resend rechaza una clave reutilizada con otro cuerpo y recuerda la clave durante 24 horas. Los eventos nuevos esperan al lote siguiente. Si nunca se llegó al proveedor (`skipped_*`), el lote se suelta.
- Cada correo lleva hasta 50 eventos. Los que no caben salen en el correo siguiente.
- El historial pagina los eventos por id de documento (`eventsCursor` = id del último recibido). El id es único, así que no salta ni repite eventos aunque muchos tengan el mismo milisegundo. Firestore solo recorre `__name__` en orden **ascendente**, por eso el id empieza con la fecha invertida (`99999999 − AAAAMMDD`, luego la fecha y un hash): el orden ascendente queda "más reciente primero". No necesita índice compuesto: la igualdad por `workspaceId` más el orden por `__name__` se resuelve con los índices de un solo campo (verificado en el emulador).

## Costo

Cada revisión lee todos los documentos de estado y todos los fragmentos de la bitácora. Los fragmentos aumentan con el tiempo: hay uno por día con actividad. Cada informe registra `documentsRead`, `shardDocuments` y `durationMs`, por unidad y en total.

Referencia del 2026-10-02 en prod: 12 unidades, 4.735 documentos leídos, 87 fragmentos y unos 28 s.
