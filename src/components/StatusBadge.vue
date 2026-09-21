<script setup>
import { statusNames } from '../lib/status.js';
defineProps({ state: { type: String, required: true }, label: String });
</script>
<template><span class="badge" :class="state">{{ label || statusNames[state] }}</span></template>
