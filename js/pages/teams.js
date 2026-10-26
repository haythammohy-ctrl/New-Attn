// Teams: a supervisor and an assistant supervisor share one team, and "my team" in the permission
// matrix means everyone in it.
import { roleLabel, can } from '../lib/access.js';
import { chainOf } from '../lib/hierarchy.js';
import { getLang } from '../lib/i18n.js';
import { badge, btn, confirmBox, field, h, modal, select, toast } from '../ui.js';

export default async function render({ api, perms, refresh }) {
  const isAr = getLang() === 'ar';
  const canEdit = can(perms, 'employees', 'edit');
  const [teams, people] = await Promise.all([api.list('teams', { order: 'name' }), api.list('profiles', { order: 'full_name' })]);
  const active = people.filter((p) => p.active);
  const managers = active.filter((p) => p.role === 'assistant_manager');
  const membersOf = (teamId) => active.filter((p) => p.team_id === teamId);
  const unassigned = active.filter((p) => !p.team_id && ['employee', 'manager'].includes(p.role));
  const teamName = (id) => teams.find((t) => t.id === id)?.name;
  const managerName = (id) => people.find((p) => p.id === id)?.full_name;
  // The reporting chain: the team's assistant manager (teams.manager_id), and the manager above that person.
  // Same rules as the supervisors' "My Profile" (lib/hierarchy.js): inactive people and wrong roles are skipped.
  const bossName = (team) => chainOf({ role: 'supervisor', team_id: team.id, active: true }, people, teams)
    .find((c) => c.relation === 'manager')?.full_name;
  const asstLabel = roleLabel('assistant_manager');
  const bossLabel = roleLabel('manager');

  function nameDialog(team) {
    const input = h('input', { type: 'text', value: team?.name || '' });
    // Every team belongs to one assistant manager; without one, only the admin can see its members.
    const owner = select(
      [{ value: '', label: isAr ? '— بدون مسؤول —' : `— No ${asstLabel} —` }, ...managers.map((m) => ({ value: m.id, label: m.full_name }))],
      team?.manager_id || '',
    );
    modal({
      title: team ? (isAr ? 'تعديل الفريق' : 'Edit Team') : (isAr ? 'فريق جديد' : 'New Team'),
      body: h('div', {},
        field(isAr ? 'اسم الفريق' : 'Team Name', input),
        field(isAr ? `المسؤول عن الفريق (${asstLabel})` : `${asstLabel} in charge`, owner),
        h('p', { class: 'muted' }, isAr
          ? `يشوف المسؤول كل فرقه ومشرفيها وموظفيها، ويشوف مشرفو الفريق اسمه في «حسابي». وتحديد المدير الذي يتبعه يتم من صفحة الموظفين، بتعديل بياناته.`
          : `The ${asstLabel} in charge sees every team they own, with its supervisors and employees, and the team's supervisors see their name on their profile. To set the ${bossLabel} above them, edit that person on the Employees page.`)),
      buttons: [
        {
          label: isAr ? 'حفظ' : 'Save', kind: 'primary',
          onClick: async () => {
            const name = input.value.trim();
            if (!name) throw new Error(isAr ? 'أدخل اسم الفريق.' : 'Enter a team name.');
            const changes = { name, manager_id: owner.value || null };
            await api.save('teams', team ? { id: team.id, ...changes } : changes);
            refresh();
          },
        },
        { label: isAr ? 'إلغاء' : 'Cancel', kind: 'ghost' },
      ],
    });
  }

  // Tick people to put them in (or move them to) this team, all in one go.
  function addDialog(team) {
    const candidates = active.filter((p) => p.team_id !== team.id);
    const boxes = new Map(candidates.map((p) => [p.id, h('input', { type: 'checkbox' })]));
    const search = h('input', { type: 'text', placeholder: isAr ? 'ابحث بالاسم...' : 'Search by name...' });
    const list = h('div', { class: 'checklist' }, candidates.map((p) => h('label', { class: 'check', 'data-name': p.full_name },
      boxes.get(p.id), p.full_name, p.job_title && h('small', { class: 'muted' }, ` · ${p.job_title}`),
      p.team_id && h('small', { class: 'muted' }, ` · ${isAr ? 'حاليًا في' : 'Currently in'} ${teamName(p.team_id)}`))));
    search.addEventListener('input', () => {
      for (const row of list.children) row.hidden = !row.dataset.name.includes(search.value.trim());
    });
    modal({
      title: `${isAr ? 'إضافة موظفين إلى' : 'Add Employees to'} ${team.name}`,
      body: h('div', {}, search, candidates.length ? list : h('p', { class: 'empty' }, isAr ? 'جميع الموظفين موجودون في هذا الفريق بالفعل.' : 'All employees are already on this team.')),
      buttons: [
        {
          label: isAr ? 'إضافة المحدّدين' : 'Add Selected', kind: 'primary',
          onClick: async () => {
            const chosen = candidates.filter((p) => boxes.get(p.id).checked);
            if (!chosen.length) throw new Error(isAr ? 'اختر موظفًا واحدًا على الأقل.' : 'Select at least one employee.');
            await Promise.all(chosen.map((p) => api.save('profiles', { id: p.id, team_id: team.id })));
            toast(isAr ? `أُضيف ${chosen.length} موظفًا إلى الفريق.` : `Added ${chosen.length} employees to the team.`);
            refresh();
          },
        },
        { label: isAr ? 'إلغاء' : 'Cancel', kind: 'ghost' },
      ],
    });
  }

  const teamCard = (team) => h('div', { class: 'card' },
    h('div', { class: 'row spread' },
      h('h3', {}, `${team.name} (${membersOf(team.id).length})`),
      canEdit && h('div', { class: 'row' },
        btn(isAr ? 'إضافة موظفين' : 'Add Employees', () => addDialog(team), 'small primary'),
        btn(isAr ? 'تعديل الفريق' : 'Edit Team', () => nameDialog(team), 'small'),
        btn(isAr ? 'حذف الفريق' : 'Delete Team', async () => {
          if (!await confirmBox(isAr ? `هل تريد حذف الفريق «${team.name}»؟ سيبقى أعضاؤه دون فريق.` : `Delete team "${team.name}"? Its members will become unassigned.`, isAr ? 'حذف' : 'Delete')) return;
          await api.remove('teams', team.id);
          refresh();
        }, 'small'))),
    h('p', { class: 'muted' }, team.manager_id
      ? [isAr ? `المسؤول عن الفريق (${asstLabel}): ${managerName(team.manager_id) || '—'}` : `${asstLabel} in charge: ${managerName(team.manager_id) || '—'}`,
        ` · ${bossLabel}: ${bossName(team) || '—'}`].join('')
      : (isAr ? `لا يوجد مسؤول (${asstLabel}) لهذا الفريق بعد. عيّن واحدًا من «تعديل الفريق».` : `No ${asstLabel} is in charge of this team yet. Assign one from "Edit Team".`)),
    membersOf(team.id).length
      ? h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, membersOf(team.id).map((p) => h('tr', {},
        h('td', {}, p.full_name),
        h('td', {}, p.job_title || '—'),
        h('td', {}, p.role === 'employee' ? badge(roleLabel(p.role)) : badge(roleLabel(p.role), 'ok')),
        h('td', {}, canEdit && btn(isAr ? 'شيل من الفريق' : 'Remove from Team', async () => {
          await api.save('profiles', { id: p.id, team_id: null });
          refresh();
        }, 'small')))))))
      : h('p', { class: 'empty' }, isAr ? 'هذا الفريق فارغ.' : 'This team is empty.'));

  return h('div', {},
    h('div', { class: 'card' },
      h('p', { class: 'muted' }, isAr
        ? `الهيكل: موظف ← مشرف ← ${asstLabel} ← ${bossLabel}. لكل فريق مسؤول واحد (${asstLabel})، وقد يكون مسؤولًا عن عدة فرق. ويضم كل فريق مشرفًا أو أكثر وموظفين. في إعدادات الصلاحيات يشير نطاق «الفريق» للمسؤول إلى كل فرقه، وللمشرف إلى موظفي فريقه فقط (دون المشرفين الآخرين معه).`
        : `Structure: employee → supervisor → ${asstLabel} → ${bossLabel}. Each team has one ${asstLabel} in charge, who may own several teams. A team can have any number of supervisors and employees. In the permission matrix, the "team" scope means every team an ${asstLabel} owns, and for a supervisor it means the employees of their own team only (not their co-supervisors).`),
      canEdit && btn(isAr ? 'إنشاء فريق' : 'Create Team', () => nameDialog(null), 'primary')),
    ...teams.map(teamCard),
    unassigned.length > 0 && h('div', { class: 'card' },
      h('h3', {}, isAr ? `موظفون غير منتمين إلى فريق (${unassigned.length})` : `Employees not assigned to a team (${unassigned.length})`),
      h('p', { class: 'muted' }, unassigned.map((p) => p.full_name).join('، '))),
  );
}
