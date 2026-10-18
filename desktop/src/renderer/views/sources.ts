/** Sources: where the hub's skills came from, when each was last checked, and what's newer there. */
import type { AppState, HubSkillVM } from '../../shared/api';
import { attempt, attr, call, html, Html, plural, relativeTime, toast } from '../dom';
import { on } from '../state';

interface SourceGroup {
  key: string;
  kind: string;
  label: string;
  url?: string;
  skills: HubSkillVM[];
}

export function sourceGroups(app: AppState): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const s of app.skills) {
    const key = `${s.source.type}:${s.source.label}`;
    let group = groups.get(key);
    if (!group) {
      // A repo-level link for GitHub sources; other kinds link to the one source they are.
      const url = s.source.type === 'github' ? `https://github.com/${s.source.label}` : s.source.url;
      group = { key, kind: s.source.kind, label: s.source.label, url, skills: [] };
      groups.set(key, group);
    }
    group.skills.push(s);
  }
  return [...groups.values()].sort((a, b) => b.skills.length - a.skills.length || a.label.localeCompare(b.label));
}

export function sourcesMain(app: AppState): Html {
  const groups = sourceGroups(app);
  const checkable = app.skills.filter((s) => s.canUpdate);
  const head = html`<div class="page-head">
    <div><h1 tabindex="-1">Sources</h1><p>Where the skills in your hub came from. Checking a source downloads its current version to compare; nothing changes until you update.</p></div>
    <div class="page-head__actions">${checkable.length ? html`<button class="sh-btn" data-act="sync-all">Check all sources</button>` : ''}</div>
  </div>`;
  if (!groups.length) return html`${head}<div class="empty"><h2>No sources yet</h2><button class="sh-btn sh-btn--primary" data-act="add-skill">+ Add skill</button></div>`;

  return html`${head}<div class="table-wrap"><table class="table table--static">
    <thead><tr><th scope="col">Source</th><th scope="col">Skills</th><th scope="col">Last checked</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${groups.map((g) => {
      const newer = g.skills.filter((s) => s.check?.state === 'newer');
      const errors = g.skills.filter((s) => s.check?.state === 'error');
      const checking = g.skills.some((s) => s.check?.state === 'checking');
      const checked = g.skills.map((s) => (s.check && 'checkedAt' in s.check ? s.check.checkedAt : '')).filter(Boolean).sort().pop();
      const canCheck = g.skills.some((s) => s.canUpdate);
      return html`<tr>
        <td>
          <span class="faint">${g.kind}</span><br>
          ${g.url
            ? html`<a class="mono" href="${g.url}" data-act="open-url" data-url="${g.url}">${g.label}</a>`
            : html`<span class="${g.kind === 'Created' ? '' : 'mono'}">${g.label}</span>`}
        </td>
        <td><div class="source-names">${g.skills.map((s) => html`<span title="${s.description}">${s.name}</span>`)}</div></td>
        <td class="faint">
          ${checking ? html`<span class="insp__check"><span class="spinner"></span> Checking…</span>` : checked ? relativeTime(checked) : canCheck ? 'Never' : '—'}
          ${newer.length ? html`<br><span class="tag tag--update">↑ ${plural(newer.length, 'update')}</span>` : ''}
          ${errors.length ? html`<br><span class="tag tag--error" title="${errors.map((s) => (s.check?.state === 'error' ? `${s.name}: ${s.check.message}` : '')).join('\n')}">${plural(errors.length, 'error')}</span>` : ''}
        </td>
        <td><div class="table__actions">
          ${canCheck && !checking ? html`<button class="sh-btn sh-btn--sm" data-act="check-group" data-ids="${g.skills.filter((s) => s.canUpdate).map((s) => s.id).join(',')}">Check</button>` : ''}
          ${newer.length ? html`<button class="sh-btn sh-btn--sm" data-act="update-group" data-ids="${newer.map((s) => s.id).join(',')}">Update ${newer.length}</button>` : ''}
        </div></td>
      </tr>`;
    })}</tbody>
  </table></div>`;
}

on('check-group', (el) => {
  void attempt(async () => {
    const { newer, failed } = await call('checkSources', attr(el, 'data-ids').split(','));
    if (!newer.length && !failed) toast('info', 'Everything from this source matches it.');
  });
});
on('update-group', (el) => void attempt(() => call('updateFromSource', attr(el, 'data-ids').split(','))));
