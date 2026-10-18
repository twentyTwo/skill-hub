import { promises as fs } from 'fs';
import * as path from 'path';
import { withFrontmatter, parseFrontmatter } from './frontmatter';
import { copyDir, exists, listFiles, remove, writeFile } from './fsutil';
import { hashDir, hashText } from './hash';
import { findSkillFile, isSkillFileName, readSkillMeta, SKILL_FILE } from './skill';
import { SkillMeta } from './types';

export interface InstallableSkill extends SkillMeta {
  id: string;
  dir: string;
}

/** A place in a repository where an agent looks for skills, and how to write a hub skill there. */
export interface Target {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  /** Workspace-relative globs whose changes can affect this target. */
  readonly watchGlobs: string[];
  /** Writes the skill into `root` and returns a hash of what was written. */
  install(skill: InstallableSkill, root: string): Promise<string>;
  uninstall(id: string, root: string): Promise<void>;
  /** Hash of what is installed now, or undefined if the skill isn't installed for this target. */
  installedHash(id: string, root: string): Promise<string | undefined>;
  /** The file to open for an installed skill. */
  entryFile(id: string, root: string): string;
  /** Folder holding the installed skill in SKILL.md form, when this target stores it that way. */
  skillFolder(id: string, root: string): string | undefined;
  /** Ids of all skills in this target's folder, whether Skill Hub put them there or not. */
  scan(root: string): Promise<string[]>;
}

/** Copies the skill folder as-is to `<folder>/<id>/`: the Agent Skills layout used by Claude Code, Copilot and others. */
export class FolderTarget implements Target {
  readonly watchGlobs: string[];

  constructor(
    readonly id: string,
    readonly label: string,
    readonly folder: string,
    readonly detail = `${folder}/<skill>/`,
  ) {
    this.watchGlobs = [`${folder}/**`];
  }

  protected base(root: string): string {
    return path.join(root, ...this.folder.split('/'));
  }

  skillFolder(id: string, root: string): string {
    return path.join(this.base(root), id);
  }

  entryFile(id: string, root: string): string {
    return path.join(this.skillFolder(id, root), SKILL_FILE);
  }

  async install(skill: InstallableSkill, root: string): Promise<string> {
    const dest = this.skillFolder(skill.id, root);
    await remove(dest);
    await copyDir(skill.dir, dest);
    return hashDir(dest);
  }

  async uninstall(id: string, root: string): Promise<void> {
    await remove(this.skillFolder(id, root));
  }

  async installedHash(id: string, root: string): Promise<string | undefined> {
    const dir = this.skillFolder(id, root);
    return (await findSkillFile(dir)) ? hashDir(dir) : undefined;
  }

  async scan(root: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(this.base(root), { withFileTypes: true });
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && (await findSkillFile(path.join(this.base(root), entry.name)))) ids.push(entry.name);
    }
    return ids.sort();
  }
}

/**
 * Cursor project rules: `.cursor/rules/<id>.mdc` as an "agent requested" rule (description, not always applied).
 * Supporting files go to `.cursor/rules/<id>/`, and the rule says so, since skill bodies use relative paths.
 */
export class CursorTarget implements Target {
  readonly id = 'cursor';
  readonly label = 'Cursor';
  readonly detail = '.cursor/rules/<skill>.mdc';
  readonly watchGlobs = ['.cursor/rules/**'];

  private rulesDir(root: string): string {
    return path.join(root, '.cursor', 'rules');
  }

  private filesDir(id: string, root: string): string {
    return path.join(this.rulesDir(root), id);
  }

  entryFile(id: string, root: string): string {
    return path.join(this.rulesDir(root), `${id}.mdc`);
  }

  skillFolder(): undefined {
    return undefined;
  }

  async install(skill: InstallableSkill, root: string): Promise<string> {
    await this.uninstall(skill.id, root);
    const skillFile = await findSkillFile(skill.dir);
    if (!skillFile) throw new Error(`No ${SKILL_FILE} found in ${skill.dir}`);
    let { body } = parseFrontmatter(await fs.readFile(skillFile, 'utf8'));

    const isSupportingFile = (rel: string) => !isSkillFileName(rel);
    if ((await listFiles(skill.dir)).some(isSupportingFile)) {
      await copyDir(skill.dir, this.filesDir(skill.id, root), isSupportingFile);
      body = `> Supporting files for this rule are in \`.cursor/rules/${skill.id}/\`. Resolve relative paths below from there.\n\n${body}`;
    }
    await writeFile(this.entryFile(skill.id, root), withFrontmatter({ description: skill.description, alwaysApply: false }, body));
    return (await this.installedHash(skill.id, root))!;
  }

