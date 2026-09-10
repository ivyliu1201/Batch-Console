import test from 'node:test'
import assert from 'node:assert/strict'
import * as filePreview from '../src/lib/file-preview.js'

const {
  DAT_SEQUENCE_STORAGE_KEY,
  formatRequestFileName,
  getTaipeiDateTimeParts,
  isTextPreviewable,
  selectPreviewLines,
  splitFileLines,
  takeNextDailySequence,
} = filePreview

function createStorage(initialValue = null) {
  let value = initialValue
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue
    },
    value: () => value,
  }
}

test('upload request file uses file type, Taipei timestamp, and a three-digit serial', () => {
  const { dateKey, timestamp } = getTaipeiDateTimeParts(
    new Date('2026-09-08T06:30:25.000Z'),
  )

  assert.equal(dateKey, '20260908')
  assert.equal(timestamp, '20260908143025')
  assert.equal(
    formatRequestFileName('DT01', timestamp, 1),
    'DT0120260908143025001.DAT',
  )
})

test('daily sequence is shared, persisted, and resets on the next Taipei date', () => {
  const storage = createStorage()

  assert.equal(takeNextDailySequence(storage, '20260908'), 1)
  assert.equal(takeNextDailySequence(storage, '20260908'), 2)
  assert.deepEqual(JSON.parse(storage.value()), {
    dateKey: '20260908',
    lastSerial: 2,
  })
  assert.equal(takeNextDailySequence(storage, '20260909'), 1)
  assert.equal(DAT_SEQUENCE_STORAGE_KEY, 'batch-console-upload-sequence')
})

test('file size formatting is shared by upload pages', () => {
  assert.equal(typeof filePreview.formatFileSize, 'function')
  assert.equal(filePreview.formatFileSize(0), '1 KB')
  assert.equal(filePreview.formatFileSize(1024), '1 KB')
  assert.equal(filePreview.formatFileSize(1536), '2 KB')
  assert.equal(filePreview.formatFileSize(1024 * 1024), '1.0 MB')
})

test('text preview reading returns normalized preview data without changing failure behavior', async () => {
  assert.equal(typeof filePreview.readTextPreview, 'function')
  assert.deepEqual(await filePreview.readTextPreview({ text: async () => 'first\r\nsecond\n' }), {
    previewAvailable: true,
    lines: ['first', 'second'],
  })
  assert.deepEqual(await filePreview.readTextPreview({ text: async () => { throw new Error('read failed') } }), {
    previewAvailable: false,
    lines: [],
  })
})

test('daily sequence stops after 999', () => {
  const storage = createStorage(
    JSON.stringify({ dateKey: '20260908', lastSerial: 999 }),
  )

  assert.equal(takeNextDailySequence(storage, '20260908'), null)
  assert.equal(JSON.parse(storage.value()).lastSerial, 999)
})

test('file preview returns all, first ten, and last ten normalized lines', () => {
  const lines = splitFileLines(
    Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\r\n'),
  )

  assert.equal(lines.length, 12)
  assert.deepEqual(selectPreviewLines(lines, 'all'), lines)
  assert.deepEqual(selectPreviewLines(lines, 'first10'), lines.slice(0, 10))
  assert.deepEqual(selectPreviewLines(lines, 'last10'), lines.slice(2))
  assert.deepEqual(selectPreviewLines(['one', 'two'], 'last10'), ['one', 'two'])
  assert.deepEqual(splitFileLines('one\ntwo\n'), ['one', 'two'])
})

test('binary-like content is not presented as a text preview', () => {
  assert.equal(isTextPreviewable('第一行\n第二行'), true)
  assert.equal(isTextPreviewable('binary\0content'), false)
  assert.equal(isTextPreviewable('invalid \uFFFD content'), false)
})
