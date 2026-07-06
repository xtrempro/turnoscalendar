# ProTurnos - Project Context

Ultima actualizacion: 2026-05-09.

Este archivo existe para que una futura sesion de Codex pueda retomar el proyecto sin depender del historial del chat. Antes de cambiar codigo, leer este archivo y luego confirmar el estado real con `git status`, `rg` y lectura de los modulos relevantes.

## Resumen

ProTurnos es una aplicacion web estatica para gestion de turnos, permisos, ausencias, reemplazos, horas extras, dotacion, marcaciones, solicitudes de trabajadores, MEMOS y bitacora LOG.

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
- Menu MEMOS:
  - La navegacion principal incluye `MEMOS` despues de `Solicitudes` y antes de `Cambios de Turno`.
  - `js/memos.js` guarda tareas en `localStorage` bajo `memos`, renderiza la pagina y mantiene el badge de pendientes.
  - Se crea una tarea `Memorandum pendiente` al aplicar P. Administrativo, F. Legal, F. Compensatorio, 1/2 ADM Manana, 1/2 ADM Tarde, Permiso sin goce o un marcaje incompleto de entrada/salida.
  - Al guardar un nuevo contrato para un trabajador con rotativa `Reemplazo`, se crea una tarea `Memorandum Pendiente` con trabajador, inicio, termino, motivo del reemplazo y persona reemplazada.
  - Cada tarea permite marcar `Realizado` y adjuntar documentos en base64.
- Devolucion de Horas:
  - El menu Turnos tiene el boton `DEVOLUCION DE HORAS (0)` antes de `AUSENCIA INJUSTIFICADA`.
  - El saldo se edita en `Perfil > Vacaciones Disponibles > Horas para devolucion`.
  - Al aplicar, solo se habilitan turnos base sin permisos, licencias, feriados, compensatorios, ausencias ni devoluciones ya aplicadas.
  - El modal permite retrasar entrada y/o adelantar salida dentro del horario del turno, o usar `Todo el Turno` si el saldo alcanza.
  - Calendario muestra `Devolucion` para turno completo y `Dev. Parcial` para parcial; timeline marca `D` o `DP`.
  - Los marcajes de reloj control sobre una devolucion parcial usan el horario reducido como jornada esperada.
  - Si el trabajador marca dentro del tramo cubierto por devolucion parcial o 1/2 ADM, esas horas no se consideran HHEE; solo cuenta como extra lo trabajado fuera del turno base/permisos.
  - En la pagina HH.EE existe un switch `Enviar HH.EE a devolucion`; al activarlo, las HH.EE del mes visualizado no van a pago y se suman al saldo de devolucion con factor 1.25 para diurnas y 1.5 para nocturnas.
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
- `js/memos.js`: tareas de memorandum pendientes, checkbox de realizado, documentos adjuntos y contador del menu MEMOS.
- `js/hoursEngine.js`, `js/hoursCharts.js`, `js/hoursReport.js`: calculos, graficos y reportes de horas.
- `js/systemSettings.js`: modal de ajustes, valores hora por grado, feriados manuales, solicitudes de reemplazo y dotacion.
- `js/holidays.js`: feriados de Chile por API Nager.Date y feriados manuales.
- `js/firebase*.js`, `js/workspaces.js`: autenticacion/shell Firebase, workspaces, copia manual de respaldo y sincronizacion modular del estado.
- `js/firebaseAppState.js`: sincronizacion automatica por workspace de subconjuntos de `localStorage`, con un manifiesto y chunks separados por modulo en Firestore.
- `js/firebaseInterUnitLoans.js`: disponibilidad mensual sanitizada, sincronizacion local de prestamos y llamadas a Cloud Functions.
- `js/firebaseLinkedUnits.js`: solicitudes de enlace entre unidades y aceptacion/rechazo/desenlace.
- `firebase.rules` y `storage.rules`: reglas de Firestore y Storage para workspaces y miembros.

## Vistas Principales

La navegacion vive en `index.html` con botones `nav-tile`.

