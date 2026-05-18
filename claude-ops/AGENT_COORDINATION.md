# Agent coordination — search-spul-test

**Read this file before any edit.** Two parallel agents must not step on each other.

## Lane A — BULK DATA (agent `5e49b6db` / "import agent")

| | |
|---|---|
| **Owns writes to** | `data/counties.json` **ONLY** (during import window) |
| **Owns** | Running `scripts/import-master-counties.js` when it exists |
| **Must NOT edit** | `public/index.html`, `services/taxIntelligence.js`, `server.js` (unless import agent finished and hands off) |

## Lane B — PIPELINE & VALIDATION (agent `073d8bbb` / "pipeline agent")

| | |
|---|---|
| **Owns writes to** | `data/golden_overrides.json`, `scripts/import-master-counties.js` (create), `scripts/validate-counties-batch.js`, `data/validation_report.ndjson`, `data/bad-assessor-picks.json` |
| **Owns** | `package.json` scripts section (add npm scripts only; do not remove existing scripts) |
| **Must NOT edit** | `data/counties.json` directly while Lane A import is **IN_PROGRESS** |

## Lane C — APP / TRUTH LOCK (either agent, **after** import — claim in lock file)

| | |
|---|---|
| **Owns** | `services/urlFinder.js`, `services/taxIntelligence.js`, `server.js`, `public/index.html` |
| **Only after** | `.agent-coord/IMPORT_COMPLETE` exists |

## Git protocol

1. Before **any** commit: `git pull --rebase origin main`
2. One commit per lane per push wave
3. Check `.agent-coord/LOCK` — JSON: `{ "file": "data/counties.json", "holder": "lane-a", "until": "ISO" }`
4. If lock held by other lane, wait 2 min and retry (max 5)

## Lock and status files

| File | Purpose |
|------|---------|
| `.agent-coord/LOCK` | Exclusive file/lane lock (`holder`: `lane-a` \| `lane-b` \| `lane-c` \| `null`) |
| `.agent-coord/STATUS.json` | Per-lane state: `idle` \| `working` \| `done` |
| `.agent-coord/IMPORT_COMPLETE` | Created by Lane A when bulk import finishes; unlocks Lane C |

## Handoff

- Lane A sets `IMPORT_COMPLETE` and updates STATUS when import is done.
- Lane B must not touch `data/counties.json` until Lane A is `done` or lock is released.
- Lane C agents claim app files only after `IMPORT_COMPLETE` exists and lock allows.
