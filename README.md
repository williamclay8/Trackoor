# Trackoor

Trackoor is a local-first Build Signal OS. It turns private build activity, proof receipts, and judgment notes into manual-review tweet candidates and visual artifacts.

It does not post, schedule, like, reply, DM, or operate X/Twitter. It prepares copy-ready candidates, evidence links, risk flags, and artifact previews for Clay to review manually.

## Run

```bash
npm run verify
npm run dev
```

Then open `http://127.0.0.1:4173/`.

Production start command:

```bash
npm start
```

On Render, `scripts/serve.mjs` binds to `0.0.0.0` when the `RENDER` environment flag is present and reads the runtime port from `PORT`.

Optional local collector:

```bash
npm run snapshot:git
```

This writes `dist/git-snapshot.json` with read-only git metadata: branch, dirty state, file-status counts, upstream/ahead/behind when available, and deployment-truth labels. It does not read diffs, file contents, env values, logs, remotes with credentials, or commit messages.

## Current Slice

- Static dashboard in `index.html`, `src/app.js`, and `src/styles.css`.
- Sample local activity data in `data/sample-build-signal.json`.
- Data contract in `schema/build-signal.schema.json`.
- Browser-local vault export/import for captured signals.
- Visible redaction queue before captures become candidates.
- Read-only git snapshot collector for local proof metadata.
- Daily summary generator in `scripts/generate-daily-summary.mjs`.
- Local validation and safety checks in `scripts/validate-data.mjs` and `scripts/check-static.mjs`.

## Safety Boundary

- Manual-only publishing.
- Local/private by default.
- No social platform writes.
- No secrets, raw logs, private screenshots, customer data, or unsupported security/privacy/production claims.
- Every publish candidate must carry evidence refs, risk notes, and deployment truth.

## Lumi Status

Local prototype only. Nothing is committed, pushed, deployed, or live unless a later run explicitly performs and verifies those steps.
