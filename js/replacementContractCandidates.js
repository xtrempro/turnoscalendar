function normalizeEstamento(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

// `coverISO` (opcional, "YYYY-MM-DD"): cuando el modal se abre desde la cruz de
// un dia del calendario, solo se ofrecen trabajadores cuyo permiso/ausencia
// cubre ESA fecha (y solo esos permisos), para usarlos como respaldo del nuevo
// contrato. Sin `coverISO` (acceso desde el perfil) se listan todos los permisos
// disponibles (flujo actual).
export function buildReplacementContractCandidates({
    profiles = [],
    replacementProfile = null,
    getLeaveOptions,
    coverISO = ""
}) {
    const replacementName = String(
        replacementProfile?.name || ""
    );
    const replacementEstamento = normalizeEstamento(
        replacementProfile?.estamento
    );

    if (
        !replacementName ||
        !replacementEstamento ||
        typeof getLeaveOptions !== "function"
    ) {
        return [];
    }

    const cover = String(coverISO || "");
    const optionCoversDate = option =>
        !cover ||
        (
            String(option?.start || "") <= cover &&
            String(option?.end || "") >= cover
        );

    return profiles
        .filter(profile =>
            profile?.name &&
            profile.name !== replacementName &&
            profile.active !== false &&
            normalizeEstamento(profile.estamento) ===
                replacementEstamento
        )
        .map(profile => ({
            profile,
            leaveOptions: (getLeaveOptions(profile.name) || [])
                .filter(optionCoversDate)
        }))
        .filter(candidate => candidate.leaveOptions.length > 0)
        .sort((a, b) =>
            a.profile.name.localeCompare(
                b.profile.name,
                "es",
                { sensitivity: "base" }
            )
        );
}

export function resolveReplacementContractSelection(
    candidates = [],
    selection = {}
) {
    let candidate = candidates.find(item =>
        item.profile.name === selection.profileName
    ) || null;

    if (!candidate && candidates.length === 1) {
        candidate = candidates[0];
    }

    if (!candidate) {
        return {
            profileName: "",
            leaveOption: null
        };
    }

    let leaveOption = candidate.leaveOptions.find(option =>
        option.id === selection.leaveId
    ) || null;

    if (!leaveOption && candidate.leaveOptions.length === 1) {
        leaveOption = candidate.leaveOptions[0];
    }

    return {
        profileName: candidate.profile.name,
        leaveOption
    };
}
