import test from 'node:test';
import assert from 'node:assert/strict';
import { batches } from '../src/data/demo.js';
import { audit } from '../src/services/audit.js';
import { completeUpload, openBatchCount } from '../src/services/batches.js';
import { actorLabel, switchRole, currentUser } from '../src/services/session.js';
import { filterBatches } from '../src/lib/core.js';
import { initializePersistence, savePendingChanges, storageReady } from '../src/services/persistence.js';
import { memoryIndexedDB } from './helpers/indexed-db.js';

const storage = memoryIndexedDB();
globalThis.indexedDB = storage.indexedDB;
await initializePersistence();
assert.equal(storageReady.value, true);

test('R05: uploads create unique pending batches with the same IDs in audit and query', async () => {
  const job = { jobCode: 'JOB01', jobName: '範例資料匯入' };
  switchRole('clerk');
  const actor = currentUser.value;
  const before = audit.list().length;
  const count = openBatchCount(job.jobCode);
  const first = await completeUpload(job, 'source.txt', 'request-1.DAT', actor);
  const second = await completeUpload(job, 'source.txt', 'request-2.DAT', actor);
  assert.notEqual(first.id, second.id);
  assert.equal(first.createdBy, 'clerk');
  assert.equal(first.mode, '手動');
  assert.equal(first.state, 'reviewing');
  assert.equal(first.stages[0].status, 'success');
  assert.equal(first.stages[1].status, 'reviewing');
  assert.ok(first.stages.slice(2).every(stage => stage.attempts.length === 0));
  assert.equal(openBatchCount(job.jobCode), count + 2);
  assert.equal(audit.list().length, before + 2);
  assert.deepEqual(audit.list().slice(-2).map(e => e.batchId), [first.id, second.id]);
  assert.ok(audit.list().slice(-2).every(e => e.actor.id === 'clerk'));
  for (const role of ['clerk', 'supervisor', 'admin']) {
    switchRole(role);
    assert.equal(filterBatches(batches, first.id, '', '', { actor: currentUser.value })[0].id, first.id);
  }
  assert.equal(first.sourceFileName, 'source.txt');
  assert.equal(first.requestFileName, 'request-1.DAT');
  for (const field of ['file', 'content', 'lines', 'preview']) assert.equal(field in first, false);
});

test('R04: actor display uses a dash only when the name is missing', () => {
  assert.equal(actorLabel(null), '-');
  assert.equal(actorLabel({ id: 'legacy' }), '-');
  assert.equal(actorLabel({ name: '經辦人員', role: 'clerk' }), '經辦人員');
  assert.equal(actorLabel({ name: '測試甲', role: 'clerk' }), '測試甲（經辦人員）');
});

test('A: quota failure and transaction abort do not publish batches or successful audit entries', async () => {
  await savePendingChanges();
  for (const fault of ['failNextWrite', 'abortNextWrite']) {
    const beforeBatches = batches.slice();
    const beforeRecords = audit.list();
    const beforeSnapshot = structuredClone(storage.state.snapshot);
    storage.state[fault] = true;
    await assert.rejects(completeUpload({jobCode:'JOB01',jobName:'保存測試'}, 'retry.txt', 'retry.DAT', currentUser.value));
    assert.deepEqual(batches, beforeBatches);
    assert.deepEqual(audit.list(), beforeRecords);
    assert.deepEqual(storage.state.snapshot, beforeSnapshot);
    await completeUpload({jobCode:'JOB01',jobName:'保存測試'}, 'retry.txt', 'retry.DAT', currentUser.value);
    await savePendingChanges();
    assert.equal(batches.length, beforeBatches.length + 1);
    assert.equal(audit.list().length, beforeRecords.length + 1);
    assert.equal(storage.state.snapshot.batches.length, batches.length);
    assert.equal(storage.state.snapshot.records.length, audit.list().length);
  }
});

test('A: a failed queued upload cannot erase other successful operations or duplicate IDs', async () => {
  await savePendingChanges();
  const beforeBatches = batches.length;
  const beforeRecords = audit.list().length;
  storage.state.failNextWrite = true;
  const outcomes = await Promise.allSettled(['failed','first','second'].map(name =>
    completeUpload({jobCode:'JOB01',jobName:'佇列測試'}, name + '.txt', name + '.DAT', currentUser.value)));
  assert.deepEqual(outcomes.map(outcome => outcome.status), ['rejected','fulfilled','fulfilled']);
  assert.notEqual(outcomes[1].value.id, outcomes[2].value.id);
  await savePendingChanges();
  assert.equal(batches.length, beforeBatches + 2);
  assert.equal(audit.list().length, beforeRecords + 2);
  assert.deepEqual(storage.state.snapshot.records.slice(beforeRecords).map(entry => entry.batchId), outcomes.slice(1).map(outcome => outcome.value.id));
  assert.equal(storage.state.snapshot.batches.length, batches.length);
});
