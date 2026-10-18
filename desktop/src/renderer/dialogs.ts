/** The modal flows: Add skills, Create skill, Apply to projects, and Review changes. */
import type { DiffLine, FoundSkillVM, InputKind, ProjectVM, ReviewVM, SourceInput, SourceListing } from '../shared/api';
import { attempt, call, confirmDialog, html, Html, openDialog, plural, render, svg, toast } from './dom';
import { go, store, ui } from './state';

// ------------------------------------------------------------------ Shared pieces

/** Toggle chips for targets (agents). `on` is mutated as they're clicked. */
function targetChips(on: Set<string>, name: string): Html {
  const targets = store.app?.targets ?? [];
  return html`<span class="chips" role="group" aria-label="Agents">
    ${targets.map(
      (t) =>
        html`<button type="button" class="sh-chip ${on.has(t.id) ? 'sh-chip--on' : 'sh-chip--off'}" aria-pressed="${on.has(t.id)}" data-${name}="${t.id}" data-focus="${name}-${t.id}" title="${t.detail}"><span class="sh-chip__dot"></span>${t.short}</button>`,
    )}
  </span>`;
}

function bindToggles(root: HTMLElement, name: string, set: Set<string>, after: () => void): void {
  root.addEventListener('click', (event) => {
    const el = (event.target as Element).closest<HTMLElement>(`[data-${name}]`);
    if (!el) return;
    const id = el.getAttribute(`data-${name}`)!;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    after();
  });
}

/** Targets a project already uses, else the default targets. */
function targetsFor(project?: ProjectVM): string[] {
  const used = project?.targets.filter((t) => t.on).map((t) => t.id) ?? [];
  return used.length ? used : (store.app?.settings.defaultTargets ?? ['claude']);
}

/** Asks before an apply that would overwrite edited or untracked files. */
async function confirmOverwrites(ids: string[], roots: string[], targets: string[]): Promise<boolean> {
  const warnings = (await Promise.all(ids.map((id) => call('applyWarnings', id, { roots, targets })))).flat();
  if (!warnings.length) return true;
  return confirmDialog({
    title: 'Replace existing files?',
    body: 'Applying replaces what is installed there now.',
    details: warnings,
    confirm: 'Replace',
    danger: true,
  });
}

export function diffView(file: string | undefined, lines: DiffLine[], keys: { removed?: string; added?: string; local?: string }): Html {
  return html`<div class="diff">
    <div class="diff__head">
      <span class="mono">${file ?? 'No text changes'}</span>
      <span class="diff__keys">
        ${keys.removed && html`<span class="k-removed">${keys.removed}</span>`}
        ${keys.added && html`<span class="k-added">${keys.added}</span>`}
        ${keys.local && html`<span class="k-local">${keys.local}</span>`}
      </span>
    </div>
    <div class="diff__body" tabindex="0" aria-label="Differences in ${file ?? 'the skill'}">
      ${lines.length
        ? lines.map((l) =>
            l.kind === 'gap'
              ? html`<div class="diff__gap">⋯ ${plural(Number(l.text), 'unchanged line')}</div>`
              : html`<p class="diff__line diff__line--${l.kind}"><span class="sr-only">${SR[l.kind]}</span>${l.text || ' '}</p>`,
          )
        : html`<div class="diff__empty">Only binary files changed.</div>`}
    </div>
  </div>`;
}

const SR: Record<DiffLine['kind'], string> = { same: '', removed: 'Removed: ', added: 'Added: ', local: 'Local only: ', gap: '' };

// ------------------------------------------------------------------ Apply to projects

/**
 * Applies skills to projects. Pass `skillIds` to choose projects, or `root` to choose skills for one project.
 * Adds the chosen agents; agents a skill is already installed for in a project stay.
 */
