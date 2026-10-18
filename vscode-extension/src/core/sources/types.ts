import { SkillMeta, SkillSource } from '../types';

/** A skill found at a source, before it's downloaded. */
export interface RemoteSkill extends SkillMeta {
  /** `folder`: a SKILL.md folder. `file`: a lone markdown file that gets converted into a SKILL.md. */
  kind: 'folder' | 'file';
  /** Forward-slash path within the source; '' for the source root. */
  path: string;
  /** What to remember in the hub so the skill can be fetched again. */
  source: SkillSource;
}

export interface SkillProvider {
  readonly label: string;
  list(): Promise<RemoteSkill[]>;
  /** Writes the skill as a SKILL.md folder into the empty directory `dest`. */
  download(skill: RemoteSkill, dest: string): Promise<void>;
  dispose?(): Promise<void>;
}

/** Hard limits so a mistyped repo root doesn't pull a whole monorepo into the hub. */
export const MAX_SKILL_FILES = 500;
export const MAX_SKILL_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_CANDIDATES = 300;
export const MARKDOWN_FILE = /\.(md|mdc|markdown)$/i;
