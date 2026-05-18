#!/usr/bin/env node
/**
 * Validate counties.json searchURL against user intent:
 * "Pay my property taxes {county}, {state}" — last-name / owner search with real tax bills.
 *
 * Usage:
 *   node scripts/validate-pay-taxes-search.js [--limit 300] [--offset 0]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { loadCountiesFile, REPO_ROOT, masterKey } = require('./import-lib');

const REPORT_PATH = path.join(REPO_ROOT, 'data', 'pay_taxes_validation_report.ndjson');
const INCORRECT_PATH = path.join(REPO_ROOT, 'data', 'incorrect_pay_taxes_search.json');
const CONCURRENCY = 8;
const TIMEOUT_MS = 12000;
const MAX_BODY = 600000;
const THIN_HTML = 2500;

const CONTROL_KEYS = new Set(['CA-SanDiego', 'CO-Denver']);

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const LIMIT = parseInt(argValue('--limit', '0'), 10) || 0;
const OFFSET = parseInt(argValue('--offset', '0'), 10) || 0;

const POSITIVE = [
  { re: /last\s*name|lastname|owner\s*name|ownername|name\s*of\s*owner|search\s*by\s*name/i, w: 28, tag: 'name_search' },
  { re: /name=["'][^"']*last|placeholder=["'][^"']*last\s*name/i, w: 22, tag: 'name_input_attr' },
  { re: /parcel|account\s*#|account\s*number|tax\s*id|property\s*id|apn\b|folio/i, w: 18, tag: 'parcel_account' },
  { re: /tax\s*bill|amount\s*due|total\s*due|balance\s*due|pay\s*taxes|pay\s*online|make\s*a\s*payment/i, w: 20, tag: 'tax_bill_pay' },
  { re: /treasurer|tax\s*collector|tax\s*office|revenue\s*commissioner/i, w: 16, tag: 'collector_entity' },
  { re: /webpayments|wps\.sdttc|sdttc\.com/i, w: 30, tag: 'vendor_sdttc' },
  { re: /spatialest|property\.spatialest/i, w: 30, tag: 'vendor_spatialest' },
  { re: /esearch|qpublic|beacon\.schneidercorp/i, w: 22, tag: 'vendor_search_portal' },
  { re: /property\s*search|search\s*property|search\s*for\s*property|record\s*search/i, w: 14, tag: 'property_search' }
];

const NEGATIVE = [
  { re: /\bcentral\s*appraisal\s*district\b|\bappraisal\s*district\b|\bcad\b/i, w: 22, tag: 'cad_only' },
  { re: /property\s*appraiser|assessor['\s-]*recorder|office\s*of\s*the\s*assessor/i, w: 18, tag: 'assessor_entity' },
  { re: /assessed\s*value|market\s*value|homestead\s*exemption|exemption\s*application/i, w: 12, tag: 'appraisal_values' },
  { re: /\/about\b|about\s+us|contact\s+us|staff\s+directory|news\s+&?\s*events/i, w: 14, tag: 'brochure_page' },
  { re: /arcc\.sandiegocounty\.gov/i, w: 40, tag: 'arcc_assessor' },
  { re: /denvergov\.org\/assessor/i, w: 40, tag: 'denver_assessor' },
  { re: /pay\s*only|payment\s*portal(?![\s\S]{0,400}(search|parcel|owner|last))/i, w: 10, tag: 'pay_only_hint' }
];

function suggestedQuery(county, state) {
  return `pay my property taxes ${county}, ${state}`;
}

function fetchHtml(url) {
  return new Promise((resolve) => {
    let lib;
    try {
      lib = new URL(url).protocol === 'https:' ? https : http;
    } catch {
      return resolve({ ok: false, status: 0, error: 'invalid_url', body: '' });
    }
    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'SPUL', Accept: 'text/html,*/*' },
        timeout: TIMEOUT_MS
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size <= MAX_BODY) chunks.push(chunk);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            body,
            finalUrl: url
          });
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message, body: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout', body: '' });
    });
    req.end();
  });
}

