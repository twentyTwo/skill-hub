/** Settings: where the hub lives, how skills are applied, the editor, and GitHub access. */
import type { AppState, CustomTargetVM, SettingsVM } from '../../shared/api';
import { attempt, attr, call, html, Html, svg, toast } from '../dom';
import { on, rerender, store } from '../state';

const GITHUB: Record<AppState['settings']['github']['source'], string> = {
  saved: 'Using the token saved here, encrypted with your system keychain.',
  env: 'Using GITHUB_TOKEN (or GH_TOKEN) from the environment.',
  gh: 'Using your GitHub CLI sign-in (gh auth token).',
  none: 'Not signed in. Public repositories work, with a lower rate limit; private ones and Discover need a token.',
};

export function settingsMain(app: AppState): Html {
  const s = app.settings;
  const builtIn = new Set(['claude', 'copilot', 'cursor', 'agents']);
  return html`<div class="page-head"><div><h1 tabindex="-1">Settings</h1><p>Settings for this app. The VS Code extension keeps its own, but both use the same hub folder by default.</p></div></div>
  <div class="settings">
    <section class="setting-group" aria-labelledby="set-hub">
      <h2 id="set-hub">Hub</h2>
      <div class="setting">
        <label for="set-library">Hub folder</label>
        <div class="setting__control">
          <div class="setting__line">
            <input id="set-library" class="field mono" value="${s.libraryPath}" data-setting="libraryPath" data-focus="set-library" spellcheck="false">
            <button class="sh-btn" data-act="pick-library">Choose…</button>
            <button class="sh-btn" data-act="reveal" data-path="${app.libraryRoot}">Show</button>
          </div>
          <span class="setting__help">One folder per skill, plus <span class="mono">hub.json</span>. Point it at a synced or git-tracked folder to share it across machines. Default: <span class="mono">~/.skill-hub</span>.</span>
        </div>
      </div>
    </section>

    <section class="setting-group" aria-labelledby="set-apply">
      <h2 id="set-apply">Applying skills</h2>
      <div class="setting">
        <span class="setting__name">Default agents</span>
        <div class="setting__control">
          <span class="chips" role="group" aria-label="Default agents">
            ${app.targets.map((t) => {
              const on = s.defaultTargets.includes(t.id);
              return html`<button class="sh-chip ${on ? 'sh-chip--on' : 'sh-chip--off'}" aria-pressed="${on}" data-act="toggle-default-target" data-id="${t.id}" data-focus="dt-${t.id}" title="${t.detail}"><span class="sh-chip__dot"></span>${t.short}</button>`;
            })}
          </span>
          <span class="setting__help">Pre-selected when you apply a skill to a project that has none yet.</span>
        </div>
      </div>
      <div class="setting">
        <label for="set-agents">AGENTS.md skills folder</label>
        <div class="setting__control">
          <input id="set-agents" class="field mono" value="${s.agentsSkillsFolder}" data-setting="agentsSkillsFolder" data-focus="set-agents" spellcheck="false">
          <span class="setting__help">Where the AGENTS.md target puts skill folders, relative to the project.</span>
        </div>
      </div>
      <div class="setting">
        <span class="setting__name">Custom agents</span>
        <div class="setting__control">
          ${s.customTargets.map(
            (t, i) => html`<div class="custom-target">
              <span class="mono">${t.id}</span><span>${t.label ?? ''}</span><span class="mono faint">${t.folder}/&lt;skill&gt;/</span>
              <button class="icon-btn" data-act="remove-custom-target" data-index="${i}" aria-label="Remove ${t.id}">${svg('trash')}</button>
            </div>`,
          )}
          <form class="custom-target" id="custom-target-form">
            <input class="field mono" name="id" placeholder="id, e.g. codex" aria-label="Id" required spellcheck="false" data-focus="ct-id">
            <input class="field" name="label" placeholder="Label" aria-label="Label" data-focus="ct-label">
            <input class="field mono" name="folder" placeholder="Folder, e.g. .codex/skills" aria-label="Folder" required spellcheck="false" data-focus="ct-folder">
            <button class="sh-btn" type="submit">Add</button>
          </form>
          <span class="setting__help">Any other agent that reads <span class="mono">SKILL.md</span> folders. Ids must differ from ${[...builtIn].join(', ')}.</span>
        </div>
      </div>
    </section>

    <section class="setting-group" aria-labelledby="set-editor">
      <h2 id="set-editor">Editor</h2>
      <div class="setting">
        <label for="set-editor-cmd">Editor command</label>
        <div class="setting__control">
          <input id="set-editor-cmd" class="field mono" value="${s.editorCommand}" placeholder="code" data-setting="editorCommand" data-focus="set-editor-cmd" spellcheck="false">
          <span class="setting__help">Runs as <span class="mono">&lt;command&gt; "&lt;path&gt;"</span> for Edit, Open in VS Code and merges. Use <span class="mono">code</span>, <span class="mono">cursor</span>, <span class="mono">code-insiders</span>… If it fails, the system's default app opens the file.</span>
        </div>
      </div>
    </section>

    <section class="setting-group" aria-labelledby="set-github">
      <h2 id="set-github">GitHub</h2>
      <div class="setting">
        <label for="set-token">Access token</label>
        <div class="setting__control">
          <p class="muted">${GITHUB[s.github.source]}</p>
          ${s.github.canSave
            ? html`<form class="setting__line" id="token-form">
                <input id="set-token" class="field mono" type="password" name="token" placeholder="${s.github.source === 'saved' ? 'Replace the saved token' : 'ghp_… or github_pat_…'}" autocomplete="off" spellcheck="false" data-focus="set-token">
                <button class="sh-btn" type="submit">Save token</button>
                ${s.github.source === 'saved' && html`<button class="sh-btn sh-btn--danger" type="button" data-act="clear-token">Remove</button>`}
              </form>`
            : html`<p class="setting__help">This system has no secure storage, so set GITHUB_TOKEN in your environment instead.</p>`}
          <span class="setting__help">A fine-grained token with read access to contents is enough. Skill Hub sends it only to api.github.com.</span>
        </div>
      </div>
    </section>

    <section class="setting-group" aria-labelledby="set-about">
      <h2 id="set-about">About</h2>
      <p class="muted">Skill Hub ${app.version}. Uses the same hub and lock files as the Skill Hub VS Code extension.</p>
    </section>
  </div>`;
}

