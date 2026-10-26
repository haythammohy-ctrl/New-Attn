import { test, eq } from './harness.js';
import { chainOf } from '../js/lib/hierarchy.js';

// 3 teams, 2 supervisors each, one assistant manager over all of them, one manager above the assistant manager.
const person = (id, role, extra = {}) => ({ id, full_name: id, role, active: true, team_id: null, manager_id: null, ...extra });
const boss = person('boss', 'manager');
const asst = person('asst', 'assistant_manager', { manager_id: 'boss' });
const teams = ['t1', 't2', 't3'].map((id) => ({ id, name: id, manager_id: 'asst' }));
const sups = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id, i) => person(id, 'supervisor', { team_id: teams[Math.floor(i / 2)].id }));
const emp = person('emp', 'employee', { team_id: 't1', manager_id: 's1' });
const everyone = [boss, asst, ...sups, emp];
const names = (user, profiles = everyone, t = teams) => chainOf(user, profiles, t).map((c) => `${c.relation}:${c.id}`);

test('chain: every one of the six supervisors sees the assistant manager, then the manager above', () => {
  for (const s of sups) eq(names(s), ['assistant_manager:asst', 'manager:boss']);
});

test('chain: an assistant manager sees their manager, a manager and an employee see nobody', () => {
  eq(names(asst), ['manager:boss']);
  eq(names(boss), []);
  eq(names(emp), []);
  eq(names(person('root', 'admin')), []);
});

test('chain: only names travel, nothing else about the people above', () => {
  eq(Object.keys(chainOf(sups[0], everyone, teams)[0]).sort(), ['full_name', 'id', 'relation']);
});

test('chain: a supervisor with no team, or on a team nobody is in charge of, sees nobody', () => {
  eq(names(person('s9', 'supervisor')), []);
  eq(names(sups[0], everyone, teams.map((t) => ({ ...t, manager_id: null }))), []);
});

test('chain: a deactivated person sees nobody above them', () => {
  eq(names({ ...sups[0], active: false }), []);
  eq(names({ ...asst, active: false }), []);
});

test('chain: an inactive or wrong-role account is skipped', () => {
  eq(names(sups[0], everyone.map((p) => (p.id === 'asst' ? { ...p, active: false } : p))), []);
  eq(names(sups[0], everyone.map((p) => (p.id === 'boss' ? { ...p, active: false } : p))), ['assistant_manager:asst']);
  eq(names(sups[0], everyone.map((p) => (p.id === 'boss' ? { ...p, role: 'supervisor' } : p))), ['assistant_manager:asst']);
  // a team "owned" by someone who is not an assistant manager shows nothing
  eq(names(sups[0], everyone.map((p) => (p.id === 'asst' ? { ...p, role: 'supervisor' } : p))), []);
});

test('chain: an assistant manager with no manager set sees nobody', () => {
  const unattached = { ...asst, manager_id: null };
  eq(names(unattached, everyone.map((p) => (p.id === 'asst' ? unattached : p))), []);
  eq(chainOf(null, everyone, teams), []);
});
