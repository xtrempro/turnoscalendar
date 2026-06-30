import { normalizeText } from "./stringUtils.js";

export const CLAVE_AZUL_CONTACT_ID = "agenda_clave_azul";

export function normalizeAgendaDialNumber(value) {
    let digits = String(value || "").replace(/\D/g, "");

    if (digits.length === 11 && digits.startsWith("56")) {
        digits = digits.slice(2);
    }

    return digits.length === 9 ? digits : "";
}

export function agendaFavoriteValue(value) {
    if (value === true) return true;
    if (value === false || value === null || value === undefined) return false;

    const normalized = normalizeText(String(value));

    return ["favorito", "si", "sí", "yes", "true", "1"].includes(
        normalized
    );
}

export function isClaveAzulContact(contact = {}) {
    if (!contact) return false;

    return Boolean(
        contact.priority === true ||
        contact.id === CLAVE_AZUL_CONTACT_ID ||
        normalizeText(contact.name) === "clave azul"
    );
}

export function compareAgendaContacts(a = {}, b = {}) {
    const priorityDifference =
        Number(isClaveAzulContact(b)) - Number(isClaveAzulContact(a));

    if (priorityDifference) return priorityDifference;

    const favoriteDifference =
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));

    if (favoriteDifference) return favoriteDifference;

    return (
        String(a.establishment || "").localeCompare(
            String(b.establishment || ""),
            "es",
            { sensitivity: "base" }
        ) ||
        String(a.unidad || "").localeCompare(
            String(b.unidad || ""),
            "es",
            { sensitivity: "base" }
        ) ||
        String(a.name || a.cargo || "").localeCompare(
            String(b.name || b.cargo || ""),
            "es",
            { sensitivity: "base" }
        )
    );
}

export function filterAgendaContacts(
    contacts = [],
    {
        search = "",
        establishment = "",
        unit = ""
    } = {}
) {
    const query = normalizeText(search);
    const establishmentKey = normalizeText(establishment);
    const unitKey = normalizeText(unit);

    return contacts.filter(contact => {
        if (
            establishmentKey &&
            normalizeText(contact.establishment) !== establishmentKey
        ) {
            return false;
        }

        if (unitKey && normalizeText(contact.unidad) !== unitKey) {
            return false;
        }

        if (!query) return true;

        return [
            contact.name,
            contact.cargo,
            contact.unidad,
            contact.establishment,
            contact.extension,
            contact.email
        ].some(value => normalizeText(value).includes(query));
    });
}

export function agendaFilterValues(contacts = [], field, predicate = null) {
    const values = contacts
        .filter(contact => !predicate || predicate(contact))
        .map(contact => String(contact?.[field] || "").trim())
        .filter(Boolean);

    return [...new Set(values)].sort((a, b) =>
        a.localeCompare(b, "es", { sensitivity: "base" })
    );
}
