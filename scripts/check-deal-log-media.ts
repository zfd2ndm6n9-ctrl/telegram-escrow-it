/**
 * Smoke: media silent-log summary + /deal evidence includes media metadata.
 * npm exec tsx scripts/check-deal-log-media.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeMessageMedia } from "../src/services/deal-log-media.js";

{
  const photo = summarizeMessageMedia({
    caption: "  prova  foto ",
    photo: [
      { width: 100, height: 100, file_unique_id: "a" },
      { width: 1280, height: 720, file_unique_id: "b" },
    ],
  });
  assert.ok(photo);
  assert.equal(photo!.mediaType, "photo");
  assert.match(photo!.text, /\[photo\]/);
  assert.match(photo!.text, /1280×720/);
  assert.match(photo!.text, /caption: prova foto/);
  assert.match(photo!.text, /uid:b/);
}

{
  const video = summarizeMessageMedia({
    video: {
      file_name: "pack.mp4",
      duration: 12,
      width: 640,
      height: 360,
      mime_type: "video/mp4",
      file_size: 1500000,
      file_unique_id: "vid1",
    },
  });
  assert.ok(video);
  assert.equal(video!.mediaType, "video");
  assert.match(video!.text, /\[video\]/);
  assert.match(video!.text, /pack\.mp4/);
  assert.match(video!.text, /12s/);
  assert.match(video!.text, /byte non ritrattenuti/);
}

{
  const doc = summarizeMessageMedia({
    document: {
      file_name: "contratto.pdf",
      mime_type: "application/pdf",
      file_size: 2048,
      file_unique_id: "doc1",
    },
  });
  assert.ok(doc);
  assert.equal(doc!.mediaType, "document");
  assert.match(doc!.text, /\[document\]/);
  assert.match(doc!.text, /contratto\.pdf/);
}

{
  assert.equal(summarizeMessageMedia({}), null);
  assert.equal(summarizeMessageMedia(undefined), null);
}

{
  const root = resolve(import.meta.dirname, "..");
  const hygiene = readFileSync(
    resolve(root, "src/handlers/group-hygiene.ts"),
    "utf8",
  );
  assert.match(hygiene, /message:video/);
  assert.match(hygiene, /message:photo/);
  assert.match(hygiene, /silentLogHumanMessage/);

  const store = readFileSync(resolve(root, "src/store/deal-logs.ts"), "utf8");
  assert.match(store, /getAdminDealEvidenceEntries/);
  assert.match(store, /mediaType/);
}

console.log("check-deal-log-media: ok");
