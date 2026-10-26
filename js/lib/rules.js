// Business rules shared by the demo backend and the UI. The check_in SQL function in
// supabase/schema.sql enforces the same geofence on the server; shift timing lives in shifts.js.
import { haversineMeters } from './geo.js';
import { eachDate, weekday } from './dates.js';

export class RuleError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function checkGeofence({ coords, location, maxAccuracy }) {
  if (!location) throw new RuleError('no_location');
  if (coords.accuracy == null || coords.accuracy > maxAccuracy) throw new RuleError('low_accuracy');
  const distance = haversineMeters(coords.lat, coords.lng, location.lat, location.lng);
  if (distance > location.radius_m) throw new RuleError('out_of_range');
  return distance;
}

// Working days a leave request consumes: the shift's weekdays minus public holidays.
export function countLeaveDays(from, to, shift, holidays) {
  const workDays = new Set(shift ? shift.working_days : [0, 1, 2, 3, 4]);
  const off = new Set(holidays.map((h) => h.date));
  return eachDate(from, to).filter((d) => workDays.has(weekday(d)) && !off.has(d)).length;
}