export function openApplyDialog(options: { skillIds?: string[]; root?: string }): void {
  const app = store.app;
  if (!app) return;
  const forProject = options.root ? app.projects.find((p) => p.root === options.root) : undefined;
  const projects = app.projects.filter((p) => p.exists);
  const pickSkills = !!forProject;

  const chosen = new Set<string>();
  const targets = new Set(targetsFor(forProject));
  const title = pickSkills
    ? `Apply skills to ${forProject!.name}`
    : options.skillIds!.length === 1
      ? `Apply ${options.skillIds![0]} to projects`
      : `Apply ${options.skillIds!.length} skills to projects`;

  const rows = (): Html => {
    if (pickSkills) {
      const applied = new Map(forProject!.skills.filter((s) => s.status !== 'unmanaged').map((s) => [s.id, s]));
      if (!app.skills.length) return html`<p class="muted">Your hub has no skills yet.</p>`;
      return html`<div class="picklist" role="group" aria-label="Skills">
        ${app.skills.map((s) => {
          const here = applied.get(s.id);
          return html`<label>
            <input type="checkbox" data-pick="${s.id}" ${chosen.has(s.id) ? 'checked' : ''} data-focus="pick-${s.id}">
            <span><span class="mono">${s.name}</span><br><small>${s.description}</small></span>
            <small>${here ? `Applied · ${here.installed.join(', ') || here.missing.join(', ')}` : ''}</small>
          </label>`;
        })}
      </div>`;
    }
    if (!projects.length) {
      return html`<div class="empty"><h2>No projects yet</h2><p>Add the folders of the repositories you work on.</p>
        <button class="sh-btn sh-btn--primary" data-add-project>+ Add project folder</button></div>`;
    }
    const id = options.skillIds!.length === 1 ? options.skillIds![0] : undefined;
    return html`<div class="picklist" role="group" aria-label="Projects">
      ${projects.map((p) => {
        const here = id ? p.skills.find((s) => s.id === id && s.status !== 'unmanaged') : undefined;
        return html`<label>
          <input type="checkbox" data-pick="${p.root}" ${chosen.has(p.root) ? 'checked' : ''} data-focus="pick-${p.root}">
          <span>${p.name}<br><small class="mono">${p.root}</small></span>
          <small>${here ? `${here.installed.join(', ') || 'Applied'} · ${statusWord(here.status)}` : 'Not applied'}</small>
        </label>`;
      })}
    </div>`;
  };

  const content = (): Html => html`
    <div class="dlg__head">
      <div><h2>${title}</h2><p>${pickSkills ? `Skills are copied into ${forProject!.root}.` : 'Pick the projects to copy it into.'}</p></div>
      <button class="icon-btn" data-close aria-label="Close">${svg('close')}</button>
    </div>
    <div class="dlg__body">
      ${rows()}
      <div class="setting__control">
        <span class="sh-label">Install for</span>
        ${targetChips(targets, 'target')}
        <span class="note">Adds these agents. Agents a skill is already installed for stay as they are.</span>
      </div>
    </div>
    <div class="dlg__foot">
      <span class="spacer"></span>
      <button class="sh-btn" data-close>Cancel</button>
      <button class="sh-btn sh-btn--primary" data-apply ${!chosen.size || !targets.size ? 'disabled' : ''}>
        ${pickSkills ? `Apply ${plural(chosen.size, 'skill')}` : `Apply to ${plural(chosen.size, 'project')}`}
      </button>
    </div>`;

  const dlg = openDialog(content(), { label: title });
  const refresh = () => dlg.update(content());
  bindToggles(dlg.el, 'target', targets, refresh);
  dlg.el.addEventListener('change', (event) => {
    const input = (event.target as Element).closest<HTMLInputElement>('[data-pick]');
    if (!input) return;
    const key = input.dataset.pick!;
    if (input.checked) chosen.add(key);
    else chosen.delete(key);
    refresh();
  });
  dlg.el.addEventListener('click', async (event) => {
    const el = event.target as Element;
    if (el.closest('[data-close]')) dlg.close();
    else if (el.closest('[data-add-project]')) {
      dlg.close();
      await addProjects();
    } else if (el.closest('[data-apply]')) {
      const ids = pickSkills ? [...chosen] : options.skillIds!;
      const roots = pickSkills ? [forProject!.root] : [...chosen];
      const request = { roots, targets: [...targets] };
      await attempt(async () => {
        if (!(await confirmOverwrites(ids, roots, request.targets))) return;
        dlg.close();
        for (const id of ids) await call('applySkill', id, request);
        toast('info', `Applied ${ids.length === 1 ? ids[0] : plural(ids.length, 'skill')} to ${roots.length === 1 ? (app.projects.find((p) => p.root === roots[0])?.name ?? roots[0]) : plural(roots.length, 'project')}.`);
      });
    }
  });
}

