#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "src/app.js",
  "src/model.js",
  "src/storage.js",
  "src/styles.css",
  "data/sample-build-signal.json",
  "schema/build-signal.schema.json"
];

const errors = [];

for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    errors.push(`missing required file ${file}`);
  }
}

const html = await readFile("index.html", "utf8");
const app = await readFile("src/app.js", "utf8");
const pkg = await readFile("package.json", "utf8");

const requiredHtml = [
  "<html lang=\"en\">",
  "<meta name=\"viewport\"",
  "<main",
  "id=\"captureForm\"",
  "id=\"importVault\"",
  "id=\"signalCanvas\"",
  "id=\"redactionQueue\"",
  "id=\"artifactDrawer\""
];

for (const fragment of requiredHtml) {
  if (!html.includes(fragment)) errors.push(`index.html missing ${fragment}`);
}

if (/\son[a-z]+\s*=/i.test(html)) errors.push("index.html must not use inline event handlers");
if (/<script[^>]+src=["']https?:\/\//i.test(html)) errors.push("remote scripts are not allowed");
if (/<link[^>]+href=["']https?:\/\//i.test(html)) errors.push("remote styles/fonts are not allowed");
if (/\b(post|schedule|like|reply|dm|retweet|repost)ToX\b/i.test(app)) errors.push("app appears to include social write behavior");

const packageJson = JSON.parse(pkg);
for (const scriptName of Object.keys(packageJson.scripts || {})) {
  if (/deploy|publish|release|postinstall|prepublish/i.test(scriptName)) {
    errors.push(`package script ${scriptName} is not allowed in the local-only prototype`);
  }
}

if (errors.length > 0) {
  console.error("Static integrity check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Static integrity check passed");
