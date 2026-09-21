import { reactive } from 'vue';
import { pad } from '../lib/format.js';
import { pipelineDefinition } from '../lib/core.js';
import { users } from '../services/session.js';

const directionNames = { bidirectional: '雙向', upload: '單向上傳', download: '單向下傳' };

const issues = {
  timeout: { code: 'TRANSFER_TIMEOUT', reason: '傳送後端時連線逾時，未取得接收確認。', steps: ['先向接收端查證這筆批次是否已收妥，確認實際處理結果。', '檢查傳輸服務、網路連線及接收端的回應紀錄。', '將批次編號與逾時紀錄提供給負責人員，依核定程序處置。'] },
  unavailable: { code: 'SERVICE_UNAVAILABLE', reason: '接收服務暫時無法使用，三次傳送皆未成功。', steps: ['確認接收服務的運作狀態與維護時段。', '檢查同時段服務紀錄，定位服務無法使用的原因。', '待服務恢復後，由負責人員依核定程序處理這筆批次。'] },
  busy: { code: 'TRANSFER_CHANNEL_BUSY', reason: '傳輸通道持續忙碌，無法建立本次傳送連線。', steps: ['檢查傳輸通道的連線數量與執行中的作業。', '查閱端點紀錄，確認是否存在占用過久的連線。', '交由維運人員處理通道占用，再依核定程序處置批次。'] },
  locked: { code: 'OUTPUT_FILE_LOCKED', reason: '輸出檔案被其他程序占用，無法完成檔案建立。', steps: ['確認占用檔案的程序與目前作業狀態。', '查閱相關處理紀錄，避免中斷仍在正常執行的作業。', '由負責人員排除占用原因，並依核定程序處置批次。'] }
};

function makeBatch(number, name, mode, state, issueKey, direction = 'bidirectional', day = 7) {
  const definitions = pipelineDefinition(mode, direction);
  const currentIndex = issueKey === 'locked' ? 1 : 2;
  const hour = pad(9 + number % 3);
  const minute = pad(10 + number * 3 % 40);
  const issue = issueKey ? issues[issueKey] : null;
  let executionIndex = 0;
  const stages = definitions.map(definition => {
    if (definition.kind === 'preparation') {
      const status = definition.id === 'review' && state === 'reviewing' ? 'reviewing' : 'success';
      return { ...definition, status, time: status === 'success' ? `${hour}:${minute}:00` : '', attempts: [], issue: null };
    }
    const index = executionIndex++;
    const stageStatus = state === 'reviewing' ? 'waiting' : state === 'success' || index < currentIndex ? 'success' : index === currentIndex ? state : 'waiting';
    const count = stageStatus === 'stopped' ? 3 : stageStatus === 'waiting' ? 0 : 1;
    const attempts = Array.from({ length: count }, (_, attemptIndex) => {
      const time = `${hour}:${pad(Number(minute) + attemptIndex)}:${pad(index * 5)}`;
      const attemptStatus = stageStatus === 'stopped' ? 'failed' : stageStatus;
      return {
        status: attemptStatus, time,
        reason: attemptStatus === 'failed' ? issue.reason : '',
        logs: [`[${time}] ${attemptIndex === 0 ? '首次執行' : `自動重試 ${attemptIndex}`}：${definition.name}`, `[${time}] ${attemptStatus === 'failed' ? `${issue.code} — ${issue.reason}` : attemptStatus === 'success' ? '此階段執行成功。' : '作業執行中，等待完成結果。'}`, ...(attemptIndex === 2 ? [`[${time}] 已執行 3 次，停止處理，後續階段未執行。`] : [])]
      };
    });
    return { ...definition, attempts, issue: stageStatus === 'stopped' ? issue : null };
  });
  return { id: `ABC-202609${pad(day)}-${String(number).padStart(3, '0')}`, name, mode, state, direction, flow: directionNames[direction], updated: `2026-09-${pad(day)}T${hour}:${pad(Number(minute) + (state === 'stopped' ? 2 : 0))}:18+08:00`, stages,
    createdBy: mode === '手動' ? 'clerk' : 'system',
    reviewedBy: stages.some(stage => stage.id === 'review' && stage.status === 'success') ? 'supervisor' : null,
  };
}

export const batches = reactive([
  makeBatch(1, '範例資料傳送', '自動', 'stopped', 'timeout'),
  makeBatch(2, '測試資料上傳', '手動', 'stopped', 'unavailable'),
  makeBatch(3, '跨系統資料交換', '自動', 'stopped', 'busy'),
  makeBatch(4, '結果檔案建立', '自動', 'stopped', 'locked'),
  makeBatch(5, '主檔資料更新', '手動', 'processing'),
  makeBatch(6, '排程資料傳送', '自動', 'processing'),
  makeBatch(7, '每日資料交換', '自動', 'success'),
  makeBatch(8, '範例資料傳送', '手動', 'reviewing'),
  makeBatch(9, '測試資料上傳', '手動', 'reviewing', null, 'upload'),
  makeBatch(10, '主檔資料更新', '自動', 'processing', null, 'upload'),
  makeBatch(11, '結果檔案建立', '自動', 'processing', null, 'download'),
  makeBatch(12, '結果檔案建立', '手動', 'success', null, 'download'),
  makeBatch(13, '測試資料上傳', '手動', 'success', null, 'upload'),
  makeBatch(14, '範例資料傳送', '手動', 'success'),
  // Historical samples make date filtering and a second page reviewable.
  ...Array.from({ length: 11 }, (_, index) => {
    const direction = ['bidirectional', 'upload', 'download'][index % 3];
    const name = ['每日資料交換', '測試資料上傳', '結果檔案建立'][index % 3];
    return makeBatch(index + 15, name, index % 2 ? '手動' : '自動', 'success', null, direction, index < 5 ? 5 : 6);
  })
]);

// Historical examples of changes to the sample batches, not records of browsing them.
export const initialRecords = batches.flatMap(batch => {
  const day = batch.updated.slice(0, 10);
  const manualUpload = batch.mode === '手動' && batch.direction !== 'download';
  const records = [{
    page: batch.mode === '自動' ? '批次接收' : manualUpload ? '上傳' : '下傳',
    action: manualUpload ? '上傳檔案，建立手動批次' : `建立${batch.mode}批次`,
    batchId: batch.id, time: `${day}T08:00:00+08:00`,
    actor: batch.mode === '手動' ? { ...users[0] } : { id: 'system', name: '系統', role: 'system' },
  }];
  const review = batch.stages.find(stage => stage.id === 'review' && stage.status === 'success');
  if (review) records.push({ page: '審核', action: '審核完成，允許批次執行', batchId: batch.id, time: `${day}T${review.time}+08:00`, actor: { ...users[1] } });
  return records;
});
