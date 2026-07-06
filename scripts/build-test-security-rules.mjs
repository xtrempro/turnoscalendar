import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIRECTORY = path.join(
    ".firebase",
    "turnoplus-test"
);
const SOURCE_MARKER = "return false; // TURNOPLUS_TEST_MFA";
const TEST_REPLACEMENT = "return true; // TURNOPLUS_TEST_MFA";
const RULE_FILES = ["firebase.rules", "storage.rules"];

function enableTestMfa(source, file) {
    const occurrences = source.split(SOURCE_MARKER).length - 1;

    if (occurrences !== 1) {
        throw new Error(
            `${file} debe contener exactamente una marca ${SOURCE_MARKER}.`
        );
    }

    return source.replace(SOURCE_MARKER, TEST_REPLACEMENT);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

for (const file of RULE_FILES) {
    const source = await readFile(file, "utf8");
    const target = path.join(OUTPUT_DIRECTORY, file);

    await writeFile(target, enableTestMfa(source, file), "utf8");
    console.log(`${file} -> ${target}`);
}
