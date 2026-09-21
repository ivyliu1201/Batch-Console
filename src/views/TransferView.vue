<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { audit } from '../services/audit.js'
import { currentUser } from '../services/session.js'
import { savePendingChanges } from '../services/persistence.js'
import {
  filePreviewModes,
  formatFileSize,
  formatRequestFileName,
  getTaipeiDateTimeParts,
  readTextPreview,
  selectPreviewLines,
  takeNextDailySequence,
} from '../lib/file-preview.js'

const transferJobs = [
  {
    jobCode: 'EX01',
    fileTypeCode: 'EXD1',
    jobName: '來源資料交換',
  },
  {
    jobCode: 'EX02',
    fileTypeCode: 'EXD2',
    jobName: '結果資料交換',
  },
  {
    jobCode: 'EX03',
    fileTypeCode: 'EXD3',
    jobName: '排程資料交換',
  },
  {
    jobCode: 'EX04',
    fileTypeCode: 'EXD4',
    jobName: '彙整資料交換',
  },
  {
    jobCode: 'EX05',
    fileTypeCode: 'EXD5',
    jobName: '通知資料交換',
  },
  {
    jobCode: 'EX06',
    fileTypeCode: 'EXD6',
    jobName: '歸檔資料交換',
  },
]

const currentMode = ref('list')
const selectedJob = ref(null)
const selectedFile = ref(null)
const showConfirmModal = ref(false)
const transferResult = ref(null)
const previewMode = ref('all')
const isTransferring = ref(false)
const notification = ref(null)
const fileInput = ref(null)
const notificationTimer = ref(null)

const setLayoutBreadcrumbs = inject('setLayoutBreadcrumbs', null)

const batchDate = computed(() => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
})

const canTransfer = computed(() => Boolean(selectedFile.value))

const previewLines = computed(() =>
  transferResult.value?.previewAvailable
    ? selectPreviewLines(transferResult.value.lines, previewMode.value)
    : [],
)

const previewText = computed(() => previewLines.value.join('\n'))

const fileSizeText = computed(() => {
  if (!selectedFile.value) return ''
  return formatFileSize(selectedFile.value.size)
})

const openJob = (job) => {
  selectedJob.value = job
  selectedFile.value = null
  showConfirmModal.value = false
  transferResult.value = null
  previewMode.value = 'all'
  currentMode.value = 'create'
}

const backToList = () => {
  const completedResult = transferResult.value
  currentMode.value = 'list'
  selectedJob.value = null
  selectedFile.value = null
  showConfirmModal.value = false
  transferResult.value = null
  previewMode.value = 'all'
  if (fileInput.value) fileInput.value.value = ''
  if (completedResult) {
    showNotification('success', '轉送成功', `已完成 ${completedResult.sourceFileName} 的轉送。`)
  }
}

const triggerFileSelection = () => {
  fileInput.value?.click()
}

const handleFileChange = (event) => {
  const [file] = event.target.files
  selectedFile.value = file ?? null
}

const openConfirmModal = () => {
  if (!canTransfer.value) return
  showConfirmModal.value = true
}

const closeConfirmModal = () => {
  showConfirmModal.value = false
}

const clearNotification = () => {
  if (notificationTimer.value) window.clearTimeout(notificationTimer.value)
  notification.value = null
  notificationTimer.value = null
}

