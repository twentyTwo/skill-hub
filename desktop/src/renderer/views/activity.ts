/** Activity: what Skill Hub changed, newest first, grouped by day. */
import type { ActivityEntry, AppState } from '../../shared/api';
import { html, Html } from '../dom';

const GLYPH: Record<ActivityEntry['kind'], { glyph: string; status: string; label: string }> = {
  add: { glyph: '+', status: 'synced', label: 'Added' },
  update: { glyph: '↑', status: 'outdated', label: 'Updated' },
  apply: { glyph: '→', status: 'synced', label: 'Applied' },
  remove: { glyph: '×', status: 'unmanaged', label: 'Removed' },
  save: { glyph: '✎', status: 'modified', label: 'Saved' },
  resolve: { glyph: '!', status: 'conflict', label: 'Resolved' },
  project: { glyph: '○', status: 'unmanaged', label: 'Projects' },
  check: { glyph: '✓', status: 'unmanaged', label: 'Checked' },
  error: { glyph: '×', status: 'missing', label: 'Failed' },
};

export function activityMain(app: AppState): Html {
  const head = html`<div class="page-head"><div><h1 tabindex="-1">Activity</h1><p>What Skill Hub changed in your hub and projects from this app.</p></div></div>`;
  if (!app.activity.length) return html`${head}<div class="empty"><h2>Nothing yet</h2><p>Adding, applying and updating skills shows up here.</p></div>`;

  const days = new Map<string, ActivityEntry[]>();
  for (const entry of app.activity) {
    const day = new Date(entry.at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return html`${head}<div class="timeline">
    ${[...days].map(
      ([day, entries]) => html`<section class="timeline__day" aria-label="${day}">
        <h2 class="sh-label">${day}</h2>
        ${entries.map((e) => {
          const g = GLYPH[e.kind] ?? GLYPH.project;
          return html`<div class="event">
            <time datetime="${e.at}">${new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
            <span class="sh-status sh-status--${g.status}" role="img" aria-label="${g.label}">${g.glyph}</span>
            <span class="event__text">${e.text}</span>
          </div>`;
        })}
      </section>`,
    )}
  </div>`;
}
