# ProTurnos - Project Context

Ultima actualizacion: 2026-05-06.

Este archivo existe para que una futura sesion de Codex pueda retomar el proyecto sin depender del historial del chat. Antes de cambiar codigo, leer este archivo y luego confirmar el estado real con `git status`, `rg` y lectura de los modulos relevantes.

## Resumen

ProTurnos es una aplicacion web estatica para gestion de turnos, permisos, ausencias, reemplazos, horas extras, dotacion, marcaciones, solicitudes de trabajadores y bitacora LOG.

La app se abre desde `index.html` y carga `js/main.js` como modulo ES:

```html
<script type="module" src="js/main.js"></script>
```

No hay `package.json` en la raiz. Para probar localmente, usar servidor estatico, no `file://`, porque los modulos ES y algunos `fetch` funcionan mejor con HTTP:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

URL local usual:

```text
http://127.0.0.1:8000/
```

## Estado Actual Importante

- Hay cambios no commiteados hechos en esta sesion en:
  - `index.html`
  - `styles.css`
  - `js/dom.js`
  - `js/main.js`
  - `js/storage.js`
- Esos cambios implementan el ajuste del menu Perfil:
  - Acciones quedan en una columna lateral sticky.
  - Vacaciones Disponibles se muestra como franja horizontal sobre Datos Contractuales.
  - Profesion ahora depende de Estamento.
  - Profesional y Tecnico usan `select` cerrado.
  - Administrativo y Auxiliar usan input libre con sugerencias.
  - El catalogo y normalizacion de profesiones se centralizaron en `js/storage.js`.
- Tambien hay cambios del documento `Menu Turnos.docx`:
  - El bloque de botones/permisos de Turnos se ajusto para dejar mas ancho al panel RRHH.
  - El panel RRHH ahora se estira en altura con el calendario hasta el timeline.
  - Ajuste posterior: calendario y panel RRHH no deben superar la altura del listado de botones/permisos (`leavePanel`).
  - Los botones de mes del calendario usan una grilla fija para no moverse segun el largo del mes.
  - El timeline reemplaza el label `Funcionarios` por un filtro multiple por profesion o estamento.
  - El timeline marca todos los dias inhabiles con rojo suave.
  - El timeline ordena trabajadores usando rotativa base, con el perfil actual primero.
- Cambios del documento `HHEE.docx`:
  - La vista HH.EE ahora usa `#hoursView` con `Listado Colaboradores` al costado izquierdo.
  - El resumen mensual de horas extras queda a la izquierda y el grafico de barras del perfil actual a la derecha.
  - El grafico muestra los ultimos 12 meses del perfil, separando horas diurnas y nocturnas por color.
  - Los registros/respaldo de HH.EE del mes quedaron debajo del resumen y del grafico.
  - Se quito el label visible `Graficos HH.EE`; se mantiene un input `#hheeChartMonth` oculto para sincronizar el mes con los botones HH.EE.
- Ajuste RRHH por permisos/ausencias:
  - `js/staffing.js` descuenta de la cobertura los dias o segmentos donde un trabajador tiene P. Administrativo, F. Legal, F. Compensatorio, LM, LM Profesional, Permiso sin goce, Ausencia injustificada o 1/2 ADM.
  - Para 1/2 ADM se calcula por segmento de jornada: manana o tarde.
  - La alerta de faltante desaparece si otro trabajador compatible cubre el mismo segmento/jornada, ya sea por reemplazo registrado o por turno asignado manualmente.
  - `js/calendar.js` refresca el analisis RRHH despues de asignar/deshacer cambios de calendario o reemplazos.
- Ajuste RRHH por rotativa:
  - El conteo de dotacion base ahora separa por modalidad configurada (`diurno`, `4turno`, `3turno`) ademas de estamento/profesion.
  - Un turno `Larga` de 4°/3er turno ya no suma como cobertura ni exceso para la dotacion de rotativa `Diurno`.
  - Los reemplazos asignados siguen contando para la modalidad del trabajador ausente que cubren, incluso si el trabajador que reemplaza tiene rotativa `reemplazo`.