const showNotification = (type, title, message) => {
  clearNotification()

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

const confirmTransfer = async () => {
  if (!selectedJob.value || !selectedFile.value || isTransferring.value) return

  const job = selectedJob.value
  const file = selectedFile.value
  const actor = currentUser.value
  const shouldFail = file.name.toLowerCase().includes('fail')

  if (shouldFail) {
    showConfirmModal.value = false
    showNotification('error', '轉送失敗', '檔案轉送失敗，請稍後重新嘗試。')
    return
  }

  isTransferring.value = true

  const preview = await readTextPreview(file)

  try {
    const { dateKey, timestamp } = getTaipeiDateTimeParts()
    const serial = takeNextDailySequence(window.localStorage, dateKey)

    if (serial === null) {
      showConfirmModal.value = false
      showNotification('error', '轉送失敗', '當日流水號已用盡，無法建立新的請求檔。')
      return
    }

    const requestFileName = formatRequestFileName(job.fileTypeCode, timestamp, serial)
    audit.record('轉送', `轉送成功：${job.jobName}；來源檔案：${file.name}；請求檔案：${requestFileName}`, null, actor)
    await savePendingChanges()
    transferResult.value = {
      jobName: job.jobName,
      sourceFileName: file.name,
      requestFileName,
      ...preview,
    }
    previewMode.value = 'all'
    showConfirmModal.value = false
    clearNotification()
  } catch {
    showConfirmModal.value = false
    showNotification('error', '轉送失敗', '無法完成作業紀錄保存，請確認瀏覽器儲存狀態。')
  } finally {
    isTransferring.value = false
  }
}

const handleKeydown = (event) => {
  if (event.key === 'Escape' && showConfirmModal.value) {
    closeConfirmModal()
  }
}

watch(
  currentMode,
  (mode) => {
    setLayoutBreadcrumbs?.(
      mode === 'create'
        ? ['作業處理', '轉送', '建立轉送作業']
        : ['作業處理', '轉送'],
    )
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  setLayoutBreadcrumbs?.(null)
  window.removeEventListener('keydown', handleKeydown)
  clearNotification()
})
</script>

<template>
  <section class="view transfer-view">
    <Transition name="toast">
      <div
        v-if="notification"
        class="transfer-toast"
        :class="`is-${notification.type}`"
        role="status"
      >
        <strong>{{ notification.title }}</strong>
        <span>{{ notification.message }}</span>
      </div>
    </Transition>

    <section v-if="currentMode === 'list'" class="transfer-section">
      <div class="page-heading transfer-page-heading">
        <div>
          <h1>選擇轉送作業</h1>
          <p>請選擇欲建立的轉送作業。</p>
        </div>
      </div>

      <section class="panel transfer-list-panel" aria-label="Transfer job list">
        <div class="transfer-table-wrap">
        <table class="transfer-job-table">
          <thead>
            <tr>
              <th>作業代碼</th>
              <th>檔案型態代碼</th>
              <th>作業名稱</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in transferJobs" :key="job.jobCode">
              <td>{{ job.jobCode }}</td>
              <td>{{ job.fileTypeCode }}</td>
              <td>{{ job.jobName }}</td>
              <td>
                <button class="outline-button" type="button" @click="openJob(job)">
                  開啟
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>
    </section>

    <section v-else class="transfer-section">
      <div class="page-heading transfer-page-heading transfer-page-heading-row">
        <div>
          <h1>建立轉送作業</h1>
        </div>
        <button class="text-button" type="button" @click="backToList">返回</button>
      </div>

      <div class="transfer-create-grid">
        <article class="transfer-card job-info-card">
          <h2>作業資訊</h2>
          <dl class="job-info-list">
            <div>
              <dt>作業名稱</dt>
              <dd>{{ selectedJob.jobName }}</dd>
            </div>
            <div>
              <dt>批次日期</dt>
              <dd>{{ batchDate }}</dd>
            </div>
          </dl>
        </article>

        <article class="transfer-card file-select-card">
          <h2>選取檔案</h2>
          <input
            ref="fileInput"
            class="native-file-input"
            type="file"
            @change="handleFileChange"
          />

          <div v-if="!selectedFile" class="file-empty-state">
            <div class="file-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 4v11" />
                <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
                <path d="M5 16v3h14v-3" />
              </svg>
            </div>
            <div>
              <p class="file-state-title">選擇欲轉送的檔案</p>
            </div>
            <button class="primary-button" type="button" @click="triggerFileSelection">
              選擇檔案
            </button>
          </div>

          <div v-else class="selected-file-state">
            <div class="file-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V3.5Z" />
                <path d="M14 3.5v4h4" />
                <path d="M8.5 13h7" />
                <path d="M8.5 16.5h5" />
              </svg>
            </div>
            <div class="selected-file-detail">
              <p class="file-state-title">{{ selectedFile.name }}</p>
              <p class="file-state-hint">{{ fileSizeText }}</p>
            </div>
            <button class="outline-button" type="button" @click="triggerFileSelection">
              重新選擇
            </button>
          </div>
        </article>
      </div>

      <div class="transfer-actions">
        <button
          class="primary-button transfer-submit-button"
          type="button"
          :disabled="!canTransfer"
          @click="openConfirmModal"
        >
          轉送
        </button>
      </div>
    </section>

    <div v-if="showConfirmModal" class="modal-backdrop" role="presentation">
      <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">確認轉送</h2>
        <p class="confirm-description">請確認以下轉送資訊。</p>
        <dl class="confirm-info-list">
          <div>
            <dt>作業名稱</dt>
            <dd>{{ selectedJob.jobName }}</dd>
          </div>
          <div>
            <dt>檔案名稱</dt>
            <dd>{{ selectedFile.name }}</dd>
          </div>
        </dl>
        <div class="modal-actions">
          <button class="text-button" type="button" :disabled="isTransferring" @click="closeConfirmModal">取消</button>
          <button class="primary-button" type="button" :disabled="isTransferring" @click="confirmTransfer">
            {{ isTransferring ? '處理中...' : '確認轉送' }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="transferResult" class="modal-backdrop" role="presentation">
      <section
        class="transfer-result-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-result-title"
      >
        <div class="result-heading">
          <div>
            <h2 id="transfer-result-title">轉送成功</h2>
            <p>請求檔已建立，可在下方檢視檔案內容。</p>
          </div>
          <span class="result-status">完成</span>
        </div>

        <dl class="result-info-list">
          <div>
            <dt>作業名稱</dt>
            <dd>{{ transferResult.jobName }}</dd>
          </div>
          <div>
            <dt>原始檔名</dt>
            <dd>{{ transferResult.sourceFileName }}</dd>
          </div>
          <div class="request-file-info">
            <dt>請求檔名</dt>
            <dd>{{ transferResult.requestFileName }}</dd>
          </div>
        </dl>

        <section class="file-preview-panel" aria-labelledby="transfer-file-preview-title">
          <div class="preview-toolbar">
            <div>
              <h3 id="transfer-file-preview-title">檔案內容</h3>
              <span v-if="transferResult.previewAvailable">共 {{ transferResult.lines.length }} 行</span>
            </div>
            <div class="preview-mode-group" role="group" aria-label="檔案檢視範圍">
              <button
                v-for="mode in filePreviewModes"
                :key="mode.value"
                type="button"
                :aria-pressed="previewMode === mode.value"
                @click="previewMode = mode.value"
              >
                {{ mode.label }}
              </button>
            </div>
          </div>

          <div v-if="!transferResult.previewAvailable" class="preview-empty-state">
            此檔案無法以文字方式預覽。
          </div>
          <div v-else-if="transferResult.lines.length === 0" class="preview-empty-state">
            檔案沒有內容。
          </div>
          <pre v-else class="file-preview-text"><code>{{ previewText }}</code></pre>
        </section>

        <div class="modal-actions">
          <button class="primary-button" type="button" @click="backToList">完成</button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.transfer-view {
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

.transfer-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
}

.transfer-page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 0;
}

.transfer-page-heading-row {
  align-items: center;
}

.transfer-page-heading h1 {
  margin: 0;
  color: var(--batch-text);
  font-weight: 600;
  line-height: 1.35;
}

.transfer-page-heading p {
  margin: 6px 0 0;
  color: var(--batch-text-secondary);
  font-size: 0.95rem;
}

.transfer-table-wrap {
  overflow-x: auto;
}

.transfer-job-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  background: var(--batch-surface);
}

