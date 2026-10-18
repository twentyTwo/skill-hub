/** One project: its agents, and its skills grouped like the extension's "This repo" tab (DESIGN.md §3.1). */
import type { AppState, ProjectSkillVM } from '../../shared/api';
import { openApplyDialog } from '../dialogs';
import { attr, html, Html, statusBadge, svg } from '../dom';
import { cellPanel } from './cell';
import { isSafeUpdate } from './projects';
import { on, rerender, ui } from '../state';

const GROUPS: { id: ProjectSkillVM['group']; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'applied', label: 'Applied' },
  { id: 'untracked', label: 'Found, not tracked' },
];

export function projectMain(app: AppState): Html {
  const p = app.projects.find((x) => x.root === ui.projectRoot);
  if (!p) {
    return html`<div class="empty"><h2>Project not found</h2><button class="sh-btn" data-act="go" data-view="projects">Back to Projects</button></div>`;
  }

  const head = html`<div class="page-head">
    <div><h1 tabindex="-1">${p.name}</h1><p class="mono">${p.root}</p></div>
    <div class="page-head__actions">
      ${p.exists && html`<button class="sh-btn" data-act="open-folder" data-path="${p.root}">Open in VS Code</button>
        <button class="sh-btn" data-act="reveal" data-path="${p.root}">Show in folder</button>
        <button class="sh-btn sh-btn--primary" data-act="apply-to-project" data-root="${p.root}">Apply skills…</button>`}
    </div>
  </div>`;

  if (!p.exists || p.error) {
    return html`${head}<div class="notice notice--error"><h3>${p.exists ? "Couldn't read this project" : 'Folder not found'}</h3><p>${p.error}</p>
      <div class="notice__actions"><button class="sh-btn" data-act="remove-project" data-root="${p.root}">Stop tracking it</button></div></div>`;
  }

  const safe = p.skills.filter(isSafeUpdate).length;
  const card = html`<div class="repo-card">
    <div class="chips" aria-label="Agents with skills here">
      ${p.targets.map(
        (t) => html`<span class="sh-chip ${t.on ? 'sh-chip--on' : 'sh-chip--off'}" title="${t.detail}"><span class="sh-chip__dot"></span>${t.short}<span class="sr-only">${t.on ? ' (in use)' : ' (not used)'}</span></span>`,
      )}
    </div>
    <p class="muted">${p.summary}</p>
    ${safe ? html`<div><button class="sh-btn sh-btn--info" data-act="update-all-safe" data-root="${p.root}">Update ${safe === 1 ? '1 skill' : `all ${safe} safe`} from hub</button></div>` : ''}
  </div>`;

  if (!p.skills.length) {
    return html`${head}${card}<div class="empty"><h2>No skills here yet</h2><p>Apply skills from your hub to install them for this project's agents.</p>
      <button class="sh-btn sh-btn--primary" data-act="apply-to-project" data-root="${p.root}">Apply skills…</button></div>`;
  }

  const groups = GROUPS.map((g) => ({ ...g, skills: p.skills.filter((s) => s.group === g.id) })).filter((g) => g.skills.length);
  return html`${head}${card}
    ${groups.map(
      (g) => html`<section class="group" aria-label="${g.label}">
        <h2 class="sh-label">${g.label}</h2>
        <div role="list">${g.skills.map((s) => skillRow(p.root, s))}</div>
      </section>`,
    )}
    <p class="note">Stop tracking this project with <button class="link-btn" data-act="remove-project" data-root="${p.root}">Remove from Skill Hub</button>. Its files are not changed.</p>`;
}

function skillRow(root: string, s: ProjectSkillVM): Html {
  const selected = ui.cell?.root === root && ui.cell.id === s.id;
  return html`<div class="row" role="listitem" aria-selected="${selected}" data-act="select-row" data-root="${root}" data-id="${s.id}">
    ${statusBadge(s.status)}
    <span class="row__text">
      <button class="row__btn row__name" data-act="select-row" data-root="${root}" data-id="${s.id}" data-focus="row-${s.id}" aria-label="${s.name}, ${s.meta}">${s.name}</button>
      <span class="row__meta">${s.meta}</span>
    </span>
    <span class="row__tools">
      ${s.action && html`<button class="sh-btn sh-btn--sm" data-act="project-action" data-action="${s.action.id}" data-root="${root}" data-id="${s.id}">${s.action.label}</button>`}
      ${s.entryFile && html`<button class="icon-btn" data-act="edit-skill" data-path="${s.entryFile}" aria-label="Open ${s.name}" title="Open">${svg('file')}</button>`}
      <button class="icon-btn" data-act="project-action" data-action="remove" data-root="${root}" data-id="${s.id}" aria-label="Remove ${s.name} from this project" title="Remove from project">${svg('trash')}</button>
    </span>
  </div>`;
}

export function projectInspector(app: AppState): Html | undefined {
  return cellPanel(app);
}

on('select-row', (el) => {
  const root = attr(el, 'data-root');
  const id = attr(el, 'data-id');
  ui.cell = ui.cell?.root === root && ui.cell.id === id ? undefined : { root, id };
  rerender();
});
on('apply-to-project', (el) => openApplyDialog({ root: attr(el, 'data-root') }));
