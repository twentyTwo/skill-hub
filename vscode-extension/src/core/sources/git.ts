import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { makeTempDir, remove } from '../fsutil';
import { LocalProvider } from './local';
import { RemoteSkill, SkillProvider } from './types';

const execFileAsync = promisify(execFile);
const CLONE_TIMEOUT_MS = 3 * 60_000;

export interface GitSpec {
  url: string;
  ref?: string;
  path?: string;
}

/** Any git host (GitLab, Bitbucket, Gitea, Azure DevOps, self-hosted, SSH...) via a shallow clone into a temp folder. */
export class GitProvider implements SkillProvider {
  private checkout?: Promise<string>;
  private local?: LocalProvider;

  constructor(private readonly spec: GitSpec) {}

  get label(): string {
    return this.spec.url;
  }

  async list(): Promise<RemoteSkill[]> {
    return (await this.provider()).list();
  }

  async download(skill: RemoteSkill, dest: string): Promise<void> {
    return (await this.provider()).download(skill, dest);
  }

  async dispose(): Promise<void> {
    const dir = await this.checkout?.catch(() => undefined);
    if (dir) await remove(dir);
  }

  private async provider(): Promise<LocalProvider> {
    const checkout = await this.clone();
    const sub = (this.spec.path ?? '').split('/').filter(Boolean);
    this.local ??= new LocalProvider(
      path.join(checkout, ...sub),
      (rel) => ({ type: 'git', url: this.spec.url, ref: this.spec.ref, path: [...sub, ...(rel ? [rel] : [])].join('/') }),
      repoName(this.spec.url),
      this.spec.url,
    );
    return this.local;
  }

  private clone(): Promise<string> {
    this.checkout ??= (async () => {
      const dir = await makeTempDir('skill-hub-git-');
      const args = ['clone', '--depth', '1', '--quiet', ...(this.spec.ref ? ['--branch', this.spec.ref] : []), '--', this.spec.url, dir];
      try {
        await execFileAsync('git', args, {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          timeout: CLONE_TIMEOUT_MS,
          windowsHide: true,
        });
      } catch (err) {
        await remove(dir);
        const e = err as NodeJS.ErrnoException & { stderr?: string };
        if (e.code === 'ENOENT') throw new Error('Git is not installed or not on PATH. Install git to add skills from non-GitHub repositories.');
        throw new Error(`git clone ${this.spec.url} failed: ${(e.stderr || e.message).trim()}`);
      }
      return dir;
    })();
    return this.checkout;
  }
}

export function repoName(url: string): string {
  const last = url.replace(/[#?].*$/, '').replace(/\/+$/, '').split(/[/:]/).pop() ?? 'skill';
  return last.replace(/\.git$/i, '') || 'skill';
}
