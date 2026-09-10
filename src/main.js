import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { audit } from './services/audit.js';
import './styles/main.css';

window.BatchConsoleAudit = audit;
createApp(App).use(router).mount('#app');
