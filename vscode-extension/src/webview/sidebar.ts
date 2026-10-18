import type { LibrarySkillVM, Ref, RepoVM, SearchResultVM, SidebarInbound, SidebarOutbound, SidebarState, SidebarTab, WorkspaceSkillVM } from '../shared/protocol';
import { byId, html, Html, icon, menuContext, onClick, plural, render, statusBadge, vscodeApi } from './common';

type Chip = 'all' | 'applied' | 'update';
type Search = { status: 'idle' } | { status: 'busy'; query: string } | { status: 'done'; query: string; results: SearchResultVM[] } | { status: 'error'; query: string; message: string };

interface Saved {
  tab: SidebarTab;
  filter: string;
  chip: Chip;
  query: string;
  search: Search;
}

const SKILL_MIME = 'application/vnd.skillhub.skills';
const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'repo', label: 'This repo' },
  { id: 'library', label: 'Library' },
  { id: 'discover', label: 'Discover' },
];
const GROUPS: { id: WorkspaceSkillVM['group']; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'applied', label: 'Applied' },
  { id: 'untracked', label: 'Found, not tracked' },
];

const vscode = vscodeApi<Saved>();
const saved: Saved = { tab: 'repo', filter: '', chip: 'all', query: '', search: { status: 'idle' }, ...vscode.getState() };
// A search that was running when the view was hidden can't report back to this page.
if (saved.search.status === 'busy') saved.search = { status: 'idle' };
let state: SidebarState | undefined;

const post = (message: SidebarOutbound) => vscode.postMessage(message);
const save = () => vscode.setState(saved);

// ------------------------------------------------------------------ Layout (rendered once)

byId('app').innerHTML = html`
  <div role="tablist" class="sh-segmented sb-tabs" aria-label="Skill Hub">
    ${TABS.map((t) => html`<button role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="panel-${t.id}">${t.label}</button>`)}
  </div>
  <section id="panel-repo" class="sb-panel" role="tabpanel" aria-labelledby="tab-repo" tabindex="-1">
    <div id="repo" class="sb-scroll"></div>
    <div id="dropzone" class="sb-drop" aria-hidden="true">Drop skills from Library here to apply</div>
  </section>
  <section id="panel-library" class="sb-panel" role="tabpanel" aria-labelledby="tab-library" tabindex="-1">
    <div class="sb-tools">
      <label class="sb-field">
        ${icon('filter')}
        <span class="sr-only">Filter library</span>
        <input id="filter" type="search" placeholder="Filter library" autocomplete="off" spellcheck="false">
      </label>
      <div id="chips" class="sb-chips" role="group" aria-label="Show"></div>
    </div>
    <div id="library" class="sb-scroll" role="list" aria-label="Skills in your hub"></div>
    <div class="sb-legend" aria-hidden="true"><span><span class="sb-dot sb-dot--on"></span> applied here</span><span><span class="sb-dot"></span> not applied</span></div>
  </section>
  <section id="panel-discover" class="sb-panel" role="tabpanel" aria-labelledby="tab-discover" tabindex="-1">
    <form id="search-form" class="sb-tools" role="search">
      <label class="sb-field">
        ${icon('search')}
        <span class="sr-only">Search GitHub for skills</span>
        <input id="query" type="search" placeholder="Search GitHub for skills" autocomplete="off" spellcheck="false">
      </label>
    </form>
    <div id="discover" class="sb-scroll" aria-live="polite"></div>
  </section>`.value;

const filterInput = byId<HTMLInputElement>('filter');
const queryInput = byId<HTMLInputElement>('query');
filterInput.value = saved.filter;
queryInput.value = saved.query;

// ------------------------------------------------------------------ Tabs

function showTab(tab: SidebarTab, focus = false): void {
  saved.tab = tab;
  save();
  for (const t of TABS) {
    const button = byId(`tab-${t.id}`);
    const selected = t.id === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    byId(`panel-${t.id}`).hidden = !selected;
  }
  if (focus) (tab === 'library' ? filterInput : tab === 'discover' ? queryInput : byId(`tab-${tab}`)).focus();
}

onClick(document, '[data-tab]', (el) => showTab(el.dataset.tab as SidebarTab));
document.querySelector('[role=tablist]')!.addEventListener('keydown', (event) => {
  const e = event as KeyboardEvent;
  const index = TABS.findIndex((t) => t.id === saved.tab);
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const tab = TABS[(next + TABS.length) % TABS.length].id;
  showTab(tab);
  byId(`tab-${tab}`).focus();
});

// ------------------------------------------------------------------ This repo

