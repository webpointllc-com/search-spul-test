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

## Correction queue protocol (Worker 1 / 2 / 3)

Durable queue for URL fixes before they hit `golden_overrides.json` + `counties.json`.

| Artifact | Path |
|----------|------|
| Append-only log | `.agent-coord/CORRECTION_QUEUE.ndjson` |
| Human rolling todo | `.agent-coord/TODO.md` (auto-regenerated) |
| Enqueue CLI | `node scripts/queue-correction.js enqueue '<json>'` |
| List pending | `npm run queue:list` |
| **Apply (Worker 1 only)** | `npm run queue:apply-next` |
| Ingest Worker 2 failures | `npm run queue:ingest-failures` |

**Roles**

| Worker | May |
|--------|-----|
| **Worker 2** (validation) | Run `validate:pay-taxes`, then `queue:ingest-failures` — **enqueue only**, never `apply-next` |
| **Worker 3** (ops/report) | Read-only live checks; enqueue via API/CLI with `source: "worker3"` if a fix is known |
| **Worker 1** (Lane C / trainer) | `apply-next`, scenario updates, `POST /api/corrections` with `verified: true` + `proposedURL` for auto-apply |

**Queue row shape** (one JSON object per line): `id`, `ts`, `state` (US), `county`, `currentURL`, `proposedURL`, `reason`, `source` (`worker2|worker3|frontend|manual`), `status` (`pending|in_progress|applied|rejected`), `intent` (`pay_taxes_search_by_name`).

**Rules**

1. Worker 2 **must not** run `apply-next` or patch `counties.json` directly from validation output.
2. Items without `proposedURL` stay **pending** and appear under **Blocked** in `TODO.md` until Worker 1 or a human supplies a URL.
3. Only Worker 1 runs `apply-next` (or auto-apply via API when `verified: true` and `proposedURL` are set).
4. On apply, append training example to `data/training_scenarios.json` (forbidden host = old URL).

**HTTP**

- `POST /api/corrections` — enqueue; auto-apply when `verified: true` and `proposedURL` (or legacy direct `searchURL` only).
- `GET /api/queue` — pending counts + last 20 merged items.
