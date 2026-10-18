import * as path from 'path';
import { readJson, remove, writeJson } from './fsutil';
import { SkillSource } from './types';

/** Lives at the workspace root and records which hub skills were applied, so status and restore work. */
export const LOCK_FILE = 'skill-hub.lock.json';

export interface LockEntry {
  source: SkillSource;
  /** Hub content hash at the time the skill was applied. */
  hash: string;
  /** Target id → hash of what was written for that target. */
  targets: Record<string, string>;
  appliedAt: string;
}

export interface Lock {
  version: 1;
  skills: Record<string, LockEntry>;
}

export async function readLock(root: string): Promise<Lock> {
  const lock = await readJson<Lock>(path.join(root, LOCK_FILE), { version: 1, skills: {} });
  lock.skills ??= {};
  return lock;
}

/** Writes the lock with stable key order; deletes the file once no skills are left. */
export async function writeLock(root: string, lock: Lock): Promise<void> {
  const file = path.join(root, LOCK_FILE);
  const entries = Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return remove(file);
  await writeJson(file, { version: 1, skills: Object.fromEntries(entries) });
}