- `calendarPanel`: calendario de turnos del perfil activo.
- `workerRequestsPanel`: solicitudes de trabajadores.
- `memosPanel`: tareas MEMOS / memorandum pendientes.
- `clockMarksPanel`: marcaciones.
- `turnChangesView`: cambios de turno.
- `staffingPanel`: dotacion.
- `hoursPanel`: horas y graficos.
- `auditLogPanel`: LOG / bitacora.
- `profileSection`: menu Perfil.
- `reportsPanel`: reportes. Actualmente se dejo limpio y solo muestra `Listado Colaboradores` a la izquierda.

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
- `shiftAssignmentHistory_<perfil>`: cambios mensuales de asignacion de turno; cada evento rige desde el dia 1 del mes indicado.
- `carry_<perfil>_<year>_<month>`: arrastre mensual.
- `leaveBalances_<perfil>`: saldos manuales de permisos/vacaciones por anio.
- `leaveBalances_<perfil>[anio].hoursReturn`: saldo para la funcionalidad `Devolucion de Horas`; se edita en `Perfil > Vacaciones Disponibles > Horas para devolucion` y alimenta el contador del boton `DEVOLUCION DE HORAS (0)` en el menu Turnos.
- `hourReturns_<perfil>`: devoluciones de horas aplicadas por dia calendario. Cada registro guarda turno/segmento, si cubre todo el turno, entrada/salida parcial y horas descontadas del saldo `hoursReturn`.
- `hheeReturnTransfers_<perfil>`: configuracion mensual del switch HH.EE -> Devolucion de horas, con horas diurnas/nocturnas base, horas transferidas y saldo base al momento de activar.
- `replacements`: reemplazos, prestamos y respaldos de HHEE.
- `replacementRequests`: solicitudes de reemplazo.
- `replacementRequestConfig`: configuracion de solicitudes de reemplazo.
- `turnChangeConfig`: reglas globales de cambios de turno y turnos 24.
- `workerRequests`: solicitudes desde trabajadores.
- `memos`: tareas de memorandum pendientes y realizadas, con documentos adjuntos.
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

- La seleccion de un workspace Firebase inicia sincronizacion automatica del estado de la app separado por modulos de seguridad.
- `js/firebaseStateModules.js` clasifica cada clave local en `profile`, `turnos`, `clockmarks`, `requests`, `memos`, `swap`, `hours`, `weekly`, `tasks`, `agenda`, `reports`, `log` o `system`.
- Cada modulo guarda su manifiesto en `workspaces/{workspaceId}/stateModules/{moduleId}` y sus chunks en la subcoleccion `chunks`.
- Las reglas validan `view` y `edit` del modulo tanto para lectura como para escritura. Las claves desconocidas se asignan a `system`, accesible solo para el propietario.
- `localStorage` sigue siendo la cache local de trabajo; Firebase replica solamente los modulos autorizados entre usuarios del mismo workspace.

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

- En `Cuentas y Unidades`, un workspace puede solicitar enlace a otro por ID. El otro workspace debe aceptar la solicitud.
- Las solicitudes de enlace entrantes tambien aparecen en el menu `Solicitudes`, junto a las solicitudes de trabajadores, y suman al badge rojo del icono cuando estan pendientes.
- `js/workerRequests.js` inicia una escucha Firestore en tiempo real sobre `workspaceLinks` entrantes del entorno activo para que el badge de `Solicitudes` se actualice sin tener que abrir el menu.
- En `Cuentas y Unidades`, los enlaces activos se pueden clickear para confirmar el desenlace. El `workspaceLink` queda con estado `unlinked` y deja de aparecer como activo.
- Aceptar no agrega el entorno ajeno al selector de trabajo ni permite navegar sus perfiles.
- En el dialogo de reemplazo, `Buscar sugerencias en unidades enlazadas` carga enlaces aceptados del entorno activo en ambos sentidos.
- Cada unidad publica documentos `linkedStaffingMonths/{YYYY-MM}` con una proyeccion minima: nombre operativo, profesion, turno, disponibilidad y HHEE del mes. No incluye RUT, correo, documentos, permisos ni el snapshot completo.
- La disponibilidad remota se obtiene mediante la callable `getLinkedStaffingMonth`, que valida autenticacion, membresia y enlace aceptado.
- Solo lista candidatos activos compatibles por profesion/estamento, sin ausencias ese dia, con disponibilidad para cubrir el turno requerido y con regla de turno 24 permitida en ambas unidades cuando corresponda.
- Las sugerencias muestran HHEE diurnas/nocturnas del mes calculadas desde la unidad origen del trabajador.
- Las callables `createInterUnitLoan` y `cancelInterUnitLoan` validan permisos, enlace y disponibilidad, y escriben `loanAssignments/{loanId}` en ambas unidades.
- Cada unidad solo integra su propio `loanAssignment` como reemplazo local `inter_unit_loan`; nunca escribe el `appState` de la otra unidad.

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
- Tambien marca como anulado el LOG original `Asigno reemplazo de turno` asociado a cada `meta.replacementId` cancelado, dejando `canceledAt`, `canceledBy` y `cancellationDetails`.
- Tambien notifica al trabajador afectado.
- El log original de ausencia queda marcado como anulado.

## Firebase

`js/firebaseConfig.js` tiene `FIREBASE_ENABLED = true`.

Proyectos:

