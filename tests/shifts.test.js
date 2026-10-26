import { test, eq } from './harness.js';
import {
  checkoutMinutesAt, isOvernight, lateMinutesAt, nextOpening, openInstance, shiftInstance, shiftLengthMin, sortedByStart,
} from '../js/lib/shifts.js';

const day = { id: 'day', name: 'صباحي', start_time: '07:00:00', end_time: '15:00:00', grace_minutes: 10 };
const eve = { id: 'eve', name: 'مسائي', start_time: '15:00:00', end_time: '23:00:00', grace_minutes: 10 };
const night = { id: 'night', name: 'ليلي', start_time: '23:00:00', end_time: '07:00:00', grace_minutes: 10 };
const at = (iso) => Date.parse(iso);

// 2026-10-19 is a Monday, 2026-10-20 a Tuesday. UTC keeps the arithmetic obvious.
const open = (shift, iso, windowMin = 60) => {
  const nowMs = at(iso);
  return openInstance({ shift, nowMs, tz: 'UTC', windowMin, today: iso.slice(0, 10) });
};

test('isOvernight and shiftLengthMin', () => {
  eq(isOvernight(night), true);
  eq(isOvernight(day), false);
  eq(shiftLengthMin(night), 480);
  eq(shiftLengthMin(day), 480);
  eq(shiftLengthMin({ start_time: '22:00', end_time: '06:30' }), 510);
});

test('sortedByStart orders the shifts by start time', () => {
  eq(sortedByStart([night, day, eve]).map((s) => s.id), ['day', 'eve', 'night']);
});

test('shiftInstance: a night shift ends the next day (UTC and Cairo summer)', () => {
  const utc = shiftInstance('2026-10-19', night, 'UTC');
  eq(new Date(utc.start).toISOString(), '2026-10-19T23:00:00.000Z');
  eq(new Date(utc.end).toISOString(), '2026-10-20T07:00:00.000Z');
  const cairo = shiftInstance('2026-07-01', night, 'Africa/Cairo');
  eq(new Date(cairo.start).toISOString(), '2026-07-01T20:00:00.000Z');
  eq(new Date(cairo.end).toISOString(), '2026-07-02T04:00:00.000Z');
});

test('picking the night shift in the morning is refused; evening and after-midnight are accepted', () => {
  eq(open(night, '2026-10-19T10:00:00Z'), null);                     // Monday morning
  eq(open(night, '2026-10-19T21:59:00Z'), null);                     // one minute before the window opens
  eq(open(night, '2026-10-19T22:00:00Z')?.date, '2026-10-19');       // window opens 60 min early
  eq(open(night, '2026-10-20T02:00:00Z')?.date, '2026-10-19');       // after midnight: still Monday's shift
  eq(open(night, '2026-10-20T07:00:00Z'), null);                     // the shift is over
  eq(open(night, '2026-10-20T10:00:00Z'), null);                     // Tuesday morning
});

test('a day shift is only open between its window and its end', () => {
  eq(open(day, '2026-10-19T05:59:00Z'), null);
  eq(open(day, '2026-10-19T06:00:00Z')?.date, '2026-10-19');
  eq(open(day, '2026-10-19T14:59:00Z')?.date, '2026-10-19');
  eq(open(day, '2026-10-19T15:00:00Z'), null);
});

test('at the hand-over two shifts are open, so the employee really has a choice', () => {
  const now = '2026-10-19T14:30:00Z';
  eq(open(day, now)?.date, '2026-10-19');   // morning is still running
  eq(open(eve, now)?.date, '2026-10-19');   // evening opens at 14:00
  eq(open(night, now), null);
});

test('shifts that touch midnight (00:00-08:00 and 16:00-23:59) hand over correctly', () => {
  const early = { id: 'n', name: 'Night', start_time: '00:00:00', end_time: '08:00:00', grace_minutes: 10 };
  const between = { id: 'b', name: 'Between', start_time: '16:00:00', end_time: '23:59:00', grace_minutes: 10 };
  eq(isOvernight(early), false);
  eq(isOvernight(between), false);
  // 23:30 Monday: Between is still running and Night (which starts at midnight) has opened for Tuesday
  eq(open(between, '2026-10-19T23:30:00Z')?.date, '2026-10-19');
  eq(open(early, '2026-10-19T23:30:00Z')?.date, '2026-10-20');
  // 00:30 Tuesday: Night is running, Between is over
  eq(open(early, '2026-10-20T00:30:00Z')?.date, '2026-10-20');
  eq(open(between, '2026-10-20T00:30:00Z'), null);
  // 08:00 Tuesday: Night has ended
  eq(open(early, '2026-10-20T08:00:00Z'), null);
});

test('window setting changes when check-in opens', () => {
  eq(open(night, '2026-10-19T22:30:00Z', 60)?.date, '2026-10-19');
  eq(open(night, '2026-10-19T22:30:00Z', 15), null);
  eq(open(night, '2026-10-19T22:30:00Z', 0), null);
});

test('nextOpening: when a closed shift opens, null if it is already open and does not repeat soon', () => {
  const next = (iso, shift = night) => nextOpening({ shift, nowMs: at(iso), tz: 'UTC', windowMin: 60, today: iso.slice(0, 10) });
  eq(new Date(next('2026-10-19T10:00:00Z')).toISOString(), '2026-10-19T22:00:00.000Z');
  eq(new Date(next('2026-10-19T23:30:00Z')).toISOString(), '2026-10-20T22:00:00.000Z');   // tonight's window already opened
  eq(new Date(next('2026-10-19T16:00:00Z', day)).toISOString(), '2026-10-20T06:00:00.000Z');
});

test('lateness on a night shift: grace is free, minutes are whole', () => {
  const inst = shiftInstance('2026-10-19', night, 'UTC');
  eq(lateMinutesAt(inst, at('2026-10-19T22:50:00Z')), 0);
  eq(lateMinutesAt(inst, at('2026-10-19T23:10:40Z')), 0);   // seconds do not push past the grace minute
  eq(lateMinutesAt(inst, at('2026-10-19T23:11:00Z')), 11);
  eq(lateMinutesAt(inst, at('2026-10-19T23:25:00Z')), 25);
  eq(lateMinutesAt(inst, at('2026-10-20T00:15:00Z')), 75);  // crossing midnight keeps counting
});

test('checkout on a night shift: early leave and overtime threshold', () => {
  const inst = shiftInstance('2026-10-19', night, 'UTC');
  eq(checkoutMinutesAt(inst, at('2026-10-20T06:40:00Z'), 30), { early_leave_minutes: 20, overtime_minutes: 0 });
  eq(checkoutMinutesAt(inst, at('2026-10-20T07:00:00Z'), 30), { early_leave_minutes: 0, overtime_minutes: 0 });
  eq(checkoutMinutesAt(inst, at('2026-10-20T07:29:00Z'), 30), { early_leave_minutes: 0, overtime_minutes: 0 });
  eq(checkoutMinutesAt(inst, at('2026-10-20T07:45:00Z'), 30), { early_leave_minutes: 0, overtime_minutes: 45 });
  eq(checkoutMinutesAt(inst, at('2026-10-20T07:05:00Z'), 0), { early_leave_minutes: 0, overtime_minutes: 5 });
});
