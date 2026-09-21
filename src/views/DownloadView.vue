<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { audit } from '../services/audit.js'
import { savePendingChanges } from '../services/persistence.js'

const jobTypes = [
  {
    fileTypeCode: 'DT01',
    jobName: '範例資料匯入',
  },
  {
    fileTypeCode: 'DT02',
    jobName: '測試資料同步',
  },
  {
    fileTypeCode: 'DT03',
    jobName: '報表資料彙整',
  },
  {
    fileTypeCode: 'DT04',
    jobName: '通知資料更新',
  },
  {
    fileTypeCode: 'DT05',
    jobName: '排程資料處理',
  },
  {
    fileTypeCode: 'DT06',
    jobName: '回應資料匯入',
  },
  {
    fileTypeCode: 'DT07',
    jobName: '對照資料整理',
  },
  {
    fileTypeCode: 'DT08',
    jobName: '跨系統資料交換',
  },
  {
    fileTypeCode: 'DT09',
    jobName: '歷史資料歸檔',
  },
  {
    fileTypeCode: 'DT10',
    jobName: '狀態資料更新',
  },
]

const createdDates = ['2026/09/07', '2026/09/06', '2026/09/05', '2026/09/04', '2026/09/03']
const extensionCycle = ['txt', 'csv', 'dat']
const pageSize = 20

const toCompactDate = (date) => date.replaceAll('/', '')

const formatId = (id) => String(id).padStart(2, '0')

const formatSerial = (serial) => String(serial).padStart(3, '0')

const downloadFiles = Array.from({ length: 65 }, (_, index) => {
  const id = index + 1
  const job = jobTypes[index % jobTypes.length]
  const createdDate = createdDates[Math.floor(index / 13)]
  const extension = extensionCycle[(index + job.fileTypeCode.length) % extensionCycle.length]
  const serial = Math.floor(index / jobTypes.length) + 1
  const fileName =
    id === 37
      ? `${job.fileTypeCode}_${toCompactDate(createdDate)}_fail.${extension}`
      : `${job.fileTypeCode}_${toCompactDate(createdDate)}_${formatSerial(serial)}.${extension}`

  return {
    id,
    fileTypeCode: job.fileTypeCode,
    jobName: job.jobName,
    fileName,
    createdDate,
  }
})

const currentPage = ref(1)
const selectedIds = ref(new Set())
const showConfirmModal = ref(false)
const notification = ref(null)
const notificationTimer = ref(null)

const totalPages = computed(() => Math.ceil(downloadFiles.length / pageSize))

const pageNumbers = computed(() =>
  Array.from({ length: totalPages.value }, (_, index) => index + 1),
)

const pagedFiles = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return downloadFiles.slice(start, start + pageSize)
})

const selectedFiles = computed(() =>
  downloadFiles.filter((file) => selectedIds.value.has(file.id)),
)

const selectedCount = computed(() => selectedIds.value.size)

const hasSelection = computed(() => selectedCount.value > 0)

const isSelected = (id) => selectedIds.value.has(id)

const toggleSelected = (id) => {
  const nextSelectedIds = new Set(selectedIds.value)

  if (nextSelectedIds.has(id)) {
    nextSelectedIds.delete(id)
  } else {
    nextSelectedIds.add(id)
  }

  selectedIds.value = nextSelectedIds
}

const goToPage = (page) => {
  if (page < 1 || page > totalPages.value) return

  currentPage.value = page
}

const openConfirmModal = () => {
  if (!hasSelection.value) return

  showConfirmModal.value = true
}

const closeConfirmModal = () => {
  showConfirmModal.value = false
}

const showNotification = (type, title, message) => {
  if (notificationTimer.value) window.clearTimeout(notificationTimer.value)

  notification.value = {
    type,
    title,
    message,
  }

  notificationTimer.value = window.setTimeout(() => {
    notification.value = null
    notificationTimer.value = null
  }, 3000)
}

const confirmDownload = async () => {
  const shouldFail = selectedFiles.value.some((file) =>
    file.fileName.toLowerCase().includes('fail'),
  )

  showConfirmModal.value = false

  if (shouldFail) {
    showNotification('error', '下載失敗', '檔案下載失敗，請稍後重新嘗試。')
    return
  }

  const downloadedCount = selectedCount.value
  audit.record('下傳', `下傳成功：${downloadedCount} 筆檔案；${selectedFiles.value.map((file) => file.fileName).join('、')}`)
  try {
    await savePendingChanges()
  } catch {
    showNotification('error', '下載失敗', '無法完成作業紀錄保存，請確認瀏覽器儲存狀態。')
    return
  }
  selectedIds.value = new Set()
  showNotification('success', '下載成功', `已成功下載 ${downloadedCount} 筆檔案。`)
}

