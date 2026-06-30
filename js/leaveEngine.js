import {
    keyFromDate,
    keyFromISO,
    isoFromKey,
    keyToDate as parseKey
} from "./dateUtils.js";
import { fetchHolidays } from "./holidays.js";
import { isBusinessDay } from "./calculations.js";

import {
    getBlockedDays,
    saveBlockedDays,

    getAdminDays,
    saveAdminDays,

    getLegalDays,
    saveLegalDays,

    getCompDays,
    saveCompDays,

    getAbsences,
    saveAbsences,

    getShiftAssigned,
    getCurrentProfile,
    getRotativa,
    getManualLeaveBalances,
    saveManualLeaveBalances
} from "./storage.js";

import {
    addAuditLog,
    AUDIT_CATEGORY
} from "./auditLog.js";
import {
    getTurnoBase,
    getTurnoReal
} from "./turnEngine.js";
import {
    cancelSwapsForProfileKeys,
    getActiveSwapsForProfileKeys
} from "./swaps.js";
import {
    cancelReplacementsForWorkerKeys,
    getActiveReplacementsForWorkerKeys
} from "./replacements.js";
import {
    esAusenciaInjustificada,
    getAbsenceType,
    puedeAplicarAdministrativo,
    puedeAplicarAusenciaInjustificada,
    puedeAplicarCompensatorioDesde,
    puedeAplicarLegalDesde,
    puedeReemplazarAusencia
} from "./rulesEngine.js";
import { createLeaveMemoTask } from "./memos.js";
import { showConfirm } from "./dialogs.js";

/* =========================================
HELPERS
========================================= */

