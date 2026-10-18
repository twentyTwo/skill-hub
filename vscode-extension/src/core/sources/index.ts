import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, remove } from '../fsutil';
import { Http } from '../http';
import { Library } from '../library';
import { LibrarySkill, SkillSource } from '../types';
import { GitProvider } from './git';
import { GitHubProvider, GitHubSpec } from './github';
import { LocalProvider } from './local';
import { RemoteSkill, SkillProvider } from './types';
import { UrlProvider } from './url';
import type { InputKind } from '../../shared/protocol';

export * from './types';
export type { InputKind } from '../../shared/protocol';

export type SourceSpec =
  | ({ type: 'github' } & GitHubSpec)
  | { type: 'git'; url: string; ref?: string; path?: string }
  | { type: 'url'; url: string }
  | { type: 'local'; path: string };

/** Hosts where a bare `https://host/owner/repo` link is a git repository. */
const GIT_HOSTS = new Set(['gitlab.com', 'bitbucket.org', 'codeberg.org', 'gitea.com', 'git.sr.ht']);
const FILE_LINK = /\.(md|mdc|markdown|txt)$/i;

/**
 * Understands what people paste:
 * - `owner/repo`, `owner/repo/path/to/skill`, `owner/repo@ref`, `github:owner/repo`
 * - GitHub repo, `/tree/`, `/blob/` and raw.githubusercontent.com links; gists
 * - GitLab and Bitbucket repo or folder links, any `.git` / SSH URL (`#ref` selects a branch or tag)
 * - a link to a markdown file anywhere
 * - absolute, `~/` or `./` local paths and file:// URLs
 */
