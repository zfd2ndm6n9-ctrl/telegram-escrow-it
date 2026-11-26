/**
 * Smoke: KEYTEST/TESTKEY ritirati — create bloccata, load disattiva.
 * npm exec tsx scripts/check-retired-invites.ts
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InviteStore,
  isRetiredInviteCode,
  RETIRED_INVITE_CODES,
} from "../src/store/invites.js";

assert.equal(isRetiredInviteCode("keytest"), true);
assert.equal(isRetiredInviteCode("TESTKEY"), true);
assert.equal(isRetiredInviteCode("ESC-OK123"), false);
assert.ok(RETIRED_INVITE_CODES.has("KEYTEST"));
assert.ok(RETIRED_INVITE_CODES.has("TESTKEY"));

const dir = mkdtempSync(join(tmpdir(), "escrow-invites-"));
try {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "invites.json"),
    JSON.stringify({
      invites: [
        {
          code: "KEYTEST",
          collaboratorUserId: 1,
          collaboratorWallet: "4FDGcNFzCit5cRXgymNumPvTgyqJjsaUGmbgkszdkxuL",
          createdAt: "2026-01-01T00:00:00.000Z",
          createdByAdminId: 1,
          active: true,
          redemptions: [],
        },
        {
          code: "ESC-LIVE1",
          collaboratorUserId: 2,
          collaboratorWallet: "4FDGcNFzCit5cRXgymNumPvTgyqJjsaUGmbgkszdkxuL",
          createdAt: "2026-01-02T00:00:00.000Z",
          createdByAdminId: 1,
          active: true,
          redemptions: [],
        },
      ],
    }),
    "utf8",
  );

  const store = new InviteStore(dir);
  const keytest = store.get("KEYTEST");
  assert.ok(keytest);
  assert.equal(keytest.active, false, "KEYTEST deactivated on load");

  const live = store.get("ESC-LIVE1");
  assert.ok(live);
  assert.equal(live.active, true);

  const disk = JSON.parse(readFileSync(join(dir, "invites.json"), "utf8")) as {
    invites: { code: string; active: boolean }[];
  };
  const persisted = disk.invites.find((i) => i.code === "KEYTEST");
  assert.ok(persisted);
  assert.equal(persisted.active, false, "KEYTEST persisted inactive");

  assert.throws(
    () =>
      store.create({
        collaboratorUserId: 9,
        collaboratorWallet: "4FDGcNFzCit5cRXgymNumPvTgyqJjsaUGmbgkszdkxuL",
        createdByAdminId: 1,
        code: "KEYTEST",
      }),
    /ritirato/i,
  );
  assert.throws(
    () =>
      store.create({
        collaboratorUserId: 9,
        collaboratorWallet: "4FDGcNFzCit5cRXgymNumPvTgyqJjsaUGmbgkszdkxuL",
        createdByAdminId: 1,
        code: "testkey",
      }),
    /ritirato/i,
  );

  const off = store.setActive("ESC-LIVE1", false);
  assert.ok(off);
  assert.equal(off.active, false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("check-retired-invites: ok");
