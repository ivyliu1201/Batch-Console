import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const operationViews = [
  ['upload', 'src/views/UploadView.vue', 'upload-list-panel'],
  ['download', 'src/views/DownloadView.vue', 'download-list-panel'],
  ['transfer', 'src/views/TransferView.vue', 'transfer-list-panel'],
]

test('operation pages use the shared view and panel card backgrounds', () => {
  for (const [name, file, panelClass] of operationViews) {
    const source = readFileSync(file, 'utf8')

    assert.match(source, /<section class="view [^"]+-view">/, `${name} root uses .view`)
    assert.match(
      source,
      new RegExp(`<section class="panel ${panelClass}"`),
      `${name} list uses .panel`,
    )
  }
})

test('operation page titles share the common heading size', () => {
  for (const [name, file] of operationViews) {
    const source = readFileSync(file, 'utf8')

    assert.doesNotMatch(source, /font-size:\s*1\.55rem/, `${name} does not override h1 size`)
  }
})

test('download selected row uses a lighter system green', () => {
  const source = readFileSync('src/views/DownloadView.vue', 'utf8')

  assert.match(source, /background:\s*#e2f2e8/)
  assert.match(source, /color:\s*var\(--green-dark\)/)
  assert.doesNotMatch(source, /background:\s*#168454/)
})

test('upload table header uses the same green family as download', () => {
  const source = readFileSync('src/views/UploadView.vue', 'utf8')

  assert.match(source, /upload-job-table th \{[\s\S]*color:\s*var\(--green-dark\)/)
  assert.match(source, /upload-job-table th \{[\s\S]*background:\s*var\(--green-soft\)/)
  assert.doesNotMatch(source, /upload-job-table th \{[\s\S]*background:\s*#f8f9f8/)
})

test('upload accepts any source extension and exposes DAT preview modes', () => {
  const source = readFileSync('src/views/UploadView.vue', 'utf8')

  assert.doesNotMatch(source, /:accept=/)
  assert.doesNotMatch(source, /acceptedExtensions|validateSelectedFile|支援格式/)
  assert.match(source, /上傳成功/)
  assert.match(source, /filePreviewModes/)
  assert.match(source, /檔案檢視範圍/)
})

test('transfer accepts any source extension and exposes DAT preview modes', () => {
  const source = readFileSync('src/views/TransferView.vue', 'utf8')

  assert.doesNotMatch(source, /:accept=/)
  assert.doesNotMatch(source, /acceptedExtensions|validateSelectedFile|支援格式/)
  assert.match(source, /轉送成功/)
  assert.match(source, /filePreviewModes/)
  assert.match(source, /檔案檢視範圍/)
  assert.match(source, /formatRequestFileName/)
})