function formatKey(key) {
    const iso = isoFromKey(key);
    const parts = iso.split("-");

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function replacementConflictLine(replacement) {
    const target = replacement.replaced
        ? `, cubriendo a ${replacement.replaced}`
        : "";
    const turn = replacement.turno || replacement.clockLabel || "turno";

    return `- ${formatKey(keyFromISO(replacement.date))}: ${turn}${target}`;
}

function swapConflictLine(swap) {
    return `- ${swap.from} -> ${swap.to}: cambio ${swap.fecha}, devoluci\u00f3n ${swap.devolucion}`;
}

function scheduleConflictMessage({
    label,
    replacements,
    swaps
}) {
    const sections = [
        `La aplicaci\u00f3n de ${label} se cruza con asignaciones vigentes que deben anularse antes de continuar.`
    ];

    if (replacements.length) {
        sections.push(
            "",
            `Turnos extra/reemplazos (${replacements.length}):`,
            replacements.map(replacementConflictLine).join("\n")
        );
    }

    if (swaps.length) {
        sections.push(
            "",
            `Cambios de turno (${swaps.length}):`,
            swaps.map(swapConflictLine).join("\n")
        );
    }

    sections.push(
        "",
        `Si contin\u00faas, estas asignaciones se marcar\u00e1n como anuladas y luego se aplicar\u00e1 ${label}.`,
        "\u00bfDeseas continuar?"
    );

    return sections.join("\n");
}

async function confirmAndCancelScheduleConflicts(
    profile,
    keys,
    label,
    {
        cancelReplacements = false,
        confirmDialog = showConfirm,
        beforeCancellation = null
    } = {}
) {
    const swaps = getActiveSwapsForProfileKeys(profile, keys);
    const replacements = cancelReplacements
        ? getActiveReplacementsForWorkerKeys(profile, keys)
        : [];

    if (!swaps.length && !replacements.length) {
        return {
            canceledReplacements: [],
            canceledSwaps: []
        };
    }

    const accepted =
        typeof window === "undefined" ||
        await confirmDialog(scheduleConflictMessage({
            label,
            replacements,
            swaps
        }), {
            title: "Asignaciones que ser\u00e1n anuladas",
            tone: "warning",
            confirmText: "Aplicar y anular asignaciones"
        });

    if (!accepted) return null;

    if (typeof beforeCancellation === "function") {
        await beforeCancellation();
    }

    const canceledReplacements = cancelReplacements
        ? cancelReplacementsForWorkerKeys(
            profile,
            keys,
            {
                reason: "medical_leave_applied",
                details: `${label} aplicada a ${profile}.`
            }
        )
        : [];
    const canceledSwaps = cancelSwapsForProfileKeys(profile, keys);

    if (
        canceledReplacements.length &&
        typeof window !== "undefined"
    ) {
        window.dispatchEvent(
            new CustomEvent(
                "proturnos:leaveScheduleConflictsCanceled",
                {
                    detail: {
                        profile,
                        label,
                        canceledReplacements,
                        canceledSwaps
                    }
                }
            )
        );
    }

    return {
        canceledReplacements,
        canceledSwaps
    };
}

function absenceLabel(type) {
    if (type === "professional_license") return "LM Profesional";
    if (type === "union_leave") return "Permiso Gremial";
    if (type === "unpaid_leave") return "Permiso sin Goce";
    if (type === "unjustified_absence") return "Ausencia Injustificada";

    return "Licencia M\u00e9dica";
}

function diasEntre(a,b){
    return Math.floor((a-b)/86400000);
}

function isSameYearKey(key, year){
    return key.startsWith(year + "-");
}

function contarHabiles(obj){

    const year = new Date().getFullYear();
    let total = 0;

    Object.keys(obj).forEach(k=>{

        if(!k.startsWith(year + "-")) return;

        const d = parseKey(k);
        const dow = d.getDay();

        if(dow !== 0 && dow !== 6){
            total++;
        }
    });

    return total;
}

function validarRangoAusencias(fechas){

    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const abs = getAbsences();

    for(const key of fechas){

        if(admin[key]) return false;
        if(legal[key]) return false;
        if(comp[key]) return false;
        if(
            abs[key] &&
            !esAusenciaInjustificada(abs[key])
        ) return false;
    }

    return true;
}

export async function aplicarAusenciaInjustificada(fecha){
    const currentProfile = getCurrentProfile();

    if (!currentProfile) return false;

    const key = keyFromDate(fecha);
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const blocked = getBlockedDays();
    const turno = getTurnoReal(currentProfile, key);

    if (
        !puedeAplicarAusenciaInjustificada(
            key,
            turno,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return false;
    }

    if (
        !await confirmCancelTurnChanges(
            currentProfile,
            [key],
            "Ausencia Injustificada"
        )
    ) {
        return false;
    }

    absences[key] = {
        type: "unjustified_absence"
    };
    blocked[key] = true;

    saveAbsences(absences);
    saveBlockedDays(blocked);

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Aplic\u00f3 ausencia injustificada",
        `${currentProfile}: ${formatKey(key)}.`,
        {
            profile: currentProfile,
            date: isoFromKey(key),
            keys: [key],
            type: "unjustified_absence"
        }
    );

    return true;
}

/* =========================================
ADMINISTRATIVO
========================================= */

export function totalAdministrativosUsados(
    year = new Date().getFullYear()
){

    const admin = getAdminDays();
    let total = 0;
    const selectedYear = year + "-";

    Object.entries(admin).forEach(([key, value])=>{
        if (!key.startsWith(selectedYear)) return;

        if(value === 1) total += 1;
        else total += 0.5;
    });

    return total;
}

function contarHabilesEnAno(obj, year, holidays){
    let total = 0;

    Object.keys(obj).forEach(key => {
        if (!isSameYearKey(key, year)) return;

        if (isBusinessDay(parseKey(key), holidays)) {
            total++;
        }
    });

    return total;
}

export async function aplicarAdministrativo(fecha, cantidad = 1){

    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();
    const absences = getAbsences();
    const shiftAssigned =
        getShiftAssigned(getCurrentProfile(), fecha);
    const currentProfile =
        getCurrentProfile();

    const holidays =
        await fetchHolidays(fecha.getFullYear());

    let d = new Date(fecha);
    let changedAbsences = false;
    const keys = [];

    for(let i=0;i<cantidad;i++){

        const key = keyFromDate(d);

        const habil =
            isBusinessDay(d, holidays);

        const turno = getTurnoBase(
            currentProfile,
            key
        );

        if (
            !puedeAplicarAdministrativo(
                key,
                turno,
                habil,
                admin,
                legal,
                comp,
                absences,
                shiftAssigned,
                getRotativa(currentProfile)
            )
        ) {
            return false;
        }

        keys.push(key);
        d.setDate(d.getDate()+1);
    }

    if (
        !await confirmCancelTurnChanges(
            currentProfile,
            keys,
            "P. Administrativo"
        )
    ) {
        return false;
    }

    keys.forEach(key => {
        if (esAusenciaInjustificada(absences[key])) {
            delete absences[key];
            changedAbsences = true;
        }

        admin[key] = 1;
    });

    saveAdminDays(admin);

    if (changedAbsences) {
        saveAbsences(absences);
    }

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Aplic\u00f3 P. Administrativo",
        `${currentProfile}: ${cantidad} d\u00eda desde ${formatKey(keyFromDate(fecha))}.`,
        {
            profile: currentProfile,
            date: isoFromKey(keyFromDate(fecha)),
            keys,
            type: "admin",
            amount: cantidad
        }
    );

    createLeaveMemoTask({
        profile: currentProfile,
        typeLabel: "P. Administrativo",
        amount: cantidad,
        startKey: keys[0],
        endKey: keys[keys.length - 1],
        sourceType: "admin"
    });

    return true;
}

