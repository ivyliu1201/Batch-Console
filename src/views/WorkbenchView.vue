<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import BatchTable from '../components/BatchTable.vue';
import { batches } from '../data/demo.js';
const router = useRouter();
const route = useRoute();
const cards = [
  { state: 'stopped', label: '異常', icon: 'alert', className: 'failed' },
  { state: 'reviewing', label: '審核中', icon: 'file', className: 'reviewing' },
  { state: 'processing', label: '處理中', icon: 'clock', className: 'processing' },
  { state: 'success', label: '成功', icon: 'check', className: 'success' }
];
const selectedStatus = computed(() => cards.some(card => card.state === route.query.status) ? route.query.status : 'stopped');
const filtered = computed(() => batches.filter(batch => batch.state === selectedStatus.value));
const selectedLabel = computed(() => cards.find(card => card.state === selectedStatus.value).label);
function selectStatus(card) {
  router.replace({ name: 'workbench', query: { status: card.state } });
}
function openBatch(id) {
  router.push({ name: 'search', query: { batch: id, workbenchStatus: selectedStatus.value } });
}
</script>
<template>
  <section id="dashboard-view" class="view" aria-labelledby="dashboard-title">
    <div class="page-heading"><div><h1 id="dashboard-title">我的工作台</h1></div><span class="date-note"><Icon name="calendar" />示意資料 · 2026/09/07</span></div>
    <div class="stats" id="dashboard-stats">
      <button v-for="card in cards" :key="card.state" type="button" class="stat" :class="card.className" :data-status="card.state" :aria-pressed="selectedStatus === card.state" :aria-label="`篩選${card.label}批次`" @click="selectStatus(card)">
        <span class="stat-copy"><span class="stat-label">{{ card.label }}</span><span class="stat-bottom"><strong class="stat-number">{{ batches.filter(batch => batch.state === card.state).length }}</strong><span class="stat-unit">筆批次</span></span></span><span class="stat-icon"><Icon :name="card.icon" /></span>
      </button>
    </div>
    <div class="notice" id="dashboard-notice" :hidden="selectedStatus !== 'stopped'"><Icon name="alert" /><div><strong>4 筆批次處理失敗</strong><span>請查看失敗原因與解決方法；系統不提供人工重試。</span></div></div>
    <section class="panel" aria-labelledby="monitor-title">
      <div class="panel-heading"><div><h2 id="monitor-title">批次監控</h2><p id="monitor-description">目前顯示{{ selectedLabel }}批次。</p></div><span class="count-label" id="monitor-count">{{ selectedLabel }} {{ filtered.length }} 筆</span></div>
      <div id="dashboard-table"><BatchTable :items="filtered" workbench @open="openBatch" /></div>
      <div class="panel-footer"><span id="monitor-summary">共 {{ filtered.length }} 筆{{ selectedLabel }}批次</span><RouterLink class="text-link" to="/search">查看全部批次<Icon name="arrow" /></RouterLink></div>
    </section>
    <p class="prototype-note">此為 Vue 互動預覽，重新整理後會恢復示意資料。</p>
  </section>
</template>
