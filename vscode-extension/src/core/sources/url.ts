import * as path from 'path';
import { writeFile } from '../fsutil';
import { Http } from '../http';
import { SKILL_FILE, toSkillMarkdown } from '../skill';
import { RemoteSkill, SkillProvider } from './types';

/** A single markdown file on the web (a raw SKILL.md, a rule, a gist file...), converted into a skill. */
export class UrlProvider implements SkillProvider {
  private content?: Promise<string>;

  constructor(
    private readonly url: string,
    private readonly http: Http,
  ) {}

  get label(): string {
    return this.url;
  }

  async list(): Promise<RemoteSkill[]> {
    const { meta } = toSkillMarkdown(await this.fetch(), this.fileName(), this.contextName());
    return [{ kind: 'file', path: '', ...meta, source: { type: 'url', url: this.url } }];
  }

  async download(_skill: RemoteSkill, dest: string): Promise<void> {
    const { content } = toSkillMarkdown(await this.fetch(), this.fileName(), this.contextName());
    await writeFile(path.join(dest, SKILL_FILE), content);
  }

  private fetch(): Promise<string> {
    this.content ??= (async () => {
      const res = await this.http.request(this.url);
      const body = await res.text();
      if (/text\/html/i.test(res.headers.get('content-type') ?? '') && /<(!doctype html|html)[\s>]/i.test(body.slice(0, 2000))) {
        throw new Error('That link returned a web page, not a markdown file. Use the raw file link, or a git URL ending in .git.');
      }
      return body;
    })();
    return this.content;
  }

  private segments(): string[] {
    return new URL(this.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  }

  private fileName(): string {
    return this.segments().pop() ?? SKILL_FILE;
  }

  private contextName(): string | undefined {
    const segments = this.segments();
    return segments.length > 1 ? segments[segments.length - 2] : new URL(this.url).hostname.split('.')[0];
  }
}
