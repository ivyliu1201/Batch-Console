// Minimal transaction double for service tests. Real IndexedDB is covered by Playwright R01.
export function memoryIndexedDB() {
  const state = { snapshot: undefined, failNextWrite: false, abortNextWrite: false };
  const database = {
    createObjectStore() {},
    transaction() {
      const transaction = {
        objectStore() {
          return {
            get() {
              const request = { result: structuredClone(state.snapshot) };
              queueMicrotask(() => transaction.oncomplete?.());
              return request;
            },
            put(value) {
              if (state.failNextWrite) {
                state.failNextWrite = false;
                throw new DOMException('Test storage quota exceeded', 'QuotaExceededError');
              }
              const snapshot = structuredClone(value);
              const abort = state.abortNextWrite;
              state.abortNextWrite = false;
              queueMicrotask(() => {
                if (abort) {
                  transaction.error = new DOMException('Test transaction aborted', 'AbortError');
                  transaction.onabort?.();
                } else {
                  state.snapshot = snapshot;
                  transaction.oncomplete?.();
                }
              });
            },
          };
        },
      };
      return transaction;
    },
  };
  return {
    state,
    indexedDB: {
      open() {
        const request = { result: database };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  };
}
