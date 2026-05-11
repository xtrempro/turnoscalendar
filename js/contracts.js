import {
    getProfiles,
    getReplacementContracts,
    saveReplacementContracts,
    getRotativa
} from "./storage.js";

function parseKey(keyDay) {
    const parts = String(keyDay || "").split("-");

    return {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2])
    };
}

export function keyToISO(keyDay) {
    const { year, month, day } = parseKey(keyDay);

    if (!year || month < 0 || !day) return "";

    return [
        year,
        String(month + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

export function formatContractDate(value) {
    const parts = String(value || "").split("-");

    if (parts.length !== 3) return value || "";

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function normalizeContract(contract = {}) {
    return {
        id: String(contract.id || Date.now()),
        start: String(contract.start || ""),
        end: String(contract.end || ""),
        replaces: String(contract.replaces || "").trim(),
        reason: String(contract.reason || "").trim(),
        createdAt:
            contract.createdAt ||
            new Date().toISOString()
    };
}

export function getContractsForProfile(profileName) {
    return getReplacementContracts(profileName)
        .map(normalizeContract)
        .filter(contract =>
            contract.start &&
            contract.end &&
            contract.replaces
        )
        .sort((a, b) =>
            a.start.localeCompare(b.start) ||
            a.end.localeCompare(b.end)
        );
}

export function saveContractsForProfile(profileName, contracts) {
    saveReplacementContracts(
        (contracts || []).map(normalizeContract),
        profileName
    );
}

export function addReplacementContract(profileName, contract) {
    const nextContract = normalizeContract({
        ...contract,
        id:
            contract.id ||
            `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
    const contracts = getContractsForProfile(profileName);

    saveContractsForProfile(
        profileName,
        [...contracts, nextContract]
    );

    return nextContract;
}

export function isReplacementProfile(profileName) {
    return getRotativa(profileName).type === "reemplazo";
}

export function getContractForDate(profileName, keyDay) {
    if (!isReplacementProfile(profileName)) return null;

    const iso = keyToISO(keyDay);

    if (!iso) return null;

    return getContractsForProfile(profileName)
        .find(contract =>
            contract.start <= iso &&
            contract.end >= iso
        ) || null;
}

export function hasContractForDate(profileName, keyDay) {
    return Boolean(getContractForDate(profileName, keyDay));
}

export function getAllReplacementContracts() {
    return getProfiles()
        .filter(profile => isReplacementProfile(profile.name))
        .flatMap(profile =>
            getContractsForProfile(profile.name)
                .map(contract => ({
                    ...contract,
                    worker: profile.name,
                    estamento: profile.estamento
                }))
        )
        .sort((a, b) =>
            a.start.localeCompare(b.start) ||
            a.worker.localeCompare(b.worker)
        );
}
