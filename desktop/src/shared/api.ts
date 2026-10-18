/**
 * The contract between the main process (which owns the hub, the projects and the file system) and the renderer.
 * Shared by both sides, so it must not import Electron or Node modules.
 */
import type { InputKind } from '../../../vscode-extension/src/shared/protocol';
import type { SkillStatus } from '../../../vscode-extension/src/shared/status';

export type { InputKind, SkillStatus };

export interface TargetVM {
  id: string;
  label: string;
  /** "GitHub Copilot" reads as "Copilot" on chips. */
  short: string;
  /** Where it writes, e.g. `.claude/skills/<skill>/`. */
  detail: string;
}

export interface SourceVM {
  /** github | git | url | local | created */
  type: string;
  /** "GitHub", "Git", "Link", "Local", "Created". */
  kind: string;
  /** Short label: `owner/repo`, a host, or a folder. Skills with the same label are grouped as one source. */
  label: string;
  /** The full location, from `describeSource`. */
  text: string;
  /** Path inside the source, shown after the label. */
  subPath?: string;
  url?: string;
}

/** One project a hub skill is applied in. */
export interface UsageVM {
  root: string;
  project: string;
  /** Target labels. */
  targets: string[];
  status: SkillStatus;
}

export interface FileChange {
  path: string;
  change: 'added' | 'removed' | 'changed';
}

/** What the last check of a skill's source found. Only `newer` offers an update. */
export type SourceCheck =
  | { state: 'checking' }
  | { state: 'current'; checkedAt: string }
  | { state: 'newer'; checkedAt: string; changes: FileChange[] }
  | { state: 'error'; checkedAt: string; message: string };

export interface HubSkillVM {
  id: string;
  name: string;
  description: string;
  dir: string;
  skillFile?: string;
  source: SourceVM;
  canUpdate: boolean;
  hash: string;
  updatedAt: string;
  usedIn: UsageVM[];
  check?: SourceCheck;
}

export type ProjectAction = 'update' | 'restore' | 'saveToHub' | 'addToHub' | 'takeHub' | 'keepLocal' | 'merge' | 'remove';

export interface ProjectSkillVM {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  inHub: boolean;
  /** Target labels it's installed for. */
  installed: string[];
  /** Target labels whose files are gone. */
  missing: string[];
  /** Second line of a row: targets, or why it needs attention. */
  meta: string;
  group: 'attention' | 'applied' | 'untracked';
  /** The one inline action from design/DESIGN.md §2, when it can run. */
  action?: { id: ProjectAction | 'resolve'; label: string };
  /** The file to open for this skill. */
  entryFile?: string;
  /** The SKILL.md folder in the project, when there is one (merging needs it). */
  localDir?: string;
}

/** Status dot in the nav: blue = updates, amber = local edits or conflict, red = missing files or unreadable, green = clean. */
export type ProjectHealth = 'updates' | 'edits' | 'broken' | 'clean' | 'empty';

export interface ProjectVM {
  root: string;
  name: string;
  /** False when the folder was moved or deleted since it was added. */
  exists: boolean;
  error?: string;
  /** Every target, `on` when some skill in the lock file uses it. */
  targets: (TargetVM & { on: boolean })[];
  health: ProjectHealth;
  summary: string;
  skills: ProjectSkillVM[];
}

export interface CustomTargetVM {
  id: string;
  label?: string;
  folder: string;
}

export interface SettingsVM {
  libraryPath: string;
  defaultTargets: string[];
  agentsSkillsFolder: string;
  customTargets: CustomTargetVM[];
  /** Command used for "Open in VS Code" and for editing files. */
  editorCommand: string;
  libraryView: 'grid' | 'list';
  /** Where the GitHub token comes from, if there is one. */
  github: { source: 'env' | 'gh' | 'saved' | 'none'; canSave: boolean };
}

export interface ActivityEntry {
  at: string;
  kind: 'add' | 'update' | 'apply' | 'remove' | 'save' | 'resolve' | 'project' | 'check' | 'error';
  text: string;
}

export interface AppState {
  version: string;
  libraryRoot: string;
  /** `libraryRoot` with the home folder shortened to `~`. */
  libraryDisplay: string;
  libraryError?: string;
  skills: HubSkillVM[];
  projects: ProjectVM[];
  targets: TargetVM[];
  settings: SettingsVM;
  activity: ActivityEntry[];
  /** Labels of operations still running, shown in the top bar. */
  busy: string[];
}

// ------------------------------------------------------------------ Adding skills

