import * as vscode from 'vscode';
import { LibrarySkill } from '../core/types';
import { Ref } from '../shared/protocol';
import { fileFolders, Hub } from './hub';
import { WorkspaceNode } from './workspaceView';

export function isRef(value: unknown): value is Ref {
  return !!value && typeof value === 'object' && typeof (value as { refKind?: unknown }).refKind === 'string';
}

export function libraryRef(id: string): Ref {
  return { refKind: 'library', refId: id };
}

export function workspaceRef(root: string, id: string): Ref {
  return { refKind: 'workspace', refRoot: root, refId: id };
}

/** Stable key for a ref, used to find an open detail panel and to mark the selected row. */
export function refKey(ref: Ref): string {
  switch (ref.refKind) {
    case 'library':
      return `library:${ref.refId}`;
    case 'workspace':
      return `workspace:${ref.refRoot}:${ref.refId}`;
    case 'folder':
      return `folder:${ref.refRoot}`;
  }
}

export function folderFor(root: string): vscode.WorkspaceFolder | undefined {
  return fileFolders().find((f) => f.uri.fsPath === root);
}

/**
 * Turns a ref (from a webview message or a webview context menu, which passes its `data-vscode-context`) into the
 * argument the tree views would pass: a LibrarySkill or a WorkspaceNode. Anything else is returned unchanged.
 */
export async function resolveArg(hub: Hub, arg: unknown): Promise<unknown> {
  if (!isRef(arg)) return arg;
  if (arg.refKind === 'library') {
    const skill = (await hub.skills()).find((s) => s.id === arg.refId);
    if (!skill) throw new Error(`"${arg.refId}" is no longer in your hub.`);
    return skill satisfies LibrarySkill;
  }
  const folder = folderFor(arg.refRoot);
  if (!folder) throw new Error(`${arg.refRoot} is no longer open in this window.`);
  if (arg.refKind === 'folder') return { kind: 'folder', folder } satisfies WorkspaceNode;
  const skill = (await hub.workspaceSkills(folder)).find((s) => s.id === arg.refId);
  if (!skill) throw new Error(`"${arg.refId}" is no longer in ${folder.name}.`);
  return { kind: 'skill', folder, skill } satisfies WorkspaceNode;
}
