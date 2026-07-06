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
    saveSwaps,
    saveTurnChangeConfig,
    getAdminDays,
    getLegalDays,
    getCompDays,
    profileCanCoverProfile
} from "./storage.js";
import {
    aplicarCambiosTurno,
    getTurnoBase,
    getTurnoProgramado
} from "./turnEngine.js";
import { getRotationSequence } from "./rotationUtils.js";
import { freezePriorRotationSchedule } from "./rotationFreeze.js";
import {
    aplicarLegal,
    aplicarAdministrativo,
    aplicarComp
} from "./leaveEngine.js";
import { keyFromDate } from "./dateUtils.js";
import { TURNO } from "./constants.js";
import { escapeHTML } from "./htmlUtils.js";
import {
    canSwapProfiles,
    getEligibleSwapReceivers,
    registrarCambio
} from "./swaps.js";

const FAKE_PROFILE = "__selftest__";
const FAKE_SWAP_RECEIVER = "__receiver___selftest__";
const FAKE_SWAP_SAME_TURN = "__same_turn___selftest__";
const FAKE_SWAP_ABSENT = "__absent___selftest__";
const FAKE_SWAP_OTHER_ROLE = "__other_role___selftest__";

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
        if (storageKey.endsWith(FAKE_PROFILE)) removeKey(storageKey);
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
