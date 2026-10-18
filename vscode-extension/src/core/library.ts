import { promises as fs } from 'fs';
import * as path from 'path';
import { exists, makeTempDir, readJson, remove, replaceDir, writeFile, writeJson } from './fsutil';
import { hashDir } from './hash';
import { findSkillFile, readSkillMeta, SKILL_FILE, skillTemplate, slugify } from './skill';
import { LibrarySkill, SkillSource } from './types';

interface IndexEntry {
  source: SkillSource;
  addedAt: string;
  updatedAt: string;
}

interface IndexFile {
  version: 1;
  skills: Record<string, IndexEntry>;
}

export class SkillExistsError extends Error {
  constructor(readonly id: string) {
    super(`A skill named "${id}" is already in the hub.`);
  }
}

/**
 * The hub: one folder per skill under `<root>/skills`, plus `<root>/hub.json` remembering where each came from.
 * Folders dropped in by hand are picked up too.
 */
export class Library {
  constructor(readonly root: string) {}

  get skillsDir(): string {
    return path.join(this.root, 'skills');
  }

  private get indexFile(): string {
    return path.join(this.root, 'hub.json');
  }

  dirFor(id: string): string {
    return path.join(this.skillsDir, id);
  }

  async list(): Promise<LibrarySkill[]> {
    const index = await this.readIndex();
    let entries;
    try {
      entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const skills = await Promise.all(
      entries.filter((e) => e.isDirectory() && !e.name.includes('.incoming-')).map((e) => this.load(e.name, index.skills[e.name])),
    );
    return skills.filter((s): s is LibrarySkill => !!s).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<LibrarySkill | undefined> {
    return this.load(id, (await this.readIndex()).skills[id]);
  }

  async has(id: string): Promise<boolean> {
    return !!(await findSkillFile(this.dirFor(id)));
  }

  /** `base`, or `base-2`, `base-3`... whichever is free. */
  async uniqueId(base: string): Promise<string> {
    let id = base;
    for (let n = 2; await exists(this.dirFor(id)); n++) id = `${base}-${n}`;
    return id;
  }

  /** Copies the skill folder `fromDir` into the hub. */
  async add(fromDir: string, source: SkillSource, options: { id?: string; overwrite?: boolean } = {}): Promise<LibrarySkill> {
    const meta = await readSkillMeta(fromDir);
    const id = options.id ?? slugify(meta.name);
    const dest = this.dirFor(id);
    if (!options.overwrite && (await exists(dest))) throw new SkillExistsError(id);
    if (path.resolve(fromDir) !== path.resolve(dest)) await replaceDir(fromDir, dest);

    const index = await this.readIndex();
    const now = new Date().toISOString();
    index.skills[id] = { source, addedAt: index.skills[id]?.addedAt ?? now, updatedAt: now };
    await this.writeIndex(index);
    return (await this.get(id))!;
  }

  async create(name: string, description: string): Promise<LibrarySkill> {
    const staging = await makeTempDir();
    try {
      await writeFile(path.join(staging, SKILL_FILE), skillTemplate(name, description));
      return await this.add(staging, { type: 'created' }, { id: name });
    } finally {
      await remove(staging);
    }
  }

  async remove(id: string): Promise<void> {
    await remove(this.dirFor(id));
    const index = await this.readIndex();
    if (index.skills[id]) {
      delete index.skills[id];
      await this.writeIndex(index);
    }
  }

  private async load(id: string, entry: IndexEntry | undefined): Promise<LibrarySkill | undefined> {
    const dir = this.dirFor(id);
    if (!(await findSkillFile(dir))) return undefined;
    const [meta, hash, stat] = await Promise.all([readSkillMeta(dir), hashDir(dir), fs.stat(dir)]);
    const modified = stat.mtime.toISOString();
    return {
      id,
      dir,
      ...meta,
      hash,
      source: entry?.source ?? { type: 'created' },
      addedAt: entry?.addedAt ?? modified,
      updatedAt: entry?.updatedAt ?? modified,
    };
  }

  private async readIndex(): Promise<IndexFile> {
    const index = await readJson<IndexFile>(this.indexFile, { version: 1, skills: {} });
    index.skills ??= {};
    return index;
  }

  private writeIndex(index: IndexFile): Promise<void> {
    return writeJson(this.indexFile, index);
  }
}
