import * as assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, it } from 'node:test';
import { Http } from '../core/http';
import { Library } from '../core/library';
import { readLock } from '../core/lock';
import { readSkillMeta, validateSkillName } from '../core/skill';
import { canUpdate, fetchFromSource } from '../core/sources';
import { buildTargets } from '../core/targets';
import { applySkill, scanWorkspace } from '../core/workspace';
import { read, skillMd, withTempDir, writeTree } from './helpers';

/** The skills the extension and desktop app ship (out/test → vscode-extension/builtin-skills). */
const SHIPPED = path.join(__dirname, '..', '..', 'builtin-skills');

async function setup(dir: string) {
  const builtin = path.join(dir, 'builtin');
  await writeTree(builtin, {
    'code-review/SKILL.md': skillMd('code-review', 'Review a diff.'),
    'code-review/checklist.md': '- tests\n',
    'commit-message/SKILL.md': skillMd('commit-message', 'Write a commit message.'),
    'not-a-skill/README.md': 'no SKILL.md here',
  });
  return { lib: new Library(path.join(dir, 'hub'), builtin), builtin };
}

describe('built-in skills', () => {
  it('are listed with the hub skills, read-only, and a hub skill with the same id replaces one', () =>
    withTempDir(async (dir) => {
      const { lib, builtin } = await setup(dir);
      const listed = await lib.list();
      assert.deepEqual(listed.map((s) => s.id), ['code-review', 'commit-message']);
      assert.ok(listed.every((s) => s.builtin && s.source.type === 'builtin'));
      assert.equal(listed[0].dir, path.join(builtin, 'code-review'));
      assert.equal(canUpdate(listed[0].source), false);
      assert.equal(await lib.has('code-review'), false, 'not in the hub folder');

      await writeTree(dir, { 'mine/SKILL.md': skillMd('code-review', 'My own review rules.') });
      await lib.add(path.join(dir, 'mine'), { type: 'created' });
      const review = (await lib.list()).filter((s) => s.id === 'code-review');
      assert.equal(review.length, 1);
      assert.equal(review[0].description, 'My own review rules.');
      assert.equal(review[0].builtin, undefined);
      assert.equal((await lib.get('code-review'))!.description, 'My own review rules.');
      assert.equal((await lib.builtin('code-review'))!.description, 'Review a diff.');

      // Removing the hub copy brings the built-in one back.
      await lib.remove('code-review');
      assert.equal((await lib.get('code-review'))!.builtin, true);
    }));

  it("can't be removed, and reject ids that leave the built-in folder", () =>
    withTempDir(async (dir) => {
      const { lib } = await setup(dir);
      await assert.rejects(lib.remove('commit-message'), /built into Skill Hub/);
      assert.ok(await lib.get('commit-message'));
      assert.equal(await lib.builtin('../hub'), undefined);
      assert.equal(await lib.builtin('..'), undefined);
    }));

  it('are copied into the hub to edit, keeping their source', () =>
    withTempDir(async (dir) => {
      const { lib, builtin } = await setup(dir);
      const copy = await lib.copyBuiltin('code-review');
      assert.equal(copy.builtin, undefined);
      assert.equal(copy.dir, lib.dirFor('code-review'));
      assert.deepEqual(copy.source, { type: 'builtin', id: 'code-review' });
      assert.equal(await read(path.join(copy.dir, 'checklist.md')), '- tests\n');
      assert.equal(await lib.has('code-review'), true);
      // The shipped folder is untouched.
      assert.equal(await read(path.join(builtin, 'code-review', 'checklist.md')), '- tests\n');
      await assert.rejects(lib.copyBuiltin('nope'), /no built-in skill/);
    }));

  it('apply to a workspace with a builtin source, track updates, and restore through fetchFromSource', () =>
    withTempDir(async (dir) => {
      const { lib, builtin } = await setup(dir);
      const root = path.join(dir, 'repo');
      await fs.mkdir(root, { recursive: true });
      const targets = buildTargets();
      const claude = targets.filter((t) => t.id === 'claude');

      await applySkill(root, (await lib.get('code-review'))!, claude, targets);
      assert.deepEqual((await readLock(root)).skills['code-review'].source, { type: 'builtin', id: 'code-review' });
      const status = async () => (await scanWorkspace(root, await lib.list(), targets)).find((s) => s.id === 'code-review')!.status;
      assert.equal(await status(), 'synced');

      // A new app version ships a changed skill: applied copies show an update.
      await writeTree(builtin, { 'code-review/SKILL.md': skillMd('code-review', 'Review a diff, v2.') });
      assert.equal(await status(), 'outdated');

      // A teammate restoring from the lock file gets it from their own app.
      const restored = await fetchFromSource({ type: 'builtin', id: 'code-review' }, 'code-review', lib, new Http());
      assert.equal(restored.description, 'Review a diff, v2.');
      assert.equal(await lib.has('code-review'), true);
    }));

  it('ships valid skills whose folder names match their names', async () => {
    const ids = (await fs.readdir(SHIPPED, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    assert.ok(ids.length >= 5 && ids.length <= 10, `ships ${ids.length} skills`);
    for (const id of ids) {
      const meta = await readSkillMeta(path.join(SHIPPED, id));
      assert.equal(meta.name, id, `${id}/SKILL.md name`);
      assert.equal(validateSkillName(id), undefined, `${id} is a valid skill name`);
      assert.ok(meta.description.length > 40, `${id} has a real description`);
    }
  });
});
