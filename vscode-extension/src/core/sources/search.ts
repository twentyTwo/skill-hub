import * as path from 'path';
import { Http } from '../http';
import { isSkillFileName } from '../skill';

export interface SkillSearchResult {
  owner: string;
  repo: string;
  /** Folder holding the SKILL.md; '' for the repository root. */
  path: string;
  name: string;
  description: string;
  url: string;
}

interface CodeSearchResponse {
  items: {
    path: string;
    html_url: string;
    repository: { name: string; owner: { login: string }; description: string | null };
    text_matches?: { fragment: string }[];
  }[];
}

const SKIPPED_PATH = /(^|\/)(node_modules|vendor|\.git)\//;

/** Finds SKILL.md files on GitHub matching `query`. GitHub only allows code search when signed in. */
export async function searchGitHubSkills(http: Http, query: string, limit = 50): Promise<SkillSearchResult[]> {
  const q = `${query.trim()} filename:SKILL.md`;
  const { items } = await http.json<CodeSearchResponse>(`https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`, {
    github: true,
    promptForAuth: true,
    authReason: 'GitHub only allows code search for signed-in users.',
    accept: 'application/vnd.github.text-match+json',
  });

  const seen = new Set<string>();
  const results: SkillSearchResult[] = [];
  for (const item of items) {
    if (!isSkillFileName(path.posix.basename(item.path)) || SKIPPED_PATH.test(item.path)) continue;
    const owner = item.repository.owner.login;
    const repo = item.repository.name;
    const dir = path.posix.dirname(item.path) === '.' ? '' : path.posix.dirname(item.path);
    const key = `${owner}/${repo}/${dir}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const fragments = (item.text_matches ?? []).map((m) => m.fragment).join('\n');
    results.push({
      owner,
      repo,
      path: dir,
      name: frontmatterValue(fragments, 'name') || (dir ? path.posix.basename(dir) : repo),
      description: frontmatterValue(fragments, 'description') || item.repository.description || '',
      url: item.html_url,
    });
  }
  return results;
}

/** Pulls `key: value` out of a search snippet, which is often (part of) the frontmatter. */
function frontmatterValue(text: string, key: string): string {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(text);
  const value = match?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
  return /^[|>][-+]?$/.test(value) ? '' : value;
}
