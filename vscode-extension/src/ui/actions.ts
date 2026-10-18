import * as path from 'path';
import * as vscode from 'vscode';
import { exists } from '../core/fsutil';
import { SkillExistsError } from '../core/library';
import { readLock } from '../core/lock';
import { SKILL_FILE, findSkillFile, slugify, validateSkillName } from '../core/skill';
import {
  canUpdate,
  createProvider,
  describeSource,
  fetchFromSource,
  importSkill,
  parseSourceInput,
  RemoteSkill,
  sameSource,
  SkillProvider,
  SourceSpec,
  sourceWebUrl,
} from '../core/sources';
import { searchGitHubSkills } from '../core/sources/search';
import { Target } from '../core/targets';
import { LibrarySkill } from '../core/types';
import { errorMessage } from '../core/util';
import { applySkill, removeSkill, saveToHub, WorkspaceSkill } from '../core/workspace';
import { fileFolders, Hub } from './hub';
import { isLibrarySkill } from './libraryView';
import { isWorkspaceNode, WorkspaceNode } from './workspaceView';

type SkillNode = Extract<WorkspaceNode, { kind: 'skill' }>;

/** Everything the commands do. Arguments arrive from tree items, menus, drag and drop, or nothing (Command Palette). */
export class Actions {
  constructor(private readonly hub: Hub) {}

  // ---------------------------------------------------------------- Library

  /** Adds the paths from an Explorer menu or drop. Without paths, extension.ts opens the Add skills panel instead. */
  async addSkill(arg?: unknown, selected?: unknown): Promise<void> {
    const inputs = toPaths(arg, selected);
    if (inputs.length) await this.addFromSources(inputs);
  }

  /** Adds one GitHub search result. */
  async addSearchResult(spec: SourceSpec): Promise<void> {
    await this.addFromSources([spec]);
  }

  async searchSkills(query?: string): Promise<void> {
    query ??= await vscode.window.showInputBox({
      title: 'Search GitHub for Skills',
      prompt: 'Searches SKILL.md files in public GitHub repositories',
      placeHolder: 'e.g. pdf, react testing, terraform',
      ignoreFocusOut: true,
    });
    const text = query?.trim();
    if (!text) return;
    const results = await progress(`Searching GitHub for "${text}"…`, () => searchGitHubSkills(this.hub.http, text));
    if (!results.length) {
      void vscode.window.showInformationMessage(`No skills on GitHub match "${text}".`);
      return;
    }
    const inHub = new Set((await this.hub.skills()).map((s) => s.id));
    const picks = await vscode.window.showQuickPick(
      results.map((result) => ({
        label: result.name,
        description: `${inHub.has(slugify(result.name)) ? '$(check) in hub · ' : ''}${result.owner}/${result.repo}${result.path ? `/${result.path}` : ''}`,
        detail: result.description,
        result,
      })),
      {
        title: `${results.length} skills on GitHub matching "${text}"`,
        placeHolder: 'Select the skills to add to your hub',
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      },
    );
    if (!picks?.length) return;
    await this.addFromSources(picks.map(({ result }): SourceSpec => ({ type: 'github', owner: result.owner, repo: result.repo, path: result.path })));
  }

  private async addFromSources(inputs: (string | SourceSpec)[]): Promise<void> {
    const added: LibrarySkill[] = [];
    for (const input of inputs) added.push(...(await this.addFromInput(input)));
    this.hub.refresh(true);
    if (!added.length) return;

    const names = added.length === 1 ? `"${added[0].name}"` : `${added.length} skills`;
    const actions = fileFolders().length ? ['Apply to Workspace'] : [];
    void vscode.window.showInformationMessage(`Added ${names} to Skill Hub.`, ...actions).then(
      guarded(async (choice) => {
        if (choice) await this.applySkills(added);
      }),
    );
  }

  private async addFromInput(input: string | SourceSpec): Promise<LibrarySkill[]> {
    const { provider, found } = await progress('Looking for skills…', () => this.listSource(input));
    try {
      const chosen = found.length === 1 ? found : await this.pickRemote(found, provider.label);
      return chosen?.length ? await this.importRemotes(provider, chosen) : [];
    } finally {
      await provider.dispose?.();
    }
  }

