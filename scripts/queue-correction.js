#!/usr/bin/env node
/**
 * Correction queue CLI (Worker 1 lane).
 *   node scripts/queue-correction.js enqueue '{"state":"CA","county":"Marin",...}'
 *   echo '{"state":"CA",...}' | node scripts/queue-correction.js enqueue -
 *   node scripts/queue-correction.js list
 *   node scripts/queue-correction.js apply-next
 *   node scripts/queue-correction.js sync-todo
 */
const {
  enqueue,
  listPending,
  applyNext,
  queueSummary,
  regenerateTodo
} = require('../services/correctionQueue');

const [cmd, arg] = process.argv.slice(2);

function readJsonArg() {
  if (!arg) {
    console.error('Usage: queue-correction.js enqueue <json|-');
    process.exit(1);
  }
  if (arg === '-') {
    return JSON.parse(require('fs').readFileSync(0, 'utf8'));
  }
  return JSON.parse(arg);
}

async function main() {
  switch (cmd) {
    case 'enqueue': {
      const body = readJsonArg();
      const result = enqueue(body);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    }
    case 'list': {
      const pending = listPending();
      const summary = queueSummary();
      console.log(JSON.stringify({ summary, pending }, null, 2));
      process.exit(0);
    }
    case 'apply-next': {
      const result = applyNext();
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    }
    case 'sync-todo': {
      regenerateTodo();
      console.log(JSON.stringify({ ok: true, message: 'TODO.md regenerated' }, null, 2));
      process.exit(0);
    }
    default:
      console.error(`Unknown command: ${cmd || '(none)'}\nCommands: enqueue, list, apply-next, sync-todo`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
