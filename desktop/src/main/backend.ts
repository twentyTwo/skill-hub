/**
 * Everything the desktop app does, on top of the extension's core (vscode-extension/src/core). It has no Electron
 * imports: dialogs, the shell and IPC come in through `Host`, so this can be tested with plain Node.
 */
import { execFile, spawn } from 'child_process';
import { FSWatcher, mkdirSync, watch } from 'fs';
import * as path from 'path';
import { exists, makeTempDir, remove } from '../../../vscode-extension/src/core/fsutil';
import { hashDir } from '../../../vscode-extension/src/core/hash';
import { Http } from '../../../vscode-extension/src/core/http';
import { Library } from '../../../vscode-extension/src/core/library';
import { readLock } from '../../../vscode-extension/src/core/lock';
import { findSkillFile, isSkillFileName, slugify, validateSkillName } from '../../../vscode-extension/src/core/skill';
import {
  canUpdate,
  classifyInput,
  createProvider,
  fetchFromSource,
  findSourceSkill,
  importSkill,
  parseSourceInput,
  RemoteSkill,
  sameSource,
  SkillProvider,
  SourceSpec,
} from '../../../vscode-extension/src/core/sources';
import { searchGitHubSkills } from '../../../vscode-extension/src/core/sources/search';
import { buildTargets, Target } from '../../../vscode-extension/src/core/targets';
import { LibrarySkill } from '../../../vscode-extension/src/core/types';
import { errorMessage, mapLimit } from '../../../vscode-extension/src/core/util';
import { applySkill, removeSkill, saveToHub, scanWorkspace, WorkspaceSkill } from '../../../vscode-extension/src/core/workspace';
import type {
  Api,
  AppEvent,
  AppState,
  ApplyRequest,
  ConflictVM,
  HubSkillVM,
  InputKind,
  ProjectAction,
  ProjectVM,
  ReviewVM,
  SearchResultVM,
  SettingsVM,
  SourceCheck,
  SourceInput,
  SourceListing,
  UsageVM,
} from '../shared/api';
import { displayDiff } from '../shared/diff';
import { compareDirs, isTextFile, mergeIntoLocal, readText } from './files';
import { DEFAULT_SETTINGS, Settings, Store, tildify } from './store';
import { missingProjectVM, projectVM, sourceVM, targetVM } from './views';

/** What the backend needs from the app around it. */
export interface Host {
  /** Folder for settings, source checks and the activity log. */
  dataDir: string;
  version: string;
  emit(event: AppEvent): void;
  /** OS-backed encryption for the saved GitHub token; absent when the OS has none. */
  secrets?: { encrypt(text: string): string; decrypt(data: string): string };
  pickFolders(options: { title: string; multiple: boolean }): Promise<string[]>;
  /** Opens a file or folder with its default app. */
  openPath(target: string): Promise<void>;
  reveal(target: string): void;
  openExternal(url: string): Promise<void>;
}

interface Staged {
  /** Temp folder holding the source's current version. */
  dir: string;
  /** Hub hash the source was compared against. */
  hubHash: string;
}

interface Listing {
  provider: SkillProvider;
  found: RemoteSkill[];
  ids: string[];
}

/** File events are coalesced for this long before everything is re-read. */
const REFRESH_DELAY_MS = 300;

export class Backend implements Api {
  readonly store: Store;
  readonly http: Http;
  private library!: Library;
  private skillsCache?: Promise<LibrarySkill[]>;
  private readonly scans = new Map<string, Promise<WorkspaceSkill[]>>();
  private readonly checking = new Set<string>();
  private readonly staged = new Map<string, Staged>();
  private readonly listings = new Map<string, Listing>();
  private readonly busy = new Map<number, string>();
  private busySeq = 0;
  private listingSeq = 0;
  private emitTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private watchers: FSWatcher[] = [];
  private watchKey = '';
  private ghCli?: Promise<string | undefined>;

  constructor(private readonly host: Host) {
    this.store = new Store(host.dataDir);
    this.http = new Http({ githubToken: (interactive, reason) => this.githubToken(interactive, reason) });
  }

  async init(): Promise<void> {
    await this.store.load();
    this.openLibrary();
    void this.ghCliToken();
  }

  dispose(): void {
    clearTimeout(this.emitTimer);
    clearTimeout(this.refreshTimer);
    for (const w of this.watchers) w.close();
    for (const id of [...this.staged.keys()]) this.dropStaged(id);
    for (const token of [...this.listings.keys()]) void this.closeListing(token);
  }

