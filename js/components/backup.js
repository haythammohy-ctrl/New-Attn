// Full-data export for HR/admin. Row level security lets HR read every table, so this
// needs no special permission. It exports only; restoring is a separate job.
import { downloadJSON } from '../ui.js';
import { TABLES_ORDER } from '../api/tables.js';
import { getLang } from '../lib/i18n.js';

export const TABLES = TABLES_ORDER;
const LAST_KEY = 'attn.last_backup';
export const STALE_AFTER_DAYS = 7;

export function validateBackup(data) {
  const isAr = getLang() === 'ar';
  if (!data || typeof data !== 'object') {
    return { valid: false, error: isAr ? 'الملف ليس بتنسيق JSON صحيح' : 'The file is not valid JSON.' };
  }
  if (data.app !== 'attendance-payroll') {
    return { valid: false, error: isAr ? 'الملف ليس نسخة احتياطية خاصة بهذا التطبيق' : 'This is not a backup file for this application.' };
  }
  if (!data.tables || typeof data.tables !== 'object') {
    return { valid: false, error: isAr ? 'ملف النسخة الاحتياطية لا يحتوي على جداول بيانات' : 'The backup file does not contain data tables.' };
  }
  const summary = {};
  for (const table of TABLES) {
    if (Array.isArray(data.tables[table])) {
      summary[table] = data.tables[table].length;
    }
  }
  return { valid: true, summary, exported_at: data.exported_at };
}

export async function restoreBackup(api, data) {
  const check = validateBackup(data);
  if (!check.valid) throw new Error(check.error);
  if (typeof api.restore === 'function') {
    return await api.restore(data);
  }
  throw new Error(getLang() === 'ar' ? 'عملية الاسترجاع غير مدعومة في واجهة الاتصال الحالية' : 'Restore is not supported by the current API.');
}


export async function collectBackup(api) {
  const tables = {};
  for (const t of TABLES) tables[t] = await api.list(t);
  return { app: 'attendance-payroll', exported_at: new Date().toISOString(), tables };
}

export async function runBackup(api) {
  const data = await collectBackup(api);
  downloadJSON(`attendance-backup-${data.exported_at.slice(0, 10)}.json`, data);
  localStorage.setItem(LAST_KEY, data.exported_at);
  document.getElementById('backup-banner')?.remove();
  return Object.fromEntries(Object.entries(data.tables).map(([t, rows]) => [t, rows.length]));
}

export function lastBackupAt() {
  return localStorage.getItem(LAST_KEY);
}

// null = never backed up from this browser
export function daysSinceBackup(now = Date.now()) {
  const last = lastBackupAt();
  return last ? Math.floor((now - new Date(last).getTime()) / 86400000) : null;
}
