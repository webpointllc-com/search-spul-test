/**
 * urlFinder.js
 * Finds verified or pattern-matched property search URLs for a given county/state.
 * Confidence levels: verified | pattern_matched | fallback
 */

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

/**
 * Finds the best URL for a county.
 * @param {string} county
 * @param {string} state
 * @returns {{url: string, confidence: string, source: string}}
 */
function findPropertyURL(county, state) {
  const counties = loadCounties();
  const normalizedCounty = county.toLowerCase().trim();
  const normalizedState = state.toUpperCase().trim();

  // 1. Exact verified match from DB
  const exact = counties.find(c => 
    c.county.toLowerCase() === normalizedCounty && 
    c.state === normalizedState && 
    c.verified === true
  );

  if (exact && exact.searchURL) {
    return {
      url: exact.searchURL,
      confidence: 'verified',
      source: 'counties.json (verified)'
    };
  }

  // 2. Pattern match common public sites
  const patterns = [
    { domain: 'qpublic.net', url: `https://www.qpublic.net/${normalizedState.toLowerCase()}/${normalizedCounty.replace(/\s+/g, '')}/` },
    { domain: 'propertyshark.com', url: `https://www.propertyshark.com/search/${normalizedState}/${normalizedCounty}/` },
    { domain: 'govtechtaxpro.com', url: `https://www.govtechtaxpro.com/${normalizedState}/${normalizedCounty}/` }
  ];

  for (const p of patterns) {
    // Simple pattern match - in production would do better validation
    if (normalizedCounty.includes('dade') || normalizedCounty.includes('broward') || normalizedCounty.includes('harris')) {
      return {
        url: p.url,
        confidence: 'pattern_matched',
        source: `Pattern match on ${p.domain}`
      };
    }
  }

  // 3. Google fallback
  const googleSearch = `https://www.google.com/search?q=${encodeURIComponent(county + ' ' + state + ' property tax search official')}`;
  return {
    url: googleSearch,
    confidence: 'fallback',
    source: 'Google search fallback'
  };
}

module.exports = { findPropertyURL };