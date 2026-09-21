import { batches } from '../data/demo.js';
import { pipelineDefinition } from '../lib/core.js';
import { taipeiNow } from '../lib/format.js';
import { audit } from './audit.js';
import { savePendingChanges } from './persistence.js';

export async function completeUpload(job, sourceFileName, requestFileName, actor) {
  const updated = taipeiNow();
  const prefix = `ABC-${updated.slice(0, 10).replaceAll('-', '')}-`;
  const serial = Math.max(0, ...batches.filter(batch => batch.id.startsWith(prefix))
    .map(batch => Number(batch.id.slice(prefix.length)) || 0)) + 1;
  const id = prefix + String(serial).padStart(3, '0');
  const batch = {
    id, jobCode: job.jobCode, name: job.jobName, mode: '手動', direction: 'upload', flow: '單向上傳',
    state: 'reviewing', updated, createdBy: actor.id, reviewedBy: null, sourceFileName, requestFileName,
    stages: pipelineDefinition('手動', 'upload').map(stage => ({
      ...stage, attempts: [], issue: null,
      ...(stage.kind === 'preparation' ? {
        status: stage.id === 'manual-upload' ? 'success' : 'reviewing',
        time: stage.id === 'manual-upload' ? updated.slice(11, 19) : '',
      } : {}),
    })),
  };
  batches.unshift(batch);
  audit.record('上傳', `上傳成功：${job.jobName}；來源檔案：${sourceFileName}；請求檔案：${requestFileName}`, id, actor);
  await savePendingChanges();
  return batch;
}

export function openBatchCount(jobCode) {
  return batches.filter(batch => batch.jobCode === jobCode && !['success', 'cancelled'].includes(batch.state)).length;
}