- Menu RRHH:
  - La vista RRHH ahora usa `#staffingView` con `Listado Colaboradores` al costado izquierdo.
  - Se agrego el recuadro `Postulantes` al inicio de `#staffingPanel`.
  - La vista RRHH no muestra el listado diario de alertas de dotacion (`#staffingResult`); ese recuadro queda solo en Turnos mediante `#staffingReportInline`.
  - El grafico `Licencias ultimos 2 anos` ya no esta en RRHH; el contenedor `#staffingMedicalChart` vive al final del menu Perfil.
  - Los postulantes se guardan en `localStorage` bajo `staffing_applicants`.
  - Cada registro guarda nombre, telefono, fecha de recepcion, estamento, profesion, institucion, anio de egreso, experiencia, impresiones de entrevista y documentos adjuntos en base64.
  - El listado de postulantes permite filtrar por estamento y profesion, visualizar documentos y eliminar registros.
- Menu Marcajes:
  - `js/clockMarks.js` ya no considera como incidencia grave los segmentos con falta de entrada/salida cuando `rrhhPayApproved` esta activo; tampoco mantiene alerta simple cuando `rrhhPayApproved` o `discountWaived` estan activos.
  - El simbolo `!!!` del calendario usa la clase `clock-severe-day`, con badge rojo.
  - Cada registro en el panel Marcajes permite ingresar `Comentarios` y adjuntar documentos; los documentos se guardan dentro del segmento de marcaje como `documents`.
  - El registro de Marcajes tiene una barra de mes propia (`clockMarksPrevMonth`, `clockMarksNextMonth`, `clockMarksMonthLabel`) similar a Cambios de Turno, para avanzar o retroceder el mes sin depender de la navegacion visible del calendario principal.
- Calendario de cambios de turno:
  - Los minicalendarios para escoger fecha de cambio y devolucion en `js/swapUI.js` usan una grilla fija de 42 celdas con espacios invisibles (`mini-spacer`), para que todos los meses mantengan la misma altura y los botones anterior/siguiente no cambien de posicion al navegar.
- Verificacion ejecutada tras esos cambios:

```powershell
node --check js\storage.js
node --check js\dom.js
node --check js\main.js
node --check js\hoursCharts.js
node --check js\staffing.js
node --check js\calendar.js
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/
```

## Mapa De Archivos

- `index.html`: estructura principal de la UI, paneles y navegacion.
- `styles.css`: estilos globales, layouts responsive, paneles y estados visuales.
- `js/main.js`: orquestador principal. Inicializa UI, perfil activo, formularios, botones, vistas, tema, acciones de calendario y refrescos.
- `js/dom.js`: referencias centralizadas a elementos DOM usados por `main.js` y otros modulos.
- `js/persistence.js`: wrapper de `localStorage` con `getJSON`, `setJSON`, `getRaw`, `setRaw`, `removeKey`, `listKeys`, `moveKey`.
- `js/storage.js`: capa principal de datos de dominio. Normaliza perfiles, profesiones, rotativas, reemplazos, solicitudes, balances, historiales y cambios de nombre.
- `js/calendar.js`: renderiza calendario mensual, seleccion de dias, dialogos de reemplazo y respaldo de horas extras.
- `js/turnEngine.js`: calcula turno base y turno real considerando rotativas, cambios, reemplazos y bloqueos.
- `js/rulesEngine.js`: reglas de ausencias, bloqueos, reemplazos requeridos y composicion de turnos.
- `js/leaveEngine.js`: aplica permisos administrativos, medios administrativos, feriado legal, compensatorio, licencias y ausencias.
- `js/replacements.js`: reemplazos, prestamos entre unidades, solicitudes de reemplazo, HHEE asociadas y log mensual de reemplazos.
- `js/auditLog.js`: bitacora LOG, categorias, render, anulacion desde LOG y anulacion de reemplazos/HHEE asociados.
- `js/history.js`: undo/redo simple por snapshot de `localStorage`.
- `js/swaps.js` y `js/swapUI.js`: cambios/intercambios de turno.
- `js/staffing.js`: dotacion requerida, analisis de faltantes/excesos y contratos de reemplazo.
- `js/clockMarks.js`: marcaciones, segmentos esperados, atrasos, extras e incidencias.
- `js/workerRequests.js`: solicitudes de trabajadores, aceptacion/rechazo y aplicacion de solicitudes.
- `js/hoursEngine.js`, `js/hoursCharts.js`, `js/hoursReport.js`: calculos, graficos y reportes de horas.
- `js/systemSettings.js`: modal de ajustes, valores hora por grado, feriados manuales, solicitudes de reemplazo y dotacion.
- `js/holidays.js`: feriados de Chile por API Nager.Date y feriados manuales.
- `js/firebase*.js`, `js/workspaces.js`: autenticacion/shell Firebase, workspaces, copia manual de respaldo y sincronizacion del estado completo.
- `js/firebaseAppState.js`: sincronizacion automatica por workspace del snapshot completo de `localStorage`, con manifiesto y chunks en Firestore.
- `js/firebaseWorkspaceState.js`: lectura/escritura puntual del estado vivo de workspaces enlazados para prestamos entre unidades.
- `js/firebaseLinkedUnits.js`: solicitudes de enlace entre unidades, aceptacion/rechazo y permisos tecnicos `linkedOperators`.
- `firebase.rules` y `storage.rules`: reglas de Firestore y Storage para workspaces y miembros.

