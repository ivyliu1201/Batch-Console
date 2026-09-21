// Integration point for the host's review page. The host handles navigation.
export function openReview(batchId) {
  return window.dispatchEvent(new CustomEvent('batch-console:open-review', {
    detail: { batchId }, cancelable: true,
  }));
}
