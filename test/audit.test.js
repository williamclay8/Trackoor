import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLATFORMS,
  buildDayCard,
  humanizeEvent,
  splitThread,
  composePostDrafts,
  computeDayStats,
  computeStreak,
  createAuditEvent,
  deriveSessions,
  detectMilestones,
  mergeAuditEvents,
  parseAuditTrail,
  sanitizeAuditEvents,
  serializeAuditTrail
} from "../src/audit.js";

function evt(ts, kind, overrides = {}) {
  return {
    id: overrides.id || `evt-${ts}-${kind}`,
    ts,
    source: overrides.source || "app",
    kind,
    summary: overrides.summary || `${kind} happened`,
    detail: overrides.detail || {}
  };
}

test("createAuditEvent validates and stamps events", () => {
  const bad = createAuditEvent({ source: "robot", kind: "BAD KIND", summary: "" });
  assert.equal(bad.event, null);
  assert.equal(bad.errors.length, 3);

  const now = new Date("2026-06-10T15:00:00Z");
  const { event, errors } = createAuditEvent({
    source: "app",
    kind: "signal_captured",
    summary: "Captured a build note",
    detail: { threadId: "content-os", nested: { dropped: true } },
    now
  });
  assert.equal(errors.length, 0);
  assert.equal(event.day, "2026-06-10");
  assert.equal(event.detail.threadId, "content-os");
  assert.equal("nested" in event.detail, false);
});

test("sanitize drops malformed events and dedupes ids", () => {
  const events = sanitizeAuditEvents([
    evt("2026-06-10T10:00:00Z", "signal_captured", { id: "a" }),
    evt("2026-06-10T11:00:00Z", "signal_captured", { id: "a" }),
    { id: "bad-ts", ts: "not-a-date", kind: "x", summary: "y" },
    "garbage",
    evt("2026-06-10T12:00:00Z", "commit_created", { id: "b", source: "git" })
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.id), ["a", "b"]);
});

test("parse and serialize round-trip JSONL", () => {
  const original = [
    evt("2026-06-10T10:00:00Z", "tracking_started", { id: "one", source: "session" }),
    evt("2026-06-10T10:05:00Z", "commit_created", { id: "two", source: "git", detail: { commitsAdded: 3 } })
  ];
  const text = serializeAuditTrail(original);
  const { events, errors } = parseAuditTrail(`${text}\nnot json\n`);
  assert.equal(errors.length, 1);
  assert.equal(events.length, 2);
  assert.equal(events[1].detail.commitsAdded, 3);
});

test("mergeAuditEvents dedupes across sources and sorts by time", () => {
  const merged = mergeAuditEvents(
    [evt("2026-06-10T12:00:00Z", "work_pulse", { id: "later" })],
    [evt("2026-06-10T09:00:00Z", "session_started", { id: "early" })],
    [evt("2026-06-10T09:00:00Z", "session_started", { id: "early" })]
  );
  assert.deepEqual(merged.map((event) => event.id), ["early", "later"]);
});

test("deriveSessions splits on gaps", () => {
  const sessions = deriveSessions([
    evt("2026-06-10T09:00:00Z", "session_started"),
    evt("2026-06-10T09:30:00Z", "signal_captured"),
    evt("2026-06-10T10:10:00Z", "commit_created"),
    evt("2026-06-10T14:00:00Z", "signal_captured")
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].durationMinutes, 70);
  assert.equal(sessions[0].eventCount, 3);
  assert.equal(sessions[1].eventCount, 1);
});

test("computeStreak counts consecutive days", () => {
  const events = [
    evt("2026-06-07T10:00:00Z", "signal_captured", { id: "d1" }),
    evt("2026-06-08T10:00:00Z", "signal_captured", { id: "d2" }),
    evt("2026-06-10T10:00:00Z", "signal_captured", { id: "d4" })
  ];
  const streak = computeStreak(events, { today: "2026-06-10" });
  assert.equal(streak.current, 1);
  assert.equal(streak.best, 2);
  assert.equal(streak.activeDays, 3);

  const continued = computeStreak(events, { today: "2026-06-11" });
  assert.equal(continued.current, 1);
});

