// Validacion simple de formato de correo (xxxxx@xxxx.xx). Es PURA: no toca el
// DOM. El correo es opcional en el perfil, por lo que un valor vacio se acepta
// (no es un error de formato); solo se rechaza un correo escrito con formato
// invalido.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailFormat(value) {
    return EMAIL_PATTERN.test(String(value || "").trim());
}

export function getEmailValidationMessage(value) {
    const email = String(value || "").trim();

    if (!email) return "";

    return isValidEmailFormat(email)
        ? ""
        : "El correo debe tener el formato nombre@dominio.cl.";
}
