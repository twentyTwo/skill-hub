import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { slugify } from '../core/skill';
import { classifyInput, InputKind, RemoteSkill, sameSource, SkillProvider, SourceSpec } from '../core/sources';
import { searchGitHubSkills } from '../core/sources/search';
import { LibrarySkill, SkillSource } from '../core/types';
import { errorMessage } from '../core/util';
import { AddInbound, AddOutbound, FoundSkillVM } from '../shared/protocol';
import { Actions, guarded, resolveSpec } from './actions';
import { fileFolders, Hub } from './hub';
import { folderFor } from './refs';
import { webviewHtml, webviewOptions } from './webviewHtml';

export const ADD_VIEW_TYPE = 'skillHub.add';

/** What the results card currently lists: skills at one source, or GitHub search hits (each its own source). */
type Listing = { kind: 'source'; provider: SkillProvider; found: RemoteSkill[] } | { kind: 'search'; specs: SourceSpec[]; found: RemoteSkill[] };

/** The Add skills page (design §3.3), replacing the old chain of quick picks. */
export class AddPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private listing: Listing | undefined;
  private ready = false;
  private pending: AddInbound[] = [];
  private detectVersion = 0;
  private findVersion = 0;

  constructor(
    private readonly hub: Hub,
    private readonly actions: Actions,
    private readonly extensionUri: vscode.Uri,
  ) {}

  /** Opens the page, optionally with `input` filled in and listed. */
  show(input?: string): void {
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel(ADD_VIEW_TYPE, 'Add skills', vscode.ViewColumn.Active, {
        ...webviewOptions(this.extensionUri),
        retainContextWhenHidden: true,
      });
      panel.iconPath = {
        light: vscode.Uri.joinPath(this.extensionUri, 'media', 'skill-hub-tab-light.svg'),
        dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'skill-hub-tab.svg'),
      };
      panel.webview.html = webviewHtml(panel.webview, this.extensionUri, 'add.js', 'Add skills', 'sh-editor');
      panel.webview.onDidReceiveMessage(guarded((message: AddOutbound) => this.receive(message)));
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.ready = false;
        this.pending = [];
        void this.clearListing();
      });
      this.panel = panel;
    } else {
      this.panel.reveal();
    }
    if (input) this.post({ type: 'setInput', value: input, find: true });
  }

  private post(message: AddInbound): void {
    if (this.panel && this.ready) void this.panel.webview.postMessage(message);
    else this.pending.push(message);
  }

  private async receive(message: AddOutbound): Promise<void> {
    switch (message.type) {
      case 'ready': {
        this.ready = true;
        const folders = fileFolders();
        this.post({
          type: 'setup',
          setup: {
            folders: folders.map((f) => ({ root: f.uri.fsPath, name: f.name })),
            activeRoot: this.hub.activeFolder()?.uri.fsPath,
            targets: this.hub.targets().map((t) => ({ id: t.id, label: t.label })),
            defaultTargets: this.hub.config.get<string[]>('defaultTargets') ?? ['claude'],
          },
        });
        for (const queued of this.pending.splice(0)) this.post(queued);
        return;
      }
      case 'detect':
        return this.detect(message.value);
      case 'find':
        return this.find(message.value);
      case 'browse': {
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: message.folder,
          canSelectFiles: !message.folder,
          canSelectMany: false,
          openLabel: 'List Skills',
          filters: message.folder ? undefined : { Markdown: ['md', 'mdc', 'markdown'] },
        });
        if (uris?.[0]) this.post({ type: 'setInput', value: uris[0].fsPath, find: true });
        return;
      }
      case 'create':
        await vscode.commands.executeCommand('skillHub.createSkill');
        return;
      case 'add':
        return this.add(message.indices, message.apply);
    }
  }

  private async detect(value: string): Promise<void> {
    const version = ++this.detectVersion;
    let kind: InputKind = classifyInput(value).kind;
    let detail: string | undefined;
    if (kind !== 'empty' && kind !== 'search') {
      try {
        const spec = await resolveSpec(value);
        kind = spec.type;
        detail = describeSpec(spec);
        if (spec.type === 'local' && !(await fs.stat(spec.path).catch(() => undefined))) detail = `${detail} (not found)`;
      } catch {
        kind = 'search';
      }
    }
    if (version === this.detectVersion) this.post({ type: 'detected', value, kind, detail });
  }

  private async find(value: string): Promise<void> {
    const text = value.trim();
    if (!text) return;
    const version = ++this.findVersion;
    await this.clearListing();
    const search = classifyInput(text).kind === 'search';
    this.post({ type: 'busy', message: search ? `Searching GitHub for "${text}"…` : `Looking for skills in ${text}…` });
    try {
      let listing: Listing;
      let title: string;
      if (search) {
        const results = await searchGitHubSkills(this.hub.http, text);
        const specs = results.map((r): SourceSpec => ({ type: 'github', owner: r.owner, repo: r.repo, path: r.path }));
        const found = results.map(
          (r): RemoteSkill => ({
            kind: 'folder',
            name: r.name,
            description: r.description,
            path: `${r.owner}/${r.repo}${r.path ? `/${r.path}` : ''}`,
            source: { type: 'github', owner: r.owner, repo: r.repo, path: r.path },
          }),
        );
        listing = { kind: 'search', specs, found };
        title = `Found ${found.length} skill${found.length === 1 ? '' : 's'} on GitHub matching "${text}"`;
      } else {
        const { provider, found } = await this.actions.listSource(text);
        listing = { kind: 'source', provider, found };
        const what = found[0].kind === 'folder' ? 'skill' : 'markdown file';
        title = `Found ${found.length} ${what}${found.length === 1 ? '' : 's'} in ${provider.label}`;
      }
      if (version !== this.findVersion) {
        if (listing.kind === 'source') await listing.provider.dispose?.();
        return;
      }
      this.listing = listing;
      this.post({ type: 'found', title, skills: await this.describe(listing.found) });
    } catch (err) {
      if (version === this.findVersion) this.post({ type: 'error', message: errorMessage(err) });
    }
  }

  private async describe(found: RemoteSkill[]): Promise<FoundSkillVM[]> {
    const hubSkills = new Map((await this.hub.skills()).map((s) => [s.id, s]));
    return found.map((remote) => ({
      name: remote.name,
      description: remote.kind === 'folder' ? remote.description : remote.description || 'Markdown file, converted to SKILL.md',
      path: remote.path || '/',
      hub: hubStatus(hubSkills.get(slugify(remote.name)), remote.source),
    }));
  }

  private async add(indices: number[], apply: { root: string; targets: string[] } | undefined): Promise<void> {
    const listing = this.listing;
    if (!listing || !indices.length) return;
    const added: LibrarySkill[] = [];
    if (listing.kind === 'source') {
      added.push(...(await this.actions.importRemotes(listing.provider, indices.map((i) => listing.found[i]).filter(Boolean))));
    } else {
      for (const i of indices) {
        const spec = listing.specs[i];
        if (!spec) continue;
        const { provider, found } = await this.actions.listSource(spec);
        try {
          added.push(...(await this.actions.importRemotes(provider, found)));
        } finally {
          await provider.dispose?.();
        }
      }
    }
    this.hub.refresh(true);
    if (!added.length) return;

    const folder = apply && folderFor(apply.root);
    if (folder && apply.targets.length) await this.actions.applySkills(added, folder, { targets: apply.targets });
    const names = added.length === 1 ? `"${added[0].name}"` : `${added.length} skills`;
    this.post({ type: 'added', message: folder && apply?.targets.length ? `Added ${names} to your hub and applied to ${folder.name}.` : `Added ${names} to your hub.` });
    this.post({ type: 'found', title: '', skills: await this.describe(listing.found) });
  }

  private async clearListing(): Promise<void> {
    const listing = this.listing;
    this.listing = undefined;
    if (listing?.kind === 'source') await listing.provider.dispose?.();
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

function hubStatus(existing: LibrarySkill | undefined, source: SkillSource): FoundSkillVM['hub'] {
  if (!existing) return 'new';
  return sameSource(existing.source, source) ? 'inHub' : 'nameTaken';
}

function describeSpec(spec: SourceSpec): string {
  switch (spec.type) {
    case 'github': {
      const sub = spec.refPath?.length ? spec.refPath.join('/') : spec.path;
      return `github.com/${spec.owner}/${spec.repo}${sub ? ` → ${sub}` : ''}${spec.ref ? ` @ ${spec.ref}` : ''}`;
    }
    case 'git':
      return `${spec.url}${spec.path ? ` → ${spec.path}` : ''}${spec.ref ? ` @ ${spec.ref}` : ''} · cloned with git`;
    case 'url':
      return spec.url;
    case 'local':
      return spec.path;
  }
}
