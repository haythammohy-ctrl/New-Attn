import { test, eq } from './harness.js';
import { api } from '../js/api/local.js';

test('supervisors confirm attendance without a reason and see the audit event', async () => {
  const supervisor = api.demoAccounts().find((account) => account.role === 'supervisor');
  await api.signIn({ email: supervisor.email, identifier: supervisor.full_name });
  const supervisorProfile = await api.currentProfile();

  const pending = (await api.list('attendance')).filter((row) => row.verification_status === 'pending');
  const approvedRow = pending[0];
  if (!approvedRow) throw new Error('No pending attendance record is available for the supervisor.');
  let errorCode = null;
  try {
    await api.verifyAttendance({ id: approvedRow.id, decision: 'rejected' });
  } catch (err) {
    errorCode = err.code;
  }
  eq(errorCode, 'reason_required');

  const approved = await api.verifyAttendance({ id: approvedRow.id, decision: 'approved' });
  eq(approved.verification_status, 'approved');
  eq(approved.verification_note, null);

  const audit = await api.list('attendance_edits');
  const approvalEvent = audit.find((event) => event.attendance_id === approvedRow.id);
  eq(approvalEvent.actor_id, supervisorProfile.id);
  eq(approvalEvent.reason, null);
  eq(approvalEvent.new_data.verification_status, 'approved');
});
