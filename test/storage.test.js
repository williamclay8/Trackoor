import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_SIGNAL_LIMIT,
  buildSignalVault,
  createLocalSignal,
  parseSignalVault,
  sanitizeLocalSignals
} from "../src/storage.js";

test("createLocalSignal rejects thin notes", () => {
  const result = createLocalSignal({ body: "tiny", sourceType: "build_note", threadId: "agent-workflows" });
  assert.equal(result.signal, null);
  assert.ok(result.errors[0].includes("12 characters"));
});

test("createLocalSignal builds a review-gated local signal", () => {
  const now = new Date("2026-06-10T19:00:00.000Z");
  const result = createLocalSignal({
    body: "Shaped the redaction queue into the next Trackoor move.",
    sourceType: "insight_learned",
    threadId: "agent-workflows",
    now
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.signal.id, "local-1781118000000");
  assert.equal(result.signal.redactionStatus, "pending");
  assert.equal(result.signal.rawAssetLocalOnly, true);
  assert.equal(result.signal.ownerReviewRequired, true);
});

test("sanitizeLocalSignals deduplicates and enforces retention limit", () => {
  const records = Array.from({ length: LOCAL_SIGNAL_LIMIT + 5 }, (_, index) => ({
    id: `local-${index}`,
    title: `Signal ${index}`,
    capturedAt: "2026-06-10T19:00:00.000Z"
  }));
  records.push({ id: "local-1", title: "Duplicate" });
  const safe = sanitizeLocalSignals(records);
  assert.equal(safe.length, LOCAL_SIGNAL_LIMIT);
  assert.equal(new Set(safe.map((item) => item.id)).size, LOCAL_SIGNAL_LIMIT);
});

test("vault export and import round trip metadata-only signals", () => {
  const signal = createLocalSignal({
    body: "A useful build moment with proof and restraint.",
    sourceType: "build_note",
    threadId: "agent-workflows",
    now: new Date("2026-06-10T19:10:00.000Z")
  }).signal;
  const vault = buildSignalVault([signal], { exportedAt: "2026-06-10T19:11:00.000Z" });
  assert.equal(vault.version, 1);
  assert.equal(vault.retention.rawAssetsPolicy.includes("no screenshot/OCR/raw logs"), true);
  const parsed = parseSignalVault(JSON.stringify(vault));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.signals[0].id, signal.id);
});

test("parseSignalVault fails closed on invalid JSON", () => {
  const result = parseSignalVault("{not json");
  assert.equal(result.signals.length, 0);
  assert.ok(result.errors[0].includes("could not be parsed"));
});
