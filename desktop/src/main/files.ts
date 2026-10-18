/** Comparing and merging skill folders, for "Review changes" and "Merge both". */
import { promises as fs } from 'fs';
import * as path from 'path';
import { listFiles, writeFile } from '../../../vscode-extension/src/core/fsutil';
import { isSkillFileName } from '../../../vscode-extension/src/core/skill';
import type { FileChange } from '../shared/api';
import { mergeWithMarkers } from '../shared/diff';

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

/** Same rule as core's hash: text compares with LF line endings, so a CRLF checkout isn't a change. */
function sameContent(a: Buffer, b: Buffer): boolean {
  if (isBinary(a) || isBinary(b)) return a.equals(b);
  return a.toString('utf8').replace(/\r\n/g, '\n') === b.toString('utf8').replace(/\r\n/g, '\n');
}

const read = (dir: string, rel: string) => fs.readFile(path.join(dir, ...rel.split('/')));

/** Files that differ going from folder `from` to folder `to`. SKILL.md first, then by path. */
export async function compareDirs(from: string, to: string): Promise<FileChange[]> {
  const [a, b] = await Promise.all([listFiles(from), listFiles(to)]);
  const inA = new Set(a);
  const inB = new Set(b);
  const changes: FileChange[] = [];
  for (const rel of [...new Set([...a, ...b])].sort()) {
    if (!inA.has(rel)) changes.push({ path: rel, change: 'added' });
    else if (!inB.has(rel)) changes.push({ path: rel, change: 'removed' });
    else if (!sameContent(await read(from, rel), await read(to, rel))) changes.push({ path: rel, change: 'changed' });
  }
  return changes.sort((x, y) => Number(isSkillFileName(y.path)) - Number(isSkillFileName(x.path)));
}

/** Text of `rel` in `dir`, or '' when it doesn't exist or is binary. */
export async function readText(dir: string, rel: string): Promise<string> {
  try {
    const buf = await read(dir, rel);
    return isBinary(buf) ? '' : buf.toString('utf8');
  } catch {
    return '';
  }
}

export async function isTextFile(dir: string, rel: string): Promise<boolean> {
  try {
    return !isBinary(await read(dir, rel));
  } catch {
    return false;
  }
}

/**
 * Brings the hub's version into the project's copy without losing either side: files only in the hub are added,
 * files only in the project are kept, and text files that differ get both versions with conflict markers.
 * Binary files that differ keep the project's version. There's no common ancestor (the lock file only stores
 * hashes), so every difference is shown as a conflict for the user to settle in their editor.
 */
export async function mergeIntoLocal(localDir: string, hubDir: string, localLabel: string): Promise<{ conflicts: number; files: string[]; keptBinary: string[] }> {
  const files: string[] = [];
  const keptBinary: string[] = [];
  let conflicts = 0;
  for (const change of await compareDirs(localDir, hubDir)) {
    const target = path.join(localDir, ...change.path.split('/'));
    if (change.change === 'added') {
      await writeFile(target, await read(hubDir, change.path));
      files.push(change.path);
    } else if (change.change === 'changed') {
      const [local, hub] = await Promise.all([read(localDir, change.path), read(hubDir, change.path)]);
      if (isBinary(local) || isBinary(hub)) {
        keptBinary.push(change.path);
        continue;
      }
      const merged = mergeWithMarkers(local.toString('utf8'), hub.toString('utf8'), localLabel, 'hub');
      await writeFile(target, merged.text);
      conflicts += merged.conflicts;
      files.push(change.path);
    }
  }
  return { conflicts, files, keptBinary };
}
