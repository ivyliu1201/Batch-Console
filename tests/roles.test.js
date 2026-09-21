import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBatches, createAudit } from '../src/lib/core.js';

const actor = { id: 'supervisor', name: '主管', role: 'supervisor' };
const batches = [
  { id: 'AUTO', mode: '自動', state: 'success', updated: '2026-09-21T10:00:00+08:00' },
  { id: 'PENDING', mode: '手動', state: 'reviewing', updated: '2026-09-21T10:00:00+08:00' },
  { id: 'OWN', mode: '手動', state: 'processing', reviewedBy: 'supervisor', updated: '2026-09-21T10:00:00+08:00' },
  { id: 'OTHER', mode: '手動', state: 'success', reviewedBy: 'another-supervisor', updated: '2026-09-21T10:00:00+08:00' },
  { id: 'CANCELLED', mode: '手動', state: 'cancelled', updated: '2026-09-21T10:00:00+08:00' },
];

test('R01: clerk sees manual batches only, including an exact-ID search', () => {
  const options = { actor: { id: 'clerk', role: 'clerk' } };
  assert.deepEqual(filterBatches(batches, '', '', '', options).map(b => b.id), ['PENDING', 'OWN', 'OTHER', 'CANCELLED']);
  assert.deepEqual(filterBatches(batches, 'AUTO', '', '', options), []);
});

test('R02: supervisor sees pending and personally reviewed manual batches', () => {
  assert.deepEqual(filterBatches(batches, '', '', '', { actor }).map(b => b.id), ['PENDING', 'OWN']);
  assert.deepEqual(filterBatches(batches, 'OTHER', '', '', { actor }), []);
});

test('R03: administrator combines mode, keyword and date filters', () => {
  const options = { actor: { role: 'admin' }, mode: '自動' };
  assert.deepEqual(filterBatches(batches, '', '', '', options).map(b => b.id), ['AUTO']);
  assert.deepEqual(filterBatches(batches, ' au ', '2026-09-21', '2026-09-21', options).map(b => b.id), ['AUTO']);
  assert.deepEqual(filterBatches(batches, '', '2026-09-22', '', options), []);
  assert.equal(filterBatches(batches, '', '', '', { actor: { role: 'admin' } }).length, 5);
});

test('R04: audit keeps the actor at operation time after role changes', () => {
  let current = { id: 'clerk', name: '經辦人員', role: 'clerk' };
  const audit = createAudit([], () => '2026-09-21T10:00:00+08:00', () => current);
  audit.record('上傳', '上傳成功', 'PENDING');
  current = actor;
  audit.record('審核', '審核完成', 'OWN');
  assert.deepEqual(audit.list().map(e => e.actor?.id), ['clerk', 'supervisor']);
  current.name = 'changed';
  assert.equal(audit.list()[1].actor.name, '主管');
});
