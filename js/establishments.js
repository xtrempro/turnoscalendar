// Establecimientos.
//
// Una unidad pertenece a un establecimiento, y dos unidades del MISMO
// establecimiento pueden pedirse el traslado de un trabajador aunque no esten
// enlazadas entre si. De eso depende que al crear un perfil se pueda avisar
// "esta persona ya estaba registrada en otra unidad del hospital".
//
// Por que es una lista cerrada y no texto libre: la deteccion compara
// establecimientos, y con texto libre conviven "HCV", "Hospital Claudio
// Vicuña" y "hospital claudio vicuna" sin que ninguno coincida con otro. Esa
// es exactamente la normalizacion que esto viene a resolver, asi que permitir
// escribir a mano la desharia el primer dia.
//
// Quien no encuentre el suyo elige "Sin indicar": su unidad funciona igual,
// simplemente no participa de la deteccion entre unidades hasta que se agregue
// a esta lista.

// Valor de "no pertenece a ninguno de la lista". Se guarda vacio a proposito:
// asi nunca coincide con otro, ni siquiera con otro "sin indicar".
export const ESTABLISHMENT_NONE = "";

export const ESTABLISHMENTS = [
    { id: "hospital-claudio-vicuna", name: "Hospital Claudio Vicuña" }
];

export function establishmentName(id) {
    const encontrado = ESTABLISHMENTS.find(item => item.id === String(id || ""));

    return encontrado ? encontrado.name : "";
}

export function isKnownEstablishment(id) {
    return Boolean(establishmentName(id));
}

// Lo que se guarda en la unidad: el id, o vacio si no es uno conocido. Nunca
// el nombre, porque renombrar un hospital no deberia romper las coincidencias.
export function normalizeEstablishment(id) {
    return isKnownEstablishment(id) ? String(id) : ESTABLISHMENT_NONE;
}

// Dos unidades se reconocen como del mismo establecimiento solo si ambas
// declaran uno conocido. Sin esto, dos unidades "sin indicar" pareceria que
// comparten establecimiento y se ofrecerian traslados entre desconocidas.
export function sameEstablishment(a, b) {
    const uno = normalizeEstablishment(a);

    return Boolean(uno) && uno === normalizeEstablishment(b);
}

export function establishmentOptionsHTML(selected = "") {
    const actual = normalizeEstablishment(selected);
    const opciones = ESTABLISHMENTS.map(item => {
        const marca = item.id === actual ? " selected" : "";

        return `<option value="${item.id}"${marca}>${item.name}</option>`;
    }).join("");

    return `<option value=""${actual ? "" : " selected"}>Sin indicar</option>${opciones}`;
}
