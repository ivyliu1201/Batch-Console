<script setup>
import Icon from './Icon.vue';
import StatusBadge from './StatusBadge.vue';
import { displayDate } from '../lib/format.js';
defineProps({ items: { type: Array, required: true }, workbench: Boolean, pendingLabel: Boolean });
defineEmits(['open']);
</script>
<template>
  <table v-if="items.length" class="batch-table">
    <caption class="sr-only">批次清單</caption>
    <thead><tr><th scope="col">批次編號</th><th scope="col">作業名稱</th><th scope="col">目前狀態</th><th scope="col">最後更新時間</th><th scope="col">作業方式</th><th scope="col"><span class="sr-only">查看</span></th></tr></thead>
    <tbody><tr v-for="batch in items" :key="batch.id" class="batch-row" @click="$emit('open', batch.id)">
      <td data-label="批次編號"><span class="batch-code">{{ batch.id }}</span></td>
      <td data-label="作業名稱"><span class="job-name">{{ batch.name }}</span><span class="job-description">{{ batch.flow }}</span></td>
      <td data-label="目前狀態"><StatusBadge :state="workbench && batch.state === 'stopped' ? 'failed' : batch.state" :label="pendingLabel && batch.state === 'reviewing' ? '待審核' : undefined" /></td>
      <td class="time-cell" data-label="最後更新時間">{{ displayDate(batch.updated.slice(0, 10)) }}<small>{{ batch.updated.slice(11, 19) }}</small></td>
      <td data-label="作業方式"><span class="mode-label">{{ batch.mode }}</span></td>
      <td><button type="button" class="view-button" :data-batch="batch.id" :aria-label="`查看 ${batch.id}`" @click.stop="$emit('open', batch.id)">查看</button></td>
    </tr></tbody>
  </table>
  <div v-else class="empty-state"><Icon name="search" /><strong>查無符合的批次</strong></div>
</template>
