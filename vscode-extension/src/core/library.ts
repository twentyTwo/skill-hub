import { Dirent, promises as fs } from 'fs';
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
 *
 * `builtinRoot` is a folder of skills that ship with the app. They're listed and applied like hub skills but never
 * written to; a hub skill with the same id takes their place.
 */
export class Library {
  constructor(
    readonly root: string,
    readonly builtinRoot?: string,
  ) {}

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
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
    } catch {
      // No hub folder yet: only the built-in skills.
    }
    const own = (
      await Promise.all(
        entries.filter((e) => e.isDirectory() && !e.name.includes('.incoming-')).map((e) => this.load(e.name, index.skills[e.name])),
      )
    ).filter((s): s is LibrarySkill => !!s);
    const ownIds = new Set(own.map((s) => s.id));
    const builtin = (await this.listBuiltin()).filter((s) => !ownIds.has(s.id));
    return [...own, ...builtin].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The hub's skill `id`, or else the built-in one. */
  async get(id: string): Promise<LibrarySkill | undefined> {
    return (await this.load(id, (await this.readIndex()).skills[id])) ?? this.builtin(id);
  }

  async listBuiltin(): Promise<LibrarySkill[]> {
    if (!this.builtinRoot) return [];
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.builtinRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const skills = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => this.builtin(e.name)));
    return skills.filter((s): s is LibrarySkill => !!s);
  }

  /** Built-in skill `id`, ignoring any hub copy of it. */
  async builtin(id: string): Promise<LibrarySkill | undefined> {
    if (!this.builtinRoot || id !== path.basename(id) || id === '.' || id === '..') return undefined;
    return this.loadDir(id, path.join(this.builtinRoot, id), { source: { type: 'builtin', id } }, true);
  }

  /** Copies built-in skill `id` into the hub as `as`, where it can be edited. The copy then takes the built-in one's place. */
  async copyBuiltin(id: string, as = id): Promise<LibrarySkill> {
    const skill = await this.builtin(id);
    if (!skill) throw new Error(`Skill Hub has no built-in skill named "${id}".`);
    return this.add(skill.dir, skill.source, { id: as, overwrite: true });
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
    if (!(await exists(this.dirFor(id))) && (await this.builtin(id))) {
      throw new Error(`"${id}" is built into Skill Hub, so it can't be removed.`);
    }
    await remove(this.dirFor(id));
    const index = await this.readIndex();
    if (index.skills[id]) {
      delete index.skills[id];
      await this.writeIndex(index);
    }
  }

  private load(id: string, entry: IndexEntry | undefined): Promise<LibrarySkill | undefined> {
    return this.loadDir(id, this.dirFor(id), entry);
  }

  private async loadDir(id: string, dir: string, entry: Partial<IndexEntry> | undefined, builtin = false): Promise<LibrarySkill | undefined> {
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
      ...(builtin && { builtin: true as const }),
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
