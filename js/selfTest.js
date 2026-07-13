// Auto-pruebas de reglas basicas, ejecutables a demanda SOLO en el entorno de
// pruebas (turnoplus-test-7c4d9). Corren aisladas: se toma un snapshot del
// localStorage y se suprimen los eventos de persistencia (sin sync a Firebase),
// se ejecuta cada prueba sobre un perfil ficticio y al terminar se restaura todo
// exactamente como estaba. La misma funcion runBasicRulesSelfTest se usa en Node
// (CI) sin la UI.

import { IS_TEST_ENVIRONMENT } from "./firebaseConfig.js";
import {
    exportLocalSnapshot,
    replaceLocalSnapshot,
    runWithoutPersistenceEvents,
    listKeys,
    removeKey,
    setJSON
} from "./persistence.js";
import {
    getCurrentProfile,
    getSwaps,
    setCurrentProfile,
    saveProfiles,
    saveRotativa,
    saveBaseProfileData,
    saveProfileDayTurn,
    saveSwaps,
    saveTurnChangeConfig,
    getAdminDays,
    getLegalDays,
    getCompDays,
    getReplacements,
    profileCanCoverProfile
} from "./storage.js";
import {
    aplicarCambiosTurno,
    getProtectedDirectEditTurn,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import {
    getRotationSequence,
    rotationPositionLabel
} from "./rotationUtils.js";
import { freezePriorRotationSchedule } from "./rotationFreeze.js";
import {
    aplicarLegal,
    aplicarAdministrativo,
    aplicarComp
} from "./leaveEngine.js";
import {
    moveShiftConfigBlockReason,
    moveShiftTargetCombina24
} from "./rulesEngine.js";
import { keyFromDate } from "./dateUtils.js";
import { TURNO } from "./constants.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    canSwapProfiles,
    getSwapDateBlockReason,
    getEligibleSwapReceivers,
    registrarCambio
} from "./swaps.js";
import {
    cancelFutureReplacementsForWorker,
    saveReplacement
} from "./replacements.js";
import {
    cancelFutureShiftMovesForWorker,
    getShiftMoves,
    registerShiftMove
} from "./shiftMoves.js";
import { getEmailValidationMessage } from "./emailUtils.js";

