/**
 * Messages and view models passed between the extension and its webviews.
 * Shared by both sides, so it must not import `vscode` or Node modules.
 */
import type { SkillStatus, TargetState } from './status';

/**
 * A serializable pointer to something a command acts on. Webviews send these (and put them in `data-vscode-context`
 * for context menus); the extension resolves them back into library skills or workspace nodes before running a command.
 */
export type Ref =
  | { refKind: 'library'; refId: string }
  | { refKind: 'workspace'; refId: string; refRoot: string }
  | { refKind: 'folder'; refRoot: string };

export interface FolderVM {
  root: string;
  name: string;
}

export interface TargetVM {
  id: string;
  label: string;
}

// ------------------------------------------------------------------ Sidebar

export interface WorkspaceSkillVM {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  /** Second line of the row: targets, or why it needs attention. */
  meta: string;
  /** Group the row is listed under. */
  group: 'attention' | 'applied' | 'untracked';
  /** The one inline action, when it applies to this skill. */
  action?: { label: string; command: string };
  /** Space-separated flags matched by `webview/context` menu `when` clauses. */
  flags: string;
}

export interface RepoVM extends FolderVM {
  hasLock: boolean;
  summary: string;
  /** Every target, `on` when some skill in the lock file uses it. */
  targets: (TargetVM & { on: boolean })[];
  skills: WorkspaceSkillVM[];
  error?: string;
}

export interface LibrarySkillVM {
  id: string;
  name: string;
  description: string;
  /** Short source badge (`gh`, `git`, `url`, `local`, `new`, `built-in`) and label, used to group the Library. */
  sourceBadge: string;
  sourceLabel: string;
  appliedHere: boolean;
  hasUpdate: boolean;
  flags: string;
}

export interface SidebarState {
  folders: FolderVM[];
  repo?: RepoVM;
  library: LibrarySkillVM[];
  libraryError?: string;
  /** The skill shown in the active detail panel. */
  selected?: DetailSpec;
}

export interface SearchResultVM {
  /** Hub id it would be stored under. */
  id: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  /** Folder holding the SKILL.md; empty for the repository root. */
  path: string;
  url: string;
}

export type SidebarInbound =
  | { type: 'state'; state: SidebarState }
  | { type: 'showTab'; tab: SidebarTab; focus?: boolean }
  | { type: 'searchStarted'; query: string }
  | { type: 'searchResults'; query: string; results: SearchResultVM[] }
  | { type: 'searchError'; query: string; message: string };

export type SidebarTab = 'repo' | 'library' | 'discover';

export type SidebarOutbound =
  | { type: 'ready' }
  | { type: 'command'; id: string; ref?: Ref }
  | { type: 'open'; ref: Ref }
  | { type: 'selectFolder'; root: string }
  | { type: 'apply'; ids: string[] }
  | { type: 'search'; query: string }
  | { type: 'addSearchResult'; result: SearchResultVM }
  | { type: 'addPaths'; uris: string[] };

// ------------------------------------------------------------------ Skill detail

export interface DetailTargetVM extends TargetVM {
  state: TargetState;
  stateLabel: string;
  path: string;
}

export interface DetailState {
  name: string;
  description: string;
  status?: { status: SkillStatus; label: string; glyph: string; action?: { label: string; command: string } };
  folder?: FolderVM;
  source?: { kind: string; text: string; url?: string };
  /** "Applied Oct 17, 2026" or "Updated …" */
  dateLabel?: string;
  hash?: string;
  inHub: boolean;
  /** Shown from the built-in copy: it can be applied, or copied to the hub to edit it. */
  builtin: boolean;
  canCheckSource: boolean;
  canApply: boolean;
  applyLabel: string;
  targets: DetailTargetVM[];
  skillMd?: { frontmatter: { key: string; value: string }[]; body: string; truncated: boolean };
  files: string[];
  remove?: { label: string; command: string };
  gone?: boolean;
}

/** Which skill a detail panel shows, and from which workspace folder. Also the panel's saved state. */
export interface DetailSpec {
  id: string;
  root?: string;
}

export type DetailInbound = { type: 'state'; state: DetailState; spec: DetailSpec };

export type DetailOutbound =
  | { type: 'ready' }
  | { type: 'command'; id: string }
  | { type: 'apply' }
  | { type: 'install'; target: string }
  | { type: 'openSkillFile' }
  | { type: 'openFile'; file: string }
  | { type: 'openSource' };

// ------------------------------------------------------------------ Add skills

export type InputKind = 'empty' | 'github' | 'git' | 'url' | 'local' | 'search';

export interface FoundSkillVM {
  name: string;
  description: string;
  path: string;
  /** `inHub`: same skill, same source. `nameTaken`: a different skill already uses the name. */
  hub: 'new' | 'inHub' | 'nameTaken';
}

export interface AddSetup {
  folders: FolderVM[];
  activeRoot?: string;
  targets: TargetVM[];
  defaultTargets: string[];
}

export type AddInbound =
  | { type: 'setup'; setup: AddSetup }
  | { type: 'detected'; value: string; kind: InputKind; detail?: string }
  | { type: 'setInput'; value: string; find?: boolean }
  | { type: 'busy'; message: string }
  | { type: 'found'; title: string; skills: FoundSkillVM[] }
  | { type: 'error'; message: string }
  | { type: 'added'; message: string };

export type AddOutbound =
  | { type: 'ready' }
  | { type: 'detect'; value: string }
  | { type: 'find'; value: string }
  | { type: 'browse'; folder: boolean }
  | { type: 'create' }
  | { type: 'add'; indices: number[]; apply?: { root: string; targets: string[] } };