- Produccion: `calendarioturnos-7c4d9`.
- Pruebas: `turnoplus-test-7c4d9`.
- `.firebaserc` tiene aliases `default`/`production` y `test`.
- La configuracion web usa produccion por defecto y selecciona test automaticamente cuando el host es `turnoplus-test-7c4d9.web.app` o `turnoplus-test-7c4d9.firebaseapp.com`.

Arquitectura:

- Modo local sigue usando `localStorage` como cache sincronica de la app.
- Al iniciar sesion y seleccionar un workspace, `js/main.js` llama `startFirebaseAppStateSync()` desde `js/firebaseAppState.js`.
- Firebase sincroniza automaticamente documentos separados por modulo:
  - Manifiesto: `workspaces/{workspaceId}/stateModules/{moduleId}`.
  - Chunks: `workspaces/{workspaceId}/stateModules/{moduleId}/chunks/part_0000`, `part_0001`, etc.
- `js/firebaseAppState.js` solo escucha los modulos que el miembro puede ver y solo sube aquellos que puede editar.
- El snapshot excluye claves internas, de tema, workspace activo, id local del cliente y claves tecnicas de Firebase Auth (`firebase:` / `firebase-`).
- `js/persistence.js` emite `proturnos:persistenceChanged`; `firebaseAppState.js` marca su modulo y sube solo ese subconjunto con debounce.
- Cuando llega un cambio remoto, `replaceLocalSnapshotSubset()` reemplaza solamente el modulo correspondiente y `main.js` refresca las vistas.
- Los modulos granulares `firebaseProfiles.js`, `firebaseReplacementRequests.js` y `firebaseWorkerRequests.js` siguen en el repo, pero `main.js` ya no los inicia; la sincronizacion completa los reemplaza como camino principal.
- `js/firebaseMigration.js` sigue disponible como copia manual de respaldo en `workspaces/{workspaceId}/system/localStorageSnapshot`; no es el flujo automatico principal.
- `js/firebaseLinkedUnits.js` maneja `workspaceLinks`: solicitudes pendientes, aceptadas, rechazadas y desenlazadas.
- `firebase.rules` bloquea por completo los antiguos `system/appState` y `appStateChunks`; no existe fallback monolitico.
- Las unidades enlazadas acceden solo por Cloud Functions a la proyeccion sanitizada.
- Los adjuntos nuevos se guardan en `workspaces/{workspaceId}/attachments/{moduleId}/{ownerId}/{recordId}/{fileName}`.
- `storage.rules` exige membresia, permiso del modulo, metadatos coherentes, tipos permitidos y limite de 5 MB. El cargador original puede eliminar su propio archivo.
- Los adjuntos base64 antiguos siguen siendo legibles por compatibilidad, pero los nuevos perfiles, marcajes, agenda, memorandos y postulantes usan Firebase Storage.
- MFA/TOTP esta implementado, pero apagado en todos los entornos durante la etapa comercial inicial. La UI conserva el enrolamiento y la resolucion del segundo factor como capacidad dormida para activarla solo cuando un centro lo solicite o pase a ser un requisito esencial.
- El proyecto productivo tiene Firestore con proteccion contra eliminacion, PITR de 7 dias y respaldo diario con retencion de 7 dias.
- `scripts/cloud-hardening.mjs` aplica/valida restriccion de API key publica a APIs Firebase, metricas de logs, alertas de Functions/App Check y presupuesto mensual. TOTP solo se activa si se ejecuta con `TURNOPLUS_ENABLE_TOTP=true`.
- La API key web es publica por diseno de Firebase; la seguridad depende de reglas, App Check, Auth y restricciones de clave/referrers.
- El proyecto de pruebas tiene Hosting, Firestore y el bucket `turnoplus-test-7c4d9.firebasestorage.app` en `SOUTHAMERICA-WEST1`. App Check esta activo en Test; TOTP esta desactivado.
- `scripts/build-test-security-rules.mjs` genera por defecto en `.firebase/turnoplus-test/` variantes de Firestore/Storage sin MFA. La variante futura con MFA requiere `--enable-mfa`; `firebase.rules` y `storage.rules` tambien mantienen la exigencia apagada.
- `scripts/configure-test-security.mjs` verifica/provisiona el bucket y cambia TOTP solo con opciones explicitas. Los comandos operativos son `npm run security:storage:test:apply`, `npm run security:totp:test:enable`, `npm run security:totp:test:disable`, `npm run deploy:security-rules:test` y, solo para una activacion futura coordinada, `npm run deploy:security-rules:test:mfa`.
- Recuperacion TOTP: el usuario debe conservar la clave de enrolamiento en un gestor seguro. Si la pierde, el administrador del proyecto elimina sus factores MFA desde Firebase Authentication > Users; el usuario vuelve a ingresar y la app exige un enrolamiento nuevo.
- Si Google login devuelve `auth/unauthorized-domain`, agregar el hostname usado en navegador en Firebase Console > Authentication > Settings > Authorized domains. Para desarrollo local, autorizar `127.0.0.1` y `localhost` sin puerto.
- En el modal `Cuentas y Unidades`, cada unidad muestra el ID en un input seleccionable. Solo el propietario puede generar invitaciones seguras de supervisor: token de un solo uso, vencimiento de 7 dias, permisos explicitos y aprobacion final del propietario.
- Las invitaciones de supervisor se crean y resuelven solo por Cloud Functions (`createSupervisorInvite`, `claimSupervisorInvite`, `approveSupervisorInvite`, `rejectSupervisorInvite`, `revokeSupervisorInvite`). El token real viaja solo en el enlace `?joinWorkspace=<id>&supervisorInvite=<token>`; Firestore guarda el hash como ID en `workspaces/{workspaceId}/supervisorInvites/{inviteId}`.
- Si Firebase esta configurado, `js/firebaseShell.js` exige login Google antes de permitir cambios: abre automaticamente el modal de inicio de sesion y bloquea la app con `body.auth-gate-active` hasta que haya usuario autenticado.
- Para unirse como supervisor, el invitado solo reclama la invitacion y queda pendiente. El documento `members/{uid}` y `users/{uid}/workspaces/{workspaceId}` se crean atomicamente por Function cuando el propietario aprueba. Las reglas bloquean la autocreacion cliente con `inviteCode` heredado y no dan acceso amplio a miembros sin `permissions`.

