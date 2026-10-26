import { countLeaveDays } from '../lib/rules.js';
import { daysBetween, todayIn } from '../lib/dates.js';
import { getLang, t } from '../lib/i18n.js';
import { badge, btn, confirmBox, dataTable, field, fmtDate, h, select, toast } from '../ui.js';

export default async function render({ api, profile, settings, refresh }) {
  const isAr = getLang() === 'ar';
  const tz = settings?.timezone || 'Africa/Cairo';

  const [types, requests, holidays] = await Promise.all([
    api.list('leave_types', { order: 'name' }).catch(() => []),
    api.list('leave_requests', { eq: { employee_id: profile.id }, order: '-from_date' }).catch(() => []),
    api.list('holidays').catch(() => []),
  ]);

  let shift = null;
  if (profile.shift_id) {
    const shifts = await api.list('shifts', { eq: { id: profile.shift_id } }).catch(() => []);
    shift = shifts[0] || null;
  }

  const today = todayIn(tz);
  const year = today.slice(0, 4);
  const typeName = (id) => types.find((item) => item.id === id)?.name || '—';
  const daysOf = (r) => {
    const type = types.find((item) => item.id === r.leave_type_id);
    const kind = type?.kind || (type?.paid === false ? 'unpaid_leave' : 'paid_leave');
    return ['day_off', 'public_holiday'].includes(kind)
      ? daysBetween(r.from_date, r.to_date) + 1
      : countLeaveDays(r.from_date, r.to_date, shift, holidays || []);
  };

  const balances = (types || []).filter((item) => Number(item.annual_days) > 0).map((item) => {
    const used = (requests || [])
      .filter((r) => r.status === 'approved' && r.leave_type_id === item.id && String(r.from_date || '').startsWith(year))
      .reduce((s, r) => s + daysOf(r), 0);
    const remaining = Math.max(0, item.annual_days - used);
    return h('div', { class: 'stat' },
      h('small', { class: 'muted' }, item.name),
      h('b', { style: { color: 'var(--brand-dark)', fontSize: '1.4rem' } }, `${remaining} / ${item.annual_days}`),
      h('small', { class: 'muted' }, t('leave.remainingDays')),
    );
  });

  const leaveOptions = (types || []).map((lt) => ({ value: lt.id, label: lt.name }));
  if (!leaveOptions.length) {
    leaveOptions.push({ value: 'default', label: isAr ? 'إجازة اعتيادية' : 'Annual Leave' });
  }

  const defaultTypeId = (types.find((lt) => lt.paid) || types[0])?.id || leaveOptions[0]?.value;
  const typeSelect = select(leaveOptions, defaultTypeId);
  const fromInput = h('input', { type: 'date', value: today });
  const toInput = h('input', { type: 'date', value: today });
  const reasonInput = h('textarea', { rows: 2, placeholder: t('leave.reasonPlaceholder') });

  const submit = btn(t('leave.submitBtn'), async () => {
    if (!fromInput.value || !toInput.value || toInput.value < fromInput.value) {
      toast(t('leave.checkDatesError'), 'err');
      return;
    }
    const selectedType = types.find((type) => type.id === typeSelect.value);
    const kind = selectedType?.kind || (selectedType?.paid === false ? 'unpaid_leave' : 'paid_leave');
    const daysCount = ['day_off', 'public_holiday'].includes(kind)
      ? daysBetween(fromInput.value, toInput.value) + 1
      : countLeaveDays(fromInput.value, toInput.value, shift, holidays || []);
    if (daysCount === 0) {
      toast(t('leave.allHolidaysError'), 'err');
      return;
    }

    try {
      await api.save('leave_requests', {
        employee_id: profile.id,
        leave_type_id: typeSelect.value !== 'default' ? typeSelect.value : null,
        from_date: fromInput.value,
        to_date: toInput.value,
        reason: reasonInput.value.trim() || null,
        status: 'pending',
      });
      toast(t('leave.sentSuccess'));
      refresh();
    } catch (err) {
      toast(err.message || 'Unable to save the request.', 'err');
    }
  }, 'primary');

  const leaveStatusMap = {
    pending: [t('leave.statuses.pending'), 'warn'],
    approved: [t('leave.statuses.approved'), 'ok'],
    rejected: [t('leave.statuses.rejected'), 'err'],
  };

  return h('div', {},
    balances.length > 0 && h('div', { class: 'grid', style: { marginBottom: '16px' } }, balances),
    h('div', { class: 'card dotted-box' },
      h('h3', { style: { color: 'var(--brand-dark)' } }, t('leave.title')),
      h('div', { class: 'row' },
        field(t('leave.type'), typeSelect),
        field(t('leave.fromDate'), fromInput),
        field(t('leave.toDate'), toInput),
      ),
      field(t('common.reason'), reasonInput),
      submit,
    ),
    h('div', { class: 'card' },
      h('h3', {}, t('leave.myRequests')),
      dataTable([
        { label: t('leave.type'), render: (r) => typeName(r.leave_type_id) },
        { label: t('leave.fromDate'), render: (r) => fmtDate(r.from_date) },
        { label: t('leave.toDate'), render: (r) => fmtDate(r.to_date) },
        { label: t('common.days'), render: (r) => daysOf(r) },
        { label: t('common.status'), render: (r) => badge(...(leaveStatusMap[r.status] || [r.status, 'warn'])) },
        {
          label: '',
          render: (r) => r.status === 'pending' && btn(t('leave.cancelRequest'), async () => {
            if (await confirmBox(t('leave.cancelConfirm'), t('leave.cancelRequest'))) {
              await api.remove('leave_requests', r.id);
              refresh();
            }
          }, 'small ghost'),
        },
      ], requests || [], t('leave.emptyRequests')),
    ),
  );
}
