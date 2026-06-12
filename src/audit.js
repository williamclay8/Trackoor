export const AUDIT_STORAGE_KEY = "trackoor.auditEvents";
export const AUDIT_EVENT_LIMIT = 1000;
export const AUDIT_TRAIL_VERSION = 1;
export const SESSION_GAP_MINUTES = 45;

export const EVENT_SOURCES = new Set(["app", "git", "session"]);

export const EVENT_KIND_LABELS = {
  signal_captured: "Signal captured",
  signals_cleared: "Local signals cleared",
  vault_exported: "Vault exported",
  vault_imported: "Vault imported",
  summary_exported: "Summary exported",
  audit_exported: "Audit trail exported",
  draft_copied: "Draft copied",
  artifact_viewed: "Artifact viewed",
  filter_changed: "Filter changed",
  session_started: "Session started",
  commit_created: "Commits recorded",
  branch_switched: "Branch switched",
  work_pulse: "Work in progress",
  repo_clean: "Working tree clean",
  tracking_started: "Activity tracking started",
  agent_activity: "Agent pairing"
};

export const AGENT_LABELS = {
  claude: "Claude Code",
  codex: "Codex"
};

export const PLATFORMS = {
  x: { label: "X", limit: 280 },
  bluesky: { label: "Bluesky", limit: 300 },
  threads: { label: "Threads", limit: 500 },
  mastodon: { label: "Mastodon", limit: 500 },
  linkedin: { label: "LinkedIn", limit: 3000 }
};

const INTERESTING_KINDS = new Set([
  "signal_captured",
  "commit_created",
  "branch_switched",
  "work_pulse",
  "repo_clean",
  "agent_activity"
]);

export function cleanRepoName(name) {
  if (!name) return name;
  const text = String(name);
  if (/^https?-/i.test(text)) {
    const segments = text.split("-");
    const cleaned = segments.slice(4).join("-");
    if (cleaned) return cleaned;
  }
  return text;
}

export function humanizeEvent(event) {
  const detail = event.detail || {};
  const repo = cleanRepoName(detail.repo);
  switch (event.kind) {
    case "commit_created": {
      const where = repo || detail.branch || "the repo";
      return Number(detail.commitsAdded) > 1
        ? `pushed ${detail.commitsAdded} commits to ${where}`
        : `shipped a commit to ${where}`;
    }
    case "work_pulse": {
      const files = ["modified", "added", "deleted", "renamed", "untracked"]
        .reduce((sum, key) => sum + (Number(detail[key]) || 0), 0);
      return `${pluralize(files, "file")} in motion${repo ? ` on ${repo}` : ""}`;
    }
    case "signal_captured":
      return event.summary.replace(/^Captured signal:\s*/i, "");
    case "branch_switched":
      return `context-switched to ${detail.to || "a new branch"}${repo ? ` in ${repo}` : ""}`;
    case "repo_clean":
      return `${repo ? `${repo} ` : ""}working tree clean, everything committed`;
    case "agent_activity":
      return `paired with ${AGENT_LABELS[detail.tool] || detail.tool || "an agent"}`;
    default:
      return event.summary;
  }
}

export function createAuditEvent({ source, kind, summary, detail = {}, now = new Date() }) {
  const errors = [];
  if (!EVENT_SOURCES.has(source)) errors.push(`invalid event source ${source}`);
  if (typeof kind !== "string" || !/^[a-z][a-z0-9_]*$/.test(kind)) errors.push(`invalid event kind ${kind}`);
  const text = String(summary || "").trim();
  if (text.length < 3) errors.push("event summary needs at least 3 characters");
  if (errors.length > 0) return { event: null, errors };

  const ts = now.toISOString();
  return {
    event: {
      id: `evt-${now.getTime()}-${randomSuffix()}`,
      ts,
      day: dayKey(ts),
      source,
      kind,
      summary: text.slice(0, 280),
      detail: sanitizeDetail(detail)
    },
    errors: []
  };
}

export function sanitizeAuditEvents(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const safe = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || typeof item.ts !== "string") continue;
    if (Number.isNaN(Date.parse(item.ts))) continue;
    if (seen.has(item.id)) continue;
    const source = EVENT_SOURCES.has(item.source) ? item.source : "app";
    safe.push({
      id: item.id.slice(0, 120),
      ts: item.ts,
      day: dayKey(item.ts),
      source,
      kind: String(item.kind || "unknown_action").slice(0, 64),
      summary: String(item.summary || "Untitled action").slice(0, 280),
      detail: sanitizeDetail(item.detail)
    });
    seen.add(item.id);
    if (safe.length >= AUDIT_EVENT_LIMIT) break;
  }
  return safe;
}

