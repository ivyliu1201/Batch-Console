<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useModalDialog } from '../lib/modal-dialog.js'
import { completeUpload, openBatchCount } from '../services/batches.js'
import { currentUser } from '../services/session.js'
import {
  filePreviewModes,
  formatFileSize,
  formatRequestFileName,
  getTaipeiDateTimeParts,
  readTextPreview,
  selectPreviewLines,
  takeNextDailySequence,
} from '../lib/file-preview.js'

const uploadJobs = [
  {
    jobCode: 'JOB01',
    fileTypeCode: 'DT01',
    jobName: '範例資料匯入',
  },
  {
    jobCode: 'JOB02',
    fileTypeCode: 'DT02',
    jobName: '測試資料同步',
  },
  {
    jobCode: 'JOB03',
    fileTypeCode: 'DT03',
    jobName: '報表資料彙整',
  },
  {
    jobCode: 'JOB04',
    fileTypeCode: 'DT04',
    jobName: '通知資料更新',
  },
  {
    jobCode: 'JOB05',
    fileTypeCode: 'DT05',
    jobName: '排程資料處理',
  },
  {
    jobCode: 'JOB06',
    fileTypeCode: 'DT06',
    jobName: '回應資料匯入',
  },
  {
    jobCode: 'JOB07',
    fileTypeCode: 'DT07',
    jobName: '對照資料整理',
  },
  {
    jobCode: 'JOB08',
    fileTypeCode: 'DT08',
    jobName: '跨系統資料交換',
  },
  {
    jobCode: 'JOB09',
    fileTypeCode: 'DT09',
    jobName: '歷史資料歸檔',
  },
  {
    jobCode: 'JOB10',
    fileTypeCode: 'DT10',
    jobName: '狀態資料更新',
  },
]

const currentMode = ref('list')
const selectedJob = ref(null)
const selectedFile = ref(null)
const showConfirmModal = ref(false)
const uploadResult = ref(null)
const previewMode = ref('all')
const isUploading = ref(false)
const notification = ref(null)
const fileInput = ref(null)
const notificationTimer = ref(null)
const confirmDialog = ref(null)
const resultDialog = ref(null)
const jobTable = ref(null)
useModalDialog(confirmDialog)
useModalDialog(resultDialog)

const setLayoutBreadcrumbs = inject('setLayoutBreadcrumbs', null)

const batchDate = computed(() => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
})

const canUpload = computed(() => Boolean(selectedFile.value))

const previewLines = computed(() =>
  uploadResult.value?.previewAvailable
    ? selectPreviewLines(uploadResult.value.lines, previewMode.value)
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
  uploadResult.value = null
  previewMode.value = 'all'
  currentMode.value = 'create'
}

const backToList = async () => {
  const jobCode = selectedJob.value?.jobCode
  const completedResult = uploadResult.value
  currentMode.value = 'list'
  selectedJob.value = null
  selectedFile.value = null
  showConfirmModal.value = false
  uploadResult.value = null
  previewMode.value = 'all'
  if (fileInput.value) fileInput.value.value = ''
  if (completedResult) {
    showNotification('success', '上傳成功', `已完成 ${completedResult.sourceFileName} 的上傳。`)
  }
  await nextTick()
  jobTable.value?.querySelector(`[data-job-code="${jobCode}"]`)?.focus({ preventScroll: true })
}

const triggerFileSelection = () => {
  fileInput.value?.click()
}

const handleFileChange = (event) => {
  const [file] = event.target.files
  selectedFile.value = file ?? null
}

const openConfirmModal = () => {
  if (!canUpload.value) return
  showConfirmModal.value = true
}

