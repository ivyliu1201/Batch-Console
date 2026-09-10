export const DAT_SEQUENCE_STORAGE_KEY = 'batch-console-upload-sequence'

export const filePreviewModes = [
  { value: 'all', label: '全部' },
  { value: 'first10', label: '前 10 行' },
  { value: 'last10', label: '後 10 行' },
]

const taipeiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function getTaipeiDateTimeParts(date = new Date()) {
  const parts = Object.fromEntries(
    taipeiDateTimeFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  const dateKey = `${parts.year}${parts.month}${parts.day}`

  return {
    dateKey,
    timestamp: `${dateKey}${parts.hour}${parts.minute}${parts.second}`,
  }
}

export function formatRequestFileName(fileTypeCode, timestamp, serial) {
  if (!fileTypeCode || !/^\d{14}$/.test(timestamp)) {
    throw new TypeError('A file type code and yyyyMMddHHmmss timestamp are required.')
  }
  if (!Number.isInteger(serial) || serial < 1 || serial > 999) {
    throw new RangeError('The daily serial number must be between 1 and 999.')
  }

  return `${fileTypeCode}${timestamp}${String(serial).padStart(3, '0')}.DAT`
}

export function formatFileSize(sizeInBytes) {
  const sizeInKb = sizeInBytes / 1024
  if (sizeInKb < 1024) return `${Math.max(1, Math.round(sizeInKb))} KB`

  return `${(sizeInKb / 1024).toFixed(1)} MB`
}

export async function readTextPreview(file) {
  try {
    const content = await file.text()
    const previewAvailable = isTextPreviewable(content)
    return {
      previewAvailable,
      lines: previewAvailable ? splitFileLines(content) : [],
    }
  } catch {
    return { previewAvailable: false, lines: [] }
  }
}

export function takeNextDailySequence(storage, dateKey) {
  let savedState = null

  try {
    savedState = JSON.parse(storage.getItem(DAT_SEQUENCE_STORAGE_KEY))
  } catch {
    savedState = null
  }

  const savedSerial = Number(savedState?.lastSerial)
  const lastSerial =
    savedState?.dateKey === dateKey && Number.isInteger(savedSerial) && savedSerial >= 0
      ? savedSerial
      : 0

  if (lastSerial >= 999) return null

  const nextSerial = lastSerial + 1
  storage.setItem(
    DAT_SEQUENCE_STORAGE_KEY,
    JSON.stringify({ dateKey, lastSerial: nextSerial }),
  )
  return nextSerial
}

export function splitFileLines(content) {
  if (!content) return []
  const normalizedContent = content.replace(/\r\n?/g, '\n')
  const lines = normalizedContent.split('\n')
  if (normalizedContent.endsWith('\n')) lines.pop()
  return lines
}

export function selectPreviewLines(lines, mode) {
  if (mode === 'first10') return lines.slice(0, 10)
  if (mode === 'last10') return lines.slice(-10)
  return lines
}

export function isTextPreviewable(content) {
  const sample = content.slice(0, 4096)
  if (!sample) return true
  if (sample.includes('\0') || sample.includes('\uFFFD')) return false

  let controlCharacterCount = 0
  for (const character of sample) {
    const code = character.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlCharacterCount += 1
    }
  }

  return controlCharacterCount / sample.length < 0.02
}