  // ---------------------------------------------------------------- State

  /** Forgets cached reads and pushes fresh state to the window. */
  refresh(): void {
    this.skillsCache = undefined;
    this.scans.clear();
    this.scheduleEmit();
  }

  private scheduleEmit(): void {
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => {
      this.getState()
        .then((state) => this.host.emit({ type: 'state', state }))
        .catch((err) => this.toast('error', `Could not read your hub: ${errorMessage(err)}`));
    }, 30);
  }

  private toast(kind: 'info' | 'warning' | 'error', text: string, action?: { label: string; event: string }): void {
    this.host.emit({ type: 'toast', kind, text, action });
  }

  async getState(): Promise<AppState> {
    const targets = this.targets();
    const label = (id: string) => targets.find((t) => t.id === id)?.label ?? id;
    let hubSkills: LibrarySkill[] = [];
    let libraryError: string | undefined;
    try {
      hubSkills = await this.skills();
    } catch (err) {
      libraryError = `Could not read ${this.library.root}: ${errorMessage(err)}`;
    }

    const usage = new Map<string, UsageVM[]>();
    const projects: ProjectVM[] = [];
    for (const root of this.store.settings.projects) {
      if (!(await exists(root))) {
        projects.push(missingProjectVM(root, targets, 'Folder not found. It may have been moved or deleted.', false));
        continue;
      }
      try {
        const scan = await this.scan(root);
        const lock = await readLock(root);
        const used = new Set(Object.values(lock.skills).flatMap((entry) => Object.keys(entry.targets ?? {})));
        const vm = projectVM(root, scan, targets, used);
        projects.push(vm);
        for (const skill of scan) {
          if (!skill.lock) continue;
          const list = usage.get(skill.id) ?? [];
          list.push({ root, project: vm.name, targets: [...skill.installed, ...skill.missing].map(label), status: skill.status });
          usage.set(skill.id, list);
        }
      } catch (err) {
        projects.push(missingProjectVM(root, targets, `Could not read skills: ${errorMessage(err)}`, true));
      }
    }

    const skills: HubSkillVM[] = await Promise.all(
      hubSkills.map(async (skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        dir: skill.dir,
        skillFile: await findSkillFile(skill.dir),
        source: sourceVM(skill.source),
        canUpdate: canUpdate(skill.source),
        hash: skill.hash,
        updatedAt: skill.updatedAt,
        usedIn: usage.get(skill.id) ?? [],
        check: this.checkFor(skill),
      })),
    );

    this.syncWatchers(targets);
    return {
      version: this.host.version,
      libraryRoot: this.library.root,
      libraryDisplay: tildify(this.library.root),
      libraryError,
      skills,
      projects,
      targets: targets.map(targetVM),
      settings: await this.settingsVM(),
      activity: this.store.activity.slice(0, 200),
      busy: [...this.busy.values()],
    };
  }

  private async settingsVM(): Promise<SettingsVM> {
    const s = this.store.settings;
    const source = this.savedToken() ? 'saved' : envToken() ? 'env' : (await this.ghCliToken()) ? 'gh' : 'none';
    return {
      libraryPath: s.libraryPath || '~/.skill-hub',
      defaultTargets: s.defaultTargets,
      agentsSkillsFolder: s.agentsSkillsFolder,
      customTargets: s.customTargets,
      editorCommand: s.editorCommand,
      libraryView: s.libraryView,
      github: { source, canSave: !!this.host.secrets },
    };
  }

  private checkFor(skill: LibrarySkill): SourceCheck | undefined {
    if (this.checking.has(skill.id)) return { state: 'checking' };
    const stored = this.store.checks[skill.id];
    // A check made against an older hub copy says nothing about the current one.
    if (!stored || stored.hubHash !== skill.hash) return undefined;
    if (stored.state === 'newer') return { state: 'newer', checkedAt: stored.checkedAt, changes: stored.changes ?? [] };
    if (stored.state === 'error') return { state: 'error', checkedAt: stored.checkedAt, message: stored.message ?? 'Check failed.' };
    return { state: 'current', checkedAt: stored.checkedAt };
  }

  private openLibrary(): void {
    this.library = new Library(this.store.libraryRoot());
    try {
      // Exists up front so it can be watched.
      mkdirSync(this.library.skillsDir, { recursive: true });
    } catch {
      // Reported when the library is first read.
    }
  }

  targets(): Target[] {
    const s = this.store.settings;
    return buildTargets({ agentsFolder: s.agentsSkillsFolder, custom: s.customTargets });
  }

  skills(): Promise<LibrarySkill[]> {
    if (!this.skillsCache) {
      const pending = this.library.list();
      pending.catch(() => {
        if (this.skillsCache === pending) this.skillsCache = undefined;
      });
      this.skillsCache = pending;
    }
    return this.skillsCache;
  }

  private scan(root: string): Promise<WorkspaceSkill[]> {
    let pending = this.scans.get(root);
    if (!pending) {
      pending = (async () => scanWorkspace(root, await this.skills(), this.targets()))();
      const current = pending;
      pending.catch(() => {
        if (this.scans.get(root) === current) this.scans.delete(root);
      });
      this.scans.set(root, pending);
    }
    return pending;
  }

  /** Watches the hub and each project's skill folders; anything else is picked up when the window regains focus. */
  private syncWatchers(targets: Target[]): void {
    const folders = [...new Set(targets.flatMap((t) => t.watchGlobs).filter((g) => g.endsWith('/**')).map((g) => g.slice(0, -3)))];
    const roots = this.store.settings.projects;
    const key = JSON.stringify([this.library.root, roots, folders]);
    if (key === this.watchKey) return;
    this.watchKey = key;
    for (const w of this.watchers) w.close();
    this.watchers = [];

    const onEvent = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
    };
    const add = (target: string, recursive: boolean) => {
      try {
        const w = watch(target, { recursive }, onEvent);
        w.on('error', () => w.close());
        this.watchers.push(w);
      } catch {
        // Missing folder, or the platform can't watch it.
      }
    };
    add(this.library.root, true);
    for (const root of roots) {
      // The root itself catches the lock file, AGENTS.md and new target folders.
      add(root, false);
      for (const folder of folders) add(path.join(root, ...folder.split('/')), true);
    }
  }

  /** Runs `task` with `label` shown as busy, logs a failure, and refreshes afterwards either way. */
  private async run<T>(label: string, task: () => Promise<T>): Promise<T> {
    const id = ++this.busySeq;
    this.busy.set(id, label);
    this.scheduleEmit();
    try {
      return await task();
    } catch (err) {
      this.store.log('error', `${label}: ${errorMessage(err)}`);
      throw err;
    } finally {
      this.busy.delete(id);
      this.refresh();
    }
  }

  // ---------------------------------------------------------------- Projects

  async pickProjectFolders(): Promise<string[]> {
    return this.host.pickFolders({ title: 'Add project folders', multiple: true });
  }

  async addProjects(roots: string[]): Promise<void> {
    const projects = this.store.settings.projects;
    const added: string[] = [];
    for (const raw of roots) {
      const root = path.resolve(raw);
      if (projects.some((p) => samePath(p, root))) continue;
      projects.push(root);
      added.push(path.basename(root));
    }
    if (!added.length) return;
    await this.store.saveSettings();
    this.store.log('project', `Added ${added.length === 1 ? `project ${added[0]}` : `${added.length} projects: ${added.join(', ')}`}`);
    this.refresh();
  }

  async removeProject(root: string): Promise<void> {
    const s = this.store.settings;
    s.projects = s.projects.filter((p) => !samePath(p, root));
    await this.store.saveSettings();
    this.store.log('project', `Stopped tracking ${path.basename(root)}. Its files were not changed.`);
    this.refresh();
  }

  private async workspaceSkill(root: string, id: string): Promise<WorkspaceSkill> {
    this.scans.delete(root);
    const skill = (await this.scan(root)).find((s) => s.id === id);
    if (!skill) throw new Error(`"${id}" is no longer in ${path.basename(root)}.`);
    return skill;
  }

  async projectAction(root: string, id: string, action: ProjectAction): Promise<void> {
    const project = path.basename(root);
    const labels: Record<ProjectAction, string> = {
      update: `Updating ${id} in ${project}`,
      restore: `Restoring ${id} in ${project}`,
      takeHub: `Taking the hub version of ${id}`,
      saveToHub: `Saving ${id} to the hub`,
      keepLocal: `Saving ${id} to the hub`,
      addToHub: `Adding ${id} to the hub`,
      merge: `Merging ${id}`,
      remove: `Removing ${id} from ${project}`,
    };
    await this.run(labels[action], async () => {
      const skill = await this.workspaceSkill(root, id);
      const allTargets = this.targets();
      switch (action) {
        case 'update':
        case 'restore':
        case 'takeHub':
          await this.syncFromHub(skill);
          this.store.log(action === 'takeHub' ? 'resolve' : 'update', `${action === 'restore' ? 'Restored' : 'Updated'} ${skill.name} in ${project} from the hub`);
          return;
        case 'saveToHub':
        case 'keepLocal':
          await saveToHub(skill, this.library, allTargets);
          this.store.log(action === 'keepLocal' ? 'resolve' : 'save', `Saved ${skill.name} from ${project} to the hub`);
          return;
        case 'addToHub':
          if (!skill.localDir && skill.lock) await fetchFromSource(skill.lock.source, skill.id, this.library, this.http);
          else await saveToHub(skill, this.library, allTargets);
          this.store.log('add', `Added ${skill.name} from ${project} to the hub`);
          return;
        case 'merge':
          await this.merge(skill);
          return;
        case 'remove':
          await removeSkill(root, id, allTargets);
          this.store.log('remove', `Removed ${skill.name} from ${project}`);
          return;
      }
    });
  }

  private async merge(skill: WorkspaceSkill): Promise<void> {
    if (!skill.localDir || !skill.hub) throw new Error(`"${skill.name}" needs a SKILL.md folder in the project and a hub copy to merge.`);
    const project = path.basename(skill.root);
    const result = await mergeIntoLocal(skill.localDir, skill.hub.dir, `${project} (local)`);
    this.store.log('resolve', `Merged the hub version of ${skill.name} into ${project}${result.conflicts ? ` (${result.conflicts} to settle)` : ''}`);
    const file = await findSkillFile(skill.localDir);
    if (file) await this.openInEditor(file);
    const kept = result.keptBinary.length ? ` Binary files kept as they were: ${result.keptBinary.join(', ')}.` : '';
    this.toast(
      'info',
      result.conflicts
        ? `Both versions are now in ${project}, with ${result.conflicts} place${result.conflicts === 1 ? '' : 's'} marked <<<<<<< / >>>>>>> to settle. Edit them, then choose "Keep local, push to hub".${kept}`
        : `Merged without overlaps. Choose "Keep local, push to hub" to share the result.${kept}`,
    );
  }

  /** Re-applies the hub version to every target the skill was applied to. */
  private async syncFromHub(skill: WorkspaceSkill): Promise<void> {
    const hubSkill = await this.ensureInHub(skill);
    const allTargets = this.targets();
    const wanted = new Set([...skill.installed, ...skill.missing]);
    await applySkill(skill.root, hubSkill, allTargets.filter((t) => wanted.has(t.id)), allTargets);
  }

  private async ensureInHub(skill: WorkspaceSkill): Promise<LibrarySkill> {
    if (skill.hub) return skill.hub;
    const existing = await this.library.get(skill.id);
    if (existing) return existing;
    if (skill.lock && canUpdate(skill.lock.source)) return fetchFromSource(skill.lock.source, skill.id, this.library, this.http);
    if (skill.localDir) return this.library.add(skill.localDir, skill.lock?.source ?? { type: 'local', path: skill.localDir }, { id: skill.id });
    throw new Error(`"${skill.name}" isn't in your hub and has no source to fetch it from.`);
  }

  /** Targets an apply installs for: what it's already applied to in `root`, plus the requested ones (or the defaults). */
  private async applyTargets(root: string, id: string, requested: string[]): Promise<Target[]> {
    const all = this.targets();
    const current = Object.keys((await readLock(root)).skills[id]?.targets ?? {});
    const wanted = new Set([...current, ...(requested.length ? requested : this.store.settings.defaultTargets)]);
    const chosen = all.filter((t) => wanted.has(t.id));
    return chosen.length ? chosen : all.slice(0, 1);
  }

  async applyWarnings(id: string, request: ApplyRequest): Promise<string[]> {
    const warnings: string[] = [];
    for (const root of request.roots) {
      const project = path.basename(root);
      const existing = (await this.scan(root)).find((s) => s.id === id);
      if (existing?.status === 'modified' || existing?.status === 'conflict') {
        warnings.push(`${project}: ${existing.name} was edited there`);
        continue;
      }
      if (existing?.lock) continue;
      for (const target of await this.applyTargets(root, id, request.targets)) {
        if ((await target.installedHash(id, root)) !== undefined) warnings.push(`${project}: ${target.label} already has a "${id}" skill`);
      }
    }
    return warnings;
  }

  async applySkill(id: string, request: ApplyRequest): Promise<void> {
    await this.run(`Applying ${id}`, async () => {
      this.skillsCache = undefined;
      const skill = (await this.skills()).find((s) => s.id === id);
      if (!skill) throw new Error(`"${id}" is not in your hub.`);
      const all = this.targets();
      const done: string[] = [];
      const used = new Set<string>();
      for (const root of request.roots) {
        const targets = await this.applyTargets(root, id, request.targets);
        await applySkill(root, skill, targets, all);
        done.push(path.basename(root));
        for (const t of targets) used.add(t.label);
      }
      this.store.log('apply', `Applied ${skill.name} to ${done.join(', ')} for ${[...used].join(', ')}`);
    });
  }

  async updateAllSafe(roots?: string[]): Promise<number> {
    const failed: string[] = [];
    let updated = 0;
    await this.run('Updating projects', async () => {
      for (const root of roots ?? this.store.settings.projects) {
        if (!(await exists(root))) continue;
        this.scans.delete(root);
        const pending = (await this.scan(root)).filter(
          (s) => s.lock && (s.status === 'outdated' || s.status === 'missing' || (s.status === 'synced' && s.missing.length > 0)),
        );
        for (const skill of pending) {
          try {
            await this.syncFromHub(skill);
            updated++;
          } catch (err) {
            failed.push(`${skill.name} in ${path.basename(root)}: ${errorMessage(err)}`);
          }
        }
      }
      if (updated) this.store.log('update', `Updated ${updated} skill${updated === 1 ? '' : 's'} across projects from the hub`);
    });
    if (failed.length) this.toast('warning', `Some skills could not be updated:\n${failed.join('\n')}`);
    return updated;
  }

  async conflict(root: string, id: string): Promise<ConflictVM> {
    const skill = await this.workspaceSkill(root, id);
    if (!skill.hub) throw new Error(`"${skill.name}" has no hub copy to compare with.`);
    const hubFile = await findSkillFile(skill.hub.dir);
    const localFile = skill.localDir ? await findSkillFile(skill.localDir) : skill.entryFile;
    const read = async (file?: string) => (file ? readText(path.dirname(file), path.basename(file)) : '');
    const otherFiles = skill.localDir ? (await compareDirs(skill.localDir, skill.hub.dir)).filter((c) => !isSkillFileName(c.path)).map((c) => c.path) : [];
    return {
      id,
      name: skill.name,
      root,
      project: path.basename(root),
      file: localFile ? path.basename(localFile) : 'SKILL.md',
      diff: displayDiff(await read(localFile), await read(hubFile), 'local', 'added', 2),
      otherFiles,
      canMerge: !!skill.localDir,
    };
  }

  // ---------------------------------------------------------------- Adding skills

  async classify(input: string): Promise<{ kind: InputKind; detail?: string }> {
    const { kind, spec } = classifyInput(input);
    if (!spec) return { kind };
    let detail = describeSpec(spec);
    if (spec.type === 'local' && !(await exists(spec.path))) detail = `${detail} (not found)`;
    return { kind, detail };
  }

  async listSource(input: SourceInput): Promise<SourceListing> {
    return this.run('Looking for skills', async () => {
      const spec: SourceSpec = typeof input === 'string' ? parseSourceInput(input) : { ...input };
      const provider = createProvider(spec, this.http);
      let found: RemoteSkill[];
      try {
        found = await provider.list();
        if (!found.length) throw new Error(`No skills or markdown files found in ${provider.label}.`);
      } catch (err) {
        await provider.dispose?.();
        throw err;
      }

      const hub = new Map((await this.skills()).map((s) => [s.id, s]));
      const taken = new Set(hub.keys());
      const skills = found.map((remote, index) => {
        const base = slugify(remote.name);
        const existing = hub.get(base);
        const common = { index, name: remote.name, description: remote.description, path: remote.path || '/', kind: remote.kind };
        if (existing && sameSource(existing.source, remote.source)) return { ...common, id: base, inHub: true, renamed: false };
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        taken.add(id);
        return { ...common, id, inHub: false, renamed: id !== base };
      });

      const token = `listing-${++this.listingSeq}`;
      this.listings.set(token, { provider, found, ids: skills.map((s) => s.id) });
      return { token, label: provider.label, skills };
    });
  }

  async importListed(token: string, indexes: number[], apply?: ApplyRequest): Promise<string[]> {
    const listing = this.listings.get(token);
    if (!listing) throw new Error('This list has expired. Look up the source again.');
    const ids = await this.run(`Adding ${indexes.length} skill${indexes.length === 1 ? '' : 's'}`, async () => {
      const added: LibrarySkill[] = [];
      for (const index of indexes) added.push(await importSkill(listing.provider, listing.found[index], this.library, listing.ids[index]));
      this.store.log('add', `Added ${added.map((s) => s.name).join(', ')} from ${listing.provider.label}`);
      return added.map((s) => s.id);
    });
    await this.closeListing(token);
    if (apply?.roots.length) for (const id of ids) await this.applySkill(id, apply);
    return ids;
  }

  async closeListing(token: string): Promise<void> {
    const listing = this.listings.get(token);
    this.listings.delete(token);
    await listing?.provider.dispose?.().catch(() => undefined);
  }

  async pickLocalSource(): Promise<string | undefined> {
    return (await this.host.pickFolders({ title: 'Choose a skill folder, or a folder of skills', multiple: false }))[0];
  }

  async validateName(name: string): Promise<string | undefined> {
    return validateSkillName(name) ?? ((await this.library.has(name)) ? 'A skill with this name is already in your hub.' : undefined);
  }

  async createSkill(name: string, description: string): Promise<string> {
    const problem = await this.validateName(name);
    if (problem) throw new Error(problem);
    if (!description.trim()) throw new Error('Agents use the description to decide when to load the skill.');
    const skill = await this.run(`Creating ${name}`, () => this.library.create(name, description.trim()));
    this.store.log('add', `Created ${skill.name}`);
    const file = await findSkillFile(skill.dir);
    if (file) await this.openInEditor(file);
    return skill.id;
  }

  async search(query: string): Promise<SearchResultVM[]> {
    return this.run(`Searching GitHub for "${query}"`, async () => {
      const results = await searchGitHubSkills(this.http, query);
      const ids = new Set((await this.skills()).map((s) => s.id));
      return results.map((r) => ({ ...r, inHub: ids.has(slugify(r.name)) }));
    });
  }

  // ---------------------------------------------------------------- Hub

  async checkSources(ids?: string[]): Promise<{ newer: string[]; failed: number }> {
    this.skillsCache = undefined;
    const skills = (await this.skills()).filter((s) => canUpdate(s.source) && (!ids || ids.includes(s.id)) && !this.checking.has(s.id));
    if (!skills.length) return { newer: [], failed: 0 };
    for (const s of skills) this.checking.add(s.id);
    const newer: string[] = [];
    let failed = 0;
    await this.run(skills.length === 1 ? `Checking ${skills[0].name}` : `Checking ${skills.length} sources`, async () => {
      await mapLimit(skills, 3, async (skill) => {
        try {
          if (await this.checkOne(skill)) newer.push(skill.name);
        } catch {
          failed++;
        } finally {
          this.checking.delete(skill.id);
          this.scheduleEmit();
        }
      });
      await this.store.saveChecks();
      if (skills.length > 1) this.store.log('check', `Checked ${skills.length} sources: ${newer.length ? `${newer.length} with updates` : 'all up to date'}${failed ? `, ${failed} failed` : ''}`);
    });
    return { newer, failed };
  }

  /** Downloads the source's current version next to the hub copy. True when they differ. */
  private async checkOne(skill: LibrarySkill): Promise<boolean> {
    const checkedAt = new Date().toISOString();
    const provider = createProvider(skill.source, this.http);
    const dir = await makeTempDir('skill-hub-check-');
    try {
      await provider.download(findSourceSkill(await provider.list(), skill.source), dir);
      this.dropStaged(skill.id);
      if ((await hashDir(dir)) === skill.hash) {
        await remove(dir);
        this.store.checks[skill.id] = { hubHash: skill.hash, state: 'current', checkedAt };
        return false;
      }
      this.staged.set(skill.id, { dir, hubHash: skill.hash });
      this.store.checks[skill.id] = { hubHash: skill.hash, state: 'newer', checkedAt, changes: await compareDirs(skill.dir, dir) };
      return true;
    } catch (err) {
      await remove(dir);
      this.store.checks[skill.id] = { hubHash: skill.hash, state: 'error', checkedAt, message: errorMessage(err) };
      throw err;
    } finally {
      await provider.dispose?.();
    }
  }

  private dropStaged(id: string): void {
    const staged = this.staged.get(id);
    this.staged.delete(id);
    if (staged) void remove(staged.dir).catch(() => undefined);
  }

  async review(id: string): Promise<ReviewVM> {
    let skill = (await this.skills()).find((s) => s.id === id);
    if (!skill) throw new Error(`"${id}" is not in your hub.`);
    if (this.staged.get(id)?.hubHash !== skill.hash) await this.checkSources([id]);
    const staged = this.staged.get(id);
    skill = (await this.skills()).find((s) => s.id === id)!;
    if (!staged) throw new Error(`"${skill.name}" matches its source. There is nothing to review.`);

    const changes = await compareDirs(skill.dir, staged.dir);
    let file = changes.find((c) => isSkillFileName(c.path))?.path;
    for (const c of changes) {
      if (file) break;
      if (await isTextFile(c.change === 'removed' ? skill.dir : staged.dir, c.path)) file = c.path;
    }
    let usedIn = 0;
    for (const root of this.store.settings.projects) {
      if ((await exists(root)) && (await readLock(root)).skills[id]) usedIn++;
    }
    return {
      id,
      name: skill.name,
      source: sourceVM(skill.source).text,
      changes,
      file,
      diff: file ? displayDiff(await readText(skill.dir, file), await readText(staged.dir, file), 'removed', 'added', 3) : [],
      usedIn,
    };
  }

  async updateFromSource(ids: string[]): Promise<{ changed: string[]; failed: string[] }> {
    const changed: string[] = [];
    const failed: string[] = [];
    await this.run(ids.length === 1 ? `Updating ${ids[0]} from source` : `Updating ${ids.length} skills from source`, async () => {
      this.skillsCache = undefined;
      const skills = (await this.skills()).filter((s) => ids.includes(s.id) && canUpdate(s.source));
      for (const skill of skills) {
        try {
          const staged = this.staged.get(skill.id);
          // Install exactly what was reviewed when the hub copy hasn't changed since.
          const updated =
            staged && staged.hubHash === skill.hash
              ? await this.library.add(staged.dir, skill.source, { id: skill.id, overwrite: true })
              : await fetchFromSource(skill.source, skill.id, this.library, this.http);
          this.dropStaged(skill.id);
          this.store.checks[skill.id] = { hubHash: updated.hash, state: 'current', checkedAt: new Date().toISOString() };
          if (updated.hash !== skill.hash) changed.push(skill.name);
        } catch (err) {
          failed.push(`${skill.name}: ${errorMessage(err)}`);
        }
      }
      await this.store.saveChecks();
      if (changed.length) this.store.log('update', `Updated ${changed.join(', ')} in the hub from source`);
    });

    if (failed.length) this.toast('warning', `${failed.length} could not be updated:\n${failed.join('\n')}`);
    else if (changed.length) {
      const outdated = (await this.getState()).projects.filter((p) => p.skills.some((s) => s.status === 'outdated' || s.status === 'conflict')).length;
      const text = `Updated ${changed.length === 1 ? changed[0] : `${changed.length} skills`} in your hub.`;
      if (outdated) this.toast('info', `${text} ${outdated} project${outdated === 1 ? '' : 's'} can update now.`, { label: 'Open Projects', event: 'navigate:projects' });
      else this.toast('info', text);
    }
    return { changed, failed };
  }

  async deleteSkill(id: string): Promise<void> {
    await this.run(`Removing ${id} from the hub`, async () => {
      await this.library.remove(id);
      this.dropStaged(id);
      delete this.store.checks[id];
      await this.store.saveChecks();
      this.store.log('remove', `Removed ${id} from the hub. Projects keep their copies.`);
    });
  }

  // ---------------------------------------------------------------- Settings

  async saveSettings(patch: Partial<Omit<SettingsVM, 'github'>>): Promise<void> {
    const s = this.store.settings;
    const before = this.store.libraryRoot();
    const clean = sanitize(patch);
    Object.assign(s, clean);
    if (clean.libraryPath === '~/.skill-hub') s.libraryPath = '';
    await this.store.saveSettings();
    if (this.store.libraryRoot() !== before) {
      this.openLibrary();
      for (const id of [...this.staged.keys()]) this.dropStaged(id);
      this.store.checks = {};
      await this.store.saveChecks();
      this.store.log('project', `Hub moved to ${tildify(this.library.root)}`);
    }
    this.refresh();
  }

  async pickLibraryFolder(): Promise<string | undefined> {
    return (await this.host.pickFolders({ title: 'Choose the folder for your hub', multiple: false }))[0];
  }

  async setGitHubToken(token: string | null): Promise<void> {
    const s = this.store.settings;
    const value = token?.trim();
    if (value) {
      if (!this.host.secrets) throw new Error("This system has no secure storage, so the token can't be saved. Set GITHUB_TOKEN instead.");
      s.githubToken = this.host.secrets.encrypt(value);
    } else delete s.githubToken;
    await this.store.saveSettings();
    this.refresh();
  }

  private savedToken(): string | undefined {
    const saved = this.store.settings.githubToken;
    if (!saved || !this.host.secrets) return undefined;
    try {
      return this.host.secrets.decrypt(saved) || undefined;
    } catch {
      return undefined;
    }
  }

  /** The GitHub CLI's token, if it's installed and signed in. Looked up once. */
  private ghCliToken(): Promise<string | undefined> {
    this.ghCli ??= new Promise((resolve) => {
      execFile('gh', ['auth', 'token'], { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined));
    });
    return this.ghCli;
  }

  private async githubToken(interactive: boolean, reason?: string): Promise<string | undefined> {
    const token = this.savedToken() ?? envToken() ?? (await this.ghCliToken());
    if (token || !interactive) return token;
    this.toast(
      'warning',
      `${reason ?? 'GitHub refused the request. The repository may be private, or you hit the limit for anonymous requests.'} Add a GitHub token in Settings, or sign in with the GitHub CLI (gh auth login).`,
      { label: 'Open Settings', event: 'navigate:settings' },
    );
    return undefined;
  }

  // ---------------------------------------------------------------- Outside the app

  /** Opens a file or folder with the editor command (VS Code by default), else with the system's default app. */
  async openInEditor(target: string): Promise<void> {
    const command = this.store.settings.editorCommand.trim();
    if (command && (await launch(command, target))) return;
    await this.host.openPath(target);
  }

  async openFolder(target: string): Promise<void> {
    await this.openInEditor(target);
  }

  async reveal(target: string): Promise<void> {
    this.host.reveal(target);
  }

  async openExternal(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) throw new Error(`Not a web link: ${url}`);
    await this.host.openExternal(url);
  }
}

function envToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
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

/** Keeps only well-formed settings from the renderer. */
function sanitize(patch: Partial<Omit<SettingsVM, 'github'>>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof patch.libraryPath === 'string') out.libraryPath = patch.libraryPath.trim();
  if (Array.isArray(patch.defaultTargets)) out.defaultTargets = patch.defaultTargets.filter((t) => typeof t === 'string');
  if (typeof patch.agentsSkillsFolder === 'string') out.agentsSkillsFolder = patch.agentsSkillsFolder.trim() || DEFAULT_SETTINGS.agentsSkillsFolder;
  if (Array.isArray(patch.customTargets)) {
    out.customTargets = patch.customTargets
      .filter((t) => t && typeof t.id === 'string' && typeof t.folder === 'string' && t.id.trim() && t.folder.trim())
      .map((t) => ({ id: t.id.trim(), label: t.label?.trim() || undefined, folder: t.folder.trim() }));
  }
  if (typeof patch.editorCommand === 'string') out.editorCommand = patch.editorCommand.trim();
  if (patch.libraryView === 'grid' || patch.libraryView === 'list') out.libraryView = patch.libraryView;
  return out;
}

/** Runs `command "<target>"` through the shell. False if it couldn't start or exited with an error. */
function launch(command: string, target: string): Promise<boolean> {
  const quoted = process.platform === 'win32' ? `"${target}"` : `'${target.replace(/'/g, `'\\''`)}'`;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(`${command} ${quoted}`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    // Editors like `code` hand off to a running instance and exit straight away; some stay open, which is fine too.
    const timer = setTimeout(() => {
      child.unref();
      resolve(true);
    }, 8000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
