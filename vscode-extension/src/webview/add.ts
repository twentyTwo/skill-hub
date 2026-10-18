import type { AddInbound, AddOutbound, AddSetup, FoundSkillVM, InputKind } from '../shared/protocol';
import { byId, html, icon, onClick, plural, render, vscodeApi } from './common';

const KIND_LABEL: Record<Exclude<InputKind, 'empty'>, string> = {
  github: 'GitHub repository',
  git: 'Git URL',
  url: 'File link',
  local: 'Local path',
  search: 'Search words',
};

const SHORTCUTS: { id: string; label: string; placeholder?: string }[] = [
  { id: 'github', label: 'GitHub repo', placeholder: 'owner/repo, or a github.com link to a repo or folder' },
  { id: 'git', label: 'Git URL', placeholder: 'https://gitlab.com/group/project, or git@host:org/repo.git#branch' },
  { id: 'url', label: 'File link', placeholder: 'https://example.com/rules/react.mdc, or a raw SKILL.md link' },
  { id: 'folder', label: 'Local folder' },
  { id: 'create', label: 'Create new skill' },
];
const DEFAULT_PLACEHOLDER = 'anthropics/skills, a git URL, a .md link, a local path, or search words';

type Results =
  | { status: 'idle' }
  | { status: 'busy'; message: string }
  | { status: 'error'; message: string }
  | { status: 'found'; title: string; skills: FoundSkillVM[]; checked: Set<number> };

const vscode = vscodeApi<unknown>();
const post = (message: AddOutbound) => vscode.postMessage(message);

let setup: AddSetup | undefined;
let results: Results = { status: 'idle' };
let applyHere = true;
let applyRoot: string | undefined;
let applyTargets = new Set<string>();
let notice = '';
let detectTimer: number | undefined;

byId('app').innerHTML = html`<main class="ad">
  <div class="ad-intro">
    <h1>Add skills to your hub</h1>
    <p>Paste a GitHub repo, any git URL, a link to a markdown file, a local path — or just type words to search GitHub.</p>
  </div>
  <form id="source-form" class="ad-source" role="search">
    <label class="sr-only" for="source">Source or search words</label>
    <input id="source" class="sh-mono" placeholder="${DEFAULT_PLACEHOLDER}" autocomplete="off" spellcheck="false" aria-describedby="detect-detail">
    <span id="detect" class="ad-detect" hidden></span>
    <button type="submit" class="sh-btn" id="find">Find skills</button>
  </form>
  <p id="detect-detail" class="ad-detail" aria-live="polite"></p>
  <div class="ad-shortcuts" role="group" aria-label="Shortcuts">
    ${SHORTCUTS.map((s) => html`<button class="sb-pill" data-shortcut="${s.id}">${s.label}</button>`)}
  </div>
  <div id="notice" class="ad-notice" role="status" aria-live="polite"></div>
  <div id="results"></div>
</main>`.value;

const input = byId<HTMLInputElement>('source');
input.focus();

// ------------------------------------------------------------------ Input and detection

function setDetected(kind: InputKind, detail?: string): void {
  const chip = byId('detect');
  chip.hidden = kind === 'empty';
  if (kind !== 'empty') render(chip, html`<span class="ad-detect__dot ad-detect__dot--${kind}" aria-hidden="true">●</span> ${KIND_LABEL[kind]}`);
  const hint = kind === 'empty' ? '' : kind === 'search' ? 'Press Enter to search GitHub for SKILL.md files.' : `${detail ?? ''} · Press Enter to list its skills.`;
  byId('detect-detail').textContent = hint;
}

input.addEventListener('input', () => {
  clearTimeout(detectTimer);
  if (!input.value.trim()) {
    setDetected('empty');
    return;
  }
  detectTimer = window.setTimeout(() => post({ type: 'detect', value: input.value }), 150);
});

byId('source-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (input.value.trim()) post({ type: 'find', value: input.value });
});

onClick(document, '[data-shortcut]', (el) => {
  const shortcut = SHORTCUTS.find((s) => s.id === el.dataset.shortcut);
  if (!shortcut) return;
  if (shortcut.id === 'folder') return post({ type: 'browse', folder: true });
  if (shortcut.id === 'create') return post({ type: 'create' });
  input.placeholder = shortcut.placeholder ?? DEFAULT_PLACEHOLDER;
  input.value = '';
  setDetected('empty');
  input.focus();
});

// ------------------------------------------------------------------ Results

