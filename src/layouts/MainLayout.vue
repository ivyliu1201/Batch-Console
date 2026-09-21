<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import AppSidebar from '../components/AppSidebar.vue';
const route = useRoute();
const compactLayout = window.matchMedia('(max-width: 680px)');
const collapsed = ref(compactLayout.matches);
const viewBreadcrumbs = ref(null);
const breadcrumbs = computed(() => viewBreadcrumbs.value ?? route.meta.breadcrumb ?? []);

provide('setLayoutBreadcrumbs', (items) => {
  viewBreadcrumbs.value = items;
});

function syncSidebarToViewport(event) {
  collapsed.value = event.matches;
}

onMounted(() => {
  compactLayout.addEventListener('change', syncSidebarToViewport);
});

onBeforeUnmount(() => {
  compactLayout.removeEventListener('change', syncSidebarToViewport);
});

watch(() => route.fullPath, () => {
  viewBreadcrumbs.value = null;
  if (compactLayout.matches) collapsed.value = true;
});

function toggleSidebar() {
  collapsed.value = !collapsed.value;
}
</script>
<template>
  <div :class="{ 'sidebar-collapsed': collapsed }">
    <a class="skip-link" href="#main">跳至主要內容</a>
    <AppHeader :collapsed="collapsed" @toggle="toggleSidebar" />
    <AppSidebar :collapsed="collapsed" />
    <main id="main" tabindex="-1">
      <div class="workspace">
        <div v-if="breadcrumbs.length" class="breadcrumb" id="breadcrumb">
          <template v-for="(item, index) in breadcrumbs" :key="item">
            <span v-if="index > 0">/</span>{{ item }}
          </template>
        </div>
        <RouterView />
        <footer class="workspace-footer"><span>Batch Console</span></footer>
      </div>
    </main>
  </div>
</template>