CI / pruebas:

- `.github/workflows/security.yml` ejecuta auditorias `npm audit --audit-level=high`, chequeos de sintaxis, `npm run test:state-modules`, pruebas de Security Rules con emuladores y `npm run build`.
- `tests/security-rules.test.mjs` cubre acceso modular, Storage e invitaciones seguras. `tests/security-rules-test-mfa.test.mjs` repite la suite con las reglas Test y verifica que operaciones privilegiadas sin MFA queden bloqueadas.

## PWA de supervisores

- `manifest.webmanifest` publica TurnoPlus como PWA instalable con iconos 192, 512 y maskable.
- `js/pwaInstall.js` captura `beforeinstallprompt` y muestra `#pwaInstallBtn` solo cuando Chrome o Edge permiten instalar la app. Durante el acceso obligatorio con Google, `#pwaInstallGateBtn` ofrece el mismo CTA por encima del modal. Ambos se ocultan dentro del modo standalone y despues de `appinstalled`.
- `sw.js` mantiene un shell offline basico; los datos de Firebase siguen necesitando conexion para sincronizarse.
- La carpeta hermana `PWA Supervisor TurnoPlus` conserva el proyecto/documentacion de la capa PWA. Los archivos que usa produccion deben permanecer en este repositorio porque navegador, manifiesto y `turnoplus.cl` deben compartir origen.
- `tests/state-modules.test.mjs` cubre clasificacion de modulos de estado.

Verificacion ejecutada tras este avance:

```powershell
node --check js\persistence.js
node --check js\firebaseAppState.js
node --check js\firebaseShell.js
node --check js\firebaseMigration.js
node --check js\main.js
node --check js\firebaseClient.js
node --check js\workspacePermissions.js
node --check js\auditLog.js
npm run test:state-modules
npm run test:rules
npm audit --audit-level=high
Push-Location functions; npm audit --audit-level=high; Pop-Location
npm run build
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

Pruebas automatizadas:

```powershell
npm run test:state-modules
npm run test:rules
npm audit --audit-level=high
Push-Location functions; npm audit --audit-level=high; Pop-Location
```

Hardening cloud:

```powershell
node scripts\cloud-hardening.mjs
```

Deploy productivo completo:

```powershell
npm run build
firebase.cmd deploy --only firestore:rules,storage,functions,hosting --project calendarioturnos-7c4d9
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

1. Revisar manualmente la UI de Perfil tras los cambios de profesiones y layout.
2. Considerar limpiar mojibake de `js/constants.js` con mucho cuidado, verificando que no rompa claves historicas.
3. Crear una rutina manual de QA minima documentada para calendario, permisos, reemplazos, LOG, perfil y solicitudes.
4. Mantener TOTP archivado hasta que un centro lo solicite o sea requisito esencial; cuando se decida activarlo, validar enrolamiento, segundo inicio de sesion y recuperacion primero en `turnoplus-test-7c4d9`.
5. Pendiente archivado: admitir cambios de asignacion de turno a mitad de mes. Ese caso debera dividir el periodo en dos tramos y generar dos informes con motores de calculo distintos. Por ahora solo se permiten vigencias desde el dia 1 de un mes.