## Vistas Principales

La navegacion vive en `index.html` con botones `nav-tile`.

- `calendarPanel`: calendario de turnos del perfil activo.
- `workerRequestsPanel`: solicitudes de trabajadores.
- `clockMarksPanel`: marcaciones.
- `turnChangesView`: cambios de turno.
- `staffingPanel`: dotacion.
- `hoursPanel`: horas y graficos.
- `auditLogPanel`: LOG / bitacora.
- `profileSection`: menu Perfil.
- `reportsPanel`: reportes.

`document.body.dataset.activeView` controla visibilidad y estados de layout.

## Modelo De Datos En localStorage

Claves principales:

- `profiles`: array de perfiles.
- `data_<perfil>`: programacion real/editada del perfil por dia.
- `baseData_<perfil>`: base de rotativa del perfil.
- `blocked_<perfil>`: dias bloqueados por ausencia/permisos.
- `admin_<perfil>`: permisos administrativos.
- `legal_<perfil>`: feriado legal.
- `comp_<perfil>`: compensatorio.
- `absences_<perfil>`: licencias, permisos sin goce, ausencias injustificadas y LM profesional.
- `rotativa_<perfil>`: tipo de rotativa, inicio y primer turno.
- `shift_<perfil>`: asignacion de turno activa/inactiva.
- `carry_<perfil>_<year>_<month>`: arrastre mensual.
- `leaveBalances_<perfil>`: saldos manuales de permisos/vacaciones por anio.
- `replacements`: reemplazos, prestamos y respaldos de HHEE.
- `replacementRequests`: solicitudes de reemplazo.
- `replacementRequestConfig`: configuracion de solicitudes de reemplazo.
- `turnChangeConfig`: reglas globales de cambios de turno y turnos 24.
- `workerRequests`: solicitudes desde trabajadores.
- `auditLog`: bitacora de modificaciones.
- `gradeHistory_<perfil>`: historial de grado/estamento/contrato.
- `contractHistory_<perfil>`: historial contractual.
- `replacementContracts_<perfil>`: contratos de perfiles tipo reemplazo.
- `clockMarks_<perfil>`: marcaciones.
- `swaps`: cambios/intercambios de turno.
- `gradeHourConfig`: valores hora por grado.
- `staffing_config`: dotacion requerida.
- `manualHolidays`: feriados manuales.
- `proturnos_theme`: tema visual.
- `firebaseActiveWorkspace`: workspace Firebase activo.

## Perfiles Y Profesiones

El formulario de Perfil usa un draft interno en `js/main.js` (`profileDraft`) y guarda mediante `guardarPerfil()`.

Layout actual del menu Perfil:

- `index.html` deja acciones (`CREAR NUEVO`, `EDITAR`, `Perfil activo`) dentro de `.profile-side-column`, sin la tarjeta de Vacaciones.
- `.profile-side-column` queda sticky para que el recuadro de acciones siga visible al hacer scroll dentro del Perfil.
- `Vacaciones Disponibles` usa `.profile-availability-card` en la columna principal, como franja horizontal sobre `Datos Contractuales`.
- El grafico de licencias `#staffingMedicalChart` se muestra al final del Perfil, despues de `Registros RRHH`.
- El resumen de `Vacaciones Disponibles` no debe mostrar el texto `Licencias medicas cargadas`.
- En tema claro, los textbox (`input`, `select`, `textarea`, incluidos disabled/readonly) usan fondo blanco para contrastar con formularios y paneles grises.

