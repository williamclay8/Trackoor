import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDashboardModel,
  filterCandidates,
  generateDailySummary,
  validateBuildSignal
} from "../src/model.js";

const data = JSON.parse(await readFile(new URL("../data/sample-build-signal.json", import.meta.url), "utf8"));

test("sample build signal data validates", () => {
  assert.deepEqual(validateBuildSignal(data), []);
});

test("dashboard model resolves refs and sorts candidates by score", () => {
  const model = buildDashboardModel(data);
  assert.equal(model.metrics.signals, 4);
  assert.equal(model.candidates[0].id, "cand-proof-to-post");
  assert.equal(model.candidates[0].proofs.length, 2);
  assert.equal(model.candidates[0].statusLabel, "Strong Candidate");
});

test("candidate filters are deterministic", () => {
  const model = buildDashboardModel(data);
  const publishable = filterCandidates(model.candidates, "publish_candidate");
  assert.deepEqual(publishable.map((candidate) => candidate.id), ["cand-proof-to-post", "cand-lumi-ledger"]);
});

test("daily summary separates publishable and blocked candidates", () => {
  const summary = generateDailySummary(data);
  assert.equal(summary.bestTweetCandidates.length, 2);
  assert.ok(summary.doNotPublish.includes("cand-anti-launch"));
  assert.ok(summary.doNotPublish.includes("cand-generic-build-log"));
});

test("validator rejects unsafe text", () => {
  const unsafe = structuredClone(data);
  unsafe.signals[0].title = "<script>alert('x')</script>";
  const errors = validateBuildSignal(unsafe);
  assert.ok(errors.some((error) => error.includes("unsafe text pattern")));
});
