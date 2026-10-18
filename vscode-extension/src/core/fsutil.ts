import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Never copied, hashed or listed as part of a skill. */
const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db']);

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Recursively lists regular files under `dir` as sorted, forward-slash relative paths. Symlinks are skipped. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  await walk('');
  return out.sort();
}

export async function copyDir(src: string, dest: string, filter?: (rel: string) => boolean): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const rel of await listFiles(src)) {
    if (filter && !filter(rel)) continue;
    const target = path.join(dest, ...rel.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(src, ...rel.split('/')), target);
  }
}

/** Replaces `dest` with a copy of `src`, without losing `dest` if the copy fails halfway. */
export async function replaceDir(src: string, dest: string): Promise<void> {
  const staging = `${dest}.incoming-${process.pid}-${Date.now()}`;
  try {
    await copyDir(src, staging);
    await remove(dest);
    try {
      await renameWithRetry(staging, dest);
    } catch {
      await copyDir(staging, dest);
    }
  } finally {
    await remove(staging);
  }
}

/** On Windows, antivirus and indexers briefly lock freshly written files, so renames can fail with EPERM/EBUSY. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

export async function remove(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true, maxRetries: 3 });
}

export async function writeFile(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

export function makeTempDir(prefix = 'skill-hub-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** True when `child` is `parent` or somewhere below it. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