.transfer-job-table th,
.transfer-job-table td {
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid var(--batch-border);
}

.transfer-job-table th {
  color: var(--batch-primary-dark);
  background: var(--batch-green-50);
  font-size: 0.9rem;
  font-weight: 600;
}

.transfer-job-table td {
  color: var(--batch-text);
  font-size: 0.95rem;
}

.transfer-job-table tr:last-child td {
  border-bottom: 0;
}

.outline-button,
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

.outline-button {
  color: var(--batch-primary);
  background: var(--batch-surface);
  border-color: var(--batch-primary);
}

.outline-button:hover {
  color: var(--batch-surface);
  background: var(--batch-primary);
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

.transfer-create-grid {
  display: grid;
  grid-template-columns: minmax(280px, 330px) minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;
}

.transfer-card {
  min-height: 260px;
  padding: 22px;
  background: var(--batch-surface);
  border: 1px solid var(--batch-border);
  border-radius: 8px;
}

.transfer-card h2,
.confirm-modal h2,
.transfer-result-modal h2 {
  margin: 0;
  color: var(--batch-text);
  font-size: 1.12rem;
  font-weight: 600;
}

.job-info-list,
.confirm-info-list {
  margin: 18px 0 0;
  display: grid;
  gap: 18px;
}

.job-info-list div,
.confirm-info-list div {
  display: grid;
  gap: 6px;
}

.job-info-list dt,
.confirm-info-list dt {
  color: var(--batch-text-secondary);
  font-size: 0.9rem;
}

.job-info-list dd,
.confirm-info-list dd {
  margin: 0;
  color: var(--batch-text);
  font-size: 1.03rem;
  font-weight: 600;
}

.file-select-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 18px;
}

.native-file-input {
  display: none;
}

.file-empty-state,
.selected-file-state {
  min-height: 150px;
  padding: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
  background: var(--batch-green-50);
  border: 1px dashed var(--batch-green-200);
  border-radius: 8px;
}

.selected-file-state {
  justify-content: flex-start;
  text-align: left;
  background: #fbfdfc;
  border-style: solid;
}

.file-state-icon {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  display: grid;
  place-items: center;
  color: var(--batch-primary);
  background: var(--batch-surface);
  border: 1px solid var(--batch-green-200);
  border-radius: 8px;
}