function renderResults(): void {
  const el = byId('results');
  if (results.status === 'idle') {
    render(el, html``);
    return;
  }
  if (results.status === 'busy') {
    render(el, html`<section class="ad-card ad-card--message">${icon('loading', 'codicon-modifier-spin')} ${results.message}</section>`);
    return;
  }
  if (results.status === 'error') {
    render(el, html`<section class="ad-card ad-card--message ad-card--error" role="alert">${icon('error')} ${results.message}</section>`);
    return;
  }

  const { skills, checked } = results;
  const selectable = skills.map((s, i) => (s.hub === 'inHub' ? -1 : i)).filter((i) => i >= 0);
  const allChecked = selectable.length > 0 && selectable.every((i) => checked.has(i));
  const folders = setup?.folders ?? [];
  const canApply = folders.length > 0;
  const n = checked.size;

  render(
    el,
    html`<section class="ad-card" aria-labelledby="found-title">
        <div class="ad-card__head">
          <h2 id="found-title" class="ad-card__title">${results.title}</h2>
          ${selectable.length > 1 &&
          html`<label class="ad-check"><input type="checkbox" id="select-all" data-focus="select-all" ${allChecked ? html`checked` : ''}> Select all</label>`}
        </div>
        <ul class="ad-list">
          ${skills.map((s, i) => {
            const disabled = s.hub === 'inHub';
            return html`<li>
              <label class="ad-item ${checked.has(i) ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}">
                <input type="checkbox" data-index="${i}" data-focus="item:${i}" ${checked.has(i) ? html`checked` : ''} ${disabled ? html`disabled` : ''}>
                <span class="ad-item__text">
                  <span class="ad-item__name">
                    <span class="sh-mono">${s.name}</span>
                    ${s.hub === 'inHub' && html`<span class="sb-tag">Already in hub</span>`}
                    ${s.hub === 'nameTaken' && html`<span class="sb-tag" title="Your hub has a different skill with this name. You'll be asked whether to replace it or keep both.">Name in use</span>`}
                  </span>
                  ${s.description && html`<span class="ad-item__desc">${s.description}</span>`}
                </span>
                <span class="ad-item__path sh-mono">${s.path}</span>
              </label>
            </li>`;
          })}
        </ul>
      </section>
      <div class="ad-footer">
        ${canApply &&
        html`<label class="ad-check"><input type="checkbox" id="apply-here" data-focus="apply-here" ${applyHere ? html`checked` : ''}>
            Also apply to ${folders.length === 1 ? folders[0].name : 'this repo'} for</label>
          ${folders.length > 1 &&
          html`<label class="sr-only" for="apply-root">Folder</label>
            <select id="apply-root" class="ad-select" data-focus="apply-root" ${applyHere ? '' : html`disabled`}>
              ${folders.map((f) => html`<option value="${f.root}" ${f.root === applyRoot ? html`selected` : ''}>${f.name}</option>`)}
            </select>`}
          <span class="ad-targets" role="group" aria-label="Targets">
            ${setup!.targets.map(
              (t) => html`<button class="sh-chip ${applyTargets.has(t.id) ? 'sh-chip--on' : 'sh-chip--off'}" data-target="${t.id}" data-focus="target:${t.id}"
                aria-pressed="${applyTargets.has(t.id)}" ${applyHere ? '' : html`disabled`}>${t.label}</button>`,
            )}
          </span>`}
        <button class="sh-btn sh-btn--primary ad-add" id="add" data-focus="add" ${n ? '' : html`disabled`}>${n ? `Add ${plural(n, 'skill')}` : 'Select skills to add'}</button>
      </div>`,
  );
}

const resultsEl = byId('results');
resultsEl.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (results.status !== 'found') return;
  const { checked, skills } = results;
  if (target.id === 'select-all') {
    const on = (target as HTMLInputElement).checked;
    skills.forEach((s, i) => (on && s.hub !== 'inHub' ? checked.add(i) : checked.delete(i)));
  } else if (target.dataset.index !== undefined) {
    const i = Number(target.dataset.index);
    if ((target as HTMLInputElement).checked) checked.add(i);
    else checked.delete(i);
  } else if (target.id === 'apply-here') {
    applyHere = (target as HTMLInputElement).checked;
  } else if (target.id === 'apply-root') {
    applyRoot = target.value;
  }
  renderResults();
});

onClick(resultsEl, '[data-target]', (el) => {
  const id = el.dataset.target!;
  if (applyTargets.has(id)) applyTargets.delete(id);
  else applyTargets.add(id);
  renderResults();
});

onClick(resultsEl, '#add', () => {
  if (results.status !== 'found' || !results.checked.size) return;
  const apply = applyHere && setup?.folders.length && applyRoot && applyTargets.size ? { root: applyRoot, targets: [...applyTargets] } : undefined;
  post({ type: 'add', indices: [...results.checked].sort((a, b) => a - b), apply });
});

function showNotice(text: string): void {
  notice = text;
  render(byId('notice'), notice ? html`${icon('pass')} ${notice}` : html``);
}

// ------------------------------------------------------------------ Messages

window.addEventListener('message', (event: MessageEvent<AddInbound>) => {
  const message = event.data;
  switch (message.type) {
    case 'setup':
      setup = message.setup;
      applyRoot = setup.activeRoot ?? setup.folders[0]?.root;
      applyTargets = new Set(setup.defaultTargets.filter((id) => setup!.targets.some((t) => t.id === id)));
      renderResults();
      return;
    case 'detected':
      if (message.value === input.value) setDetected(message.kind, message.detail);
      return;
    case 'setInput':
      input.value = message.value;
      post({ type: 'detect', value: message.value });
      if (message.find) post({ type: 'find', value: message.value });
      input.focus();
      return;
    case 'busy':
      showNotice('');
      results = { status: 'busy', message: message.message };
      break;
    case 'error':
      results = { status: 'error', message: message.message };
      break;
    case 'found': {
      // After adding, the same list comes back with updated hub status; keep the title and drop added rows from the selection.
      const previous = results.status === 'found' ? results : undefined;
      const title = message.title || previous?.title || '';
      const checked = new Set<number>();
      if (previous && !message.title) previous.checked.forEach((i) => message.skills[i]?.hub !== 'inHub' && checked.add(i));
      else if (message.skills.length === 1 && message.skills[0].hub !== 'inHub') checked.add(0);
      results = { status: 'found', title, skills: message.skills, checked };
      break;
    }
    case 'added':
      showNotice(message.message);
      return;
  }
  renderResults();
});

post({ type: 'ready' });
