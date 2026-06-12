#!/usr/bin/env node
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TRAIL_PATH = "dist/audit-trail.jsonl";
const STATE_PATH = "dist/track-state.json";
const PRIVACY_BOUNDARY = "Read-only git metadata. No diffs, file contents, commit messages, env values, logs, or credentials.";

const watch = process.argv.includes("--watch");
const intervalArg = process.argv[process.argv.indexOf("--watch") + 1];
const intervalSeconds = watch && Number(intervalArg) > 0 ? Number(intervalArg) : 60;

await runOnce();
if (watch) {
  console.log(`Watching git activity every ${intervalSeconds}s. Ctrl+C to stop. Boundary: ${PRIVACY_BOUNDARY}`);
  while (true) {
    await sleep(intervalSeconds * 1000);
    await runOnce();
  }
}

async function runOnce() {
  const now = new Date();
  const state = await loadState();
  const current = await captureGitState();
  const events = [];

  if (!state.initialized) {
    events.push(makeEvent("session", "tracking_started", "Activity tracking started for this repository", {
      branch: current.branch,
      boundary: PRIVACY_BOUNDARY
    }, now));
  } else if (state.lastRunAt && now - new Date(state.lastRunAt) > 45 * 60_000) {
    events.push(makeEvent("session", "session_started", "New tracked work session started", {
      branch: current.branch,
      minutesSinceLastActivity: Math.round((now - new Date(state.lastRunAt)) / 60_000)
    }, now));
  }

  if (state.initialized && current.branch !== state.branch) {
    events.push(makeEvent("git", "branch_switched", `Switched to branch ${current.branch}`, {
      from: state.branch,
      to: current.branch
    }, now));
  }

  if (current.head && current.head !== state.head) {
    const commitsAdded = state.head ? await countCommits(state.head, current.head) : 1;
    events.push(makeEvent("git", "commit_created", commitsAdded === 1
      ? `Committed on ${current.branch} (${current.head.slice(0, 7)})`
      : `${commitsAdded} commits on ${current.branch} (now at ${current.head.slice(0, 7)})`, {
      commitsAdded,
      branch: current.branch,
      head: current.head.slice(0, 12)
    }, now));
  }

  const churn = totalChurn(current.counts);
  const previousChurn = totalChurn(state.counts || {});
  if (state.initialized && churn !== previousChurn) {
    if (churn === 0) {
      events.push(makeEvent("git", "repo_clean", `Working tree clean on ${current.branch}`, { branch: current.branch }, now));
    } else {
      events.push(makeEvent("git", "work_pulse", describeChurn(current.counts, current.branch), {
        ...current.counts,
        branch: current.branch
      }, now));
    }
  }

  if (events.length > 0) {
    await mkdir(dirname(TRAIL_PATH), { recursive: true });
    await appendFile(TRAIL_PATH, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    for (const event of events) console.log(`logged ${event.kind}: ${event.summary}`);
  }

  await saveState({
    initialized: true,
    lastRunAt: now.toISOString(),
    branch: current.branch,
    head: current.head,
    counts: current.counts
  });
}

function makeEvent(source, kind, summary, detail, now) {
  return {
    id: `evt-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now.toISOString(),
    day: now.toISOString().slice(0, 10),
    source,
    kind,
    summary: summary.slice(0, 280),
    detail
  };
}

async function captureGitState() {
  const result = { branch: "unknown", head: null, counts: emptyCounts() };
  const branch = await git(["branch", "--show-current"], { allowFailure: true });
  if (branch.ok) result.branch = branch.stdout.trim() || "detached";

  const head = await git(["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  if (head.ok) result.head = head.stdout.trim();

  const status = await git(["status", "--porcelain=v1", "--untracked-files=normal"], { allowFailure: true });
  if (status.ok) {
    for (const line of status.stdout.split("\n").filter(Boolean)) {
      addStatusCount(result.counts, line.slice(0, 2));
    }
  }
  return result;
}

async function countCommits(fromHead, toHead) {
  const range = await git(["rev-list", "--count", `${fromHead}..${toHead}`], { allowFailure: true });
  if (range.ok) {
    const count = Number(range.stdout.trim());
    if (Number.isFinite(count) && count > 0) return count;
  }
  return 1;
}

function describeChurn(counts, branch) {
  const parts = [];
  if (counts.modified) parts.push(`${counts.modified} modified`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.deleted) parts.push(`${counts.deleted} deleted`);
  if (counts.renamed) parts.push(`${counts.renamed} renamed`);
  if (counts.untracked) parts.push(`${counts.untracked} new file${counts.untracked === 1 ? "" : "s"}`);
  if (counts.conflicted) parts.push(`${counts.conflicted} conflicted`);
  return `Work in progress on ${branch}: ${parts.join(", ") || "changes detected"}`;
}

function totalChurn(counts) {
  return Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function emptyCounts() {
  return { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
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

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return { initialized: false, branch: null, head: null, counts: emptyCounts(), lastRunAt: null };
  }
}

async function saveState(state) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
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
      return { ok: false, stdout: error.stdout || "", stderr: error.stderr || error.message };
    }
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
