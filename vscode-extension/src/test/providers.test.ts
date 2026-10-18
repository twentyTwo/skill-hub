import * as assert from 'node:assert/strict';
import * as path from 'path';
import { describe, it } from 'node:test';
import { Http } from '../core/http';
import { Library } from '../core/library';
import { fetchFromSource, importSkill } from '../core/sources';
import { GitHubProvider } from '../core/sources/github';
import { LocalProvider } from '../core/sources/local';
import { read, skillMd, withTempDir } from './helpers';

/** A fake GitHub: one repo whose branches map to file trees. */
function fakeGitHub(branches: Record<string, Record<string, string>>, opts: { private?: boolean } = {}) {
  const requests: string[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push(url);
    const authorized = !!(init?.headers as Record<string, string>)?.Authorization;
    if (opts.private && !authorized) return new Response('{"message":"Not Found"}', { status: 404 });
    const api = /^https:\/\/api\.github\.com\/repos\/o\/r(.*)$/.exec(url);
    if (api) {
      if (api[1] === '') return Response.json({ default_branch: 'main' });
      const tree = /^\/git\/trees\/([^?]+)\?recursive=1$/.exec(api[1]);
      const files = tree && branches[decodeURIComponent(tree[1])];
      if (!files) return new Response('{"message":"Not Found"}', { status: 404 });
      const dirs = new Set(Object.keys(files).flatMap((f) => f.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
      return Response.json({
        truncated: false,
        tree: [
          ...[...dirs].map((p) => ({ path: p, type: 'tree' })),
          ...Object.entries(files).map(([p, content]) => ({ path: p, type: 'blob', size: content.length })),
        ],
      });
    }
    for (const [branch, files] of Object.entries(branches)) {
      const prefix = `https://raw.githubusercontent.com/o/r/${branch.split('/').map(encodeURIComponent).join('/')}/`;
      if (url.startsWith(prefix)) {
        const file = decodeURIComponent(url.slice(prefix.length));
        if (file in files) return new Response(files[file]);
      }
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, requests };
}

const REPO = {
  'README.md': '# Skills',
  'skills/pdf/SKILL.md': skillMd('pdf', 'Work with PDFs.'),
  'skills/pdf/scripts/extract.py': 'print(1)',
  'skills/pdf/nested/SKILL.md': skillMd('nested', 'Part of pdf, not separate.'),
  'skills/docx/SKILL.md': skillMd('docx', 'Word documents.'),
  'rules/react.mdc': '---\ndescription: React rules\n---\nUse hooks.',
};

describe('GitHubProvider', () => {
  it('lists top-level skills in a repository', async () => {
    const { fetch } = fakeGitHub({ main: REPO });
    const provider = new GitHubProvider({ owner: 'o', repo: 'r' }, new Http({ fetch }));
    const found = await provider.list();
    assert.deepEqual(found.map((s) => [s.name, s.path, s.kind, s.description]).sort(), [
      ['docx', 'skills/docx', 'folder', 'Word documents.'],
      ['pdf', 'skills/pdf', 'folder', 'Work with PDFs.'],
    ]);
    assert.deepEqual(found.find((s) => s.name === 'pdf')!.source, { type: 'github', owner: 'o', repo: 'r', ref: undefined, path: 'skills/pdf' });
  });

  it('resolves branch names containing slashes from /tree/ links', async () => {
    const { fetch } = fakeGitHub({ 'feature/x': REPO });
    const provider = new GitHubProvider({ owner: 'o', repo: 'r', refPath: ['feature', 'x', 'skills', 'docx'] }, new Http({ fetch }));
    const [docx] = await provider.list();
    assert.equal(docx.name, 'docx');
    assert.deepEqual(docx.source, { type: 'github', owner: 'o', repo: 'r', ref: 'feature/x', path: 'skills/docx' });
  });

  it('treats a link to a SKILL.md as its folder, and a link to other markdown as a file skill', async () => {
    const { fetch } = fakeGitHub({ main: REPO });
    const http = new Http({ fetch });
    const [pdf] = await new GitHubProvider({ owner: 'o', repo: 'r', refPath: ['main', 'skills', 'pdf', 'SKILL.md'] }, http).list();
    assert.equal(pdf.path, 'skills/pdf');
    const [rule] = await new GitHubProvider({ owner: 'o', repo: 'r', refPath: ['main', 'rules', 'react.mdc'] }, http).list();
    assert.deepEqual([rule.kind, rule.name, rule.path], ['file', 'react', 'rules/react.mdc']);
  });

  it('offers markdown files when a path has no SKILL.md', async () => {
    const { fetch } = fakeGitHub({ main: REPO });
    const found = await new GitHubProvider({ owner: 'o', repo: 'r', path: 'rules' }, new Http({ fetch })).list();
    assert.deepEqual(found.map((s) => s.path), ['rules/react.mdc']);
  });

  it('downloads a skill folder, including nested files, into the hub', () =>
    withTempDir(async (dir) => {
      const { fetch } = fakeGitHub({ main: REPO });
      const provider = new GitHubProvider({ owner: 'o', repo: 'r' }, new Http({ fetch }));
      const pdf = (await provider.list()).find((s) => s.name === 'pdf')!;
      const lib = new Library(dir);
      const skill = await importSkill(provider, pdf, lib, 'pdf');
      assert.equal(await read(path.join(skill.dir, 'scripts/extract.py')), 'print(1)');
      assert.equal(await read(path.join(skill.dir, 'nested/SKILL.md')), REPO['skills/pdf/nested/SKILL.md']);
    }));

  it('converts a markdown file into a SKILL.md on download', () =>
    withTempDir(async (dir) => {
      const { fetch } = fakeGitHub({ main: REPO });
      const provider = new GitHubProvider({ owner: 'o', repo: 'r', path: 'rules/react.mdc' }, new Http({ fetch }));
      const skill = await importSkill(provider, (await provider.list())[0], new Library(dir), 'react');
      assert.equal(await read(path.join(skill.dir, 'SKILL.md')), '---\nname: react\ndescription: React rules\n---\n\nUse hooks.\n');
    }));

  it('updates from a stored source', () =>
    withTempDir(async (dir) => {
      const repo = { ...REPO };
      const { fetch } = fakeGitHub({ main: repo });
      const http = new Http({ fetch });
      const lib = new Library(dir);
      const source = { type: 'github' as const, owner: 'o', repo: 'r', path: 'skills/docx' };
      const first = await fetchFromSource(source, 'docx', lib, http);
      repo['skills/docx/SKILL.md'] = skillMd('docx', 'Word documents, improved.');
      const second = await fetchFromSource(source, 'docx', lib, http);
      assert.notEqual(second.hash, first.hash);
      assert.equal(second.description, 'Word documents, improved.');
    }));

  it('asks for GitHub sign-in when a repository is private', async () => {
    const { fetch } = fakeGitHub({ main: REPO }, { private: true });
    const asked: boolean[] = [];
    const http = new Http({ fetch, githubToken: async (interactive) => (asked.push(interactive), interactive ? 'token' : undefined) });
    assert.equal((await new GitHubProvider({ owner: 'o', repo: 'r' }, http).list()).length, 2);
    assert.ok(asked.includes(true));
  });

  it('explains a missing path', async () => {
    const { fetch } = fakeGitHub({ main: REPO });
    await assert.rejects(new GitHubProvider({ owner: 'o', repo: 'r', path: 'nope' }, new Http({ fetch })).list(), /"nope" does not exist/);
  });
});

describe('LocalProvider', () => {
  it('finds every skill folder below a directory', () =>
    withTempDir(
      async (dir) => {
        const found = await new LocalProvider(dir).list();
        assert.deepEqual(found.map((s) => [s.name, s.path]).sort(), [
          ['a', 'pack/a'],
          ['b', 'pack/deep/b'],
        ]);
        assert.deepEqual(found.find((s) => s.name === 'a')!.source, { type: 'local', path: path.join(dir, 'pack', 'a') });
      },
      {
        'pack/a/SKILL.md': skillMd('a', 'A.'),
        'pack/a/sub/SKILL.md': skillMd('sub', 'inside a'),
        'pack/deep/b/SKILL.md': skillMd('b', 'B.'),
        'node_modules/x/SKILL.md': skillMd('x', 'ignored'),
        'notes.md': 'ignored because skills exist',
      },
    ));

  it('treats a SKILL.md path as its folder and other files as single-file skills', () =>
    withTempDir(
      async (dir) => {
        const [folder] = await new LocalProvider(path.join(dir, 'a', 'SKILL.md')).list();
        assert.deepEqual([folder.kind, folder.name], ['folder', 'a']);
        const [file] = await new LocalProvider(path.join(dir, 'AGENTS.md')).list();
        assert.equal(file.kind, 'file');
        const lib = new Library(path.join(dir, 'hub'));
        const provider = new LocalProvider(path.join(dir, 'AGENTS.md'));
        const skill = await importSkill(provider, file, lib, file.name);
        assert.equal(skill.description, 'Always run tests.');
      },
      { 'a/SKILL.md': skillMd('a', 'A.'), 'AGENTS.md': '# Rules\n\nAlways run tests.\n' },
    ));

  it('falls back to markdown files when there are no skills', () =>
    withTempDir(
      async (dir) => {
        const found = await new LocalProvider(dir).list();
        assert.deepEqual(found.map((s) => [s.kind, s.path, s.name]), [
          ['file', '.cursor/rules/react.mdc', 'react'],
          ['file', 'docs/testing.instructions.md', 'testing'],
        ]);
      },
      { '.cursor/rules/react.mdc': 'x', 'docs/testing.instructions.md': 'y', 'image.png': 'z' },
    ));
});
