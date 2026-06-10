#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, safePath);
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const [html, data, app, css] = await Promise.all([
    getText(`${base}/`),
    getJson(`${base}/data/sample-build-signal.json`),
    getText(`${base}/src/app.js`),
    getText(`${base}/src/styles.css`)
  ]);

  const errors = [];
  if (!html.includes("Build Signal Desk")) errors.push("index does not expose Build Signal Desk copy");
  if (!html.includes("id=\"signalCanvas\"")) errors.push("index missing signal canvas mount");
  if (!html.includes("id=\"redactionQueue\"")) errors.push("index missing redaction queue mount");
  if (!html.includes("id=\"importVault\"")) errors.push("index missing vault import control");
  if (!app.includes("buildDashboardModel")) errors.push("app does not build dashboard model");
  if (!app.includes("parseSignalVault")) errors.push("app does not wire vault import parsing");
  if (!app.includes("renderRedactionQueue")) errors.push("app does not render redaction queue");
  if (!app.includes("Manual review still required")) errors.push("app does not preserve manual review copy feedback");
  if (!css.includes(".signal-canvas")) errors.push("styles missing signal canvas layout");
  if (data.meta.manualOnly !== true) errors.push("runtime data is not manual-only");
  if (data.candidates.filter((candidate) => candidate.status === "publish_candidate").length !== 2) {
    errors.push("runtime data should expose exactly two strong candidates");
  }
  const snapshotResponse = await fetch(`${base}/scripts/capture-git-snapshot.mjs`);
  if (!snapshotResponse.ok) errors.push("git snapshot collector script is not served for local review");

  if (errors.length > 0) {
    console.error("Runtime smoke check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Runtime smoke check passed at ${base}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}
