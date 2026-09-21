import { onBeforeUnmount, watch } from 'vue';

// Share focus behavior only; each view retains its own submit/cancel/result state.
export function useModalDialog(dialogRef) {
  let opener;
  function keepFocus(event) {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !controls.includes(document.activeElement) ||
      (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }
  watch(dialogRef, (dialog, previous) => {
    previous?.removeEventListener('keydown', keepFocus);
    if (dialog) {
      opener = document.activeElement;
      dialog.showModal();
      dialog.addEventListener('keydown', keepFocus);
    } else if (opener?.isConnected) {
      opener.focus({ preventScroll: true });
    }
  }, { flush: 'post' });
  onBeforeUnmount(() => dialogRef.value?.removeEventListener('keydown', keepFocus));
}
