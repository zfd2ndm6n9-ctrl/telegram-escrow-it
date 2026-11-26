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

  // /codici default = solo attivi
  assert.deepEqual(
    store.list(30).map((i) => i.code),
    [],
    "list() hides inactive by default",
  );
  const withOff = store.list(30, { includeInactive: true }).map((i) => i.code);
  assert.ok(withOff.includes("ESC-LIVE1"));
  assert.ok(withOff.includes("KEYTEST"));

  // Inactive + /codice same name → reactivate + update wallet/assignee
  const cvvDir = mkdtempSync(join(tmpdir(), "escrow-cvv-"));
  try {
    writeFileSync(
      join(cvvDir, "invites.json"),
      JSON.stringify({
        invites: [
          {
            code: "CVVBYPASS",
            collaboratorUserId: 9053518384,
            collaboratorUsername: "work33d",
            collaboratorWallet: "4FDGcNFzCit5cRXgymNumPvTgyqJjsaUGmbgkszdkxuL",
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByAdminId: 1,
            active: false,
            redemptions: [{ userId: 1, redeemedAt: "2026-01-01T00:00:00.000Z" }],
          },
        ],
      }),
      "utf8",
    );
    const cvv = new InviteStore(cvvDir);
    const reused = cvv.create({
      collaboratorUserId: 7296738488,
      collaboratorUsername: undefined,
      collaboratorWallet: "3QuVwKEditBJJ17XxEmcHha7dKnSH7edrvvfPedCBCTM",
      createdByAdminId: 99,
      code: "Cvvbypass",
    });
    assert.equal(reused.code, "CVVBYPASS");
    assert.equal(reused.active, true);
    assert.equal(reused.reactivated, true);
    assert.equal(reused.collaboratorUserId, 7296738488);
    assert.equal(
      reused.collaboratorWallet,
      "3QuVwKEditBJJ17XxEmcHha7dKnSH7edrvvfPedCBCTM",
    );
    assert.equal(reused.redemptions.length, 1, "keeps redemptions");
    assert.equal(reused.createdAt, "2026-01-01T00:00:00.000Z");

    assert.throws(
      () =>
        cvv.create({
          collaboratorUserId: 1,
          collaboratorWallet: "3QuVwKEditBJJ17XxEmcHha7dKnSH7edrvvfPedCBCTM",
          createdByAdminId: 1,
          code: "CVVBYPASS",
        }),
      /già esistente/i,
      "active duplicate still errors",
    );

    cvv.setActive("CVVBYPASS", false);
    const on = cvv.reactivate("CVVBYPASS");
    assert.equal(on.active, true);
    assert.equal(on.reactivated, true);
    assert.equal(on.collaboratorUserId, 7296738488);
  } finally {
    rmSync(cvvDir, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("check-retired-invites: ok");
