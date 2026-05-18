const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const { OpenAI } = require('openai');
const { enrichSystemPrompt } = require('./services/taxIntelligence');
const { parseJurisdiction, findPropertyURL } = require('./services/urlFinder');
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

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let history = req.session.history || [];
    let jurisdiction = req.session.jurisdiction || { county: null, state: null };

    // Try to parse jurisdiction from the new message first
    const parsed = parseJurisdiction(message.trim());
    if (parsed.county) {
      jurisdiction = parsed;
      req.session.jurisdiction = jurisdiction;
    }

    const systemContent = enrichSystemPrompt(jurisdiction.county, jurisdiction.state);
    const systemPrompt = { role: 'system', content: systemContent };
    const messagesForAPI = [systemPrompt, ...history, { role: 'user', content: message.trim() }];

    const stream = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messagesForAPI,
      temperature: 0.1,
      max_tokens: 600,
      stream: true,
    });

    let fullResponse = '';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: delta })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
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

/** Direct counties.json lookup — no Groq; use for tests and UI prefetch. */
app.get('/api/lookup', (req, res) => {
  const message = (req.query.q || req.query.message || '').trim();
  const county = (req.query.county || '').trim();
  const state = (req.query.state || '').trim();

  let jurisdiction = { county: county || null, state: state || null };
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

  const result = findPropertyURL(jurisdiction.county, jurisdiction.state);
  res.json({
    ok: true,
    jurisdiction,
    ...result
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