const closeConfirmModal = () => {
  if (isUploading.value) return
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

const confirmUpload = async () => {
  if (!selectedJob.value || !selectedFile.value || isUploading.value) return

  const job = selectedJob.value
  const file = selectedFile.value
  const actor = currentUser.value
  const shouldFail = file.name.toLowerCase().includes('fail')

  if (shouldFail) {
    showConfirmModal.value = false
    showNotification('error', '上傳失敗', '檔案上傳失敗，請稍後重新嘗試。')
    return
  }

  isUploading.value = true

  const preview = await readTextPreview(file)

  try {
    const { dateKey, timestamp } = getTaipeiDateTimeParts()
    const serial = takeNextDailySequence(window.localStorage, dateKey)

    if (serial === null) {
      showConfirmModal.value = false
      showNotification('error', '上傳失敗', '當日流水號已用盡，無法建立新的請求檔。')
      return
    }

    const requestFileName = formatRequestFileName(job.fileTypeCode, timestamp, serial)
    const batch = await completeUpload(job, file.name, requestFileName, actor)
    uploadResult.value = {
      batchId: batch.id,
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
    showNotification('error', '上傳失敗', '無法完成批次資料保存，請確認瀏覽器儲存狀態。')
  } finally {
    isUploading.value = false
  }
}

watch(
  currentMode,
  (mode) => {
    setLayoutBreadcrumbs?.(
      mode === 'create'
        ? ['作業處理', '上傳', '建立上傳作業']
        : ['作業處理', '上傳'],
    )
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  setLayoutBreadcrumbs?.(null)
  clearNotification()
})
</script>

<template>
  <section class="view upload-view">
    <Transition name="toast">
      <div
        v-if="notification"
        class="upload-toast"
        :class="`is-${notification.type}`"
        role="status"
      >
        <strong>{{ notification.title }}</strong>
        <span>{{ notification.message }}</span>
      </div>
    </Transition>

    <section v-if="currentMode === 'list'" class="upload-section">
      <div class="page-heading upload-page-heading">
        <div>
          <h1>選擇上傳作業</h1>
          <p>請選擇欲建立的上傳作業。</p>
        </div>
      </div>

      <section class="panel upload-list-panel" aria-label="Upload job list">
        <div class="upload-table-wrap">
        <table ref="jobTable" class="upload-job-table">
          <thead>
            <tr>
              <th>作業代碼</th>
              <th>檔案型態代碼</th>
              <th>作業名稱</th>
              <th>未結批數</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in uploadJobs" :key="job.jobCode">
              <td>{{ job.jobCode }}</td>
              <td>{{ job.fileTypeCode }}</td>
              <td>{{ job.jobName }}</td>
              <td>
                <span
                  class="batch-badge"
                  :class="openBatchCount(job.jobCode) > 0 ? 'is-open' : 'is-zero'"
                >
                  {{ openBatchCount(job.jobCode) }}
                </span>
              </td>
              <td>
                <button class="outline-button" type="button" :data-job-code="job.jobCode" @click="openJob(job)">
                  開啟
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>
    </section>

    <section v-else class="upload-section">
      <div class="page-heading upload-page-heading upload-page-heading-row">
        <div>
          <h1>建立上傳作業</h1>
        </div>
        <button class="text-button" type="button" @click="backToList">返回</button>
      </div>

      <div class="upload-create-grid">
        <article class="upload-card job-info-card">
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

        <article class="upload-card file-select-card">
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
              <p class="file-state-title">選擇欲上傳的檔案</p>
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

      <div class="upload-actions">
        <button
          class="primary-button upload-submit-button"
          type="button"
          :disabled="!canUpload"
          @click="openConfirmModal"
        >
          上傳
        </button>
      </div>
    </section>

    <dialog v-if="showConfirmModal" ref="confirmDialog" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1" @cancel.prevent="closeConfirmModal">
      <section class="confirm-modal">
        <h2 id="confirm-title">確認上傳</h2>
        <p class="confirm-description">請確認以下上傳資訊。</p>
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
          <button class="text-button" type="button" :disabled="isUploading" @click="closeConfirmModal">取消</button>
          <button class="primary-button" type="button" :disabled="isUploading" @click="confirmUpload">
            {{ isUploading ? '處理中...' : '確認上傳' }}
          </button>
        </div>
      </section>
    </dialog>

    <dialog v-if="uploadResult" ref="resultDialog" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="upload-result-title" tabindex="-1" @cancel.prevent="backToList">
      <section
        class="upload-result-modal"
      >
        <div class="result-heading">
          <div>
            <h2 id="upload-result-title">上傳成功</h2>
            <p>請求檔已建立，可在下方檢視檔案內容。</p>
          </div>
          <span class="result-status">完成</span>
        </div>

        <dl class="result-info-list">
          <div>
            <dt>作業名稱</dt>
            <dd>{{ uploadResult.jobName }}</dd>
          </div>
          <div>
            <dt>原始檔名</dt>
            <dd>{{ uploadResult.sourceFileName }}</dd>
          </div>
          <div class="request-file-info">
            <dt>請求檔名</dt>
            <dd>{{ uploadResult.requestFileName }}</dd>
          </div>
        </dl>

        <section class="file-preview-panel" aria-labelledby="file-preview-title">
          <div class="preview-toolbar">
            <div>
              <h3 id="file-preview-title">檔案內容</h3>
              <span v-if="uploadResult.previewAvailable">共 {{ uploadResult.lines.length }} 行</span>
            </div>
            <div
              class="preview-mode-group"
              role="group"
              aria-label="檔案檢視範圍"
            >
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

          <div v-if="!uploadResult.previewAvailable" class="preview-empty-state">
            此檔案無法以文字方式預覽。
          </div>
          <div v-else-if="uploadResult.lines.length === 0" class="preview-empty-state">
            檔案沒有內容。
          </div>
          <pre v-else class="file-preview-text"><code>{{ previewText }}</code></pre>
        </section>

        <div class="modal-actions">
          <button class="primary-button" type="button" @click="backToList">完成</button>
        </div>
      </section>
    </dialog>
  </section>
</template>

<style scoped>
.upload-view {
  position: relative;
}

.upload-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
}

.upload-page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 0;
}

