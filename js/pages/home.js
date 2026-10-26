import { AR_WEEKDAYS, addDays, formatTime, todayIn, weekday } from '../lib/dates.js';
import { getPosition, haversineMeters } from '../lib/geo.js';
import { isOvernight, nextOpening, openInstance, shiftInstance, sortedByStart } from '../lib/shifts.js';
import { getLang, t } from '../lib/i18n.js';
import { badge, btn, h, hoursText, modal, toast } from '../ui.js';

const hhmm = (timeStr) => timeStr.slice(0, 5);
const FORGOT_AFTER_MS = 4 * 3600000;   // an unclosed check-in this long after its shift ended counts as a forgotten check-out

export default async function render({ api, profile, settings, onCleanup, refresh }) {
  const isAr = getLang() === 'ar';
  const tz = settings.timezone;
  const nowMs = api.now().getTime();
  const today = todayIn(tz, new Date(nowMs));
  const windowMin = settings.checkin_window_min ?? 60;

  const [allShifts, recent] = await Promise.all([
    api.list('shifts'),
    api.list('attendance', {
      eq: { employee_id: profile.id }, gte: { work_date: addDays(today, -2) }, lte: { work_date: addDays(today, 1) }, order: '-work_date',
    }),
  ]);
  const [location] = profile.location_id ? await api.list('work_locations', { eq: { id: profile.location_id } }) : [];
  const shifts = sortedByStart(allShifts);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const timeOf = (ms) => formatTime(new Date(ms).toISOString(), tz);
  const dayName = (d) => {
    const dayIdx = weekday(d);
    const dayLabel = isAr ? AR_WEEKDAYS[dayIdx] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIdx];
    return `${dayLabel} ${d.split('-').reverse().join('/')}`;
  };

  // A check-in without a check-out is "open" while its shift is running (and a few hours after).
  const endOf = (a) => {
    const sh = shiftById.get(a.shift_id);
    return sh ? shiftInstance(a.work_date, sh, tz).end : Date.parse(a.check_in_at) + 14 * 3600000;
  };
  const unclosed = recent.filter((a) => a.check_in_at && !a.check_out_at);
  const open = unclosed.find((a) => nowMs < endOf(a) + FORGOT_AFTER_MS);
  const forgotten = unclosed.filter((a) => a !== open);
  const mode = open ? 'out' : 'in';

  // One card per shift defined in the app. Only a shift that is open right now can be picked.
  const choices = shifts.map((shift) => {
    const inst = openInstance({ shift, nowMs, tz, windowMin, today });
    const taken = inst && recent.some((a) => a.work_date === inst.date && a.check_in_at);
    if (inst && !taken) return { shift, ok: true };
    if (taken) return { shift, ok: false, note: isAr ? 'سجّلت حضورك اليوم بالفعل.' : 'You have already clocked in today.' };
    const opens = nextOpening({ shift, nowMs, tz, windowMin, today });
    return { shift, ok: false, note: opens ? (isAr ? `تبدأ عند ${timeOf(opens)}` : `Opens at ${timeOf(opens)}`) : (isAr ? 'مغلقة' : 'Closed') };
  });
  const pickable = choices.filter((c) => c.ok);
  let selectedId = pickable.length === 1 ? pickable[0].shift.id : null;

  const demo = api.mode === 'local';
  const simulate = h('input', { type: 'checkbox', checked: true });
  const clock = h('div', { class: 'clock' });
  const gps = h('div', { class: 'gps muted' });
  const cards = h('div', { class: 'shifts' });
  const punch = btn('', () => doPunch(), 'punch', { style: { display: 'grid' } });

  const tick = () => {
    clock.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  };
  tick();
  const timer = setInterval(tick, 1000);
  onCleanup(() => clearInterval(timer));

  function coordsNow() {
    if (demo && simulate.checked && location) return Promise.resolve({ lat: location.lat, lng: location.lng, accuracy: 10 });
    return getPosition();
  }

  async function doPunch() {
    const coords = await coordsNow();
    if (mode === 'out') await api.checkOut(coords);
    else await api.checkIn({ ...coords, shiftId: selectedId });
    toast(mode === 'out' ? (isAr ? 'تم تسجيل الانصراف بنجاح' : 'Clock out recorded successfully') : (isAr ? 'تم تسجيل الحضور بنجاح' : 'Clock in recorded successfully'));
    if (mode !== 'out' && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch {}
    }
    refresh();
  }

  let locateSeq = 0;
  async function locate() {
    if (!location) return;
    const mine = ++locateSeq;
    gps.className = 'gps muted';
    gps.textContent = isAr ? 'جارٍ تحديد موقعك...' : 'Locating your position...';
    try {
      const fix = await coordsNow();
      if (mine !== locateSeq) return;
      const meters = Math.round(haversineMeters(fix.lat, fix.lng, location.lat, location.lng));
      const inside = meters <= location.radius_m;
      const acc = fix.accuracy ? Math.round(fix.accuracy) : null;
      const accText = acc ? (isAr ? ` · دقة GPS: ${acc} م` : ` · GPS accuracy: ${acc} m`) : '';
      const isLowAcc = acc && settings.max_accuracy_m && acc > settings.max_accuracy_m;
      
      if (fix.isMocked) {
        gps.className = 'gps far';
        gps.textContent = isAr ? 'اكتُشف موقع جغرافي وهمي؛ لا يمكن تسجيل الحضور.' : 'A mock GPS location was detected. Clock-in is unavailable.';
        return;
      }

      if (isLowAcc) {
        gps.className = 'gps far';
        gps.textContent = isAr
          ? `هامش خطأ الموقع أكبر من المسموح (${acc} م؛ الحد الأقصى ${settings.max_accuracy_m} م). انتقل إلى مكان مفتوح وحاول مجددًا.`
          : `GPS accuracy is too low (${acc} m; maximum ${settings.max_accuracy_m} m). Move to an open area and try again.`;
        return;
      }

      gps.className = `gps ${inside ? 'in' : 'far'}`;
      gps.textContent = inside
        ? (isAr ? `أنت ضمن نطاق فرع ${location.name} (المسافة ${meters} م${accText})` : `You are within the geofence for ${location.name} (${meters} m away${accText})`)
        : (isAr ? `أنت على بُعد ${meters} م من فرع ${location.name} (الحد الأقصى ${location.radius_m} م${accText})` : `You are ${meters} m from ${location.name} (maximum ${location.radius_m} m${accText})`);
    } catch (err) {
      if (mine !== locateSeq) return;
      gps.className = 'gps far';
      gps.textContent = err.code === 'gps_denied'
        ? (isAr ? 'يرجى السماح للمتصفح بالوصول إلى موقعك.' : 'Allow location access in your browser.')
        : (isAr ? 'تعذّر تحديد موقعك. تأكد من تفعيل خدمات الموقع.' : 'Unable to get your location. Make sure location services are enabled.');
    }
  }

  function paintCards() {
    cards.replaceChildren(...choices.map((c) => h('button', {
      type: 'button',
      class: `shift-card${c.shift.id === selectedId ? ' selected' : ''}`,
      disabled: !c.ok,
      'aria-pressed': String(c.shift.id === selectedId),
      onClick: () => { selectedId = c.shift.id; paintCards(); paintPunch(); },
    },
    h('b', {}, c.shift.name),
    h('span', {}, `${hhmm(c.shift.start_time)} - ${hhmm(c.shift.end_time)}`),
    isOvernight(c.shift) && h('small', {}, isAr ? 'تنتهي في اليوم التالي' : 'Overnight shift'),
    c.note && h('small', { class: 'muted' }, c.note))));
  }

  function paintPunch() {
    const chosen = shiftById.get(selectedId);
    punch.replaceChildren(...(mode === 'out'
      ? [isAr ? 'تسجيل انصراف' : 'Clock Out']
      : [h('span', {}, isAr ? 'تسجيل حضور' : 'Clock In'), ...(chosen ? [h('small', {}, chosen.name)] : [])]));
    punch.className = `btn punch ${mode === 'out' ? 'out' : ''}`;
    punch.disabled = !location || (mode === 'in' && !selectedId);
  }

  function intro() {
    if (!location) return h('p', {}, badge(isAr ? 'لم يُحدّد لك فرع عمل بعد.' : 'No branch assigned yet', 'warn'), isAr ? ' يُرجى التواصل مع إدارة الموارد البشرية.' : ' Please contact HR.');
    if (!shifts.length) return h('p', {}, badge(isAr ? 'لم تُعرّف أي ورديات.' : 'No shifts configured', 'warn'), isAr ? ' يُرجى التواصل مع الإدارة لإضافتها من صفحة الإعدادات.' : ' Please contact HR to add shifts in Settings.');
    if (mode === 'out') {
      const sh = shiftById.get(open.shift_id);
      return h('p', { class: 'muted' }, isAr ? 'وردتك الحالية: ' : 'Current shift: ', sh ? `${sh.name} ${hhmm(sh.start_time)} - ${hhmm(sh.end_time)}` : '—');
    }
    return h('p', { class: pickable.length ? 'muted' : '' },
      pickable.length
        ? (pickable.length > 1 ? (isAr ? 'اختر الوردية التي تريد تسجيل حضورك فيها:' : 'Select a shift to clock in:') : (isAr ? 'وردتك:' : 'Your shift:'))
        : [badge(isAr ? 'لا توجد وردية متاحة للتسجيل حاليًا.' : 'No shift is currently open for clock-in.', 'warn'), isAr ? ` يمكنك تسجيل الحضور قبل بداية الوردية بـ${windowMin} دقيقة.` : ` You can clock in up to ${windowMin} minutes before the shift starts.`]);
  }

  const stat = (label, value, extra) => h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, value), extra);
  const justDone = recent.find((a) => a.check_in_at && a.check_out_at && nowMs - Date.parse(a.check_out_at) < 12 * 3600000);
  const record = open || justDone || null;
  const status = record
    ? h('div', { class: 'grid' },
      stat(isAr ? 'الحضور' : 'Clock In', formatTime(record.check_in_at, tz) || '—',
        record.verification_status === 'pending'
          ? badge(t('approvals.verificationPending'), 'warn')
          : record.verification_status === 'rejected'
            ? badge(t('approvals.verificationRejected'), 'err')
            : record.late_minutes
              ? badge(isAr ? `متأخر ${hoursText(record.late_minutes)}` : `Late ${hoursText(record.late_minutes)}`, 'warn')
              : badge(isAr ? 'تم تأكيد الحضور' : 'Attendance confirmed', 'ok')),
      stat(isAr ? 'الانصراف' : 'Clock Out', formatTime(record.check_out_at, tz) || '—',
        record.early_leave_minutes ? badge(isAr ? `مبكر ${hoursText(record.early_leave_minutes)}` : `Early ${hoursText(record.early_leave_minutes)}`, 'warn')
          : record.overtime_minutes ? badge(isAr ? `إضافي ${hoursText(record.overtime_minutes)}` : `Overtime ${hoursText(record.overtime_minutes)}`, 'ok') : null))
    : h('p', { class: 'muted' }, isAr ? 'لم تسجّل حضورك اليوم بعد.' : 'No clock-in has been recorded today.');

  simulate.addEventListener('change', locate);
  paintCards();

  function requestCheckoutCorrection(att) {
    const timeInput = h('input', { type: 'time', value: '17:00' });
    const noteInput = h('textarea', { rows: 2, placeholder: isAr ? 'اكتب سبب عدم تسجيل الانصراف ووقت خروجك الفعلي...' : 'Enter why you missed clock-out and your actual departure time...' });
    modal({
      title: isAr ? `طلب تسجيل انصراف ليوم ${dayName(att.work_date)}` : `Request Clock-Out for ${dayName(att.work_date)}`,
      body: h('div', { class: 'grid' },
        h('label', { class: 'field' }, h('span', { class: 'label' }, isAr ? 'وقت الانصراف الفعلي:' : 'Actual Out Time:'), timeInput),
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('common.reason')), noteInput),
      ),
      buttons: [
        {
          label: isAr ? 'إرسال الطلب للمشرف' : 'Send to Supervisor',
          kind: 'primary',
          onClick: async () => {
            const reason = noteInput.value.trim();
            if (!reason) throw new Error(isAr ? 'يرجى توضيح سبب طلب تسجيل الانصراف.' : 'Please provide a reason for the clock-out request.');
            const noteText = `${isAr ? 'طلب تسجيل الانصراف' : 'Missed clock-out request'} (${timeInput.value}): ${reason}`;
            await api.save('attendance', { ...att, note: noteText });
            toast(isAr ? 'أُرسل الطلب إلى المشرف للمراجعة والاعتماد.' : 'The request was sent to your supervisor for review and approval.');
            refresh();
          },
        },
        { label: t('common.cancel'), kind: 'ghost' },
      ],
    });
  }

  paintPunch();
  locate();

  return h('div', {},
    h('div', { class: 'card hero' },
      h('h2', {}, `${isAr ? 'أهلًا بك،' : 'Welcome,'} ${profile.full_name}`),
      h('p', { class: 'muted' }, dayName(today)),
      clock,
      forgotten.length > 0 && h('div', { class: 'card', style: { background: 'var(--bg)', margin: '10px 0' } },
        h('p', {}, badge(isAr ? 'لم تسجّل الانصراف' : 'Missed clock-out', 'warn'), ` ${isAr ? 'بتاريخ' : 'on'} ${dayName(forgotten[0].work_date)}.`),
        btn(isAr ? 'طلب تسجيل الانصراف مع توضيح السبب' : 'Request a clock-out correction', () => requestCheckoutCorrection(forgotten[0]), 'small primary'),
      ),
      intro(),
      mode === 'in' && cards,
      punch,
      gps,
      h('div', { class: 'row', style: { justifyContent: 'center' } }, btn(isAr ? 'تحديث موقعي' : 'Refresh Location', locate, 'small ghost')),
      demo && h('label', { class: 'check', style: { justifyContent: 'center', marginTop: '10px' } }, simulate, isAr ? 'الوضع التجريبي: محاكاة الوجود في مقر العمل' : 'Demo mode: simulate being at the workplace'),
    ),
    h('div', { class: 'card' }, h('h3', {}, record ? (shiftById.get(record.shift_id)?.name || (isAr ? 'الوردية الحالية' : 'Current Shift')) : (isAr ? 'سجل اليوم' : "Today's Record")), status),
  );
}
