import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { exists } from '../core/fsutil';
import { Library } from '../core/library';
import { readLock } from '../core/lock';

interface Manifest {
  contributes: { commands: { command: string }[]; menus: Record<string, { command: string }[]> };
}

/** Runs inside the VS Code extension host. Throwing fails the run. */
export async function run(): Promise<void> {
  const tmp = process.env.SKILL_HUB_TEST_TMP!;
  const hubDir = path.join(tmp, 'hub');
  const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;

  const config = vscode.workspace.getConfiguration('skillHub');
  await config.update('libraryPath', hubDir, vscode.ConfigurationTarget.Global);
  await config.update('promptForTargets', false, vscode.ConfigurationTarget.Global);
  await config.update('defaultTargets', ['claude', 'cursor'], vscode.ConfigurationTarget.Global);

  const ext = vscode.extensions.getExtension('noorashuvo.skill-hub');
  assert.ok(ext, 'extension is installed');
  await ext.activate();
  step('activated');

  const manifest = ext.packageJSON as Manifest;
  const registered = new Set(await vscode.commands.getCommands(true));
  const contributed = new Set(manifest.contributes.commands.map((c) => c.command));
  for (const command of contributed) assert.ok(registered.has(command), `${command} is registered`);
  for (const [menu, items] of Object.entries(manifest.contributes.menus)) {
    for (const item of items) assert.ok(contributed.has(item.command), `${menu} refers to unknown command ${item.command}`);
  }
  step(`${contributed.size} commands registered, menus consistent`);

  await vscode.commands.executeCommand('workbench.view.extension.skillHub');

  // Add a local skill the way the Explorer context menu does.
  const source = path.join(tmp, 'source', 'review-checklist');
  await fs.mkdir(path.join(source, 'templates'), { recursive: true });
  await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: review-checklist\ndescription: Checklist for code reviews.\n---\n\n# Review\n');
  await fs.writeFile(path.join(source, 'templates', 'pr.md'), 'template');
  await vscode.commands.executeCommand('skillHub.addFromExplorer', vscode.Uri.file(source), [vscode.Uri.file(source)]);
  const skill = await new Library(hubDir).get('review-checklist');
  assert.ok(skill, 'skill was added to the configured hub');
  step('added skill from a local folder');

  // Apply it as the Library's inline button does.
  await vscode.commands.executeCommand('skillHub.applySkill', skill);
  assert.ok(await exists(path.join(workspace, '.claude/skills/review-checklist/templates/pr.md')), 'installed for Claude Code');
  assert.ok(await exists(path.join(workspace, '.cursor/rules/review-checklist.mdc')), 'installed for Cursor');
  assert.deepEqual(Object.keys((await readLock(workspace)).skills['review-checklist'].targets).sort(), ['claude', 'cursor']);
  step('applied to workspace for Claude Code and Cursor');

  // Change the hub copy, then update the workspace from it.
  await fs.writeFile(path.join(skill.dir, 'SKILL.md'), '---\nname: review-checklist\ndescription: Checklist for code reviews, v2.\n---\n\n# Review v2\n');
  await vscode.commands.executeCommand('skillHub.refresh');
  await vscode.commands.executeCommand('skillHub.workspace.updateAll');
  assert.match(await fs.readFile(path.join(workspace, '.claude/skills/review-checklist/SKILL.md'), 'utf8'), /v2/);
  assert.match(await fs.readFile(path.join(workspace, '.cursor/rules/review-checklist.mdc'), 'utf8'), /v2/);
  step('updated workspace from hub');

  // The sidebar webview sends refs instead of tree nodes; commands resolve them.
  await fs.writeFile(path.join(skill.dir, 'SKILL.md'), '---\nname: review-checklist\ndescription: Checklist for code reviews, v3.\n---\n\n# Review v3\n');
  await vscode.commands.executeCommand('skillHub.refresh');
  await vscode.commands.executeCommand('skillHub.workspace.update', { refKind: 'workspace', refRoot: workspace, refId: 'review-checklist' });
  assert.match(await fs.readFile(path.join(workspace, '.claude/skills/review-checklist/SKILL.md'), 'utf8'), /v3/);
  step('updated a skill from a webview ref');

  await vscode.commands.executeCommand('skillHub.main.focus');
  step('sidebar webview resolves');

  await vscode.commands.executeCommand('skillHub.openDetails', { refKind: 'library', refId: 'review-checklist' });
  await waitFor(() => openTab('review-checklist', 'skillHub.detail'), 'skill detail panel opens');
  step('opened the skill detail page');

  await vscode.commands.executeCommand('skillHub.addSkill');
  await waitFor(() => openTab('Add skills', 'skillHub.add'), 'Add skills panel opens');
  step('opened the Add skills page');
}

function openTab(label: string, viewType: string): boolean {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .some((tab) => tab.label === label && tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(viewType));
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting: ${what}`);
}

function step(message: string): void {
  console.log(`  ✓ ${message}`);
}