function statusWord(status: string): string {
  return { synced: 'up to date', outdated: 'update available', modified: 'edited there', conflict: 'both changed', missing: 'files missing', unmanaged: 'not tracked' }[status] ?? status;
}

export async function addProjects(): Promise<void> {
  await attempt(async () => {
    const roots = await call('pickProjectFolders');
    if (!roots.length) return;
    await call('addProjects', roots);
    if (roots.length === 1) go('project', { projectRoot: roots[0] });
  });
}

/** Applies one hub skill to one project with the agents that project already uses (the matrix "+"). */
export async function quickApply(id: string, project: ProjectVM): Promise<void> {
  const targets = targetsFor(project);
  await attempt(async () => {
    if (!(await confirmOverwrites([id], [project.root], targets))) return;
    await call('applySkill', id, { roots: [project.root], targets });
  });
}

// ------------------------------------------------------------------ Add skills

const KIND_LABEL: Record<Exclude<InputKind, 'empty'>, string> = {
  github: 'GitHub repository',
  git: 'Git URL',
  url: 'File link',
  local: 'Local folder',
  search: 'Search words',
};

const SHORTCUTS = [
  { id: 'github', label: 'GitHub repo', placeholder: 'owner/repo, or a github.com link to a repo or folder' },
  { id: 'git', label: 'Git URL', placeholder: 'https://gitlab.com/group/project, or git@host:org/repo.git#branch' },
  { id: 'url', label: 'File link', placeholder: 'https://example.com/rules/react.mdc, or a raw SKILL.md link' },
  { id: 'folder', label: 'Local folder' },
  { id: 'create', label: 'Create new skill' },
];

const DEFAULT_PLACEHOLDER = 'Paste a link, owner/repo or a folder path, or type words to search GitHub';

