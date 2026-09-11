<script setup>
import { ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from './Icon.vue'

defineProps({ collapsed: Boolean })

const route = useRoute()
const operationOpen = ref(true)

const primaryLinks = [
  { path: '/workbench', key: 'dashboard', label: '工作台', icon: 'dashboard', dataRoute: 'dashboard' },
  { path: '/search', key: 'query', label: '查詢批次', icon: 'search', dataRoute: 'query' },
]

const operationLinks = [
  { path: '/operation/upload', key: 'upload', label: '上傳', icon: 'upload' },
  { path: '/operation/download', key: 'download', label: '下傳', icon: 'download' },
  { path: '/operation/transfer', key: 'transfer', label: '轉送', icon: 'send' },
]

const utilityLinks = [
  { path: '/logs', key: 'audit', label: '操作紀錄', icon: 'history', dataRoute: 'audit' },
]

const isOperationActive = () => route.path.startsWith('/operation/')
</script>

<template>
  <aside class="sidebar" aria-label="主要導覽">
    <nav id="primary-navigation">
      <RouterLink
        v-for="link in primaryLinks"
        :key="link.key"
        class="nav-item"
        :to="link.key === 'dashboard' && route.name === 'search' && route.query.workbenchStatus ? { path: link.path, query: { status: route.query.workbenchStatus } } : link.path"
        :data-route="link.dataRoute"
        :aria-label="link.label"
        :title="link.label"
        :aria-current="route.path === link.path ? 'page' : undefined"
      >
        <Icon :name="link.icon" />
        <span>{{ link.label }}</span>
      </RouterLink>

      <button
        class="nav-item nav-group"
        type="button"
        aria-controls="operation-navigation"
        :aria-expanded="operationOpen"
        :aria-current="isOperationActive() ? 'page' : undefined"
        title="作業處理"
        @click="operationOpen = !operationOpen"
      >
        <Icon name="list" />
        <span>作業處理</span>
        <Icon name="chevron" class="nav-group-chevron" />
      </button>

      <div v-show="operationOpen" id="operation-navigation" class="nav-children">
        <RouterLink
          v-for="link in operationLinks"
          :key="link.key"
          class="nav-item nav-child"
          :to="link.path"
          :aria-label="link.label"
          :title="link.label"
          :aria-current="route.path === link.path ? 'page' : undefined"
        >
          <Icon :name="link.icon" />
          <span>{{ link.label }}</span>
        </RouterLink>
      </div>

      <RouterLink
        v-for="link in utilityLinks"
        :key="link.key"
        class="nav-item"
        :to="link.path"
        :data-route="link.dataRoute"
        :aria-label="link.label"
        :title="link.label"
        :aria-current="route.path === link.path ? 'page' : undefined"
      >
        <Icon :name="link.icon" />
        <span>{{ link.label }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>
