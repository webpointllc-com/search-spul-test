const fs = require('fs');
const path = require('path');

const countiesPath = path.join(__dirname, '../data/counties.json');
let countiesCache = null;

function loadCounties() {
  if (!countiesCache) {
    countiesCache = JSON.parse(fs.readFileSync(countiesPath, 'utf8'));
  }
  return countiesCache;
}

function findPropertyURL(county, state) {
  const counties = loadCounties();
  const normalizedCounty = county.toLowerCase().trim();
  const normalizedState = state ? state.toUpperCase().trim() : '';

  const meta = (c) => ({
    entityType: c.entityType || 'tax_collector',
    entityNote: c.entityNote || '',
    entity: c.entity || ''
  });

  // 1. Exact verified match
  const exact = counties.find(c =>
    c.county.toLowerCase() === normalizedCounty &&
    c.state === normalizedState &&
    c.verified === true
  );
  if (exact && exact.searchURL) {
    return { url: exact.searchURL, confidence: 'verified', source: 'SPUL database (verified)', ...meta(exact) };
  }

  // 2. Partial name match (handles dashes vs spaces, e.g. "miami-dade" vs "miami dade")
  const partial = counties.find(c => {
    const dbKey = c.county.toLowerCase().replace(/[-\s]+/g, '');
    const queryKey = normalizedCounty.replace(/[-\s]+/g, '');
    return dbKey === queryKey && (!normalizedState || c.state === normalizedState);
  });
  if (partial && partial.searchURL) {
    return {
      url: partial.searchURL,
      confidence: partial.verified ? 'verified' : 'pattern_matched',
      source: `SPUL database (${partial.verified ? 'verified' : 'needs verification'})`,
      ...meta(partial)
    };
  }

  // 3. Google fallback — honest, labeled as not_found
  const googleSearch = `https://www.google.com/search?q=${encodeURIComponent(
    `${county} ${state || ''} county tax assessor collector property search official site`.trim()
  )}`;
  return { url: googleSearch, confidence: 'not_found', source: 'No SPUL record — Google fallback', entityType: 'unknown', entityNote: '', entity: '' };
}

// Parse raw user message into { county, state }
function parseJurisdiction(message) {
  const msg = message.toLowerCase().trim();

  const stateMap = {
    'tx': 'TX', 'fl': 'FL', 'ga': 'GA', 'il': 'IL', 'ca': 'CA',
    'ny': 'NY', 'nc': 'NC', 'sc': 'SC', 'va': 'VA', 'pa': 'PA',
    'oh': 'OH', 'mi': 'MI', 'az': 'AZ', 'co': 'CO', 'wa': 'WA',
    'or': 'OR', 'tn': 'TN', 'al': 'AL', 'ms': 'MS', 'mo': 'MO',
    'la': 'LA', 'ar': 'AR', 'ok': 'OK', 'nm': 'NM', 'nv': 'NV',
    'ut': 'UT', 'id': 'ID', 'mt': 'MT', 'wy': 'WY', 'nd': 'ND',
    'sd': 'SD', 'ne': 'NE', 'ks': 'KS', 'mn': 'MN', 'ia': 'IA',
    'wi': 'WI', 'in': 'IN', 'ky': 'KY', 'wv': 'WV', 'md': 'MD',
    'de': 'DE', 'nj': 'NJ', 'ct': 'CT', 'ri': 'RI', 'ma': 'MA',
    'vt': 'VT', 'nh': 'NH', 'me': 'ME', 'hi': 'HI', 'ak': 'AK'
  };

  const stateNames = {
    'texas': 'TX', 'florida': 'FL', 'georgia': 'GA', 'illinois': 'IL',
    'california': 'CA', 'new york': 'NY', 'north carolina': 'NC',
    'south carolina': 'SC', 'virginia': 'VA', 'pennsylvania': 'PA',
    'ohio': 'OH', 'michigan': 'MI', 'arizona': 'AZ', 'colorado': 'CO',
    'washington': 'WA', 'oregon': 'OR', 'tennessee': 'TN', 'alabama': 'AL',
    'mississippi': 'MS', 'missouri': 'MO', 'louisiana': 'LA', 'arkansas': 'AR',
    'oklahoma': 'OK', 'new mexico': 'NM', 'nevada': 'NV', 'utah': 'UT',
    'new jersey': 'NJ', 'maryland': 'MD', 'minnesota': 'MN', 'wisconsin': 'WI',
    'indiana': 'IN', 'kentucky': 'KY', 'kansas': 'KS', 'nebraska': 'NE'
  };

  // CAD / appraisal district → always TX
  const cadMatch = /([a-z][a-z\s\-]+?)\s+(?:county\s+)?(?:cad|central appraisal district|appraisal district)/i.exec(msg);
  if (cadMatch) {
    const county = cadMatch[1].trim().replace(/\s*county\s*$/i, '').trim();
    return { county, state: 'TX' };
  }

  // "[name] county, ST" or "[name] county ST"
  const withState = /([a-z][a-z\s\-]+?)\s+county[\s,]+([a-z]{2})\b/i.exec(msg);
  if (withState) {
    const abbr = withState[2].toLowerCase();
    return { county: withState[1].trim(), state: stateMap[abbr] || abbr.toUpperCase() };
  }

  // "[name] county" alone — check for state name elsewhere in message
  const countyOnly = /([a-z][a-z\s\-]+?)\s+county/i.exec(msg);
  if (countyOnly) {
    let state = null;
    for (const [name, abbr] of Object.entries(stateNames)) {
      if (msg.includes(name)) { state = abbr; break; }
    }
    return { county: countyOnly[1].trim(), state };
  }

  // State name present without explicit "county" word
  for (const [name, abbr] of Object.entries(stateNames)) {
    if (msg.includes(name)) {
      const before = msg.split(name)[0].trim().split(/\s+/).slice(-3).join(' ')
        .replace(/[,]+$/, '').replace(/\bcounty\b/i, '').trim();
      if (before.length > 1) return { county: before, state: abbr };
    }
  }

  return { county: null, state: null };
}

module.exports = { findPropertyURL, parseJurisdiction };