function renderRepo(): void {
  const el = byId('repo');
  const repo = state?.repo;
  byId('dropzone').hidden = !repo;
  if (!state) return;
  if (!repo) {
    render(
      el,
      html`<div class="sb-empty">
        <p>Open a folder to apply skills to it.</p>
        <button class="sh-btn sh-btn--primary" data-command="workbench.action.files.openFolder" data-focus="open-folder">Open Folder</button>
      </div>`,
    );
    return;
  }
  const groups = GROUPS.map((g) => ({ ...g, skills: repo.skills.filter((s) => s.group === g.id) })).filter((g) => g.skills.length);
  render(
    el,
    html`${repoCard(repo)}
      ${repo.error && html`<p class="sb-error" role="alert">${icon('error')} ${repo.error}</p>`}
      ${groups.map(
        (g) => html`<section class="sb-group" aria-labelledby="group-${g.id}">
          <h2 class="sh-label sb-group__label" id="group-${g.id}">${g.label}</h2>
          <div role="list">${g.skills.map((s) => workspaceRow(repo, s))}</div>
        </section>`,
      )}
      ${!repo.skills.length &&
      !repo.error &&
      html`<div class="sb-empty">
        <p>No skills in ${repo.name} yet.</p>
        <div class="sb-empty__actions">
          <button class="sh-btn" data-tab="library" data-focus="browse">Browse library</button>
          <button class="sh-btn sh-btn--primary" data-command="skillHub.addSkill" data-focus="add">Add skills</button>
        </div>
      </div>`}`,
  );
}

function repoCard(repo: RepoVM): Html {
  const folders = state!.folders;
  const name =
    folders.length > 1
      ? html`<label class="sb-repo__pick">
          <span class="sr-only">Workspace folder</span>
          <select id="folder" data-focus="folder">
            ${folders.map((f) => html`<option value="${f.root}" ${f.root === repo.root ? html`selected` : ''}>${f.name}</option>`)}
          </select>
          ${icon('chevron-down')}
        </label>`
      : html`<span class="sb-repo__name">${repo.name}</span>`;
  return html`<div class="sh-card sb-repo" data-vscode-context="${menuContext({ webviewSection: 'repo', refKind: 'folder', refRoot: repo.root })}">
    <div class="sb-repo__head">
      ${icon('folder')} ${name}
      <span class="sb-repo__lock sh-mono" title="${repo.hasLock ? 'skill-hub.lock.json is present' : 'No skill-hub.lock.json yet'}">${repo.hasLock ? 'lock ✓' : 'no lock'}</span>
    </div>
    ${repo.summary && html`<div class="sb-repo__summary">${repo.summary}</div>`}
    <ul class="sb-repo__targets" aria-label="Targets used in this repo">
      ${repo.targets.map(
        (t) =>
          html`<li class="sh-chip ${t.on ? 'sh-chip--on' : 'sh-chip--off'}" title="${t.on ? `Skills are installed for ${t.label}` : `No skills installed for ${t.label}`}">
            <span aria-hidden="true">${t.on ? '●' : '○'}</span> ${t.label}<span class="sr-only">${t.on ? ', in use' : ', not used'}</span>
          </li>`,
      )}
    </ul>
  </div>`;
}

function workspaceRow(repo: RepoVM, skill: WorkspaceSkillVM): Html {
  const ref: Ref = { refKind: 'workspace', refRoot: repo.root, refId: skill.id };
  const selected = state!.selected?.id === skill.id && state!.selected?.root === repo.root;
  const context = menuContext({ webviewSection: 'workspaceSkill', skillHubFlags: skill.flags, ...ref });
  return html`<div class="sh-row sb-row" role="listitem" ${selected && html`aria-current="true"`} data-vscode-context="${context}">
    <button class="sb-row__main" data-open="${JSON.stringify(ref)}" data-focus="ws:${skill.id}" title="${skill.description}">
      ${statusBadge(skill.status)}
      <span class="sb-row__text">
        <span class="sh-row__name">${skill.name}</span>
        <span class="sh-row__meta">${skill.meta}</span>
      </span>
    </button>
    ${skill.action &&
    html`<button class="sh-btn sh-btn--sm" data-command="${skill.action.command}" data-ref="${JSON.stringify(ref)}" data-focus="ws-action:${skill.id}"
      aria-label="${skill.action.label}: ${skill.name}">${skill.action.label}</button>`}
  </div>`;
}

// ------------------------------------------------------------------ Library

