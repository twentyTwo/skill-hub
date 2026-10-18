import { promises as fs } from 'fs';
import * as path from 'path';
import { makeTempDir, remove, writeFile } from '../core/fsutil';

/** Creates a temp directory, populated from `files` (relative path → content), and removes it after `fn`. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>, files: Record<string, string> = {}): Promise<T> {
  const dir = await makeTempDir('skill-hub-test-');
  try {
    await writeTree(dir, files);
    return await fn(dir);
  } finally {
    await remove(dir);
  }
}

export async function writeTree(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) await writeFile(path.join(dir, ...rel.split('/')), content);
}

export function read(file: string): Promise<string> {
  return fs.readFile(file, 'utf8');
}

export function skillMd(name: string, description: string, body = `# ${name}\n\nDo the thing.\n`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}
