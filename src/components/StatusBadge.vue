<script setup>
import { statusNames } from '../lib/status.js';
defineProps({ state: { type: String, required: true } });
</script>
<template><span class="badge" :class="state">{{ statusNames[state] }}</span></template>