  /** Lists the skills at a source. The caller owns the returned provider and must dispose it. */
  async listSource(input: string | SourceSpec): Promise<{ provider: SkillProvider; found: RemoteSkill[] }> {
    const provider = createProvider(typeof input === 'string' ? await resolveSpec(input) : input, this.hub.http);
    try {
      const found = await provider.list();
      if (!found.length) throw new Error(`No skills or markdown files found in ${provider.label}.`);
      return { provider, found };
    } catch (err) {
      await provider.dispose?.();
      throw err;
    }
  }

  /** Downloads `chosen` from `provider` into the hub, asking what to do about name clashes. */
  async importRemotes(provider: SkillProvider, chosen: RemoteSkill[]): Promise<LibrarySkill[]> {
    const plan: { remote: RemoteSkill; id: string }[] = [];
    for (const remote of chosen) {
      const id = await this.resolveId(remote);
      if (id) plan.push({ remote, id });
    }
    return progress('Adding skills…', async (report) => {
      const added: LibrarySkill[] = [];
      for (const { remote, id } of plan) {
        report.report({ message: remote.name });
        added.push(await importSkill(provider, remote, this.hub.library, id));
      }
      return added;
    });
  }

  private async pickRemote(found: RemoteSkill[], label: string): Promise<RemoteSkill[] | undefined> {
    const inHub = new Set((await this.hub.skills()).map((s) => s.id));
    const picks = await vscode.window.showQuickPick(
      found.map((remote) => ({
        label: remote.name,
        description: `${inHub.has(slugify(remote.name)) ? '$(check) in hub · ' : ''}${remote.path || '/'}`,
        detail: remote.kind === 'folder' ? remote.description : `Markdown file, will be converted to ${SKILL_FILE}`,
        remote,
      })),
      {
        title: `${found.length} ${found[0].kind === 'folder' ? 'skills' : 'markdown files'} found in ${label}`,
        placeHolder: 'Select what to add to your hub',
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      },
    );
    return picks?.map((p) => p.remote);
  }

  /** The hub id to store a skill under, asking what to do when the name is taken by a different skill. */
  private async resolveId(remote: RemoteSkill): Promise<string | undefined> {
    const id = slugify(remote.name);
    const existing = await this.hub.library.get(id);
    if (!existing || sameSource(existing.source, remote.source)) return id;
    const choice = await vscode.window.showWarningMessage(
      `Your hub already has a skill named "${existing.name}".`,
      { modal: true, detail: `Existing: ${describeSource(existing.source)}\nNew: ${describeSource(remote.source)}` },
      'Replace',
      'Keep Both',
    );
    if (choice === 'Replace') return id;
    if (choice === 'Keep Both') return this.hub.library.uniqueId(id);
    return undefined;
  }

