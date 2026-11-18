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

## Cambio a auditar

- `js/replacements.js`: la cancelacion por claves de dias ejecuta tambien
  `removeManualExtraTurnFromCalendar`, como la cancelacion individual existente.
- `js/leaveEngine.js`: despues de aceptar los dialogos y ejecutar `beforeMutation`,
  las licencias `license` y `professional_license` eliminan los ajustes de
  `clockMarks_` de sus dias. Guardan una vez y registran `clearedClockMarkKeys` en
  la bitacora. Esto funciona aunque no queden extras activos.
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

## Validacion

106 pruebas aprobadas en los grupos de licencias, anulacion de extras, horarios,
contratos, permisos y documentos. Cuatro regresiones nuevas comprueban ambas
licencias, conservacion de la Noche base, fechas/perfiles ajenos y asistencia
importada; limpieza con respaldo previamente anulado; rechazo sin mutacion.

Comandos:

```powershell
node --test tests/license-conflict-cancellation.test.mjs tests/anular-turno-extra-manual.test.mjs tests/marcaje-sobre-turno-extra.test.mjs tests/marcaje-sin-turno.test.mjs tests/permiso-sin-turno-extra.test.mjs
node --test tests/leave-application.test.mjs tests/leave-overwrite-block.test.mjs tests/replacement-registered-shift-hours.test.mjs tests/replacement-contract-candidates.test.mjs tests/replacement-leave-grouping.test.mjs tests/memo-licencia-medica.test.mjs tests/licencia-respaldo.test.mjs tests/horario-propio.test.mjs
```

Para Claude: revisar la frontera entre turno base y extra al cancelar, el orden
confirmacion/preparacion/mutacion, y que los ajustes borrados no reaparezcan al
anular una licencia o reasignar un turno. El reporte no implica una auditoria
global de todos los trabajadores con licencias historicas.
