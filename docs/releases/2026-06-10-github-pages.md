# Trackoor GitHub Pages Release Proof

Date: 2026-06-10

## Release

- Repository: `williamclay8/Trackoor`
- Remote URL: `https://github.com/williamclay8/Trackoor`
- Live URL: `https://williamclay8.github.io/Trackoor/`
- Deployment provider: GitHub Pages
- Workflow: `Deploy Trackoor`
- Workflow run: `https://github.com/williamclay8/Trackoor/actions/runs/27299755292`
- Deployed commit: `6996d2d7a4f09928508ee6bb95403ecc89cfa629`

## Verification

Local verification before deploy:

```bash
npm run verify
npm run build
```

GitHub Actions deploy run:

```text
Deploy Trackoor (27299755292): success
```

Live checks:

```bash
curl -I https://williamclay8.github.io/Trackoor/
curl -sS https://williamclay8.github.io/Trackoor/ | head -30
curl -sS https://williamclay8.github.io/Trackoor/src/app.js | rg "redactionQueue|parseSignalVault|exportLocalSignals"
```

Observed live evidence:

- HTTP status: `200`
- Server: `GitHub.com`
- Page title/content includes `Trackoor`
- Live JavaScript includes `redactionQueue`, `parseSignalVault`, and `exportLocalSignals`

## Lumi State

- Local: clean after release commit/push is complete
- Committed: yes
- Pushed: yes
- Deployed: yes
- Live verified: yes

## Residual Risks

- Render deploy was not completed because the Render MCP had no selected workspace and the local Render CLI token is expired.
- GitHub Pages is the current live deployment target.
- No social posting, scheduling, X/Twitter mutation, screenshot/OCR ingestion, or external telemetry collection is enabled.
