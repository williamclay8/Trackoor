#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const output = join(process.cwd(), "dist", "site");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of ["index.html", "src", "data"]) {
  await cp(join(process.cwd(), entry), join(output, entry), { recursive: true });
}

console.log(`Built static site at ${output}`);