function urlSignals(url) {
  const u = (url || '').toLowerCase();
  const tags = [];
  let score = 0;
  if (/webpayments|wps\.sdttc|sdttc\.com/.test(u)) {
    score += 35;
    tags.push('url_sdttc');
  }
  if (/spatialest\.com/.test(u) && /\/search|#\/|denver|property/.test(u)) {
    score += 35;
    tags.push('url_spatialest');
  }
  if (/\/search\b|esearch|qpublic|propertysearch|webpayments/.test(u)) {
    score += 20;
    tags.push('url_search_path');
  }
  if (/arcc\.sandiegocounty|denvergov\.org\/assessor/.test(u)) {
    score -= 50;
    tags.push('url_bad_assessor');
  }
  if (/\/assessor\b/.test(u) && !/\/search\b|webpayments|spatialest/.test(u)) {
    score -= 30;
    tags.push('url_assessor_path');
  }
  if (/\/cad\b|appraisaldistrict|cad\.org/.test(u)) {
    score -= 25;
    tags.push('url_cad');
  }
  return { score, tags };
}

function scoreHtml(html, url) {
  const text = (html || '').slice(0, MAX_BODY);
  const blob = `${text}\n${url}`.toLowerCase();
  let score = 0;
  const reasons = [];

  for (const p of POSITIVE) {
    if (p.re.test(blob)) {
      score += p.w;
      reasons.push(`+${p.tag}`);
    }
  }
  for (const n of NEGATIVE) {
    if (n.re.test(blob)) {
      score -= n.w;
      reasons.push(`-${n.tag}`);
    }
  }

  const hasName =
    /last\s*name|lastname|owner\s*name|search\s*by\s*name|name\s*of\s*owner/i.test(blob) ||
    /name=["'][^"']*last|placeholder=["'][^"']*last/i.test(blob);
  const hasParcel = /parcel|account\s*number|tax\s*id|apn\b|folio/i.test(blob);
  const hasTaxPay = /tax\s*bill|amount\s*due|pay\s*tax|pay\s*online|treasurer|tax\s*collector/i.test(blob);
  const hasPayOnly =
    /pay\s*online|make\s*a\s*payment|payment\s*portal/i.test(blob) && !hasName && !hasParcel;

  const thin = text.length < THIN_HTML;
  const trustedVendorUrl =
    /webpayments|wps\.sdttc|sdttc\.com|spatialest\.com/i.test(url) &&
    /\/search|webpayments|spatialest|#\/|esearch/i.test(url);

  return {
    score,
    reasons,
    hasName,
    hasParcel,
    hasTaxPay,
    hasPayOnly,
    thin,
    trustedVendorUrl
  };
}

function classify({ httpOk, httpError, status, url, vendor, urlScore, htmlScore, html }) {
  const reasons = [...urlScore.tags, ...htmlScore.reasons];

  if (!httpOk) {
    return {
      classification: 'fail_http',
      score: -100,
      reasons: [...reasons, httpError || `http_${status}`]
    };
  }

  const total = urlScore.score + htmlScore.score;

  if (htmlScore.trustedVendorUrl && (htmlScore.thin || htmlScore.score < 20)) {
    return { classification: 'pass', score: total + 40, reasons: [...reasons, 'trusted_js_vendor'] };
  }

  if (/arcc\.sandiegocounty|denvergov\.org\/assessor/i.test(url)) {
    return {
      classification: 'fail_assessor_not_collector',
      score: total - 50,
      reasons: [...reasons, 'known_wrong_assessor_url']
    };
  }

  if (
    urlScore.tags.includes('url_assessor_path') ||
    urlScore.tags.includes('url_cad') ||
    (htmlScore.reasons.some((r) => r.includes('assessor') || r.includes('cad')) &&
      !htmlScore.hasTaxPay &&
      !htmlScore.trustedVendorUrl)
  ) {
    return {
      classification: 'fail_assessor_not_collector',
      score: total - 30,
      reasons: [...reasons, 'assessor_or_cad_dominant']
    };
  }

  if (htmlScore.thin && !htmlScore.trustedVendorUrl) {
    return {
      classification: 'fail_js_shell',
      score: total - 20,
      reasons: [...reasons, 'thin_html_untrusted']
    };
  }

  if (htmlScore.hasPayOnly && !htmlScore.hasName && !htmlScore.hasParcel) {
    return {
      classification: 'fail_pay_only',
      score: total - 25,
      reasons: [...reasons, 'pay_without_lookup']
    };
  }

  if (!htmlScore.hasName && !htmlScore.hasParcel && htmlScore.hasTaxPay) {
    return {
      classification: 'fail_no_name_search',
      score: total - 15,
      reasons: [...reasons, 'tax_signals_no_name_or_parcel']
    };
  }

  if (!htmlScore.hasName && !htmlScore.hasParcel && total < 25) {
    return {
      classification: 'fail_no_name_search',
      score: total,
      reasons: [...reasons, 'low_score_no_search_fields']
    };
  }

  if (total >= 35 || (htmlScore.hasName && htmlScore.hasTaxPay) || (htmlScore.hasParcel && htmlScore.hasTaxPay)) {
    return { classification: 'pass', score: total, reasons };
  }

  if (htmlScore.hasParcel && total >= 20) {
    return { classification: 'pass', score: total, reasons: [...reasons, 'parcel_search_ok'] };
  }

  return {
    classification: 'fail_no_name_search',
    score: total,
    reasons: [...reasons, 'below_pass_threshold']
  };
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

function buildIncorrectReport(rows) {
  const failures = rows
    .filter((r) => r.classification !== 'pass')
    .sort((a, b) => a.score - b.score);

  const controls = rows.filter((r) => CONTROL_KEYS.has(r.key) || r.is_control);
  const top = failures.slice(0, 100);

  return {
    generated_at: new Date().toISOString(),
    intent: 'pay my property taxes {county}, {state} — last-name search with tax bill records',
    total_validated: rows.length,
    pass_count: rows.filter((r) => r.classification === 'pass').length,
    failure_count: failures.length,
    controls: controls.map((c) => ({
      key: c.key,
      county: c.county,
      state: c.state,
      searchURL: c.searchURL,
      classification: c.classification,
      score: c.score
    })),
    incorrect: top.map((r) => ({
      key: r.key,
      county: r.county,
      state: r.state,
      searchURL: r.searchURL,
      classification: r.classification,
      score: r.score,
      reasons: r.reasons,
      suggested_query: r.suggested_query,
      verified: r.verified,
      vendor: r.vendor
    }))
  };
}

async function main() {
  const counties = loadCountiesFile();
  let slice = counties.slice(OFFSET);
  if (LIMIT > 0) slice = slice.slice(0, LIMIT);

  console.log(`Pay-taxes validation: ${slice.length} counties (offset ${OFFSET}, db ${counties.length})…`);

  const rows = await mapPool(slice, CONCURRENCY, async (c) => {
    const key = c.key || masterKey(c.state, c.county);
    const sq = suggestedQuery(c.county, c.state);
    const http = await fetchHtml(c.searchURL);
    const uSig = urlSignals(c.searchURL);
    const hSig = scoreHtml(http.body, c.searchURL);
    const { classification, score, reasons } = classify({
      httpOk: http.ok,
      httpError: http.error,
      status: http.status,
      url: c.searchURL,
      vendor: c.vendor,
      urlScore: uSig,
      htmlScore: hSig
    });

    return {
      key,
      state: c.state,
      county: c.county,
      searchURL: c.searchURL,
      verified: Boolean(c.verified),
      vendor: c.vendor || '',
      httpStatus: http.status || 0,
      classification,
      pass: classification === 'pass',
      score,
      reasons,
      suggested_query: sq,
      is_control: CONTROL_KEYS.has(key)
    };
  });

  const reportLines = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(REPORT_PATH, reportLines);

  const incorrectDoc = buildIncorrectReport(rows);
  fs.writeFileSync(INCORRECT_PATH, JSON.stringify(incorrectDoc, null, 2) + '\n');

  const passed = rows.filter((r) => r.pass).length;
  const rate = rows.length ? ((passed / rows.length) * 100).toFixed(1) : '0.0';
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Wrote ${INCORRECT_PATH}`);
  console.log(`Pass: ${passed}/${rows.length} (${rate}%)`);
  const controls = incorrectDoc.controls;
  for (const c of controls) {
    console.log(`Control ${c.key}: ${c.classification} (${c.score})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