function renderLibrary(): void {
  if (!state) return;
  const chips: { id: Chip; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'applied', label: 'Applied here' },
    { id: 'update', label: 'Has update' },
  ];
  render(
    byId('chips'),
    html`${chips.map(
      (c) => html`<button class="sb-pill" aria-pressed="${saved.chip === c.id}" data-chip="${c.id}" data-focus="chip:${c.id}">${c.label}</button>`,
    )}`,
  );

  const el = byId('library');
  if (state.libraryError) {
    render(el, html`<p class="sb-error" role="alert">${icon('error')} ${state.libraryError}</p>`);
    return;
  }
  if (!state.library.length) {
    render(
      el,
      html`<div class="sb-empty">
        <p>Your hub is empty. Add skills from GitHub, any git repository, a link to a markdown file, or a local folder.</p>
        <div class="sb-empty__actions">
          <button class="sh-btn sh-btn--primary" data-command="skillHub.addSkill" data-focus="add">Add skills</button>
          <button class="sh-btn" data-tab="discover" data-focus="discover">Search GitHub</button>
          <button class="sh-btn" data-command="skillHub.createSkill" data-focus="create">Create new skill</button>
        </div>
      </div>`,
    );
    return;
  }

  const words = saved.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = state.library.filter(
    (s) =>
      (saved.chip === 'all' || (saved.chip === 'applied' ? s.appliedHere : s.hasUpdate)) &&
      words.every((w) => `${s.name} ${s.description} ${s.sourceLabel}`.toLowerCase().includes(w)),
  );
  if (!visible.length) {
    render(el, html`<p class="sb-note">No skills match.</p>`);
    return;
  }
  const groups = new Map<string, LibrarySkillVM[]>();
  for (const skill of visible) {
    const k = `${skill.sourceBadge}\0${skill.sourceLabel}`;
    groups.set(k, [...(groups.get(k) ?? []), skill]);
  }
  const applyLabel = state.repo ? `Apply to ${state.repo.name}` : 'Apply';
  render(
    el,
    html`${[...groups.values()].map(
      (skills) => html`<div class="sb-source" role="presentation">
          <span class="sb-badge sh-mono">${skills[0].sourceBadge}</span><span class="sb-source__label">${skills[0].sourceLabel}</span>
        </div>
        ${skills.map((s) => libraryRow(s, applyLabel))}`,
    )}`,
  );
}

function libraryRow(skill: LibrarySkillVM, applyLabel: string): Html {
  const ref: Ref = { refKind: 'library', refId: skill.id };
  const selected = state!.selected?.id === skill.id;
  const context = menuContext({ webviewSection: 'librarySkill', skillHubFlags: skill.flags, ...ref });
  const where = skill.appliedHere ? 'applied here' : 'not applied here';
  return html`<div class="sh-row sb-row" role="listitem" ${selected && html`aria-current="true"`} draggable="true" data-drag="${skill.id}" data-vscode-context="${context}">
    <button class="sb-row__main" data-open="${JSON.stringify(ref)}" data-focus="lib:${skill.id}" title="${skill.description}">
      <span class="sb-dot ${skill.appliedHere ? 'sb-dot--on' : ''}" role="img" aria-label="${where}"></span>
      <span class="sh-row__name sb-row__grow">${skill.name}</span>
      ${skill.hasUpdate && html`<span class="sb-row__flag">↑ update</span>`}
    </button>
    ${state!.repo &&
    html`<button class="sh-btn sh-btn--sm sb-iconbtn" data-apply="${skill.id}" data-focus="apply:${skill.id}" aria-label="${applyLabel}: ${skill.name}" title="${applyLabel}">
      ${icon('arrow-right')}
    </button>`}
  </div>`;
}

onClick(byId('chips'), '[data-chip]', (el) => {
  saved.chip = el.dataset.chip as Chip;
  save();
  renderLibrary();
});
filterInput.addEventListener('input', () => {
  saved.filter = filterInput.value;
  save();
  renderLibrary();
});

// ------------------------------------------------------------------ Discover

function renderDiscover(): void {
  const el = byId('discover');
  const search = saved.search;
  const inHub = new Set(state?.library.map((s) => s.id));
  if (search.status === 'idle') {
    render(
      el,
      html`<div class="sb-empty">
        <p>Find skills by keyword across public GitHub repositories. GitHub asks you to sign in for code search.</p>
        <p class="sb-note">Have a link or a local folder? <button class="sb-link" data-command="skillHub.addSkill" data-focus="add">Add skills…</button></p>
      </div>`,
    );
  } else if (search.status === 'busy') {
    render(el, html`<p class="sb-note">${icon('loading', 'codicon-modifier-spin')} Searching GitHub for “${search.query}”…</p>`);
  } else if (search.status === 'error') {
    render(el, html`<p class="sb-error" role="alert">${icon('error')} ${search.message}</p>`);
  } else if (!search.results.length) {
    render(el, html`<p class="sb-note">No skills on GitHub match “${search.query}”.</p>`);
  } else {
    render(
      el,
      html`<h2 class="sh-label sb-group__label">${plural(search.results.length, 'result')} for “${search.query}”</h2>
        <div role="list">
          ${search.results.map(
            (r, i) => html`<div class="sb-result" role="listitem">
              <div class="sb-result__text">
                <a class="sh-row__name" href="${r.url}" title="Open on GitHub">${r.name}</a>
                <span class="sb-result__where sh-mono">${r.owner}/${r.repo}${r.path ? `/${r.path}` : ''}</span>
                ${r.description && html`<span class="sb-result__desc">${r.description}</span>`}
              </div>
              ${inHub.has(r.id)
                ? html`<span class="sb-tag">In hub</span>`
                : html`<button class="sh-btn sh-btn--sm" data-add-result="${i}" data-focus="result:${i}" aria-label="Add ${r.name} to your hub">Add</button>`}
            </div>`,
          )}
        </div>`,
    );
  }
}

