import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseFrontmatter } from '../core/frontmatter';
import { exists, listFiles } from '../core/fsutil';
import { LOCK_FILE, readLock } from '../core/lock';
import { findSkillFile } from '../core/skill';
import { canUpdate, sourceWebUrl } from '../core/sources';
import { Target } from '../core/targets';
import { LibrarySkill, SkillSource } from '../core/types';
import { errorMessage } from '../core/util';
import { targetStates, WorkspaceSkill } from '../core/workspace';
import { DetailSpec, DetailState, LibrarySkillVM, RepoVM, SidebarState, WorkspaceSkillVM } from '../shared/protocol';
import { ATTENTION, STATUS, TARGET_STATE_LABEL } from '../shared/status';
import { fileFolders, Hub } from './hub';
import { libraryFlags } from './libraryView';
import { contextValue } from './workspaceView';

const PREVIEW_LINES = 24;

export async function sidebarState(hub: Hub, selected?: DetailSpec): Promise<SidebarState> {
  const folders = fileFolders();
  const active = hub.activeFolder();
  const state: SidebarState = { folders: folders.map((f) => ({ root: f.uri.fsPath, name: f.name })), library: [], selected };

  let hubSkills: LibrarySkill[] = [];
  try {
    hubSkills = await hub.skills();
  } catch (err) {
    state.libraryError = `Could not read ${hub.library.root}: ${errorMessage(err)}`;
  }

  let workspace: WorkspaceSkill[] = [];
  if (active) {
    state.repo = await repoState(hub, active).catch((err) => ({
      root: active.uri.fsPath,
      name: active.name,
      hasLock: false,
      summary: '',
      targets: [],
      skills: [],
      error: `Could not read skills in ${active.name}: ${errorMessage(err)}`,
    }));
    workspace = await hub.workspaceSkills(active).catch(() => []);
  }

  const here = new Map(workspace.map((s) => [s.id, s]));
  state.library = hubSkills.map((skill): LibrarySkillVM => {
    const local = here.get(skill.id);
    const { badge, label } = sourceGroup(skill.source);
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourceBadge: badge,
      sourceLabel: label,
      appliedHere: !!local && local.status !== 'unmanaged',
      hasUpdate: local?.status === 'outdated' || local?.status === 'conflict',
      flags: libraryFlags(skill),
    };
  });
  return state;
}

async function repoState(hub: Hub, folder: vscode.WorkspaceFolder): Promise<RepoVM> {
  const root = folder.uri.fsPath;
  const targets = hub.targets();
  const skills = await hub.workspaceSkills(folder);
  const lock = await readLock(root);
  const used = new Set(Object.values(lock.skills).flatMap((entry) => Object.keys(entry.targets ?? {})));

  const applied = skills.filter((s) => s.lock).length;
  const count = (...statuses: string[]) => skills.filter((s) => statuses.includes(s.status)).length;
  const parts = [
    `${applied} skill${applied === 1 ? '' : 's'} applied`,
    plural(count('outdated', 'conflict'), 'update'),
    plural(count('modified', 'conflict'), 'local edit'),
    plural(count('missing'), 'missing'),
    plural(count('unmanaged'), 'untracked'),
  ].filter(Boolean);

  return {
    root,
    name: folder.name,
    hasLock: await exists(path.join(root, LOCK_FILE)),
    summary: parts.join(' · '),
    targets: targets.map((t) => ({ id: t.id, label: shortLabel(t), on: used.has(t.id) })),
    skills: skills.map((s) => workspaceSkillVM(s, targets)),
  };
}

