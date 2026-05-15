# SEARCH_SPUL_TRUTH.md

Technical brief for the Search Spul deployment.

## 1. What Groq is and why it is free

Groq is an inference platform that runs open-source large language models at very high speed using custom LPU hardware.

It offers a free tier for developers to test and prototype. Sources:
- https://console.groq.com
- https://groq.com/pricing

## 2. Exact free tier limits (llama-3.3-70b-versatile)

- 30 requests per minute (RPM)
- 6,000 tokens per minute (TPM)
- 1,000 requests per day (RPD)

These limits apply at the organization level on the free/developer plan.

## 3. Model used and paid pricing

Model: llama-3.3-70b-versatile

Paid pricing (as of 2026):
- Input: $0.59 per million tokens
- Output: $0.79 per million tokens

Source: groq.com/pricing and console.groq.com model documentation.

## 4. Full stack

- Backend: Node.js + Express
- Session: cookie-session (signed cookies)
- AI: Groq OpenAI-compatible SDK (baseURL: https://api.groq.com/openai/v1)
- Hosting: Render free plan (via render.yaml)
- Frontend: Vanilla HTML + CSS + JavaScript (no frameworks)

## 5. render.yaml purpose and environment variables

render.yaml defines the service configuration for automatic deployment on Render:
- Service type, plan (free), build command (npm install), start command (npm start)

Environment variables (especially secrets like GROQ_API_KEY) must be set manually in the Render dashboard. This is required for security — Render does not pull secret values from the repository.

## 6. Session persistence

Uses the cookie-session middleware.

- Session data (including chat history) is stored in a signed cookie on the client.
- Max age configured to 7 days (7 * 24 * 60 * 60 * 1000 ms)
- Data is encrypted/signed with a secret key (SESSION_SECRET)
- Survives page refreshes but is lost if the cookie is cleared or the secret changes.

## 7. Upgrade path when free tier breaks

Free tier limits will be hit when:
- Daily requests exceed ~1,000
- Rate limits (30 RPM / 6k TPM) are consistently exceeded

Options to scale:

- Groq paid tier: Pay per token at $0.59 input / $0.79 output per million tokens.
- Add request queuing, caching, or rate limiting in the app.
- Move high-traffic endpoints to a different provider or self-host with rate limiting.
- On Render: Upgrade from free plan to paid instance to remove spin-down delays and increase resources.

No automatic failover is implemented in the current version.