  async createSkill(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'Create Skill (1/2)',
      prompt: 'Skill name',
      placeHolder: 'e.g. api-conventions',
      ignoreFocusOut: true,
      validateInput: async (value) =>
        validateSkillName(value.trim()) ?? ((await this.hub.library.has(value.trim())) ? 'A skill with this name is already in your hub.' : undefined),
    });
    if (!name) return;
    const description = await vscode.window.showInputBox({
      title: 'Create Skill (2/2)',
      prompt: 'What does it do, and when should an agent use it?',
      placeHolder: 'e.g. Conventions for our REST API. Use when adding or changing endpoints.',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Agents use the description to decide when to load the skill.'),
    });
    if (!description) return;
    const skill = await this.hub.library.create(name.trim(), description.trim());
    this.hub.refresh(true);
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(skill.dir, SKILL_FILE)));
  }

  async openSkill(arg?: unknown): Promise<void> {
    const [skill] = isLibrarySkill(arg) ? [arg] : ((await this.pickLibrarySkills('Open Skill', false)) ?? []);
    if (!skill) return;
    await vscode.window.showTextDocument(await skillFileUri(skill.dir), { preview: true });
    // Built-in skills live in the extension's own folder; edits belong in a hub copy.
    if (skill.builtin) await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
  }

  /** Copies a built-in skill into the hub so it can be edited, then opens the copy. */
  async customizeSkill(arg?: unknown): Promise<void> {
    const [skill] = isLibrarySkill(arg) ? [arg] : ((await this.pickLibrarySkills('Copy to Hub to Edit', false, (s) => !!s.builtin)) ?? []);
    if (!skill?.builtin) return;
    const copy = await this.hub.library.copyBuiltin(skill.id);
    this.hub.refresh(true);
    await vscode.window.showTextDocument(await skillFileUri(copy.dir));
    void vscode.window.showInformationMessage(`Copied "${skill.name}" to your hub. Your copy now replaces the built-in one; remove it to go back.`);
  }

  async previewSkill(arg?: unknown): Promise<void> {
    const [skill] = isLibrarySkill(arg) ? [arg] : ((await this.pickLibrarySkills('Preview Skill', false)) ?? []);
    if (skill) await vscode.commands.executeCommand('markdown.showPreview', await skillFileUri(skill.dir));
  }

  async revealSkill(arg?: unknown): Promise<void> {
    if (isLibrarySkill(arg)) await vscode.commands.executeCommand('revealFileInOS', await skillFileUri(arg.dir));
  }

  async openSource(arg?: unknown): Promise<void> {
    const url = isLibrarySkill(arg) ? sourceWebUrl(arg.source) : undefined;
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async openLibraryFolder(): Promise<void> {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(this.hub.library.root), { forceNewWindow: true });
  }

  async deleteSkill(arg?: unknown, selected?: unknown): Promise<void> {
    const picked = selection(arg, selected, isLibrarySkill) ?? (await this.pickLibrarySkills('Remove Skills from Hub', true, (s) => !s.builtin));
    if (!picked?.length) return;
    const skills = picked.filter((s) => !s.builtin);
    if (!skills.length) {
      void vscode.window.showInformationMessage("Built-in skills come with Skill Hub and can't be removed.");
      return;
    }
    const what = skills.length === 1 ? `"${skills[0].name}"` : `${skills.length} skills`;
    const choice = await vscode.window.showWarningMessage(
      `Remove ${what} from your hub?`,
      { modal: true, detail: 'Workspaces where it is applied keep their copy.' },
      'Remove',
    );
    if (choice !== 'Remove') return;
    for (const skill of skills) await this.hub.library.remove(skill.id);
    this.hub.refresh(true);
  }

  async updateSkill(arg?: unknown, selected?: unknown): Promise<void> {
    const skills = selection(arg, selected, isLibrarySkill) ?? (await this.pickLibrarySkills('Update Skills from Source', true, (s) => canUpdate(s.source)));
    if (skills?.length) await this.updateFromSource(skills.filter((s) => canUpdate(s.source)));
  }

  async updateAllSkills(): Promise<void> {
    const skills = (await this.hub.skills()).filter((s) => canUpdate(s.source));
    if (!skills.length) {
      void vscode.window.showInformationMessage('None of your skills have a source to update from.');
      return;
    }
    await this.updateFromSource(skills);
  }

  private async updateFromSource(skills: LibrarySkill[]): Promise<void> {
    const changed: string[] = [];
    const failed: string[] = [];
    await progress('Updating skills from source…', async (report) => {
      for (const skill of skills) {
        report.report({ message: skill.name });
        try {
          const updated = await fetchFromSource(skill.source, skill.id, this.hub.library, this.hub.http);
          if (updated.hash !== skill.hash) changed.push(skill.name);
        } catch (err) {
          failed.push(`${skill.name}: ${errorMessage(err)}`);
        }
      }
    });
    this.hub.refresh(true);

    const summary =
      skills.length === 1 && !failed.length
        ? changed.length
          ? `Updated "${skills[0].name}".`
          : `"${skills[0].name}" is already up to date.`
        : `${changed.length} updated, ${skills.length - changed.length - failed.length} already up to date${failed.length ? `, ${failed.length} failed` : ''}.`;
    if (failed.length) void vscode.window.showWarningMessage(`${summary}\n${failed.join('\n')}`);
    else if (changed.length && (await this.outdatedInWorkspace()).length) {
      void vscode.window.showInformationMessage(`${summary} Workspace copies can be updated too.`, 'Update Workspace').then(
        guarded(async (choice) => {
          if (choice) await this.updateAllInWorkspace();
        }),
      );
    } else void vscode.window.showInformationMessage(summary);
  }

  // ---------------------------------------------------------------- Applying

  /** Command entry: from a library item, a workspace folder item, or the Command Palette. */
  async applyCommand(arg?: unknown, selected?: unknown): Promise<void> {
    if (isWorkspaceNode(arg)) return this.applySkills(undefined, arg.folder);
    return this.applySkills(selection(arg, selected, isLibrarySkill));
  }

  async applyByIds(ids: string[], folder?: vscode.WorkspaceFolder): Promise<void> {
    const byId = new Map((await this.hub.skills()).map((s) => [s.id, s]));
    const skills = ids.map((id) => byId.get(id)).filter((s): s is LibrarySkill => !!s);
    if (skills.length) await this.applySkills(skills, folder);
  }

  /**
   * Applies `skills` to `folder`. With `targets`, installs for exactly those target ids without asking; otherwise
   * the targets are picked, pre-selecting `preselect`, else what the lock file has, else the defaults.
   */
  async applySkills(
    skills?: LibrarySkill[],
    folder?: vscode.WorkspaceFolder,
    options: { preselect?: string[]; targets?: string[] } = {},
  ): Promise<void> {
    skills ??= await this.pickLibrarySkills('Apply Skills to Workspace');
    if (!skills?.length) return;
    folder ??= await pickFolder();
    if (!folder) return;
    const root = folder.uri.fsPath;
    const allTargets = this.hub.targets();
    const lock = await readLock(root);

    const wanted = options.targets;
    const targets = wanted
      ? allTargets.filter((t) => wanted.includes(t.id))
      : await this.pickTargets(skills, folder, allTargets, options.preselect ?? skills.flatMap((s) => Object.keys(lock.skills[s.id]?.targets ?? {})));
    if (!targets?.length) return;

    const current = new Map((await this.hub.workspaceSkills(folder)).map((s) => [s.id, s]));
    const overwritten: string[] = [];
    for (const skill of skills) {
      const existing = current.get(skill.id);
      if (existing?.status === 'modified' || existing?.status === 'conflict') overwritten.push(`${skill.name} (edited in workspace)`);
      else if (!existing?.lock) {
        for (const target of targets) {
          if ((await target.installedHash(skill.id, root)) !== undefined) overwritten.push(`${skill.name} (${target.label})`);
        }
      }
    }
    if (overwritten.length) {
      const choice = await vscode.window.showWarningMessage(
        `Replace existing files in ${folder.name}?`,
        { modal: true, detail: overwritten.join('\n') },
        'Replace',
      );
      if (choice !== 'Replace') return;
    }

    await progress(`Applying to ${folder.name}…`, async () => {
      for (const skill of skills) await applySkill(root, skill, targets, allTargets);
    });
    this.hub.refresh(true);
    const names = skills.length === 1 ? `"${skills[0].name}"` : `${skills.length} skills`;
    vscode.window.setStatusBarMessage(`$(check) Skill Hub: applied ${names} to ${folder.name} for ${targets.map((t) => t.label).join(', ')}`, 5000);
  }

  private async pickTargets(skills: LibrarySkill[], folder: vscode.WorkspaceFolder, allTargets: Target[], existing: string[]): Promise<Target[] | undefined> {
    const defaults = this.hub.config.get<string[]>('defaultTargets') ?? ['claude'];
    const preselected = new Set(existing.length ? existing : defaults);
    if (!this.hub.config.get<boolean>('promptForTargets', true)) {
      const targets = allTargets.filter((t) => preselected.has(t.id));
      return targets.length ? targets : allTargets.slice(0, 1);
    }
    const picks = await vscode.window.showQuickPick(
      allTargets.map((target) => ({ label: target.label, description: target.detail, picked: preselected.has(target.id), target })),
      {
        title: `Apply ${skills.length === 1 ? `"${skills[0].name}"` : `${skills.length} skills`} to ${folder.name}`,
        placeHolder: 'Install for which agents? Unchecking one removes the skill from it.',
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );
    if (picks && !picks.length) void vscode.window.showInformationMessage('No targets selected, so nothing was applied.');
    return picks?.map((p) => p.target);
  }

  // ---------------------------------------------------------------- Workspace

  async openWorkspaceSkill(arg?: unknown): Promise<void> {
    const node = asSkillNode(arg);
    if (node?.skill.entryFile) await vscode.window.showTextDocument(vscode.Uri.file(node.skill.entryFile), { preview: true });
  }

  async updateInWorkspace(arg?: unknown, selected?: unknown): Promise<void> {
    const nodes = selection(arg, selected, isSkillNode) ?? [];
    const edited = nodes.filter((n) => n.skill.status === 'modified' || n.skill.status === 'conflict');
    if (edited.length) {
      const choice = await vscode.window.showWarningMessage(
        'Overwrite workspace edits with the hub version?',
        { modal: true, detail: edited.map((n) => n.skill.name).join('\n') },
        'Overwrite',
      );
      if (choice !== 'Overwrite') return;
    }
    await progress('Updating from hub…', async () => {
      for (const node of nodes) await this.syncFromHub(node.skill);
    });
    this.hub.refresh(true);
  }

  async updateAllInWorkspace(arg?: unknown): Promise<void> {
    const folders = isWorkspaceNode(arg) ? [arg.folder] : fileFolders();
    const pending = (await this.outdatedInWorkspace(folders)).filter((s) => s.status !== 'conflict');
    if (!pending.length) {
      void vscode.window.showInformationMessage('All applied skills are up to date with your hub.');
      return;
    }
    await progress('Updating from hub…', async (report) => {
      for (const skill of pending) {
        report.report({ message: skill.name });
        await this.syncFromHub(skill);
      }
    });
    this.hub.refresh(true);
    void vscode.window.showInformationMessage(`Updated ${pending.length} skill${pending.length === 1 ? '' : 's'} from your hub.`);
  }

  /** Installs every lock-file skill whose files are missing, fetching it from its source if your hub doesn't have it. */
  async restore(arg?: unknown): Promise<void> {
    const folders = isWorkspaceNode(arg) ? [arg.folder] : fileFolders();
    const missing = (await Promise.all(folders.map((f) => this.hub.workspaceSkills(f)))).flat().filter((s) => s.lock && s.missing.length);
    if (!missing.length) {
      void vscode.window.showInformationMessage('Every skill in the lock file is installed.');
      return;
    }
    const failed: string[] = [];
    await progress('Restoring skills…', async (report) => {
      for (const skill of missing) {
        report.report({ message: skill.name });
        try {
          await this.syncFromHub(skill);
        } catch (err) {
          failed.push(`${skill.name}: ${errorMessage(err)}`);
        }
      }
    });
    this.hub.refresh(true);
    if (failed.length) void vscode.window.showWarningMessage(`Some skills could not be restored:\n${failed.join('\n')}`);
    else void vscode.window.showInformationMessage(`Restored ${missing.length} skill${missing.length === 1 ? '' : 's'}.`);
  }

  async saveToHub(arg?: unknown): Promise<void> {
    const node = asSkillNode(arg);
    if (!node) return;
    if (node.skill.status === 'conflict') {
      const choice = await vscode.window.showWarningMessage(
        `Your hub has a newer version of "${node.skill.name}" than the one this workspace started from.`,
        { modal: true, detail: 'Saving replaces the hub version with the workspace version.' },
        'Save Anyway',
      );
      if (choice !== 'Save Anyway') return;
    }
    await saveToHub(node.skill, this.hub.library, this.hub.targets());
    this.hub.refresh(true);
    void vscode.window.showInformationMessage(`Saved "${node.skill.name}" to your hub. Other workspaces can now update to it.`);
  }

  async addToHub(arg?: unknown): Promise<void> {
    const node = asSkillNode(arg);
    if (!node) return;
    const { skill } = node;
    if (!skill.localDir && skill.lock) {
      await progress(`Fetching "${skill.name}" from source…`, () => fetchFromSource(skill.lock!.source, skill.id, this.hub.library, this.hub.http));
    } else {
      if (await this.hub.library.has(skill.id)) {
        const choice = await vscode.window.showWarningMessage(
          `Your hub already has a skill named "${skill.id}".`,
          { modal: true, detail: 'Replace it with the copy from this workspace?' },
          'Replace',
        );
        if (choice !== 'Replace') return;
      }
      await saveToHub(skill, this.hub.library, this.hub.targets());
    }
    this.hub.refresh(true);
    void vscode.window.showInformationMessage(`Added "${skill.name}" to your hub.`);
  }

  async changeTargets(arg?: unknown): Promise<void> {
    const node = asSkillNode(arg);
    if (!node) return;
    const hubSkill = await this.ensureInHub(node.skill);
    await this.applySkills([hubSkill], node.folder, { preselect: [...node.skill.installed, ...node.skill.missing] });
  }

  /** Adds one target to the ones skill `id` is applied to in `folder` ("+ Install here" on the detail page). */
  async installForTarget(id: string, folder: vscode.WorkspaceFolder, targetId: string): Promise<void> {
    const existing = (await this.hub.workspaceSkills(folder)).find((s) => s.id === id);
    const hubSkill = existing ? await this.ensureInHub(existing) : await this.hub.library.get(id);
    if (!hubSkill) throw new Error(`"${id}" is not in your hub.`);
    const current = existing?.lock ? [...existing.installed, ...existing.missing] : [];
    await this.applySkills([hubSkill], folder, { targets: [...new Set([...current, targetId])] });
  }

  /** For a skill edited in the workspace while the hub also changed: compare, take the hub version, or push local. */
  async resolveConflict(arg?: unknown): Promise<void> {
    const node = asSkillNode(arg);
    if (!node) return;
    const { skill, folder } = node;
    type Item = vscode.QuickPickItem & { id: 'compare' | 'hub' | 'local' };
    const pick = await vscode.window.showQuickPick<Item>(
      [
        {
          id: 'compare',
          label: '$(diff) Compare and merge',
          detail: `Open the hub version beside the copy in ${folder.name}. Merge into the copy here, then Save Local Changes to Hub.`,
        },
        { id: 'hub', label: '$(arrow-circle-down) Take hub version', detail: `Discard the edits in ${folder.name}.` },
        { id: 'local', label: '$(cloud-upload) Keep local, push to hub', detail: 'Replace the hub version. Other repos can then update to it.' },
      ],
      { title: `"${skill.name}" was edited here, and the hub has a newer version`, ignoreFocusOut: true },
    );
    if (!pick) return;
    if (pick.id === 'compare') {
      if (!skill.hub || !skill.entryFile) throw new Error(`"${skill.name}" has no hub copy to compare with.`);
      const title = `${skill.name}: hub ↔ ${folder.name}`;
      await vscode.commands.executeCommand('vscode.diff', await skillFileUri(skill.hub.dir), vscode.Uri.file(skill.entryFile), title);
      return;
    }
    if (pick.id === 'hub') await progress('Updating from hub…', () => this.syncFromHub(skill));
    else await saveToHub(skill, this.hub.library, this.hub.targets());
    this.hub.refresh(true);
  }

  async removeFromWorkspace(arg?: unknown, selected?: unknown): Promise<void> {
    const nodes = selection(arg, selected, isSkillNode) ?? (await this.pickWorkspaceSkills());
    if (!nodes?.length) return;
    const what = nodes.length === 1 ? `"${nodes[0].skill.name}"` : `${nodes.length} skills`;
    const choice = await vscode.window.showWarningMessage(
      `Remove ${what} from this workspace?`,
      { modal: true, detail: 'Deletes the installed skill files. Your hub keeps its copy.' },
      'Remove',
    );
    if (choice !== 'Remove') return;
    const allTargets = this.hub.targets();
    for (const { skill } of nodes) await removeSkill(skill.root, skill.id, allTargets);
    this.hub.refresh(true);
  }

  // ---------------------------------------------------------------- Helpers

  /** Re-applies the hub version to every target the skill was applied to. */
  private async syncFromHub(skill: WorkspaceSkill): Promise<void> {
    const hubSkill = await this.ensureInHub(skill);
    const allTargets = this.hub.targets();
    const wanted = new Set([...skill.installed, ...skill.missing]);
    await applySkill(skill.root, hubSkill, allTargets.filter((t) => wanted.has(t.id)), allTargets);
  }

  private async ensureInHub(skill: WorkspaceSkill): Promise<LibrarySkill> {
    if (skill.hub) return skill.hub;
    const existing = await this.hub.library.get(skill.id);
    if (existing) return existing;
    if (skill.lock && canUpdate(skill.lock.source)) return fetchFromSource(skill.lock.source, skill.id, this.hub.library, this.hub.http);
    if (skill.localDir) return this.hub.library.add(skill.localDir, skill.lock?.source ?? { type: 'local', path: skill.localDir }, { id: skill.id });
    throw new Error(`"${skill.name}" isn't in your hub and has no source to fetch it from.`);
  }

  private async outdatedInWorkspace(folders = fileFolders()): Promise<WorkspaceSkill[]> {
    const all = (await Promise.all(folders.map((f) => this.hub.workspaceSkills(f)))).flat();
    return all.filter((s) => s.status === 'outdated' || s.status === 'conflict' || s.status === 'missing' || (s.lock && s.missing.length > 0));
  }

  private async pickLibrarySkills(title: string, canPickMany = true, filter?: (s: LibrarySkill) => boolean): Promise<LibrarySkill[] | undefined> {
    const skills = (await this.hub.skills()).filter((s) => !filter || filter(s));
    if (!skills.length) {
      void vscode.window.showInformationMessage('Your Skill Hub has no skills yet.', 'Add Skill').then(
        guarded(async (choice) => {
          if (choice) await this.addSkill();
        }),
      );
      return undefined;
    }
    const items = skills.map((skill) => ({ label: skill.name, description: describeSource(skill.source), detail: skill.description, skill }));
    const options = { title, placeHolder: 'Search by name, source or description', matchOnDescription: true, matchOnDetail: true };
    if (!canPickMany) {
      const pick = await vscode.window.showQuickPick(items, options);
      return pick && [pick.skill];
    }
    return (await vscode.window.showQuickPick(items, { ...options, canPickMany: true }))?.map((p) => p.skill);
  }

  private async pickWorkspaceSkills(): Promise<SkillNode[] | undefined> {
    const folder = await pickFolder();
    if (!folder) return undefined;
    const skills = await this.hub.workspaceSkills(folder);
    if (!skills.length) {
      void vscode.window.showInformationMessage(`No skills found in ${folder.name}.`);
      return undefined;
    }
    const picks = await vscode.window.showQuickPick(
      skills.map((skill) => ({ label: skill.name, description: skill.installed.join(', '), detail: skill.description, skill })),
      { title: `Skills in ${folder.name}`, canPickMany: true, matchOnDetail: true },
    );
    return picks?.map((p) => ({ kind: 'skill' as const, folder, skill: p.skill }));
  }
}

