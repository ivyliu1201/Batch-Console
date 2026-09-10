export function selectDate(start, end, mode, key, today) {
  if (key > today) return { start, end };
  if (mode === 'single') return { start: key, end: key };
  if (!start || end) return { start: key, end: '' };
  if (key < start) return { start: key, end: start };
  return { start, end: key };
}