  async uninstall(id: string, root: string): Promise<void> {
    await remove(this.entryFile(id, root));
    await remove(this.filesDir(id, root));
  }

  async installedHash(id: string, root: string): Promise<string | undefined> {
    let rule: string;
    try {
      rule = await fs.readFile(this.entryFile(id, root), 'utf8');
    } catch {
      return undefined;
    }
    const files = (await exists(this.filesDir(id, root))) ? await hashDir(this.filesDir(id, root)) : '';
    return hashText(`${rule}\0${files}`);
  }

  /** Cursor rules aren't skills, so nothing there is offered as an untracked skill. */
  async scan(): Promise<string[]> {
    return [];
  }
}

const AGENTS_FILE = 'AGENTS.md';
const BLOCK_BEGIN = '<!-- skill-hub:begin -->';
const BLOCK_END = '<!-- skill-hub:end -->';

/**
 * For agents that read AGENTS.md (Codex, Jules, Aider, Zed...): skill folders go to `folder`, and a managed section
 * of AGENTS.md lists each skill's name and description so the agent knows when to open it.
 */
export class AgentsMdTarget extends FolderTarget {
  constructor(folder: string) {
    super('agents', 'AGENTS.md', folder, `${folder}/<skill>/ + index in AGENTS.md`);
    this.watchGlobs.push(AGENTS_FILE);
  }

  override async install(skill: InstallableSkill, root: string): Promise<string> {
    const hash = await super.install(skill, root);
    await this.writeIndex(root);
    return hash;
  }

  override async uninstall(id: string, root: string): Promise<void> {
    await super.uninstall(id, root);
    await this.writeIndex(root);
  }

  private async writeIndex(root: string): Promise<void> {
    const file = path.join(root, AGENTS_FILE);
    let text = '';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      // No AGENTS.md yet.
    }
    const items: string[] = [];
    for (const id of await this.scan(root)) {
      const meta = await readSkillMeta(this.skillFolder(id, root));
      items.push(`- **${meta.name}**: ${meta.description} See \`${this.folder}/${id}/${SKILL_FILE}\`.`);
    }
    const block = items.length
      ? [
          BLOCK_BEGIN,
          '## Skills',
          '',
          `Skills for this repository live in \`${this.folder}/\`. When a task matches a skill below, read its \`${SKILL_FILE}\` first and follow it.`,
          '',
          ...items,
          BLOCK_END,
        ].join('\n')
      : '';

    // The optional leading newline is the blank line added before the section, removed along with it.
    const existing = new RegExp(`(\\r?\\n)?${escapeRegExp(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}\\r?\\n?`);
    let next: string;
    if (existing.test(text)) next = text.replace(existing, (_match, lead: string | undefined) => (block ? `${lead ?? ''}${block}\n` : ''));
    else if (block) next = `${text ? text.replace(/\s*$/, '\n\n') : ''}${block}\n`;
    else next = text;

    if (next === text) return;
    if (next.trim()) await writeFile(file, next);
    else await remove(file);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CustomTargetConfig {
  id: string;
  label?: string;
  folder: string;
}

export const BUILT_IN_TARGET_IDS = ['claude', 'copilot', 'cursor', 'agents'];

export function buildTargets(options: { agentsFolder?: string; custom?: CustomTargetConfig[] } = {}): Target[] {
  const targets: Target[] = [
    new FolderTarget('claude', 'Claude Code', '.claude/skills'),
    new FolderTarget('copilot', 'GitHub Copilot', '.github/skills'),
    new CursorTarget(),
    new AgentsMdTarget(cleanFolder(options.agentsFolder) || '.agents/skills'),
  ];
  for (const custom of options.custom ?? []) {
    const folder = cleanFolder(custom?.folder);
    if (!custom?.id || !folder || targets.some((t) => t.id === custom.id)) continue;
    targets.push(new FolderTarget(custom.id, custom.label || custom.id, folder));
  }
  return targets;
}

/** Workspace-relative, forward slashes, no leading `./` or trailing slash. */
function cleanFolder(folder: string | undefined): string {
  return (folder ?? '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}