const FAKE_PROFILE = "__selftest__";
const FAKE_SWAP_RECEIVER = "__receiver___selftest__";
const FAKE_SWAP_SAME_TURN = "__same_turn___selftest__";
const FAKE_SWAP_ABSENT = "__absent___selftest__";
const FAKE_SWAP_OTHER_ROLE = "__other_role___selftest__";
const FAKE_SWAP_PROFILES = [
    FAKE_PROFILE,
    FAKE_SWAP_RECEIVER,
    FAKE_SWAP_SAME_TURN,
    FAKE_SWAP_ABSENT,
    FAKE_SWAP_OTHER_ROLE
];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} (esperado ${expected}, obtenido ${actual})`);
    }
}

function key(year, monthIndex, day) {
    return keyFromDate(new Date(year, monthIndex, day));
}

// Limpia todas las claves del perfil ficticio para aislar cada prueba.
function resetFakeProfile() {
    listKeys().forEach(storageKey => {
        if (
            FAKE_SWAP_PROFILES.some(profile =>
                storageKey.endsWith(profile)
            )
        ) {
            removeKey(storageKey);
        }
    });
}

function selfTestProfile(name, profession = "Enfermería") {
    return {
        name,
        estamento: "Profesional",
        profession,
        contractType: "Planta",
        active: true
    };
}

function setupSwapSelfTest() {
    const changeKey = key(2026, 5, 10);
    const returnKey = key(2026, 5, 12);

    saveProfiles([
        selfTestProfile(FAKE_PROFILE),
        selfTestProfile(FAKE_SWAP_RECEIVER),
        selfTestProfile(FAKE_SWAP_SAME_TURN),
        selfTestProfile(FAKE_SWAP_ABSENT),
        selfTestProfile(FAKE_SWAP_OTHER_ROLE, "Kinesiología")
    ]);
    saveTurnChangeConfig({
        allowSwaps: true,
        allowDifferentTurnTypes: true,
        allowTwentyFourHourShifts: true,
        allowInvertedTwentyFourHourShifts: true,
        limitMonthlySwaps: false
    });
    saveSwaps([]);
    saveBaseProfileData({
        [changeKey]: TURNO.LARGA,
        [returnKey]: TURNO.LIBRE
    }, FAKE_PROFILE);
    saveBaseProfileData({
        [changeKey]: TURNO.LIBRE,
        [returnKey]: TURNO.NOCHE
    }, FAKE_SWAP_RECEIVER);
    saveBaseProfileData({ [changeKey]: TURNO.LARGA }, FAKE_SWAP_SAME_TURN);
    saveBaseProfileData({ [changeKey]: TURNO.LIBRE }, FAKE_SWAP_ABSENT);
    saveBaseProfileData({ [changeKey]: TURNO.LIBRE }, FAKE_SWAP_OTHER_ROLE);
    setJSON(`absences_${FAKE_SWAP_ABSENT}`, {
        [changeKey]: { type: "license" }
    });

    return { changeKey, returnKey };
}

function hasEligibleSwapReceiver(giver, keyDay, receiver) {
    return getEligibleSwapReceivers(giver, keyDay)
        .some(profile => profile.name === receiver);
}

const TESTS = [
    {
        name: "Rotativa 4to turno: secuencia base correcta",
        run() {
            saveRotativa(
                { type: "4turno", start: "2026-01-01", firstTurn: "larga" },
                FAKE_PROFILE
            );
            const seq = getRotationSequence("4turno", "larga"); // [1,2,0,0]

            for (let i = 0; i < 8; i++) {
                assertEqual(
                    getTurnoBase(FAKE_PROFILE, key(2026, 0, 1 + i)),
                    seq[i % seq.length],
                    `4turno dia ${i + 1}`
                );
            }
        }
    },
    {
        name: "Rotativa 3er turno: secuencia base correcta",
        run() {
            saveRotativa(
                { type: "3turno", start: "2026-01-01", firstTurn: "larga" },
                FAKE_PROFILE
            );
            const seq = getRotationSequence("3turno", "larga"); // [1,1,2,2,0,0]

            for (let i = 0; i < 12; i++) {
                assertEqual(
                    getTurnoBase(FAKE_PROFILE, key(2026, 0, 1 + i)),
                    seq[i % seq.length],
                    `3turno dia ${i + 1}`
                );
            }
        }
    },
    {
        name: "Rotativa diurno: habil trabajado, fin de semana libre",
        run() {
            saveRotativa(
                { type: "diurno", start: "2026-01-01", firstTurn: "larga" },
                FAKE_PROFILE
            );
            // 2026-06-10 miercoles (habil) -> DIURNO; 2026-06-13 sabado -> LIBRE.
            assertEqual(
                getTurnoBase(FAKE_PROFILE, key(2026, 5, 10)),
                TURNO.DIURNO,
                "miercoles deberia ser diurno"
            );
            assertEqual(
                getTurnoBase(FAKE_PROFILE, key(2026, 5, 13)),
                TURNO.LIBRE,
                "sabado deberia ser libre"
            );
        }
    },
    {
        name: "Nueva rotativa NO borra los turnos anteriores a la fecha",
        run() {
            saveRotativa(
                { type: "4turno", start: "2026-01-01", firstTurn: "larga" },
                FAKE_PROFILE
            );
            const priorKey = key(2026, 0, 1); // dia trabajado bajo la rotativa

            assert(
                getTurnoBase(FAKE_PROFILE, priorKey) !== TURNO.LIBRE,
                "precondicion: el dia anterior deberia estar trabajado"
            );

            // Congela el tramo previo y reubica el inicio hacia adelante.
            freezePriorRotationSchedule("2026-02-01");
            saveRotativa(
                { type: "4turno", start: "2026-02-01", firstTurn: "larga" },
                FAKE_PROFILE
            );

            assert(
                getTurnoBase(FAKE_PROFILE, priorKey) !== TURNO.LIBRE,
                "el turno anterior a la fecha se borro al mover la rotativa"
            );
            // El nuevo inicio arranca la rotativa (larga).
            assertEqual(
                getTurnoBase(FAKE_PROFILE, key(2026, 1, 1)),
                TURNO.LARGA,
                "el nuevo inicio deberia arrancar la rotativa"
            );
        }
    },
    {
        name: "Nueva rotativa anula turnos extras y motivos futuros",
        run() {
            // Un motivo/turno extra manual antes y otro despues del corte.
            saveReplacement({
                worker: FAKE_PROFILE,
                keyDay: key(2026, 0, 15),
                turno: TURNO.LARGA,
                reason: "Motivo previo",
                source: "manual_extra",
                addsShift: false
            });
            saveReplacement({
                worker: FAKE_PROFILE,
                keyDay: key(2026, 2, 15),
                turno: TURNO.LARGA,
                reason: "Motivo futuro",
                source: "manual_extra",
                addsShift: false
            });

            cancelFutureReplacementsForWorker(FAKE_PROFILE, "2026-02-01");

            const mine = getReplacements()
                .filter(replacement => replacement.worker === FAKE_PROFILE);
            const previo = mine.find(r => r.date === "2026-01-15");
            const futuro = mine.find(r => r.date === "2026-03-15");

            assert(
                previo && previo.canceled !== true,
                "el turno extra anterior a la fecha no debe anularse"
            );
            assert(
                futuro && futuro.canceled === true,
                "el turno extra/motivo futuro deberia quedar anulado"
            );
        }
    },
    {
        name: "Nueva rotativa elimina turnos movidos (TTMM) futuros",
        run() {
            // Un turno movido antes del corte y otro despues.
            registerShiftMove({
                profile: FAKE_PROFILE,
                sourceKey: key(2026, 0, 10),
                targetKey: key(2026, 0, 12),
                sourceTurn: TURNO.LARGA,
                destinationTurn: TURNO.NOCHE
            });
            registerShiftMove({
                profile: FAKE_PROFILE,
                sourceKey: key(2026, 2, 10),
                targetKey: key(2026, 2, 12),
                sourceTurn: TURNO.LARGA,
                destinationTurn: TURNO.NOCHE
            });

            cancelFutureShiftMovesForWorker(FAKE_PROFILE, new Date(2026, 1, 1));

            const mine = getShiftMoves()
                .filter(move => move.profile === FAKE_PROFILE);
            const previo = mine.some(m => m.sourceKey === key(2026, 0, 10));
            const futuro = mine.some(m => m.sourceKey === key(2026, 2, 10));

            assert(
                previo,
                "el turno movido anterior a la fecha no debe eliminarse"
            );
            assert(
                !futuro,
                "el turno movido futuro deberia eliminarse"
            );
        }
    },
    {
        name: "Mover turno: respeta bloqueos de 24 y 24 invertido",
        run() {
            const combines24 = moveShiftTargetCombina24(
                TURNO.LARGA,
                TURNO.NOCHE,
                TURNO.NOCHE,
                TURNO.NOCHE
            );

            assert(
                combines24,
                "larga movida sobre noche deberia detectarse como 24"
            );
            assert(
                moveShiftConfigBlockReason({
                    combines24,
                    projectedTurn: TURNO.TURNO24,
                    allowTwentyFourHourShifts: false,
                    allowInvertedTwentyFourHourShifts: true
                }).includes("turnos 24"),
                "si el 24 esta deshabilitado, no deberia permitir juntar larga+noche"
            );
            assert(
                moveShiftConfigBlockReason({
                    combines24: false,
                    projectedTurn: TURNO.NOCHE,
                    nextTurn: TURNO.LARGA,
                    allowTwentyFourHourShifts: true,
                    allowInvertedTwentyFourHourShifts: false
                }).includes("24 invertido"),
                "si el 24 invertido esta deshabilitado, no deberia permitir noche antes de larga"
            );
            assertEqual(
                moveShiftConfigBlockReason({
                    combines24: false,
                    projectedTurn: TURNO.NOCHE,
                    nextTurn: TURNO.LIBRE,
                    allowTwentyFourHourShifts: true,
                    allowInvertedTwentyFourHourShifts: false
                }),
                "",
                "noche movida antes de dia libre no deberia bloquearse por 24 invertido"
            );
        }
    },
    {
        name: "Validador de formato de correo del perfil",
        run() {
            assertEqual(
                getEmailValidationMessage(""),
                "",
                "correo vacio es valido (opcional)"
            );
            assertEqual(
                getEmailValidationMessage("ana@clinica.cl"),
                "",
                "correo bien formado deberia aceptarse"
            );
            assert(
                getEmailValidationMessage("ana@clinica") !== "",
                "sin dominio .xx deberia rechazarse"
            );
            assert(
                getEmailValidationMessage("anaclinica.cl") !== "",
                "sin @ deberia rechazarse"
            );
            assert(
                getEmailValidationMessage("ana @clinica.cl") !== "",
                "con espacio deberia rechazarse"
            );
        }
    },
    {
        name: "Etiqueta de posicion del reemplazo (primer/segundo libre, etc.)",
        run() {
            assertEqual(
                rotationPositionLabel(TURNO.LIBRE, 1),
                "Primer libre",
                "primer libre"
            );
            assertEqual(
                rotationPositionLabel(TURNO.LIBRE, 2),
                "Segundo libre",
                "segundo libre"
            );
            assertEqual(
                rotationPositionLabel(TURNO.LARGA, 1),
                "Primera larga",
                "primera larga"
            );
            assertEqual(
                rotationPositionLabel(TURNO.LARGA, 2),
                "Segunda larga",
                "segunda larga"
            );
            assertEqual(
                rotationPositionLabel(TURNO.NOCHE, 1),
                "Primera noche",
                "primera noche"
            );
            assertEqual(
                rotationPositionLabel(TURNO.NOCHE, 2),
                "Segunda noche",
                "segunda noche"
            );
        }
    },
    {
        name: "Aplica P. Administrativo sobre un turno largo",
        async run() {
            saveBaseProfileData({ [key(2026, 5, 10)]: TURNO.LARGA }, FAKE_PROFILE);

            const ok = await aplicarAdministrativo(new Date(2026, 5, 10), 1);

            assert(ok === true, `aplicarAdministrativo devolvio ${ok}`);
            assertEqual(
                getAdminDays()[key(2026, 5, 10)],
                1,
                "el dia no quedo marcado como administrativo"
            );
        }
    },
    {
        name: "Aplica F. Legal (bloque de 10 dias habiles)",
        async run() {
            const ok = await aplicarLegal(new Date(2026, 5, 10), 10);

            assert(ok === true, `aplicarLegal devolvio ${ok}`);
            assertEqual(
                getLegalDays()[key(2026, 5, 10)],
                true,
                "el dia no quedo marcado como F. Legal"
            );
        }
    },
    {
        name: "Aplica F. Compensatorio (bloque de 10 dias habiles)",
        async run() {
            const ok = await aplicarComp(new Date(2026, 5, 10), 10);

            assert(ok === true, `aplicarComp devolvio ${ok}`);
            assertEqual(
                getCompDays()[key(2026, 5, 10)],
                true,
                "el dia no quedo marcado como F. Compensatorio"
            );
        }
    },
    {
        name: "F. Legal rechaza una cantidad invalida",
        async run() {
            const ok = await aplicarLegal(new Date(2026, 5, 10), 0);
            assert(ok === false, "F. Legal con cantidad 0 deberia rechazarse");
        }
    },
    {
        name: "Reemplazo: misma profesion/estamento es compatible",
        run() {
            assert(
                profileCanCoverProfile(
                    { estamento: "Profesional", profession: "Enfermería" },
                    { estamento: "Profesional", profession: "Enfermería" }
                ) === true,
                "misma profesion deberia ser compatible"
            );
            assert(
                profileCanCoverProfile(
                    { estamento: "Auxiliar" },
                    { estamento: "Auxiliar" }
                ) === true,
                "mismo estamento (auxiliar) deberia ser compatible"
            );
        }
    },
    {
        name: "Reemplazo: distinta profesion/estamento NO es compatible",
        run() {
            assert(
                profileCanCoverProfile(
                    { estamento: "Profesional", profession: "Enfermería" },
                    { estamento: "Profesional", profession: "Kinesiología" }
                ) === false,
                "distinta profesion no deberia ser compatible"
            );
            assert(
                profileCanCoverProfile(
                    { estamento: "Auxiliar" },
                    { estamento: "Profesional", profession: "Enfermería" }
                ) === false,
                "distinto estamento no deberia ser compatible"
            );
        }
    },
    {
        name: "Edicion directa: protege turno extra de reemplazo",
        run() {
            const changeKey = key(2026, 6, 6);

            saveProfiles([
                selfTestProfile(FAKE_PROFILE),
                selfTestProfile(FAKE_SWAP_RECEIVER)
            ]);
            saveTurnChangeConfig({
                allowSwaps: true,
                allowDifferentTurnTypes: true,
                allowTwentyFourHourShifts: true,
                allowInvertedTwentyFourHourShifts: true,
                limitMonthlySwaps: false
            });
            setJSON("replacements", []);
            saveBaseProfileData({
                [changeKey]: TURNO.LIBRE
            }, FAKE_PROFILE);
            saveReplacement({
                worker: FAKE_PROFILE,
                replaced: FAKE_SWAP_RECEIVER,
                keyDay: changeKey,
                turno: TURNO.NOCHE,
                absenceType: "P. Administrativo",
                source: "replacement"
            });

            const current = () => aplicarCambiosTurno(
                FAKE_PROFILE,
                changeKey,
                getTurnoProgramado(FAKE_PROFILE, changeKey)
            );

            assertEqual(
                current(),
                TURNO.NOCHE,
                "el reemplazo nocturno deberia mostrarse como turno protegido"
            );

            const firstClick = getProtectedDirectEditTurn(
                FAKE_PROFILE,
                changeKey,
                current(),
                true,
                { effectiveBaseTurn: TURNO.LIBRE }
            );

            assertEqual(
                firstClick.nextVisibleTurn,
                TURNO.TURNO24,
                "primer click deberia completar 24 visible"
            );
            assertEqual(
                firstClick.nextStoredTurn,
                TURNO.LARGA,
                "solo deberia guardarse el complemento larga"
            );
            saveProfileDayTurn(
                changeKey,
                firstClick.nextStoredTurn,
                FAKE_PROFILE
            );
            assertEqual(
                current(),
                TURNO.TURNO24,
                "el calendario deberia fusionar larga manual + noche de reemplazo"
            );

            const secondClick = getProtectedDirectEditTurn(
                FAKE_PROFILE,
                changeKey,
                current(),
                true,
                { effectiveBaseTurn: TURNO.LIBRE }
            );

            assertEqual(
                secondClick.nextVisibleTurn,
                TURNO.DIURNO_NOCHE,
                "segundo click deberia permitir D+N en dia habil"
            );
            assertEqual(
                secondClick.nextStoredTurn,
                TURNO.DIURNO,
                "solo deberia guardarse el complemento diurno"
            );
            saveProfileDayTurn(
                changeKey,
                secondClick.nextStoredTurn,
                FAKE_PROFILE
            );

            const thirdClick = getProtectedDirectEditTurn(
                FAKE_PROFILE,
                changeKey,
                current(),
                true,
                { effectiveBaseTurn: TURNO.LIBRE }
            );

            assertEqual(
                thirdClick.nextVisibleTurn,
                TURNO.NOCHE,
                "el ciclo puede quitar el complemento manual, pero no el reemplazo"
            );
            assertEqual(
                thirdClick.nextStoredTurn,
                TURNO.LIBRE,
                "al volver al reemplazo puro no debe guardarse el turno de reemplazo como manual"
            );
            saveProfileDayTurn(
                changeKey,
                thirdClick.nextStoredTurn,
                FAKE_PROFILE
            );
            assertEqual(
                current(),
                TURNO.NOCHE,
                "el reemplazo debe seguir visible tras quitar el complemento manual"
            );
            assert(
                getReplacements().some(replacement =>
                    replacement.worker === FAKE_PROFILE &&
                    replacement.canceled !== true
                ),
                "el reemplazo no deberia quedar cancelado por la edicion directa"
            );
        }
    },
    {
        name: "Cambio de turno: exige trabajadores compatibles",
        run() {
            setupSwapSelfTest();

            assert(
                canSwapProfiles(FAKE_PROFILE, FAKE_SWAP_RECEIVER) === true,
                "misma profesion y estamento deberian permitir el cambio"
            );
            assert(
                canSwapProfiles(FAKE_PROFILE, FAKE_SWAP_OTHER_ROLE) === false,
                "distinta profesion no deberia permitir el cambio"
            );
        }
    },
    {
        name: "Cambio de turno: filtra quien puede recibir el turno elegido",
        run() {
            const { changeKey } = setupSwapSelfTest();
            const receivers = getEligibleSwapReceivers(
                FAKE_PROFILE,
                changeKey
            ).map(profile => profile.name);

            assertEqual(
                receivers.length,
                1,
                "deberia quedar un solo receptor habilitado"
            );
            assertEqual(
                receivers[0],
                FAKE_SWAP_RECEIVER,
                "se habilito un receptor con turno o ausencia incompatible"
            );
        }
    },
    {
        name: "Cambio de turno: bloquea turno 24 si la unidad lo prohibe",
        run() {
            const { changeKey } = setupSwapSelfTest();

            saveTurnChangeConfig({
                allowSwaps: true,
                allowDifferentTurnTypes: true,
                allowTwentyFourHourShifts: false,
                allowInvertedTwentyFourHourShifts: true,
                limitMonthlySwaps: false
            });
            saveBaseProfileData({
                [changeKey]: TURNO.LARGA
            }, FAKE_PROFILE);
            saveBaseProfileData({
                [changeKey]: TURNO.NOCHE
            }, FAKE_SWAP_RECEIVER);

            const reason = getSwapDateBlockReason({
                giver: FAKE_PROFILE,
                receiver: FAKE_SWAP_RECEIVER,
                keyDay: changeKey
            });

            assert(
                reason.includes("turno 24") &&
                    !reason.includes("24 invertido"),
                "deberia bloquear el receptor que quedaria con 24 normal"
            );
            assert(
                !hasEligibleSwapReceiver(
                    FAKE_PROFILE,
                    changeKey,
                    FAKE_SWAP_RECEIVER
                ),
                "el receptor con 24 prohibido no deberia aparecer en el combobox"
            );
        }
    },
    {
        name: "Cambio de turno: bloquea 24 invertido si la unidad lo prohibe",
        run() {
            const { changeKey } = setupSwapSelfTest();
            const nextKey = key(2026, 5, 11);

            saveTurnChangeConfig({
                allowSwaps: true,
                allowDifferentTurnTypes: true,
                allowTwentyFourHourShifts: true,
                allowInvertedTwentyFourHourShifts: false,
                limitMonthlySwaps: false
            });
            saveBaseProfileData({
                [changeKey]: TURNO.NOCHE
            }, FAKE_PROFILE);
            saveBaseProfileData({
                [changeKey]: TURNO.LIBRE,
                [nextKey]: TURNO.LARGA
            }, FAKE_SWAP_RECEIVER);

            const reason = getSwapDateBlockReason({
                giver: FAKE_PROFILE,
                receiver: FAKE_SWAP_RECEIVER,
                keyDay: changeKey
            });

            assert(
                reason.includes("24 invertido"),
                "deberia bloquear al receptor que cubriria noche antes de larga"
            );
            assert(
                !hasEligibleSwapReceiver(
                    FAKE_PROFILE,
                    changeKey,
                    FAKE_SWAP_RECEIVER
                ),
                "el receptor con 24 invertido prohibido no deberia aparecer en el combobox"
            );
        }
    },
    {
        name: "Cambio de turno: permite noche si el dia siguiente queda libre",
        run() {
            const { changeKey } = setupSwapSelfTest();
            const nextKey = key(2026, 5, 11);

            saveTurnChangeConfig({
                allowSwaps: true,
                allowDifferentTurnTypes: true,
                allowTwentyFourHourShifts: true,
                allowInvertedTwentyFourHourShifts: false,
                limitMonthlySwaps: false
            });
            saveBaseProfileData({
                [changeKey]: TURNO.NOCHE
            }, FAKE_PROFILE);
            saveBaseProfileData({
                [changeKey]: TURNO.LIBRE,
                [nextKey]: TURNO.LIBRE
            }, FAKE_SWAP_RECEIVER);

            assertEqual(
                getSwapDateBlockReason({
                    giver: FAKE_PROFILE,
                    receiver: FAKE_SWAP_RECEIVER,
                    keyDay: changeKey
                }),
                "",
                "si el dia siguiente queda libre no deberia bloquearse como 24 invertido"
            );
            assert(
                hasEligibleSwapReceiver(
                    FAKE_PROFILE,
                    changeKey,
                    FAKE_SWAP_RECEIVER
                ),
                "el receptor deberia aparecer si ya no tiene larga al dia siguiente"
            );
        }
    },
    {
        name: "Cambio de turno: aplica entrega y devolucion en ambos calendarios",
        run() {
            const { changeKey, returnKey } = setupSwapSelfTest();

            registrarCambio({
                from: FAKE_PROFILE,
                to: FAKE_SWAP_RECEIVER,
                fecha: "2026-06-10",
                devolucion: "2026-06-12",
                turno: "L",
                turnoDevuelto: "N",
                year: 2026,
                month: 5
            });

            assertEqual(
                getSwaps().length,
                1,
                "el cambio no quedo registrado"
            );
            assertEqual(
                aplicarCambiosTurno(
                    FAKE_PROFILE,
                    changeKey,
                    getTurnoProgramado(FAKE_PROFILE, changeKey)
                ),
                TURNO.LIBRE,
                "quien entrega deberia quedar libre en la fecha del cambio"
            );
            assertEqual(
                aplicarCambiosTurno(
                    FAKE_SWAP_RECEIVER,
                    changeKey,
                    getTurnoProgramado(FAKE_SWAP_RECEIVER, changeKey)
                ),
                TURNO.LARGA,
                "quien recibe no obtuvo el turno entregado"
            );
            assertEqual(
                aplicarCambiosTurno(
                    FAKE_SWAP_RECEIVER,
                    returnKey,
                    getTurnoProgramado(FAKE_SWAP_RECEIVER, returnKey)
                ),
                TURNO.LIBRE,
                "quien devuelve deberia quedar libre en la devolucion"
            );
            assertEqual(
                aplicarCambiosTurno(
                    FAKE_PROFILE,
                    returnKey,
                    getTurnoProgramado(FAKE_PROFILE, returnKey)
                ),
                TURNO.NOCHE,
                "quien recibe la devolucion no obtuvo el turno"
            );
        }
    }
];

// Corre todas las pruebas aisladas y devuelve el resumen. No depende del DOM.
export async function runBasicRulesSelfTest() {
    const snapshot = exportLocalSnapshot();
    const previousProfile = getCurrentProfile();
    const results = [];

    try {
        await runWithoutPersistenceEvents(async () => {
            for (const testCase of TESTS) {
                resetFakeProfile();
                setCurrentProfile(FAKE_PROFILE);

                try {
                    await testCase.run();
                    results.push({ name: testCase.name, ok: true });
                } catch (error) {
                    results.push({
                        name: testCase.name,
                        ok: false,
                        error: error?.message || String(error)
                    });
                }
            }
        });
    } finally {
        // Restaura el localStorage exacto (borra las claves del perfil ficticio)
        // y el perfil activo real. Silencioso: no dispara sync.
        replaceLocalSnapshot(snapshot, { silent: true });
        setCurrentProfile(previousProfile);
    }

    const failed = results.filter(item => !item.ok).length;

    return {
        total: results.length,
        passed: results.length - failed,
        failed,
        results
    };
}

// ---------------------------------------------------------------------------
// UI (solo entorno de pruebas): boton flotante + modal de resultados.

function renderSelfTestResults({ total, passed, failed, results }) {
    const backdrop = document.createElement("div");
    backdrop.className = "turn-change-dialog-backdrop";
    backdrop.innerHTML = `
        <section class="turn-change-dialog selftest-dialog" role="dialog" aria-modal="true" aria-labelledby="selfTestTitle">
            <strong id="selfTestTitle">Auto-pruebas de reglas basicas</strong>
            <p class="selftest-summary ${failed ? "is-fail" : "is-ok"}">
                ${passed}/${total} pruebas OK${failed ? ` — ${failed} con error` : ""}
            </p>
            <div class="selftest-list">
                ${results.map(item => `
                    <div class="selftest-row ${item.ok ? "is-ok" : "is-fail"}">
                        <span class="selftest-mark">${item.ok ? "✓" : "✗"}</span>
                        <span class="selftest-name">${escapeHTML(item.name)}</span>
                        ${item.ok ? "" : `<span class="selftest-error">${escapeHTML(item.error || "")}</span>`}
                    </div>
                `).join("")}
            </div>
            <div class="turn-change-dialog__actions">
                <button class="primary-button" type="button" data-action="close">Cerrar</button>
            </div>
        </section>
    `;

    const close = () => backdrop.remove();

    backdrop.addEventListener("click", event => {
        if (event.target === backdrop) close();
    });
    backdrop
        .querySelector("[data-action='close']")
        ?.addEventListener("click", close);
    document.body.appendChild(backdrop);
}

async function openSelfTest(button) {
    const label = button.textContent;

    button.disabled = true;
    button.textContent = "Ejecutando...";

    try {
        const result = await runBasicRulesSelfTest();
        renderSelfTestResults(result);
    } catch (error) {
        alert(`No se pudieron ejecutar las auto-pruebas: ${error?.message || error}`);
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

// Inyecta el boton flotante solo en el sitio de pruebas.
export function initSelfTestButton() {
    if (
        !IS_TEST_ENVIRONMENT ||
        typeof document === "undefined" ||
        !document.body ||
        document.getElementById("selfTestFab")
    ) {
        return;
    }

    const button = document.createElement("button");

    button.id = "selfTestFab";
    button.type = "button";
    button.className = "selftest-fab";
    button.textContent = "Auto-pruebas";
    button.title =
        "Ejecuta las auto-pruebas de reglas basicas (solo entorno de pruebas)";
    button.addEventListener("click", () => {
        void openSelfTest(button);
    });

    document.body.appendChild(button);
}
