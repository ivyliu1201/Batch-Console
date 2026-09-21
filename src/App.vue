<script setup>
import { RouterView } from 'vue-router';
import IconLibrary from './components/IconLibrary.vue';
import { storageReady, storageError } from './services/persistence.js';
</script>
<template>
  <IconLibrary />
  <p v-if="storageError" class="storage-error" role="alert">{{ storageError }}</p>
  <RouterView v-if="storageReady" />
</template>
