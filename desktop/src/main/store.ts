import * as os from 'os';
import * as path from 'path';
import { readJson, writeJson } from '../../../vscode-extension/src/core/fsutil';
import type { CustomTargetConfig } from '../../../vscode-extension/src/core/targets';
import type { ActivityEntry, FileChange } from '../shared/api';

export interface Settings {
  /** Empty means `~/.skill-hub`, the same default as the VS Code extension, so both share one hub. */
  libraryPath: string;
  defaultTargets: string[];
  agentsSkillsFolder: string;
  customTargets: CustomTargetConfig[];
  editorCommand: string;
  libraryView: 'grid' | 'list';
  /** Project folders, in the order they were added. */
  projects: string[];
  /** Encrypted with the OS keychain (Electron safeStorage), base64. */
  githubToken?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  libraryPath: '',
  defaultTargets: ['claude'],
  agentsSkillsFolder: '.agents/skills',
  customTargets: [],
  editorCommand: 'code',
  libraryView: 'grid',
  projects: [],
};

/** The last source check of a skill, kept across restarts so "Has update" survives them. */
export interface StoredCheck {
  /** Hub hash the check compared against; a different hub hash makes it stale. */
  hubHash: string;
  state: 'current' | 'newer' | 'error';
  checkedAt: string;
  changes?: FileChange[];
  message?: string;
}

const MAX_ACTIVITY = 300;

/** JSON files in the app's data folder: settings, source checks and the activity log. */
export class Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  checks: Record<string, StoredCheck> = {};
  activity: ActivityEntry[] = [];

  constructor(readonly dir: string) {}

  async load(): Promise<void> {
    const saved = await readJson<Partial<Settings>>(this.file('settings.json'), {}).catch(() => ({}));
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    this.checks = await readJson<Record<string, StoredCheck>>(this.file('checks.json'), {}).catch(() => ({}));
    this.activity = await readJson<ActivityEntry[]>(this.file('activity.json'), []).catch(() => []);
    if (!Array.isArray(this.activity)) this.activity = [];
  }

  saveSettings(): Promise<void> {
    return writeJson(this.file('settings.json'), this.settings);
  }

  saveChecks(): Promise<void> {
    return writeJson(this.file('checks.json'), this.checks);
  }

  log(kind: ActivityEntry['kind'], text: string): void {
    this.activity.unshift({ at: new Date().toISOString(), kind, text });
    this.activity.length = Math.min(this.activity.length, MAX_ACTIVITY);
    void writeJson(this.file('activity.json'), this.activity).catch(() => undefined);
  }

  libraryRoot(): string {
    return resolveHome(this.settings.libraryPath.trim() || '~/.skill-hub');
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }
}

export function resolveHome(p: string): string {
  return /^~([\\/]|$)/.test(p) ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
}

/** `C:\Users\me\.skill-hub` → `~/.skill-hub` */
export function tildify(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length).replace(/\\/g, '/')}` : p;
}