byId('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (query) post({ type: 'search', query });
});
queryInput.addEventListener('input', () => {
  saved.query = queryInput.value;
  save();
});
onClick(byId('discover'), '[data-add-result]', (el) => {
  const search = saved.search;
  if (search.status !== 'done') return;
  const result = search.results[Number(el.dataset.addResult)];
  if (result) post({ type: 'addSearchResult', result });
});

// ------------------------------------------------------------------ Shared row actions

onClick(document, '[data-open]', (el) => post({ type: 'open', ref: JSON.parse(el.dataset.open!) as Ref }));
onClick(document, '[data-command]', (el) =>
  post({ type: 'command', id: el.dataset.command!, ref: el.dataset.ref ? (JSON.parse(el.dataset.ref) as Ref) : undefined }),
);
onClick(document, '[data-apply]', (el) => post({ type: 'apply', ids: [el.dataset.apply!] }));
document.addEventListener('change', (event) => {
  const target = event.target as HTMLElement;
  if (target.id === 'folder') post({ type: 'selectFolder', root: (target as HTMLSelectElement).value });
});

// ------------------------------------------------------------------ Drag and drop

let switchTimer: number | undefined;
document.addEventListener('dragstart', (event) => {
  const row = (event.target as Element).closest<HTMLElement>('[data-drag]');
  if (!row || !event.dataTransfer) return;
  event.dataTransfer.setData(SKILL_MIME, JSON.stringify([row.dataset.drag]));
  event.dataTransfer.setData('text/plain', row.dataset.drag!);
  event.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('is-dragging');
});
document.addEventListener('dragend', () => document.body.classList.remove('is-dragging', 'is-over'));

// Hovering the "This repo" tab while dragging a skill switches to it, so the drop zone is reachable.
const repoTab = byId('tab-repo');
repoTab.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes(SKILL_MIME)) return;
  clearTimeout(switchTimer);
  switchTimer = window.setTimeout(() => showTab('repo'), 350);
});
repoTab.addEventListener('dragleave', () => clearTimeout(switchTimer));
repoTab.addEventListener('dragover', (event) => event.preventDefault());

const repoPanel = byId('panel-repo');
repoPanel.addEventListener('dragover', (event) => {
  if (!state?.repo || !event.dataTransfer?.types.includes(SKILL_MIME)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('is-over');
});
repoPanel.addEventListener('dragleave', (event) => {
  if (!repoPanel.contains(event.relatedTarget as Node | null)) document.body.classList.remove('is-over');
});
repoPanel.addEventListener('drop', (event) => {
  const raw = event.dataTransfer?.getData(SKILL_MIME);
  document.body.classList.remove('is-dragging', 'is-over');
  if (!raw) return;
  event.preventDefault();
  post({ type: 'apply', ids: JSON.parse(raw) as string[] });
});

// Folders and markdown files dropped from the Explorer (hold Shift) are added to the hub.
const libraryPanel = byId('panel-library');
libraryPanel.addEventListener('dragover', (event) => {
  const types = event.dataTransfer?.types ?? [];
  if (types.includes('text/uri-list') && !types.includes(SKILL_MIME)) event.preventDefault();
});
libraryPanel.addEventListener('drop', (event) => {
  const list = event.dataTransfer?.getData('text/uri-list');
  if (!list) return;
  event.preventDefault();
  const uris = list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (uris.length) post({ type: 'addPaths', uris });
});

// ------------------------------------------------------------------ Messages

window.addEventListener('message', (event: MessageEvent<SidebarInbound>) => {
  const message = event.data;
  switch (message.type) {
    case 'state':
      state = message.state;
      renderRepo();
      renderLibrary();
      renderDiscover();
      return;
    case 'showTab':
      showTab(message.tab, message.focus);
      return;
    case 'searchStarted':
      saved.search = { status: 'busy', query: message.query };
      break;
    case 'searchResults':
      saved.search = { status: 'done', query: message.query, results: message.results };
      break;
    case 'searchError':
      saved.search = { status: 'error', query: message.query, message: message.message };
      break;
  }
  save();
  renderDiscover();
});

showTab(saved.tab);
renderDiscover();
post({ type: 'ready' });
