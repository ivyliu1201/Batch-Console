import { shallowRef, readonly } from 'vue';
import { createAudit } from '../lib/core.js';
import { initialRecords } from '../data/demo.js';
import { taipeiNow } from '../lib/format.js';

// Record completed batch operations and successful uploads, downloads and transfers.
// Browsing, filtering and cancelled confirmations do not belong here. Demo history is in memory only.
export const audit = createAudit(initialRecords, taipeiNow);
const entries = shallowRef(audit.list());
audit.subscribe(() => { entries.value = audit.list(); });
export const auditEntries = readonly(entries);
