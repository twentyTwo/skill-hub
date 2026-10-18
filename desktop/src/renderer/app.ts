/** The desktop shell (DESIGN.md §4.1): top bar with global search, left nav with projects, content and inspector. */
import type { AppState, InputKind } from '../shared/api';
import { openAddDialog, openCreateDialog } from './dialogs';
import { attempt, attr, byId, call, html, Html, isMac, onEvent, plural, render, svg, toast } from './dom';
import { dispatch, go, on, setRenderer, store, ui, View } from './state';
import { activityMain } from './views/activity';
import { discoverMain, runSearch } from './views/discover';
import { libraryInspector, libraryMain } from './views/library';
import { projectInspector, projectMain } from './views/project';
import { projectsInspector, projectsMain } from './views/projects';
import { settingsMain } from './views/settings';
import { sourceGroups, sourcesMain } from './views/sources';

const NAV: { id: View; label: string; count?: (app: AppState) => number }[] = [
  { id: 'library', label: 'Library', count: (app) => app.skills.length },
  { id: 'discover', label: 'Discover' },
  { id: 'projects', label: 'Projects', count: (app) => app.projects.length },
  { id: 'sources', label: 'Sources', count: (app) => sourceGroups(app).length },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

const HEALTH_LABEL = { updates: 'Updates available', edits: 'Local edits or conflicts', broken: 'Files missing or folder not found', clean: 'Up to date', empty: 'No skills applied' };

// ------------------------------------------------------------------ Layout (rendered once)

byId('app').innerHTML = html`
  <header class="topbar">
    <div class="brand">${svg('logo')}<span>Skill Hub</span></div>
    <div class="gsearch" id="gsearch">
      <label class="gsearch__box">
        ${svg('search')}
        <span class="sr-only">Search skills, sources and projects, or paste a link</span>
        <input id="gsearch-input" type="search" placeholder="Search skills, sources, projects — or paste a link" autocomplete="off" spellcheck="false"
          role="combobox" aria-expanded="false" aria-controls="gsearch-pop" aria-autocomplete="list">
        <span class="kbd" aria-hidden="true">${isMac() ? '⌘ K' : 'Ctrl K'}</span>
      </label>
      <div class="gsearch__pop" id="gsearch-pop" role="listbox" aria-label="Results" hidden></div>
    </div>
    <div class="top-actions">
      <span class="busy" id="busy" aria-live="polite"></span>
      <button class="sh-btn sh-btn--lg" data-act="sync-all" title="Check every skill's source for a newer version">Sync all</button>
      <button class="sh-btn sh-btn--lg sh-btn--primary" data-act="add-skill">+ Add skill</button>
    </div>
  </header>
  <div class="layout">
    <nav class="nav" id="nav" aria-label="Main"></nav>
    <main class="main" id="main"></main>
    <aside class="inspector" id="inspector" aria-label="Details" hidden></aside>
  </div>
  <div class="toasts" id="toasts"></div>`.value;

const nav = byId('nav');
const main = byId('main');
const inspector = byId('inspector');

// ------------------------------------------------------------------ Rendering

function navHtml(app: AppState): Html {
  return html`<div class="nav__list">
      ${NAV.map((item) => {
        const n = item.count?.(app);
        const current = ui.view === item.id || (item.id === 'projects' && ui.view === 'project');
        return html`<button class="nav__item" data-act="go" data-view="${item.id}" ${current ? 'aria-current="page"' : ''} data-focus="nav-${item.id}">
          <span>${item.label}</span><span class="nav__count">${n || ''}</span>
        </button>`;
      })}
    </div>
    <div class="nav__list">
      <h2 class="sh-label nav__label">Projects</h2>
      ${app.projects.map(
        (p) => html`<button class="nav__item nav__project" data-act="open-project" data-root="${p.root}" title="${p.root}"
          ${ui.view === 'project' && ui.projectRoot === p.root ? 'aria-current="page"' : ''} data-focus="proj-${p.root}">
          <span class="dot dot--${p.health}" role="img" aria-label="${HEALTH_LABEL[p.health]}"></span><span>${p.name}</span>
        </button>`,
      )}
      <button class="nav__add" data-act="add-project">+ Add project folder</button>
    </div>`;
}

function mainHtml(app: AppState): Html {
  switch (ui.view) {
    case 'library':
      return libraryMain(app);
    case 'discover':
      return discoverMain(app);
    case 'projects':
      return projectsMain(app);
    case 'project':
      return projectMain(app);
    case 'sources':
      return sourcesMain(app);
    case 'activity':
      return activityMain(app);
    case 'settings':
      return settingsMain(app);
  }
}

function inspectorHtml(app: AppState): Html | undefined {
  if (ui.view === 'library') return libraryInspector(app);
  if (ui.view === 'projects') return projectsInspector(app);
  if (ui.view === 'project') return projectInspector(app);
  return undefined;
}

/** True while the user is typing in a field in `el`, so a background state update doesn't wipe what they typed. */
function isEditing(el: HTMLElement): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement && el.contains(active) && !['checkbox', 'radio', 'button', 'submit'].includes(active.type)
    ? active.value !== active.defaultValue
    : active instanceof HTMLTextAreaElement && el.contains(active);
}

