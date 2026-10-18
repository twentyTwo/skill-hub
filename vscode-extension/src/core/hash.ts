import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { listFiles } from './fsutil';

const HASH_LENGTH = 16;

/** Text is hashed with LF line endings so a CRLF checkout of the same skill doesn't look edited. */
function normalize(buf: Buffer): Buffer {
  if (buf.subarray(0, 8000).includes(0)) return buf;
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

/** Content hash of every file under `dir` (names and bytes). */
export async function hashDir(dir: string, filter?: (rel: string) => boolean): Promise<string> {
  const hash = createHash('sha256');
  for (const rel of await listFiles(dir)) {
    if (filter && !filter(rel)) continue;
    const content = normalize(await fs.readFile(path.join(dir, ...rel.split('/'))));
    hash.update(rel).update('\0').update(content).update('\0');
  }
  return hash.digest('hex').slice(0, HASH_LENGTH);
}

export function hashText(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, HASH_LENGTH);
}
