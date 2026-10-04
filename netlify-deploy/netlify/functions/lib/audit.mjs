import { appendRows } from './sheets.mjs';
import { SHEETS } from './constants.mjs';
export async function audit(action, entityType, entityId, adminUser, details = {}) { await appendRows(SHEETS.AUDIT, [{ timestamp: new Date().toISOString(), action, entityType, entityId, adminUser, details: JSON.stringify(details) }]); }
