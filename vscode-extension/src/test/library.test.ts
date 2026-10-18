import * as assert from 'node:assert/strict';
import * as path from 'path';
import { describe, it } from 'node:test';
import { Library, SkillExistsError } from '../core/library';
import { withTempDir, writeTree, skillMd, read } from './helpers';

describe('Library', () => {
  it('adds, lists, gets and removes skills', () =>
    withTempDir(async (dir) => {
      const lib = new Library(path.join(dir, 'hub'));
      assert.deepEqual(await lib.list(), []);

      await writeTree(dir, { 'src/SKILL.md': skillMd('PDF Tools', 'Work with PDFs.'), 'src/scripts/run.py': 'print(1)' });
      const added = await lib.add(path.join(dir, 'src'), { type: 'local', path: path.join(dir, 'src') });
      assert.equal(added.id, 'pdf-tools');
      assert.equal(added.name, 'PDF Tools');
      assert.equal(added.description, 'Work with PDFs.');
      assert.equal(await read(path.join(added.dir, 'scripts', 'run.py')), 'print(1)');

      await assert.rejects(lib.add(path.join(dir, 'src'), { type: 'created' }), SkillExistsError);
      const replaced = await lib.add(path.join(dir, 'src'), { type: 'created' }, { overwrite: true });
      assert.equal(replaced.addedAt, added.addedAt);
      assert.deepEqual(replaced.source, { type: 'created' });

      assert.deepEqual((await lib.list()).map((s) => s.id), ['pdf-tools']);
      assert.equal(await lib.uniqueId('pdf-tools'), 'pdf-tools-2');

      await lib.remove('pdf-tools');
      assert.deepEqual(await lib.list(), []);
      assert.equal(await lib.get('pdf-tools'), undefined);
    }));

  it('picks up skill folders added by hand and ignores folders without SKILL.md', () =>
    withTempDir(async (dir) => {
      await writeTree(dir, { 'hub/skills/manual/SKILL.md': skillMd('manual', 'Hand-made.'), 'hub/skills/junk/notes.txt': 'x' });
      const [skill] = await new Library(path.join(dir, 'hub')).list();
      assert.equal(skill.id, 'manual');
      assert.deepEqual(skill.source, { type: 'created' });
    }));

  it('creates a skill from the template', () =>
    withTempDir(async (dir) => {
      const skill = await new Library(dir).create('api-conventions', 'REST API rules.');
      assert.equal(skill.name, 'api-conventions');
      assert.match(await read(path.join(skill.dir, 'SKILL.md')), /^---\nname: api-conventions\ndescription: REST API rules\.\n---\n\n# Api Conventions/);
    }));

  it('hash changes with content but not with line endings', () =>
    withTempDir(async (dir) => {
      const lib = new Library(path.join(dir, 'hub'));
      await writeTree(dir, { 'a/SKILL.md': skillMd('a', 'd') });
      const first = await lib.add(path.join(dir, 'a'), { type: 'created' });
      await writeTree(first.dir, { 'SKILL.md': skillMd('a', 'd').replace(/\n/g, '\r\n') });
      assert.equal((await lib.get('a'))!.hash, first.hash);
      await writeTree(first.dir, { 'SKILL.md': skillMd('a', 'changed') });
      assert.notEqual((await lib.get('a'))!.hash, first.hash);
    }));
});
