// Version de escritura de la bitacora (auditLog).
//
// Cada registro NUEVO lleva `writer: { schemaVersion, buildId }`:
//  - schemaVersion: version ESTABLE del formato con que se escribe el
//    registro. Solo se sube cuando cambia la forma del registro, no en cada
//    deploy.
//  - buildId: identificador del build que lo escribio. build.mjs lo genera
//    automaticamente (scripts/build-id.mjs) y esbuild lo inyecta en
//    __TURNOPLUS_AUDIT_BUILD_ID__. Sin build (pruebas, servidor local sin
//    empaquetar) vale "dev".
//
// El registro es el MISMO objeto en el formato viejo (log/auditLog) y en los
// fragmentos (auditLogShards copia el JSON persistido), asi que los metadatos
// son identicos en ambos. Una pestana abierta con un build anterior escribe
// registros SIN `writer`: la revision diaria del servidor los detecta como
// recientes sin version (solo visible en TurnoPlus-Admin y Cloud Logging).
// Los registros historicos, anteriores a la primera escritura versionada de la
// unidad, no cuentan.

export const AUDIT_LOG_SCHEMA_VERSION = 1;

/* global __TURNOPLUS_AUDIT_BUILD_ID__ */
export const AUDIT_LOG_BUILD_ID =
    typeof __TURNOPLUS_AUDIT_BUILD_ID__ === "string" && __TURNOPLUS_AUDIT_BUILD_ID__
        ? __TURNOPLUS_AUDIT_BUILD_ID__
        : "dev";

export function auditLogWriterMeta() {
    return {
        schemaVersion: AUDIT_LOG_SCHEMA_VERSION,
        buildId: AUDIT_LOG_BUILD_ID
    };
}
