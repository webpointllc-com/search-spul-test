# Generative training — real property-tax scenarios

**Repo:** `search-spul-test`  
**Lane C:** app + services (Groq chat, lookup, corrections, scenario training)

## Purpose

SPUL is not a generic chatbot. The Groq layer (`llama-3.3-70b-versatile`, temperature `0.1`) is constrained to behave like a **trained property-tax URL locator** for phrasing users actually type:

- "Pay my property taxes Travis County TX"
- "San Diego CA property tax search by last name"
- "Denver CO tax bill lookup"
- Texas CAD vs tax-office disambiguation

**Law:** URLs come from `data/counties.json` + `data/golden_overrides.json`. The model must not invent hosts.

## Data flow

```mermaid
flowchart LR
  UserMsg[User message] --> Router[scenarioRouter.matchScenario]
  Router --> Parse[urlFinder.parseJurisdiction]
  Parse --> Lookup[findPropertyURL]
  Lookup --> Prompt[taxIntelligence.enrichSystemPrompt]
  Prompt --> Groq[Groq stream]
  Lookup --> FastUI[/api/lookup fast card]
  Corrections[/api/corrections] --> Golden[golden_overrides.json]
  Golden --> Lookup
```

## Files

| File | Role |
|------|------|
| `data/training_scenarios.json` | 20+ real user phrases + expected county/state/hosts |
| `services/scenarioRouter.js` | Intent detection + scenario context for prompt |
| `services/taxIntelligence.js` | System prompt: intent block, HARD LOCK, few-shots |
| `services/urlFinder.js` | Golden override wins; no Google if county in DB |
| `scripts/test-scenarios.js` | `npm run test:scenarios` |
| `scripts/verify-golden-counties.js` | `npm run verify:golden` (San Diego, Denver controls) |

## Prompt training (not fine-tuning)

1. **Intent injection** — `buildScenarioContext()` adds pay-taxes vs CAD vs parcel intent.
2. **Few-shot rotation** — 4 examples from `training_scenarios.json` rotate by day (not full dump).
3. **HARD LOCK** — When `confidence` is `verified` or `pattern_matched` with a real URL, `SPUL_URL` must match DB exactly; forbidden hosts from `rejectURLs`.
4. **Frontend fast-path** — `/api/lookup` shows verified card immediately; Groq stream fills ACTIONS/CONTEXT; server rewrites `SPUL_URL` via `enforceLockedSpulUrl`.

## Corrections → queue → golden

**Queue first** (`.agent-coord/CORRECTION_QUEUE.ndjson`), then apply via Worker 1.

`POST /api/corrections` (queue mode):

```json
{
  "state": "CA",
  "county": "Marin",
  "currentURL": "https://wrong…",
  "proposedURL": "https://correct…",
  "verified": true,
  "reason": "pay-taxes validation fail",
  "source": "frontend|worker2|worker3|manual"
}
```

- Enqueues a row (`status: pending`).
- Auto-applies when `verified: true` **and** `proposedURL` are set (updates `golden_overrides.json` + `counties.json`).
- Legacy direct apply: send `searchURL` only (no `proposedURL` / `currentURL`) — same as before.

`GET /api/queue` — pending count + last 20 items.

**Worker 1 after `npm run queue:apply-next`**

1. Oldest pending row with `proposedURL` is applied.
2. `rejectURLs` includes `currentURL`.
3. A new scenario is appended to `data/training_scenarios.json`:
   - `mustContainUrlHost` = host of `proposedURL`
   - `forbiddenHosts` = host of `currentURL` (negative example) + `google.com`
   - `userMessage` ≈ `pay my property taxes {county}, {state}`

**Worker 2 ingest** (enqueue only):

```bash
npm run queue:ingest-failures
```

Reads `data/pay_taxes_validation_report.ndjson` and `data/incorrect_pay_taxes_search.json`. Does not apply without `proposedURL` unless high-confidence vendor pattern suggests one (review in `.agent-coord/TODO.md` Blocked section).

## Agent5 / frontend handoff

- Production embed: `https://www.webpointllc.com/searchpages` → Render beta / search-spul-test stack.
- Wrong URL UX: **Not the right page** → `/api/corrections` with `source: "frontend"`.
- Agent5 batch fixes: same API with `source: "agent5"` or validation pipeline (Worker 2) promoting rows.

## Debug API

`POST /api/scenario-test` `{ "message": "…" }` returns:

- `scenario` — `matchScenario` result
- `jurisdiction` — parsed county/state
- `lookup` — `lookupForApi`
- `systemPromptPreview` — first 2k chars of system prompt (no Groq call)

## Tests before push

```bash
npm run verify:golden
npm run test:scenarios
```

## Worker boundaries

- **Worker 1 (Lane C):** this doc, scenarios, router, taxIntelligence, server, `public/index.html`, **`queue:apply-next` only**
- **Worker 2:** `validate:pay-taxes`, validation NDJSON, **`queue:ingest-failures`** — enqueue only; never `apply-next`
- **Worker 3:** `claude-ops/LIVE_SEARCHPAGES_REPORT.md` — read-only verification; optional enqueue with `source: worker3`