/** The Add skills flow (design/DESIGN.md §3.3, adapted for the desktop). */
export function openAddDialog(initial: { value?: string; listing?: SourceListing; run?: boolean } = {}): void {
  let listing = initial.listing;
  let selected = new Set<number>();
  let busy = false;
  let error = '';
  let applyOn = false;
  const roots = new Set<string>(ui.view === 'project' && ui.projectRoot ? [ui.projectRoot] : []);
  const targets = new Set(store.app?.settings.defaultTargets ?? ['claude']);
  let detectSeq = 0;
  let detectTimer: number | undefined;

  const selectAll = () => {
    selected = new Set(listing?.skills.filter((s) => !s.inHub).map((s) => s.index) ?? []);
  };
  if (listing) selectAll();

  const dlg = openDialog(
    html`<div class="dlg__head">
        <div><h2>Add skills</h2><p>From GitHub, any git host, a link to a markdown file, or a folder on this computer.</p></div>
        <button class="icon-btn" data-close aria-label="Close">${svg('close')}</button>
      </div>
      <div class="dlg__body">
        <form class="big-input" id="add-form">
          <label class="sr-only" for="add-input">Source</label>
          <input id="add-input" autocomplete="off" spellcheck="false" placeholder="${DEFAULT_PLACEHOLDER}" autofocus>
          <span class="detect" id="add-detect" hidden></span>
        </form>
        <div class="detect-detail" id="add-detail" aria-live="polite"></div>
        <div class="chips" role="group" aria-label="Shortcuts">
          ${SHORTCUTS.map((s) => html`<button type="button" class="sh-chip sh-chip--off" data-shortcut="${s.id}">${s.label}</button>`)}
        </div>
        <div id="add-results" aria-live="polite"></div>
      </div>
      <div class="dlg__foot" id="add-foot"></div>`,
    {
      label: 'Add skills',
      onClose: () => {
        if (listing) void call('closeListing', listing.token);
      },
    },
  );
  const input = dlg.el.querySelector<HTMLInputElement>('#add-input')!;
  input.value = initial.value ?? '';

  const setDetected = (kind: InputKind, detail?: string) => {
    const chip = dlg.el.querySelector<HTMLElement>('#add-detect')!;
    chip.hidden = kind === 'empty';
    if (kind !== 'empty') render(chip, html`<span class="detect__dot detect__dot--${kind}" aria-hidden="true">●</span>${KIND_LABEL[kind]}`);
    dlg.el.querySelector('#add-detail')!.textContent =
      kind === 'empty' ? '' : kind === 'search' ? 'Press Enter to search GitHub for SKILL.md files.' : `${detail ?? ''} · Press Enter to list its skills.`;
  };

  const detect = () => {
    window.clearTimeout(detectTimer);
    const value = input.value;
    if (!value.trim()) return setDetected('empty');
    const seq = ++detectSeq;
    detectTimer = window.setTimeout(async () => {
      const result = await call('classify', value).catch(() => ({ kind: 'search' as InputKind, detail: undefined }));
      if (seq === detectSeq) setDetected(result.kind, result.detail);
    }, 120);
  };

  const renderResults = () => {
    const el = dlg.el.querySelector<HTMLElement>('#add-results')!;
    if (busy) return render(el, html`<p class="insp__check"><span class="spinner"></span> Looking for skills…</p>`);
    if (error) return render(el, html`<div class="notice notice--error"><h3>Couldn't list skills</h3><p>${error}</p></div>`);
    if (!listing) return render(el, html``);
    const available = listing.skills.filter((s) => !s.inHub);
    const all = available.length > 0 && available.every((s) => selected.has(s.index));
    render(
      el,
      html`<div class="found">
        <div class="found__head">
          <span>Found ${plural(listing.skills.length, listing.skills[0]?.kind === 'file' ? 'markdown file' : 'skill')} in <span class="mono">${listing.label}</span></span>
          ${available.length > 1 && html`<label class="check"><input type="checkbox" data-select-all ${all ? 'checked' : ''} data-focus="select-all"> Select all</label>`}
        </div>
        <div class="found__list">${listing.skills.map(foundRow)}</div>
      </div>`,
    );
  };

  const foundRow = (s: FoundSkillVM): Html => html`<label class="found__row ${s.inHub ? 'found__row--disabled' : ''}">
    <input type="checkbox" data-found="${s.index}" ${selected.has(s.index) ? 'checked' : ''} ${s.inHub ? 'disabled' : ''} data-focus="found-${s.index}">
    <span class="found__name">${s.name}
      ${s.inHub && html`<span class="tag tag--muted">Already in hub</span>`}
      ${s.renamed && html`<span class="tag tag--warn" title="A different skill already uses this name">Saved as ${s.id}</span>`}
      ${s.kind === 'file' && html`<span class="tag tag--muted">Converted to SKILL.md</span>`}
    </span>
    <span class="found__path" title="${s.path}">${s.path}</span>
    <span class="found__desc">${s.description}</span>
  </label>`;

  const renderFoot = () => {
    const el = dlg.el.querySelector<HTMLElement>('#add-foot')!;
    const projects = (store.app?.projects ?? []).filter((p) => p.exists);
    const n = selected.size;
    render(
      el,
      html`${listing && projects.length
          ? html`<label class="check"><input type="checkbox" data-apply-on ${applyOn ? 'checked' : ''} data-focus="apply-on"> Also apply to</label>
              ${applyOn
                ? html`<span class="chips" role="group" aria-label="Projects">${projects.map(
                      (p) =>
                        html`<button type="button" class="sh-chip ${roots.has(p.root) ? 'sh-chip--on' : 'sh-chip--off'}" aria-pressed="${roots.has(p.root)}" data-root="${p.root}" data-focus="root-${p.root}">${p.name}</button>`,
                    )}</span>
                    <span class="faint">for</span>
                    ${targetChips(targets, 'target')}`
                : ''}`
          : ''}
        <span class="spacer"></span>
        <button class="sh-btn" data-close>Cancel</button>
        <button class="sh-btn sh-btn--primary" data-add ${!n || busy || (applyOn && (!roots.size || !targets.size)) ? 'disabled' : ''}>Add ${n ? plural(n, 'skill') : 'skills'}</button>`,
    );
  };

  const renderAll = () => {
    renderResults();
    renderFoot();
  };

  const list = async (source: SourceInput) => {
    if (listing) void call('closeListing', listing.token);
    listing = undefined;
    error = '';
    busy = true;
    renderAll();
    try {
      listing = await call('listSource', source);
      selectAll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      renderAll();
    }
  };

  const submit = async () => {
    const value = input.value.trim();
    if (!value || busy) return;
    const { kind } = await call('classify', value);
    if (kind === 'search') {
      dlg.close();
      ui.discover = { status: 'idle', query: value };
      go('discover');
      document.dispatchEvent(new CustomEvent('skillhub:search', { detail: value }));
      return;
    }
    await list(value);
  };

  dlg.el.querySelector('#add-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  input.addEventListener('input', detect);
  bindToggles(dlg.el, 'target', targets, renderFoot);
  bindToggles(dlg.el, 'root', roots, renderFoot);

  dlg.el.addEventListener('change', (event) => {
    const el = event.target as HTMLInputElement;
    if (el.matches('[data-found]')) {
      const index = Number(el.dataset.found);
      if (el.checked) selected.add(index);
      else selected.delete(index);
      renderAll();
    } else if (el.matches('[data-select-all]')) {
      if (el.checked) selectAll();
      else selected.clear();
      renderAll();
    } else if (el.matches('[data-apply-on]')) {
      applyOn = el.checked;
      renderFoot();
    }
  });

  dlg.el.addEventListener('click', async (event) => {
    const el = event.target as Element;
    const shortcut = el.closest<HTMLElement>('[data-shortcut]')?.dataset.shortcut;
    if (el.closest('[data-close]')) return dlg.close();
    if (shortcut === 'create') {
      dlg.close();
      return openCreateDialog();
    }
    if (shortcut === 'folder') {
      const folder = await call('pickLocalSource');
      if (!folder) return;
      input.value = folder;
      detect();
      return list(folder);
    }
    if (shortcut) {
      input.placeholder = SHORTCUTS.find((s) => s.id === shortcut)?.placeholder ?? DEFAULT_PLACEHOLDER;
      input.focus();
      return;
    }
    if (el.closest('[data-add]') && listing) {
      const current = listing;
      const indexes = [...selected];
      const apply = applyOn ? { roots: [...roots], targets: [...targets] } : undefined;
      await attempt(async () => {
        if (apply) {
          const ids = indexes.map((i) => current.skills[i].id);
          if (!(await confirmOverwrites(ids, apply.roots, apply.targets))) return;
        }
        busy = true;
        renderFoot();
        try {
          const ids = await call('importListed', current.token, indexes, apply);
          listing = undefined;
          dlg.close();
          ui.selectedSkill = ids[0];
          if (ui.view !== 'project') go('library', { focus: false });
          toast('info', `Added ${ids.length === 1 ? ids[0] : plural(ids.length, 'skill')} to your hub${apply ? ` and applied ${ids.length === 1 ? 'it' : 'them'}` : ''}.`);
        } finally {
          busy = false;
          if (dlg.el.open) renderFoot();
        }
      });
    }
  });

  renderAll();
  if (input.value) {
    detect();
    if (initial.run) void submit();
  }
}

// ------------------------------------------------------------------ Create skill

export function openCreateDialog(): void {
  let checkSeq = 0;
  const dlg = openDialog(
    html`<form id="create-form">
      <div class="dlg__head"><div><h2>Create a skill</h2><p>Starts a SKILL.md in your hub and opens it in your editor.</p></div>
        <button type="button" class="icon-btn" data-close aria-label="Close">${svg('close')}</button></div>
      <div class="dlg__body">
        <div class="setting__control">
          <label for="create-name">Name</label>
          <input id="create-name" class="field mono" placeholder="e.g. api-conventions" autocomplete="off" spellcheck="false" autofocus aria-describedby="create-name-error">
          <span class="dlg__error" id="create-name-error" aria-live="polite"></span>
        </div>
        <div class="setting__control">
          <label for="create-desc">What it does, and when an agent should use it</label>
          <textarea id="create-desc" class="field" rows="3" placeholder="e.g. Conventions for our REST API. Use when adding or changing endpoints."></textarea>
        </div>
      </div>
      <div class="dlg__foot"><span class="spacer"></span>
        <button type="button" class="sh-btn" data-close>Cancel</button>
        <button type="submit" class="sh-btn sh-btn--primary">Create skill</button></div>
    </form>`,
    { small: true, label: 'Create a skill' },
  );
  const name = dlg.el.querySelector<HTMLInputElement>('#create-name')!;
  const desc = dlg.el.querySelector<HTMLTextAreaElement>('#create-desc')!;
  const err = dlg.el.querySelector<HTMLElement>('#create-name-error')!;
  name.addEventListener('input', async () => {
    const seq = ++checkSeq;
    const problem = name.value.trim() ? await call('validateName', name.value.trim()) : undefined;
    if (seq === checkSeq) err.textContent = problem ?? '';
  });
  dlg.el.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-close]')) dlg.close();
  });
  dlg.el.querySelector('#create-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const problem = await call('validateName', name.value.trim());
    if (problem) {
      err.textContent = problem;
      name.focus();
      return;
    }
    if (!desc.value.trim()) {
      err.textContent = '';
      desc.focus();
      toast('warning', 'Add a description. Agents use it to decide when to load the skill.');
      return;
    }
    const id = await attempt(() => call('createSkill', name.value.trim(), desc.value.trim()));
    if (!id) return;
    dlg.close();
    ui.selectedSkill = id;
    ui.filter = 'all';
    ui.query = '';
    go('library', { focus: false });
    toast('info', `Created ${id}. Its SKILL.md is open in your editor.`);
  });
}

