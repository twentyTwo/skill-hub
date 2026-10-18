import * as vscode from 'vscode';
import { Ref } from './shared/protocol';
import { Actions, guarded, toPaths } from './ui/actions';
import { AddPanel } from './ui/addPanel';
import { Hub } from './ui/hub';
import { isLibrarySkill, LibraryView } from './ui/libraryView';
import { isRef, libraryRef, resolveArg, workspaceRef } from './ui/refs';
import { MAIN_VIEW, SidebarView } from './ui/sidebarView';
import { DETAIL_VIEW_TYPE, SkillPanels } from './ui/skillPanel';
import { StatusBar } from './ui/statusBar';
import { isWorkspaceNode, WorkspaceView } from './ui/workspaceView';

export function activate(context: vscode.ExtensionContext): void {
  const hub = new Hub();
  const actions = new Actions(hub);
  const panels = new SkillPanels(hub, actions, context.extensionUri);
  const sidebar = new SidebarView(hub, actions, panels, context.extensionUri);
  const addPanel = new AddPanel(hub, actions, context.extensionUri);
  const classic = () => hub.config.get<boolean>('classicViews', false);

  // The classic tree views, shown instead of the sidebar webview when `skillHub.classicViews` is on.
  const libraryView = new LibraryView(hub, guarded((paths: string[]) => actions.addSkill(paths)));
  const workspaceView = new WorkspaceView(hub, guarded((ids: string[], folder?: vscode.WorkspaceFolder) => actions.applyByIds(ids, folder)));
  const libraryTree = vscode.window.createTreeView('skillHub.library', {
    treeDataProvider: libraryView,
    dragAndDropController: libraryView,
    canSelectMany: true,
  });
  const workspaceTree = vscode.window.createTreeView('skillHub.workspace', {
    treeDataProvider: workspaceView,
    dragAndDropController: workspaceView,
    canSelectMany: true,
  });
  workspaceView.attach(workspaceTree);

  const commands: Record<string, (arg?: unknown, selected?: unknown) => Promise<unknown>> = {
    'skillHub.addSkill': (arg?: unknown, selected?: unknown) =>
      toPaths(arg, selected).length ? actions.addSkill(arg, selected) : Promise.resolve(addPanel.show()),
    'skillHub.addFromExplorer': (arg?: unknown, selected?: unknown) => actions.addSkill(arg, selected),
    'skillHub.searchSkills': () => (classic() ? actions.searchSkills() : sidebar.showTab('discover', true)),
    'skillHub.createSkill': () => actions.createSkill(),
    'skillHub.applySkill': (arg?: unknown, selected?: unknown) => actions.applyCommand(arg, selected),
    'skillHub.openSkill': (arg?: unknown) => actions.openSkill(arg),
    'skillHub.openDetails': async (arg?: unknown) => {
      const ref = toRef(arg);
      if (ref) panels.show(ref);
    },
    'skillHub.previewSkill': (arg?: unknown) => actions.previewSkill(arg),
    'skillHub.openSource': (arg?: unknown) => actions.openSource(arg),
    'skillHub.revealSkill': (arg?: unknown) => actions.revealSkill(arg),
    'skillHub.updateSkill': (arg?: unknown, selected?: unknown) => actions.updateSkill(arg, selected),
    'skillHub.updateAllSkills': () => actions.updateAllSkills(),
    'skillHub.deleteSkill': (arg?: unknown, selected?: unknown) => actions.deleteSkill(arg, selected),
    'skillHub.openLibraryFolder': () => actions.openLibraryFolder(),
    'skillHub.refresh': async () => hub.refresh(true),
    'skillHub.showRepo': () =>
      classic() ? Promise.resolve(vscode.commands.executeCommand('skillHub.workspace.focus')) : sidebar.showTab('repo'),
    'skillHub.workspace.open': (arg?: unknown) => actions.openWorkspaceSkill(arg),
    'skillHub.workspace.update': (arg?: unknown, selected?: unknown) => actions.updateInWorkspace(arg, selected),
    'skillHub.workspace.updateAll': (arg?: unknown) => actions.updateAllInWorkspace(arg),
    'skillHub.workspace.saveToHub': (arg?: unknown) => actions.saveToHub(arg),
    'skillHub.workspace.addToHub': (arg?: unknown) => actions.addToHub(arg),
    'skillHub.workspace.resolve': (arg?: unknown) => actions.resolveConflict(arg),
    'skillHub.workspace.changeTargets': (arg?: unknown) => actions.changeTargets(arg),
    'skillHub.workspace.remove': (arg?: unknown, selected?: unknown) => actions.removeFromWorkspace(arg, selected),
    'skillHub.workspace.restore': (arg?: unknown) => actions.restore(arg),
  };

  // Refs come from webview messages and webview context menus; resolve them into what the tree views pass.
  const withRefs =
    (handler: (arg?: unknown, selected?: unknown) => Promise<unknown>) =>
    async (arg?: unknown, selected?: unknown): Promise<unknown> =>
      handler(await resolveArg(hub, arg), Array.isArray(selected) ? selected : undefined);

  context.subscriptions.push(
    hub,
    panels,
    sidebar,
    addPanel,
    new StatusBar(hub),
    libraryTree,
    workspaceTree,
    vscode.window.registerWebviewViewProvider(MAIN_VIEW, sidebar),
    vscode.window.registerWebviewPanelSerializer(DETAIL_VIEW_TYPE, panels.serializer),
    ...Object.entries(commands).map(([id, handler]) =>
      vscode.commands.registerCommand(id, guarded(id === 'skillHub.openDetails' ? handler : withRefs(handler))),
    ),
  );
}

function toRef(arg: unknown): Ref | undefined {
  if (isRef(arg)) return arg;
  if (isLibrarySkill(arg)) return libraryRef(arg.id);
  if (isWorkspaceNode(arg) && arg.kind === 'skill') return workspaceRef(arg.folder.uri.fsPath, arg.skill.id);
  return undefined;
}

export function deactivate(): void {}
