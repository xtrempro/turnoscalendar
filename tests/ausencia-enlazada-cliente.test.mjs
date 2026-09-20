// La mitad CLIENTE de usar la ausencia de otra unidad.
//
// La aritmetica de agrupado ya se prueba de verdad en
// tests/opciones-ausencia-enlazada.test.mjs. Aqui se fija el CABLEADO, que es
// lo que se desarma en silencio:
//
//   - que al elegir una ausencia ajena NO se cree ningun contrato;
//   - que a los candidatos ajenos se les apliquen las mismas reglas que a los
//     propios (mismo estamento y que el permiso cubra la fecha);
//   - que el resolvedor vea las ausencias ajenas, o el cuadro borraria la
//     seleccion solo y el guardado la rechazaria;
//   - que autorizar y rechazar llamen a lo que dicen llamar.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const leer = async name => (await readFile(
    new URL(name, import.meta.url), "utf8"
)).replace(/\r\n/g, "\n");

const main = await leer("../js/main.js");
const shell = await leer("../js/firebaseShell.js");
const wrapper = await leer("../js/firebaseInterUnitAbsences.js");

/* =========================================================
   Elegir una ausencia ajena NO crea contrato
========================================================= */

test("con una ausencia de otra unidad se PIDE permiso, no se guarda", () => {
    assert.match(
        main,
        /if \(selectedLeave\.linkedUnit && !selectedLeave\.linkedUnit\.approved\) \{/
    );
    assert.match(
        main,
        /await requestInterUnitAbsence\(\{\s*\n\s*ownerWorkspaceId: unidad\.workspaceId,/
    );
});

test("pero una YA AUTORIZADA sigue de largo y crea el contrato", () => {
    // Es el ultimo paso del flujo. Sin la condicion de `approved`, confirmar el
    // contrato prellenado mandaria una solicitud duplicada, el servidor la
    // rechazaria por repetida y el contrato no existiria nunca.
    assert.match(main, /!selectedLeave\.linkedUnit\.approved/);
    assert.match(main, /approved: true/);
    assert.match(
        main,
        /function createContractFromApprovedAbsence\(solicitud = \{\}\)/
    );
});

test("y el guardado se corta ANTES de crear el contrato", () => {
    // Si esta salida temprana desapareciera, se crearia el contrato sin que la
    // otra unidad haya autorizado nada: exactamente lo que este flujo evita.
    //
    // Se comparan POSICIONES sobre el archivo completo, sin recortar una
    // ventana de N caracteres: esa ventana se desbordaba a lo que viniera
    // despues y ademas media algo indirecto.
    const desde = main.indexOf(
        "if (selectedLeave.linkedUnit && !selectedLeave.linkedUnit.approved) {"
    );

    assert.ok(desde > 0, "sigue estando la rama de ausencia ajena");

    const cierra = main.indexOf("close();", desde);
    const guarda = main.indexOf("saveReplacementContractFromDraft", desde);

    assert.ok(cierra > desde, "la rama ajena cierra el cuadro");
    assert.ok(
        cierra < guarda,
        "la salida va antes de cualquier guardado de contrato"
    );
    assert.match(
        main.slice(desde, cierra + 40),
        /close\(\);\s*\n\s*return;/
    );
});

test("se avisa que el contrato queda esperando", () => {
    assert.match(main, /El contrato se creará cuando la autoricen/);
});

test("la rotativa elegida viaja con la solicitud", () => {
    // Es lo que el supervisor decide al pedirla; si no viajara, la otra unidad
    // autorizaria algo distinto de lo que se le mostro.
    assert.match(main, /rotationMode: normalizeReplacementRotationMode\(/);
});

/* =========================================================
   Los candidatos ajenos juegan con las mismas reglas
========================================================= */

test("mismo estamento, igual que los locales", () => {
    assert.match(
        main,
        /String\(option\.linkedUnit\?\.estamento \|\| ""\)\s*\n\s*\.trim\(\)\s*\n\s*\.toLowerCase\(\) === miEstamento/
    );
});

test("y el permiso tiene que cubrir la fecha", () => {
    assert.match(
        main,
        /option\.start <= contractCoverISO &&\s*\n\s*option\.end >= contractCoverISO/
    );
});

test("cada opcion ajena queda marcada con su unidad de origen", () => {
    // Sin esa marca, al guardar no se sabria a que unidad pedirle permiso.
    assert.match(
        main,
        /linkedUnit: \{\s*\n\s*workspaceId: unit\.workspaceId,\s*\n\s*workspaceName: unit\.workspaceName,\s*\n\s*linkId: unit\.linkId,\s*\n\s*estamento: worker\.estamento/
    );
});

/* =========================================================
   El resolvedor tiene que verlas
========================================================= */

test("un trabajador ajeno no esta en getProfiles y aun asi resuelve", () => {
    // Es la trampa: la salida temprana por "perfil no encontrado" dejaria sin
    // resolver toda ausencia ajena, y el cuadro limpia lo que no resuelve.
    assert.match(main, /if \(!profile\) return linked;/);
});

test("y conviven con las propias en la misma lista", () => {
    assert.match(main, /\.concat\(linked\)/);
});

test("una ausencia ya usada no se ofrece, venga de donde venga", () => {
    assert.match(
        main,
        /getLinkedAbsenceOptions\(profileName\)\s*\n\s*\.filter\(option => !isReplacementLeaveOptionUsed\(option\)\)/
    );
});

/* =========================================================
   La busqueda
========================================================= */

test("hay un boton para buscar en unidades enlazadas", () => {
    assert.match(main, /data-action="search-linked-absences"/);
    assert.match(main, /if \(action === "search-linked-absences"\) \{/);
});

test("cada busqueda reemplaza a la anterior", () => {
    // Acumular dejaria a la vista ausencias de una busqueda vieja, que pueden
    // haber sido tomadas por otra unidad mientras tanto.
    assert.match(main, /linkedAbsenceOptions\.clear\(\);/);
});

test("el agrupado usa el MISMO modulo que las ausencias propias", () => {
    // Si se agrupara distinto, los identificadores no calzarian y el control
    // de "ya esta ocupada" se rompe en silencio.
    assert.match(main, /optionsFromLeaveKeysByType\(\{/);
    assert.match(main, /toInputDate: calendarKeyToInputDate/);
});

/* =========================================================
   Autorizar en la otra unidad
========================================================= */

test("las solicitudes viven junto a los enlaces, en el mismo panel", () => {
    assert.match(shell, /absenceRequests: \[\]/);
    assert.match(shell, /linkedUnitState\.absenceRequests =\s*\n\s*await listInterUnitAbsenceRequests\(\);/);
});

test("una lectura que falle no borra la otra", () => {
    // Son dos consultas distintas: que caiga la de solicitudes no tiene por
    // que dejar en blanco la lista de unidades enlazadas.
    //
    // Se afirma la ESTRUCTURA, no un conteo de `try` en una ventana de N
    // caracteres: ese conteo se desbordaba a la funcion siguiente y ademas
    // medía algo indirecto. Lo que importa es que la carga de solicitudes
    // tenga su propio try y que su catch solo vacie lo suyo.
    assert.match(
        shell,
        /try \{\s*\n\s*linkedUnitState\.absenceRequests =\s*\n\s*await listInterUnitAbsenceRequests\(\);\s*\n\s*\} catch \(error\) \{\s*\n\s*linkedUnitState\.absenceRequests = \[\];/
    );
    // Y el catch de los enlaces no toca las solicitudes.
    assert.match(
        shell,
        /\} catch \(error\) \{\s*\n\s*linkedUnitState\.links = \[\];\s*\n\s*linkedUnitState\.message =/
    );
});

test("autorizar y rechazar llaman a lo que dicen", () => {
    assert.match(shell, /data-action="approve-absence-request"/);
    assert.match(shell, /data-action="reject-absence-request"/);
    assert.match(shell, /status: "approved"/);
    assert.match(shell, /status: "rejected"/);
});

test("autorizar se confirma: deja el permiso ocupado para siempre", () => {
    assert.match(shell, /title: "Autorizar uso del permiso"/);
    assert.match(
        shell,
        /Ese permiso quedara ocupado y ya no podras usarlo para un contrato de tu unidad/
    );
});

test("responder refresca el panel, o el clic no se veria", () => {
    const desde = shell.indexOf('if (action === "approve-absence-request")');
    const bloque = shell.slice(desde, desde + 1800);

    assert.match(bloque, /await refreshLinkedUnits\(\);/);
    assert.match(bloque, /renderSignedInModal\(backdrop\);/);
});

/* =========================================================
   El envoltorio
========================================================= */

test("las solicitudes se leen directo de Firestore, sin callable", () => {
    // Las reglas ya permiten leer a las dos unidades; un callable seria un
    // rodeo sin nada que aportar.
    assert.match(
        wrapper,
        /firestoreModule\.collection\(db, "interUnitAbsenceRequests"\)/
    );
    assert.match(wrapper, /where\("ownerWorkspaceId", "==", workspace\.id\)/);
    assert.match(wrapper, /where\("requesterWorkspaceId", "==", workspace\.id\)/);
});

test("lo que cruza unidades sí pasa por el servidor", () => {
    assert.match(wrapper, /callFunction\("findLinkedUnitAbsences"/);
    assert.match(wrapper, /callFunction\("createInterUnitAbsenceRequest"/);
    assert.match(wrapper, /callFunction\("respondInterUnitAbsenceRequest"/);
});