// ------------------------------------------------------------------ Review changes at source

export function openReviewDialog(id: string): void {
  const skill = store.app?.skills.find((s) => s.id === id);
  const dlg = openDialog(
    html`<div class="dlg__head"><div><h2>Changes at source</h2><p class="mono">${skill?.name ?? id}</p></div>
      <button class="icon-btn" data-close aria-label="Close">${svg('close')}</button></div>
      <div class="dlg__body"><p class="insp__check"><span class="spinner"></span> Fetching the source…</p></div>`,
    { label: `Changes at source for ${id}` },
  );
  dlg.el.addEventListener('click', async (event) => {
    const el = event.target as Element;
    if (el.closest('[data-close]')) dlg.close();
    else if (el.closest('[data-update]')) {
      dlg.close();
      await attempt(() => call('updateFromSource', [id]));
    }
  });
  void call('review', id).then(
    (vm) => dlg.el.open && dlg.update(reviewContent(vm)),
    (err) =>
      dlg.el.open &&
      dlg.update(html`<div class="dlg__head"><div><h2>Changes at source</h2></div><button class="icon-btn" data-close aria-label="Close">${svg('close')}</button></div>
        <div class="dlg__body"><div class="notice notice--error"><h3>Couldn't fetch the source</h3><p>${err instanceof Error ? err.message : String(err)}</p></div></div>`),
  );
}

