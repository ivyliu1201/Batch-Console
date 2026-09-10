<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import Icon from './Icon.vue';
import { dateKey, displayDate, taipeiNow } from '../lib/format.js';
import { selectDate } from '../lib/date-selection.js';
const props = defineProps({ start: { type: String, default: '' }, end: { type: String, default: '' }, description: { type: String, default: '選擇一天，或指定起訖日期。' } });
const emit = defineEmits(['apply', 'closed']);
const dialog = ref(null);
const mode = ref('range');
const draftStart = ref('');
const draftEnd = ref('');
const month = ref(new Date());
const today = ref(taipeiNow().slice(0, 10));
const narrow = ref(false);
let media;
function updateLayout() {
  narrow.value = media.matches;
  if (month.value > latestMonth.value) month.value = latestMonth.value;
}
const latestMonth = computed(() => new Date(Number(today.value.slice(0, 4)), Number(today.value.slice(5, 7)) - 1 - (narrow.value ? 0 : 1), 1));
const canMoveNext = computed(() => month.value < latestMonth.value);
onMounted(() => {
  media = window.matchMedia('(max-width: 680px)');
  updateLayout();
  media.addEventListener('change', updateLayout);
});
onUnmounted(() => media.removeEventListener('change', updateLayout));
const months = computed(() => (narrow.value ? [0] : [0, 1]).map(offset => {
  const first = new Date(month.value.getFullYear(), month.value.getMonth() + offset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return {
    key: dateKey(first), year: first.getFullYear(), number: first.getMonth() + 1, empty: first.getDay(),
    days: Array.from({ length: days }, (_, index) => {
      const key = dateKey(new Date(first.getFullYear(), first.getMonth(), index + 1));
      return { key, number: index + 1, selected: key === draftStart.value || key === draftEnd.value, inRange: !!(draftStart.value && draftEnd.value && key > draftStart.value && key < draftEnd.value) };
    })
  };
}));
const canApply = computed(() => !!(draftStart.value && draftEnd.value && draftEnd.value <= today.value));
const hint = computed(() => !draftStart.value ? `請選擇${mode.value === 'single' ? '日期' : '開始日期'}。` : !draftEnd.value ? '請選擇結束日期；再次點選同一天可選單日。' : '日期已選擇完成，按「套用日期」篩選紀錄。');
async function open() {
  draftStart.value = props.start;
  draftEnd.value = props.end;
  mode.value = props.start && props.start === props.end ? 'single' : 'range';
  today.value = taipeiNow().slice(0, 10);
  const anchor = props.start || today.value;
  month.value = new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1, 1);
  if (month.value > latestMonth.value) month.value = latestMonth.value;
  await nextTick();
  dialog.value.showModal();
}
defineExpose({ open });
function changeMode(value) {
  mode.value = value;
  draftStart.value = ''; draftEnd.value = '';
}
function choose(key) {
  today.value = taipeiNow().slice(0, 10);
  if (key > today.value) return;
  const selection = selectDate(draftStart.value, draftEnd.value, mode.value, key, today.value);
  draftStart.value = selection.start;
  draftEnd.value = selection.end;
}
function moveMonth(offset) {
  if (offset > 0 && !canMoveNext.value) return;
  month.value = new Date(month.value.getFullYear(), month.value.getMonth() + offset, 1);
}
async function moveFocus(event) {
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (!event.target.matches('[data-date]') || !(event.key in offsets)) return;
  event.preventDefault();
  const [year, monthNumber, day] = event.target.dataset.date.split('-').map(Number);
  const date = new Date(year, monthNumber - 1, day + offsets[event.key]);
  const key = dateKey(date);
  if (key > taipeiNow().slice(0, 10)) return;
  if (!dialog.value.querySelector(`[data-date="${key}"]`)) {
    month.value = new Date(date.getFullYear(), date.getMonth(), 1);
    if (month.value > latestMonth.value) month.value = latestMonth.value;
    await nextTick();
  }
  dialog.value.querySelector(`[data-date="${key}"]`)?.focus({ preventScroll: true });
}
function reset() {
  draftStart.value = ''; draftEnd.value = '';
}
function close() { dialog.value.close(); }
function onClose() { emit('closed'); }
function apply() {
  today.value = taipeiNow().slice(0, 10);
  if (!canApply.value) return;
  emit('apply', { start: draftStart.value, end: draftEnd.value });
  close();
}
</script>
<template>
  <dialog ref="dialog" id="date-dialog" aria-labelledby="date-dialog-title" @close="onClose" @keydown="moveFocus">
    <div class="dialog-heading"><div><h2 id="date-dialog-title">選擇日期</h2><p>{{ description }}</p></div><button type="button" class="icon-button" id="close-calendar" aria-label="關閉日期選擇器" @click="close"><Icon name="close" /></button></div>
    <div class="date-options">
      <div class="date-mode" role="group" aria-label="日期選擇模式"><button type="button" data-date-mode="range" :aria-pressed="mode === 'range'" @click="changeMode('range')">日期區間</button><button type="button" data-date-mode="single" :aria-pressed="mode === 'single'" @click="changeMode('single')">單日</button></div>
      <div class="selected-dates"><div><small id="date-start-label">{{ mode === 'single' ? '選擇日期' : '開始日期' }}</small><strong id="selected-start">{{ draftStart ? displayDate(draftStart) : '尚未選擇' }}</strong></div><span id="date-separator" :hidden="mode === 'single'">至</span><div id="selected-end-box" :hidden="mode === 'single'"><small>結束日期</small><strong id="selected-end">{{ draftEnd ? displayDate(draftEnd) : '尚未選擇' }}</strong></div></div>
    </div>
    <div class="calendar-navigation"><button type="button" class="icon-button" id="previous-month" aria-label="上一個月" @click="moveMonth(-1)"><Icon name="chevron" class="rotate" /></button><span>點選月曆中的日期</span><button type="button" class="icon-button" id="next-month" aria-label="下一個月" :disabled="!canMoveNext" @click="moveMonth(1)"><Icon name="chevron" /></button></div>
    <div id="calendar-months" class="calendar-months">
      <section v-for="item in months" :key="item.key" class="calendar-month" :aria-label="`${item.year}年${item.number}月`">
        <h3>{{ item.year }} 年 {{ item.number }} 月</h3>
        <div class="calendar-weekdays" aria-hidden="true"><span v-for="day in ['日', '一', '二', '三', '四', '五', '六']" :key="day">{{ day }}</span></div>
        <div class="calendar-days">
          <span v-for="empty in item.empty" :key="`empty-${empty}`" aria-hidden="true"></span>
          <button v-for="day in item.days" :key="day.key" type="button" class="calendar-day" :class="{ selected: day.selected, 'in-range': day.inRange, today: day.key === today }" :data-date="day.key" :aria-label="`${displayDate(day.key)}${day.key > today ? '，未來日期不可選' : ''}`" :aria-pressed="day.selected || day.inRange" :aria-current="day.key === today ? 'date' : undefined" :disabled="day.key > today" @click="choose(day.key)">{{ day.number }}</button>
        </div>
      </section>
    </div>
    <p id="calendar-hint" class="calendar-hint" role="status">{{ hint }}</p>
    <div class="dialog-footer"><button type="button" class="text-button" id="reset-calendar" @click="reset">重選日期</button><div><button type="button" class="button secondary" id="cancel-calendar" @click="close">取消</button><button type="button" class="button primary" id="apply-calendar" :disabled="!canApply" @click="apply">套用日期</button></div></div>
  </dialog>
</template>
