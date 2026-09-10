<script setup>
import { computed } from 'vue';
import Icon from './Icon.vue';
import { statusNames, stageSummary } from '../lib/status.js';
import { stageTime } from '../lib/format.js';
const props = defineProps({ stages: { type: Array, required: true }, selected: { type: Number, required: true } });
defineEmits(['select']);
const summaries = computed(() => props.stages.map(stageSummary));
</script>
<template>
  <div class="pipeline-area">
    <div class="pipeline-heading"><h3>完整處理流程</h3><span>{{ summaries.filter(summary => summary.state === 'success').length }} / {{ stages.length }} 階段完成</span></div>
    <div class="pipeline" :class="{ extended: stages.length === 8 }" :style="{ '--stage-count': stages.length }">
      <button v-for="(stage, index) in stages" :key="stage.name" class="stage" :class="summaries[index].state" type="button" :data-stage="index" :aria-pressed="selected === index" :aria-label="`${stage.name}，${statusNames[summaries[index].state]}`" @click="$emit('select', index)">
        <span class="stage-circle"><Icon v-if="summaries[index].state === 'success'" name="check" /><Icon v-else-if="summaries[index].state === 'stopped'" name="close" /><template v-else>{{ index + 1 }}</template></span>
        <span class="stage-name">{{ stage.name }}</span><span class="stage-state">{{ statusNames[summaries[index].state] }}</span><span class="stage-time">{{ stageTime(stage) }}</span>
      </button>
    </div>
  </div>
</template>
