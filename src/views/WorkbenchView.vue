<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import BatchTable from '../components/BatchTable.vue';
import OperationModeFilter from '../components/OperationModeFilter.vue';
import { batches } from '../data/demo.js';
import { filterBatches } from '../lib/core.js';
import { currentUser } from '../services/session.js';
import { openReview } from '../services/review.js';
const router = useRouter();
const route = useRoute();
const mode = ref('');
const reviewFeedback = ref('');
const isSupervisor = computed(() => currentUser.value.role === 'supervisor');
const isAdmin = computed(() => currentUser.value.role === 'admin');
const cards = computed(() => [
  { state: 'stopped', label: '異常', icon: 'alert', className: 'failed' },
  { state: 'reviewing', label: isSupervisor.value ? '待審核' : '審核中', icon: 'file', className: 'reviewing' },
  { state: 'processing', label: '處理中', icon: 'clock', className: 'processing' },
  { state: 'success', label: '成功', icon: 'check', className: 'success' }
]);
const selectedStatus = computed(() => cards.value.some(card => card.state === route.query.status) ? route.query.status : isSupervisor.value ? 'reviewing' : 'stopped');
const visibleBatches = computed(() => filterBatches(batches, '', '', '', { actor: currentUser.value, mode: mode.value }));
const filtered = computed(() => visibleBatches.value.filter(batch => batch.state === selectedStatus.value));
const selectedLabel = computed(() => cards.value.find(card => card.state === selectedStatus.value).label);
watch(currentUser, () => {
  mode.value = ''; reviewFeedback.value = '';
  router.replace({ name: 'workbench', query: { status: isSupervisor.value ? 'reviewing' : 'stopped' } });
});
function selectStatus(card) {
  reviewFeedback.value = '';
  router.replace({ name: 'workbench', query: { status: card.state } });
}
function openBatch(id) {
  if (isSupervisor.value && selectedStatus.value === 'reviewing') {
    reviewFeedback.value = openReview(id) ? `審核頁尚未接入（${id}）` : '';
    return;
  }
  router.push({ name: 'search', query: { batch: id, workbenchStatus: selectedStatus.value } });
}
</script>
<template>
  <section id="dashboard-view" class="view" aria-labelledby="dashboard-title">
    <div class="page-heading"><div><h1 id="dashboard-title">我的工作台</h1></div></div>
    <div class="stats" id="dashboard-stats">
      <button v-for="card in cards" :key="card.state" type="button" class="stat" :class="card.className" :data-status="card.state" :aria-pressed="selectedStatus === card.state" :aria-label="`篩選${card.label}批次`" @click="selectStatus(card)">
        <span class="stat-copy"><span class="stat-label">{{ card.label }}</span><span class="stat-bottom"><strong class="stat-number">{{ visibleBatches.filter(batch => batch.state === card.state).length }}</strong><span class="stat-unit">筆批次</span></span></span><span class="stat-icon"><Icon :name="card.icon" /></span>
      </button>
    </div>
    <div class="notice" id="dashboard-notice" :hidden="selectedStatus !== 'stopped' || !filtered.length"><Icon name="alert" /><div><strong>{{ filtered.length }} 筆批次處理失敗</strong></div></div>
    <section class="panel" aria-labelledby="monitor-title">
      <div class="panel-heading workbench-toolbar"><div class="monitor-heading"><h2 id="monitor-title">批次監控</h2><span class="count-label" id="monitor-count">{{ selectedLabel }} {{ filtered.length }} 筆</span></div><OperationModeFilter v-if="isAdmin" id="workbench-mode" v-model="mode" /></div>
      <div id="dashboard-table"><BatchTable :items="filtered" workbench :pending-label="isSupervisor" @open="openBatch" /></div>
      <p v-if="reviewFeedback" id="review-entry-feedback" class="review-entry-feedback" role="status">{{ reviewFeedback }}</p>
      <div class="panel-footer"><span id="monitor-summary">共 {{ filtered.length }} 筆{{ selectedLabel }}批次</span><RouterLink class="text-link" to="/search">查看全部批次<Icon name="arrow" /></RouterLink></div>
    </section>
  </section>
</template>
