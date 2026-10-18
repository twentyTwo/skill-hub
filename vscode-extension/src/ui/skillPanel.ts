import * as path from 'path';
import * as vscode from 'vscode';
import { isInside } from '../core/fsutil';
import { sourceWebUrl } from '../core/sources';
import { DetailOutbound, DetailSpec, Ref } from '../shared/protocol';
import { Actions, guarded, skillFileUri } from './actions';
import { Hub } from './hub';
import { detailState } from './model';
import { folderFor, libraryRef, workspaceRef } from './refs';
import { webviewHtml, webviewOptions } from './webviewHtml';

export const DETAIL_VIEW_TYPE = 'skillHub.detail';

/** Commands the detail page may run, and whether they act on the workspace copy or the hub copy. */
const DETAIL_COMMANDS: Record<string, 'workspace' | 'library'> = {
  'skillHub.workspace.update': 'workspace',
  'skillHub.workspace.saveToHub': 'workspace',
  'skillHub.workspace.addToHub': 'workspace',
  'skillHub.workspace.resolve': 'workspace',
  'skillHub.workspace.remove': 'workspace',
  'skillHub.updateSkill': 'library',
  'skillHub.deleteSkill': 'library',
  'skillHub.customizeSkill': 'library',
};

/** The skill detail pages (design §3.2): one editor tab per skill and folder. */
export class SkillPanels implements vscode.Disposable {
  private readonly panels = new Map<string, DetailPanel>();
  private readonly activeChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeActive = this.activeChanged.event;
  private activeSpec: DetailSpec | undefined;

  constructor(
    private readonly hub: Hub,
    private readonly actions: Actions,
    private readonly extensionUri: vscode.Uri,
  ) {}

  /** The skill in the focused detail panel, if one is focused. */
  get active(): DetailSpec | undefined {
    return this.activeSpec;
  }

  /** Opens or reveals the detail page. A library skill is shown as seen from the sidebar's active folder. */
  show(ref: Ref): void {
    if (ref.refKind === 'folder') return;
    const spec: DetailSpec = ref.refKind === 'workspace' ? { id: ref.refId, root: ref.refRoot } : { id: ref.refId, root: this.hub.activeFolder()?.uri.fsPath };
    const existing = this.panels.get(key(spec));
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(DETAIL_VIEW_TYPE, spec.id, vscode.ViewColumn.Active, webviewOptions(this.extensionUri));
    this.attach(panel, spec);
  }

  /** Restores a panel after a window reload. */
  readonly serializer: vscode.WebviewPanelSerializer<{ spec?: DetailSpec }> = {
    deserializeWebviewPanel: async (panel, state) => {
      if (!state?.spec?.id) {
        panel.dispose();
        return;
      }
      panel.webview.options = webviewOptions(this.extensionUri);
      this.attach(panel, state.spec);
    },
  };

  private attach(panel: vscode.WebviewPanel, spec: DetailSpec): void {
    const k = key(spec);
    const detail = new DetailPanel(panel, spec, this.hub, this.actions, this.extensionUri);
    this.panels.set(k, detail);
    const setActive = () => {
      if (panel.active) this.activeSpec = spec;
      else if (this.activeSpec && key(this.activeSpec) === k) this.activeSpec = undefined;
      this.activeChanged.fire();
    };
    panel.onDidChangeViewState(setActive);
    panel.onDidDispose(() => {
      this.panels.delete(k);
      detail.dispose();
      if (this.activeSpec && key(this.activeSpec) === k) this.activeSpec = undefined;
      this.activeChanged.fire();
    });
    setActive();
  }

  dispose(): void {
    for (const detail of this.panels.values()) detail.panel.dispose();
    this.activeChanged.dispose();
  }
}

function key(spec: DetailSpec): string {
  return `${spec.root ?? ''}::${spec.id}`;
}

class DetailPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private version = 0;

  constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly spec: DetailSpec,
    private readonly hub: Hub,
    private readonly actions: Actions,
    extensionUri: vscode.Uri,
  ) {
    panel.title = spec.id;
    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'media', 'skill-hub-tab-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'media', 'skill-hub-tab.svg'),
    };
    panel.webview.html = webviewHtml(panel.webview, extensionUri, 'detail.js', 'Skill details', 'sh-editor');
    this.disposables.push(
      panel.webview.onDidReceiveMessage(guarded((message: DetailOutbound) => this.receive(message))),
      hub.onDidChange(() => void this.update()),
    );
  }

  private get folder(): vscode.WorkspaceFolder | undefined {
    return this.spec.root ? folderFor(this.spec.root) : undefined;
  }

  private async update(): Promise<void> {
    const version = ++this.version;
    const state = await detailState(this.hub, this.spec.id, this.folder);
    if (version !== this.version) return;
    this.panel.title = state.name;
    void this.panel.webview.postMessage({ type: 'state', state, spec: this.spec });
  }

  private async receive(message: DetailOutbound): Promise<void> {
    const folder = this.folder;
    switch (message.type) {
      case 'ready':
        return this.update();
      case 'command': {
        const kind = DETAIL_COMMANDS[message.id];
        if (!kind) return;
        const ref = kind === 'workspace' && folder ? workspaceRef(folder.uri.fsPath, this.spec.id) : libraryRef(this.spec.id);
        await vscode.commands.executeCommand(message.id, ref);
        return;
      }
      case 'apply': {
        const local = folder && (await this.hub.workspaceSkills(folder)).find((s) => s.id === this.spec.id);
        if (local?.lock) {
          await vscode.commands.executeCommand('skillHub.workspace.changeTargets', workspaceRef(folder!.uri.fsPath, this.spec.id));
          return;
        }
        const hubSkill = await this.hub.library.get(this.spec.id);
        if (hubSkill) await this.actions.applySkills([hubSkill], folder);
        else if (local) await vscode.commands.executeCommand('skillHub.workspace.addToHub', workspaceRef(folder!.uri.fsPath, this.spec.id));
        return;
      }
      case 'install':
        if (folder) await this.actions.installForTarget(this.spec.id, folder, message.target);
        return;
      case 'openSkillFile': {
        const file = await this.skillFile();
        if (file) await vscode.window.showTextDocument(file, { preview: true });
        return;
      }
      case 'openFile': {
        const dir = await this.skillDir();
        const file = dir && path.join(dir, ...message.file.split('/'));
        if (file && isInside(dir, file)) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
        return;
      }
      case 'openSource': {
        const local = folder && (await this.hub.workspaceSkills(folder)).find((s) => s.id === this.spec.id);
        const source = local?.lock?.source ?? (await this.hub.library.get(this.spec.id))?.source;
        const url = source && sourceWebUrl(source);
        if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
        return;
      }
    }
  }

  /** The copy the page describes: the one in the folder when it has one, else the hub's. */
  private async skillDir(): Promise<string | undefined> {
    const folder = this.folder;
    const local = folder && (await this.hub.workspaceSkills(folder)).find((s) => s.id === this.spec.id);
    return local?.localDir ?? (await this.hub.library.get(this.spec.id))?.dir;
  }

  private async skillFile(): Promise<vscode.Uri | undefined> {
    const folder = this.folder;
    const local = folder && (await this.hub.workspaceSkills(folder)).find((s) => s.id === this.spec.id);
    if (local?.entryFile) return vscode.Uri.file(local.entryFile);
    const hubSkill = await this.hub.library.get(this.spec.id);
    return hubSkill && skillFileUri(hubSkill.dir);
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
