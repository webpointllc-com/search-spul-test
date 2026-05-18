#!/usr/bin/env node
/**
 * HTTP probe counties.json searchURL entries; write validation_report.ndjson.
 * Read-only on counties.json (Lane B may run after IMPORT_COMPLETE).
 *
 * Usage:
 *   node scripts/validate-counties-batch.js [--limit 200] [--offset 0]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { loadCountiesFile, REPO_ROOT } = require('./import-lib');

const REPORT_PATH = path.join(REPO_ROOT, 'data', 'validation_report.ndjson');
const CONCURRENCY = 8;
const TIMEOUT_MS = 12000;

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const LIMIT = parseInt(argValue('--limit', '0'), 10) || 0;
const OFFSET = parseInt(argValue('--offset', '0'), 10) || 0;

const VENDOR_PATTERNS = [
  { id: 'spatialest', re: /spatialest\.com/i },
  { id: 'sdttc_webpayments', re: /sdttc\.com|wps\.sdttc|webpayments/i },
  { id: 'esearch', re: /esearch/i },
  { id: 'qpublic', re: /qpublic/i },
  { id: 'beacon', re: /beacon\.|schneidercorp/i },
  { id: 'countygovservices', re: /countygovservices/i }
];

const SEARCH_PATH_SIGNALS = /\/search\b|webpayments|propertysearch|parcel|account|esearch|qpublic|spatialest/i;
const ASSESSOR_HOMEPAGE = /\/assessor\/?$|arcc\.|denvergov\.org\/assessor/i;

function scoreUrl(url, vendorField) {
  let score = 0;
  const reasons = [];
  const u = (url || '').toLowerCase();

  for (const v of VENDOR_PATTERNS) {
    if (v.re.test(u)) {
      score += 30;
      reasons.push(`vendor:${v.id}`);
      break;
    }
  }
  if (vendorField && VENDOR_PATTERNS.some((v) => v.id === vendorField)) {
    score += 10;
    reasons.push(`db_vendor:${vendorField}`);
  }
  if (SEARCH_PATH_SIGNALS.test(u)) {
    score += 25;
    reasons.push('search_path');
  }
  if (ASSESSOR_HOMEPAGE.test(u) && !SEARCH_PATH_SIGNALS.test(u)) {
    score -= 40;
    reasons.push('demote_assessor_homepage');
  }
  if (/\/assessor\b/.test(u) && !/\/search\b/.test(u)) {
    score -= 20;
    reasons.push('assessor_no_search');
  }

  return { score, reasons };
}

function probe(url) {
  return new Promise((resolve) => {
    let lib;
    try {
      lib = new URL(url).protocol === 'https:' ? https : http;
    } catch (e) {
      return resolve({ ok: false, status: 0, error: 'invalid_url' });
    }
    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'SPUL-ValidateBatch/1.0' },
        timeout: TIMEOUT_MS
      },
      (res) => {
        res.resume();
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
    req.end();
  });
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main() {
  const counties = loadCountiesFile();
  let slice = counties.slice(OFFSET);
  if (LIMIT > 0) slice = slice.slice(0, LIMIT);

  console.log(`Validating ${slice.length} counties (offset ${OFFSET}, total ${counties.length})…`);

  const rows = await mapPool(slice, CONCURRENCY, async (c) => {
    const url = c.searchURL;
    const { score, reasons } = scoreUrl(url, c.vendor);
    const httpResult = await probe(url);
    const pass = httpResult.ok && score >= 15;
    const reason = !httpResult.ok
      ? httpResult.error || `http_${httpResult.status}`
      : score < 15
        ? `low_score:${reasons.join(',')}`
        : 'ok';

    return {
      state: c.state,
      county: c.county,
      searchURL: url,
      verified: Boolean(c.verified),
      vendor: c.vendor || '',
      httpStatus: httpResult.status || 0,
      score,
      pass,
      reason,
      signals: reasons
    };
  });

  const lines = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(REPORT_PATH, lines);

  const passed = rows.filter((r) => r.pass).length;
  const rate = rows.length ? ((passed / rows.length) * 100).toFixed(1) : '0.0';
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Pass: ${passed}/${rows.length} (${rate}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