export interface FoundSkillVM {
  /** Index into the listing; sent back to import it. */
  index: number;
  name: string;
  description: string;
  path: string;
  kind: 'folder' | 'file';
  /** The hub id it will be stored under. */
  id: string;
  /** Already in the hub from this same source. */
  inHub: boolean;
  /** The name is taken by a different skill, so it will be stored as `id` instead. */
  renamed: boolean;
}

export interface SourceListing {
  /** Pass back to `importListed`/`closeListing`. */
  token: string;
  label: string;
  skills: FoundSkillVM[];
}

export interface SearchResultVM {
  owner: string;
  repo: string;
  path: string;
  name: string;
  description: string;
  url: string;
  inHub: boolean;
}

/** Where a GitHub search result or a source string points. Mirrors core's SourceSpec. */
export type SourceInput =
  | string
  | { type: 'github'; owner: string; repo: string; ref?: string; path?: string };

export interface ApplyRequest {
  roots: string[];
  targets: string[];
}

// ------------------------------------------------------------------ Diffs

export interface DiffLine {
  /**
   * same: in both. removed/added: only in the old/new side (red/green). local: only in the project's copy (amber).
   * gap: `text` unchanged lines skipped.
   */
  kind: 'same' | 'removed' | 'added' | 'local' | 'gap';
  text: string;
}

export interface ReviewVM {
  id: string;
  name: string;
  source: string;
  changes: FileChange[];
  /** SKILL.md (or the first changed text file), hub → source. */
  file?: string;
  diff: DiffLine[];
  usedIn: number;
}

export interface ConflictVM {
  id: string;
  name: string;
  root: string;
  project: string;
  /** The file the diff is of, relative to the skill folder. */
  file: string;
  diff: DiffLine[];
  /** Other files that differ between the hub and the project. */
  otherFiles: string[];
  /** Merging and "keep local" need the skill as a SKILL.md folder in the project (not only a Cursor rule). */
  canMerge: boolean;
}

// ------------------------------------------------------------------ Calls

/** Every call the renderer can make. Each runs in the main process; see src/main/backend.ts. */
export interface Api {
  getState(): Promise<AppState>;

  // Projects
  pickProjectFolders(): Promise<string[]>;
  addProjects(roots: string[]): Promise<void>;
  removeProject(root: string): Promise<void>;
  projectAction(root: string, id: string, action: ProjectAction): Promise<void>;
  /** Skills an apply would overwrite (edited copies, or untracked files in the way). Empty means it's safe. */
  applyWarnings(id: string, request: ApplyRequest): Promise<string[]>;
  applySkill(id: string, request: ApplyRequest): Promise<void>;
  /** Updates every `outdated` and `missing` skill, never `modified` or `conflict`. Returns how many. */
  updateAllSafe(roots?: string[]): Promise<number>;
  conflict(root: string, id: string): Promise<ConflictVM>;

  // Adding
  classify(input: string): Promise<{ kind: InputKind; detail?: string }>;
  listSource(input: SourceInput): Promise<SourceListing>;
  importListed(token: string, indexes: number[], apply?: ApplyRequest): Promise<string[]>;
  closeListing(token: string): Promise<void>;
  pickLocalSource(): Promise<string | undefined>;
  validateName(name: string): Promise<string | undefined>;
  createSkill(name: string, description: string): Promise<string>;
  search(query: string): Promise<SearchResultVM[]>;

  // Hub
  checkSources(ids?: string[]): Promise<{ newer: string[]; failed: number }>;
  review(id: string): Promise<ReviewVM>;
  updateFromSource(ids: string[]): Promise<{ changed: string[]; failed: string[] }>;
  deleteSkill(id: string): Promise<void>;

  // Settings
  saveSettings(patch: Partial<Omit<SettingsVM, 'github'>>): Promise<void>;
  pickLibraryFolder(): Promise<string | undefined>;
  setGitHubToken(token: string | null): Promise<void>;

  // Outside the app
  openInEditor(path: string): Promise<void>;
  openFolder(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

export type ApiMethod = keyof Api;

/** Main → renderer events. */
export type AppEvent =
  | { type: 'state'; state: AppState }
  | { type: 'toast'; kind: 'info' | 'warning' | 'error'; text: string; action?: { label: string; event: string } }
  | { type: 'navigate'; view: string };

/** What the preload script exposes as `window.skillHub`. */
export interface Bridge {
  call<M extends ApiMethod>(method: M, ...args: Parameters<Api[M]>): ReturnType<Api[M]>;
  onEvent(listener: (event: AppEvent) => void): void;
  platform: string;
}

export const API_CHANNEL = 'skill-hub:call';
export const EVENT_CHANNEL = 'skill-hub:event';