.upload-page-heading-row {
  align-items: center;
}

.upload-page-heading h1 {
  margin: 0;
  color: var(--ink);
  font-weight: 600;
}

.upload-page-heading p {
  color: var(--muted);
}

.upload-table-wrap {
  overflow-x: auto;
}

.upload-job-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  background: #fff;
}

.upload-job-table th,
.upload-job-table td {
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid var(--line);
}

.upload-job-table th {
  color: var(--green-dark);
  background: var(--green-soft);
  font-size: 0.9rem;
  font-weight: 600;
}

.upload-job-table td {
  color: var(--ink);
  font-size: 0.95rem;
}

.upload-job-table tr:last-child td {
  border-bottom: 0;
}

.batch-badge {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 600;
}

.batch-badge.is-zero {
  color: var(--green-dark);
  background: var(--green-soft);
  border: 1px solid #cbded2;
}

.batch-badge.is-open {
  color: #9a5a12;
  background: #fff4df;
  border: 1px solid #f4d6a4;
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
  color: var(--green);
  background: #fff;
  border-color: var(--green);
}

.outline-button:hover {
  color: #fff;
  background: var(--green);
}

.text-button {
  color: var(--green-dark);
  background: transparent;
}

.text-button:hover {
  background: var(--green-soft);
}

.primary-button {
  color: #fff;
  background: var(--green);
  border-color: var(--green);
}

