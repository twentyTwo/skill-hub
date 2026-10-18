import { mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Http } from '../core/http';
import { Library } from '../core/library';
import { LOCK_FILE } from '../core/lock';
import { buildTargets, CustomTargetConfig, Target } from '../core/targets';
import { LibrarySkill } from '../core/types';
import { scanWorkspace, WorkspaceSkill } from '../core/workspace';
import { BADGE } from '../shared/status';

/** Shared state for the views and commands: the library, targets, caches, and file watching. */
export class Hub implements vscode.Disposable {
  readonly http = new Http({ githubToken });
  private lib: Library;
  private skillsCache?: Promise<LibrarySkill[]>;
  private readonly workspaceCache = new Map<string, Promise<WorkspaceSkill[]>>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private activeRoot: string | undefined;

  /** `builtinRoot`: the skills that ship with the extension. */
  constructor(private readonly builtinRoot: string) {
    this.lib = createLibrary(builtinRoot);
    this.watch();
    this.disposables.push(
      this.changed,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('skillHub')) return;
        if (e.affectsConfiguration('skillHub.libraryPath')) this.lib = createLibrary(this.builtinRoot);
        this.watch();
        this.refresh(true);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh(true)),
    );
  }

  get library(): Library {
    return this.lib;
  }

  get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('skillHub');
  }

  targets(): Target[] {
    return buildTargets({
      agentsFolder: this.config.get<string>('agentsSkillsFolder'),
      custom: this.config.get<CustomTargetConfig[]>('customTargets'),
    });
  }

  skills(): Promise<LibrarySkill[]> {
    if (!this.skillsCache) {
      const pending = this.lib.list();
      pending.catch(() => {
        if (this.skillsCache === pending) this.skillsCache = undefined;
      });
      this.skillsCache = pending;
    }
    return this.skillsCache;
  }

  workspaceSkills(folder: vscode.WorkspaceFolder): Promise<WorkspaceSkill[]> {
    const root = folder.uri.fsPath;
    let pending = this.workspaceCache.get(root);
    if (!pending) {
      pending = (async () => scanWorkspace(root, await this.skills(), this.targets()))();
      const current = pending;
      pending.catch(() => {
        if (this.workspaceCache.get(root) === current) this.workspaceCache.delete(root);
      });
      this.workspaceCache.set(root, pending);
    }
    return pending;
  }

  /** The folder the sidebar shows and new skills are applied to: the one picked in the sidebar, else the first. */
  activeFolder(): vscode.WorkspaceFolder | undefined {
    const folders = fileFolders();
    return folders.find((f) => f.uri.fsPath === this.activeRoot) ?? folders[0];
  }

  setActiveFolder(root: string): void {
    if (root === this.activeRoot) return;
    this.activeRoot = root;
    this.changed.fire();
  }

  /** Skills across all folders that an update from the hub fixes or that need a decision. */
  async attentionCount(): Promise<number> {
    try {
      const all = (await Promise.all(fileFolders().map((f) => this.workspaceSkills(f)))).flat();
      return all.filter((s) => BADGE.includes(s.status)).length;
    } catch {
      return 0;
    }
  }

  /** Re-reads everything. Without `immediate`, bursts of file events are coalesced. */
  refresh(immediate = false): void {
    this.clearCaches();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (immediate) {
      this.changed.fire();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.clearCaches();
      this.changed.fire();
    }, 300);
  }

  private clearCaches(): void {
    this.skillsCache = undefined;
    this.workspaceCache.clear();
  }

  private watch(): void {
    vscode.Disposable.from(...this.watchers).dispose();
    const onEvent = () => this.refresh();
    const watcher = (pattern: vscode.GlobPattern) => {
      const w = vscode.workspace.createFileSystemWatcher(pattern);
      return vscode.Disposable.from(w, w.onDidCreate(onEvent), w.onDidChange(onEvent), w.onDidDelete(onEvent));
    };
    const workspaceGlobs = [...new Set([LOCK_FILE, ...this.targets().flatMap((t) => t.watchGlobs)])];
    this.watchers = [
      watcher(new vscode.RelativePattern(vscode.Uri.file(this.lib.root), '**/*')),
      watcher(`{${workspaceGlobs.join(',')}}`),
    ];
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    vscode.Disposable.from(...this.watchers, ...this.disposables).dispose();
  }
}

function createLibrary(builtinRoot: string): Library {
  const configured = vscode.workspace.getConfiguration('skillHub').get<string>('libraryPath')?.trim();
  const root = !configured
    ? path.join(os.homedir(), '.skill-hub')
    : /^~([\\/]|$)/.test(configured)
      ? path.join(os.homedir(), configured.slice(1))
      : path.resolve(configured);
  const library = new Library(root, builtinRoot);
  try {
    // Exists up front so the file watcher has something to watch.
    mkdirSync(library.skillsDir, { recursive: true });
  } catch {
    // Reported when the library is first read.
  }
  return library;
}

async function githubToken(interactive: boolean, reason?: string): Promise<string | undefined> {
  const scopes = ['repo'];
  if (!interactive) return (await vscode.authentication.getSession('github', scopes, { silent: true }))?.accessToken;
  const choice = await vscode.window.showWarningMessage(
    reason ?? 'GitHub refused the request. The repository may be private, or you hit the limit for anonymous requests.',
    { modal: true, detail: 'Sign in to GitHub and try again?' },
    'Sign In',
  );
  if (choice !== 'Sign In') return undefined;
  return (await vscode.authentication.getSession('github', scopes, { createIfNone: true })).accessToken;
}

/** Workspace folders on disk (Skill Hub writes files with Node, so virtual folders are skipped). */
export function fileFolders(): readonly vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
}
