import { test } from "node:test";
import assert from "node:assert/strict";
import {
    findTopProfileSearchMatch,
    getCalendarProfileSearchOptionValues
} from "../js/profileSearchUtils.js";

test("main calendar profile search supports accent-free queries", () => {
    const profiles = [
        {
            name: "José Álvarez Núñez",
            estamento: "Profesional",
            profession: "Enfermería"
        },
        {
            name: "Ana Silva",
            estamento: "Técnico",
            profession: "Técnico en enfermería"
        }
    ];

    assert.equal(
        findTopProfileSearchMatch("Jose Alvarez Nunez", profiles),
        profiles[0]
    );
    assert.equal(
        findTopProfileSearchMatch("tecnico en enfermeria", profiles),
        profiles[1]
    );
});

test("main calendar datalist includes accent-free profile options", () => {
    const options = getCalendarProfileSearchOptionValues({
        name: "José Álvarez Núñez",
        estamento: "Profesional",
        profession: "Enfermería"
    });

    assert.ok(
        options.some(value =>
            value.includes("José Álvarez Núñez")
        )
    );
    assert.ok(
        options.some(value =>
            value.includes("Jose Alvarez Nunez")
        )
    );
    assert.ok(
        options.some(value =>
            value.includes("Enfermeria")
        )
    );
});