function isSkillNode(value: unknown): value is SkillNode {
  return isWorkspaceNode(value) && value.kind === 'skill';
}

function asSkillNode(value: unknown): SkillNode | undefined {
  return isSkillNode(value) ? value : undefined;
}

/** Tree commands receive (clicked, allSelected). Use the whole selection when the clicked item is part of it. */
function selection<T>(arg: unknown, selected: unknown, guard: (value: unknown) => value is T): T[] | undefined {
  if (!guard(arg)) return undefined;
  if (Array.isArray(selected) && selected.includes(arg)) return selected.filter(guard);
  return [arg];
}

/** Paths from Explorer context menus (Uri, Uri[]) or drops (string[]). */
export function toPaths(arg: unknown, selected: unknown): string[] {
  const all = Array.isArray(selected) && selected.length ? selected : Array.isArray(arg) ? arg : arg ? [arg] : [];
  return all.map((item) => (item instanceof vscode.Uri ? item.fsPath : item)).filter((item): item is string => typeof item === 'string');
}

export async function skillFileUri(dir: string): Promise<vscode.Uri> {
  return vscode.Uri.file((await findSkillFile(dir)) ?? path.join(dir, SKILL_FILE));
}

/** A relative path that exists in the workspace means a local folder, even though it looks like `owner/repo`. */
export async function resolveSpec(input: string): Promise<SourceSpec> {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !path.isAbsolute(input)) {
    for (const folder of fileFolders()) {
      const candidate = path.resolve(folder.uri.fsPath, input.trim());
      if (await exists(candidate)) return { type: 'local', path: candidate };
    }
  }
  return parseSourceInput(input);
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = fileFolders();
  if (!folders.length) {
    void vscode.window.showWarningMessage('Open a folder to apply skills to it.', 'Open Folder').then((choice) => {
      if (choice) void vscode.commands.executeCommand('workbench.action.files.openFolder');
    });
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Apply to which folder?' });
}

function progress<T>(title: string, task: (progress: vscode.Progress<{ message?: string }>) => Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Skill Hub: ${title}` }, task);
}

/** Wraps a command so failures show as an error notification instead of disappearing. */
export function guarded<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof SkillExistsError) void vscode.window.showWarningMessage(`Skill Hub: ${err.message}`);
      else void vscode.window.showErrorMessage(`Skill Hub: ${errorMessage(err)}`);
    }
  };
}