function plural(n: number, word: string): string {
  if (!n) return '';
  return word === 'missing' || word === 'untracked' ? `${n} ${word}` : `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "GitHub Copilot" reads as "Copilot" on the small chips. */
function shortLabel(target: Target): string {
  return target.id === 'copilot' ? 'Copilot' : target.label;
}

function workspaceSkillVM(skill: WorkspaceSkill, targets: Target[]): WorkspaceSkillVM {
  const flags = contextValue(skill);
  const has = (flag: string) => new RegExp(`\\b${flag}\\b`).test(flags);
  const partlyMissing = skill.status === 'synced' && skill.missing.length > 0;
  const group = skill.status === 'unmanaged' ? 'untracked' : ATTENTION.includes(skill.status) || partlyMissing ? 'attention' : 'applied';

  // The design's one inline action, shown only when the matching command can act on this skill.
  let action = STATUS[skill.status].action;
  if (partlyMissing) action = { label: 'Restore', command: 'skillHub.workspace.update' };
  const allowed: Record<string, boolean> = {
    'skillHub.workspace.update': has('syncable'),
    'skillHub.workspace.saveToHub': has('pushable'),
    'skillHub.workspace.addToHub': has('adoptable'),
    'skillHub.workspace.resolve': has('conflicted'),
  };
  if (action && !allowed[action.command]) action = undefined;

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    status: skill.status,
    meta: rowMeta(skill, targets, partlyMissing),
    group,
    action,
    flags,
  };
}

function rowMeta(skill: WorkspaceSkill, targets: Target[], partlyMissing: boolean): string {
  const label = (id: string) => targets.find((t) => t.id === id)?.label ?? id;
  const notInHub = skill.lock && !skill.hub ? ' · not in your hub' : '';
  switch (skill.status) {
    case 'synced':
      return `${skill.installed.join(' · ')}${partlyMissing ? ` · missing for ${skill.missing.map(label).join(', ')}` : ''}${notInHub}`;
    case 'outdated':
      return `Update available from ${skill.lock ? sourceGroup(skill.lock.source).label : 'your hub'}`;
    case 'modified':
      return 'Edited in this repo';
    case 'conflict':
      return 'Edited here, and the hub is newer';
    case 'missing':
      return `Files missing for ${skill.missing.map(label).join(', ')}${notInHub}`;
    case 'unmanaged': {
      const folders = skill.installed.map((id) => {
        const target = targets.find((t) => t.id === id);
        return target ? folderOf(target) : id;
      });
      return `in ${folders.join(', ')}${skill.hub ? ' · same name in hub' : ''}`;
    }
  }
}

/** `.claude/skills/<skill>/` → `.claude/skills` */
function folderOf(target: Target): string {
  return target.detail.split('<skill>')[0].replace(/\/$/, '');
}

export function sourceGroup(source: SkillSource): { badge: string; label: string; kind: string } {
  switch (source.type) {
    case 'github':
      return { badge: 'gh', kind: 'GitHub', label: `${source.owner}/${source.repo}` };
    case 'git':
      return { badge: 'git', kind: 'Git', label: source.url.replace(/^\w+:\/\/|^git@/, '').replace(/\.git$/i, '') };
    case 'url': {
      let host = source.url;
      try {
        host = new URL(source.url).hostname;
      } catch {
        // Keep the raw text.
      }
      return { badge: 'url', kind: 'Link', label: host };
    }
    case 'local': {
      const home = os.homedir();
      const dir = path.dirname(source.path);
      return { badge: 'local', kind: 'Local', label: dir.startsWith(home) ? `~${dir.slice(home.length).replace(/\\/g, '/')}` : dir };
    }
    case 'created':
      return { badge: 'new', kind: 'Created', label: 'Created in Skill Hub' };
    case 'builtin':
      return { badge: 'built-in', kind: 'Built-in', label: 'Comes with Skill Hub' };
  }
}

/** Everything the detail page shows for skill `id`, as seen from `folder` (if any). */
export async function detailState(hub: Hub, id: string, folder: vscode.WorkspaceFolder | undefined): Promise<DetailState> {
  const hubSkill = (await hub.skills().catch(() => [])).find((s) => s.id === id);
  const local = folder ? (await hub.workspaceSkills(folder).catch(() => [])).find((s) => s.id === id) : undefined;
  const targets = hub.targets();
  if (!hubSkill && !local) {
    return { name: id, description: '', inHub: false, builtin: false, canCheckSource: false, canApply: false, applyLabel: '', targets: [], files: [], gone: true };
  }

  const source = local?.lock?.source ?? hubSkill?.source;
  const group = source && sourceGroup(source);
  const states = folder ? await targetStates(folder.uri.fsPath, id, targets, hubSkill) : {};
  const dir = local?.localDir ?? hubSkill?.dir;
  const skillFile = local?.entryFile ?? (hubSkill ? await findSkillFile(hubSkill.dir) : undefined);
  const status = local ? STATUS[local.status] : undefined;
  const applied = !!local?.lock;
  const vm = local ? workspaceSkillVM(local, targets) : undefined;

  return {
    name: local?.name ?? hubSkill!.name,
    description: local?.description || hubSkill?.description || '',
    status: local && status ? { status: local.status, label: status.label, glyph: status.glyph, action: vm?.action } : undefined,
    folder: folder && { root: folder.uri.fsPath, name: folder.name },
    source: source && group && source.type !== 'created' ? { kind: group.kind, text: group.label, url: sourceWebUrl(source) } : undefined,
    dateLabel: local?.lock ? `Applied ${formatDate(local.lock.appliedAt)}` : hubSkill ? `Updated ${formatDate(hubSkill.updatedAt)}` : undefined,
    hash: (local?.lock?.hash ?? hubSkill?.hash)?.slice(0, 8),
    inHub: !!hubSkill && !hubSkill.builtin,
    builtin: !!hubSkill?.builtin,
    canCheckSource: !!hubSkill && canUpdate(hubSkill.source),
    // An untracked skill that isn't in the hub has to be added to the hub first (its status action).
    canApply: !!folder && (!!hubSkill || applied),
    applyLabel: applied ? 'Apply to more targets' : folder ? `Apply to ${folder.name}` : 'Apply',
    targets: folder
      ? targets.map((t) => {
          const state = states[t.id] ?? 'none';
          return {
            id: t.id,
            label: t.label,
            state,
            stateLabel: TARGET_STATE_LABEL[state],
            path: state === 'none' ? t.detail.split('<skill>')[0] : t.detail.replace(/<skill>/g, id),
          };
        })
      : [],
    skillMd: skillFile ? await preview(skillFile) : undefined,
    files: dir ? (await listFiles(dir)).slice(0, 200) : [],
    remove: local
      ? { label: `Remove from ${folder!.name}`, command: 'skillHub.workspace.remove' }
      : hubSkill && !hubSkill.builtin
        ? { label: 'Remove from hub', command: 'skillHub.deleteSkill' }
        : undefined,
  };
}

async function preview(file: string): Promise<DetailState['skillMd']> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  const { data, body } = parseFrontmatter(text);
  const lines = body.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').split('\n');
  return {
    frontmatter: Object.entries(data).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })),
    body: lines.slice(0, PREVIEW_LINES).join('\n'),
    truncated: lines.length > PREVIEW_LINES,
  };
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
