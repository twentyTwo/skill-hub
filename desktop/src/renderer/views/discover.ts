/** Discover: search GitHub for SKILL.md files and add them in one click. */
import type { AppState, SearchResultVM } from '../../shared/api';
import { openAddDialog, openApplyDialog } from '../dialogs';
import { attempt, attr, call, html, Html, plural, svg, toast } from '../dom';
import { go, on, rerender, store, ui } from '../state';

const TOKEN_NOTE: Record<AppState['settings']['github']['source'], string> = {
  saved: 'Signed in with the token saved in Settings.',
  env: 'Signed in with GITHUB_TOKEN from the environment.',
  gh: 'Signed in through the GitHub CLI.',
  none: 'GitHub only allows code search when signed in.',
};

export function discoverMain(app: AppState): Html {
  const d = ui.discover;
  const github = app.settings.github.source;
  let body: Html;
  if (d.status === 'busy') body = html`<p class="insp__check"><span class="spinner"></span> Searching GitHub for “${d.query}”…</p>`;
  else if (d.status === 'error') body = html`<div class="notice notice--error"><h3>Search failed</h3><p>${d.message}</p></div>`;
  else if (d.status === 'done' && !d.results.length) body = html`<div class="empty"><h2>No skills match “${d.query}”</h2><p>Try fewer or different words.</p></div>`;
  else if (d.status === 'done') {
    body = html`<p class="muted">${plural(d.results.length, 'skill')} on GitHub matching “${d.query}”</p>
      <div class="results">${d.results.map(resultRow)}</div>`;
  } else {
    body = html`<div class="empty"><h2>Find skills others have shared</h2>
      <p>Searches SKILL.md files across public GitHub repositories. Try <button class="link-btn" data-act="discover-example">pdf</button>, <button class="link-btn" data-act="discover-example">react testing</button> or <button class="link-btn" data-act="discover-example">terraform</button>.</p></div>`;
  }

  return html`<div class="page-head"><div><h1 tabindex="-1">Discover</h1><p>Search GitHub for skills, or <button class="link-btn" data-act="add-skill">add from a link</button>.</p></div></div>
    <form class="searchbar" id="discover-form" role="search">
      <label class="sr-only" for="discover-query">Search GitHub for skills</label>
      <input id="discover-query" class="field" type="search" placeholder="e.g. pdf, react testing, terraform" autocomplete="off" spellcheck="false" value="${d.query}" data-focus="discover-query">
      <button class="sh-btn sh-btn--primary" type="submit" ${d.status === 'busy' ? 'disabled' : ''}>Search</button>
    </form>
    <p class="note">${TOKEN_NOTE[github]}${github === 'none' ? html` <button class="link-btn" data-act="go" data-view="settings">Add a token</button> or run <span class="mono">gh auth login</span>.` : ''}</p>
    <div aria-live="polite">${body}</div>`;
}

function resultRow(r: SearchResultVM, index: number): Html {
  const where = `${r.owner}/${r.repo}${r.path ? `/${r.path}` : ''}`;
  return html`<article class="result">
    <div class="result__text">
      <span class="result__name">${r.name}</span>
      <span class="result__where">${where}</span>
      ${r.description && html`<span class="result__desc">${r.description}</span>`}
    </div>
    <button class="icon-btn" data-act="open-url" data-url="${r.url}" aria-label="Open ${where} on GitHub" title="Open on GitHub">${svg('external')}</button>
    ${r.inHub
      ? html`<span class="tag tag--muted">In hub</span>`
      : html`<button class="sh-btn sh-btn--sm" data-act="discover-add" data-index="${index}">Add</button>`}
  </article>`;
}

export async function runSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  ui.discover = { status: 'busy', query: q };
  rerender();
  try {
    const results = await call('search', q);
    if (ui.discover.query === q) ui.discover = { status: 'done', query: q, results };
  } catch (err) {
    if (ui.discover.query === q) ui.discover = { status: 'error', query: q, message: err instanceof Error ? err.message : String(err) };
  }
  rerender();
}

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id !== 'discover-form') return;
  event.preventDefault();
  void runSearch(form.querySelector<HTMLInputElement>('#discover-query')!.value);
});
document.addEventListener('skillhub:search', (event) => void runSearch((event as CustomEvent<string>).detail));

on('discover-example', (el) => void runSearch(el.textContent ?? ''));
on('discover-add', (el) => {
  const d = ui.discover;
  if (d.status !== 'done') return;
  const r = d.results[Number(attr(el, 'data-index'))];
  void attempt(async () => {
    const listing = await call('listSource', { type: 'github', owner: r.owner, repo: r.repo, path: r.path });
    const only = listing.skills.length === 1 ? listing.skills[0] : undefined;
    if (!only || only.inHub) {
      openAddDialog({ value: `${r.owner}/${r.repo}${r.path ? `/${r.path}` : ''}`, listing });
      return;
    }
    const [id] = await call('importListed', listing.token, [only.index]);
    r.inHub = true;
    rerender();
    const hasProjects = !!store.app?.projects.some((p) => p.exists);
    toast('info', `Added ${id} to your hub.`, hasProjects ? { label: 'Apply to projects…', run: () => openApplyDialog({ skillIds: [id] }) } : { label: 'Show', run: () => showInLibrary(id) });
  });
});

function showInLibrary(id: string): void {
  ui.selectedSkill = id;
  ui.filter = 'all';
  go('library');
}
