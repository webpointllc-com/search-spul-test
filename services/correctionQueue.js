const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readNdjson } = require('../scripts/import-lib');
const { applyCorrection } = require('./corrections');

const REPO_ROOT = path.join(__dirname, '..');
const QUEUE_PATH = path.join(REPO_ROOT, '.agent-coord', 'CORRECTION_QUEUE.ndjson');
const TODO_PATH = path.join(REPO_ROOT, '.agent-coord', 'TODO.md');
const TRAINING_PATH = path.join(REPO_ROOT, 'data', 'training_scenarios.json');

const VALID_SOURCES = new Set(['worker2', 'worker3', 'frontend', 'manual', 'agent5', 'validation']);
const VALID_STATUS = new Set(['pending', 'in_progress', 'applied', 'rejected']);

function ensureCoordDir() {
  const dir = path.dirname(QUEUE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(QUEUE_PATH)) fs.writeFileSync(QUEUE_PATH, '', 'utf8');
}

function readRawQueue() {
  ensureCoordDir();
  return readNdjson(QUEUE_PATH);
}

/** Latest row per id (append-only log). */
function mergeQueueById(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev || String(row.ts || '') >= String(prev.ts || '')) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

function makeId() {
  return `cq-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeEntry(input) {
  const state = (input.state || '').toUpperCase().trim();
  const county = (input.county || '').trim();
  const currentURL = (input.currentURL || input.searchURL || '').trim();
  const proposedURL = (input.proposedURL || '').trim() || null;
  const source = (input.source || 'manual').toLowerCase();
  const status = (input.status || 'pending').toLowerCase();
  const intent = input.intent || 'pay_taxes_search_by_name';
  const reason = input.reason || input.note || '';

  if (!state || !county) {
    return { ok: false, error: 'state and county are required' };
  }
  if (!VALID_SOURCES.has(source)) {
    return { ok: false, error: `source must be one of: ${[...VALID_SOURCES].join(', ')}` };
  }
  if (!VALID_STATUS.has(status)) {
    return { ok: false, error: `status must be one of: ${[...VALID_STATUS].join(', ')}` };
  }

  return {
    ok: true,
    entry: {
      id: input.id || makeId(),
      ts: input.ts || new Date().toISOString(),
      state,
      county,
      currentURL: currentURL || null,
      proposedURL,
      reason: String(reason).trim(),
      source,
      status,
      intent
    }
  };
}

function appendQueueLine(entry) {
  ensureCoordDir();
  fs.appendFileSync(QUEUE_PATH, JSON.stringify(entry) + '\n', 'utf8');
}

function enqueue(input) {
  const norm = normalizeEntry({ ...input, status: input.status || 'pending' });
  if (!norm.ok) return norm;
  appendQueueLine(norm.entry);
  regenerateTodo();
  return { ok: true, item: norm.entry };
}

function updateStatus(id, status, extra = {}) {
  const merged = mergeQueueById(readRawQueue());
  const existing = merged.find((r) => r.id === id);
  if (!existing) return { ok: false, error: `queue id not found: ${id}` };
  const entry = {
    ...existing,
    ...extra,
    id,
    ts: new Date().toISOString(),
    status
  };
  appendQueueLine(entry);
  regenerateTodo();
  return { ok: true, item: entry };
}

function listPending() {
  return mergeQueueById(readRawQueue())
    .filter((r) => r.status === 'pending')
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

function listRecent(limit = 20) {
  return mergeQueueById(readRawQueue())
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, limit);
}

function queueSummary() {
  const merged = mergeQueueById(readRawQueue());
  const pending = merged.filter((r) => r.status === 'pending');
  const blocked = pending.filter((r) => !r.proposedURL);
  return {
    total: merged.length,
    pending: pending.length,
    blockedNoUrl: blocked.length,
    applied: merged.filter((r) => r.status === 'applied').length,
    rejected: merged.filter((r) => r.status === 'rejected').length,
    in_progress: merged.filter((r) => r.status === 'in_progress').length
  };
}

function hostFromUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function appendTrainingFromQueue(item, lookupUrl) {
  const data = JSON.parse(fs.readFileSync(TRAINING_PATH, 'utf8'));
  const slug = `${item.state}-${item.county}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const id = `queue-${slug}-${Date.now().toString(36)}`;
  const wrongHost = hostFromUrl(item.currentURL);
  const goodHost = hostFromUrl(lookupUrl || item.proposedURL);

  const scenario = {
    id,
    userMessage: `pay my property taxes ${item.county}, ${item.state}`,
    expectedCounty: item.county,
    expectedState: item.state,
    mustContainUrlHost: goodHost,
    forbiddenHosts: wrongHost ? [wrongHost, 'google.com'] : ['google.com'],
    intent: item.intent || 'pay_taxes_search_by_name',
    fromQueue: true,
    queueId: item.id
  };
  if (wrongHost && goodHost) {
    scenario.note = `Queue correction: rejected ${wrongHost}, applied ${goodHost}`;
  }
  data.scenarios.push(scenario);
  fs.writeFileSync(TRAINING_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return scenario;
}

function applyNext() {
  const pending = listPending();
  const next = pending.find((r) => r.proposedURL);
  if (!next) {
    const blocked = pending.filter((r) => !r.proposedURL);
    return {
      ok: false,
      error: blocked.length
        ? `${blocked.length} pending item(s) lack proposedURL — review in TODO Blocked section`
        : 'no pending corrections in queue',
      blockedCount: blocked.length
    };
  }

  updateStatus(next.id, 'in_progress');
  const rejectURLs = next.currentURL ? [next.currentURL] : [];
  const result = applyCorrection({
    state: next.state,
    county: next.county,
    searchURL: next.proposedURL,
    rejectURLs,
    note: next.reason || `Queue apply ${next.id}`,
    source: next.source === 'worker2' ? 'validation' : next.source === 'frontend' ? 'frontend' : 'agent5'
  });

  if (!result.ok) {
    updateStatus(next.id, 'pending', { applyError: result.error });
    return { ok: false, error: result.error, item: next };
  }

  const applied = updateStatus(next.id, 'applied', {
    appliedAt: new Date().toISOString(),
    appliedURL: next.proposedURL
  });
  const trainingScenario = appendTrainingFromQueue(next, next.proposedURL);
  regenerateTodo();
  return {
    ok: true,
    item: applied.item,
    correction: result,
    trainingScenarioId: trainingScenario.id
  };
}

function regenerateTodo() {
  const merged = mergeQueueById(readRawQueue());
  const pending = merged.filter((r) => r.status === 'pending' && r.proposedURL);
  const blocked = merged.filter((r) => r.status === 'pending' && !r.proposedURL);
  const inProgress = merged.filter((r) => r.status === 'in_progress');
  const applied = merged.filter((r) => r.status === 'applied').slice(-30);
  const rejected = merged.filter((r) => r.status === 'rejected').slice(-20);

  const line = (r) =>
    `- [ ] **${r.county}, ${r.state}** — \`${r.currentURL || 'no current URL'}\` → ${r.proposedURL ? `\`${r.proposedURL}\`` : '_no proposed URL_'} (${r.source}, \`${r.id}\`)`;

  const body = `# Correction queue TODO

_Auto-generated from \`.agent-coord/CORRECTION_QUEUE.ndjson\`. Do not hand-edit sections — run \`node scripts/queue-correction.js sync-todo\`._

Updated: ${new Date().toISOString()}

## Pending corrections (${pending.length})

${pending.length ? pending.map(line).join('\n') : '_None_'}

## In progress (${inProgress.length})

${inProgress.length ? inProgress.map(line).join('\n') : '_None_'}

## Applied (${applied.length} recent)

${applied.length ? applied.map((r) => `- [x] **${r.county}, ${r.state}** → \`${r.proposedURL || r.appliedURL || '?'}\` (\`${r.id}\`)`).join('\n') : '_None_'}

