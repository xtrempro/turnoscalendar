import assert from "node:assert/strict";
import test from "node:test";
import {
    buildReplacementContractCandidates,
    resolveReplacementContractSelection
} from "../js/replacementContractCandidates.js";

const profiles = [
    { name: "Reemplazante", estamento: "Profesional", active: true },
    { name: "Profesional con permiso", estamento: "Profesional", active: true },
    { name: "Profesional sin permiso", estamento: "Profesional", active: true },
    { name: "Tecnico con permiso", estamento: "Tecnico", active: true }
];
const leaves = {
    "Profesional con permiso": [
        { id: "fl-1", label: "F. Legal", start: "2026-07-08", end: "2026-07-14" }
    ],
    "Tecnico con permiso": [
        { id: "lm-1", label: "Licencia Medica", start: "2026-07-01", end: "2026-07-05" }
    ]
};

test("filtra por estamento y por permisos disponibles", () => {
    const candidates = buildReplacementContractCandidates({
        profiles,
        replacementProfile: profiles[0],
        getLeaveOptions: name => leaves[name] || []
    });

    assert.deepEqual(
        candidates.map(item => item.profile.name),
        ["Profesional con permiso"]
    );
});

test("autoselecciona trabajador y permiso cuando ambos son unicos", () => {
    const candidates = buildReplacementContractCandidates({
        profiles,
        replacementProfile: profiles[0],
        getLeaveOptions: name => leaves[name] || []
    });
    const resolved = resolveReplacementContractSelection(candidates);

    assert.equal(resolved.profileName, "Profesional con permiso");
    assert.equal(resolved.leaveOption?.id, "fl-1");
});

test("coverISO: solo trabajadores cuyo permiso cubre la fecha clickeada", () => {
    const localProfiles = [
        { name: "Reemplazante", estamento: "Profesional", active: true },
        { name: "Ana", estamento: "Profesional", active: true },
        { name: "Luis", estamento: "Profesional", active: true }
    ];
    const localLeaves = {
        Ana: [
            { id: "a1", label: "LM", start: "2026-07-01", end: "2026-07-06" }
        ],
        Luis: [
            { id: "l1", label: "FL", start: "2026-07-10", end: "2026-07-15" }
        ]
    };
    const candidates = buildReplacementContractCandidates({
        profiles: localProfiles,
        replacementProfile: localProfiles[0],
        getLeaveOptions: name => localLeaves[name] || [],
        coverISO: "2026-07-02"
    });

    assert.deepEqual(candidates.map(item => item.profile.name), ["Ana"]);
});

test("coverISO vacio lista todos los permisos (flujo desde el perfil)", () => {
    const localProfiles = [
        { name: "Reemplazante", estamento: "Profesional", active: true },
        { name: "Ana", estamento: "Profesional", active: true },
        { name: "Luis", estamento: "Profesional", active: true }
    ];
    const localLeaves = {
        Ana: [
            { id: "a1", label: "LM", start: "2026-07-01", end: "2026-07-06" }
        ],
        Luis: [
            { id: "l1", label: "FL", start: "2026-07-10", end: "2026-07-15" }
        ]
    };
    const candidates = buildReplacementContractCandidates({
        profiles: localProfiles,
        replacementProfile: localProfiles[0],
        getLeaveOptions: name => localLeaves[name] || [],
        coverISO: ""
    });

    assert.deepEqual(
        candidates.map(item => item.profile.name).sort(),
        ["Ana", "Luis"]
    );
});

test("coverISO filtra tambien los permisos dentro de un candidato", () => {
    const localProfiles = [
        { name: "Reemplazante", estamento: "Profesional", active: true },
        { name: "Ana", estamento: "Profesional", active: true }
    ];
    const localLeaves = {
        Ana: [
            { id: "a1", label: "LM", start: "2026-07-01", end: "2026-07-06" },
            { id: "a2", label: "FL", start: "2026-08-01", end: "2026-08-06" }
        ]
    };
    const candidates = buildReplacementContractCandidates({
        profiles: localProfiles,
        replacementProfile: localProfiles[0],
        getLeaveOptions: name => localLeaves[name] || [],
        coverISO: "2026-07-03"
    });

    assert.equal(candidates.length, 1);
    assert.deepEqual(
        candidates[0].leaveOptions.map(option => option.id),
        ["a1"]
    );
});

test("autoselecciona el unico permiso de un trabajador elegido", () => {
    const candidates = [
        {
            profile: { name: "A" },
            leaveOptions: [
                { id: "a-1" }
            ]
        },
        {
            profile: { name: "B" },
            leaveOptions: [
                { id: "b-1" },
                { id: "b-2" }
            ]
        }
    ];

    assert.equal(
        resolveReplacementContractSelection(candidates, {
            profileName: "A"
        }).leaveOption?.id,
        "a-1"
    );
    assert.equal(
        resolveReplacementContractSelection(candidates, {
            profileName: "B"
        }).leaveOption,
        null
    );
});
