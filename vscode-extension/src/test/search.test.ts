import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Http } from '../core/http';
import { searchGitHubSkills } from '../core/sources/search';

const item = (owner: string, repo: string, path: string, fragment = '', description: string | null = null) => ({
  path,
  html_url: `https://github.com/${owner}/${repo}/blob/main/${path}`,
  repository: { name: repo, owner: { login: owner }, description },
  text_matches: fragment ? [{ fragment }] : [],
});

describe('searchGitHubSkills', () => {
  it('maps code search hits to skills, using the frontmatter in the snippet', async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      return Response.json({
        items: [
          item('anthropics', 'skills', 'skills/pdf/SKILL.md', 'name: pdf\ndescription: "Work with PDF files."\n---'),
          item('anthropics', 'skills', 'skills/pdf/SKILL.md', 'duplicate hit for the same file'),
          item('someone', 'pdf-skill', 'SKILL.md', '# Heading only', 'Repo description'),
          item('x', 'y', 'docs/skill.md', 'description: >-'),
          item('x', 'y', 'node_modules/pkg/SKILL.md', 'name: ignored'),
          item('x', 'y', 'README.md', 'name: not a skill file'),
        ],
      });
    };
    const results = await searchGitHubSkills(new Http({ fetch, githubToken: async () => 'token' }), ' pdf ');

    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0]).searchParams.get('q'), 'pdf filename:SKILL.md');
    assert.deepEqual(
      results.map((r) => [r.owner, r.repo, r.path, r.name, r.description]),
      [
        ['anthropics', 'skills', 'skills/pdf', 'pdf', 'Work with PDF files.'],
        ['someone', 'pdf-skill', '', 'pdf-skill', 'Repo description'],
        ['x', 'y', 'docs', 'docs', ''],
      ],
    );
  });

  it('asks the user to sign in, saying why, because GitHub requires it for code search', async () => {
    const reasons: (string | undefined)[] = [];
    const fetch = async (_url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string>).Authorization ? Response.json({ items: [] }) : new Response('{"message":"Requires authentication"}', { status: 401 });
    const http = new Http({ fetch, githubToken: async (interactive, reason) => (interactive ? (reasons.push(reason), 'token') : undefined) });
    assert.deepEqual(await searchGitHubSkills(http, 'pdf'), []);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0]!, /signed-in/);
  });
});
