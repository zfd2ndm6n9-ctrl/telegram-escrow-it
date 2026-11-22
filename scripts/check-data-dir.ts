/**
 * Smoke: DATA_DIR absolute resolution + Render typo `var/data` → `/var/data`.
 * npm exec tsx scripts/check-data-dir.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataDir } from "../src/data-dir.js";

const warnings: string[] = [];
const warn = (message: string) => {
  warnings.push(message);
};

const cwd = mkdtempSync(join(tmpdir(), "escrow-data-dir-"));

warnings.length = 0;
assert.equal(
  resolveDataDir("var/data", { cwd, warn }),
  "/var/data",
  "Render typo var/data must become /var/data",
);
assert.ok(
  warnings.some((w) => w.includes("slash iniziale")),
  "must warn about missing leading slash",
);

warnings.length = 0;
assert.equal(
  resolveDataDir("./var/data", { cwd, warn }),
  "/var/data",
);
assert.ok(warnings.some((w) => w.includes("slash iniziale")));

warnings.length = 0;
assert.equal(resolveDataDir("/var/data", { cwd, warn }), "/var/data");
assert.equal(warnings.length, 0, "absolute /var/data must stay quiet");

warnings.length = 0;
const relative = resolveDataDir("data", { cwd, warn });
assert.equal(relative, join(cwd, "data"));
assert.ok(warnings.some((w) => w.includes("relativo")));

warnings.length = 0;
const legacyDir = join(cwd, "var/data");
mkdirSync(legacyDir, { recursive: true });
writeFileSync(join(legacyDir, "members.json"), '{"members":[]}\n');
resolveDataDir("/var/data", { cwd, warn });
assert.ok(
  warnings.some((w) => w.includes("Store legacy")),
  "must hint when legacy /app/var/data has files and /var/data is empty",
);

warnings.length = 0;
assert.equal(resolveDataDir(undefined, { cwd, warn }), join(cwd, "data"));

console.log("check-data-dir: ok");