export function parseAuditTrail(text) {
  const errors = [];
  const events = [];
  const lines = String(text || "").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      errors.push(`line ${index + 1} is not valid JSON`);
    }
  });
  return { events: sanitizeAuditEvents(events), errors };
}

export function serializeAuditTrail(events) {
  return sanitizeAuditEvents(events)
    .map((event) => JSON.stringify(event))
    .join("\n");
}

export function mergeAuditEvents(...lists) {
  const merged = sanitizeAuditEvents(lists.flat());
  const byId = new Map(merged.map((event) => [event.id, event]));
  return [...byId.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id));
}

export function dayKey(ts) {
  return String(ts).slice(0, 10);
}

export function eventDay(event) {
  return event.day || dayKey(event.ts);
}

export function groupEventsByDay(events) {
  const groups = new Map();
  for (const event of events) {
    const day = eventDay(event);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(event);
  }
  return groups;
}

export function deriveSessions(events, { gapMinutes = SESSION_GAP_MINUTES } = {}) {
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const sessions = [];
  let current = null;

  for (const event of sorted) {
    const time = Date.parse(event.ts);
    if (!current || time - Date.parse(current.end) > gapMinutes * 60_000) {
      current = { start: event.ts, end: event.ts, eventCount: 0, sources: new Set() };
      sessions.push(current);
    }
    current.end = event.ts;
    current.eventCount += 1;
    current.sources.add(event.source);
  }

  return sessions.map((session, index) => ({
    id: `session-${index + 1}`,
    start: session.start,
    end: session.end,
    day: dayKey(session.start),
    durationMinutes: Math.round((Date.parse(session.end) - Date.parse(session.start)) / 60_000),
    eventCount: session.eventCount,
    sources: [...session.sources].sort()
  }));
}

export function computeStreak(events, { today } = {}) {
  const days = [...new Set(events.map((event) => eventDay(event)))].sort();
  if (days.length === 0) return { current: 0, best: 0, activeDays: 0 };

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = isNextDay(days[i - 1], days[i]) ? run + 1 : 1;
    if (run > best) best = run;
  }

  const anchor = today || days[days.length - 1];
  let current = 0;
  const daySet = new Set(days);
  let cursor = daySet.has(anchor) ? anchor : previousDay(anchor);
  while (daySet.has(cursor)) {
    current += 1;
    cursor = previousDay(cursor);
  }

  return { current, best, activeDays: days.length };
}

export function computeDayStats(events, day) {
  const dayEvents = events.filter((event) => eventDay(event) === day);
  const bySource = { app: 0, git: 0, session: 0 };
  const byKind = {};
  let commits = 0;

  for (const event of dayEvents) {
    bySource[event.source] = (bySource[event.source] || 0) + 1;
    byKind[event.kind] = (byKind[event.kind] || 0) + 1;
    if (event.kind === "commit_created") {
      commits += Number(event.detail?.commitsAdded) || 1;
    }
  }

  const sessions = deriveSessions(dayEvents);
  return {
    day,
    total: dayEvents.length,
    bySource,
    byKind,
    commits,
    captures: byKind.signal_captured || 0,
    sessions: sessions.length,
    focusMinutes: sessions.reduce((sum, session) => sum + session.durationMinutes, 0),
    firstTs: dayEvents[0]?.ts || null,
    lastTs: dayEvents[dayEvents.length - 1]?.ts || null
  };
}

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