test("computeDayStats aggregates commits and captures", () => {
  const events = [
    evt("2026-06-10T09:00:00Z", "signal_captured", { id: "c1" }),
    evt("2026-06-10T09:30:00Z", "commit_created", { id: "g1", source: "git", detail: { commitsAdded: 2 } }),
    evt("2026-06-09T09:00:00Z", "signal_captured", { id: "old" })
  ];
  const stats = computeDayStats(events, "2026-06-10");
  assert.equal(stats.total, 2);
  assert.equal(stats.commits, 2);
  assert.equal(stats.captures, 1);
  assert.equal(stats.sessions, 1);
});

test("detectMilestones flags streaks, volume, and deep work", () => {
  const events = [];
  for (let day = 1; day <= 7; day += 1) {
    const stamp = `2026-06-0${day}`;
    events.push(evt(`${stamp}T09:00:00Z`, "signal_captured", { id: `cap-${day}` }));
  }
  for (let i = 0; i < 25; i += 1) {
    const minute = String(i * 4).padStart(2, "0");
    const ts = i * 4 < 60 ? `2026-06-07T10:${minute}:00Z` : `2026-06-07T11:${String(i * 4 - 60).padStart(2, "0")}:00Z`;
    events.push(evt(ts, "commit_created", { id: `commit-${i}`, source: "git" }));
  }
  events.push(evt("2026-06-07T12:00:00Z", "work_pulse", { id: "end-deep", source: "git" }));

  const milestones = detectMilestones(events, { today: "2026-06-07" });
  const kinds = milestones.map((milestone) => milestone.kind);
  assert.ok(kinds.includes("streak"));
  assert.ok(kinds.includes("commits"));
  assert.ok(kinds.includes("busy_day"));
  assert.ok(kinds.includes("deep_work"));
});

test("composePostDrafts produces review-gated drafts with content", () => {
  const events = [
    evt("2026-06-09T09:00:00Z", "signal_captured", { id: "y1" }),
    evt("2026-06-10T09:00:00Z", "session_started", { id: "s1", source: "session" }),
    evt("2026-06-10T09:10:00Z", "signal_captured", { id: "c1", summary: "Fixed the vault import edge case" }),
    evt("2026-06-10T09:40:00Z", "commit_created", { id: "g1", source: "git", detail: { commitsAdded: 2 } })
  ];
  const drafts = composePostDrafts({ events, today: "2026-06-10" });
  assert.ok(drafts.length >= 4);
  for (const draft of drafts) {
    assert.equal(draft.ownerReviewRequired, true);
    assert.ok(draft.text.length > 20);
    assert.equal(draft.charCount, draft.text.length);
  }
  const styles = new Set(drafts.map((draft) => draft.style));
  assert.ok(styles.has("micro_update"));
  assert.ok(styles.has("signal_spotlight"));
  assert.ok(styles.has("build_log"));
  assert.ok(styles.has("streak"));
});

test("composePostDrafts covers multi-repo and agent pairing days", () => {
  const events = [
    evt("2026-06-10T09:00:00Z", "commit_created", { id: "r1", source: "git", detail: { repo: "trackoor", commitsAdded: 2 } }),
    evt("2026-06-10T10:00:00Z", "commit_created", { id: "r2", source: "git", detail: { repo: "lumi", commitsAdded: 1 } }),
    evt("2026-06-10T10:30:00Z", "agent_activity", { id: "a1", source: "session", detail: { tool: "claude" } }),
    evt("2026-06-10T11:00:00Z", "agent_activity", { id: "a2", source: "session", detail: { tool: "codex" } })
  ];
  const drafts = composePostDrafts({ events, today: "2026-06-10" });
  const sweep = drafts.find((draft) => draft.style === "repo_sweep");
  assert.ok(sweep);
  assert.ok(sweep.text.includes("trackoor"));
  assert.ok(sweep.text.includes("lumi"));
  const mix = drafts.find((draft) => draft.style === "agent_mix");
  assert.ok(mix);
  assert.ok(mix.text.includes("Claude Code"));
  assert.ok(mix.text.includes("Codex"));
});

test("humanizeEvent turns telemetry into readable phrases", () => {
  assert.equal(
    humanizeEvent(evt("2026-06-10T09:00:00Z", "commit_created", { detail: { repo: "trackoor", commitsAdded: 3 } })),
    "pushed 3 commits to trackoor"
  );
  assert.equal(
    humanizeEvent(evt("2026-06-10T09:00:00Z", "commit_created", { detail: { branch: "main", commitsAdded: 1 } })),
    "shipped a commit to main"
  );
  assert.equal(
    humanizeEvent(evt("2026-06-10T09:00:00Z", "work_pulse", { detail: { repo: "trackoor", modified: 6, untracked: 8 } })),
    "14 files in motion on trackoor"
  );
  assert.equal(
    humanizeEvent(evt("2026-06-10T09:00:00Z", "signal_captured", { summary: "Captured signal: Fixed the parser" })),
    "Fixed the parser"
  );
  assert.equal(
    humanizeEvent(evt("2026-06-10T09:00:00Z", "commit_created", { detail: { repo: "https-github-com-steipete-gogcli", commitsAdded: 1 } })),
    "shipped a commit to gogcli"
  );
});