Migracion Firebase:

- La seleccion de un workspace Firebase ahora inicia sincronizacion automatica del estado completo de la app, no solo perfiles o solicitudes.
- `js/firebaseAppState.js` guarda un manifiesto en `workspaces/{workspaceId}/system/appState` y el contenido en chunks bajo `workspaces/{workspaceId}/appStateChunks`.
- `localStorage` sigue siendo la cache local de trabajo; Firebase replica esa cache entre usuarios del mismo workspace.

Reglas actuales:

- Estamentos validos:
  - `Profesional`
  - `Tecnico` / `Tecnico` con tilde normalizado internamente como tecnico con tilde
  - `Administrativo`
  - `Auxiliar`
- En `js/storage.js` estan:
  - `PROFESSIONAL_PROFESSIONS`
  - `TECHNICAL_PROFESSIONS`
  - `ADMINISTRATIVE_PROFESSIONS`
  - `normalizeProfession(value, estamento)`
  - `getProfessionOptionsForEstamento(estamento)`
  - `estamentoAllowsCustomProfession(estamento)`
- Profesional y Tecnico no deben persistir profesiones fuera de catalogo.
- Administrativo y Auxiliar pueden guardar texto libre.
- `Sin informacion` es el valor interno de respaldo.

Nota tecnica: `js/constants.js` tiene mojibake en `ESTAMENTO` para Tecnico. Evitar propagar ese texto; preferir normalizadores de `js/storage.js`.

## Turnos

Constantes en `js/constants.js`:

- `0`: libre
- `1`: larga
- `2`: noche
- `3`: 24
- `4`: diurno
- `5`: diurno+noche
- `6`: media manana
- `7`: media tarde
- `8`: 18 horas

El turno real se calcula combinando base, cambios, reemplazos, ausencias y marcaciones. Revisar `js/turnEngine.js`, `js/rulesEngine.js`, `js/replacements.js` y `js/calendar.js` antes de tocar este flujo.

## Cambios De Turno

`turnChangesView` muestra el panel de cambios y un `Listado Colaboradores` lateral para cambiar de perfil activo dentro de ese menu.

Configuracion en Ajustes del sistema > Cambio de Turno:

- `Permitir cambios de turno`: si esta desactivado, el menu Cambios de Turno queda deshabilitado y no se listan colegas para intercambio.
- `Permitir Cambios de Turno entre diferentes tipos de turno`: si esta desactivado, solo se permite Larga por Larga y Noche por Noche.
- `Permitir turnos de 24 horas`: si esta desactivado, el calendario manual no genera turnos 24 y los minicalendarios de cambios bloquean fechas que dejarian a un trabajador con 24.
- `Permitir turnos de 24 horas invertidos`: si esta desactivado, se bloquea Noche seguida de Larga al dia siguiente y Noche el dia anterior a una Larga, tambien en cambios de turno.

Reglas actuales:

- Profesional y Tecnico solo pueden intercambiar con trabajadores de la misma profesion.
- Administrativo y Auxiliar pueden intercambiar por estamento, sin importar la profesion escrita.
- `canSwapProfiles()` tambien bloquea trabajadores con la misma rotativa base. `swapUI.js` usa esa regla para poblar el combo `Recibe turno`, por lo que un colega con igual secuencia base no debe aparecer como opcion.
- En cada fecha del cambio se valida la pareja completa:
  - quien entrega debe tener turno Larga o Noche.
  - quien recibe debe estar libre o tener un turno complementario que forme 24 con el turno recibido (`Larga + Noche` o `Noche + Larga`).
  - ninguno de los dos puede tener permiso administrativo, feriado legal, compensatorio, licencia, permiso sin goce o ausencia.
  - ninguno de los dos puede tener otro cambio activo en esa fecha.
- Los perfiles con rotativa `reemplazo` pueden intercambiar turnos Larga o Noche que esten asignados manualmente, aunque no tengan rotativa base.
- Los minicalendarios de seleccion de fechas siempre renderizan 6 semanas completas; `styles.css` fija las filas de `.mini-grid` y los espacios vacios usan `.mini-spacer`.
- Si una ausencia, permiso o feriado se aplica sobre un cambio activo, `leaveEngine.js` pide confirmacion. Si se acepta, `swaps.js` anula el cambio y restaura los dias a base antes de aplicar la ausencia; si se cancela, la ausencia no se aplica.
- Al modificar manualmente un dia con cambio de turno, el dialogo permite deshacer el cambio. Deshacer ahora marca el cambio como anulado y `getCambioTurnoRecibido()` ignora correctamente los cambios anulados.

