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

<style scoped>
.pipeline-area{min-width:0}
.pipeline,.pipeline.extended{--pipeline-gap:8px;display:grid;grid-template-columns:repeat(var(--stage-count),minmax(0,1fr));gap:var(--pipeline-gap)}
.pipeline .stage{display:flex;flex-direction:column;align-items:flex-start;gap:0;padding:14px 6px;min-width:0}
.pipeline .stage-circle{width:28px;height:28px;margin:0 0 10px}
.pipeline .stage-name{font-size:12px;line-height:1.6;min-height:0;white-space:nowrap;overflow-wrap:normal;text-wrap:nowrap}
.pipeline .stage-state{margin-top:8px;white-space:nowrap}
.pipeline .stage-time{margin-top:6px;white-space:nowrap}
.pipeline .stage:not(:last-child)::after{display:block;width:var(--pipeline-gap);height:1px;left:auto;right:calc(-1 * var(--pipeline-gap) - 1px);top:28px;bottom:auto}
</style>
