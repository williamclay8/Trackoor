#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateBuildSignal } from "../src/model.js";

const file = process.argv[2] || "data/sample-build-signal.json";
const raw = await readFile(file, "utf8");
const data = JSON.parse(raw);
const errors = validateBuildSignal(data);

if (errors.length > 0) {
  console.error(`Build signal validation failed for ${file}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Build signal validation passed for ${file}`);
