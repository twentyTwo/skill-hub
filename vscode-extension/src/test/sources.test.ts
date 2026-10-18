import * as assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { classifyInput, describeSource, parseSourceInput, sourceWebUrl } from '../core/sources';
import { repoName } from '../core/sources/git';

describe('parseSourceInput', () => {
  const cases: [string, unknown][] = [
    ['anthropics/skills', { type: 'github', owner: 'anthropics', repo: 'skills', ref: undefined, path: undefined }],
    ['github:anthropics/skills', { type: 'github', owner: 'anthropics', repo: 'skills', ref: undefined, path: undefined }],
    ['anthropics/skills/skills/pdf@v2', { type: 'github', owner: 'anthropics', repo: 'skills', ref: 'v2', path: 'skills/pdf' }],
    ['owner/repo.git#dev', { type: 'github', owner: 'owner', repo: 'repo', ref: 'dev', path: undefined }],
    ['https://github.com/anthropics/skills', { type: 'github', owner: 'anthropics', repo: 'skills', ref: undefined }],
    ['https://github.com/anthropics/skills.git', { type: 'github', owner: 'anthropics', repo: 'skills', ref: undefined }],
    [
      'https://github.com/anthropics/skills/tree/main/skills/pdf',
      { type: 'github', owner: 'anthropics', repo: 'skills', refPath: ['main', 'skills', 'pdf'] },
    ],
    [
      'https://github.com/o/r/blob/feature/x/skills/a/SKILL.md',
      { type: 'github', owner: 'o', repo: 'r', refPath: ['feature', 'x', 'skills', 'a', 'SKILL.md'] },
    ],
    [
      'https://raw.githubusercontent.com/o/r/refs/heads/main/a/SKILL.md',
      { type: 'github', owner: 'o', repo: 'r', refPath: ['main', 'a', 'SKILL.md'] },
    ],
    ['https://gist.github.com/someone/abc123', { type: 'git', url: 'https://gist.github.com/abc123.git', ref: undefined }],
    [
      'https://gitlab.com/group/sub/proj/-/tree/main/skills/x',
      { type: 'git', url: 'https://gitlab.com/group/sub/proj.git', ref: 'main', path: 'skills/x' },
    ],
    ['gitlab.com/group/proj', { type: 'git', url: 'https://gitlab.com/group/proj.git', ref: undefined }],
    ['https://bitbucket.org/team/repo/src/main/skills', { type: 'git', url: 'https://bitbucket.org/team/repo.git', ref: 'main', path: 'skills' }],
    ['https://git.example.com/team/repo.git#v1', { type: 'git', url: 'https://git.example.com/team/repo.git', ref: 'v1' }],
    ['git@github.com:o/r.git', { type: 'git', url: 'git@github.com:o/r.git', ref: undefined }],
    ['ssh://git@host/r.git#main', { type: 'git', url: 'ssh://git@host/r.git', ref: 'main' }],
    ['https://example.com/rules/react.mdc', { type: 'url', url: 'https://example.com/rules/react.mdc' }],
    ['./skills/pdf', { type: 'local', path: './skills/pdf' }],
    ['C:\\skills\\pdf', { type: 'local', path: 'C:\\skills\\pdf' }],
    ['/home/me/skills', { type: 'local', path: '/home/me/skills' }],
    ['~/skills', { type: 'local', path: path.join(os.homedir(), '/skills') }],
    ['"D:/My Skills/pdf"', { type: 'local', path: 'D:/My Skills/pdf' }],
  ];
  for (const [input, expected] of cases) {
    it(input, () => assert.deepEqual(parseSourceInput(input), expected));
  }

  it('rejects input it cannot understand', () => {
    assert.throws(() => parseSourceInput(''));
    assert.throws(() => parseSourceInput('just-a-word'));
    assert.throws(() => parseSourceInput('https://github.com/owner'));
    assert.throws(() => parseSourceInput('https://github.com/o/r/pulls'));
  });
});

describe('source helpers', () => {
  it('describes and links sources', () => {
    const source = { type: 'github' as const, owner: 'o', repo: 'r', path: 'skills/pdf' };
    assert.equal(describeSource(source), 'github.com/o/r/skills/pdf');
    assert.equal(sourceWebUrl(source), 'https://github.com/o/r/tree/HEAD/skills/pdf');
    assert.equal(sourceWebUrl({ ...source, ref: 'v1', path: 'rules/x.mdc' }), 'https://github.com/o/r/blob/v1/rules/x.mdc');
    assert.equal(sourceWebUrl({ type: 'git', url: 'https://gitlab.com/g/p.git', path: '' }), 'https://gitlab.com/g/p');
    assert.equal(sourceWebUrl({ type: 'git', url: 'git@host:p.git', path: '' }), undefined);
    assert.equal(sourceWebUrl({ type: 'created' }), undefined);
  });

  it('repoName handles https, ssh and fragments', () => {
    assert.equal(repoName('https://gitlab.com/g/proj.git'), 'proj');
    assert.equal(repoName('git@github.com:o/my-skills.git#main'), 'my-skills');
  });
});

describe('classifyInput', () => {
  it('names what the Add panel input looks like', () => {
    assert.equal(classifyInput('  ').kind, 'empty');
    assert.equal(classifyInput('anthropics/skills').kind, 'github');
    assert.equal(classifyInput('https://gitlab.com/g/p').kind, 'git');
    assert.equal(classifyInput('https://example.com/rules/react.mdc').kind, 'url');
    assert.equal(classifyInput('~/skills').kind, 'local');
    assert.equal(classifyInput('react testing').kind, 'search');
    assert.equal(classifyInput('pdf').kind, 'search');
  });
});
