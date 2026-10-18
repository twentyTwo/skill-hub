import * as vscode from 'vscode';
import { describeSource } from '../core/sources';
import { WorkspaceSkill } from '../core/workspace';
import { STATUS } from '../shared/status';
import { errorMessage } from '../core/util';
import { fileFolders, Hub } from './hub';
import { LIBRARY_MIME } from './libraryView';

export type WorkspaceNode =
  | { kind: 'folder'; folder: vscode.WorkspaceFolder }
  | { kind: 'skill'; folder: vscode.WorkspaceFolder; skill: WorkspaceSkill };

export function isWorkspaceNode(value: unknown): value is WorkspaceNode {
  return !!value && typeof value === 'object' && 'kind' in value && 'folder' in value;
}

export class WorkspaceView implements vscode.TreeDataProvider<WorkspaceNode>, vscode.TreeDragAndDropController<WorkspaceNode> {
  readonly dragMimeTypes: string[] = [];
  readonly dropMimeTypes = [LIBRARY_MIME];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private treeView?: vscode.TreeView<WorkspaceNode>;

  constructor(
    private readonly hub: Hub,
    private readonly onDropSkills: (ids: string[], folder: vscode.WorkspaceFolder | undefined) => Promise<void>,
  ) {
    hub.onDidChange(() => this.changed.fire());
  }

  attach(treeView: vscode.TreeView<WorkspaceNode>): void {
    this.treeView = treeView;
  }

  async getChildren(node?: WorkspaceNode): Promise<WorkspaceNode[]> {
    const folders = fileFolders();
    if (!node) {
      void this.updateBadge();
      if (folders.length === 1) return this.skills(folders[0]);
      return folders.map((folder) => ({ kind: 'folder', folder }));
    }
    return node.kind === 'folder' ? this.skills(node.folder) : [];
  }

  getTreeItem(node: WorkspaceNode): vscode.TreeItem {
    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(node.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.folder.uri.toString();
      item.iconPath = vscode.ThemeIcon.Folder;
      item.resourceUri = node.folder.uri;
      item.contextValue = 'workspaceFolder';
      return item;
    }

    const { skill } = node;
    const status = STATUS[skill.status];
    const targets = this.hub.targets();
    const labelOf = (id: string) => targets.find((t) => t.id === id)?.label ?? id;
    const where = skill.installed.map(labelOf).join(', ');
    const notes = [
      skill.status !== 'synced' && status.label,
      skill.missing.length > 0 && skill.installed.length > 0 && `missing for ${skill.missing.map(labelOf).join(', ')}`,
      skill.lock && !skill.hub && 'not in your hub',
    ].filter(Boolean);

    const item = new vscode.TreeItem(skill.name, vscode.TreeItemCollapsibleState.None);
    item.id = `${skill.root}::${skill.id}`;
    item.description = [where, ...notes].filter(Boolean).join(' · ');
    item.iconPath = new vscode.ThemeIcon(status.icon, status.color ? new vscode.ThemeColor(status.color) : undefined);
    item.tooltip = tooltip(skill, status.label, where);
    item.contextValue = contextValue(skill);
    if (skill.entryFile) item.command = { command: 'skillHub.workspace.open', title: 'Open', arguments: [node] };
    return item;
  }

  async handleDrop(target: WorkspaceNode | undefined, data: vscode.DataTransfer): Promise<void> {
    const raw = await data.get(LIBRARY_MIME)?.asString();
    if (!raw) return;
    await this.onDropSkills(JSON.parse(raw) as string[], target?.folder);
  }

  private async skills(folder: vscode.WorkspaceFolder): Promise<WorkspaceNode[]> {
    try {
      return (await this.hub.workspaceSkills(folder)).map((skill) => ({ kind: 'skill', folder, skill }));
    } catch (err) {
      void vscode.window.showErrorMessage(`Skill Hub: could not read skills in ${folder.name}: ${errorMessage(err)}`);
      return [];
    }
  }

  private async updateBadge(): Promise<void> {
    if (this.treeView) this.treeView.badge = attentionBadge(await this.hub.attentionCount());
  }
}

export function attentionBadge(count: number): vscode.ViewBadge | undefined {
  return count ? { value: count, tooltip: `${count} skill${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} an update` } : undefined;
}

/** Space-separated flags matched by the `viewItem =~ /\bflag\b/` menu conditions in package.json. */
export function contextValue(skill: WorkspaceSkill): string {
  const flags = ['workspaceSkill'];
  if (skill.lock) flags.push('managed');
  if (skill.entryFile) flags.push('openable');
  if (skill.lock && (skill.status === 'outdated' || skill.status === 'conflict' || skill.status === 'missing' || skill.missing.length)) flags.push('syncable');
  if (skill.localDir && skill.hub && (skill.status === 'modified' || skill.status === 'conflict')) flags.push('pushable');
  if (!skill.hub && (skill.localDir || skill.lock)) flags.push('adoptable');
  if (skill.status === 'conflict' && skill.hub) flags.push('conflicted');
  return flags.join(' ');
}

function tooltip(skill: WorkspaceSkill, statusLabel: string, where: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${skill.name}**\n\n`);
  md.appendText(skill.description || 'No description.');
  md.appendMarkdown('\n\n---\n\n');
  md.appendText(`Status: ${statusLabel}\n`);
  if (where) md.appendText(`Installed for: ${where}\n`);
  if (skill.lock) md.appendText(`Source: ${describeSource(skill.lock.source)}\n`);
  if (skill.lock?.appliedAt) md.appendText(`Applied: ${new Date(skill.lock.appliedAt).toLocaleString()}`);
  return md;
}
