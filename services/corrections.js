const fs = require('fs');
const path = require('path');
const {
  GOLDEN_PATH,
  COUNTIES_PATH,
  normalizeKey,
  dedupeKey,
  loadGoldenOverrides,
  isCountiesJsonLocked,
  detectVendor,
  inferEntityType
} = require('../scripts/import-lib');
const { invalidateCountiesCache } = require('./urlFinder');

const VALID_SOURCES = new Set(['agent5', 'frontend', 'validation', 'worker2', 'worker3', 'manual']);

function saveGoldenOverrides(map) {
  const obj = {};
  for (const [key, val] of map.entries()) {
    obj[key] = val;
  }
  fs.writeFileSync(GOLDEN_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function patchCountiesRow(state, county, patch) {
  if (isCountiesJsonLocked()) {
    return { ok: false, error: 'data/counties.json is locked by another lane' };
  }
  const counties = JSON.parse(fs.readFileSync(COUNTIES_PATH, 'utf8'));
  const key = dedupeKey(state, county);
  let idx = counties.findIndex((c) => dedupeKey(c.state, c.county) === key);
  const row = idx >= 0 ? { ...counties[idx] } : {
    state: state.toUpperCase().trim(),
    county: county.trim(),
    entityType: 'tax_collector',
    entity: '',
    entityNote: '',
    vendor: '',
    searchURL: '',
    verified: false
  };

  if (patch.searchURL) row.searchURL = patch.searchURL;
  if (patch.rejectURLs) {
    const prev = Array.isArray(row.rejectURLs) ? row.rejectURLs : [];
    row.rejectURLs = [...new Set([...prev, ...patch.rejectURLs])];
  }
  if (patch.entity) row.entity = patch.entity;
  if (patch.entityNote) row.entityNote = patch.entityNote;
  if (patch.vendor) row.vendor = patch.vendor;
  row.verified = true;
  row.entityType = patch.entityType || row.entityType || inferEntityType(row.entity, row.entityNote, row.searchURL);
  row.vendor = row.vendor || detectVendor(row.searchURL);
  row.lastChecked = new Date().toISOString().slice(0, 10);
  row.importSource = 'correction_api';

  if (idx >= 0) counties[idx] = row;
  else counties.push(row);

  fs.writeFileSync(COUNTIES_PATH, JSON.stringify(counties, null, 2) + '\n', 'utf8');
  invalidateCountiesCache();
  return { ok: true, row };
}

/**
 * Upsert golden_overrides + matching counties.json row.
 * @returns {{ ok: boolean, key?: string, lookup?: object, error?: string }}
 */
function applyCorrection(body) {
  const state = (body.state || '').toUpperCase().trim();
  const county = (body.county || '').trim();
  const searchURL = (body.searchURL || '').trim();
  const source = (body.source || 'frontend').toLowerCase();
  const note = body.note ? String(body.note).trim() : '';

  if (!state || !county || !searchURL) {
    return { ok: false, error: 'state, county, and searchURL are required' };
  }
  if (!/^https?:\/\//i.test(searchURL)) {
    return { ok: false, error: 'searchURL must be http(s)' };
  }
  if (!VALID_SOURCES.has(source)) {
    return { ok: false, error: `source must be one of: ${[...VALID_SOURCES].join(', ')}` };
  }

  const rejectURLs = Array.isArray(body.rejectURLs)
    ? body.rejectURLs.map((u) => String(u).trim()).filter(Boolean)
    : [];

  const key = normalizeKey(state, county);
  const goldenMap = loadGoldenOverrides();
  const prev = goldenMap.get(key) || { county, state };

  goldenMap.set(key, {
    county: prev.county || county,
    state: prev.state || state,
    searchURL,
    rejectURLs: rejectURLs.length ? rejectURLs : prev.rejectURLs || [],
    verified: true,
    entityNote: note || prev.entityNote || `Corrected via ${source}`,
    vendor: detectVendor(searchURL) || prev.vendor || '',
    entity: prev.entity || `${county}, ${state} property tax search`,
    correctedAt: new Date().toISOString(),
    correctionSource: source
  });

  saveGoldenOverrides(goldenMap);

  const patchResult = patchCountiesRow(state, county, {
    searchURL,
    rejectURLs,
    entityNote: note || undefined,
    vendor: detectVendor(searchURL)
  });
  if (!patchResult.ok) {
    return patchResult;
  }

  const { findPropertyURL } = require('./urlFinder');
  const lookup = findPropertyURL(county, state);
  return { ok: true, key, lookup, countiesPatched: true };
}

module.exports = { applyCorrection, VALID_SOURCES };
