#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateDailySummary, validateBuildSignal } from "../src/model.js";

const input = process.argv[2] || "data/sample-build-signal.json";
const output = process.argv[3] || "dist/daily-summary.json";
const data = JSON.parse(await readFile(input, "utf8"));
const errors = validateBuildSignal(data);

if (errors.length > 0) {
  console.error("Cannot generate summary from invalid data:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const summary = generateDailySummary(data);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Daily summary generated at ${output}`);
console.log(`${summary.bestTweetCandidates.length} publish candidates, ${summary.doNotPublish.length} blocked/ignored candidates`);
