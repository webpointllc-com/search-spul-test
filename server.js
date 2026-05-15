const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const { OpenAI } = require('openai');
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

const SYSTEM_PROMPT = {
  role: "system",
  content: `You are Spul – a witty, concise, and extremely helpful AI search assistant for Search Spul.
You excel at instant answers and follow-up conversation. Be engaging and use markdown when helpful.`
};

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let history = req.session.history || [];

    const messagesForAPI = [SYSTEM_PROMPT, ...history, { role: "user", content: message.trim() }];

    const stream = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: messagesForAPI,
      temperature: 0.7,
      max_tokens: 1200,
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

    history.push({ role: "user", content: message.trim() });
    history.push({ role: "assistant", content: fullResponse });
    if (history.length > 30) history = history.slice(-30);
    req.session.history = history;

  } catch (error) {
    console.error('Groq error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate response' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Sorry, something went wrong.' })}\n\n`);
      res.end();
    }
  }
});

app.get('/api/history', (req, res) => {
  res.json({ history: req.session.history || [] });
});

app.post('/api/new-search', (req, res) => {
  req.session.history = [];
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Search Spul running on http://localhost:${PORT}`);
});