export function detectMilestones(events, { today } = {}) {
  const milestones = [];
  const anchor = today || events[events.length - 1]?.day;
  if (!anchor) return milestones;

  const streak = computeStreak(events, { today: anchor });
  for (const target of STREAK_MILESTONES) {
    if (streak.current >= target) {
      milestones.push({
        id: `streak-${target}`,
        kind: "streak",
        label: `${target}-day build streak`,
        detail: `Active ${streak.current} days in a row, ${streak.activeDays} active days total.`
      });
    }
  }

  const totalCommits = events
    .filter((event) => event.kind === "commit_created")
    .reduce((sum, event) => sum + (Number(event.detail?.commitsAdded) || 1), 0);
  const commitTier = Math.floor(totalCommits / 25) * 25;
  if (commitTier >= 25) {
    milestones.push({
      id: `commits-${commitTier}`,
      kind: "commits",
      label: `${commitTier}+ commits tracked`,
      detail: `${totalCommits} commits recorded in the audit trail so far.`
    });
  }

  const totalCaptures = events.filter((event) => event.kind === "signal_captured").length;
  const captureTier = Math.floor(totalCaptures / 10) * 10;
  if (captureTier >= 10) {
    milestones.push({
      id: `captures-${captureTier}`,
      kind: "captures",
      label: `${captureTier}+ signals captured`,
      detail: `${totalCaptures} build signals logged since tracking began.`
    });
  }

  const stats = computeDayStats(events, anchor);
  if (stats.total >= 20) {
    milestones.push({
      id: `busy-${anchor}`,
      kind: "busy_day",
      label: "High-output day",
      detail: `${pluralize(stats.total, "tracked action")} today across ${pluralize(stats.sessions, "session")}.`
    });
  }

  const deepSession = deriveSessions(events.filter((event) => eventDay(event) === anchor))
    .find((session) => session.durationMinutes >= 90);
  if (deepSession) {
    milestones.push({
      id: `deep-${anchor}`,
      kind: "deep_work",
      label: "Deep work block",
      detail: `${deepSession.durationMinutes} minutes of continuous tracked work.`
    });
  }

  return milestones;
}

