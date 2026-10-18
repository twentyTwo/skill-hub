/**
 * Shared by the extension and its webviews, so it must not import `vscode` or Node modules.
 * The single source of truth for how each status looks and what its one inline action is (design/DESIGN.md §2).
 */

export type SkillStatus =
  /** Installed files match what was applied, and the hub has nothing newer. */
  | 'synced'
  /** The hub copy changed since it was applied. */
  | 'outdated'
  /** The installed files were edited in the workspace. */
  | 'modified'
  /** Both of the above. */
  | 'conflict'
  /** Recorded in the lock file but not installed for any target (e.g. a fresh clone that ignores skill folders). */
  | 'missing'
  /** Found in a skills folder but not applied through Skill Hub. */
  | 'unmanaged';

export interface StatusInfo {
  glyph: string;
  /** Short label for rows and pills. */
  label: string;
  /** Codicon name for tree views. */
  icon: string;
  /** Theme color for tree view icons. */
  color?: string;
  /** The one inline action for this status, if any. */
  action?: { label: string; command: string };
}

export const STATUS: Record<SkillStatus, StatusInfo> = {
  synced: { glyph: '✓', label: 'Up to date', icon: 'pass', color: 'testing.iconPassed' },
  outdated: {
    glyph: '↑',
    label: 'Update available',
    icon: 'arrow-circle-up',
    color: 'charts.blue',
    action: { label: 'Update', command: 'skillHub.workspace.update' },
  },
  modified: {
    glyph: '✎',
    label: 'Edited in this repo',
    icon: 'edit',
    color: 'charts.yellow',
    action: { label: 'Save to hub', command: 'skillHub.workspace.saveToHub' },
  },
  conflict: {
    glyph: '!',
    label: 'Both changed',
    icon: 'warning',
    color: 'charts.orange',
    action: { label: 'Resolve…', command: 'skillHub.workspace.resolve' },
  },
  missing: {
    glyph: '×',
    label: 'Files missing',
    icon: 'error',
    color: 'charts.red',
    action: { label: 'Restore', command: 'skillHub.workspace.update' },
  },
  unmanaged: {
    glyph: '○',
    label: 'Not tracked',
    icon: 'circle-large-outline',
    action: { label: 'Add to hub', command: 'skillHub.workspace.addToHub' },
  },
};

/** Statuses grouped under "Needs attention" in the sidebar. */
export const ATTENTION: readonly SkillStatus[] = ['outdated', 'modified', 'conflict', 'missing'];

/** Statuses counted in the Activity Bar badge: ones an update from the hub fixes or needs a decision. */
export const BADGE: readonly SkillStatus[] = ['outdated', 'conflict', 'missing'];

/** How one target's installed copy compares with what was applied. `none`: not installed for that target. */
export type TargetState = 'synced' | 'outdated' | 'modified' | 'missing' | 'unmanaged' | 'none';

export const TARGET_STATE_LABEL: Record<TargetState, string> = {
  synced: '✓ In sync',
  outdated: '↑ Update available',
  modified: '✎ Edited here',
  missing: '× Files missing',
  unmanaged: '○ Not tracked',
  none: 'Not installed',
};
