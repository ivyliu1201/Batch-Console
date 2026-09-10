import { executionSummary } from './core.js';

export const statusNames = { stopped: '失敗', failed: '失敗', success: '成功', processing: '處理中', waiting: '尚未執行', retrying: '等待自動重試', reviewing: '審核中', cancelled: '已取消' };

export const stageSummary = stage => stage.kind === 'preparation' ? { state: stage.status } : executionSummary(stage.attempts);
