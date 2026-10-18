import { promises as fs } from 'fs';
import * as path from 'path';
import { copyDir, listFiles, writeFile } from '../fsutil';
import { contextNameFor, isSkillFileName, metaFromMarkdown, nameForFile, SKILL_FILE, toSkillMarkdown } from '../skill';
import { SkillSource } from '../types';
import { MARKDOWN_FILE, MAX_FILE_CANDIDATES, MAX_SKILL_FILES, RemoteSkill, SkillProvider } from './types';

const MAX_DEPTH = 6;
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

/**
 * Skills in a folder on disk: the folder itself if it has a SKILL.md, otherwise every SKILL.md folder below it,
 * otherwise every markdown file below it (to be converted). Also used for git checkouts.
 */
export class LocalProvider implements SkillProvider {
  readonly label: string;

  constructor(
    private root: string,
    private readonly makeSource: (relPath: string, absPath: string) => SkillSource = (_rel, abs) => ({ type: 'local', path: abs }),
    private readonly contextName = path.basename(root),
    label?: string,
  ) {
    this.label = label ?? root;
  }

  async list(): Promise<RemoteSkill[]> {
    let stat;
    try {
      stat = await fs.stat(this.root);
    } catch {
      throw new Error(`Path not found: ${this.root}`);
    }
    if (stat.isFile()) {
      if (!isSkillFileName(path.basename(this.root))) return [this.fileSkill('')];
      this.root = path.dirname(this.root);
    }

    const { folders, files } = await discover(this.root);
    if (folders.length) {
      return Promise.all(
        folders.map(async (rel) => {
          const text = await fs.readFile(path.join(this.abs(rel), (await skillFileName(this.abs(rel)))!), 'utf8');
          const meta = metaFromMarkdown(text, rel ? path.posix.basename(rel) : this.contextName);
          return { kind: 'folder' as const, path: rel, ...meta, source: this.makeSource(rel, this.abs(rel)) };
        }),
      );
    }
    return files.map((rel) => this.fileSkill(rel));
  }

  async download(skill: RemoteSkill, dest: string): Promise<void> {
    const abs = this.abs(skill.path);
    if (skill.kind === 'file') {
      const { content } = toSkillMarkdown(await fs.readFile(abs, 'utf8'), path.basename(abs), this.fileContext(skill.path));
      await writeFile(path.join(dest, SKILL_FILE), content);
      return;
    }
    if ((await listFiles(abs)).length > MAX_SKILL_FILES) {
      throw new Error(`${abs} has more than ${MAX_SKILL_FILES} files, which is too many for a skill.`);
    }
    await copyDir(abs, dest);
  }

  private abs(rel: string): string {
    return rel ? path.join(this.root, ...rel.split('/')) : this.root;
  }

  private fileContext(rel: string): string {
    return rel ? contextNameFor(rel, this.contextName) : path.basename(path.dirname(this.root));
  }

  private fileSkill(rel: string): RemoteSkill {
    const fileName = path.basename(this.abs(rel));
    return {
      kind: 'file',
      path: rel,
      name: nameForFile(fileName, this.fileContext(rel)),
      description: rel || fileName,
      source: this.makeSource(rel, this.abs(rel)),
    };
  }
}

async function skillFileName(dir: string): Promise<string | undefined> {
  const names = await fs.readdir(dir);
  return names.find((n) => n === SKILL_FILE) ?? names.find(isSkillFileName);
}

/** Finds SKILL.md folders (not descending into them) and, as a fallback, markdown files. */
async function discover(root: string): Promise<{ folders: string[]; files: string[] }> {
  const folders: string[] = [];
  const files: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(rel ? path.join(root, ...rel.split('/')) : root, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && isSkillFileName(e.name))) {
      folders.push(rel);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name) && depth < MAX_DEPTH) await walk(child, depth + 1);
      else if (entry.isFile() && MARKDOWN_FILE.test(entry.name) && files.length < MAX_FILE_CANDIDATES) files.push(child);
    }
  };
  await walk('', 0);
  return { folders, files };
}