async function save(patch: Partial<Omit<SettingsVM, 'github'>>): Promise<void> {
  await attempt(() => call('saveSettings', patch));
}

document.addEventListener('change', (event) => {
  const input = (event.target as Element).closest<HTMLInputElement>('[data-setting]');
  if (!input) return;
  const key = input.dataset.setting as 'libraryPath' | 'agentsSkillsFolder' | 'editorCommand';
  void save({ [key]: input.value });
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id === 'custom-target-form') {
    event.preventDefault();
    const data = new FormData(form);
    const target: CustomTargetVM = { id: String(data.get('id')).trim(), label: String(data.get('label')).trim() || undefined, folder: String(data.get('folder')).trim() };
    const app = store.app;
    if (!app) return;
    if (app.targets.some((t) => t.id === target.id)) {
      toast('warning', `There's already an agent with the id "${target.id}".`);
      return;
    }
    void save({ customTargets: [...app.settings.customTargets, target] });
  } else if (form.id === 'token-form') {
    event.preventDefault();
    const token = String(new FormData(form).get('token') ?? '').trim();
    if (!token) return;
    void attempt(async () => {
      await call('setGitHubToken', token);
      toast('info', 'Token saved.');
    });
  }
});

on('pick-library', () => {
  void attempt(async () => {
    const folder = await call('pickLibraryFolder');
    if (folder) await call('saveSettings', { libraryPath: folder });
  });
});
on('toggle-default-target', (el) => {
  const app = store.app;
  if (!app) return;
  const id = attr(el, 'data-id');
  const current = new Set(app.settings.defaultTargets);
  if (current.has(id)) current.delete(id);
  else current.add(id);
  if (!current.size) {
    toast('warning', 'Keep at least one default agent.');
    return;
  }
  app.settings.defaultTargets = [...current];
  rerender();
  void save({ defaultTargets: [...current] });
});
on('remove-custom-target', (el) => {
  const app = store.app;
  if (!app) return;
  const index = Number(attr(el, 'data-index'));
  void save({ customTargets: app.settings.customTargets.filter((_, i) => i !== index) });
});
on('clear-token', () => void attempt(() => call('setGitHubToken', null)));
