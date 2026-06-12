#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const skippedDirs = new Set([".git", "dist", "node_modules"]);
const scannedExtensions = new Set([".html", ".js", ".mjs", ".css", ".json", ".md"]);
const errors = [];

const bannedFiles = [
  /^\.env/,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /wallet/i
];

const bannedRuntimePatterns = [
  { pattern: /api\.x\.com|twitter\.com\/i\/api|x\.com\/i\/api/i, label: "X/Twitter API usage" },
  { pattern: /x\.com\/intent\/(tweet|retweet|like)/i, label: "X intent write flow" },
  { pattern: /navigator\.share\s*\(/i, label: "native share flow" },
  { pattern: /\b(fetch|XMLHttpRequest)\s*\(\s*["']https?:\/\//i, label: "remote network call" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i, label: "private key material" },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{12,}/i, label: "bearer token" },
  { pattern: /\b(api[_-]?key|secret|password|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9._/-]{12,}/i, label: "secret-like assignment" }
];

const allowedChildProcessFiles = new Set([
  "scripts/capture-git-snapshot.mjs",
  "scripts/track-activity.mjs",
  "scripts/track-global.mjs"
]);

for await (const file of walk(root)) {
  const relative = file.slice(root.length + 1);
  if (bannedFiles.some((pattern) => pattern.test(relative))) {
    errors.push(`secret-like file should not exist in prototype: ${relative}`);
    continue;
  }

  if (!scannedExtensions.has(extensionOf(relative))) continue;
  const text = await readFile(file, "utf8");
  if (/\bexec(File|Sync)?\b|\bspawn(Sync)?\b/.test(text) && !allowedChildProcessFiles.has(relative)) {
    errors.push(`${relative} uses child process without allowlist`);
  }
  for (const { pattern, label } of bannedRuntimePatterns) {
    if (pattern.test(text)) errors.push(`${relative} contains ${label}`);
  }
}

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (/deploy|release|publish|postinstall|prepublish/i.test(name)) {
    errors.push(`package script ${name} is not allowed`);
  }
  if (/\b(open|osascript|gh\s+release|render\s+deploy)\b/i.test(command)) {
    errors.push(`package script ${name} may mutate external state`);
  }
}

if (errors.length > 0) {
  console.error("Safety check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Safety check passed");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skippedDirs.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
      continue;
    }
    if (entry.isFile()) yield join(dir, entry.name);
  }
}

function extensionOf(file) {
  const match = file.match(/\.[^.]+$/);
  return match ? match[0] : "";
}
