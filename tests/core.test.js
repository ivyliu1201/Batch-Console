import test from 'node:test';
import assert from 'node:assert/strict';
import { executionSummary, filterRecords, paginate, createAudit } from '../src/lib/core.js';

test('B04: first execution is not a retry; third failed execution stops', () => {
  assert.deepEqual(executionSummary([{ status: 'failed' }]), { executionCount: 1, retryCount: 0, state: 'retrying' });
  assert.deepEqual(executionSummary([{ status: 'failed' }, { status: 'failed' }]), { executionCount: 2, retryCount: 1, state: 'retrying' });
  assert.deepEqual(executionSummary(Array.from({ length: 3 }, () => ({ status: 'failed' }))), { executionCount: 3, retryCount: 2, state: 'stopped' });
});

test('B03/B04: success on the third execution is success, not stopped', () => {
  assert.deepEqual(executionSummary([{ status: 'failed' }, { status: 'failed' }, { status: 'success' }]), { executionCount: 3, retryCount: 2, state: 'success' });
  assert.deepEqual(executionSummary([]), { executionCount: 0, retryCount: 0, state: 'waiting' });
});

const dates = [
  { time: '2026-09-05T23:59:59+08:00' },
  { time: '2026-09-06T00:00:00+08:00' },
  { time: '2026-09-07T23:59:59+08:00' },
  { time: '2026-09-08T00:00:00+08:00' }
];

test('B08: date range includes both complete boundary days', () => {
  assert.deepEqual(filterRecords(dates, '2026-09-06', '2026-09-07'), dates.slice(1, 3));
});

test('B08: one-day selection and clearing dates', () => {
  assert.deepEqual(filterRecords(dates, '2026-09-07', '2026-09-07'), [dates[2]]);
  assert.deepEqual(filterRecords(dates, '', ''), dates);
  assert.deepEqual(filterRecords(dates, '2026-08-01', '2026-08-01'), []);
});

test('B07: pages contain at most 20 records, without gaps or duplicates', () => {
  const records = Array.from({ length: 43 }, (_, id) => ({ id }));
  const first = paginate(records, 1);
  const second = paginate(records, 2);
  const third = paginate(records, 3);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 3);
  assert.equal(first.pageCount, 3);
  assert.deepEqual([...first.items, ...second.items, ...third.items], records);
});

test('B07/B08: empty and out-of-range pages remain usable after filtering', () => {
  assert.deepEqual(paginate([], 7), { items: [], page: 1, total: 0, pageCount: 1 });
  assert.equal(paginate([{ id: 1 }], 9).page, 1);
});

test('B05: future pages can record and notify through the shared entry point', () => {
  const audit = createAudit([], () => '2026-09-07T12:00:00+08:00');
  let received;
  const unsubscribe = audit.subscribe(entry => { received = entry; });
  const entry = audit.record('未來新增頁面', '完成作業', 'ABC-FUTURE-001');
  assert.deepEqual(entry, { page: '未來新增頁面', action: '完成作業', batchId: 'ABC-FUTURE-001', time: '2026-09-07T12:00:00+08:00' });
  assert.equal(received, entry);
  unsubscribe();
  audit.record('未來新增頁面', '完成批次審核', 'ABC-FUTURE-002');
  assert.equal(audit.list()[1].batchId, 'ABC-FUTURE-002');
  assert.equal(received, entry);
});

test('B05/B07: more than 50 batch changes do not silently discard history', () => {
  const audit = createAudit();
  for (let index = 0; index < 65; index++) audit.record('新增頁面', `操作 ${index}`, `ABC-FUTURE-${index}`);
  assert.equal(audit.list().length, 65);
  assert.equal(audit.list()[0].action, '操作 0');
});
