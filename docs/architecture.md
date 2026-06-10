# Trackoor P0 Architecture

Trackoor P0 is a local static Build Signal Desk. Its job is to turn raw build evidence into public-safe artifact candidates without creating any social platform write path.

## Product Shape

The first screen uses three zones:

- Capture Rail: local-only intake for build notes, bugs, screenshots, commits, insights, metrics, and open loops.
- Signal Canvas: creative board of raw signals, story seeds, proof moments, and strong candidates.
- Artifact Drawer: shaping surface for visual receipts such as the Lumi Ledger, Agent Work Storyboard, Decision Constellation, and Anti-Launch Card.
- Redaction Queue: visible holding area for local captures, private source summaries, medium-risk copy, and blocked candidates.

The interface should feel like a creative workbench, not a content calendar.

## Data Flow

```text
raw signal -> activity block -> proof -> candidate -> artifact preview -> manual copy/export
```

P0 uses static sample data in `data/sample-build-signal.json`. The data model is validated by `src/model.js` and the local scripts in `scripts/`.

Raw signals captured in the UI are stored only in this browser's `localStorage`. They are not synced, posted, or exported unless Clay uses the manual local export controls. The capture rail includes a clear control for deleting local captures from the current browser.

Vault exports are metadata-only JSON files. They include local signal titles, source type, arc, capture time, redaction status, and retention metadata. They must not contain raw screenshots, OCR text, terminal logs, secrets, or private transcripts.

The first collector is `scripts/capture-git-snapshot.mjs`. It captures read-only git metadata into `dist/git-snapshot.json`: branch, dirty state, file-status counts, upstream/ahead/behind when available, and deployment-truth labels. It does not read diffs, file contents, env values, logs, remotes with credentials, or commit messages.

## Safety Gates

Every candidate must expose:

- source type, source ref, proof ref, capture time, and owner-review requirement;
- redaction status and review metadata;
- evidence refs and risk notes;
- deployment truth: `local_only`, `committed`, `pushed`, `deployed`, `live_verified`, or blocked/unknown state;
- manual-only gate status.

Hard blockers:

- secret or private data;
- unsupported security, privacy, production, customer, revenue, benchmark, or deployment claims;
- private screenshots/OCR/logs without redaction;
- any auto-posting, scheduling, liking, replying, DM, or X API write path.

## Verification

Run:

```bash
npm run verify
```

This performs:

- data validation;
- Node unit tests;
- daily summary generation;
- static HTML/CSS/JS integrity check;
- local-only/manual-only safety scan;
- runtime smoke check through a temporary local HTTP server.

Browser proof is still desirable for layout polish. In the initial P0 run, Chrome DevTools connection failed after connecting because Chrome did not expose `DevToolsActivePort`, so runtime proof fell back to deterministic local HTTP checks.

## Intentional Non-Goals

- No auth.
- No X/Twitter integration.
- No scheduler.
- No analytics dashboard.
- No screenshot/OCR ingestion.
- No cloud storage.
- No deployment or live claim.
- No durable automation install.

## Next Real Moves

Only continue when there is a concrete reason:

1. Add a redaction review queue before screenshot/OCR support.
2. Add a browser-layout proof once Chrome/Browser tooling is stable.
3. Promote git snapshots into first-class proof objects after reviewing the JSON shape in real use.
4. Connect WakaTime summaries only after a secret-safety pass and explicit credential boundary.
