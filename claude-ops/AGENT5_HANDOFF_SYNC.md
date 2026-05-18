# Agent5 / frontend handoff sync

See **`GENERATIVE_TRAINING_REAL_SCENARIOS.md`** for the full training architecture.

## Quick sync points

| Channel | API | `source` |
|---------|-----|----------|
| Frontend “Not the right page” | `POST /api/corrections` | `frontend` |
| Agent5 batch fix | `POST /api/corrections` | `agent5` |
| Validation pipeline (Worker 2) | `POST /api/corrections` or golden import | `validation` |

## Corrections body

```json
{
  "state": "CA",
  "county": "San Diego",
  "searchURL": "https://wps.sdttc.com/WebPayments/CoSDTreasurer2/search",
  "rejectURLs": ["https://arcc.sandiegocounty.gov/"],
  "note": "Treasurer WebPayments, not ARCC",
  "source": "agent5"
}
```

Writes `golden_overrides.json` + patches one `counties.json` row (`verified: true`). Runtime lookup and Groq prompt pick up immediately after cache invalidate.

## Debug (no Groq)

`POST /api/scenario-test` `{ "message": "Pay my property taxes Travis County TX" }`

Returns `scenario`, `jurisdiction`, `lookup`, `systemPromptPreview`.

## Production embed

`https://www.webpointllc.com/searchpages` → Render `search-spul-test` / `webpoint-spul-beta` stack. Same correction contract applies when iframe points at this API host.
