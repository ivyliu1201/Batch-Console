<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import flowerLogoUrl from '../assets/console-flower.png'

defineProps({ collapsed: Boolean })
defineEmits(['toggle'])

const isUserMenuOpen = ref(false)
const userMenu = ref(null)

const toggleUserMenu = () => {
  isUserMenuOpen.value = !isUserMenuOpen.value
}

const closeUserMenu = (event) => {
  if (!userMenu.value || !userMenu.value.contains(event.target)) {
    isUserMenuOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('click', closeUserMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeUserMenu)
})
</script>

<template>
  <header class="topbar">
    <div class="topbar-brand">
      <button
        class="sidebar-toggle"
        id="sidebar-toggle"
        type="button"
        :aria-label="collapsed ? '展開側欄' : '收合側欄'"
        :aria-expanded="!collapsed"
        aria-controls="primary-navigation"
        @click="$emit('toggle')"
      >
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </button>

      <RouterLink class="brand-row" to="/workbench" aria-label="Batch Console 工作台">
        <img class="brand-logo" :src="flowerLogoUrl" alt="" />
        <span class="brand-name">Batch Console</span>
      </RouterLink>
    </div>

    <div ref="userMenu" class="user-menu-wrap">
      <button
        class="user-menu"
        type="button"
        :aria-expanded="isUserMenuOpen"
        aria-haspopup="menu"
        @click.stop="toggleUserMenu"
      >
        <span class="user-icon" aria-hidden="true"><Icon name="user" /></span>
        <span>範例使用者</span>
        <span class="user-caret" aria-hidden="true">▾</span>
      </button>

      <div v-if="isUserMenuOpen" class="user-dropdown" role="menu">
        <div class="user-dropdown-info">帳號：demo-user</div>
        <div class="user-dropdown-info">權限：系統管理員</div>
        <button class="logout-button" type="button" role="menuitem">登出</button>
      </div>
    </div>
  </header>
</template>