.file-state-icon svg {
  width: 28px;
  height: 28px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.file-state-title {
  margin: 0;
  color: var(--batch-text);
  font-size: 1rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.file-state-hint {
  margin: 6px 0 0;
  color: var(--batch-text-secondary);
  font-size: 0.9rem;
}

.selected-file-detail {
  min-width: 0;
  flex: 1;
}

.transfer-actions {
  display: flex;
  justify-content: flex-end;
}

.transfer-submit-button {
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
  width: min(460px, 100%);
  padding: 24px;
  background: var(--batch-surface);
  border-radius: 8px;
  border: 1px solid var(--batch-border);
  box-shadow: 0 18px 48px rgb(31 64 49 / 18%);
}

.transfer-result-modal {
  width: min(760px, 100%);
  height: min(700px, calc(100dvh - 48px));
  max-height: calc(100dvh - 48px);
  padding: 24px;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
  background: var(--batch-surface);
  border-radius: 8px;
  border: 1px solid var(--batch-border);
  box-shadow: 0 18px 48px rgb(31 64 49 / 18%);
}

.result-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.result-heading p {
  margin: 8px 0 0;
  color: var(--batch-text-secondary);
  font-size: 0.9rem;
}

.result-status {
  flex: 0 0 auto;
  padding: 6px 10px;
  color: var(--batch-primary-dark);
  background: var(--batch-green-50);
  border: 1px solid var(--batch-green-200);
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
}

.result-info-list {
  margin: 20px 0;
  padding: 16px 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  border-top: 1px solid var(--batch-border);
  border-bottom: 1px solid var(--batch-border);
}

.result-info-list div {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.result-info-list dt {
  color: var(--batch-text-secondary);
  font-size: 0.78rem;
}

.result-info-list dd {
  margin: 0;
  color: var(--batch-text);
  font-size: 0.92rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.result-info-list .request-file-info {
  grid-column: 1 / -1;
}

.request-file-info dd {
  color: var(--batch-primary-dark);
  font-family: Consolas, monospace;
}

.file-preview-panel {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid var(--batch-border);
  border-radius: 8px;
  overflow: hidden;
}

.preview-toolbar {
  min-height: 58px;
  padding: 10px 12px 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #f8faf8;
  border-bottom: 1px solid var(--batch-border);
}

.preview-toolbar h3 {
  margin: 0;
  color: var(--batch-text);
  font-size: 0.95rem;
}

.preview-toolbar span {
  display: block;
  margin-top: 3px;
  color: var(--batch-text-secondary);
  font-size: 0.75rem;
}

.preview-mode-group {
  flex: 0 0 auto;
  padding: 3px;
  display: flex;
  gap: 3px;
  background: #edf2ef;
  border-radius: 7px;
}

.preview-mode-group button {
  min-height: 32px;
  padding: 5px 10px;
  color: var(--batch-text-secondary);
  background: transparent;
  border: 0;
  border-radius: 5px;
  font-size: 0.78rem;
  white-space: nowrap;
  cursor: pointer;
}

.preview-mode-group button[aria-pressed='true'] {
  color: var(--batch-primary-dark);
  background: var(--batch-surface);
  box-shadow: 0 1px 3px rgb(31 64 49 / 12%);
  font-weight: 600;
}

.file-preview-text,
.preview-empty-state {
  min-height: 0;
  height: auto;
  margin: 0;
  padding: 16px;
  overflow: auto;
  background: var(--batch-surface);
}

.file-preview-text code {
  color: var(--batch-text);
  font-family: Consolas, 'Courier New', monospace;
  font-size: 0.82rem;
  line-height: 1.65;
  white-space: pre;
}

.preview-empty-state {
  display: grid;
  place-items: center;
  color: var(--batch-text-secondary);
  font-size: 0.9rem;
  text-align: center;
}

.confirm-description {
  margin: 10px 0 0;
  color: var(--batch-text-secondary);
}

.modal-actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.transfer-toast {
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

.transfer-toast strong {
  color: var(--batch-text);
  font-size: 0.98rem;
}

.transfer-toast span {
  color: var(--batch-text-secondary);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.transfer-toast.is-error {
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

@media (max-width: 900px) {
  .transfer-create-grid {
    grid-template-columns: 1fr;
  }

  .transfer-card {
    min-height: auto;
  }
}

@media (max-width: 620px) {
  .transfer-page-heading,
  .file-empty-state,
  .selected-file-state {
    align-items: stretch;
    flex-direction: column;
  }

  .transfer-page-heading-row {
    align-items: flex-start;
  }

  .transfer-actions,
  .modal-actions {
    justify-content: stretch;
  }

  .outline-button,
  .text-button,
  .primary-button {
    width: 100%;
  }

  .transfer-result-modal {
    height: calc(100dvh - 24px);
    max-height: calc(100dvh - 24px);
    padding: 18px 14px;
  }

  .result-info-list {
    grid-template-columns: 1fr;
  }

  .result-info-list .request-file-info {
    grid-column: auto;
  }

  .preview-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .preview-mode-group {
    width: 100%;
  }

  .preview-mode-group button {
    flex: 1;
    min-width: 0;
  }
}
</style>
