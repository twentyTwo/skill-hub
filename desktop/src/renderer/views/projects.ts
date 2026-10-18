/** Projects: a matrix of project × hub skill, with the state of each (mockup 04, DESIGN.md §4.3). */
import type { AppState, ProjectSkillVM, ProjectVM, SkillStatus } from '../../shared/api';
import { addProjects, quickApply } from '../dialogs';
import { attempt, attr, call, confirmDialog, html, Html, plural, statusCellClass, STATUS, toast } from '../dom';
import { cellPanel } from './cell';
import { go, on, rerender, store, ui } from '../state';

const LEGEND: { status: SkillStatus; label: string }[] = [
  { status: 'synced', label: 'Up to date' },
  { status: 'outdated', label: 'Update available' },
  { status: 'modified', label: 'Edited in project' },
  { status: 'conflict', label: 'Both changed' },
  { status: 'missing', label: 'Files missing' },
];

/** Skills an update from the hub fixes without a decision: what "Update all safe" touches. */
export function isSafeUpdate(s: ProjectSkillVM): boolean {
  return s.status === 'outdated' || s.status === 'missing' || (s.status === 'synced' && s.missing.length > 0);
}

export function projectsMain(app: AppState): Html {
  const head = html`<div class="page-head">
    <div>
      <h1 tabindex="-1">Projects</h1>
      <p>Every repository you've added, and the state of each skill in it, read from each one's <span class="mono">skill-hub.lock.json</span>.</p>
    </div>
    <div class="page-head__actions"><button class="sh-btn" data-act="add-project">+ Add project folder</button></div>
  </div>`;

  if (!app.projects.length) {
    return html`${head}<div class="empty">
      <h2>No projects yet</h2>
      <p>Add the folders of the repositories you work on. Skill Hub shows which skills each one has, and keeps them in step with your hub.</p>
      <div class="empty__actions"><button class="sh-btn sh-btn--primary" data-act="add-project">+ Add project folder</button></div>
    </div>`;
  }

  const all = app.projects.flatMap((p) => p.skills.map((s) => ({ p, s })));
  const safe = all.filter(({ s }) => isSafeUpdate(s));
  const conflicts = all.filter(({ s }) => s.status === 'conflict').length;
  const edits = all.filter(({ s }) => s.status === 'modified').length;
  const projectsWithUpdates = new Set(safe.map(({ p }) => p.root)).size;

  const banner =
    safe.length || conflicts || edits
      ? html`<div class="banner" role="status">
          ${safe.length ? html`<strong>↑ ${plural(safe.length, 'update')} across ${plural(projectsWithUpdates, 'project')}</strong>` : ''}
          ${conflicts ? html`<span>${plural(conflicts, 'conflict')} need${conflicts === 1 ? 's' : ''} a decision</span>` : ''}
          ${edits ? html`<span>${plural(edits, 'local edit')} not in the hub yet</span>` : ''}
          ${safe.length ? html`<button class="sh-btn sh-btn--info" data-act="update-all-safe">Update all safe</button>` : ''}
        </div>`
      : html`<div class="banner banner--ok" role="status"><strong>✓ Every project matches your hub</strong></div>`;

  const columns = app.skills;
  const table = html`<div class="matrix">
    <table>
      <thead><tr>
        <th scope="col">Project</th>
        ${columns.map((s) => html`<th scope="col"><button data-act="show-in-library" data-id="${s.id}" title="${s.description}">${s.name}</button></th>`)}
      </tr></thead>
      <tbody>${app.projects.map((p) => row(p, columns.map((s) => s.id)))}</tbody>
    </table>
  </div>`;

  const legend = html`<div class="legend" aria-hidden="true">
    ${LEGEND.map((l) => html`<span><span class="${statusCellClass(l.status)}">${STATUS[l.status].glyph}</span>${l.label}</span>`)}
    <span><span class="cell cell--none">+</span>Not applied</span>
  </div>`;

  return html`${head}${banner}${columns.length ? html`${table}${legend}` : html`<div class="empty"><h2>Your hub is empty</h2><p>Add skills to apply them to these projects.</p><button class="sh-btn sh-btn--primary" data-act="add-skill">+ Add skill</button></div>`}`;
}

