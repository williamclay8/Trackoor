#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = process.argv[2] || "dist/git-snapshot.json";

const snapshot = {
  capturedAt: new Date().toISOString(),
  collector: "trackoor-git-snapshot",
  privacyBoundary: "Read-only git metadata. No diffs, file contents, env values, logs, remotes with credentials, or commit messages.",
  repo: process.cwd(),
  branch: "unknown",
  hasCommits: false,
  head: null,
  upstream: null,
  ahead: null,
  behind: null,
  dirty: false,
  counts: {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0
  },
  deploymentTruth: {
    local: "present",
    committed: "unknown",
    pushed: "unknown",
    deployed: "not_checked",
    live: "not_checked"
  },
  warnings: []
};

await populateSnapshot(snapshot);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Git snapshot written to ${outputPath}`);
console.log(`branch=${snapshot.branch} dirty=${snapshot.dirty} hasCommits=${snapshot.hasCommits}`);

async function populateSnapshot(target) {
  const branch = await git(["branch", "--show-current"]);
  target.branch = branch.stdout.trim() || "detached-or-unborn";

  const head = await git(["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  if (head.ok) {
    target.hasCommits = true;
    target.head = head.stdout.trim();
    target.deploymentTruth.committed = "yes";
  } else {
    target.hasCommits = false;
    target.deploymentTruth.committed = "no_commits";
    target.warnings.push("Repository has no commits yet.");
  }

  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowFailure: true });
  if (upstream.ok) {
    target.upstream = upstream.stdout.trim();
    const counts = await git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], { allowFailure: true });
    if (counts.ok) {
      const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
      target.ahead = Number.isFinite(ahead) ? ahead : null;
      target.behind = Number.isFinite(behind) ? behind : null;
      target.deploymentTruth.pushed = target.ahead === 0 ? "matches_upstream" : "ahead_of_upstream";
    }
  } else {
    target.upstream = null;
    target.deploymentTruth.pushed = "no_upstream";
    target.warnings.push("No upstream branch configured.");
  }

  const status = await git(["status", "--porcelain=v1", "--untracked-files=normal"]);
  const lines = status.stdout.split("\n").filter(Boolean);
  target.dirty = lines.length > 0;
  for (const line of lines) addStatusCount(target.counts, line.slice(0, 2));
}

async function git(args, options = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: process.cwd(),
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message
      };
    }
    throw error;
  }
}

function addStatusCount(counts, code) {
  if (code === "??") {
    counts.untracked += 1;
    return;
  }
  if (code.includes("U") || code === "AA" || code === "DD") {
    counts.conflicted += 1;
    return;
  }
  if (code.includes("R")) counts.renamed += 1;
  if (code.includes("A")) counts.added += 1;
  if (code.includes("M")) counts.modified += 1;
  if (code.includes("D")) counts.deleted += 1;
}