.primary-button:hover:not(:disabled) {
  background: var(--green-dark);
  border-color: var(--green-dark);
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.upload-create-grid {
  display: grid;
  grid-template-columns: minmax(280px, 330px) minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;
}

.upload-card {
  min-height: 260px;
  padding: 22px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.upload-card h2,
.confirm-modal h2,
.upload-result-modal h2 {
  margin: 0;
  color: var(--ink);
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
  color: var(--muted);
  font-size: 0.9rem;
}

.job-info-list dd,
.confirm-info-list dd {
  margin: 0;
  color: var(--ink);
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
  background: var(--green-soft);
  border: 1px dashed #cbded2;
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
  color: var(--green);
  background: #fff;
  border: 1px solid #cbded2;
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
  color: var(--ink);
  font-size: 1rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.file-state-hint {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.selected-file-detail {
  min-width: 0;
  flex: 1;
}

.upload-actions {
  display: flex;
  justify-content: flex-end;
}

.upload-submit-button {
  min-width: 112px;
}

.modal-backdrop {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: 0;
  box-shadow: none;
  margin: 0;
  border: 0;
  color: inherit;
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(20 35 28 / 34%);
}

.modal-backdrop::backdrop { background: transparent; backdrop-filter: none; }

.confirm-modal {
  width: min(460px, 100%);
  padding: 24px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid var(--line);
  box-shadow: 0 18px 48px rgb(31 64 49 / 18%);
}

.upload-result-modal {
  width: min(760px, 100%);
  height: min(700px, calc(100dvh - 48px));
  max-height: calc(100dvh - 48px);
  padding: 24px;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
  background: #fff;
  border-radius: 8px;
  border: 1px solid var(--line);
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
  color: var(--muted);
  font-size: 0.9rem;
}

.result-status {
  flex: 0 0 auto;
  padding: 6px 10px;
  color: var(--green-dark);
  background: var(--green-soft);
  border: 1px solid #cbded2;
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
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.result-info-list div {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.result-info-list dt {
  color: var(--muted);
  font-size: 0.78rem;
}

.result-info-list dd {
  margin: 0;
  color: var(--ink);
  font-size: 0.92rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.result-info-list .request-file-info {
  grid-column: 1 / -1;
}

.request-file-info dd {
  color: var(--green-dark);
  font-family: Consolas, monospace;
}

.file-preview-panel {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid var(--line);
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
  border-bottom: 1px solid var(--line);
}

.preview-toolbar h3 {
  margin: 0;
  color: var(--ink);
  font-size: 0.95rem;
}

.preview-toolbar span {
  display: block;
  margin-top: 3px;
  color: var(--muted);
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
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 5px;
  font-size: 0.78rem;
  white-space: nowrap;
  cursor: pointer;
}

.preview-mode-group button[aria-pressed='true'] {
  color: var(--green-dark);
  background: #fff;
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
  background: #fff;
}

.file-preview-text code {
  color: var(--ink);
  font-family: Consolas, 'Courier New', monospace;
  font-size: 0.82rem;
  line-height: 1.65;
  white-space: pre;
}

.preview-empty-state {
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 0.9rem;
  text-align: center;
}

.confirm-description {
  margin: 10px 0 0;
  color: var(--muted);
}

.modal-actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.upload-toast {
  position: fixed;
  top: 82px;
  right: 24px;
  z-index: 40;
  width: min(340px, calc(100vw - 48px));
  padding: 14px 16px;
  display: grid;
  gap: 5px;
  background: #fff;
  border: 1px solid var(--line);
  border-left: 5px solid var(--green);
  border-radius: 8px;
  box-shadow: 0 14px 35px #1f403126;
}

.upload-toast strong {
  color: var(--ink);
  font-size: 0.98rem;
}

.upload-toast span {
  color: var(--muted);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.upload-toast.is-error {
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
  .upload-create-grid {
    grid-template-columns: 1fr;
  }

  .upload-card {
    min-height: auto;
  }
}

@media (max-width: 620px) {
  .upload-page-heading,
  .file-empty-state,
  .selected-file-state {
    align-items: stretch;
    flex-direction: column;
  }

  .upload-page-heading-row {
    align-items: flex-start;
  }

  .upload-actions,
  .modal-actions {
    justify-content: stretch;
  }

  .outline-button,
  .text-button,
  .primary-button {
    width: 100%;
  }

  .upload-result-modal {
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
