/** Where a skill in the hub came from: enough to fetch it again. */
export type SkillSource =
  | { type: 'github'; owner: string; repo: string; ref?: string; path: string }
  | { type: 'git'; url: string; ref?: string; path: string }
  | { type: 'url'; url: string }
  | { type: 'local'; path: string }
  | { type: 'created' };

export interface SkillMeta {
  name: string;
  description: string;
}

export interface LibrarySkill extends SkillMeta {
  /** Folder name inside the hub; also the folder name used when the skill is applied to a workspace. */
  id: string;
  dir: string;
  source: SkillSource;
  addedAt: string;
  updatedAt: string;
  /** Content hash of the skill folder. */
  hash: string;
}
