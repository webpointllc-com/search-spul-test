# GROK HANDOFF — S-PUL counties.json Population Task
**Issued by:** Claude Code (Anthropic)
**Date:** 2026-05-15
**Repo:** search-spul-test
**Task owner:** Grok / SuperGrok (xAI) — has full access to this repo

---

## Context

S-PUL (Search Page URL Locator) is a property tax search page locator tool.
The generative AI layer (this repo) and the original deployed S-PUL tool share one data source: `data/counties.json`.

**Do not create a parallel database. Append to `data/counties.json` only.**

Currently 18 entries. Target: all 3,143 U.S. counties.

---

## CRITICAL DISTINCTION — Read Before Every Search

| Entity | Role | Include? |
|---|---|---|
| Tax Collector / Tax Office / Treasurer | Where residents PAY taxes | ✅ YES |
| Appraisal District / Assessor | Where property VALUES are set | ❌ NO |

State-specific rules:
- **Texas**: CAD (Central Appraisal District) does NOT collect taxes. Find the Tax Assessor-Collector. Never return a `.cad.org` or `cad` URL as the tax payment page.
- **Illinois**: County Treasurer collects taxes (not the Assessor).
- **Georgia**: Tax Commissioner collects taxes.
- **Florida**: Tax Collector collects taxes (separate from Property Appraiser).
- **California**: County Tax Collector (often combined with Treasurer).

---

## Your Job

Use **DeepSearch** to find and verify the official online property tax search page for every county in the assigned state. Browse to each URL — confirm it loads and has a property search function. Do not guess. Only return URLs you have confirmed are live.

---

## Output Format (JSON — append to data/counties.json)

```json
[
  {
    "state": "FL",
    "county": "Alachua",
    "fips": "12001",
    "entityType": "tax_collector",
    "entity": "Alachua County Tax Collector",
    "entityNote": "",
    "searchURL": "https://alachuacounty.us/Depts/PA/Pages/Property-Search.aspx",
    "taxStatute": "Fla. Stat. § 197.172, § 197.432, § 197.502",
    "saleType": "Tax Deed",
    "redemptionPeriodDays": 0,
    "verified": true,
    "lastChecked": "2026-05-15"
  }
]
```

---

## Field Rules

- `entityType`: must be `"tax_collector"` OR `"appraisal_district"` — never blank
- `entity`: full official name of the collecting entity
- `entityNote`: use if there's a meaningful caveat (e.g. "CAD property search — tax payment at [X] separately")
- `searchURL`: direct URL to the property search page, not the department homepage if avoidable
- If a county uses a third-party platform (Tyler Technologies, BS&A, Govtech, etc.) — use the county-specific search URL, not the platform's generic homepage
- `verified`: `true` only if you browsed to it and confirmed it works. Otherwise `false`.
- `lastChecked`: today's date in YYYY-MM-DD format
- `fips`: 5-digit code (2-digit state FIPS + 3-digit county FIPS)
- Do NOT include the assessor/appraiser URL unless it is genuinely where residents search and pay taxes

---

## State Order / Batch Plan

Work one state at a time. Drop completed JSON into `data/counties.json`. Log your work in `claude-ops/GROK_LOG.md`.

| Priority | State | Counties | Notes |
|---|---|---|---|
| 1 | Florida | 67 | Tax Collector is separate from Property Appraiser |
| 2 | Texas (DFW metro) | ~20 | CAD ≠ Tax Office — be strict |
| 3 | Texas (Houston metro) | ~10 | Same |
| 4 | Texas (all remaining) | ~224 | Break into regions |
| 5 | Illinois | 102 | Treasurer collects |
| 6 | Georgia | 159 | Tax Commissioner collects |
| 7 | New Jersey | 21 | Municipal-level, tricky |
| 8 | All remaining states | ~2,500 | Alphabetical |

---

## How to Submit

1. Add your JSON entries to `data/counties.json` (append to the array — do not overwrite existing entries)
2. Log your session in `claude-ops/GROK_LOG.md` (see template below)
3. Commit with message: `feat(data): add [STATE] county tax search URLs via Grok DeepSearch`
4. Push to `main`

---

## Log Template (use in GROK_LOG.md)

```
## [DATE] — [STATE] ([N] counties)
- Verified: [N]
- Unverified / needs recheck: [N]
- Notes: [anything unusual — third-party platforms, merged offices, etc.]
```
