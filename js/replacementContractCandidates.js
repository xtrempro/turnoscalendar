function normalizeEstamento(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

export function buildReplacementContractCandidates({
    profiles = [],
    replacementProfile = null,
    getLeaveOptions
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
            leaveOptions: getLeaveOptions(profile.name) || []
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
