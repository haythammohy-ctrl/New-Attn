// Who stands above someone, by name only (never contact details):
//   - a supervisor: the assistant manager in charge of their team (teams.manager_id), and that assistant manager's manager;
//   - an assistant manager: their own manager (profiles.manager_id);
//   - everyone else: nobody (an employee already sees their direct supervisor on their profile).
// The my_chain() function in the database does the same, so a person can read these names without being allowed to read
// the other person's profile. Inactive accounts are skipped, and only the right roles count as "above".
export function chainOf(user, profiles = [], teams = []) {
  if (!user || user.active === false) return [];   // a deactivated account sees nothing, as in the database
  const activeById = (id) => (id ? profiles.find((p) => p.id === id && p.active) : undefined);
  const entry = (relation, p) => ({ relation, id: p.id, full_name: p.full_name });
  const out = [];

  let assistant;
  if (user.role === 'supervisor' && user.team_id) {
    const team = teams.find((t) => t.id === user.team_id);
    const owner = team && activeById(team.manager_id);
    if (owner && owner.role === 'assistant_manager') assistant = owner;
  }
  if (assistant) out.push(entry('assistant_manager', assistant));

  const below = user.role === 'assistant_manager' ? user : assistant;
  const boss = below && activeById(below.manager_id);
  if (boss && boss.role === 'manager') out.push(entry('manager', boss));
  return out;
}