export async function aplicarHalfAdministrativo(fecha, tipo="M"){

    const admin = getAdminDays();
    const currentProfile = getCurrentProfile();

    const holidays =
        await fetchHolidays(fecha.getFullYear());

    if(!isBusinessDay(fecha, holidays)) return false;

    const key = keyFromDate(fecha);

    if(admin[key]) return false;

    if (
        !await confirmCancelTurnChanges(
            currentProfile,
            [key],
            tipo === "M"
                ? "1/2 ADM Ma\u00f1ana"
                : "1/2 ADM Tarde"
        )
    ) {
        return false;
    }

    admin[key] =
        tipo === "M" ? "0.5M" : "0.5T";

    saveAdminDays(admin);

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        tipo === "M"
            ? "Aplic\u00f3 1/2 ADM Ma\u00f1ana"
            : "Aplic\u00f3 1/2 ADM Tarde",
        `${getCurrentProfile()}: ${formatKey(key)}.`,
        {
            profile: getCurrentProfile(),
            date: isoFromKey(key),
            keys: [key],
            type: tipo === "M"
                ? "half_admin_morning"
                : "half_admin_afternoon",
            amount: 0.5
        }
    );

    createLeaveMemoTask({
        profile: getCurrentProfile(),
        typeLabel: tipo === "M"
            ? "1/2 ADM Ma\u00f1ana"
            : "1/2 ADM Tarde",
        amount: 0.5,
        startKey: key,
        endKey: key,
        sourceType: tipo === "M"
            ? "half_admin_morning"
            : "half_admin_afternoon"
    });

    return true;
}

/* =========================================
FERIADO LEGAL
========================================= */

