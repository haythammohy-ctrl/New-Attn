import { CONFIG } from '../config.js';
import { codedError } from './errors.js';

// Open the app with ?demo in the address bar to try the demo data even when Supabase is configured.
const forceDemo = new URLSearchParams(location.search).has('demo');
const live = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) && !forceDemo;
const impl = (await import(live ? './supabase.js' : './local.js')).api;

// Replaces the draft payslips of a month with a fresh calculation. Locked months are refused.
async function savePayrollDraft(month, payslips, createdBy) {
  const [existing] = await impl.list('payroll_runs', { eq: { month: `${month}-01` } });
  if (existing && existing.status !== 'draft') throw codedError('run_locked');
  const run = existing || await impl.save('payroll_runs', { month: `${month}-01`, status: 'draft', created_by: createdBy });
  const old = await impl.list('payslips', { eq: { run_id: run.id } });
  for (const p of old) await impl.remove('payslips', p.id);
  await impl.saveMany('payslips', payslips.map((p) => ({ ...p, run_id: run.id })));
  return run;
}

async function setRunStatus(run, status) {
  return impl.save('payroll_runs', { id: run.id, month: run.month, status, created_by: run.created_by });
}

export const api = { ...impl, savePayrollDraft, setRunStatus };
