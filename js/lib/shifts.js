// Shift timing rules. The check_in/check_out SQL functions in supabase/schema.sql follow the
// same rules, and the demo backend uses these functions directly.
import { addDays, timeToMinutes, zonedTimeToISO } from './dates.js';

// A shift whose end is not after its start finishes the next day (e.g. 23:00 -> 07:00).
export const isOvernight = (shift) => timeToMinutes(shift.end_time) <= timeToMinutes(shift.start_time);

export function shiftLengthMin(shift) {
  const d = timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time);
  return d > 0 ? d : d + 1440;
}

export function sortedByStart(shifts) {
  return [...shifts].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time) || a.name.localeCompare(b.name));
}

// One occurrence of a shift: it belongs to the date it STARTS on and may end the next day.
export function shiftInstance(date, shift, tz) {
  const start = Date.parse(zonedTimeToISO(date, shift.start_time, tz));
  const end = Date.parse(zonedTimeToISO(isOvernight(shift) ? addDays(date, 1) : date, shift.end_time, tz));
  return { date, shift, start, end };
}

/**
 * The occurrence of `shift` that a check-in at `nowMs` can belong to: open from windowMin
 * before its start until its end. Yesterday and tomorrow are tried as well, so a night shift
 * still counts after midnight. Returns null when the shift is not open right now.
 */
export function openInstance({ shift, nowMs, tz, windowMin, today }) {
  let best = null;
  for (const d of [addDays(today, -1), today, addDays(today, 1)]) {
    const inst = shiftInstance(d, shift, tz);
    if (nowMs >= inst.start - windowMin * 60000 && nowMs < inst.end) {
      if (!best || Math.abs(nowMs - inst.start) < Math.abs(nowMs - best.start)) best = inst;
    }
  }
  return best;
}

// When check-in next opens for this shift (ms), or null if it is not coming up within a day.
export function nextOpening({ shift, nowMs, tz, windowMin, today }) {
  let soonest = null;
  for (const d of [today, addDays(today, 1)]) {
    const opens = shiftInstance(d, shift, tz).start - windowMin * 60000;
    if (opens > nowMs && (soonest === null || opens < soonest)) soonest = opens;
  }
  return soonest;
}

const wholeMinutes = (ms) => Math.floor(ms / 60000);

// Arriving within the grace period costs nothing. Past it, lateness counts from the shift start.
export function lateMinutesAt(inst, nowMs) {
  const late = wholeMinutes(nowMs) - wholeMinutes(inst.start);
  return late > inst.shift.grace_minutes ? late : 0;
}

// Overtime only counts once it reaches the threshold (settings.overtime_threshold_min).
export function checkoutMinutesAt(inst, nowMs, overtimeThreshold) {
  const over = wholeMinutes(nowMs) - wholeMinutes(inst.end);
  return {
    early_leave_minutes: Math.max(0, -over),
    overtime_minutes: over > 0 && over >= overtimeThreshold ? over : 0,
  };
}
