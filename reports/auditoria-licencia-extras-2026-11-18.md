# Licencia medica: limpieza de extras y horarios manuales

## Problema y causa

Aplicar una licencia anulaba los registros de extras y las solicitudes vinculadas,
pero la cancelacion por rango de dias no retiraba el turno manual de `data_`.
Tampoco eliminaba los ajustes manuales de horario de `clockMarks_`. Estos podian
seguir mostrando el reloj y volver a afectar un turno reasignado.

En el caso reportado los cinco extras ya estaban anulados tanto en `replacements`
como en `replacementRecords` (modo sombra), y `data_` ya conservaba solo las Noches
base. Persistian cuatro ajustes diurnos de salida a las 16:00 sin turno diurno.
La evidencia no muestra una discrepancia entre ambos formatos de persistencia.

## Segunda version: respuesta a los tres P2 de Claude

- `js/replacements.js`: la cancelacion por claves de dias ejecuta tambien
  `removeManualExtraTurnFromCalendar`, como la cancelacion individual existente.
  Ahora calcula solo el extra sobre `getTurnoBase`, conserva la base trasladada
  por la ayuda para cubrir, y recompone Diurno + HT como Larga. Al quitar HT de
  Larga vuelve a Diurno; al quitar HT de 24 conserva Diurno + Noche. La anulacion
  individual usa la misma correccion.
- `js/leaveEngine.js`: despues de aceptar los dialogos y ejecutar `beforeMutation`,
  las licencias `license` y `professional_license` suspenden los ajustes de
  `clockMarks_` de sus dias. El dialogo enumera los dias y explica el respaldo y
  la restauracion, incluso cuando solo hay horarios y ningun extra activo.
- `js/leaveClockMarks.js`: guarda el contenido completo por dia en
  `leaveClockMarks_<perfil>`, en el modulo `clockmarks`, ANTES de retirar marcas
  o cancelar reemplazos. Conserva documentos, solicitudes y todos los metadatos.
  La bitacora lleva `clearedClockMarkKeys` y `clockMarkBackupId`; los documentos
  privados no se duplican en el modulo de bitacora ni en la PWA.
- `js/auditLog.js`: al anular la licencia restaura el respaldo de los dias
  efectivamente retirados si no hay un horario nuevo. Otra licencia que sustituye
  la primera hereda la referencia al respaldo original. Se consume el respaldo
  procesado para evitar reponerlo de nuevo en una licencia futura.
- El nuevo mapa se sincroniza por dia, con tombstones, y acompana al perfil en
  los cambios de nombre y el guardado de estado critico. La restauracion funciona
  despues de rehidratar el estado en otro equipo.
- La limpieza conserva otros trabajadores, fechas fuera de la licencia,
  asistencia importada (`attendanceMarks`) y coberturas que otros hacen al ausente.
- Se mantienen los turnos base; una licencia no borra la rotativa.

## Reparacion del caso reportado

Se retiraron solo cuatro ajustes diurnos huerfanos, correspondientes a extras
anulados por licencia. Se conservaron los otros cuatro ajustes historicos.
Antes de escribir se verificaron los registros activos de estado y sombra, la
Noche base de cada dia y la coincidencia exacta con el respaldo de los ajustes.
Se guardo evidencia privada en `.tools/`, excluida de Git y Hosting.

La escritura uso `currentDocument.updateTime`, tombstones en `deletedItems` y
timestamp del servidor; la relectura con `stateReader.applyEntry` confirmo el
resultado. No fue necesario modificar registros de reemplazos ni licencias.

## Validacion de la segunda version

Suite completa: 3.867 pruebas aprobadas, 4 omitidas y 0 fallos (raiz y backend
unitario, excluyendo integraciones que requieren emulador). Las 36 pruebas
especificas de licencias y anulaciones tambien pasan en la comprobacion final.

La primera version tenia 106 pruebas aprobadas y la auditoria descubrio casos
que no cubrian. Se agregaron regresiones para ambos tipos de licencia, bases
trasladadas, HT sobre Diurno y 24, anulacion individual, restauracion de horas
extras y documentos, horario nuevo prioritario, rechazo del aviso de horarios,
fallo de `beforeMutation`, rehidratacion entre equipos, anulacion parcial y
sustitucion de licencias.

La misma bateria nueva ejecutada en una copia aislada del commit publicado
`34ad7ec` reproduce fallos en los tres hallazgos. Los resultados y la evidencia
estan en `.tools/license-audit-before-34ad7ec.log` (no se publican).

Comandos:

```powershell
node --test tests/license-conflict-cancellation.test.mjs tests/anular-turno-extra-manual.test.mjs tests/state-modules.test.mjs tests/firebase-partial-state-batch.test.mjs
node --test tests/leave-application.test.mjs tests/leave-overwrite-block.test.mjs tests/replacement-registered-shift-hours.test.mjs tests/replacement-contract-candidates.test.mjs tests/replacement-leave-grouping.test.mjs tests/memo-licencia-medica.test.mjs tests/licencia-respaldo.test.mjs tests/horario-propio.test.mjs
```

Para Claude: volver a revisar P2-1, P2-2 y P2-3, y en especial el ciclo
confirmacion/preparacion/respaldo/suspension/restauracion. La reparacion historica
de Nelson se mantiene. No se reconstruyeron automaticamente horarios eliminados
por la version anterior ni se auditaron todas las licencias historicas.
