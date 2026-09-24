import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("oculta solo el acceso lateral a Marcajes", () => {
    assert.doesNotMatch(html, /data-target="clockMarksPanel"/);
    assert.match(html, /id="clockMarksPanel"/);
    assert.match(html, /id="clockMarksSearchModal"/);
    assert.match(html, /id="attendanceImportInput"/);
});
