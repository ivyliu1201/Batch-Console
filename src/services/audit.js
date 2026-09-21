import { shallowRef, readonly } from 'vue';
import { createAudit } from '../lib/core.js';
import { initialRecords } from '../data/demo.js';
import { taipeiNow } from '../lib/format.js';
import { currentUser } from './session.js';

// Record completed batch operations and successful uploads, downloads and transfers.
// Browsing, filtering and cancelled confirmations do not belong here.
export const audit = createAudit(initialRecords, taipeiNow, () => currentUser.value);
const entries = shallowRef(audit.list());
audit.subscribe(() => { entries.value = audit.list(); });
export const auditEntries = readonly(entries);