let deferred = false;

function renderApp(fromState = false): void {
  const app = store.app;
  if (!app) return;
  render(nav, navHtml(app));
  if (fromState && isEditing(main)) deferred = true;
  else {
    deferred = false;
    render(main, mainHtml(app));
  }
  const panel = inspectorHtml(app);
  inspector.hidden = !panel;
  inspector.classList.toggle('inspector--wide', ui.view !== 'library');
  if (panel) render(inspector, panel);

  const busy = byId('busy');
  render(busy, app.busy.length ? html`<span class="spinner" aria-hidden="true"></span><span>${app.busy[0]}${app.busy.length > 1 ? ` (+${app.busy.length - 1})` : ''}</span>` : html``);
}

setRenderer(() => renderApp());
main.addEventListener('focusout', () => {
  if (deferred) setTimeout(() => !isEditing(main) && renderApp(), 0);
});

// ------------------------------------------------------------------ Events from the main process

onEvent((event) => {
  switch (event.type) {
    case 'state':
      store.app = event.state;
      renderApp(true);
      return;
    case 'toast':
      toast(event.kind, event.text, event.action && { label: event.action.label, run: () => runEvent(event.action!.event) });
      return;
    case 'navigate':
      go(event.view as View);
      return;
  }
});

function runEvent(name: string): void {
  if (name.startsWith('navigate:')) go(name.slice('navigate:'.length) as View);
}

// ------------------------------------------------------------------ Clicks

document.addEventListener('click', (event) => {
  const el = (event.target as Element | null)?.closest<HTMLElement>('[data-act]');
  if (!el || el.closest('dialog')) return;
  if (el.tagName === 'A') event.preventDefault();
  dispatch(el, event);
});

on('go', (el) => go(attr(el, 'data-view') as View));
on('open-url', (el) => void attempt(() => call('openExternal', attr(el, 'data-url'))));
on('open-folder', (el) => void attempt(() => call('openFolder', attr(el, 'data-path'))));
on('reveal', (el) => void attempt(() => call('reveal', attr(el, 'data-path'))));
on('create-skill', () => openCreateDialog());
on('sync-all', () => {
  void attempt(async () => {
    const total = store.app?.skills.filter((s) => s.canUpdate).length ?? 0;
    if (!total) {
      toast('info', 'None of your skills have a source to check.');
      return;
    }
    const { newer, failed } = await call('checkSources');
    const failedText = failed ? ` ${plural(failed, 'source')} could not be checked; see Sources.` : '';
    if (newer.length) {
      toast('info', `${newer.length === 1 ? newer[0] : plural(newer.length, 'skill')} ${newer.length === 1 ? 'has' : 'have'} a newer version at the source.${failedText}`, {
        label: 'Update all',
        run: () => void attempt(() => call('updateFromSource', store.app?.skills.filter((s) => s.check?.state === 'newer').map((s) => s.id) ?? [])),
      });
    } else toast(failed ? 'warning' : 'info', `${failed ? 'The rest match' : `All ${plural(total, 'skill')} match`} their sources.${failedText}`);
  });
});

// ------------------------------------------------------------------ Global search

const searchInput = byId<HTMLInputElement>('gsearch-input');
const pop = byId('gsearch-pop');
let items: { label: Html; hint?: string; group: string; run: () => void }[] = [];
let active = 0;
let classifySeq = 0;
let inputKind: InputKind = 'empty';
let inputDetail = '';

const LINK_KINDS: InputKind[] = ['github', 'git', 'url', 'local'];