## Blocked (no URL yet) (${blocked.length})

${blocked.length ? blocked.map((r) => `- [ ] **${r.county}, ${r.state}** — current: \`${r.currentURL || '?'}\` — ${r.reason || r.classification || 'needs proposedURL'} (\`${r.id}\`)`).join('\n') : '_None_'}

## Rejected (${rejected.length} recent)

${rejected.length ? rejected.map((r) => `- [x] **${r.county}, ${r.state}** — ${r.reason || 'rejected'} (\`${r.id}\`)`).join('\n') : '_None_'}
`;

  ensureCoordDir();
  fs.writeFileSync(TODO_PATH, body, 'utf8');
}

function enqueueAndMaybeApply(input) {
  const proposedURL = (input.proposedURL || input.searchURL || '').trim();
  const enqueueResult = enqueue({
    ...input,
    proposedURL: proposedURL || null,
    currentURL: input.currentURL || input.wrongUrl || input.wrongURL || null
  });
  if (!enqueueResult.ok) return enqueueResult;

  const shouldApply =
    input.apply === true ||
    input.applyImmediately === true ||
    (input.verified === true && proposedURL);

  if (!shouldApply) {
    return { ok: true, enqueued: true, applied: false, item: enqueueResult.item };
  }
  if (!proposedURL) {
    return { ok: true, enqueued: true, applied: false, item: enqueueResult.item, warning: 'verified without proposedURL — not auto-applied' };
  }

  const applyResult = applyCorrection({
    state: enqueueResult.item.state,
    county: enqueueResult.item.county,
    searchURL: proposedURL,
    rejectURLs: enqueueResult.item.currentURL ? [enqueueResult.item.currentURL] : [],
    note: enqueueResult.item.reason,
    source: enqueueResult.item.source === 'worker2' ? 'validation' : 'frontend'
  });
  if (!applyResult.ok) {
    return { ok: false, enqueued: true, applied: false, item: enqueueResult.item, error: applyResult.error };
  }

  updateStatus(enqueueResult.item.id, 'applied', { appliedURL: proposedURL });
  const trainingScenario = appendTrainingFromQueue(enqueueResult.item, proposedURL);
  return {
    ok: true,
    enqueued: true,
    applied: true,
    item: enqueueResult.item,
    correction: applyResult,
    trainingScenarioId: trainingScenario.id
  };
}

module.exports = {
  QUEUE_PATH,
  TODO_PATH,
  enqueue,
  enqueueAndMaybeApply,
  listPending,
  listRecent,
  queueSummary,
  applyNext,
  updateStatus,
  regenerateTodo,
  mergeQueueById,
  readRawQueue
};
