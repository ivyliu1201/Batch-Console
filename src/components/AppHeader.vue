<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import flowerLogoUrl from '../assets/console-flower.png'
import { currentUser, users, switchRole } from '../services/session.js'

defineProps({ collapsed: Boolean })
defineEmits(['toggle'])

const isUserMenuOpen = ref(false)
const userMenu = ref(null)
const userMenuTrigger = ref(null)
const router = useRouter()

const dismissUserMenu = () => {
  isUserMenuOpen.value = false
  userMenuTrigger.value?.focus({ preventScroll: true })
}

const selectUser = async (id) => {
  switchRole(id)
  dismissUserMenu()
  await nextTick()
  await router.replace({ name: 'workbench' })
}

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

    <div ref="userMenu" class="user-menu-wrap" @keydown.esc.stop.prevent="dismissUserMenu">
      <button
        ref="userMenuTrigger"
        class="user-menu"
        type="button"
        :aria-expanded="isUserMenuOpen"
        aria-haspopup="menu"
        @click.stop="toggleUserMenu"
      >
        <span class="user-icon" aria-hidden="true"><Icon name="user" /></span>
        <span>{{ currentUser.name }}</span>
        <span class="user-caret" aria-hidden="true">▾</span>
      </button>

      <div v-if="isUserMenuOpen" class="user-dropdown" role="menu">
        <button v-for="user in users" :key="user.id" class="role-option" type="button" role="menuitemradio"
          :data-role="user.role" :aria-checked="currentUser.id === user.id"
          @click="selectUser(user.id)">{{ user.name }}</button>
      </div>
    </div>
  </header>
</template>
