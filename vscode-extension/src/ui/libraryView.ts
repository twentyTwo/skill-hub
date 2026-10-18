import * as vscode from 'vscode';
import { canUpdate, describeSource, sourceWebUrl } from '../core/sources';
import { LibrarySkill, SkillSource } from '../core/types';
import { errorMessage } from '../core/util';
import { Hub } from './hub';

export const LIBRARY_MIME = 'application/vnd.code.tree.skillhub.library';

const SOURCE_ICONS: Record<SkillSource['type'], string> = {
  github: 'github',
  git: 'source-control',
  url: 'globe',
  local: 'folder',
  created: 'sparkle',
};

export function isLibrarySkill(value: unknown): value is LibrarySkill {
  return !!value && typeof value === 'object' && 'dir' in value && 'hash' in value && 'source' in value;
}

export class LibraryView implements vscode.TreeDataProvider<LibrarySkill>, vscode.TreeDragAndDropController<LibrarySkill> {
  readonly dragMimeTypes = [LIBRARY_MIME];
  readonly dropMimeTypes = ['text/uri-list'];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly hub: Hub,
    private readonly onDropPaths: (paths: string[]) => Promise<void>,
  ) {
    hub.onDidChange(() => this.changed.fire());
  }

  async getChildren(element?: LibrarySkill): Promise<LibrarySkill[]> {
    if (element) return [];
    try {
      return await this.hub.skills();
    } catch (err) {
      void vscode.window.showErrorMessage(`Skill Hub: could not read ${this.hub.library.root}: ${errorMessage(err)}`);
      return [];
    }
  }

  getTreeItem(skill: LibrarySkill): vscode.TreeItem {
    const item = new vscode.TreeItem(skill.name, vscode.TreeItemCollapsibleState.None);
    item.id = skill.id;
    item.description = skill.description;
    item.tooltip = tooltip(skill);
    item.iconPath = new vscode.ThemeIcon(SOURCE_ICONS[skill.source.type]);
    item.contextValue = libraryFlags(skill);
    item.command = { command: 'skillHub.openSkill', title: 'Open Skill', arguments: [skill] };
    return item;
  }

  handleDrag(source: readonly LibrarySkill[], data: vscode.DataTransfer): void {
    data.set(LIBRARY_MIME, new vscode.DataTransferItem(JSON.stringify(source.map((s) => s.id))));
  }

  /** Dropping folders or markdown files from the Explorer adds them to the hub. */
  async handleDrop(_target: LibrarySkill | undefined, data: vscode.DataTransfer): Promise<void> {
    const uris = await data.get('text/uri-list')?.asString();
    if (!uris) return;
    const paths = uris
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => vscode.Uri.parse(line))
      .filter((uri) => uri.scheme === 'file')
      .map((uri) => uri.fsPath);
    if (paths.length) await this.onDropPaths(paths);
  }
}

/** Space-separated flags matched by the `viewItem =~ /\bflag\b/` menu conditions in package.json. */
export function libraryFlags(skill: LibrarySkill): string {
  return ['librarySkill', canUpdate(skill.source) && 'updatable', sourceWebUrl(skill.source) && 'web'].filter(Boolean).join(' ');
}

function tooltip(skill: LibrarySkill): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${escape(skill.name)}**\n\n`);
  md.appendText(skill.description || 'No description.');
  md.appendMarkdown(`\n\n---\n\n$(${SOURCE_ICONS[skill.source.type]}) ${escape(describeSource(skill.source))}  \n`);
  md.appendMarkdown(`Updated ${new Date(skill.updatedAt).toLocaleString()}`);
  return md;
}

function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
