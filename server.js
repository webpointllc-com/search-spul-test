const fs = require('fs');
const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const { OpenAI } = require('openai');
const { enrichSystemPrompt, enforceLockedSpulUrl } = require('./services/taxIntelligence');
const { parseJurisdiction, lookupForApi } = require('./services/urlFinder');
const { hasUrlLock, buildLockedUrlPrefix } = require('./services/spulTruth');
const { matchScenario } = require('./services/scenarioRouter');
const { applyCorrection } = require('./services/corrections');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

app.use(cookieSession({
  name: 'spul-session',
  keys: [process.env.SESSION_SECRET || 'super-long-random-secret-change-in-prod'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
}));

app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

app.get('/api/hero-examples', (req, res) => {
  const { getHeroExamples } = require('./services/scenarioRouter');
  res.json({ examples: getHeroExamples(4) });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let history = req.session.history || [];
    let jurisdiction = req.session.jurisdiction || { county: null, state: null };

    const scenarioMatch = matchScenario(message.trim());
    const parsed = parseJurisdiction(message.trim());
    if (parsed.county) {
      jurisdiction = parsed;
      req.session.jurisdiction = jurisdiction;
    }

    const lookup = jurisdiction.county
      ? lookupForApi(jurisdiction.county, jurisdiction.state)
      : null;
    const urlLocked = lookup && hasUrlLock(lookup.confidence, lookup.url);

    const systemContent = enrichSystemPrompt(jurisdiction.county, jurisdiction.state, {
      scenarioMatch
    });
    const systemPrompt = { role: 'system', content: systemContent };

    const userContent =
      urlLocked && lookup.url
        ? `${message.trim()}\n\n[URL already verified in SPUL database. Output SPUL_ENTITY, SPUL_CONFIDENCE, SPUL_ACTIONS, SPUL_CONTEXT only — SPUL_URL is locked to: ${lookup.url}]`
        : message.trim();

    const messagesForAPI = [systemPrompt, ...history, { role: 'user', content: userContent }];

    const stream = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messagesForAPI,
      temperature: 0.1,
      max_tokens: 600,
      stream: true,
    });

    let fullResponse = urlLocked && lookup.url
      ? buildLockedUrlPrefix(lookup.url, lookup.confidence, lookup.entity)
      : '';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    if (urlLocked && lookup.url) {
      res.write(`data: ${JSON.stringify({ type: 'meta', scenarioId: scenarioMatch.scenarioId, urlLocked: true })}\n\n`);
    }

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: delta })}\n\n`);
      }
    }

    if (urlLocked && lookup.url) {
      fullResponse = enforceLockedSpulUrl(fullResponse, lookup.url, lookup.confidence);
    }

    res.write(`data: ${JSON.stringify({ type: 'done', scenarioId: scenarioMatch.scenarioId })}\n\n`);
    res.end();

    history.push({ role: 'user', content: message.trim() });
    history.push({ role: 'assistant', content: fullResponse });
    if (history.length > 20) history = history.slice(-20);
    req.session.history = history;

  } catch (error) {
    console.error('Groq error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate response' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Connection error. Please try again.' })}\n\n`);
      res.end();
    }
  }
});

app.get('/api/history', (req, res) => {
  res.json({ history: req.session.history || [] });
});

app.get('/api/lookup', (req, res) => {
  const message = (req.query.q || req.query.message || '').trim();
  const county = (req.query.county || '').trim();
  const state = (req.query.state || '').trim();

  let jurisdiction = { county: county || null, state: state || null };
  const scenarioMatch = message ? matchScenario(message) : null;
  if (message) {
    const parsed = parseJurisdiction(message);
    if (parsed.county) jurisdiction = parsed;
  }
  if (!jurisdiction.county) {
    return res.status(400).json({
      ok: false,
      error: 'Provide q= (message) or county= and state='
    });
  }

  const result = lookupForApi(jurisdiction.county, jurisdiction.state);
  res.json({
    ok: true,
    jurisdiction,
    scenarioId: scenarioMatch?.scenarioId || null,
    intent: scenarioMatch?.intent || null,
    ...result
  });
});

app.post('/api/corrections', (req, res) => {
  const result = applyCorrection(req.body || {});
  if (!result.ok) {
    return res.status(result.error?.includes('locked') ? 409 : 400).json(result);
  }
  const lookup = lookupForApi(
    req.body.county || result.lookup?.county,
    req.body.state || result.lookup?.state
  );
  res.json({ ...result, lookup });
});

app.post('/api/scenario-test', (req, res) => {
  const message = (req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ ok: false, error: 'message required' });
  }
  const scenarioMatch = matchScenario(message);
  const parsed = parseJurisdiction(message);
  const jurisdiction = parsed.county
    ? { county: parsed.county, state: parsed.state }
    : { county: null, state: null };
  const lookup = jurisdiction.county
    ? lookupForApi(jurisdiction.county, jurisdiction.state)
    : null;
  const systemPrompt = enrichSystemPrompt(jurisdiction.county, jurisdiction.state, {
    scenarioMatch
  });
  res.json({
    ok: true,
    scenario: scenarioMatch,
    jurisdiction,
    lookup,
    systemPromptPreview: systemPrompt.slice(0, 2000)
  });
});

app.post('/api/flag', (req, res) => {
  const { county, state, wrongUrl, note } = req.body || {};
  if (!county || !state || !wrongUrl) {
    return res.status(400).json({ ok: false, error: 'county, state, and wrongUrl required' });
  }
  const flagsPath = path.join(__dirname, 'data', 'url_flags.jsonl');
  const entry = {
    ts: new Date().toISOString(),
    county: String(county).trim(),
    state: String(state).toUpperCase().trim(),
    wrongUrl: String(wrongUrl).trim(),
    note: note ? String(note).trim() : ''
  };
  try {
    fs.appendFileSync(flagsPath, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('flag write:', e);
    return res.status(500).json({ ok: false, error: 'Could not record flag' });
  }
  const corrected = lookupForApi(entry.county, entry.state);
  res.json({
    ok: true,
    message: 'Flag recorded. Lookup still uses verified counties.json and rejectURLs.',
    preferred: corrected
  });
});

app.post('/api/new-search', (req, res) => {
  req.session.history = [];
  req.session.jurisdiction = { county: null, state: null };
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SPUL running on http://localhost:${PORT}`);
});