function row(p: ProjectVM, ids: string[]): Html {
  const used = p.targets.filter((t) => t.on).map((t) => t.short);
  const untracked = p.skills.filter((s) => s.status === 'unmanaged' && !ids.includes(s.id)).length;
  const header = html`<th scope="row">
    <button data-act="open-project" data-root="${p.root}" title="${p.root}">
      <span class="matrix__project">${p.name}</span>
      <span class="matrix__targets">${p.exists ? [used.join(' · ') || 'No skills applied', untracked ? `${untracked} untracked` : ''].filter(Boolean).join(' · ') : 'Folder not found'}</span>
    </button>
  </th>`;
  if (p.error) {
    return html`<tr>${header}<td colspan="${ids.length}" class="matrix__error">${p.error}
      <button class="sh-btn sh-btn--sm" data-act="remove-project" data-root="${p.root}">Stop tracking</button></td></tr>`;
  }
  const byId = new Map(p.skills.map((s) => [s.id, s]));
  return html`<tr>${header}${ids.map((id) => html`<td>${cell(p, id, byId.get(id))}</td>`)}</tr>`;
}

function cell(p: ProjectVM, id: string, s: ProjectSkillVM | undefined): Html {
  if (!s) {
    return html`<button class="cell cell--none" data-act="apply-cell" data-root="${p.root}" data-id="${id}" aria-label="Apply ${id} to ${p.name}" title="Apply ${id} to ${p.name}" data-focus="cell-${p.root}-${id}">+</button>`;
  }
  const info = STATUS[s.status];
  const selected = ui.cell?.root === p.root && ui.cell.id === id;
  return html`<button class="${statusCellClass(s.status)}" data-act="select-cell" data-root="${p.root}" data-id="${id}" aria-pressed="${selected}"
    aria-label="${id} in ${p.name}: ${info.label}" title="${info.label}" data-focus="cell-${p.root}-${id}">${info.glyph}</button>`;
}

export function projectsInspector(app: AppState): Html | undefined {
  return cellPanel(app);
}

// ------------------------------------------------------------------ Actions

on('add-project', () => void addProjects());
on('open-project', (el) => go('project', { projectRoot: attr(el, 'data-root') }));
on('select-cell', (el) => {
  const root = attr(el, 'data-root');
  const id = attr(el, 'data-id');
  ui.cell = ui.cell?.root === root && ui.cell.id === id ? undefined : { root, id };
  rerender();
});
on('apply-cell', (el) => {
  const project = store.app?.projects.find((p) => p.root === attr(el, 'data-root'));
  if (project) void quickApply(attr(el, 'data-id'), project);
});
on('update-all-safe', (el) => {
  const root = el.dataset.root;
  void attempt(async () => {
    const n = await call('updateAllSafe', root ? [root] : undefined);
    toast('info', n ? `Updated ${plural(n, 'skill')} from your hub.` : 'Nothing to update.');
  });
});
on('remove-project', (el) => {
  const root = attr(el, 'data-root');
  const name = store.app?.projects.find((p) => p.root === root)?.name ?? root;
  void attempt(async () => {
    if (!(await confirmDialog({ title: `Stop tracking ${name}?`, body: 'It leaves the Projects list. Nothing in the folder changes.', confirm: 'Stop tracking' }))) return;
    await call('removeProject', root);
    if (ui.view === 'project' && ui.projectRoot === root) go('projects');
  });
});
on('show-in-library', (el) => {
  ui.selectedSkill = attr(el, 'data-id');
  ui.filter = 'all';
  ui.query = '';
  go('library');
});
