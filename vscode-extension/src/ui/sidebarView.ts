import * as vscode from 'vscode';
import { slugify } from '../core/skill';
import { searchGitHubSkills } from '../core/sources/search';
import { errorMessage } from '../core/util';
import { SidebarInbound, SidebarOutbound, SidebarTab } from '../shared/protocol';
import { Actions, guarded } from './actions';
import { Hub } from './hub';
import { sidebarState } from './model';
import { SkillPanels } from './skillPanel';
import { webviewHtml, webviewOptions } from './webviewHtml';
import { attentionBadge } from './workspaceView';

export const MAIN_VIEW = 'skillHub.main';

/** The Skill Hub sidebar (design §3.1): one webview with This repo, Library and Discover tabs. */
export class SidebarView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private pending: SidebarInbound[] = [];
  private version = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly hub: Hub,
    private readonly actions: Actions,
    private readonly panels: SkillPanels,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.disposables.push(
      hub.onDidChange(() => void this.update()),
      panels.onDidChangeActive(() => void this.update()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'sidebar.js', 'Skill Hub', 'sh-sidebar');
    view.webview.onDidReceiveMessage(guarded((message: SidebarOutbound) => this.receive(message)));
    view.onDidChangeVisibility(() => {
      // A hidden webview's page is torn down; the next one says `ready` again, and messages wait until then.
      if (!view.visible) this.ready = false;
      void this.update();
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
    void this.update();
  }

  /** Reveals the sidebar on `tab` (used by the Search command and the status bar). */
  async showTab(tab: SidebarTab, focus = false): Promise<void> {
    await vscode.commands.executeCommand(`${MAIN_VIEW}.focus`);
    this.post({ type: 'showTab', tab, focus });
  }

  private post(message: SidebarInbound): void {
    if (this.view && this.ready) void this.view.webview.postMessage(message);
    else this.pending.push(message);
  }

  private async update(): Promise<void> {
    const view = this.view;
    if (!view) return;
    const version = ++this.version;
    view.badge = attentionBadge(await this.hub.attentionCount());
    if (!this.ready || !view.visible) return;
    const state = await sidebarState(this.hub, this.panels.active);
    if (version === this.version) void view.webview.postMessage({ type: 'state', state } satisfies SidebarInbound);
  }

  private async receive(message: SidebarOutbound): Promise<void> {
    switch (message.type) {
      case 'ready': {
        this.ready = true;
        await this.update();
        for (const queued of this.pending.splice(0)) this.post(queued);
        return;
      }
      case 'command':
        if (message.id.startsWith('skillHub.') || message.id === 'workbench.action.files.openFolder') await vscode.commands.executeCommand(message.id, message.ref);
        return;
      case 'open':
        this.panels.show(message.ref);
        return;
      case 'selectFolder':
        this.hub.setActiveFolder(message.root);
        return;
      case 'apply':
        await this.actions.applyByIds(message.ids, this.hub.activeFolder());
        return;
      case 'search':
        return this.search(message.query);
      case 'addSearchResult': {
        const { owner, repo, path } = message.result;
        await this.actions.addSearchResult({ type: 'github', owner, repo, path });
        return;
      }
      case 'addPaths': {
        const paths = message.uris
          .map((text) => vscode.Uri.parse(text))
          .filter((uri) => uri.scheme === 'file')
          .map((uri) => uri.fsPath);
        if (paths.length) await this.actions.addSkill(paths);
        return;
      }
    }
  }

  private async search(query: string): Promise<void> {
    const text = query.trim();
    if (!text) return;
    this.post({ type: 'searchStarted', query: text });
    try {
      const results = await searchGitHubSkills(this.hub.http, text);
      this.post({
        type: 'searchResults',
        query: text,
        results: results.map((r) => ({ id: slugify(r.name), name: r.name, description: r.description, owner: r.owner, repo: r.repo, path: r.path, url: r.url })),
      });
    } catch (err) {
      this.post({ type: 'searchError', query: text, message: errorMessage(err) });
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
