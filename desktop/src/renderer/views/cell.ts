/**
 * The right-hand panel for one skill in one project: its status and actions, or, for a conflict, the
 * "Both changed" panel with the diff and the three choices (mockup 04, DESIGN.md §4.3).
 */
import type { AppState, ProjectAction, ProjectSkillVM, ProjectVM } from '../../shared/api';
import { diffView } from '../dialogs';
import { attempt, attr, call, confirmDialog, html, Html, STATUS } from '../dom';
import { cellKey, ConflictChoice, on, rerender, store, ui } from '../state';

export function selectedCell(app: AppState): { project: ProjectVM; skill: ProjectSkillVM } | undefined {
  if (!ui.cell) return undefined;
  const project = app.projects.find((p) => p.root === ui.cell!.root);
  const skill = project?.skills.find((s) => s.id === ui.cell!.id);
  return project && skill ? { project, skill } : undefined;
}

export function cellPanel(app: AppState): Html | undefined {
  const sel = selectedCell(app);
  if (!sel) return undefined;
  return sel.skill.status === 'conflict' && sel.skill.inHub ? conflictPanel(sel.project, sel.skill) : statusPanel(sel.project, sel.skill);
}

function statusPanel(project: ProjectVM, skill: ProjectSkillVM): Html {
  const info = STATUS[skill.status];
  const action = skill.action;
  return html`<div>
      <p class="panel-kicker st st--${skill.status}">${info.glyph} ${info.label}</p>
      <h2 class="panel-title"><span class="mono">${skill.name}</span> in ${project.name}</h2>
      <p class="panel-sub">${skill.meta}</p>
    </div>
    <p class="insp__desc">${skill.description || 'No description.'}</p>
    ${skill.installed.length || skill.missing.length
      ? html`<section class="insp__section"><h3 class="sh-label">Installed for</h3>
          <div class="chips">
            ${skill.installed.map((t) => html`<span class="sh-chip sh-chip--on"><span class="sh-chip__dot"></span>${t}</span>`)}
            ${skill.missing.map((t) => html`<span class="sh-chip sh-chip--off" title="Files missing">× ${t}</span>`)}
          </div></section>`
      : ''}
    ${!skill.inHub && skill.status !== 'unmanaged' ? html`<p class="insp__hint">This skill isn't in your hub. Add it to the hub to share it with other projects.</p>` : ''}
    <div class="insp__foot">
      ${action && action.id !== 'resolve'
        ? html`<button class="sh-btn sh-btn--primary sh-btn--block" data-act="project-action" data-action="${action.id}" data-root="${project.root}" data-id="${skill.id}">${action.label}</button>`
        : ''}
      ${skill.status === 'modified' && skill.inHub
        ? html`<button class="sh-btn sh-btn--block" data-act="project-action" data-action="takeHub" data-root="${project.root}" data-id="${skill.id}">Discard edits, take hub version</button>`
        : ''}
      <div class="insp__row">
        <button class="sh-btn" data-act="edit-skill" data-path="${skill.entryFile ?? project.root}" ${skill.entryFile ? '' : 'disabled'}>Open ${skill.entryFile?.endsWith('.mdc') ? 'rule' : 'SKILL.md'}</button>
        <button class="sh-btn" data-act="open-folder" data-path="${project.root}">Open project</button>
      </div>
      <div class="insp__links">
        ${skill.localDir && html`<button data-act="reveal" data-path="${skill.entryFile ?? skill.localDir}">Show in folder</button>`}
        ${skill.inHub && html`<button data-act="show-in-library" data-id="${skill.id}">Show in Library</button>`}
        <button class="danger" data-act="project-action" data-action="remove" data-root="${project.root}" data-id="${skill.id}">Remove from project</button>
      </div>
    </div>`;
}

const CHOICES: { id: ConflictChoice; title: string; detail: (project: string) => string; button: string }[] = [
  { id: 'merge', title: 'Merge both', detail: () => 'Write both versions into the copy here and open it in your editor. Then push the result to the hub.', button: 'Merge in editor' },
  { id: 'hub', title: 'Take hub version', detail: (project) => `Overwrite the local edit in ${project}.`, button: 'Take hub version' },
  { id: 'local', title: 'Keep local, push to hub', detail: () => 'Every other project then shows an update.', button: 'Push to hub' },
];

function conflictPanel(project: ProjectVM, skill: ProjectSkillVM): Html {
  const key = cellKey(project.root, skill.id);
  if (ui.conflict?.key !== key) {
    ui.conflict = { key };
    ui.choice = ui.nextChoice ?? 'merge';
    ui.nextChoice = undefined;
    void call('conflict', project.root, skill.id).then(
      (vm) => {
        if (ui.conflict?.key !== key) return;
        ui.conflict.vm = vm;
        if (!vm.canMerge) ui.choice = 'hub';
        rerender();
      },
      (err) => {
        if (ui.conflict?.key !== key) return;
        ui.conflict.error = err instanceof Error ? err.message : String(err);
        rerender();
      },
    );
  }
  const vm = ui.conflict.vm;
  const canMerge = vm?.canMerge ?? true;
  const choice = CHOICES.find((c) => c.id === ui.choice) ?? CHOICES[0];

  return html`<div>
      <p class="panel-kicker st st--conflict">! Both changed</p>
      <h2 class="panel-title"><span class="mono">${skill.name}</span> in ${project.name}</h2>
      <p class="panel-sub">Someone edited it in this project, and the hub has a newer version too.</p>
    </div>
    ${ui.conflict.error
      ? html`<div class="notice notice--error"><h3>Couldn't compare</h3><p>${ui.conflict.error}</p></div>`
      : vm
        ? html`${diffView(vm.file, vm.diff, { added: 'hub', local: `${project.name}` })}
            ${vm.otherFiles.length ? html`<p class="note">Also differs: <span class="mono">${vm.otherFiles.join(', ')}</span></p>` : ''}`
        : html`<p class="insp__check"><span class="spinner"></span> Comparing…</p>`}
    <fieldset class="choices">
      <legend class="sh-label choices__legend">Keep which?</legend>
      ${CHOICES.map((c) => {
        const disabled = !canMerge && c.id !== 'hub';
        return html`<label class="choice">
          <input type="radio" name="conflict-choice" value="${c.id}" data-act="conflict-choice" ${ui.choice === c.id ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-focus="choice-${c.id}">
          <strong>${c.title}</strong>
          <small>${disabled ? 'Needs the skill as a SKILL.md folder in this project.' : c.detail(project.name)}</small>
        </label>`;
      })}
    </fieldset>
    <div class="panel-actions">
      <button class="sh-btn" data-act="skip-cell">Skip</button>
      <button class="sh-btn sh-btn--primary" data-act="resolve-conflict" data-root="${project.root}" data-id="${skill.id}" ${vm ? '' : 'disabled'}>${choice.button}</button>
    </div>`;
}

// ------------------------------------------------------------------ Actions

const CONFIRM: Partial<Record<ProjectAction, (skill: string, project: string) => { title: string; body: string; confirm: string }>> = {
  remove: (skill, project) => ({ title: `Remove ${skill} from ${project}?`, body: 'Deletes the installed skill files there. Your hub keeps its copy.', confirm: 'Remove' }),
  takeHub: (skill, project) => ({ title: `Discard the edits to ${skill} in ${project}?`, body: 'The hub version replaces the files there.', confirm: 'Discard edits' }),
};

export async function runProjectAction(root: string, id: string, action: ProjectAction): Promise<void> {
  const project = store.app?.projects.find((p) => p.root === root);
  const ask = CONFIRM[action];
  await attempt(async () => {
    if (ask) {
      const text = ask(id, project?.name ?? root);
      if (!(await confirmDialog({ ...text, danger: true }))) return;
    }
    await call('projectAction', root, id, action);
    if (action === 'remove' || action === 'takeHub' || action === 'keepLocal') ui.cell = undefined;
    // Reloads the diff; after a merge the skill is still "both changed" until the result is pushed, so offer that next.
    if (action === 'merge') ui.nextChoice = 'local';
    ui.conflict = undefined;
  });
}

on('project-action', (el) => {
  const action = attr(el, 'data-action') as ProjectAction | 'resolve';
  const root = attr(el, 'data-root');
  const id = attr(el, 'data-id');
  if (action === 'resolve') {
    ui.cell = { root, id };
    rerender();
    return;
  }
  void runProjectAction(root, id, action);
});
on('conflict-choice', (el) => {
  ui.choice = (el as HTMLInputElement).value as ConflictChoice;
  rerender();
});
on('skip-cell', () => {
  ui.cell = undefined;
  ui.conflict = undefined;
  rerender();
});
on('resolve-conflict', (el) => {
  const action: ProjectAction = ui.choice === 'merge' ? 'merge' : ui.choice === 'hub' ? 'takeHub' : 'keepLocal';
  const root = attr(el, 'data-root');
  const id = attr(el, 'data-id');
  void runProjectAction(root, id, action);
});
