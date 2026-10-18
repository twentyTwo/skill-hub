/** Turns core data (hub skills, workspace scans) into the view models in src/shared/api.ts. */
import * as path from 'path';
import { describeSource, sourceWebUrl } from '../../../vscode-extension/src/core/sources';
import type { Target } from '../../../vscode-extension/src/core/targets';
import type { SkillSource } from '../../../vscode-extension/src/core/types';
import type { WorkspaceSkill } from '../../../vscode-extension/src/core/workspace';
import { ATTENTION, STATUS } from '../../../vscode-extension/src/shared/status';
import type { ProjectAction, ProjectHealth, ProjectSkillVM, ProjectVM, SourceVM, TargetVM } from '../shared/api';
import { tildify } from './store';

export function targetVM(target: Target): TargetVM {
  return { id: target.id, label: target.label, short: target.id === 'copilot' ? 'Copilot' : target.label, detail: target.detail };
}

export function sourceVM(source: SkillSource): SourceVM {
  const base = { type: source.type, text: describeSource(source), url: sourceWebUrl(source) };
  switch (source.type) {
    case 'github':
      return { ...base, kind: 'GitHub', label: `${source.owner}/${source.repo}`, subPath: source.path || undefined };
    case 'git':
      return {
        ...base,
        kind: 'Git',
        label: source.url.replace(/^\w+:\/\/|^git@/, '').replace(/\.git$/i, ''),
        subPath: source.path || undefined,
      };
    case 'url': {
      let host = source.url;
      try {
        host = new URL(source.url).hostname;
      } catch {
        // Keep the raw text.
      }
      return { ...base, kind: 'Link', label: host };
    }
    case 'local':
      return { ...base, kind: 'Local', label: tildify(path.dirname(source.path)), subPath: path.basename(source.path) };
    case 'created':
      return { ...base, kind: 'Created', label: 'Created in Skill Hub' };
  }
}

/** What a project row in the nav and the matrix needs. `skills` is the project's scan. */
export function projectVM(root: string, skills: WorkspaceSkill[], targets: Target[], usedTargets: Set<string>): ProjectVM {
  const count = (...statuses: string[]) => skills.filter((s) => statuses.includes(s.status)).length;
  const applied = skills.filter((s) => s.lock).length;
  const parts = [
    `${applied} skill${applied === 1 ? '' : 's'} applied`,
    plural(count('outdated', 'conflict'), 'update'),
    plural(count('modified', 'conflict'), 'local edit'),
    count('missing') ? `${count('missing')} missing` : '',
    count('unmanaged') ? `${count('unmanaged')} untracked` : '',
  ].filter(Boolean);

  let health: ProjectHealth = applied ? 'clean' : 'empty';
  if (count('outdated')) health = 'updates';
  if (count('modified', 'conflict')) health = 'edits';
  if (count('missing')) health = 'broken';

  return {
    root,
    name: path.basename(root) || root,
    exists: true,
    targets: targets.map((t) => ({ ...targetVM(t), on: usedTargets.has(t.id) })),
    health,
    summary: parts.join(' · '),
    skills: skills.map((s) => projectSkillVM(s, targets)),
  };
}

export function missingProjectVM(root: string, targets: Target[], error: string, exists: boolean): ProjectVM {
  return {
    root,
    name: path.basename(root) || root,
    exists,
    error,
    targets: targets.map((t) => ({ ...targetVM(t), on: false })),
    health: 'broken',
    summary: error,
    skills: [],
  };
}

function plural(n: number, word: string): string {
  return n ? `${n} ${word}${n === 1 ? '' : 's'}` : '';
}

/** The statuses design/DESIGN.md §2 gives an inline action, mapped to what the desktop backend can run. */
const ACTION_FOR: Partial<Record<WorkspaceSkill['status'], ProjectAction | 'resolve'>> = {
  outdated: 'update',
  modified: 'saveToHub',
  conflict: 'resolve',
  missing: 'restore',
  unmanaged: 'addToHub',
};

export function projectSkillVM(skill: WorkspaceSkill, targets: Target[]): ProjectSkillVM {
  const label = (id: string) => targets.find((t) => t.id === id)?.label ?? id;
  const partlyMissing = skill.status === 'synced' && skill.missing.length > 0;
  const group = skill.status === 'unmanaged' ? 'untracked' : ATTENTION.includes(skill.status) || partlyMissing ? 'attention' : 'applied';

  // Same conditions as the extension's context flags (vscode-extension/src/ui/workspaceView.ts), so a row
  // only offers what can actually run.
  const can: Record<ProjectAction | 'resolve', boolean> = {
    update: !!skill.lock && (skill.status === 'outdated' || skill.status === 'conflict' || skill.status === 'missing' || skill.missing.length > 0),
    restore: !!skill.lock && (skill.status === 'missing' || skill.missing.length > 0),
    saveToHub: !!skill.localDir && !!skill.hub && (skill.status === 'modified' || skill.status === 'conflict'),
    addToHub: !skill.hub && (!!skill.localDir || !!skill.lock),
    resolve: skill.status === 'conflict' && !!skill.hub,
    takeHub: !!skill.lock,
    keepLocal: !!skill.localDir && !!skill.hub,
    merge: !!skill.localDir && !!skill.hub,
    remove: true,
  };
  let actionId = partlyMissing ? 'restore' : ACTION_FOR[skill.status];
  if (actionId && !can[actionId]) actionId = undefined;
  const actionLabel = actionId === 'restore' ? 'Restore' : STATUS[skill.status].action?.label;

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    status: skill.status,
    inHub: !!skill.hub,
    installed: skill.installed.map(label),
    missing: skill.missing.map(label),
    meta: rowMeta(skill, targets, partlyMissing),
    group,
    action: actionId && actionLabel ? { id: actionId, label: actionLabel } : undefined,
    entryFile: skill.entryFile,
    localDir: skill.localDir,
  };
}

function rowMeta(skill: WorkspaceSkill, targets: Target[], partlyMissing: boolean): string {
  const label = (id: string) => targets.find((t) => t.id === id)?.label ?? id;
  const notInHub = skill.lock && !skill.hub ? ' · not in your hub' : '';
  switch (skill.status) {
    case 'synced':
      return `${skill.installed.map(label).join(' · ')}${partlyMissing ? ` · missing for ${skill.missing.map(label).join(', ')}` : ''}${notInHub}`;
    case 'outdated':
      return `${skill.installed.map(label).join(' · ')} · hub has a newer version`;
    case 'modified':
      return 'Edited in this project';
    case 'conflict':
      return 'Edited here, and the hub is newer';
    case 'missing':
      return `Files missing for ${skill.missing.map(label).join(', ')}${notInHub}`;
    case 'unmanaged': {
      const folders = skill.installed.map((id) => {
        const target = targets.find((t) => t.id === id);
        return target ? target.detail.split('<skill>')[0].replace(/\/$/, '') : id;
      });
      return `In ${folders.join(', ')}${skill.hub ? ' · same name in hub' : ''}`;
    }
  }
}
