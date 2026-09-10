import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDate } from '../src/lib/date-selection.js';

test('B08: range selection starts again after a completed range', () => {
  assert.deepEqual(selectDate('2026-09-01', '2026-09-03', 'range', '2026-09-05', '2026-09-07'), { start: '2026-09-05', end: '' });
});
test('B08: reverse order and cross-month ranges keep inclusive ordered boundaries', () => {
  assert.deepEqual(selectDate('2026-09-05', '', 'range', '2026-08-31', '2026-09-07'), { start: '2026-08-31', end: '2026-09-05' });
});
test('B08: single date uses the same start and end', () => {
  assert.deepEqual(selectDate('', '', 'single', '2026-09-05', '2026-09-07'), { start: '2026-09-05', end: '2026-09-05' });
});
test('B10: future dates cannot change the selection', () => {
  assert.deepEqual(selectDate('2026-09-05', '', 'range', '2026-09-08', '2026-09-07'), { start: '2026-09-05', end: '' });
});
