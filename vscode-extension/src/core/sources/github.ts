import * as path from 'path';
import { isInside, writeFile } from '../fsutil';
import { Http, HttpError } from '../http';
import { contextNameFor, isSkillFileName, metaFromMarkdown, nameForFile, SKILL_FILE, toSkillMarkdown } from '../skill';
import { SkillSource } from '../types';
import { mapLimit } from '../util';
import { MARKDOWN_FILE, MAX_FILE_CANDIDATES, MAX_SKILL_BYTES, MAX_SKILL_FILES, RemoteSkill, SkillProvider } from './types';

export interface GitHubSpec {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  /** Unresolved `<ref>/<path>` segments from a /tree/ or /blob/ URL, where the ref itself may contain slashes. */
  refPath?: string[];
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
}

interface Resolved {
  ref: string;
  /** The ref the user asked for, if any; kept in the hub so updates follow that branch or tag. */
  explicitRef?: string;
  path: string;
  tree: TreeEntry[];
}

const API_ACCEPT = 'application/vnd.github+json';
const PARALLEL_DOWNLOADS = 8;

/** Lists a repository with one tree request and downloads only the files of the chosen skills. No git needed. */
export class GitHubProvider implements SkillProvider {
  private resolved?: Promise<Resolved>;

  constructor(
    private readonly spec: GitHubSpec,
    private readonly http: Http,
  ) {}

  get label(): string {
    return `${this.spec.owner}/${this.spec.repo}`;
  }

  async list(): Promise<RemoteSkill[]> {
    const resolved = await this.resolve();
    const { ref, explicitRef, tree } = resolved;
    let base = resolved.path;
    const source = (p: string): SkillSource => ({ type: 'github', owner: this.spec.owner, repo: this.spec.repo, ref: explicitRef, path: p });
    const blobs = tree.filter((e) => e.type === 'blob');

    const file = blobs.find((b) => b.path === base);
    if (file) {
      if (!isSkillFileName(path.posix.basename(file.path))) return [this.fileSkill(file.path, source(file.path))];
      base = parentOf(file.path);
    } else if (base && !tree.some((e) => e.type === 'tree' && e.path === base)) {
      throw new Error(`"${base}" does not exist in ${this.label} at ${ref}.`);
    }

    const prefix = base ? `${base}/` : '';
    const inScope = (p: string) => !base || p === base || p.startsWith(prefix);
    const skillDirs = blobs.filter((b) => inScope(b.path) && isSkillFileName(path.posix.basename(b.path))).map((b) => parentOf(b.path));
    // A skill's own sub-folders can't hold separate skills: the parent download already includes them.
    const topLevel = skillDirs.filter((dir) => !skillDirs.some((other) => other !== dir && (other === '' || dir.startsWith(`${other}/`))));

    if (topLevel.length) {
      return mapLimit(topLevel, PARALLEL_DOWNLOADS, async (dir) => {
        const skillFile = blobs.find((b) => parentOf(b.path) === dir && isSkillFileName(path.posix.basename(b.path)))!;
        const text = await this.http.text(this.raw(ref, skillFile.path), { github: true });
        const meta = metaFromMarkdown(text, dir ? path.posix.basename(dir) : this.spec.repo);
        return { kind: 'folder' as const, path: dir, ...meta, source: source(dir) };
      });
    }
    return blobs
      .filter((b) => inScope(b.path) && MARKDOWN_FILE.test(b.path))
      .slice(0, MAX_FILE_CANDIDATES)
      .map((b) => this.fileSkill(b.path, source(b.path)));
  }

  async download(skill: RemoteSkill, dest: string): Promise<void> {
    const { ref, tree } = await this.resolve();
    if (skill.kind === 'file') {
      const text = await this.http.text(this.raw(ref, skill.path), { github: true });
      const { content } = toSkillMarkdown(text, path.posix.basename(skill.path), contextNameFor(skill.path, this.spec.repo));
      await writeFile(path.join(dest, SKILL_FILE), content);
      return;
    }

    const prefix = skill.path ? `${skill.path}/` : '';
    const files = tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix));
    const bytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
    if (files.length > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) {
      throw new Error(`${this.label}/${skill.path} has ${files.length} files (${Math.round(bytes / 1024 / 1024)} MB), which is too large for a skill.`);
    }
    await mapLimit(files, PARALLEL_DOWNLOADS, async (file) => {
      const target = path.join(dest, ...file.path.slice(prefix.length).split('/'));
      if (!isInside(dest, target)) return;
      await writeFile(target, await this.http.bytes(this.raw(ref, file.path), { github: true }));
    });
  }

  private fileSkill(filePath: string, source: SkillSource): RemoteSkill {
    return {
      kind: 'file',
      path: filePath,
      name: nameForFile(path.posix.basename(filePath), contextNameFor(filePath, this.spec.repo)),
      description: filePath,
      source,
    };
  }

  private resolve(): Promise<Resolved> {
    this.resolved ??= this.doResolve();
    return this.resolved;
  }

  private async doResolve(): Promise<Resolved> {
    // Fetched first, with sign-in on refusal, so a private repo prompts once instead of failing on every request.
    const repo = await this.http.json<{ default_branch: string }>(this.api(''), { github: true, promptForAuth: true, accept: API_ACCEPT });
    const cleanPath = (this.spec.path ?? '').replace(/^\/+|\/+$/g, '');

    if (this.spec.ref) return { ref: this.spec.ref, explicitRef: this.spec.ref, path: cleanPath, tree: await this.tree(this.spec.ref) };

    const segments = this.spec.refPath ?? [];
    for (let i = 1; i <= Math.min(segments.length, 8); i++) {
      const ref = segments.slice(0, i).join('/');
      const tree = await this.tree(ref).catch((err) => {
        if (err instanceof HttpError && (err.status === 404 || err.status === 422)) return undefined;
        throw err;
      });
      if (tree) return { ref, explicitRef: ref, path: segments.slice(i).join('/'), tree };
    }
    if (segments.length) throw new Error(`Could not find branch or tag "${segments[0]}" in ${this.label}.`);

    return { ref: repo.default_branch, path: cleanPath, tree: await this.tree(repo.default_branch) };
  }

  private async tree(ref: string): Promise<TreeEntry[]> {
    const res = await this.http.json<{ tree: TreeEntry[]; truncated: boolean }>(this.api(`/git/trees/${encodeURIComponent(ref)}?recursive=1`), {
      github: true,
      accept: API_ACCEPT,
    });
    return res.tree;
  }

  private api(suffix: string): string {
    return `https://api.github.com/repos/${encodeURIComponent(this.spec.owner)}/${encodeURIComponent(this.spec.repo)}${suffix}`;
  }

  private raw(ref: string, filePath: string): string {
    const encode = (p: string) => p.split('/').map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${encodeURIComponent(this.spec.owner)}/${encodeURIComponent(this.spec.repo)}/${encode(ref)}/${encode(filePath)}`;
  }
}

function parentOf(p: string): string {
  const dir = path.posix.dirname(p);
  return dir === '.' ? '' : dir;
}
