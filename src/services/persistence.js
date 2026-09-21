import { nextTick, ref, watch } from 'vue';
import { batches } from '../data/demo.js';
import { audit, auditEntries } from './audit.js';

export const storageReady = ref(false);
export const storageError = ref('');
let database;
let writeQueue = Promise.resolve();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('batch-console', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('資料庫正被其他頁面使用'));
  });
}

function loadSnapshot() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('state', 'readonly');
    const request = transaction.objectStore('state').get('console');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

function saveSnapshot(snapshot) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite');
    transaction.objectStore('state').put(snapshot, 'console');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

function queueSave() {
  // Store data only: File objects and preview contents never enter this snapshot.
  const snapshot = JSON.parse(JSON.stringify({ batches, records: audit.list() }));
  writeQueue = writeQueue.catch(() => {}).then(() => saveSnapshot(snapshot));
  writeQueue.then(() => { storageError.value = ''; }, () => {
    storageError.value = '最新資料尚未保存，請勿關閉頁面。請確認瀏覽器允許網站儲存，並有足夠空間。';
  });
}

export async function initializePersistence() {
  try {
    database = await openDatabase();
    const snapshot = await loadSnapshot();
    if (snapshot) {
      batches.splice(0, batches.length, ...snapshot.batches);
      audit.restore(snapshot.records);
    } else {
      await saveSnapshot(JSON.parse(JSON.stringify({ batches, records: audit.list() })));
    }
    watch([batches, auditEntries], queueSave, { deep: true, flush: 'post' });
    storageReady.value = true;
  } catch {
    storageError.value = '無法讀取瀏覽器中的批次資料。請確認網站儲存權限後重新整理。';
  }
}

export async function savePendingChanges() {
  await nextTick();
  await writeQueue;
}
