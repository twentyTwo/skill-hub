import type { DetailInbound, DetailOutbound, DetailSpec, DetailState, DetailTargetVM } from '../shared/protocol';
import { byId, html, Html, icon, onClick, render, statusPill, vscodeApi } from './common';

const vscode = vscodeApi<{ spec?: DetailSpec }>();
const post = (message: DetailOutbound) => vscode.postMessage(message);
const app = byId('app');

function renderPage(s: DetailState): void {
  if (s.gone) {
    render(
      app,
      html`<main class="dt">
        <h1 class="dt-name sh-mono">${s.name}</h1>
        <p class="dt-desc">This skill is no longer in your hub${s.folder ? html` or in ${s.folder.name}` : ''}.</p>
      </main>`,
    );
    return;
  }

  // One filled orange button per view: the status action when the skill needs attention, else Apply.
  const statusAction = s.status?.action;
  const applyButton =
    s.canApply &&
    html`<button class="sh-btn ${statusAction ? '' : 'sh-btn--primary'}" data-msg="apply" data-focus="apply">${s.applyLabel}</button>`;

  render(
    app,
    html`<main class="dt">
      <header class="dt-head">
        <div class="dt-title">
          <div class="dt-title__row">
            <h1 class="dt-name sh-mono">${s.name}</h1>
            ${s.status && statusPill(s.status.status)}
            ${!s.status && s.inHub && html`<span class="sb-tag">In your hub</span>`}
            ${!s.status && s.builtin && html`<span class="sb-tag">Built-in</span>`}
          </div>
          <div class="dt-meta">
            ${s.source &&
            html`<span>${s.source.kind} · ${s.source.url ? html`<a href="${s.source.url}" data-msg="openSource">${s.source.text}</a>` : s.source.text}</span>`}
            ${s.dateLabel && html`<span>${s.dateLabel}</span>`}
            ${s.hash && html`<span class="sh-mono" title="Content hash">#${s.hash}</span>`}
            ${s.folder && html`<span>${icon('folder')} ${s.folder.name}</span>`}
          </div>
        </div>
        <div class="dt-actions">
          <button class="sh-btn" data-msg="openSkillFile" data-focus="open">Open SKILL.md</button>
          ${s.canCheckSource && html`<button class="sh-btn" data-command="skillHub.updateSkill" data-focus="check">Check source</button>`}
          ${s.builtin && html`<button class="sh-btn" data-command="skillHub.customizeSkill" data-focus="customize" title="Copy this skill to your hub so you can edit it">Copy to hub to edit</button>`}
          ${statusAction ? html`${applyButton}<button class="sh-btn sh-btn--primary" data-command="${statusAction.command}" data-focus="status">${statusAction.label}</button>` : applyButton}
        </div>
      </header>

      ${s.description && html`<p class="dt-desc">${s.description}</p>`}

      <section class="dt-section" aria-labelledby="installed">
        <h2 class="sh-label" id="installed">Installed for</h2>
        ${s.folder
          ? html`<div class="dt-targets">${s.targets.map((t) => targetCard(t, s))}</div>`
          : html`<p class="dt-note">Open a folder to apply this skill to it.</p>`}
      </section>

      <div class="dt-split">
        <section class="dt-section dt-split__main" aria-labelledby="skillmd">
          <h2 class="sh-label" id="skillmd">SKILL.md</h2>
          ${s.skillMd ? skillMd(s.skillMd) : html`<p class="dt-note">No SKILL.md found.</p>`}
        </section>
        <section class="dt-section dt-split__side" aria-labelledby="files">
          <h2 class="sh-label" id="files">Files</h2>
          <ul class="sh-card dt-files">
            ${s.files.map(
              (f) => html`<li><button class="dt-file sh-mono" data-file="${f}" data-focus="file:${f}" title="Open ${f}">${icon('file')} ${f}</button></li>`,
            )}
          </ul>
          ${s.remove && html`<button class="sh-btn sh-btn--danger dt-remove" data-command="${s.remove.command}" data-focus="remove">${s.remove.label}</button>`}
        </section>
      </div>
    </main>`,
  );
}

function targetCard(t: DetailTargetVM, s: DetailState): Html {
  const installed = t.state !== 'none';
  return html`<div class="sh-card dt-target ${installed ? '' : 'sh-card--empty'}">
    <div class="dt-target__head">
      <span class="dt-target__name">${t.label}</span>
      <span class="dt-target__state dt-state--${t.state}">${t.stateLabel}</span>
    </div>
    <span class="dt-target__path sh-mono">${t.path}</span>
    ${!installed &&
    s.canApply &&
    html`<button class="sh-btn sh-btn--sm sh-btn--ghost dt-target__btn" data-install="${t.id}" data-focus="install:${t.id}" aria-label="Install for ${t.label}">
      + Install here
    </button>`}
    ${t.state === 'missing' &&
    html`<button class="sh-btn sh-btn--sm dt-target__btn" data-command="skillHub.workspace.update" data-focus="restore:${t.id}">Restore</button>`}
  </div>`;
}

function skillMd(md: NonNullable<DetailState['skillMd']>): Html {
  const clip = (text: string) => (text.length > 160 ? `${text.slice(0, 159)}…` : text);
  const lines = md.body.split('\n').map((line) => (/^#{1,6}\s/.test(line) ? html`<span class="dt-md__heading">${line}</span>` : html`${line}`));
  return html`<button class="sh-card dt-md sh-mono" data-msg="openSkillFile" title="Open SKILL.md">${
    md.frontmatter.length
      ? html`---\n${md.frontmatter.map((f) => html`<span class="dt-md__key">${f.key}</span>: ${clip(f.value)}\n`)}---\n\n`
      : ''
  }${lines.map((line, i) => html`${i ? '\n' : ''}${line}`)}${md.truncated ? '\n…' : ''}</button>`;
}

onClick(app, '[data-msg]', (el, event) => {
  event.preventDefault();
  post({ type: el.dataset.msg as 'apply' | 'openSkillFile' | 'openSource' });
});
onClick(app, '[data-command]', (el) => post({ type: 'command', id: el.dataset.command! }));
onClick(app, '[data-install]', (el) => post({ type: 'install', target: el.dataset.install! }));
onClick(app, '[data-file]', (el) => post({ type: 'openFile', file: el.dataset.file! }));

window.addEventListener('message', (event: MessageEvent<DetailInbound>) => {
  if (event.data.type !== 'state') return;
  vscode.setState({ spec: event.data.spec });
  renderPage(event.data.state);
});

post({ type: 'ready' });