export function composePostDrafts({ events, today, projectName = "Trackoor" }) {
  const anchor = today || (events.length ? eventDay(events[events.length - 1]) : null);
  if (!anchor) return [];

  const stats = computeDayStats(events, anchor);
  const streak = computeStreak(events, { today: anchor });
  const milestones = detectMilestones(events, { today: anchor });
  const dayEvents = events.filter((event) => eventDay(event) === anchor);
  const highlights = pickHighlights(dayEvents);
  const drafts = [];
  const seed = (style) => hashNumber(`${anchor}:${style}`);

  const lastInteresting = [...dayEvents].reverse().find((event) => INTERESTING_KINDS.has(event.kind));
  if (stats.total > 0 && lastInteresting) {
    const latest = humanizeEvent(lastInteresting);
    const opener = pick([
      `Day ${streak.activeDays} of building ${projectName} in public.`,
      `${projectName} build pulse:`,
      `Still shipping ${projectName}. Today so far:`,
      `Quick check-in from the ${projectName} desk.`
    ], seed("micro_update"));
    const closer = pick([
      "Receipts in the audit trail.",
      "All tracked, timestamped, reviewable.",
      "The tracker keeps me honest.",
      "Automatic trail, manual posts."
    ], seed("micro_closer"));
    const microTallies = statLine([
      [stats.total, "tracked action", "tracked actions"],
      [stats.commits, "commit", "commits"],
      [stats.captures, "signal captured", "signals captured"]
    ]);
    drafts.push(makeDraft("micro_update", [
      opener,
      `${pluralize(stats.total, "tracked action")}${stats.commits ? `, ${pluralize(stats.commits, "commit")}` : ""}. Latest: ${latest}.`
    ], [lastInteresting.id], [
      opener,
      `The trail reads: ${microTallies}.`,
      `Latest move: ${latest}.`,
      closer
    ]));
  }

  const captures = dayEvents.filter((event) => event.kind === "signal_captured");
  for (const capture of captures.slice(-5)) {
    const title = humanizeEvent(capture);
    const tail = pick([
      "Logged the moment it happened. That's the whole trick.",
      "Straight from today's build trail.",
      "Captured live, posted on purpose.",
      "One line in the audit trail, one post."
    ], seed(`spotlight:${capture.id}`));
    drafts.push(makeDraft("signal_spotlight", [title, tail], [capture.id], [
      title,
      `This came straight out of today's ${projectName} session. I capture these as they happen so nothing good gets lost between commits.`,
      tail
    ]));
  }

  if (stats.total >= 3 && highlights.length > 0) {
    const opener = pick([
      `Today on ${projectName}:`,
      `${projectName}, today's build log:`,
      `What actually happened today on ${projectName}:`
    ], seed("build_log"));
    const closer = streak.current > 1
      ? `Day ${streak.current} of the streak. Receipts in the audit trail.`
      : pick([
        "All of it tracked, timestamped, reviewable.",
        "Every line above has a receipt behind it.",
        "Automatic audit trail. Manual everything else."
      ], seed("build_closer"));
    drafts.push(makeDraft("build_log", [
      opener,
      ...highlights.map((highlight) => `- ${highlight.text}`),
      closer
    ], highlights.map((highlight) => highlight.id), [
      opener,
      ...highlights.map((highlight) => `- ${highlight.text}`),
      `${pluralize(stats.total, "action")} tracked across ${pluralize(stats.sessions, "session")} today. ${closer}`
    ]));
  }

  if (streak.current >= 2) {
    drafts.push(makeDraft("streak", [
      pick([
        `${streak.current}-day build streak on ${projectName}.`,
        `${streak.current} days in a row of shipping ${projectName}.`,
        `The ${projectName} streak hit ${streak.current} days.`
      ], seed("streak")),
      `${pluralize(streak.activeDays, "active day")} tracked, best run: ${streak.best}.`,
      pick([
        "The system: capture everything, review everything, post the receipts.",
        "Consistency is the easiest thing to prove when a watcher logs every day for you.",
        "No vibes, just an append-only log."
      ], seed("streak_closer"))
    ], []));
  }

  if (stats.sessions > 0 && stats.focusMinutes >= 25) {
    const tallies = statLine([
      [stats.captures, "signal captured", "signals captured"],
      [stats.commits, "commit", "commits"],
      [stats.total, "action in the trail", "actions in the trail"]
    ]);
    drafts.push(makeDraft("session_recap", [
      `${stats.focusMinutes} focused minutes across ${pluralize(stats.sessions, "session")} today.`,
      `${tallies}.`
    ], [], [
      `${stats.focusMinutes} focused minutes across ${pluralize(stats.sessions, "session")} today on ${projectName}.`,
      `The trail says: ${tallies}.`,
      "I don't estimate my output anymore. The watcher counts it for me, and I just review the story before it leaves the desk."
    ]));
  }

  for (const milestone of milestones) {
    drafts.push(makeDraft("milestone", [
      `Milestone: ${milestone.label}.`,
      milestone.detail,
      "Tracked automatically, posted manually."
    ], []));
  }

  const repos = [...new Set(dayEvents
    .filter((event) => event.source === "git" && event.detail?.repo)
    .map((event) => cleanRepoName(event.detail.repo)))];
  if (repos.length >= 2) {
    const listed = repos.length > 4
      ? `${repos.slice(0, 4).join(", ")}, and ${repos.length - 4} more`
      : repos.join(", ");
    drafts.push(makeDraft("repo_sweep", [
      `Touched ${pluralize(repos.length, "project")} today: ${listed}.`,
      `${pluralize(stats.commits, "commit")} total. The audit trail caught all of it.`
    ], []));
  }

  const agents = [...new Set(dayEvents
    .filter((event) => event.kind === "agent_activity")
    .map((event) => event.detail?.tool)
    .filter(Boolean))];
  if (agents.length > 0) {
    const names = agents.map((tool) => AGENT_LABELS[tool] || tool);
    drafts.push(makeDraft("agent_mix", [
      agents.length > 1
        ? `Today's pairing rotation: ${names.join(" and ")}.`
        : `Pairing with ${names[0]} today.`,
      `${pluralize(stats.commits, "commit")}, ${pluralize(stats.total, "tracked action")}. I review everything before it ships or gets posted.`
    ], [], [
      agents.length > 1
        ? `I switched between ${names.join(" and ")} today, and the watcher logged both.`
        : `Pairing with ${names[0]} today, and the watcher logged the whole session.`,
      `The numbers: ${pluralize(stats.commits, "commit")}, ${pluralize(stats.total, "tracked action")} across ${pluralize(stats.sessions, "session")}.`,
      "Agents do the grinding. I do the reviewing. The audit trail keeps both of us honest."
    ]));
  }

  return drafts;
}

