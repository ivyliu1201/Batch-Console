import { computed, ref } from 'vue';

// Local role accounts; replace with the host application's identity when integrating.
export const users = Object.freeze([
  Object.freeze({ id: 'clerk', name: '經辦人員', role: 'clerk' }),
  Object.freeze({ id: 'supervisor', name: '主管', role: 'supervisor' }),
  Object.freeze({ id: 'admin', name: '管理人員', role: 'admin' }),
]);
const selected = ref('admin');
export const currentUser = computed(() => users.find(user => user.id === selected.value));
export function switchRole(id) {
  if (users.some(user => user.id === id)) selected.value = id;
}
export function actorLabel(actor) {
  if (!actor?.name) return '-';
  const role = users.find(user => user.role === actor.role)?.name;
  return role && role !== actor.name ? `${actor.name}（${role}）` : actor.name;
}
