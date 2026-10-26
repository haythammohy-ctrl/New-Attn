import { test, eq, near, throwsCode } from './harness.js';
import {
  addDays, daysBetween, daysInMonth, eachDate, monthRange, shiftMonth, timeToMinutes, todayIn, weekday, weekStart,
  zonedTimeToISO,
} from '../js/lib/dates.js';
import { haversineMeters } from '../js/lib/geo.js';
import { checkGeofence, countLeaveDays } from '../js/lib/rules.js';

const shift = { start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 10, working_days: [0, 1, 2, 3, 4] };

test('weekday: 2026-09-01 is a Tuesday, 2026-09-04 a Friday', () => {
  eq(weekday('2026-09-01'), 2);
  eq(weekday('2026-09-04'), 5);
});

test('daysInMonth handles leap years', () => {
  eq(daysInMonth(2024, 2), 29);
  eq(daysInMonth(2026, 2), 28);
  eq(daysInMonth(2026, 9), 30);
});

test('addDays / eachDate / monthRange / shiftMonth cross boundaries', () => {
  eq(addDays('2026-12-31', 1), '2027-01-01');
  eq(addDays('2026-03-01', -1), '2026-02-28');
  eq(eachDate('2026-09-29', '2026-10-02'), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  eq(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  eq(shiftMonth('2026-01', -1), '2025-12');
  eq(shiftMonth('2026-12', 1), '2027-01');
});

test('timeToMinutes accepts HH:MM and HH:MM:SS', () => {
  eq(timeToMinutes('09:00'), 540);
  eq(timeToMinutes('17:30:00'), 1050);
});

test('todayIn follows the timezone, not the machine clock', () => {
  const instant = new Date('2026-06-30T22:30:00Z');
  eq(todayIn('UTC', instant), '2026-06-30');
  eq(todayIn('Africa/Cairo', instant), '2026-07-01');
});

test('zonedTimeToISO converts Cairo wall time (summer UTC+3, winter UTC+2)', () => {
  eq(zonedTimeToISO('2026-07-01', '09:00', 'Africa/Cairo'), '2026-07-01T06:00:00.000Z');
  eq(zonedTimeToISO('2026-01-15', '09:00', 'Africa/Cairo'), '2026-01-15T07:00:00.000Z');
  eq(zonedTimeToISO('2026-01-15', '09:00', 'UTC'), '2026-01-15T09:00:00.000Z');
});

test('haversine: one degree of latitude is about 111.2 km', () => {
  near(haversineMeters(30, 31, 31, 31), 111195, 50);
  eq(haversineMeters(30.0444, 31.2357, 30.0444, 31.2357), 0);
});

test('daysBetween and weekStart: weeks run Sunday to Saturday', () => {
  eq(daysBetween('2026-09-01', '2026-09-08'), 7);
  eq(daysBetween('2026-12-31', '2027-01-01'), 1);
  eq(weekStart('2026-10-19'), '2026-10-18');   // Monday -> the Sunday before
  eq(weekStart('2026-10-18'), '2026-10-18');   // a Sunday stays put
  eq(weekStart('2026-10-24'), '2026-10-18');   // Saturday
});

test('geofence: inside, outside, poor accuracy, no location', () => {
  const location = { lat: 30.0444, lng: 31.2357, radius_m: 100 };
  const here = { lat: 30.0444, lng: 31.2357, accuracy: 20 };
  eq(checkGeofence({ coords: here, location, maxAccuracy: 100 }), 0);
  throwsCode(() => checkGeofence({ coords: { ...here, lat: 30.0454 }, location, maxAccuracy: 100 }), 'out_of_range');
  throwsCode(() => checkGeofence({ coords: { ...here, accuracy: 150 }, location, maxAccuracy: 100 }), 'low_accuracy');
  throwsCode(() => checkGeofence({ coords: here, location: null, maxAccuracy: 100 }), 'no_location');
});

test('countLeaveDays skips weekends and public holidays', () => {
  const holidays = [{ date: '2026-09-16' }];
  eq(countLeaveDays('2026-09-13', '2026-09-17', shift, holidays), 4);
  eq(countLeaveDays('2026-09-13', '2026-09-19', shift, holidays), 4);
});
