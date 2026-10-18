/** Library: every skill in the hub as a grid or list, with the inspector on the right (mockup 03, DESIGN.md §4.2). */
import type { AppState, HubSkillVM } from '../../shared/api';
import { openAddDialog, openApplyDialog, openReviewDialog } from '../dialogs';
import { attempt, attr, call, confirmDialog, html, Html, plural, relativeTime, statusText, svg, toast } from '../dom';
import { go, LibraryFilter, on, rerender, store, ui } from '../state';

const FILTERS: { id: LibraryFilter; label: string; test: (s: HubSkillVM) => boolean }[] = [
  { id: 'all', label: 'All sources', test: () => true },
  { id: 'github', label: 'GitHub', test: (s) => s.source.type === 'github' },
  { id: 'local', label: 'Local', test: (s) => s.source.type === 'local' || s.source.type === 'created' },
  { id: 'update', label: 'Has update', test: (s) => s.check?.state === 'newer' },
  { id: 'unused', label: 'Unused', test: (s) => s.usedIn.length === 0 },
];

function matchesQuery(s: HubSkillVM, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [s.name, s.description, s.source.label, s.source.text].some((text) => text.toLowerCase().includes(q));
}

export function visibleSkills(app: AppState): HubSkillVM[] {
  const filter = FILTERS.find((f) => f.id === ui.filter) ?? FILTERS[0];
  return app.skills.filter((s) => filter.test(s) && matchesQuery(s, ui.query));
}

/** The selected skill, falling back to the first visible one so the inspector is never empty when there are skills. */
export function selectedSkill(app: AppState): HubSkillVM | undefined {
  const visible = visibleSkills(app);
  return visible.find((s) => s.id === ui.selectedSkill) ?? visible[0];
}

function usedLabel(s: HubSkillVM): string {
  return s.usedIn.length ? plural(s.usedIn.length, 'project') : 'Unused';
}