const handleKeydown = (event) => {
  if (event.key === 'Escape' && showConfirmModal.value) {
    closeConfirmModal()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (notificationTimer.value) window.clearTimeout(notificationTimer.value)
})
</script>

<template>
  <section class="view download-view">
    <Transition name="toast">
      <div
        v-if="notification"
        class="download-toast"
        :class="`is-${notification.type}`"
        role="status"
      >
        <strong>{{ notification.title }}</strong>
        <span>{{ notification.message }}</span>
      </div>
    </Transition>

    <section class="download-section">
      <div class="page-heading download-page-heading">
        <div>
          <h1>選擇下傳檔案</h1>
          <p>請選擇欲下載的檔案，可一次選取多筆。</p>
        </div>
      </div>

      <section class="panel download-list-panel" aria-label="Download file list">
        <div class="download-table-wrap">
        <table class="download-file-table">
          <thead>
            <tr>
              <th>編號</th>
              <th>檔案類型代碼</th>
              <th>作業名稱</th>
              <th>檔案名稱</th>
              <th>建立日期</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="file in pagedFiles"
              :key="file.id"
              :class="{ 'is-selected': isSelected(file.id) }"
              tabindex="0"
              @click="toggleSelected(file.id)"
              @keydown.enter.prevent="toggleSelected(file.id)"
              @keydown.space.prevent="toggleSelected(file.id)"
            >
              <td>{{ formatId(file.id) }}</td>
              <td>{{ file.fileTypeCode }}</td>
              <td>{{ file.jobName }}</td>
              <td>{{ file.fileName }}</td>
              <td>{{ file.createdDate }}</td>
            </tr>
          </tbody>
        </table>
        </div>

      <div class="download-table-footer">
        <nav class="pagination" aria-label="Download file pages">
          <button
            class="pagination-button"
            type="button"
            :disabled="currentPage === 1"
            aria-label="上一頁"
            @click="goToPage(currentPage - 1)"
          >
            ‹
          </button>
          <button
            v-for="page in pageNumbers"
            :key="page"
            class="pagination-button"
            :class="{ 'is-active': currentPage === page }"
            type="button"
            @click="goToPage(page)"
          >
            {{ page }}
          </button>
          <button
            class="pagination-button"
            type="button"
            :disabled="currentPage === totalPages"
            aria-label="下一頁"
            @click="goToPage(currentPage + 1)"
          >
            ›
          </button>
        </nav>

        <div class="download-footer-actions">
          <span class="selected-count">已選取 {{ selectedCount }} 筆</span>
          <button
            class="primary-button download-submit-button"
            type="button"
            :disabled="!hasSelection"
            @click="openConfirmModal"
          >
            下載
          </button>
        </div>
      </div>
      </section>
    </section>

    <div v-if="showConfirmModal" class="modal-backdrop" role="presentation">
      <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="modal-header">
          <h2 id="confirm-title">確認下載</h2>
          <p>已選取 {{ selectedCount }} 筆檔案</p>
        </div>

        <div class="selected-summary-wrap">
          <table class="selected-summary-table">
            <thead>
              <tr>
                <th>編號</th>
                <th>作業名稱</th>
                <th>檔案名稱</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in selectedFiles" :key="file.id">
                <td>{{ formatId(file.id) }}</td>
                <td>{{ file.jobName }}</td>
                <td>{{ file.fileName }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="modal-actions">
          <button class="text-button" type="button" @click="closeConfirmModal">取消</button>
          <button class="primary-button" type="button" @click="confirmDownload">
            確認下載
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.download-view {
  position: relative;
  --batch-text: var(--ink);
  --batch-text-secondary: var(--muted);
  --batch-border: var(--line);
  --batch-surface: #fff;
  --batch-primary: var(--green);
  --batch-primary-dark: var(--green-dark);
  --batch-green-50: var(--green-soft);
  --batch-green-200: #cbded2;
  --batch-shadow: 0 14px 35px #1f403126;
}

.download-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
}

.download-page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 0;
}

.download-page-heading h1 {
  margin: 0;
  color: var(--batch-text);
  font-weight: 600;
  line-height: 1.35;
}

.download-page-heading p {
  margin: 6px 0 0;
  color: var(--batch-text-secondary);
  font-size: 0.95rem;
}

.download-table-wrap {
  overflow-x: auto;
}

.download-file-table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  background: var(--batch-surface);
}

.download-file-table th,
.download-file-table td {
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid var(--batch-border);
}

