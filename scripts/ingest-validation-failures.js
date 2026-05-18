#!/usr/bin/env node
/**
 * Worker 2 → correction queue ingest.
 * Reads pay_taxes_validation_report.ndjson and/or incorrect_pay_taxes_search.json.
 * Enqueues failures as pending; does NOT apply without proposedURL.
 */
const fs = require('fs');
const path = require('path');
const { readNdjson } = require('./import-lib');
const { enqueue, mergeQueueById, readRawQueue, regenerateTodo } = require('../services/correctionQueue');

const REPO = path.join(__dirname, '..');
const NDJSON_PATH = path.join(REPO, 'data', 'pay_taxes_validation_report.ndjson');
const INCORRECT_PATH = path.join(REPO, 'data', 'incorrect_pay_taxes_search.json');

const HIGH_CONFIDENCE_VENDORS = [
  {
    vendor: 'countygovservices',
    test: (row) => (row.vendor === 'countygovservices' || /countygovservices\.com/i.test(row.searchURL || '')),
    propose: (row) => {
      const countySlug = String(row.county || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      if (!countySlug) return null;
      return `https://${countySlug}property.countygovservices.com/Property/Search`;
    }
  }
];

function existingPendingKeys() {
  const merged = mergeQueueById(readRawQueue());
  const keys = new Set();
  for (const r of merged) {
    if (r.status !== 'pending' && r.status !== 'in_progress') continue;
    keys.add(`${r.state}|${r.county}|${r.currentURL || ''}`);
  }
  return keys;
}

function inferProposedURL(row) {
  for (const rule of HIGH_CONFIDENCE_VENDORS) {
    if (rule.test(row)) {
      const url = rule.propose(row);
      if (url && url !== row.searchURL) return { proposedURL: url, reason: `high-confidence vendor pattern: ${rule.vendor}` };
    }
  }
  return { proposedURL: null, reason: null };
}

function rowToQueueItem(row, source = 'worker2') {
  const state = (row.state || '').toUpperCase().trim();
  const county = (row.county || '').trim();
  const currentURL = (row.searchURL || '').trim();
  const classification = row.classification || '';
  const reasons = Array.isArray(row.reasons) ? row.reasons.join('; ') : '';
  const inferred = inferProposedURL(row);
  const reason =
    inferred.reason ||
    `validation fail: ${classification}${reasons ? ` — ${reasons}` : ''}`;

  return {
    state,
    county,
    currentURL,
    proposedURL: row.proposedURL || inferred.proposedURL || null,
    reason,
    source,
    status: 'pending',
    intent: 'pay_taxes_search_by_name',
    classification
  };
}

function loadFailures() {
  const failures = [];
  if (fs.existsSync(NDJSON_PATH)) {
    for (const row of readNdjson(NDJSON_PATH)) {
      if (row.pass === false || row.pass === 'false') failures.push(row);
    }
  }
  if (fs.existsSync(INCORRECT_PATH)) {
    const bundle = JSON.parse(fs.readFileSync(INCORRECT_PATH, 'utf8'));
    for (const row of bundle.incorrect || []) {
      failures.push(row);
    }
  }
  return failures;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const failures = loadFailures();
  const seen = existingPendingKeys();
  let enqueued = 0;
  let skipped = 0;
  const samples = [];
  const allItems = [];

  for (const row of failures) {
    const item = rowToQueueItem(row);
    const key = `${item.state}|${item.county}|${item.currentURL || ''}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    allItems.push(item);
    if (dryRun) {
      enqueued += 1;
      continue;
    }
    const result = enqueue(item);
    if (result.ok) {
      enqueued += 1;
      if (samples.length < 5) samples.push(result.item);
    }
  }

  if (!dryRun) regenerateTodo();

  const statsSource = dryRun ? allItems : allItems;
  const out = {
    ok: true,
    dryRun,
    failureRowsRead: failures.length,
    enqueued,
    skippedDuplicate: skipped,
    withProposedURL: statsSource.filter((r) => r.proposedURL).length,
    blockedNoProposedURL: statsSource.filter((r) => !r.proposedURL).length,
    sample: (dryRun ? allItems : samples).slice(0, 5)
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
