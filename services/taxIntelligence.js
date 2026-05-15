/**
 * taxIntelligence.js
 * Injects county-specific tax intelligence into the Groq system prompt.
 * Runs before every chat completion.
 */

const fs = require('fs');
const path = require('path');
const { findPropertyURL } = require('./urlFinder');

const statutesPath = path.join(__dirname, '../data/statutes.json');
let statutesCache = null;

function loadStatutes() {
  if (!statutesCache) {
    statutesCache = JSON.parse(fs.readFileSync(statutesPath, 'utf8'));
  }
  return statutesCache;
}

/**
 * Builds enriched system prompt with tax data.
 * @param {string} userMessage
 * @param {string} county
 * @param {string} state
 * @returns {string} enriched system prompt
 */
function enrichSystemPrompt(userMessage, county = null, state = null) {
  const basePrompt = `You are Spul, a helpful AI property tax intelligence assistant.
Be concise, accurate, and cite sources when possible.`;

  if (!county || !state) {
    return basePrompt + `

No specific county selected. Use general knowledge. Always add disclaimer: "This is general information only. Verify with official county records."`;
  }

  const statutes = loadStatutes();
  const stateData = statutes[state.toUpperCase()];
  const urlResult = findPropertyURL(county, state);

  let injection = `

**County Intelligence Injection**:
- County: ${county}, ${state}
- Official Search URL: ${urlResult.url} (confidence: ${urlResult.confidence})
`;

  if (stateData) {
    injection += `- Statutes: ${stateData.statutes}
- Lien Priority: ${stateData.lienPriority}
- Redemption Period: ${stateData.redemptionPeriodDays} days
- Interest/Penalty: ${stateData.interestRateCap}
- Sale Process: ${stateData.saleProcess}
`;
  } else {
    injection += `- Using general state-level knowledge for ${state}.
`;
  }

  injection += `
Always include the official URL and confidence level in your response when relevant.
Source tag: ${urlResult.confidence === 'verified' ? 'Verified DB' : urlResult.confidence === 'pattern_matched' ? 'Pattern Match' : 'AI Knowledge'}`;

  return basePrompt + injection;
}

module.exports = { enrichSystemPrompt };