export function parseSourceInput(raw: string): SourceSpec {
  let input = raw.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!input) throw new Error('Enter a link, owner/repo, or a local path.');
  // "gitlab.com/group/project": GitHub owners can't contain dots, so a dotted first segment is a host.
  if (/^[\w-]+(\.[\w-]+)+\//.test(input)) input = `https://${input}`;

  if (/^file:\/\//i.test(input)) return { type: 'local', path: fileURLToPath(input) };
  if (/^~([\\/]|$)/.test(input)) return { type: 'local', path: path.join(os.homedir(), input.slice(1)) };
  if (/^\.{1,2}([\\/]|$)/.test(input) || /^[a-zA-Z]:[\\/]/.test(input) || /^[\\/]/.test(input)) return { type: 'local', path: input };

  if (/^(git@|ssh:\/\/|git:\/\/|git\+)/i.test(input)) {
    const [url, ref] = splitFragment(input.replace(/^git\+/i, ''));
    return { type: 'git', url, ref };
  }

  const shorthand = /^(?:github:)?([A-Za-z0-9][A-Za-z0-9-]*)\/([\w.-]+?)(?:\.git)?((?:\/[^@#\s]+)*)(?:[@#](\S+))?$/i.exec(input);
  if (shorthand && !/^https?:/i.test(input)) {
    const [, owner, repo, subPath, ref] = shorthand;
    return { type: 'github', owner, repo, ref, path: subPath ? subPath.replace(/^\/+/, '') : undefined };
  }

  if (!/^https?:\/\//i.test(input)) {
    throw new Error(`Couldn't understand "${input}". Use owner/repo, a GitHub or GitLab link, a git URL, a link to a .md file, or a local path.`);
  }

  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const ref = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;

  if (host === 'github.com') {
    if (segments.length < 2) throw new Error('A GitHub link needs at least an owner and a repository.');
    const [owner, repoSegment, kind, ...rest] = segments;
    const repo = repoSegment.replace(/\.git$/i, '');
    if (!kind) return { type: 'github', owner, repo, ref };
    if (kind === 'tree' || kind === 'blob') return { type: 'github', owner, repo, refPath: rest };
    throw new Error('Unsupported GitHub link. Link to a repository, a folder (/tree/...) or a file (/blob/...).');
  }
  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ...rest] = segments;
    const refPath = rest[0] === 'refs' && (rest[1] === 'heads' || rest[1] === 'tags') ? rest.slice(2) : rest;
    return { type: 'github', owner, repo, refPath };
  }
  if (host === 'gist.github.com' && segments.length) {
    return { type: 'git', url: `https://gist.github.com/${segments[segments.length - 1]}.git`, ref };
  }

  const dash = segments.indexOf('-');
  if (dash > 1 && (segments[dash + 1] === 'tree' || segments[dash + 1] === 'blob')) {
    // GitLab: /group/project/-/tree/<ref>/<path>
    return { type: 'git', url: `${url.origin}/${segments.slice(0, dash).join('/')}.git`, ref: segments[dash + 2], path: segments.slice(dash + 3).join('/') };
  }
  if (host === 'bitbucket.org' && segments[2] === 'src') {
    return { type: 'git', url: `${url.origin}/${segments[0]}/${segments[1]}.git`, ref: segments[3], path: segments.slice(4).join('/') };
  }
  if (/\.git$/i.test(url.pathname)) return { type: 'git', url: input.replace(/#.*$/, ''), ref };
  if (FILE_LINK.test(url.pathname)) return { type: 'url', url: input };
  if (GIT_HOSTS.has(host) && segments.length >= 2) {
    return { type: 'git', url: `${url.origin}/${segments.join('/')}.git`, ref };
  }
  return { type: 'url', url: input };
}

/** What `raw` looks like to `parseSourceInput`; anything it can't parse is treated as search words. */
export function classifyInput(raw: string): { kind: InputKind; spec?: SourceSpec } {
  if (!raw.trim()) return { kind: 'empty' };
  try {
    const spec = parseSourceInput(raw);
    return { kind: spec.type, spec };
  } catch {
    return { kind: 'search' };
  }
}

function splitFragment(input: string): [string, string | undefined] {
  const i = input.indexOf('#');
  return i < 0 ? [input, undefined] : [input.slice(0, i), input.slice(i + 1) || undefined];
}

export function createProvider(spec: SourceSpec | SkillSource, http: Http): SkillProvider {
  switch (spec.type) {
    case 'github':
      return new GitHubProvider(spec, http);
    case 'git':
      return new GitProvider(spec);
    case 'url':
      return new UrlProvider(spec.url, http);
    case 'local':
      return new LocalProvider(path.resolve(spec.path));
    case 'created':
      throw new Error('This skill was created in Skill Hub, so it has no source to update from.');
  }
}

export function canUpdate(source: SkillSource): boolean {
  return source.type !== 'created';
}

export function describeSource(source: SkillSource): string {
  switch (source.type) {
    case 'github':
      return `github.com/${source.owner}/${source.repo}${source.path ? `/${source.path}` : ''}${source.ref ? ` @ ${source.ref}` : ''}`;
    case 'git':
      return `${source.url}${source.path ? ` → ${source.path}` : ''}${source.ref ? ` @ ${source.ref}` : ''}`;
    case 'url':
      return source.url;
    case 'local':
      return source.path;
    case 'created':
      return 'Created in Skill Hub';
  }
}

/** A browser link for the source, when there is one. */
export function sourceWebUrl(source: SkillSource): string | undefined {
  switch (source.type) {
    case 'github': {
      const kind = /\.\w+$/.test(source.path) ? 'blob' : 'tree';
      return `https://github.com/${source.owner}/${source.repo}${source.path ? `/${kind}/${source.ref ?? 'HEAD'}/${source.path}` : ''}`;
    }
    case 'git':
      return /^https?:\/\//i.test(source.url) ? source.url.replace(/\.git$/i, '') : undefined;
    case 'url':
      return source.url;
    default:
      return undefined;
  }
}

export function sameSource(a: SkillSource, b: SkillSource): boolean {
  return describeSource(a) === describeSource(b) && a.type === b.type;
}

/** Picks the skill a stored source points at out of what its provider lists. */
export function findSourceSkill(found: RemoteSkill[], source: SkillSource): RemoteSkill {
  const match = found.find((s) => sameSource(s.source, source)) ?? (found.length === 1 ? found[0] : undefined);
  if (!match) throw new Error(`The skill is no longer at ${describeSource(source)}.`);
  return match;
}

/** Downloads `remote` from `provider` into the hub as `id`. */
export async function importSkill(provider: SkillProvider, remote: RemoteSkill, library: Library, id: string): Promise<LibrarySkill> {
  const staging = await makeTempDir();
  try {
    await provider.download(remote, staging);
    return await library.add(staging, remote.source, { id, overwrite: true });
  } finally {
    await remove(staging);
  }
}

/** Re-fetches a skill from where it came from and stores it in the hub as `id`. */
export async function fetchFromSource(source: SkillSource, id: string, library: Library, http: Http): Promise<LibrarySkill> {
  const provider = createProvider(source, http);
  try {
    return await importSkill(provider, findSourceSkill(await provider.list(), source), library, id);
  } finally {
    await provider.dispose?.();
  }
}