## RRHH / Dotacion

`js/staffing.js` calcula el recuadro RRHH y el reporte inline de dotacion:

- Las exigencias de modalidad `diurno` se evalúan solo en dias habiles. En fines de semana o feriados no debe aparecer alerta por falta de personal diurno.
- Profesional y Tecnico agrupan dotacion por profesion normalizada; Administrativo y Auxiliar agrupan por estamento.
- Al editar un perfil y cambiar profesion/estamento/rotativa, `guardarPerfil()` llama `syncStaffingConfigForProfileChange()` para mover la exigencia configurada desde el grupo anterior al nuevo cuando corresponde. Si ya no quedan trabajadores activos en la profesion anterior, se elimina esa exigencia antigua.
- Los chips de alerta RRHH (`.staffing-pill`) deben mantener alto contraste: texto oscuro, fondos claros y letra suficientemente grande, especialmente en `.staffing-report-panel`.

## Ausencias Y Permisos

`js/leaveEngine.js` aplica:

- Permiso administrativo completo.
- Medio administrativo manana/tarde.
- Feriado legal.
- Compensatorio.
- Licencia medica.
- LM profesional.
- Permiso sin goce.
- Ausencia injustificada.

Al aplicar una ausencia normalmente se bloquea el dia y se registra LOG con `AUDIT_CATEGORY.LEAVE_ABSENCE`.

Las fechas internas de calendario usan clave tipo:

```text
YYYY-M-D
```

Ejemplo: `2026-4-5` para 5 de mayo de 2026. Muchas funciones convierten a ISO `YYYY-MM-DD` cuando guardan reemplazos o reportes.

## Reemplazos Y HHEE

`js/replacements.js` guarda reemplazos en la clave `replacements`.

Campos tipicos de un reemplazo:

- `id`
- `worker`: quien cubre.
- `replaced`: perfil cubierto.
- `date`: ISO `YYYY-MM-DD`.
- `turno`: codigo de turno.
- `source`: `replacement`, `manual_extra`, `clock_extra`, etc.
- `absenceType`
- `requestId`, `requestGroupId`
- `isLoan`
- `canceled`, `canceledAt`, `canceledBy`, `cancelReason`

Cuando se asigna reemplazo, se registra LOG en categoria `AUDIT_CATEGORY.OVERTIME` con accion `Asigno reemplazo de turno` y `meta.replacementId`.

Unidades enlazadas:

- En `Cuenta y entornos`, un workspace puede solicitar enlace a otro por ID. El otro workspace debe aceptar la solicitud.
- Las solicitudes de enlace entrantes tambien aparecen en el menu `Solicitudes`, junto a las solicitudes de trabajadores, y suman al badge rojo del icono cuando estan pendientes.
- `js/workerRequests.js` inicia una escucha Firestore en tiempo real sobre `workspaceLinks` entrantes del entorno activo para que el badge de `Solicitudes` se actualice sin tener que abrir el menu.
- En `Cuenta y entornos`, los enlaces activos se pueden clickear para confirmar el desenlace. El `workspaceLink` queda con estado `unlinked` y deja de aparecer como activo.
- Aceptar no agrega el entorno ajeno al selector de trabajo ni permite navegar sus perfiles. Crea permisos tecnicos `workspaces/{workspaceId}/linkedOperators/{uid}` para consultar/aplicar prestamos contra el snapshot vivo de la unidad enlazada.
- En el dialogo de reemplazo, `Buscar sugerencias en unidades enlazadas` carga enlaces aceptados del entorno activo en ambos sentidos.
- El sistema usa `js/firebaseWorkspaceState.js` para leer `workspaces/{workspaceId}/system/appState` y sus chunks sin reemplazar el estado local.
- Solo lista candidatos activos compatibles por profesion/estamento, sin ausencias ese dia, con disponibilidad para cubrir el turno requerido y con regla de turno 24 permitida en ambas unidades cuando corresponda.
- Las sugerencias muestran HHEE diurnas/nocturnas del mes calculadas desde la unidad origen del trabajador.
- Al asignar un prestamo, escribe un reemplazo `linked_unit_loan` en el snapshot vivo de la unidad origen del trabajador para marcar `Prestamo`, generar la `P` en timeline y sumar HHEE alla; luego registra el prestamo en la unidad actual con `isLoan`, `workerWorkspaceId`, `hostWorkspaceId` y `remoteReplacementId`.
- Este flujo requiere publicar `firebase.rules`, porque usa `workspaceLinks` y `linkedOperators`. Las reglas validan que el permiso tecnico solo sirve si el enlace asociado sigue en estado `accepted`.

