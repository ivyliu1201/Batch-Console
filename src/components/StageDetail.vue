<script setup>
import { computed } from 'vue';
import Icon from './Icon.vue';
import StatusBadge from './StatusBadge.vue';
import { statusNames, stageSummary } from '../lib/status.js';
const props = defineProps({ stage: { type: Object, required: true }, selectedAttempt: { type: Number, required: true }, batchState: { type: String, default: '' } });
defineEmits(['select-attempt']);
const summary = computed(() => stageSummary(props.stage));
const preparationMessage = computed(() => props.stage.id === 'manual-upload' ? '檔案已上傳。' : summary.value.state === 'reviewing' ? '此批次正在等待審核，審核完成前不會執行後續流程。' : summary.value.state === 'cancelled' ? '使用者已取消上傳，審核及後續流程不再進行。' : '此批次已完成審核，不能再取消上傳。');
const advice = computed(() => props.stage.issue?.steps.map(step => {
  const emphasis = step.match(/^[^，。]+/)[0];
  return { emphasis, rest: step.slice(emphasis.length) };
}) || []);
</script>
<template>
  <section id="stage-detail" class="stage-detail" aria-live="polite">
    <div class="stage-detail-heading"><h2>{{ stage.name }} · 階段明細</h2><StatusBadge :state="summary.state" /><span v-if="stage.kind === 'preparation'" class="preparation-label">手動作業前置階段</span><span v-else class="attempt-count">執行 {{ summary.executionCount }} 次 <span aria-hidden="true">／</span> 自動重試 {{ summary.retryCount }} 次</span></div>
    <div v-if="stage.kind === 'preparation'" class="panel stage-info"><strong>{{ preparationMessage }}</strong><p>此為上傳／審核階段，不計入後續處理的自動重試次數。</p></div>
    <div v-else-if="stage.issue" class="diagnosis-grid">
      <article class="panel diagnosis error"><h3><Icon name="alert" />失敗原因</h3><span class="error-code">{{ stage.issue.code }}</span><p><strong>{{ stage.issue.reason }}</strong></p><p class="stop-note"><strong>已達執行上限：首次執行 + 2 次自動重試。</strong>第三次仍失敗；後續階段未執行。</p></article>
      <article class="panel diagnosis solution"><h3><Icon name="file" />解決方法 <span class="count-label">示例</span></h3><ol><li v-for="step in advice" :key="step.emphasis"><strong>{{ step.emphasis }}</strong>{{ step.rest }}</li></ol><small>以上為示例建議，實際處置須依公司核定程序。</small></article>
    </div>
    <div v-else class="panel stage-info">{{ summary.state === 'success' ? '此階段已成功完成，沒有失敗原因或待處理事項。' : summary.state === 'waiting' ? batchState === 'cancelled' ? '批次已取消，此階段尚未執行，後續不再處理。' : '前序階段尚未完成，此階段尚未執行。' : '此階段正在處理，尚未取得完成結果。' }}</div>
    <section v-if="stage.attempts.length" class="panel attempt-panel" aria-label="每次執行紀錄">
      <div class="panel-heading"><h2>執行紀錄</h2><span class="count-label">最多執行 3 次</span></div>
      <div class="attempt-content">
        <div class="attempt-list"><button v-for="(attempt, index) in stage.attempts" :key="index" class="attempt-row" type="button" :data-attempt="index" :aria-pressed="index === selectedAttempt" :aria-label="`第 ${index + 1} 次執行，${statusNames[attempt.status]}`" @click="$emit('select-attempt', index)"><span><strong>第 {{ index + 1 }} 次執行 · {{ index === 0 ? '首次執行' : `自動重試 ${index}` }}</strong><small>{{ attempt.time }}{{ attempt.reason ? ` · ${stage.issue.code}` : '' }}</small></span><StatusBadge :state="attempt.status" /></button></div>
        <div class="log-panel"><div class="log-title">第 {{ selectedAttempt + 1 }} 次執行 · 詳細紀錄</div><pre class="log-text"><code>{{ stage.attempts[selectedAttempt].logs.join('\n') }}</code></pre></div>
      </div>
    </section>
  </section>
</template>
