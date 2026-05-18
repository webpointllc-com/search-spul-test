#!/usr/bin/env node
/**
 * Golden county URL kit — asserts verified seeds in data/counties.json.
 * Run: npm run verify:golden
 */
const https = require('https');
const http = require('http');
const { findPropertyURL, parseJurisdiction, invalidateCountiesCache } = require('../services/urlFinder');

invalidateCountiesCache();

const GOLDEN = [
  {
    label: 'San Diego, CA',
    parseQuery: 'San Diego, CA',
    county: 'San Diego',
    state: 'CA',
    url: 'https://wps.sdttc.com/WebPayments/CoSDTreasurer2/search',
    reject: ['arcc.sandiegocounty.gov'],
    confidence: 'verified'
  },
  {
    label: 'Denver, CO',
    parseQuery: 'Denver, CO',
    county: 'Denver',
    state: 'CO',
    url: 'https://property.spatialest.com/co/denver#/',
    reject: ['denvergov.org/Assessor'],
    confidence: 'verified'
  },
  {
    label: 'pay my property taxes San Diego CA',
    parseQuery: 'pay my property taxes San Diego CA',
    county: 'San Diego',
    state: 'CA',
    url: 'https://wps.sdttc.com/WebPayments/CoSDTreasurer2/search',
    reject: ['arcc.sandiegocounty.gov'],
    confidence: 'verified'
  }
];

function normalizeUrl(u) {
  return (u || '').replace(/#\/$/, '#/').replace(/\/$/, '');
}

function headOk(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(
      url,
      { method: 'GET', headers: { 'User-Agent': 'SPUL-GoldenKit/1.0' }, timeout: 15000 },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

async function main() {
  let failed = 0;

  for (const g of GOLDEN) {
    const parsed = parseJurisdiction(g.parseQuery);
    const countyOk =
      (parsed.county || '').toLowerCase() === g.county.toLowerCase();
    const stateOk = parsed.state === g.state;
    if (!countyOk || !stateOk) {
      console.error(`FAIL parse ${g.label}: got ${parsed.county}, ${parsed.state}`);
      failed++;
      continue;
    }
    console.log(`PASS parse ${g.label}`);

    const found = findPropertyURL(g.county, g.state);
    const urlOk = normalizeUrl(found.url) === normalizeUrl(g.url);
    const confOk = found.confidence === g.confidence;
    const rejectOk = !(g.reject || []).some((frag) => (found.url || '').includes(frag));

    if (!urlOk || !confOk || !rejectOk) {
      console.error(`FAIL lookup ${g.label}`);
      console.error('  expected:', g.url, g.confidence);
      console.error('  got:     ', found.url, found.confidence);
      failed++;
    } else {
      console.log(`PASS lookup ${g.label} → ${found.url}`);
    }

    const httpCheck = await headOk(g.url);
    if (httpCheck.ok) {
      console.log(`PASS http ${g.label} (${httpCheck.status})`);
    } else {
      console.error(`WARN http ${g.label}:`, httpCheck.error || httpCheck.status);
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log(`\nAll ${GOLDEN.length} golden cases passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