## LOG / Anulaciones

`js/auditLog.js` guarda hasta 1500 entradas en `auditLog`.

Categorias:

- `turn_changes`
- `overtime`
- `leave_absence`
- `calendar`
- `collaborator_created`
- `collaborator_updated`
- `profile_status`
- `staffing`
- `system_settings`
- `worker_requests`

El LOG puede anular:

- Ausencias/permisos (`LEAVE_ABSENCE`) mediante `undoLeaveAbsenceLog()`.
- Reemplazos/HHEE (`OVERTIME`) mediante `cancelReplacementFromLog()`.

Estado actual de comportamiento:

- Los registros nuevos guardan `actor` / `actorName` con el usuario Firebase logueado (`displayName`, `email`, `uid`).
- En el render del LOG no se muestra el label `Perfil: ...`; se muestra `Usuario: ...`.
- Las fechas ISO dentro del detalle del registro se formatean visualmente como `DD-MM-AAAA`, aunque el dato original siga guardado como ISO.
- Si se anula una ausencia o permiso desde LOG, `cancelReplacementsForAbsence()` marca los reemplazos asociados como `canceled`.
- Tambien notifica al trabajador afectado.
- El log original de ausencia queda marcado como anulado.

Pendiente conocido desde el chat:

- Al anular un permiso administrativo desde LOG, ya se elimina/anula el permiso y el reemplazo asignado.
- Falta marcar tambien como anulado el registro LOG original de `Asigno reemplazo de turno` asociado a ese `replacementId`.
- Lugar probable: `js/auditLog.js`, dentro de `cancelReplacementsForAbsence()` o inmediatamente despues de cancelar reemplazos. Hay que buscar logs `AUDIT_CATEGORY.OVERTIME` con `meta.replacementId` igual al reemplazo cancelado y actualizar esos logs con `canceledAt`, `canceledBy` y `cancellationDetails`.

## Firebase

`js/firebaseConfig.js` tiene `FIREBASE_ENABLED = true` y configuracion del proyecto `calendarioturnos-7c4d9`.

Arquitectura:

- Modo local sigue usando `localStorage` como cache sincronica de la app.
- Al iniciar sesion y seleccionar un workspace, `js/main.js` llama `startFirebaseAppStateSync()` desde `js/firebaseAppState.js`.
- Firebase sincroniza automaticamente el estado completo de la app por workspace:
  - Manifiesto: `workspaces/{workspaceId}/system/appState`.
  - Chunks: `workspaces/{workspaceId}/appStateChunks/part_0000`, `part_0001`, etc.
