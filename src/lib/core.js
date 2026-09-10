export function executionSummary(attempts) {
  const executionCount = attempts.length;
  const lastStatus = attempts.at(-1)?.status || 'waiting';
  const state = lastStatus === 'failed' ? (executionCount >= 3 ? 'stopped' : 'retrying') : lastStatus;
  return { executionCount, retryCount: Math.max(0, executionCount - 1), state };
}

export function pipelineDefinition(mode, direction) {
  const source = [
    ['receive-source', '接收前端來源檔'], ['process-source', '處理前端來源檔'], ['send-source', '傳送後端來源檔']
  ];
  const result = [
    ['receive-result', '接收後端結果檔'], ['process-result', '處理後端結果檔'], ['send-result', '傳送前端結果檔']
  ];
  const execution = (direction === 'upload' ? source : direction === 'download' ? result : [...source, ...result])
    .map(([id, name]) => ({ id, name, kind: 'execution' }));
  const preparation = mode === '手動' && direction !== 'download' ? [
    { id: 'manual-upload', name: '上傳檔案', kind: 'preparation' },
    { id: 'review', name: '審核完成', kind: 'preparation' }
  ] : [];
  return [...preparation, ...execution];
}

export function canCancelUpload(batch) {
  return batch.mode === '手動' && batch.direction !== 'download' && batch.state === 'reviewing'
    && batch.stages.some(stage => stage.id === 'review' && stage.status === 'reviewing');
}

export function cancelUpload(batch, time) {
  if (!canCancelUpload(batch)) return batch;
  return { ...batch, state: 'cancelled', updated: time, stages: batch.stages.map(stage =>
    stage.id === 'review' ? { ...stage, status: 'cancelled', time } : stage
  ) };
}

export function filterBatches(batches, query, start, end) {
  const term = query.trim().toLowerCase();
  return batches.filter(batch => {
    const day = batch.updated.slice(0, 10);
    return batch.id.toLowerCase().includes(term) && (!start || day >= start) && (!end || day <= end);
  });
}

export function filterRecords(records, start, end) {
  return records.filter(record => {
    const day = record.time.slice(0, 10);
    return (!start || day >= start) && (!end || day <= end);
  });
}

export function paginate(records, page, pageSize = 20) {
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, pageCount));
  return { items: records.slice((currentPage - 1) * pageSize, currentPage * pageSize), page: currentPage, total: records.length, pageCount };
}

export function createAudit(initial = [], clock = () => new Date().toISOString()) {
  const records = initial.slice();
  const listeners = new Set();
  return {
    record(page, action, batchId = null) {
      const entry = { page, action, batchId, time: clock() };
      records.push(entry);
      listeners.forEach(listener => listener(entry));
      return entry;
    },
    list() { return records.slice(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
