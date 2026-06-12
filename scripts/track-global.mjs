#!/usr/bin/env node
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRAIL_PATH = join(REPO_ROOT, "dist", "audit-trail.jsonl");
const STATE_DIR = join(homedir(), ".trackoor");
const STATE_PATH = join(STATE_DIR, "global-state.json");
const CONFIG_PATH = join(REPO_ROOT, "track-global.config.json");

const watch = process.argv.includes("--watch");

const config = await loadConfig();
await runOnce();
if (watch) {
  console.log(`Trackoor global watcher running every ${config.intervalSeconds}s. Boundary: ${config.privacyBoundary}`);
  while (true) {
    await sleep(config.intervalSeconds * 1000);
    try {
      await runOnce();
    } catch (error) {
      console.error(`watch tick failed: ${error.message}`);
    }
  }
}

async function runOnce() {
  const now = new Date();
  const state = await loadState();
  const events = [];
  const repos = await discoverRepos();

  if (!state.initialized) {
    events.push(makeEvent("session", "tracking_started", `Global tracking started: ${repos.length} repos watched`, {
      repos: repos.length,
      boundary: config.privacyBoundary
    }, now));
  }

  for (const repoPath of repos) {
    const name = cleanRepoName(repoPath.split("/").pop());
    const previous = state.repos[repoPath] || null;
    const current = await captureGitState(repoPath);

    if (previous && current.branch !== previous.branch) {
      events.push(makeEvent("git", "branch_switched", `${name}: switched to branch ${current.branch}`, {
        repo: name,
        from: previous.branch,
        to: current.branch
      }, now));
    }

    if (current.head && previous && current.head !== previous.head) {
      const commitsAdded = await countAuthoredCommits(repoPath, previous.head, current.head);
      if (commitsAdded > 0) {
        events.push(makeEvent("git", "commit_created", commitsAdded === 1
          ? `${name}: committed on ${current.branch} (${current.head.slice(0, 7)})`
          : `${name}: ${commitsAdded} commits on ${current.branch} (now at ${current.head.slice(0, 7)})`, {
          repo: name,
          commitsAdded,
          branch: current.branch,
          head: current.head.slice(0, 12)
        }, now));
      }
    }

    const churn = totalChurn(current.counts);
    const previousChurn = previous ? totalChurn(previous.counts) : churn;
    if (previous && churn !== previousChurn) {
      if (churn === 0) {
        events.push(makeEvent("git", "repo_clean", `${name}: working tree clean on ${current.branch}`, {
          repo: name,
          branch: current.branch
        }, now));
      } else {
        events.push(makeEvent("git", "work_pulse", describeChurn(name, current.counts, current.branch), {
          repo: name,
          ...current.counts,
          branch: current.branch
        }, now));
      }
    }

    state.repos[repoPath] = { branch: current.branch, head: current.head, counts: current.counts };
  }

  for (const [tool, dirs] of Object.entries(config.agentDirs || {})) {
    const lastEvent = state.agents[tool] ? Date.parse(state.agents[tool]) : 0;
    const debounceMs = (config.agentDebounceMinutes || 30) * 60_000;
    if (now - lastEvent < debounceMs) continue;
    const sinceMs = state.lastRunAt ? Date.parse(state.lastRunAt) : now - config.intervalSeconds * 1000;
    const active = await anyRecentActivity(dirs.map(expandHome), sinceMs);
    if (active) {
      const label = tool === "claude" ? "Claude Code" : tool === "codex" ? "Codex" : tool;
      events.push(makeEvent("session", "agent_activity", `Pairing with ${label} this session`, { tool }, now));
      state.agents[tool] = now.toISOString();
    }
  }

  if (events.length > 0) {
    await mkdir(dirname(TRAIL_PATH), { recursive: true });
    await appendFile(TRAIL_PATH, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    for (const event of events) console.log(`logged ${event.kind}: ${event.summary}`);
  }

  state.initialized = true;
  state.lastRunAt = now.toISOString();
  await saveState(state);
}

async function discoverRepos() {
  const repos = [];
  const ignore = new Set(config.ignoreDirs || []);
  for (const root of (config.roots || []).map(expandHome)) {
    await walk(root, 0, repos, ignore);
  }
  return repos;
}

async function walk(dir, depth, repos, ignore) {
  if (depth > (config.maxDepth || 3)) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((entry) => entry.isDirectory() && entry.name === ".git")) {
    repos.push(dir);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || ignore.has(entry.name)) continue;
    await walk(join(dir, entry.name), depth + 1, repos, ignore);
  }
}

