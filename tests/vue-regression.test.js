import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTick, watch } from 'vue';
import { batches, initialRecords } from '../src/data/demo.js';
import { executionSummary } from '../src/lib/core.js';
import { audit, auditEntries } from '../src/services/audit.js';

test('U1: sample audit entries describe batch changes, not browsing', () => {
  assert.ok(initialRecords.length > 20);
  for (const entry of initialRecords) {
    assert.ok(batches.some(batch => batch.id === entry.batchId));
    assert.match(entry.action, /建立.*批次|上傳檔案|審核完成/);
    assert.doesNotMatch(entry.action, /進入|查看|查詢|篩選|翻頁/);
  }
});

test('N01/N02: all approved workflows and review batches are available', () => {
  const up = ['接收前端來源檔', '處理前端來源檔', '傳送後端來源檔'];
  const down = ['接收後端結果檔', '處理後端結果檔', '傳送前端結果檔'];
  assert.equal(batches.length, 25);
  assert.equal(batches.filter(batch => batch.state === 'reviewing').length, 2);
  for (const batch of batches) {
    const execution = batch.direction === 'upload' ? up : batch.direction === 'download' ? down : [...up, ...down];
    const expected = batch.mode === '手動' && batch.direction !== 'download' ? ['上傳檔案', '審核完成', ...execution] : execution;
    assert.deepEqual(batch.stages.map(stage => stage.name), expected);
    assert.ok(['手動', '自動'].includes(batch.mode));
    if (batch.state === 'reviewing') assert.ok(batch.stages.filter(stage => stage.kind === 'execution').every(stage => stage.attempts.length === 0));
  }
});

test('B04: failed sample stages contain three executions, not three retries', () => {
  for (const batch of batches.filter(item => item.state === 'stopped')) {
    const stopped = batch.stages.filter(stage => executionSummary(stage.attempts).state === 'stopped');
    assert.equal(stopped.length, 1);
    assert.deepEqual(executionSummary(stopped[0].attempts), { executionCount: 3, retryCount: 2, state: 'stopped' });
    assert.ok(stopped[0].issue.reason);
    assert.equal(stopped[0].issue.steps.length, 3);
  }
});

test('B05: future page events update the shared Vue state reactively', async () => {
  const before = auditEntries.value.length;
  let observed;
  const stop = watch(auditEntries, entries => { observed = entries.at(-1); });
  audit.record('測試新增頁面', '完成測試作業', 'ABC-FUTURE-001');
  await nextTick();
  assert.equal(auditEntries.value.length, before + 1);
  assert.deepEqual(observed, audit.list().at(-1));
  assert.equal(observed.page, '測試新增頁面');
  assert.equal(observed.batchId, 'ABC-FUTURE-001');
  stop();
});
