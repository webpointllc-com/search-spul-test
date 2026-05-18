# LIVE searchpages & Render lookup report (Worker 3)

**Generated:** 2026-05-18 04:22 UTC  
**Repo:** `search-spul-test` (pulled before run)  
**Scope:** Read-only verification; no `counties.json` or app code changes.

## 1. Squarespace `/searchpages` (live)

### `curl -I https://www.webpointllc.com/searchpages`

| Item | Value |
|------|-------|
| Initial status | `HTTP/2 301` |
| `Location` | `https://webpointllc.com/searchpages` (strips `www`) |
| Server | Squarespace |

### Embedded app (HTML fetch)

| Item | Value |
|------|-------|
| Canonical page | `https://webpointllc.com/searchpages` |
| iframe `src` | `https://search-spul-test.onrender.com` |
| iframe title | `S-PUL Property Tax Search` |
| Render/beta URLs in page | **None observed** in fetched HTML (only `search-spul-test.onrender.com`) |

## 2. Render API `/api/lookup` (20-county sample)

| Item | Value |
|------|-------|
| Base | `https://search-spul-test.onrender.com/api/lookup` |
| Candidate list | `data/incorrect_candidates.json` — **not present** |
| Sample | **Random 20** from `data/counties.json` (`random.seed(20260517)`) |
| HTTP | All **20/20** returned **200** |
| API `ok` | **20/20** `true` |

### Sample results (`searchURL` vs API `url`)

| State | County | HTTP | URL match (normalized) | confidence |
|-------|--------|------|------------------------|------------|
| IN | Jasper | 200 | True | verified |
| IN | Bartholomew | 200 | True | verified |
| NE | Phelps | 200 | True | verified |
| IN | Boone | 200 | True | verified |
| NJ | Barrington Boro | 200 | True | verified |
| MN | Renville | 200 | True | verified |
| NJ | Westampton Twp | 200 | True | verified |
| AL | Choctaw | 200 | True | verified |
| CO | Weld | 200 | True | verified |
| MN | Meeker | 200 | True | verified |
| AR | Mississippi | 200 | True | verified |
| VA | Dickenson | 200 | True | verified |
| GA | Fulton | 200 | True | verified |
| GA | Jones | 200 | True | verified |
| VA | Chesterfield | 200 | True | verified |
| AR | Sharp | 200 | True | verified |
| FL | Palm Beach | 200 | True | verified |
| TN | Hawkins | 200 | True | verified |
| WI | Sawyer | 200 | True | verified |
| WV | Jackson | 200 | True | verified |

## 3. Local `counties.json` vs live API URLs

| Check | Result |
|-------|--------|
| Field compared | Local `searchURL` vs API JSON `url` (host+path normalized) |
| 20-county sample | **0 mismatches** |
| Extra spot-check | First **50** counties (sorted by state, county) via API — **0 mismatches** |
| Full registry (1760) | **Not scanned end-to-end** in this worker (time budget); sample suggests deployed DB aligns with repo for tested rows |

## 4. Coordination & artifacts

| Item | Value |
|------|-------|
| `.agent-coord/LOCK` | Present; `holder`/`file` **null** (note: lane-a import done; lock released) |
| Scratch (local only, not committed) | `claude-ops/_worker3_lookup_scratch.json` |

## 5. Conclusion

- Production Squarespace **searchpages** embeds **`https://search-spul-test.onrender.com`** full-width (700px height).
- For the **20-county** reproducible sample, live lookup URLs **match** local `searchURL` values.
- No separate **beta** iframe URL was found on the live page in this fetch.