export function libraryMain(app: AppState): Html {
  const sources = new Set(app.skills.map((s) => `${s.source.type}:${s.source.label}`)).size;
  const view = app.settings.libraryView;
  const visible = visibleSkills(app);
  const selected = selectedSkill(app);

  const head = html`<div class="page-head">
    <div>
      <h1 tabindex="-1">Library</h1>
      <p>${plural(app.skills.length, 'skill')} from ${plural(sources, 'source')} · stored in <span class="mono">${app.libraryDisplay}</span></p>
    </div>
    <div class="toggle" role="group" aria-label="Layout">
      <button data-act="library-view" data-view="grid" aria-pressed="${view === 'grid'}" aria-label="Grid view" data-focus="view-grid">${svg('grid')}</button>
      <button data-act="library-view" data-view="list" aria-pressed="${view === 'list'}" aria-label="List view" data-focus="view-list">${svg('list')}</button>
    </div>
  </div>`;

  if (app.libraryError) return html`${head}<div class="notice notice--error"><h3>Couldn't read your hub</h3><p>${app.libraryError}</p></div>`;
  if (!app.skills.length) {
    return html`${head}<div class="empty">
      <h2>Your hub is empty</h2>
      <p>Add skills from GitHub, any git repository, a link to a markdown file, or a folder.</p>
      <div class="empty__actions">
        <button class="sh-btn sh-btn--primary" data-act="add-skill">+ Add skill</button>
        <button class="sh-btn" data-act="go" data-view="discover">Search GitHub</button>
        <button class="sh-btn" data-act="create-skill">Create new skill</button>
      </div>
    </div>`;
  }

  const pills = html`<div class="pills" role="group" aria-label="Show">
    ${FILTERS.map((f) => {
      const n = app.skills.filter((s) => f.test(s) && matchesQuery(s, ui.query)).length;
      return html`<button class="pill" data-act="library-filter" data-filter="${f.id}" aria-pressed="${ui.filter === f.id}" data-focus="filter-${f.id}">
        ${f.label}${f.id !== 'all' && n ? html` <span class="pill__count">${n}</span>` : ''}
      </button>`;
    })}
    ${ui.query && html`<button class="pill pill--query" data-act="clear-query" aria-label="Clear filter ${ui.query}" data-focus="clear-query">“${ui.query}” ${svg('close')}</button>`}
  </div>`;

  if (!visible.length) {
    return html`${head}${pills}<div class="empty"><h2>No skills match</h2><p>${ui.filter === 'update' ? 'Use Sync all to check every source for newer versions.' : 'Try another filter.'}</p></div>`;
  }

  const body =
    view === 'list'
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Name</th><th scope="col">Description</th><th scope="col">Source</th><th scope="col">Used in</th></tr></thead>
          <tbody>${visible.map(
            (s) => html`<tr data-act="select-skill" data-id="${s.id}" aria-selected="${s.id === selected?.id}">
              <td><button class="link-btn mono" data-act="select-skill" data-id="${s.id}" data-focus="row-${s.id}">${s.name}</button>
                ${s.check?.state === 'newer' && html` <span class="tag tag--update">↑ Update</span>`}</td>
              <td class="desc" title="${s.description}">${s.description}</td>
              <td class="mono faint">${s.source.label}</td>
              <td class="faint">${usedLabel(s)}</td>
            </tr>`,
          )}</tbody>
        </table></div>`
      : html`<div class="cards">${visible.map(
          (s) => html`<button class="skill-card" data-act="select-skill" data-id="${s.id}" aria-pressed="${s.id === selected?.id}" data-focus="card-${s.id}">
            <span class="skill-card__top">
              <span class="skill-card__name">${s.name}</span>
              ${s.check?.state === 'newer' && html`<span class="tag tag--update">↑ Update</span>`}
            </span>
            <span class="skill-card__desc">${s.description || 'No description.'}</span>
            <span class="skill-card__foot"><span class="mono">${s.source.label}</span><span>${usedLabel(s)}</span></span>
          </button>`,
        )}</div>`;

  return html`${head}${pills}${body}`;
}

export function libraryInspector(app: AppState): Html | undefined {
  const s = selectedSkill(app);
  if (!s) return undefined;
  const check = s.check;
  const projects = s.usedIn.length;

  let sourceState: Html | string = '';
  if (check?.state === 'checking') sourceState = html`<p class="insp__check"><span class="spinner"></span> Checking the source…</p>`;
  else if (check?.state === 'newer') {
    const n = check.changes.length;
    sourceState = html`<div class="notice" role="status">
      <h3>Newer version at source</h3>
      <p>${plural(n, 'file')} changed. ${projects ? `Updating the hub flags ${projects === 1 ? 'the 1 project' : `all ${projects} projects`} that use it.` : 'No projects use it yet.'}</p>
      <div class="notice__actions">
        <button class="sh-btn sh-btn--info" data-act="review" data-id="${s.id}">Review changes</button>
        <button class="sh-btn" data-act="update-source" data-id="${s.id}">Update</button>
      </div>
    </div>`;
  } else if (check?.state === 'error') {
    sourceState = html`<div class="notice notice--error" role="status">
      <h3>Couldn't check the source</h3><p>${check.message}</p>
      <div class="notice__actions"><button class="sh-btn" data-act="check-source" data-id="${s.id}">Try again</button></div>
    </div>`;
  } else if (check?.state === 'current') {
    sourceState = html`<p class="insp__check"><span class="st st--synced">✓</span> Matches its source · checked ${relativeTime(check.checkedAt)}</p>`;
  } else if (s.canUpdate) {
    sourceState = html`<p class="insp__check">Source not checked yet · <button class="link-btn" data-act="check-source" data-id="${s.id}">Check now</button></p>`;
  }

  return html`<div>
      <h2 class="insp__name">${s.name}</h2>
      <p class="insp__meta">${s.source.kind}${s.source.type !== 'created' ? ' · ' : ''}${
        s.source.type === 'created'
          ? ''
          : s.source.url
            ? html`<a href="${s.source.url}" data-act="open-url" data-url="${s.source.url}">${s.source.label}</a>`
            : html`<span class="mono">${s.source.label}</span>`
      }${s.source.subPath ? ` · ${s.source.subPath}` : ''}</p>
    </div>
    ${sourceState}
    <p class="insp__desc">${s.description || 'No description.'}</p>
    <section class="insp__section" aria-labelledby="used-in">
      <h3 class="sh-label" id="used-in">Used in</h3>
      ${s.usedIn.length
        ? s.usedIn.map(
            (u) => html`<button class="usage" data-act="open-cell" data-root="${u.root}" data-id="${s.id}">
              <span><span class="usage__name">${u.project}</span><span class="usage__targets">${u.targets.join(' · ')}</span></span>
              ${statusText(u.status)}
            </button>`,
          )
        : html`<p class="insp__hint">Not applied to any project yet.</p>`}
    </section>
    <div class="insp__foot">
      <button class="sh-btn sh-btn--primary sh-btn--block" data-act="apply-dialog" data-id="${s.id}">Apply to projects…</button>
      <div class="insp__row">
        <button class="sh-btn" data-act="edit-skill" data-path="${s.skillFile ?? s.dir}">Edit</button>
        <button class="sh-btn" data-act="open-folder" data-path="${s.dir}">Open in VS Code</button>
      </div>
      <div class="insp__links">
        <button data-act="reveal" data-path="${s.skillFile ?? s.dir}">Show in folder</button>
        ${s.canUpdate && check?.state !== 'checking' && html`<button data-act="check-source" data-id="${s.id}">Check source</button>`}
        <button class="danger" data-act="delete-skill" data-id="${s.id}">Remove from hub</button>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ Actions

on('select-skill', (el) => {
  ui.selectedSkill = attr(el, 'data-id');
  rerender();
});
on('library-filter', (el) => {
  ui.filter = attr(el, 'data-filter') as LibraryFilter;
  rerender();
});
on('clear-query', () => {
  ui.query = '';
  rerender();
});
on('library-view', (el) => {
  const view = attr(el, 'data-view') as 'grid' | 'list';
  if (store.app) store.app.settings.libraryView = view;
  rerender();
  void call('saveSettings', { libraryView: view });
});
on('apply-dialog', (el) => openApplyDialog({ skillIds: [attr(el, 'data-id')] }));
on('review', (el) => openReviewDialog(attr(el, 'data-id')));
on('update-source', (el) => void attempt(() => call('updateFromSource', [attr(el, 'data-id')])));
on('check-source', (el) => {
  void attempt(async () => {
    const { newer, failed } = await call('checkSources', [attr(el, 'data-id')]);
    if (!newer.length && !failed) toast('info', `${attr(el, 'data-id')} matches its source.`);
  });
});
on('edit-skill', (el) => void attempt(() => call('openInEditor', attr(el, 'data-path'))));
on('add-skill', () => openAddDialog());
on('delete-skill', (el) => {
  const id = attr(el, 'data-id');
  const skill = store.app?.skills.find((s) => s.id === id);
  void attempt(async () => {
    const ok = await confirmDialog({
      title: `Remove ${id} from your hub?`,
      body: skill?.usedIn.length ? `${plural(skill.usedIn.length, 'project')} that use it keep their copy.` : 'Its folder in the hub is deleted.',
      confirm: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await call('deleteSkill', id);
    ui.selectedSkill = undefined;
  });
});
on('open-cell', (el) => {
  ui.cell = { root: attr(el, 'data-root'), id: attr(el, 'data-id') };
  ui.projectRoot = ui.cell.root;
  const cell = ui.cell;
  go('project', { projectRoot: cell.root });
  ui.cell = cell;
  rerender();
});