test("session recap drops zero counts", () => {
  const events = [
    evt("2026-06-10T09:00:00Z", "commit_created", { id: "g1", source: "git", detail: { repo: "trackoor", commitsAdded: 2 } }),
    evt("2026-06-10T09:40:00Z", "work_pulse", { id: "g2", source: "git", detail: { repo: "trackoor", modified: 3 } })
  ];
  const drafts = composePostDrafts({ events, today: "2026-06-10" });
  const recap = drafts.find((draft) => draft.style === "session_recap");
  assert.ok(recap);
  assert.ok(!recap.text.includes("0 signal"));
});

test("drafts use correct grammar and never raw log lines", () => {
  const events = [
    evt("2026-06-10T09:00:00Z", "commit_created", { id: "g1", source: "git", detail: { repo: "trackoor", branch: "main", commitsAdded: 1 } })
  ];
  const drafts = composePostDrafts({ events, today: "2026-06-10" });
  const micro = drafts.find((draft) => draft.style === "micro_update");
  assert.ok(micro);
  assert.ok(micro.text.includes("1 commit"));
  assert.ok(!micro.text.includes("1 commits"));
  assert.ok(!micro.text.includes("work in progress on main ("));
});

test("every draft carries variants for all platforms within limits", () => {
  const events = [];
  for (let i = 0; i < 8; i += 1) {
    events.push(evt(`2026-06-10T09:0${i}:00Z`, "signal_captured", {
      id: `c${i}`,
      summary: `Captured signal: A fairly long descriptive capture about shipping feature number ${i} with extra context attached`
    }));
    events.push(evt(`2026-06-10T10:0${i}:00Z`, "commit_created", {
      id: `g${i}`, source: "git", detail: { repo: `repo-${i}`, commitsAdded: i + 1 }
    }));
  }
  const drafts = composePostDrafts({ events, today: "2026-06-10" });
  assert.ok(drafts.length >= 5);
  for (const draft of drafts) {
    for (const [id, platform] of Object.entries(PLATFORMS)) {
      const variant = draft.variants[id];
      assert.ok(variant, `${draft.style} missing ${id} variant`);
      if (variant.parts) {
        assert.equal(id, "x");
        for (const part of variant.parts) assert.ok(part.length <= platform.limit, `thread part too long: ${part.length}`);
      } else {
        assert.ok(variant.text.length <= platform.limit, `${draft.style}/${id} over limit`);
      }
    }
  }
});

test("splitThread numbers parts and respects the limit", () => {
  const text = Array.from({ length: 12 }, (_, i) => `Line ${i} of a long build log entry with details.`).join("\n");
  const parts = splitThread(text, 120);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(part.length <= 130);
  assert.ok(parts[0].endsWith(`(1/${parts.length})`));
  assert.ok(parts[parts.length - 1].endsWith(`(${parts.length}/${parts.length})`));
});

test("phrasing is deterministic for a given day", () => {
  const events = [
    evt("2026-06-10T09:00:00Z", "commit_created", { id: "g1", source: "git", detail: { repo: "trackoor", commitsAdded: 2 } })
  ];
  const a = composePostDrafts({ events, today: "2026-06-10" });
  const b = composePostDrafts({ events, today: "2026-06-10" });
  assert.deepEqual(a.map((d) => d.text), b.map((d) => d.text));
});

test("buildDayCard summarizes the day", () => {
  const events = [
    evt("2026-06-10T09:00:00Z", "signal_captured", { id: "c1", summary: "Shipped audit trail core" }),
    evt("2026-06-10T10:30:00Z", "commit_created", { id: "g1", source: "git", detail: { commitsAdded: 4 } })
  ];
  const card = buildDayCard({ events, today: "2026-06-10" });
  assert.equal(card.day, "2026-06-10");
  assert.equal(card.commits, 4);
  assert.equal(card.captures, 1);
  assert.ok(card.highlight.length > 0);
  assert.ok(card.span);
});