- El snapshot excluye claves internas, de tema, workspace activo, id local del cliente y claves tecnicas de Firebase Auth (`firebase:` / `firebase-`).
- `js/persistence.js` emite `proturnos:persistenceChanged` cuando cambian datos locales; `firebaseAppState.js` escucha ese evento y sube cambios con debounce.
- Cuando llega un estado remoto, `replaceLocalSnapshot()` reemplaza la cache local en silencio y `main.js` refresca perfiles, calendario, cambios de turno, solicitudes, RRHH y dashboard.
- Los modulos granulares `firebaseProfiles.js`, `firebaseReplacementRequests.js` y `firebaseWorkerRequests.js` siguen en el repo, pero `main.js` ya no los inicia; la sincronizacion completa los reemplaza como camino principal.
- `js/firebaseMigration.js` sigue disponible como copia manual de respaldo en `workspaces/{workspaceId}/system/localStorageSnapshot`; no es el flujo automatico principal.
- `js/firebaseLinkedUnits.js` maneja `workspaceLinks`: solicitudes pendientes, aceptadas, rechazadas y desenlazadas. Al aceptar, la unidad destino otorga al solicitante un permiso tecnico `linkedOperators`.
- `js/firebaseWorkspaceState.js` permite leer/escribir puntualmente el appState de workspaces enlazados, sin cambiar el workspace activo local.
- `firebase.rules` exige usuario autenticado y miembro de workspace para leer/escribir. Para appState, tambien permite usuarios con `linkedOperators`, limitado al flujo tecnico de prestamos.
- `storage.rules` permite archivos bajo `workspaces/{workspaceId}/...` solo a miembros.
- Si Google login devuelve `auth/unauthorized-domain`, agregar el hostname usado en navegador en Firebase Console > Authentication > Settings > Authorized domains. Para desarrollo local, autorizar `127.0.0.1` y `localhost` sin puerto.
- En el modal `Cuenta y entornos`, cada entorno muestra el ID en un input seleccionable y botones para `Copiar ID`, `Copiar invitacion` y `Enviar correo` con `mailto:` prellenado.
- Si Firebase esta configurado, `js/firebaseShell.js` exige login Google antes de permitir cambios: abre automaticamente el modal de inicio de sesion y bloquea la app con `body.auth-gate-active` hasta que haya usuario autenticado.
- Para unirse a un entorno, `js/workspaces.js` crea primero `workspaces/{workspaceId}/members/{uid}` y luego lee el workspace; `firebase.rules` permite esa creacion solo si el workspace existe. Despues de cambiar reglas, hay que publicarlas en Firebase Console o con Firebase CLI.

Verificacion ejecutada tras este avance:

```powershell
node --check js\persistence.js
node --check js\firebaseAppState.js
node --check js\firebaseShell.js
node --check js\firebaseMigration.js
node --check js\main.js
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/
```

Antes de cambiar Firebase, revisar:

- `js/firebaseClient.js`
- `js/firebaseShell.js`
- `js/firebaseAppState.js`
- `js/firebaseProfiles.js`
- `js/firebaseReplacementRequests.js`
- `js/firebaseWorkerRequests.js`
- `js/firebaseMigration.js`
- `js/workspaces.js`

## Patrones De Implementacion

- Preferir helpers de `storage.js` para leer/escribir dominio.
- No manipular `localStorage` directamente fuera de `persistence.js`, salvo que el patron existente lo haga y sea necesario.
- Antes de cambios grandes, ejecutar `git status --short` y revisar cambios no propios.
- No revertir cambios del usuario.
- Para editar archivos, usar parches pequenos y enfocados.
- Para render UI, seguir patrones existentes: HTML strings con `escapeHTML`, clases CSS existentes y `render...()` + `refreshAll()`.
- Para acciones que modifican calendario, llamar `pushHistory()` antes si existe patron de undo.
- Para acciones auditables, usar `addAuditLog(category, action, details, meta)`.

## Comandos Utiles

Listar archivos:

```powershell
rg --files
```

Buscar referencias:

```powershell
rg -n "texto|patron" index.html js styles.css
```

Chequeo sintactico de modulos:

```powershell
node --check js\main.js
node --check js\storage.js
node --check js\auditLog.js
```

Servidor local:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Estado git:

```powershell
git status --short
git diff --stat
```

## Riesgos Y Cuidado

- El proyecto no tiene suite automatizada ni bundler.
- Hay bastante estado global en `window` usado por `calendar.js` y `main.js`.
- Varias claves de fecha usan formato `YYYY-M-D`, no ISO. Revisar conversiones antes de comparar con `replacement.date`.
- El texto interno aun mezcla valores sin tilde, con tilde y algunos mojibake heredados.
- Reemplazos, ausencias, LOG y notificaciones estan acoplados. Cambiar anulaciones requiere revisar efectos en:
  - `auditLog.js`
  - `replacements.js`
  - `workerRequests.js`
  - `calendar.js`
  - `timeline.js`
  - `hoursReport.js`

## Proximos Pendientes Recomendados

1. Implementar pendiente de LOG: marcar anulado el registro `Asigno reemplazo de turno` cuando se anula desde LOG el permiso/ausencia que originaba ese reemplazo.
2. Revisar manualmente la UI de Perfil tras los cambios de profesiones y layout.
3. Considerar limpiar mojibake de `js/constants.js` con mucho cuidado, verificando que no rompa claves historicas.
4. Crear una rutina manual de QA minima documentada para calendario, permisos, reemplazos, LOG, perfil y solicitudes.
