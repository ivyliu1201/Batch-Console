import test from 'node:test';
import assert from 'node:assert/strict';
import { statusNames } from '../src/lib/status.js';
import { executionSummary } from '../src/lib/core.js';

test('D01: exhausted retries retain internal stopped state but display failure', () => {
  const summary = executionSummary([{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }]);
  assert.equal(summary.state, 'stopped');
  assert.equal(summary.retryCount, 2);
  assert.equal(statusNames[summary.state], '失敗');
});