.download-file-table th {
  color: var(--batch-primary-dark);
  background: var(--batch-green-50);
  font-size: 0.9rem;
  font-weight: 600;
}

.download-file-table td {
  color: var(--batch-text);
  font-size: 0.95rem;
}

.download-file-table tbody tr {
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease;
}

.download-file-table tbody tr:hover {
  background: #f0f8f3;
}

.download-file-table tbody tr:focus-visible {
  outline: 2px solid var(--batch-primary);
  outline-offset: -2px;
}

.download-file-table tbody tr.is-selected,
.download-file-table tbody tr.is-selected:hover {
  color: var(--green-dark);
  background: #e2f2e8;
}

.download-file-table tbody tr.is-selected td {
  color: var(--green-dark);
  border-bottom-color: #c9dfd1;
}

.download-file-table tr:last-child td {
  border-bottom: 0;
}

.download-table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 24px;
  border-top: 1px solid var(--line);
}

.pagination,
.download-footer-actions,
.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-button {
  min-width: 36px;
  height: 36px;
  padding: 0 11px;
  color: var(--batch-primary-dark);
  background: var(--batch-surface);
  border: 1px solid var(--batch-border);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.pagination-button:hover:not(:disabled):not(.is-active) {
  background: var(--batch-green-50);
  border-color: var(--batch-green-200);
}

.pagination-button.is-active {
  color: var(--batch-surface);
  background: var(--batch-primary);
  border-color: var(--batch-primary);
}

.pagination-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.selected-count {
  color: var(--batch-text-secondary);
  font-size: 0.95rem;
  white-space: nowrap;
}

.text-button,
.primary-button {
  min-height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 600;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    border-color 0.16s ease;
}

.text-button {
  color: var(--batch-primary-dark);
  background: transparent;
}

.text-button:hover {
  background: var(--batch-green-50);
}

.primary-button {
  color: var(--batch-surface);
  background: var(--batch-primary);
  border-color: var(--batch-primary);
}

.primary-button:hover:not(:disabled) {
  background: var(--batch-primary-dark);
  border-color: var(--batch-primary-dark);
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.download-submit-button {
  min-width: 112px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(20 35 28 / 34%);
}

.confirm-modal {
  width: min(680px, 100%);
  max-height: 70vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--batch-surface);
  border-radius: 8px;
  border: 1px solid var(--batch-border);
  box-shadow: 0 18px 48px rgb(31 64 49 / 18%);
  overflow: hidden;
}

.modal-header {
  padding: 24px 24px 16px;
  border-bottom: 1px solid var(--batch-border);
}

.modal-header h2 {
  margin: 0;
  color: var(--batch-text);
  font-size: 1.12rem;
  font-weight: 600;
}

.modal-header p {
  margin: 10px 0 0;
  color: var(--batch-text-secondary);
}

.selected-summary-wrap {
  min-height: 0;
  overflow-y: auto;
}

.selected-summary-table {
  width: 100%;
  min-width: 540px;
  border-collapse: collapse;
}

.selected-summary-table th,
.selected-summary-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--batch-border);
}

.selected-summary-table th {
  position: sticky;
  top: 0;
  color: var(--batch-primary-dark);
  background: var(--batch-green-50);
  font-size: 0.88rem;
  font-weight: 600;
}

.selected-summary-table td {
  color: var(--batch-text);
  font-size: 0.92rem;
}

.selected-summary-table tr:last-child td {
  border-bottom: 0;
}

.modal-actions {
  justify-content: flex-end;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--batch-border);
}

.download-toast {
  position: fixed;
  top: 82px;
  right: 24px;
  z-index: 40;
  width: min(340px, calc(100vw - 48px));
  padding: 14px 16px;
  display: grid;
  gap: 5px;
  background: var(--batch-surface);
  border: 1px solid var(--batch-border);
  border-left: 5px solid var(--batch-primary);
  border-radius: 8px;
  box-shadow: var(--batch-shadow);
}

.download-toast strong {
  color: var(--batch-text);
  font-size: 0.98rem;
}

.download-toast span {
  color: var(--batch-text-secondary);
  font-size: 0.9rem;
}

.download-toast.is-error {
  border-left-color: #c93636;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 760px) {
  .download-table-footer {
    align-items: stretch;
    flex-direction: column;
    padding: 15px 14px;
  }

  .pagination {
    flex-wrap: wrap;
  }

  .download-footer-actions {
    justify-content: space-between;
  }
}

@media (max-width: 560px) {
  .download-footer-actions,
  .modal-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .text-button,
  .primary-button {
    width: 100%;
  }
}
</style>