export async function existeBloque10Legal(year = new Date().getFullYear()){
    const legal = getLegalDays();
    const holidays = await fetchHolidays(year);

    let max = 0;
    let actual = 0;
    const cursor = new Date(year, 0, 1);

    while (cursor.getFullYear() === year) {
        const key = keyFromDate(cursor);
        const isHab = isBusinessDay(cursor, holidays);

        if (isHab && legal[key]) {
            actual++;
            if (actual > max) max = actual;
        } else if (isHab) {
            actual = 0;
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return max >= 10;
}

export async function validarCantidadLegalAnual(cantidad, year = new Date().getFullYear()){
    const legal = getLegalDays();
    const holidays = await fetchHolidays(year);
    const saldoCalculado = Math.max(
        0,
        15 - contarHabilesEnAno(legal, year, holidays)
    );
    const saldoManual = Number(
        getManualLeaveBalances(year).legal
    );
    const saldo = Number.isFinite(saldoManual)
        ? Math.max(0, saldoManual)
        : saldoCalculado;

    if (
        !cantidad ||
        cantidad <= 0 ||
        !Number.isInteger(Number(cantidad))
    ) {
        return {
            ok: false,
            saldo,
            message: "Ingresa una cantidad valida de feriado legal."
        };
    }

    if (cantidad > saldo) {
        return {
            ok: false,
            saldo,
            message: "La cantidad supera el saldo disponible."
        };
    }

    const yaTieneBloque10 = await existeBloque10Legal(year);
    const solicitudCumpleBloque10 = cantidad >= 10;
    const dejaReserva10 = saldo - cantidad >= 10;

    if (
        !yaTieneBloque10 &&
        !solicitudCumpleBloque10 &&
        !dejaReserva10
    ) {
        return {
            ok: false,
            saldo,
            message: "El trabajador a\u00fan debe reservar saldo para solicitar 10 F. Legales continuos. Reduce la cantidad o solicita ahora un bloque de al menos 10 d\u00edas h\u00e1biles."
        };
    }

    return {
        ok: true,
        saldo,
        message: ""
    };
}

export async function aplicarLegal(fecha, cantidad){

    const legal = getLegalDays();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const comp = getCompDays();
    const absences = getAbsences();

    const year = fecha.getFullYear();

    const holidays =
        await fetchHolidays(year);

    const startKey = keyFromDate(fecha);
    const cantidadValida =
        await validarCantidadLegalAnual(cantidad, year);

    if (!cantidadValida.ok) return false;

    if (
        !puedeAplicarLegalDesde(
            startKey,
            cantidad,
            holidays,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return false;
    }

    let usados = 0;
    let d = new Date(fecha);

    const nuevos = [];

    while(usados < cantidad){

        const key = keyFromDate(d);

        nuevos.push(key);

        if(isBusinessDay(d, holidays)){
            usados++;
        }

        d.setDate(d.getDate()+1);
    }

    if(!validarRangoAusencias(nuevos)) return false;

    if (
        !await confirmCancelTurnChanges(
            getCurrentProfile(),
            nuevos,
            "F. Legal"
        )
    ) {
        return false;
    }

    let changedAbsences = false;

    nuevos.forEach(k=>{
        if (esAusenciaInjustificada(absences[k])) {
            delete absences[k];
            changedAbsences = true;
        }

        legal[k] = true;
        blocked[k] = true;
    });

    saveLegalDays(legal);
    saveBlockedDays(blocked);

    if (changedAbsences) {
        saveAbsences(absences);
    }

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Aplic\u00f3 F. Legal",
        `${getCurrentProfile()}: ${cantidad} d\u00eda(s) h\u00e1biles desde ${formatKey(startKey)}.`,
        {
            profile: getCurrentProfile(),
            date: isoFromKey(startKey),
            keys: nuevos,
            type: "legal",
            amount: cantidad
        }
    );

    createLeaveMemoTask({
        profile: getCurrentProfile(),
        typeLabel: "F. Legal",
        amount: cantidad,
        startKey,
        endKey: nuevos[nuevos.length - 1],
        sourceType: "legal"
    });

    return true;
}

/* =========================================
COMPENSATORIO
========================================= */

const COMPENSATORY_BLOCK_OPTIONS = new Set([10, 20]);

function ultimoLegalHasta(fechaLimite){

    const legal = getLegalDays();

    let ult = null;

    Object.keys(legal).forEach(k=>{

        const d = parseKey(k);

        if (fechaLimite && d > fechaLimite) {
            return;
        }

        if(!ult || d > ult){
            ult = d;
        }
    });

    return ult;
}

export async function aplicarComp(fecha, cantidad = 10){
    const total = Number(cantidad);

    if (
        !total ||
        total <= 0 ||
        !Number.isInteger(total) ||
        !COMPENSATORY_BLOCK_OPTIONS.has(total)
    ) {
        return false;
    }

    const ult = ultimoLegalHasta(fecha);

    if(ult){

        const dias = diasEntre(fecha, ult);

        if(dias < 90) return false;
    }

    const comp = getCompDays();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const absences = getAbsences();

    const holidays =
        await fetchHolidays(fecha.getFullYear());
    const startKey = keyFromDate(fecha);
    const saldoCalculado = Math.max(
        0,
        10 - contarHabilesEnAno(
            comp,
            fecha.getFullYear(),
            holidays
        )
    );
    const saldoManual = Number(
        getManualLeaveBalances(fecha.getFullYear()).comp
    );
    const saldo = Number.isFinite(saldoManual)
        ? Math.max(0, saldoManual)
        : saldoCalculado;

    if (total > saldo) {
        return false;
    }

    if (
        !puedeAplicarCompensatorioDesde(
            startKey,
            total,
            holidays,
            admin,
            legal,
            comp,
            absences
        )
    ) {
        return false;
    }

    let usados = 0;
    let d = new Date(fecha);
    let changedAbsences = false;

    const nuevos = [];

    while(usados < total){

        const key = keyFromDate(d);

        nuevos.push(key);

        if(isBusinessDay(d, holidays)){
            usados++;
        }

        d.setDate(d.getDate()+1);
    }

    if (
        !await confirmCancelTurnChanges(
            getCurrentProfile(),
            nuevos,
            "F. Compensatorio"
        )
    ) {
        return false;
    }

    nuevos.forEach(k=>{
        if (esAusenciaInjustificada(absences[k])) {
            delete absences[k];
            changedAbsences = true;
        }

        comp[k] = true;
        blocked[k] = true;
    });

    saveCompDays(comp);
    saveBlockedDays(blocked);

    if (changedAbsences) {
        saveAbsences(absences);
    }

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        "Aplic\u00f3 F. Compensatorio",
        `${getCurrentProfile()}: bloque de ${total} d\u00eda(s) h\u00e1biles desde ${formatKey(startKey)}.`,
        {
            profile: getCurrentProfile(),
            date: isoFromKey(startKey),
            keys: nuevos,
            type: "comp",
            amount: total
        }
    );

    createLeaveMemoTask({
        profile: getCurrentProfile(),
        typeLabel: "F. Compensatorio",
        amount: total,
        startKey,
        endKey: nuevos[nuevos.length - 1],
        sourceType: "comp"
    });

    return true;
}

/* =========================================
LICENCIA
========================================= */

function previousKey(key) {
    const date = parseKey(key);

    date.setDate(date.getDate() - 1);

    return keyFromDate(date);
}

function nextKey(key) {
    const date = parseKey(key);

    date.setDate(date.getDate() + 1);

    return keyFromDate(date);
}

function isBeforeKey(a, b) {
    return parseKey(a) < parseKey(b);
}

function blockStartKey(map, key) {
    if (!map[key]) return "";

    let cursor = key;

    while (map[previousKey(cursor)]) {
        cursor = previousKey(cursor);
    }

    return cursor;
}

function blockKeys(map, key) {
    const start = blockStartKey(map, key);
    const keys = [];

    if (!start) return keys;

    let cursor = start;

    while (map[cursor]) {
        keys.push(cursor);
        cursor = nextKey(cursor);
    }

    return keys;
}

function shouldCancelMappedBlock(map, startKey, key) {
    const blockStart = blockStartKey(map, key);

    return Boolean(blockStart) && isBeforeKey(startKey, blockStart);
}

function shouldCancelAdmin(admin, startKey, key) {
    return Boolean(admin[key]) && isBeforeKey(startKey, key);
}

function addManualBalance(
    field,
    amount,
    year,
    createWhenMissing = false
) {
    if (!amount || amount <= 0) return;

    const manual = getManualLeaveBalances(year);
    const current = Number(manual[field]);

    if (!Number.isFinite(current) && !createWhenMissing) {
        return;
    }

    saveManualLeaveBalances(year, {
        [field]: (Number.isFinite(current) ? current : 0) + amount
    });
}

async function countBusinessReturned(keys) {
    const holidaysByYear = {};
    let total = 0;

    for (const key of keys) {
        const date = parseKey(key);
        const year = date.getFullYear();

        if (!holidaysByYear[year]) {
            holidaysByYear[year] = await fetchHolidays(year);
        }

        if (isBusinessDay(date, holidaysByYear[year])) {
            total++;
        }
    }

    return total;
}

async function returnLegalBalance(keysByYear) {
    for (const [year, keys] of Object.entries(keysByYear)) {
        const amount = await countBusinessReturned(keys);
        addManualBalance("legal", amount, Number(year));
    }
}

async function returnCompBalance(keysByYear) {
    for (const [year, keys] of Object.entries(keysByYear)) {
        const amount = await countBusinessReturned(keys);
        addManualBalance("comp", amount, Number(year), true);
    }
}

function returnAdminBalance(amountByYear) {
    Object.entries(amountByYear).forEach(([year, amount]) => {
        addManualBalance("admin", amount, Number(year));
    });
}

function pushKeyByYear(target, key) {
    const year = key.split("-")[0];

    if (!target[year]) target[year] = [];

    target[year].push(key);
}

export async function aplicarLicencia(
    fecha,
    cantidad,
    type = "license",
    options = {}
){
    const total = Number(cantidad);

    if (!total || total <= 0 || !Number.isInteger(total)) {
        return false;
    }

    const abs = getAbsences();
    const blocked = getBlockedDays();
    const admin = getAdminDays();
    const legal = getLegalDays();
    const comp = getCompDays();

    const startKey = keyFromDate(fecha);
    const keys = [];

    let d = new Date(fecha);

    for(let i=0;i<total;i++){

        const key = keyFromDate(d);

        if (!puedeReemplazarAusencia(abs[key], type)) {
            return false;
        }

        keys.push(key);

        d.setDate(d.getDate()+1);
    }

    const profile = getCurrentProfile();
    const label = absenceLabel(type);
    let mutationPrepared = false;
    const prepareMutation = async () => {
        if (mutationPrepared) return;

        mutationPrepared = true;

        if (typeof options.beforeMutation === "function") {
            await options.beforeMutation();
        }
    };
    const conflictCancellation =
        await confirmAndCancelScheduleConflicts(
            profile,
            keys,
            label,
            {
                cancelReplacements:
                    type === "license" ||
                    type === "professional_license",
                confirmDialog: options.confirmConflicts || showConfirm,
                beforeCancellation: prepareMutation
            }
        );

    if (!conflictCancellation) {
        return null;
    }

    await prepareMutation();

    const returnedLegal = {};
    const returnedComp = {};
    const returnedAdmin = {};
    const canceledLegalBlocks = new Set();
    const canceledCompBlocks = new Set();
    const licenseKeys = new Set(keys);

    keys.forEach(key => {
        const year = Number(key.split("-")[0]);

        if (
            legal[key] &&
            shouldCancelMappedBlock(legal, startKey, key)
        ) {
            const legalStart = blockStartKey(legal, key);

            if (!canceledLegalBlocks.has(legalStart)) {
                canceledLegalBlocks.add(legalStart);

                blockKeys(legal, key).forEach(blockKey => {
                    delete legal[blockKey];
                    pushKeyByYear(returnedLegal, blockKey);

                    if (!licenseKeys.has(blockKey)) {
                        delete blocked[blockKey];
                    }
                });
            }
        }

        if (
            comp[key] &&
            shouldCancelMappedBlock(comp, startKey, key)
        ) {
            const compStart = blockStartKey(comp, key);

            if (!canceledCompBlocks.has(compStart)) {
                canceledCompBlocks.add(compStart);

                blockKeys(comp, key).forEach(blockKey => {
                    delete comp[blockKey];
                    pushKeyByYear(returnedComp, blockKey);

                    if (!licenseKeys.has(blockKey)) {
                        delete blocked[blockKey];
                    }
                });
            }
        }

        if (
            admin[key] &&
            shouldCancelAdmin(admin, startKey, key)
        ) {
            const value = admin[key];
            const amount = value === 1 ? 1 : 0.5;

            delete admin[key];
            if (!licenseKeys.has(key)) {
                delete blocked[key];
            }

            returnedAdmin[year] =
                (returnedAdmin[year] || 0) + amount;
        }

        abs[key] = {
            type,
            previousType: getAbsenceType(abs[key]) || ""
        };
        blocked[key] = true;
    });

    await returnLegalBalance(returnedLegal);
    await returnCompBalance(returnedComp);
    returnAdminBalance(returnedAdmin);

    saveAdminDays(admin);
    saveLegalDays(legal);
    saveCompDays(comp);
    saveAbsences(abs);
    saveBlockedDays(blocked);

    addAuditLog(
        AUDIT_CATEGORY.LEAVE_ABSENCE,
        `Aplic\u00f3 ${label}`,
        `${profile}: ${total} d\u00eda(s) corridos desde ${formatKey(startKey)}.`,
        {
            profile,
            date: isoFromKey(startKey),
            keys,
            amount: total,
            type,
            canceledReplacementIds:
                conflictCancellation.canceledReplacements.map(
                    replacement => replacement.id
                ),
            canceledSwapIds:
                conflictCancellation.canceledSwaps.map(swap => swap.id)
        }
    );

    if (type === "unpaid_leave") {
        createLeaveMemoTask({
            profile: getCurrentProfile(),
            typeLabel: "Permiso sin goce",
            amount: total,
            startKey,
            endKey: keys[keys.length - 1],
            sourceType: "unpaid_leave"
        });
    }

    return true;
}