function buildItems(value: string): void {
  const app = store.app;
  const q = value.trim().toLowerCase();
  items = [];
  if (!app || !q) return;
  if (LINK_KINDS.includes(inputKind)) {
    items.push({ group: 'Add', label: html`Add skills from <span class="mono">${inputDetail || value.trim()}</span>`, run: () => openAddDialog({ value: value.trim(), run: true }) });
  }
  for (const s of app.skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).slice(0, 6)) {
    items.push({
      group: 'Skills',
      label: html`<span class="mono">${s.name}</span>`,
      hint: s.description,
      run: () => {
        ui.selectedSkill = s.id;
        ui.filter = 'all';
        ui.query = '';
        go('library');
      },
    });
  }
  for (const p of app.projects.filter((p) => p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q)).slice(0, 4)) {
    items.push({ group: 'Projects', label: html`${p.name}`, hint: p.root, run: () => go('project', { projectRoot: p.root }) });
  }
  for (const g of sourceGroups(app).filter((g) => g.label.toLowerCase().includes(q)).slice(0, 3)) {
    items.push({ group: 'Sources', label: html`<span class="mono">${g.label}</span>`, hint: plural(g.skills.length, 'skill'), run: () => go('sources') });
  }
  if (!LINK_KINDS.includes(inputKind)) {
    items.push({
      group: 'More',
      label: html`Filter the Library by “${value.trim()}”`,
      run: () => {
        ui.query = value.trim();
        go('library');
      },
    });
    items.push({
      group: 'More',
      label: html`Search GitHub for “${value.trim()}”`,
      run: () => {
        go('discover');
        void runSearch(value);
      },
    });
  }
}

function renderPop(): void {
  const open = items.length > 0 && document.activeElement === searchInput;
  pop.hidden = !open;
  searchInput.setAttribute('aria-expanded', String(open));
  if (!open) return;
  active = Math.min(active, items.length - 1);
  let group = '';
  render(
    pop,
    html`${items.map((item, i) => {
      const heading = item.group !== group ? html`<div class="sh-label gsearch__group" aria-hidden="true">${item.group}</div>` : '';
      group = item.group;
      return html`${heading}<button class="gsearch__item" role="option" id="gs-${i}" aria-selected="${i === active}" data-index="${i}" tabindex="-1">
        <span>${item.label}</span>${item.hint && html`<small>${item.hint}</small>`}
      </button>`;
    })}`,
  );
  searchInput.setAttribute('aria-activedescendant', `gs-${active}`);
}

function closeSearch(clear = false): void {
  if (clear) searchInput.value = '';
  items = [];
  renderPop();
}

function choose(index: number): void {
  const item = items[index];
  if (!item) return;
  closeSearch(true);
  searchInput.blur();
  item.run();
}

searchInput.addEventListener('input', () => {
  const value = searchInput.value;
  active = 0;
  inputKind = value.trim() ? 'search' : 'empty';
  buildItems(value);
  renderPop();
  const seq = ++classifySeq;
  void call('classify', value).then((result) => {
    if (seq !== classifySeq) return;
    inputKind = result.kind;
    inputDetail = result.detail ?? '';
    buildItems(searchInput.value);
    renderPop();
  }, () => undefined);
});

// A pasted link goes straight to the Add flow.
searchInput.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text')?.trim();
  if (!text || searchInput.value.trim()) return;
  void call('classify', text).then((result) => {
    if (!LINK_KINDS.includes(result.kind) || result.kind === 'local') return;
    closeSearch(true);
    searchInput.blur();
    openAddDialog({ value: text, run: true });
  }, () => undefined);
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!items.length) return;
    event.preventDefault();
    active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    renderPop();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(active);
  } else if (event.key === 'Escape') {
    if (searchInput.value) closeSearch(true);
    else searchInput.blur();
  }
});
searchInput.addEventListener('focus', () => {
  buildItems(searchInput.value);
  renderPop();
});
searchInput.addEventListener('blur', () => setTimeout(() => !pop.contains(document.activeElement) && renderPop(), 120));
pop.addEventListener('mousedown', (event) => event.preventDefault());
pop.addEventListener('click', (event) => {
  const el = (event.target as Element).closest<HTMLElement>('[data-index]');
  if (el) choose(Number(el.dataset.index));
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

// ------------------------------------------------------------------ Start

void call('getState').then(
  (state) => {
    store.app = state;
    if (!state.skills.length && state.projects.length) ui.view = 'projects';
    renderApp();
  },
  (err) => {
    render(main, html`<div class="notice notice--error"><h3>Skill Hub could not start</h3><p>${err instanceof Error ? err.message : String(err)}</p></div>`);
  },
);
