import { Library } from './library';
import { LockEntry, readLock, writeLock } from './lock';
import { readSkillMeta } from './skill';
import { Target } from './targets';
import { LibrarySkill } from './types';
import type { SkillStatus, TargetState } from '../shared/status';

export type { SkillStatus, TargetState } from '../shared/status';

export interface WorkspaceSkill {
  id: string;
  root: string;
  name: string;
  description: string;
  status: SkillStatus;
  /** Target ids it's installed for. */
  installed: string[];
  /** Target ids it was applied to whose files are gone. */
  missing: string[];
  lock?: LockEntry;
  hub?: LibrarySkill;
  /** A workspace folder containing this skill as SKILL.md, if any. */
  localDir?: string;
  entryFile?: string;
}

export async function scanWorkspace(root: string, hubSkills: LibrarySkill[], targets: Target[]): Promise<WorkspaceSkill[]> {
  const lock = await readLock(root);
  const targetById = new Map(targets.map((t) => [t.id, t]));
  const hubById = new Map(hubSkills.map((s) => [s.id, s]));
  const result: WorkspaceSkill[] = [];

  for (const [id, entry] of Object.entries(lock.skills)) {
    const installed: string[] = [];
    const missing: string[] = [];
    let modified = false;
    for (const [targetId, appliedHash] of Object.entries(entry.targets ?? {})) {
      const target = targetById.get(targetId);
      if (!target) continue;
      const current = await target.installedHash(id, root);
      if (current === undefined) {
        missing.push(targetId);
      } else {
        installed.push(targetId);
        if (current !== appliedHash) modified = true;
      }
    }
    const hub = hubById.get(id);
    const hubChanged = !!hub && hub.hash !== entry.hash;
    const status: SkillStatus =
      installed.length === 0 ? 'missing' : modified && hubChanged ? 'conflict' : modified ? 'modified' : hubChanged ? 'outdated' : 'synced';
    result.push(await describe(id, root, status, installed, missing, targetById, hub, entry));
  }

  const untracked = new Map<string, string[]>();
  for (const target of targets) {
    for (const id of await target.scan(root)) {
      if (!lock.skills[id]) untracked.set(id, [...(untracked.get(id) ?? []), target.id]);
    }
  }
  for (const [id, targetIds] of untracked) {
    result.push(await describe(id, root, 'unmanaged', targetIds, [], targetById, hubById.get(id)));
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function describe(
  id: string,
  root: string,
  status: SkillStatus,
  installed: string[],
  missing: string[],
  targetById: Map<string, Target>,
  hub?: LibrarySkill,
  lock?: LockEntry,
): Promise<WorkspaceSkill> {
  const localDir = installed.map((t) => targetById.get(t)?.skillFolder(id, root)).find((dir) => !!dir);
  const meta = localDir ? await readSkillMeta(localDir).catch(() => undefined) : undefined;
  return {
    id,
    root,
    name: meta?.name ?? hub?.name ?? id,
    description: meta?.description ?? hub?.description ?? '',
    status,
    installed,
    missing,
    lock,
    hub,
    localDir,
    entryFile: installed.length ? targetById.get(installed[0])!.entryFile(id, root) : undefined,
  };
}

/** How each target's copy of skill `id` in `root` compares with what was applied and with the hub copy `hub`. */
export async function targetStates(root: string, id: string, targets: Target[], hub?: LibrarySkill): Promise<Record<string, TargetState>> {
  const entry = (await readLock(root)).skills[id];
  const states: Record<string, TargetState> = {};
  for (const target of targets) {
    const current = await target.installedHash(id, root);
    const applied = entry?.targets?.[target.id];
    if (applied === undefined) states[target.id] = current === undefined ? 'none' : 'unmanaged';
    else if (current === undefined) states[target.id] = 'missing';
    else if (current !== applied) states[target.id] = 'modified';
    else states[target.id] = hub && hub.hash !== entry.hash ? 'outdated' : 'synced';
  }
  return states;
}

/**
 * Installs a hub skill into `root` for exactly `targets`, removing it from any other target it was applied to,
 * and records it in the lock file.
 */
export async function applySkill(root: string, skill: LibrarySkill, targets: Target[], allTargets: Target[]): Promise<void> {
  const lock = await readLock(root);
  const wanted = new Set(targets.map((t) => t.id));
  for (const previous of Object.keys(lock.skills[skill.id]?.targets ?? {})) {
    if (!wanted.has(previous)) await allTargets.find((t) => t.id === previous)?.uninstall(skill.id, root);
  }
  const installed: Record<string, string> = {};
  for (const target of targets) installed[target.id] = await target.install(skill, root);
  lock.skills[skill.id] = { source: skill.source, hash: skill.hash, targets: installed, appliedAt: new Date().toISOString() };
  await writeLock(root, lock);
}

/** Removes a skill from every target it's installed in, and from the lock file. */
export async function removeSkill(root: string, id: string, allTargets: Target[]): Promise<void> {
  for (const target of allTargets) {
    if ((await target.installedHash(id, root)) !== undefined) await target.uninstall(id, root);
  }
  const lock = await readLock(root);
  if (lock.skills[id]) {
    delete lock.skills[id];
    await writeLock(root, lock);
  }
}

/**
 * Copies a workspace skill's local files into the hub (keeping its recorded source, if any), then re-applies it so
 * every target and the lock file agree with the new hub copy.
 */
export async function saveToHub(skill: WorkspaceSkill, library: Library, allTargets: Target[]): Promise<LibrarySkill> {
  if (!skill.localDir) throw new Error(`"${skill.name}" has no SKILL.md folder in this workspace to copy from.`);
  const source = skill.lock?.source ?? skill.hub?.source ?? { type: 'local' as const, path: skill.localDir };
  const saved = await library.add(skill.localDir, source, { id: skill.id, overwrite: true });
  const targets = allTargets.filter((t) => skill.installed.includes(t.id) || skill.missing.includes(t.id));
  await applySkill(skill.root, saved, targets, allTargets);
  return saved;
}
