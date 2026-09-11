import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/lib/core.js';
const { pipelineDefinition, canCancelUpload, cancelUpload, filterBatches, paginate } = core;
const up = ['接收前端來源檔', '處理前端來源檔', '傳送後端來源檔'];
const down = ['接收後端結果檔', '處理後端結果檔', '傳送前端結果檔'];
const preparation = ['上傳檔案', '審核完成'];
for (const [mode, direction, expected] of [
  ['自動', 'bidirectional', [...up, ...down]], ['自動', 'upload', up], ['自動', 'download', down],
  ['手動', 'bidirectional', [...preparation, ...up, ...down]], ['手動', 'upload', [...preparation, ...up]], ['手動', 'download', down]
]) {
  test(`N02: ${mode} ${direction} retains the exact ordered stages`, () => {
    const stages = pipelineDefinition(mode, direction);
    assert.deepEqual(stages.map(stage => stage.name), expected);
    assert.equal(new Set(stages.map(stage => stage.id)).size, stages.length);
    assert.ok(stages.every(stage => ['preparation', 'execution'].includes(stage.kind)));
  });
}
function reviewing(direction = 'upload') {
  return { id: 'REVIEW-001', mode: '手動', direction, state: 'reviewing', updated: '2026-09-05T10:00:00+08:00', stages: [
    { id: 'manual-upload', kind: 'preparation', status: 'success', attempts: [] },
    { id: 'review', kind: 'preparation', status: 'reviewing', attempts: [] },
    { id: 'receive-source', kind: 'execution', attempts: [], issue: null }
  ] };
}
test('N03: only unapproved manual uploads expose cancellation', () => {
  assert.equal(canCancelUpload(reviewing()), true);
  assert.equal(canCancelUpload(reviewing('bidirectional')), true);
  assert.equal(canCancelUpload(reviewing('download')), false);
  assert.equal(canCancelUpload({ ...reviewing(), mode: '自動' }), false);
  for (const state of ['processing', 'success', 'stopped', 'cancelled']) assert.equal(canCancelUpload({ ...reviewing(), state }), false);
  const approved = reviewing(); approved.stages[1].status = 'success';
  assert.equal(canCancelUpload(approved), false);
});
test('N03: cancellation keeps identity and stages, without starting later stages', () => {
  const original = reviewing();
  const cancelled = cancelUpload(original, '2026-09-07T14:00:00+08:00');
  assert.equal(cancelled.id, original.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.updated, '2026-09-07T14:00:00+08:00');
  assert.equal(cancelled.stages.length, original.stages.length);
  assert.equal(cancelled.stages[0].status, 'success');
  assert.equal(cancelled.stages[1].status, 'cancelled');
  assert.deepEqual(cancelled.stages[2].attempts, []);
  assert.equal(original.state, 'reviewing');
  assert.equal(canCancelUpload(cancelled), false);
  assert.equal(cancelUpload(cancelled, 'later'), cancelled);
});
test('N03: ineligible cancellation cannot alter the batch', () => {
  const batch = { ...reviewing(), state: 'processing' };
  assert.equal(cancelUpload(batch, '2026-09-07T14:00:00+08:00'), batch);
});
const batches = [
  { id: 'ABC-001', updated: '2026-09-05T23:59:59+08:00' },
  { id: 'ABC-002', updated: '2026-09-06T00:00:00+08:00' },
  { id: 'ABC-003', updated: '2026-09-07T23:59:59+08:00' },
  { id: 'OTHER-004', updated: '2026-09-08T00:00:00+08:00' }
];
test('N04: batch ID and inclusive last-updated date filters are combined', () => {
  assert.deepEqual(filterBatches(batches, ' aBc ', '2026-09-06', '2026-09-07'), batches.slice(1, 3));
  assert.deepEqual(filterBatches(batches, '002', '2026-09-07', '2026-09-07'), []);
  assert.deepEqual(filterBatches(batches, '', '2026-09-05', '2026-09-05'), [batches[0]]);
  assert.deepEqual(filterBatches(batches, '', '', ''), batches);
});
test('N05: filter before pagination; pages never exceed twenty or repeat batches', () => {
  const records = Array.from({ length: 45 }, (_, id) => ({ id: `ABC-${id}`, updated: `2026-09-${id < 41 ? '07' : '08'}T09:00:00+08:00` }));
  const filtered = filterBatches(records, 'ABC-', '2026-09-07', '2026-09-07');
  const pages = [1, 2, 3].map(page => paginate(filtered, page));
  assert.deepEqual(pages.map(page => page.items.length), [20, 20, 1]);
  assert.deepEqual(pages.flatMap(page => page.items), records.slice(0, 41));
});

// Confirmed keyword scenarios: substring, case/space normalization, date intersection.
test('keyword search matches the beginning, middle and end of a batch ID', () => {
  assert.deepEqual(filterBatches(batches, 'abc-', '', ''), batches.slice(0, 3));
  assert.deepEqual(filterBatches(batches, 'bC-00', '', ''), batches.slice(0, 3));
  assert.deepEqual(filterBatches(batches, '002', '', ''), [batches[1]]);
  assert.deepEqual(filterBatches(batches, '  aBc-002  ', '', ''), [batches[1]]);
});

test('clearing a keyword keeps the inclusive date filter and preserves the source data', () => {
  const original = structuredClone(batches);
  assert.deepEqual(filterBatches(batches, '002', '2026-09-05', '2026-09-07'), [batches[1]]);
  assert.deepEqual(filterBatches(batches, '   ', '2026-09-05', '2026-09-07'), batches.slice(0, 3));
  assert.deepEqual(filterBatches(batches, 'missing', '', ''), []);
  assert.deepEqual(filterBatches(batches, '.*', '', ''), []);
  assert.deepEqual(batches, original);
});
