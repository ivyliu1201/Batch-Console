import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { audit } from './services/audit.js';
import { initializePersistence } from './services/persistence.js';
import './styles/main.css';

window.BatchConsoleAudit = audit;
initializePersistence().then(() => createApp(App).use(router).mount('#app'));