async function anyRecentActivity(dirs, sinceMs) {
  for (const dir of dirs) {
    if (await dirTouchedSince(dir, sinceMs, 0)) return true;
  }
  return false;
}

async function dirTouchedSince(dir, sinceMs, depth) {
  if (depth > 2) return false;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries.slice(0, 200)) {
    const path = join(dir, entry.name);
    try {
      const info = await stat(path);
      if (info.mtimeMs > sinceMs) {
        if (entry.isFile()) return true;
        if (entry.isDirectory() && await dirTouchedSince(path, sinceMs, depth + 1)) return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function captureGitState(repoPath) {
  const result = { branch: "unknown", head: null, counts: emptyCounts() };
  const branch = await git(repoPath, ["branch", "--show-current"]);
  if (branch.ok) result.branch = branch.stdout.trim() || "detached";
  const head = await git(repoPath, ["rev-parse", "--verify", "HEAD"]);
  if (head.ok) result.head = head.stdout.trim();
  const status = await git(repoPath, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (status.ok) {
    for (const line of status.stdout.split("\n").filter(Boolean)) {
      addStatusCount(result.counts, line.slice(0, 2));
    }
  }
  return result;
}

async function countAuthoredCommits(repoPath, fromHead, toHead) {
  const email = (await git(repoPath, ["config", "user.email"])).stdout.trim();
  if (email) {
    const authored = await git(repoPath, ["rev-list", "--count", "--author", email, `${fromHead}..${toHead}`]);
    if (authored.ok) {
      const count = Number(authored.stdout.trim());
      if (Number.isFinite(count)) return count;
    }
  }
  const range = await git(repoPath, ["rev-list", "--count", `${fromHead}..${toHead}`]);
  if (range.ok) {
    const count = Number(range.stdout.trim());
    if (Number.isFinite(count) && count > 0) return count;
  }
  return 1;
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

function describeChurn(name, counts, branch) {
  const parts = [];
  if (counts.modified) parts.push(`${counts.modified} modified`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.deleted) parts.push(`${counts.deleted} deleted`);
  if (counts.renamed) parts.push(`${counts.renamed} renamed`);
  if (counts.untracked) parts.push(`${counts.untracked} new file${counts.untracked === 1 ? "" : "s"}`);
  if (counts.conflicted) parts.push(`${counts.conflicted} conflicted`);
  return `${name}: work in progress on ${branch} (${parts.join(", ") || "changes detected"})`;
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

function cleanRepoName(name) {
  if (/^https?-/i.test(String(name))) {
    const cleaned = String(name).split("-").slice(4).join("-");
    if (cleaned) return cleaned;
  }
  return name;
}

function expandHome(path) {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

async function loadConfig() {
  const defaults = {
    roots: ["~/Documents"],
    maxDepth: 3,
    intervalSeconds: 60,
    agentDirs: {},
    agentDebounceMinutes: 30,
    ignoreDirs: ["node_modules", "Library", ".Trash"],
    privacyBoundary: "Read-only metadata only."
  };
  try {
    return { ...defaults, ...JSON.parse(await readFile(CONFIG_PATH, "utf8")) };
  } catch {
    return defaults;
  }
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
    return { initialized: false, lastRunAt: null, repos: {}, agents: {}, ...parsed };
  } catch {
    return { initialized: false, lastRunAt: null, repos: {}, agents: {} };
  }
}

async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

async function git(repoPath, args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: repoPath,
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { ok: false, stdout: error.stdout || "", stderr: error.stderr || error.message };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
