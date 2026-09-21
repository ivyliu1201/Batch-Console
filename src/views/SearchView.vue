<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import BatchTable from '../components/BatchTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Pipeline from '../components/Pipeline.vue';
import StageDetail from '../components/StageDetail.vue';
import DateRangePicker from '../components/DateRangePicker.vue';
import OperationModeFilter from '../components/OperationModeFilter.vue';
import { batches } from '../data/demo.js';
import { filterBatches, paginate, canViewBatch } from '../lib/core.js';
import { stageSummary } from '../lib/status.js';
import { displayDate } from '../lib/format.js';
import { currentUser } from '../services/session.js';

const route = useRoute();
const router = useRouter();
const input = ref('');
const query = ref('');
const feedback = ref('');
const start = ref('');
const end = ref('');
const page = ref(1);
const mode = ref('');
const isAdmin = computed(() => currentUser.value.role === 'admin');
const selectedId = ref('');
const selectedStage = ref(0);
const selectedAttempt = ref(0);
const picker = ref(null);
const dateTrigger = ref(null);
const pagination = ref(null);
const searchExpanded = ref(false);
const selectedBatch = computed(() => batches.find(batch => batch.id === selectedId.value && canViewBatch(batch, currentUser.value)) || null);
const stage = computed(() => selectedBatch.value?.stages[selectedStage.value]);
const matches = computed(() => filterBatches(batches, query.value, start.value, end.value, { actor: currentUser.value, mode: mode.value }));
const result = computed(() => paginate(matches.value, page.value));
const pages = computed(() => {
  const items = [];
  let previous = 0;
  for (let number = 1; number <= result.value.pageCount; number++) {
    if (number !== 1 && number !== result.value.pageCount && Math.abs(number - result.value.page) > 1) continue;
    if (previous && number - previous > 1) items.push('ellipsis-' + number);
    items.push(number); previous = number;
  }
  return items;
});
const rangeDescription = computed(() => !start.value ? '不限日期' : start.value === end.value ? displayDate(start.value) : displayDate(start.value) + ' – ' + displayDate(end.value));
function selectBatch(id) {
  selectedId.value = id || '';
  searchExpanded.value = false;
  feedback.value = '';
  input.value = query.value;
  if (!selectedBatch.value) {
    if (id) { query.value = id; input.value = id; page.value = 1; feedback.value = '查無批次「' + id + '」。'; }
    return;
  }
  const index = selectedBatch.value.stages.findIndex(item => ['stopped', 'processing', 'retrying', 'reviewing', 'cancelled'].includes(stageSummary(item).state));
  selectedStage.value = index < 0 ? selectedBatch.value.stages.length - 1 : index;
  selectedAttempt.value = Math.max(0, stage.value.attempts.length - 1);
}
watch(() => route.query.batch, id => selectBatch(id), { immediate: true });
watch(currentUser, async () => {
  mode.value = ''; page.value = 1;
  if (selectedId.value && !selectedBatch.value) await showList();
});
async function applyMode(value) {
  mode.value = value; page.value = 1; feedback.value = '';
  await showList();
}
async function openBatch(id) {
  if (route.query.batch === id) selectBatch(id);
  else await router.push({ name: 'search', query: { batch: id } });
  await nextTick();
  document.querySelector('#batch-detail')?.scrollIntoView({ block: 'start' });
}
async function showList() {
  await router.push({ name: 'search' });
  selectedId.value = '';
  input.value = query.value;
}
async function search(event) {
  query.value = new FormData(event.currentTarget).get('batch').trim();
  page.value = 1;
  const count = matches.value.length;
  if (count === 1) { openBatch(matches.value[0].id); return; }
  await showList();
  feedback.value = query.value ? '查詢「' + query.value + '」，共 ' + count + ' 筆結果。' : '';
}
async function showAll() {
  query.value = ''; start.value = ''; end.value = ''; mode.value = ''; page.value = 1; feedback.value = '';
  await showList();
}
async function backToList() {
  if (route.query.workbenchStatus) await router.push({ name: 'workbench', query: { status: route.query.workbenchStatus } });
  else await showList();
}
async function changePage(number) {
  page.value = number;
  await nextTick();
  pagination.value.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
}
async function applyRange(range) {
  query.value = input.value.trim();
  start.value = range.start; end.value = range.end; page.value = 1; feedback.value = '';
  await showList();
}
function focusDateTrigger() { dateTrigger.value?.focus({ preventScroll: true }); }
async function clearRange() {
  start.value = ''; end.value = ''; page.value = 1; feedback.value = '';
  await showList();
  focusDateTrigger();
}
function selectStage(index) {
  selectedStage.value = index;
  selectedAttempt.value = Math.max(0, stage.value.attempts.length - 1);
}
function selectAttempt(index) {
  selectedAttempt.value = index;
}
</script>
<template>
  <section id="query-view" class="view" aria-labelledby="query-title">
    <div class="page-heading"><div><h1 id="query-title">查詢批次</h1></div></div>
    <button v-if="selectedBatch" id="toggle-batch-search" class="button secondary search-toggle" type="button" :aria-expanded="searchExpanded" aria-controls="batch-search" @click="searchExpanded = !searchExpanded"><Icon name="search" />{{ searchExpanded ? '收合查詢條件' : '調整查詢條件' }}</button>
    <form v-show="!selectedBatch || searchExpanded" id="batch-search" class="panel search-panel" role="search" aria-label="批次查詢" @submit.prevent="search">
      <label for="batch-id-input">批次編號</label>
      <div class="search-controls"><div class="search-input"><Icon name="search" /><input id="batch-id-input" v-model="input" name="batch" type="search" autocomplete="off" placeholder="輸入完整或部分批次編號"></div><button class="button primary" type="submit">查詢批次</button><button class="button secondary" type="button" id="show-all-batches" @click="showAll">顯示全部</button></div>
      <div class="query-date-filter">
        <div><span class="filter-label">最後更新日期</span><p id="query-range-description">最後更新日期：{{ rangeDescription }} · 每頁最多 20 筆</p></div>
        <div class="query-filter-controls"><OperationModeFilter v-if="isAdmin" id="query-mode" :model-value="mode" @update:model-value="applyMode" /><div class="date-controls"><button ref="dateTrigger" id="open-query-calendar" class="button secondary date-trigger" type="button" aria-haspopup="dialog" @click="picker.open()"><Icon name="calendar" /><span id="query-date-label">{{ start ? rangeDescription : '選擇日期或區間' }}</span><Icon name="chevron" class="small chevron-down" /></button><button id="clear-query-date" class="text-button" type="button" :hidden="!start" @click="clearRange">清除日期</button></div></div>
      </div>
      <p id="search-feedback" class="search-feedback" role="status">{{ feedback }}</p>
    </form>
    <section class="panel" id="query-list" aria-labelledby="query-list-title" :hidden="!!selectedBatch">
      <div class="panel-heading"><h2 id="query-list-title">{{ !query && !start && !mode ? '全部批次' : '查詢結果 · ' + result.total + ' 筆' }}</h2></div>
      <div id="query-table"><BatchTable :items="result.items" @open="openBatch" /></div>
      <div class="pagination-footer">
        <p id="query-pagination-summary">共 {{ result.total }} 筆，顯示第 {{ result.total ? (result.page - 1) * 20 + 1 : 0 }}–{{ Math.min(result.page * 20, result.total) }} 筆</p>
        <nav ref="pagination" id="query-pagination" aria-label="查詢批次分頁">
          <button type="button" class="page-button" :data-query-page="result.page - 1" aria-label="上一頁" :disabled="result.page === 1" @click="changePage(result.page - 1)"><Icon name="chevron" class="rotate" /></button>
          <template v-for="number in pages" :key="number"><button v-if="typeof number === 'number'" type="button" class="page-button" :data-query-page="number" :aria-label="'第 ' + number + ' 頁'" :aria-current="number === result.page ? 'page' : undefined" @click="changePage(number)">{{ number }}</button><span v-else class="page-ellipsis">…</span></template>
          <button type="button" class="page-button" :data-query-page="result.page + 1" aria-label="下一頁" :disabled="result.page === result.pageCount" @click="changePage(result.page + 1)"><Icon name="chevron" /></button>
        </nav>
      </div>
    </section>
    <div id="batch-detail" :hidden="!selectedBatch">
      <template v-if="selectedBatch">
        <button type="button" class="back-link" id="back-to-batches" @click="backToList"><Icon name="arrow" class="rotate" />{{ route.query.workbenchStatus ? '返回工作台' : '返回批次清單' }}</button>
        <section class="panel" aria-label="批次摘要與完整流程">
          <div class="detail-top"><div class="detail-identity"><small>批次編號</small><h2>{{ selectedBatch.id }}</h2></div><div class="detail-actions"><StatusBadge :state="selectedBatch.state" /></div></div>
          <div v-if="selectedBatch.state === 'reviewing'" class="review-notice"><strong>等待審核完成</strong></div>
          <div v-else-if="selectedBatch.state === 'cancelled'" class="cancelled-notice" role="status"><strong>此批次已取消上傳</strong><span>後續流程不會執行，批次與操作紀錄已保留。</span></div>
          <div class="batch-metadata">
            <div><span class="metadata-label">作業名稱</span><span class="metadata-value">{{ selectedBatch.name }}</span></div>
            <div><span class="metadata-label">作業方式</span><span class="metadata-value">{{ selectedBatch.mode }}</span></div>
            <div><span class="metadata-label">流程類型</span><span class="metadata-value">{{ selectedBatch.flow }}</span></div>
            <div><span class="metadata-label">最後更新時間</span><span class="metadata-value">{{ displayDate(selectedBatch.updated.slice(0, 10)) }} {{ selectedBatch.updated.slice(11, 19) }}</span></div>
          </div>
          <Pipeline :stages="selectedBatch.stages" :selected="selectedStage" @select="selectStage" />
        </section>
        <StageDetail :stage="stage" :batch-state="selectedBatch.state" :selected-attempt="selectedAttempt" @select-attempt="selectAttempt" />
      </template>
    </div>
    <DateRangePicker ref="picker" :start="start" :end="end" @apply="applyRange" @closed="focusDateTrigger" />
  </section>
</template>
