import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from '../layouts/MainLayout.vue';
import WorkbenchView from '../views/WorkbenchView.vue';
import SearchView from '../views/SearchView.vue';
import UploadView from '../views/UploadView.vue';
import DownloadView from '../views/DownloadView.vue';
import TransferView from '../views/TransferView.vue';
import OperationLogView from '../views/OperationLogView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [{
    path: '/', component: MainLayout, redirect: '/workbench',
    children: [
      { path: 'workbench', name: 'workbench', component: WorkbenchView, meta: { title: '工作台', prototypeKey: 'dashboard', breadcrumb: ['Batch-Console', '工作台'] } },
      { path: 'search', name: 'search', component: SearchView, meta: { title: '查詢批次', prototypeKey: 'query', breadcrumb: ['Batch-Console', '查詢批次'] } },
      { path: 'operation/upload', name: 'operation-upload', component: UploadView, meta: { title: '上傳', prototypeKey: 'upload', breadcrumb: ['作業處理', '上傳'] } },
      { path: 'operation/download', name: 'operation-download', component: DownloadView, meta: { title: '下傳', prototypeKey: 'download', breadcrumb: ['作業處理', '下傳'] } },
      { path: 'operation/transfer', name: 'operation-transfer', component: TransferView, meta: { title: '轉送', prototypeKey: 'transfer', breadcrumb: ['作業處理', '轉送'] } },
      { path: 'logs', name: 'logs', component: OperationLogView, meta: { title: '操作紀錄', prototypeKey: 'audit', breadcrumb: ['Batch-Console', '操作紀錄'] } }
    ]
  }],
  scrollBehavior(to, from) { if (to.name !== from.name) return { top: 0 }; }
});
router.afterEach((to, from, failure) => {
  if (failure) return;
  document.title = `Batch Console · ${to.meta.title}`;
});
export default router;
