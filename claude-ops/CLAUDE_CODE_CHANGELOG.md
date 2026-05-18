# Claude Code Changelog
**Repo:** search-spul-test
**Author:** Claude Code (Anthropic) — session handoffs from Claude Desktop (Twin 2)

This file is the authoritative log of all architectural decisions, rewrites, and fixes made by Claude Code in this repo. Grok should read this before making any changes to understand current system state.

---

## 2026-05-17 — Verified San Diego + Denver seeds

- **counties.json:** `CA / San Diego` → `https://wps.sdttc.com/WebPayments/CoSDTreasurer2/search` (verified); `CO / Denver` → `https://property.spatialest.com/co/denver#/` (verified). `rejectURLs` block common wrong assessor picks.
- **statutes.json:** CA and CO slices for prompt context.
- **urlFinder:** `City, ST`, `property taxes {county} {ST}`, `/api/lookup`, `npm run verify:golden`.

## 2026-05-15 — Session 1 (Major overhaul)

### Problem
- Raw LLM "thinking out loud" visible to users (stream of consciousness, 911 emergency tangent)
- Travis County TX → routed to traviscad.org (Appraisal District) instead of Tax Office
- Cook County IL → URL appeared inactive
- Links returned as raw unclickable text
- UI did not match S-PUL design system
- `taxIntelligence.js` and `urlFinder.js` were dead code (never imported by server.js)

### Fixes Applied

**server.js**
- Now imports `enrichSystemPrompt` from `services/taxIntelligence.js`
- Now imports `parseJurisdiction` from `services/urlFinder.js`
- Parses jurisdiction from every user message before API call
- Stores jurisdiction in session, clears on `/api/new-search`
- Temperature: reduced from 0.7 → 0.1 (domain-constrained output)
- max_tokens: 600

**services/taxIntelligence.js**
- Complete rewrite of system prompt
- Added CRITICAL DISTINCTION block: CAD ≠ Tax Collector
- Forces SPUL_URL / SPUL_ENTITY / SPUL_CONFIDENCE / SPUL_ACTIONS / SPUL_CONTEXT output format
- Injects verified DB URL into prompt, tells model to copy it verbatim
- Off-topic queries (emergencies, weather, etc.) → returns only canned redirect message

**services/urlFinder.js**
- Added `parseJurisdiction(message)` — parses raw user input into `{ county, state }`
- `findPropertyURL` now returns `entityType`, `entityNote`, `entity` from DB record
- Google fallback query improved: includes "county tax assessor collector" terms
- Partial name matching: handles dashes vs spaces (miami-dade / miami dade)

**data/counties.json**
- Added `entityType` field to all entries (`tax_collector` | `appraisal_district`)
- Travis TX: changed from `traviscad.org` → `https://www.traviscountytax.org/` (Tax Office)
- Bell TX: labeled as `appraisal_district` with entityNote clarifying tax payment is separate
- GA entries: updated to Tax Commissioner URLs
- Cook IL: kept `cookcountytreasurer.com`, added `altSearchURL` for Assessor
- Total entries: 18 (up from ~10)

**public/index.html**
- Full S-PUL branded redesign (DM Sans + DM Mono, #2b8ef0 blue, glassmorphism)
- S-PUL cloud SVG logo (light + dark variants)
- Stream fully buffered client-side — no raw LLM output ever shown
- `parseSpul(text)`: extracts SPUL_* delimiters after full stream
- `renderSpulCard(parsed)`: clickable URL button, confidence badge, action chips
- `renderMarkdown(text)`: basic markdown for follow-up chat bubbles
- Cycling thinking-state labels (5 domain-specific messages, fade every 900ms)
- GSAP 3.12.5: hero slides up, chat fades in on first search
- Conversation index sidebar: auto-populating TOC, anchored scroll links
- Toggle button in chat header for sidebar show/hide
- Auto dark-mode detection via `prefers-color-scheme`

**public/styles.css**
- Full rewrite matching S-PUL design system
- CSS variables for light/dark themes
- `.spul-result-card` with `cardIn` keyframe animation
- `.conf-verified` (green) / `.conf-pattern` (yellow) / `.conf-notfound` (red) badges
- `.action-chip` clickable pre-fill pills
- `.chat-body` flex layout for messages + sidebar
- `.index-sidebar` 0px → 158px transition on `has-entries`
- SVG icon size fixes for search and send buttons

### Deployment
- Committed: `6d656a3`
- Pushed to: `github.com/webpointllc-com/search-spul-test` main
- Render auto-deploy triggered: `https://search-spul-test.onrender.com`
- Embed target: `https://www.webpointllc.com/searchpages`

---

## Next Claude Code Tasks (queued)

- [ ] Write URL health-check script: hits all `searchURL` entries in counties.json, logs non-200s
- [ ] Add `altSearchURL` rendering to `renderSpulCard()` (Cook County IL pattern)
- [ ] Verify TX Tax Office URLs marked `verified: false` (traviscountytax.org, tarrantcountytx.gov, etc.)
- [ ] Voice-first prototype work (Slot [C]) — pending, not started