export function buildDayCard({ events, today, projectName = "Trackoor" }) {
  const anchor = today || events[events.length - 1]?.day || dayKey(new Date().toISOString());
  const stats = computeDayStats(events, anchor);
  const streak = computeStreak(events, { today: anchor });
  const dayEvents = events.filter((event) => eventDay(event) === anchor);
  const highlight = pickHighlights(dayEvents)[0] || null;

  return {
    day: anchor,
    projectName,
    streak: streak.current,
    bestStreak: streak.best,
    activeDays: streak.activeDays,
    actions: stats.total,
    commits: stats.commits,
    captures: stats.captures,
    sessions: stats.sessions,
    focusMinutes: stats.focusMinutes,
    highlight: highlight ? highlight.text : "Quiet so far. Capture the first signal.",
    span: stats.firstTs && stats.lastTs && stats.firstTs !== stats.lastTs
      ? `${clockTime(stats.firstTs)} to ${clockTime(stats.lastTs)}`
      : null
  };
}

const HIGHLIGHT_RANK = {
  signal_captured: 0,
  commit_created: 1,
  branch_switched: 2,
  agent_activity: 3,
  work_pulse: 4,
  repo_clean: 5
};

function pickHighlights(dayEvents) {
  const pulseSeen = new Set();
  const candidates = [];
  for (const event of [...dayEvents].reverse()) {
    if (!INTERESTING_KINDS.has(event.kind)) continue;
    if (event.kind === "work_pulse") {
      const repo = event.detail?.repo || "default";
      if (pulseSeen.has(repo)) continue;
      pulseSeen.add(repo);
    }
    candidates.push(event);
  }
  candidates.sort((a, b) => (HIGHLIGHT_RANK[a.kind] ?? 9) - (HIGHLIGHT_RANK[b.kind] ?? 9));
  const seen = new Set();
  const picks = [];
  for (const event of candidates) {
    const text = humanizeEvent(event);
    if (seen.has(text)) continue;
    seen.add(text);
    picks.push({ id: event.id, text });
    if (picks.length >= 3) break;
  }
  return picks;
}

function makeDraft(style, lines, basedOn, longLines) {
  const text = lines.filter(Boolean).join("\n");
  const long = (longLines || lines).filter(Boolean).join("\n\n");
  return {
    id: `draft-${style}-${hashText(text)}`,
    style,
    text,
    charCount: text.length,
    fitsShortPost: text.length <= PLATFORMS.x.limit,
    variants: buildVariants(text, long),
    basedOn,
    ownerReviewRequired: true
  };
}

function buildVariants(compact, long) {
  const variants = {};
  for (const [id, platform] of Object.entries(PLATFORMS)) {
    const source = id === "linkedin" ? long : compact;
    if (source.length <= platform.limit) {
      variants[id] = { text: source, parts: null };
    } else if (id === "x") {
      variants[id] = { text: compact, parts: splitThread(compact, platform.limit - 10) };
    } else {
      variants[id] = { text: truncateAtBoundary(source, platform.limit), parts: null };
    }
  }
  return variants;
}

export function splitThread(text, limit) {
  const parts = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit && current) {
      parts.push(current);
      current = line;
    } else {
      current = candidate;
    }
    while (current.length > limit) {
      const cut = current.lastIndexOf(" ", limit);
      const index = cut > limit * 0.5 ? cut : limit;
      parts.push(current.slice(0, index).trimEnd());
      current = current.slice(index).trimStart();
    }
  }
  if (current) parts.push(current);
  return parts.map((part, index) => `${part} (${index + 1}/${parts.length})`);
}

function truncateAtBoundary(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(" ", limit - 1);
  return `${text.slice(0, cut > limit * 0.5 ? cut : limit - 1).trimEnd()}…`;
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function statLine(entries) {
  const parts = entries
    .filter(([count]) => Number(count) > 0)
    .map(([count, singular, plural]) => `${count} ${count === 1 ? singular : plural || `${singular}s`}`);
  return parts.length ? parts.join(", ") : "a quiet stretch on the trail";
}

function pick(pool, seedValue) {
  return pool[seedValue % pool.length];
}

function sanitizeDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const safe = {};
  let kept = 0;
  for (const [key, value] of Object.entries(detail)) {
    if (kept >= 12) break;
    if (["string", "number", "boolean"].includes(typeof value)) {
      safe[String(key).slice(0, 40)] = typeof value === "string" ? value.slice(0, 200) : value;
      kept += 1;
    }
  }
  return safe;
}

function isNextDay(earlier, later) {
  return previousDay(later) === earlier;
}

function previousDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function clockTime(ts) {
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function hashNumber(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function hashText(text) {
  return hashNumber(text).toString(36);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
