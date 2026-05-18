#!/usr/bin/env node
/**
 * Assert parseJurisdiction + findPropertyURL for training_scenarios.json
 * Run: npm run test:scenarios
 */
const path = require('path');
const { parseJurisdiction, findPropertyURL, invalidateCountiesCache } = require('../services/urlFinder');
const { matchScenario } = require('../services/scenarioRouter');
const { isGoogleFallbackUrl } = require('../services/spulTruth');

invalidateCountiesCache();

const raw = require(path.join(__dirname, '../data/training_scenarios.json'));
const scenarios = (raw.scenarios || raw).filter((s) => !s.expectNoUrl);

let passed = 0;
let failed = 0;
let skipped = 0;

function hostOk(url, fragment) {
  if (!fragment) return Boolean(url && !isGoogleFallbackUrl(url));
  return (url || '').toLowerCase().includes(fragment.toLowerCase());
}

function hostForbidden(url, forbidden) {
  const u = (url || '').toLowerCase();
  return (forbidden || []).some((f) => f && u.includes(f.toLowerCase()));
}

for (const s of scenarios) {
  const label = s.id || s.userMessage.slice(0, 40);
  if (s.optional && !s.mustContainUrlHost) {
    const parsed = parseJurisdiction(s.userMessage);
    if (s.expectedCounty && parsed.county) {
      const found = findPropertyURL(parsed.county, parsed.state || s.expectedState);
      if (found.url && !isGoogleFallbackUrl(found.url)) {
        console.log(`SKIP optional (has URL) ${label}`);
        skipped++;
        continue;
      }
    }
    console.log(`SKIP optional ${label}`);
    skipped++;
    continue;
  }

  const parsed = parseJurisdiction(s.userMessage);
  const countyOk =
    !s.expectedCounty ||
    (parsed.county || '').toLowerCase() === s.expectedCounty.toLowerCase();
  const stateOk = !s.expectedState || parsed.state === s.expectedState;

  if (!countyOk || !stateOk) {
    console.error(`FAIL ${label} parse: got ${parsed.county}, ${parsed.state}`);
    failed++;
    continue;
  }

  const found = findPropertyURL(parsed.county, parsed.state);
  const confOk =
    found.confidence === 'verified' || found.confidence === 'pattern_matched';
  const urlOk = hostOk(found.url, s.mustContainUrlHost);
  const forbidOk = !hostForbidden(found.url, s.forbiddenHosts);

  if (!confOk || !urlOk || !forbidOk) {
    console.error(`FAIL ${label}`);
    console.error('  conf:', found.confidence, 'url:', found.url);
    failed++;
    continue;
  }

  const match = matchScenario(s.userMessage);
  if (s.intent && match.intent !== s.intent && s.intent !== 'pay_taxes') {
    console.log(`WARN ${label} intent: expected ${s.intent}, got ${match.intent}`);
  }

  console.log(`PASS ${label} → ${found.url?.slice(0, 56)}…`);
  passed++;
}

const offTopic = (raw.scenarios || raw).find((s) => s.expectNoUrl);
if (offTopic) {
  const p = parseJurisdiction(offTopic.userMessage);
  if (!p.county) {
    console.log('PASS off_topic parse (no jurisdiction)');
    passed++;
  } else {
    console.error('FAIL off_topic should not parse county');
    failed++;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped optional`);
if (failed) process.exit(1);