const CHANGE_TAG = { added: ['A', 'tag--update', 'Added'], removed: ['D', 'tag--error', 'Deleted'], changed: ['M', 'tag--warn', 'Changed'] } as const;

function reviewContent(vm: ReviewVM): Html {
  return html`<div class="dlg__head">
      <div><h2>Changes at source</h2><p><span class="mono">${vm.name}</span> · ${vm.source}</p></div>
      <button class="icon-btn" data-close aria-label="Close">${svg('close')}</button>
    </div>
    <div class="dlg__body">
      <div class="insp__section">
        <h3 class="sh-label">${plural(vm.changes.length, 'file')} changed</h3>
        <div class="chips">
          ${vm.changes.map((c) => {
            const [letter, cls, label] = CHANGE_TAG[c.change];
            return html`<span class="tag ${cls}" title="${label}"><span aria-hidden="true">${letter}</span><span class="sr-only">${label}:</span> <span class="mono">${c.path}</span></span>`;
          })}
        </div>
      </div>
      ${diffView(vm.file, vm.diff, { removed: 'in your hub', added: 'at source' })}
    </div>
    <div class="dlg__foot">
      <span class="note">${vm.usedIn ? `Updating the hub flags ${vm.usedIn === 1 ? 'the 1 project' : `all ${vm.usedIn} projects`} that use it, so you can update each one.` : 'No projects use it yet.'}</span>
      <span class="spacer"></span>
      <button class="sh-btn" data-close>Close</button>
      <button class="sh-btn sh-btn--primary" data-update autofocus>Update hub</button>
    </div>`;
}
