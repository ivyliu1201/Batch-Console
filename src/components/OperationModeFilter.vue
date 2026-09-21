<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({ modelValue: { type: String, default: '' }, id: { type: String, required: true } });
const emit = defineEmits(['update:modelValue']);
const options = ['手動', '自動'];
const container = ref(null);
const trigger = ref(null);
const isOpen = ref(false);
const activeIndex = ref(0);

function open() {
  activeIndex.value = Math.max(0, options.indexOf(props.modelValue));
  isOpen.value = true;
}
function toggle() { if (isOpen.value) isOpen.value = false; else open(); }
async function choose(value) {
  emit('update:modelValue', value);
  isOpen.value = false;
  await nextTick();
  trigger.value?.focus({ preventScroll: true });
}
function onKeydown(event) {
  if (event.key === 'Tab') { isOpen.value = false; return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') { isOpen.value = false; return; }
  if (event.key === 'Enter' || event.key === ' ') {
    if (isOpen.value) choose(options[activeIndex.value]); else open();
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    isOpen.value = true;
    activeIndex.value = event.key === 'Home' ? 0 : options.length - 1;
  } else if (!isOpen.value) {
    open();
  } else {
    activeIndex.value = Math.max(0, Math.min(options.length - 1, activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1)));
  }
}
function closeOutside(event) {
  if (!container.value?.contains(event.target)) isOpen.value = false;
}
watch(() => props.modelValue, () => { isOpen.value = false; });
onMounted(() => document.addEventListener('pointerdown', closeOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOutside));
</script>

<template>
  <div ref="container" class="operation-mode-filter">
    <div class="operation-mode-field">
      <button :id="id" ref="trigger" class="operation-mode-trigger" type="button" role="combobox"
        aria-label="作業方式" aria-haspopup="listbox" :aria-expanded="isOpen" :aria-controls="`${id}-options`"
        :aria-activedescendant="isOpen ? `${id}-option-${activeIndex}` : undefined"
        @click="toggle" @keydown="onKeydown">
        <span>{{ modelValue || '作業方式' }}</span><Icon name="chevron" class="chevron-down" />
      </button>
      <div v-if="isOpen" :id="`${id}-options`" class="operation-mode-options" role="listbox" aria-label="作業方式">
        <div v-for="(option, index) in options" :id="`${id}-option-${index}`" :key="option" role="option"
          class="operation-mode-option" :class="{ active: activeIndex === index }" :aria-selected="modelValue === option"
          @pointermove="activeIndex = index" @mousedown.prevent @click="choose(option)">
          <span>{{ option }}</span><Icon v-if="modelValue === option" name="check" />
        </div>
      </div>
    </div>
    <button v-if="modelValue" type="button" class="text-button" @click="choose('')">清除作業方式</button>
  </div>
</template>

<style scoped>
.operation-mode-filter{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font:inherit}
.operation-mode-field{position:relative}
.operation-mode-trigger{display:flex;align-items:center;justify-content:space-between;gap:20px;min-width:132px;min-height:42px;padding:10px 14px;border:1px solid #dfe6e2;border-radius:var(--radius);background:#fff;color:var(--ink);font:inherit;line-height:1.5;text-align:left;white-space:nowrap}
.operation-mode-trigger:hover,.operation-mode-trigger[aria-expanded="true"]{background:var(--green-soft);border-color:#91ae9c;color:var(--green)}
.operation-mode-trigger>.icon{width:14px;height:14px;color:#698474}
.operation-mode-trigger:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.operation-mode-options{position:absolute;right:0;top:calc(100% + 8px);z-index:15;min-width:160px;padding:8px;background:#fff;color:var(--ink);border:1px solid #dfe6e2;border-radius:8px;box-shadow:0 14px 35px #1f403126;font:inherit}
.operation-mode-option{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px;border-radius:6px;line-height:1.5;cursor:pointer;white-space:nowrap}
.operation-mode-option.active,.operation-mode-option[aria-selected="true"]{background:var(--green-soft);color:var(--green)}
.operation-mode-option>.icon{width:16px;height:16px}
</style>
