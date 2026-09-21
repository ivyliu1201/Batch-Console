<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import DateRangePicker from '../components/DateRangePicker.vue';
import { auditEntries } from '../services/audit.js';
import { filterRecords, paginate, paginationPages } from '../lib/core.js';
import { displayDate } from '../lib/format.js';
import { currentUser, actorLabel } from '../services/session.js';
const isAdmin = computed(() => currentUser.value.role === 'admin');
const page = ref(1);
const start = ref('');
const end = ref('');
const picker = ref(null);
const dateTrigger = ref(null);
const pagination = ref(null);
const result = computed(() => {
  const ordered = auditEntries.value.map((entry, index) => ({ ...entry, index }))
    .filter(entry => isAdmin.value || entry.actor?.id === currentUser.value.id)
    .sort((a, b) => b.time.localeCompare(a.time) || b.index - a.index);
  return paginate(filterRecords(ordered, start.value, end.value), page.value);
});
watch(currentUser, () => { page.value = 1; });
const pages = computed(() => paginationPages(result.value.page, result.value.pageCount));
const rangeDescription = computed(() => !start.value ? '不限日期' : start.value === end.value ? displayDate(start.value) : `${displayDate(start.value)} – ${displayDate(end.value)}`);
async function changePage(number) {
  page.value = number;
  await nextTick();
  pagination.value.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
}
function applyRange(range) { start.value = range.start; end.value = range.end; page.value = 1; }
function focusTrigger() { dateTrigger.value?.focus({ preventScroll: true }); }
function clearRange() {
  start.value = ''; end.value = ''; page.value = 1;
  focusTrigger();
}
</script>
<template>
  <section id="audit-view" class="view" aria-labelledby="audit-title">
    <div class="page-heading"><div><h1 id="audit-title">操作紀錄</h1></div><span class="date-note">時間以台北時區顯示</span></div>
    <section class="panel audit-panel" aria-labelledby="audit-list-title">
      <div class="audit-toolbar"><div><h2 id="audit-list-title">{{ start ? '篩選結果' : '全部操作紀錄' }}</h2><p id="audit-range-description">{{ rangeDescription }} · 最新到最舊 · 每頁最多 20 筆</p></div><div class="date-controls"><button ref="dateTrigger" id="open-calendar" class="button secondary date-trigger" type="button" aria-haspopup="dialog" @click="picker.open()"><Icon name="calendar" /><span id="date-trigger-label">{{ start ? rangeDescription : '選擇日期或區間' }}</span><Icon name="chevron" class="small chevron-down" /></button><button id="clear-date-filter" class="text-button" type="button" :hidden="!start" @click="clearRange">清除篩選</button></div></div>
      <div id="audit-table" :class="{ 'audit-scroll': isAdmin }" :tabindex="isAdmin && result.total ? 0 : undefined" :role="isAdmin ? 'region' : undefined" :aria-label="isAdmin ? '操作紀錄表格' : undefined" aria-live="polite">
        <table v-if="result.total" class="audit-table" :class="{ 'with-actor': isAdmin }">
          <caption class="sr-only">各頁面操作紀錄</caption><thead><tr><th scope="col">批次編號</th><th v-if="isAdmin" scope="col">操作人員</th><th scope="col">操作紀錄</th><th scope="col">時間</th></tr></thead>
          <tbody><tr v-for="entry in result.items" :key="entry.index"><td class="batch-code">{{ entry.batchId || '—' }}</td><td v-if="isAdmin" class="audit-actor">{{ actorLabel(entry.actor) }}</td><td><span class="audit-action">{{ entry.action }}</span></td><td class="audit-time">{{ displayDate(entry.time.slice(0, 10)) }}<br>{{ entry.time.slice(11, 19) }}</td></tr></tbody>
        </table>
        <div v-else class="empty-state"><Icon name="history" /><strong>這段日期沒有操作紀錄</strong><p>請選擇其他日期，或清除篩選查看全部紀錄。</p></div>
      </div>
      <div class="pagination-footer">
        <p id="pagination-summary">共 {{ result.total }} 筆，顯示第 {{ result.total ? (result.page - 1) * 20 + 1 : 0 }}–{{ Math.min(result.page * 20, result.total) }} 筆</p>
        <nav ref="pagination" id="pagination" aria-label="操作紀錄分頁">
          <button type="button" class="page-button" :data-page="result.page - 1" aria-label="上一頁" :disabled="result.page === 1" @click="changePage(result.page - 1)"><Icon name="chevron" class="rotate" /></button>
          <template v-for="number in pages" :key="number"><button v-if="typeof number === 'number'" type="button" class="page-button" :data-page="number" :aria-label="`第 ${number} 頁`" :aria-current="number === result.page ? 'page' : undefined" @click="changePage(number)">{{ number }}</button><span v-else class="page-ellipsis">…</span></template>
          <button type="button" class="page-button" :data-page="result.page + 1" aria-label="下一頁" :disabled="result.page === result.pageCount" @click="changePage(result.page + 1)"><Icon name="chevron" /></button>
        </nav>
      </div>
    </section>
    <DateRangePicker ref="picker" :start="start" :end="end" @apply="applyRange" @closed="focusTrigger" />
  </section>
</template>
