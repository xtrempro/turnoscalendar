import { parseKeyParts as parseKey } from "./dateUtils.js";
import { normalizeText } from "./stringUtils.js";
import {
    getProfiles,
    getReplacementContracts,
    saveReplacementContracts,
    getRotativa
} from "./storage.js";

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

export function isReplacementContractType(value) {
    return normalizeText(value) === "reemplazo";
}

export function isHonorariaContractType(value) {
    return normalizeText(value) === "honorarios";
}

export function getHonorariaContract(profileOrName) {
    const profile = typeof profileOrName === "string"
        ? getProfiles().find(item => item.name === profileOrName)
        : profileOrName;

    if (!isHonorariaContractType(profile?.contractType)) {
        return null;
    }

    return {
        start: String(profile.honorariaStart || ""),
        end: String(profile.honorariaEnd || ""),
        hourlyRate: Math.max(
            0,
            Number(profile.honorariaHourlyRate) || 0
        ),
        maxMonthlyHours: Math.max(
            0,
            Number(profile.honorariaMaxMonthlyHours) || 0
        )
    };
}

export function isHonorariaProfile(profileName) {
    return Boolean(getHonorariaContract(profileName));
}

export function hasHonorariaContractForDate(profileName, keyDay) {
    const contract = getHonorariaContract(profileName);
    const iso = keyToISO(keyDay);

    return Boolean(
        contract &&
        iso &&
        contract.start &&
        contract.end &&
        contract.start <= iso &&
        contract.end >= iso
    );
}

export function isReplacementProfile(profileName) {
    const profile = getProfiles().find(item =>
        item.name === profileName
    );

    return (
        isReplacementContractType(profile?.contractType) ||
        getRotativa(profileName).type === "reemplazo"
    );
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

export function getReplacedProfileForDate(profileName, keyDay) {
    return getContractForDate(profileName, keyDay)?.replaces || "";
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
