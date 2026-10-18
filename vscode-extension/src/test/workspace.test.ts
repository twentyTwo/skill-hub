import * as assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, it } from 'node:test';
import { exists } from '../core/fsutil';
import { Library } from '../core/library';
import { LOCK_FILE, readLock } from '../core/lock';
import { buildTargets } from '../core/targets';
import { applySkill, removeSkill, saveToHub, scanWorkspace, targetStates } from '../core/workspace';
import { read, skillMd, withTempDir, writeTree } from './helpers';

async function setup(dir: string) {
  const lib = new Library(path.join(dir, 'hub'));
  await writeTree(dir, {
    'src/pdf/SKILL.md': skillMd('pdf', 'Work with PDFs.', '# PDF\n\nRun `scripts/extract.py`.\n'),
    'src/pdf/scripts/extract.py': 'print("x")\n',
    'src/style/SKILL.md': skillMd('style', 'Code style.'),
  });
  const pdf = await lib.add(path.join(dir, 'src/pdf'), { type: 'github', owner: 'o', repo: 'r', path: 'pdf' });
  const style = await lib.add(path.join(dir, 'src/style'), { type: 'created' });
  const root = path.join(dir, 'repo');
  await fs.mkdir(root, { recursive: true });
  const targets = buildTargets({ custom: [{ id: 'codex', label: 'Codex', folder: '.codex/skills/' }] });
  const byId = (...ids: string[]) => targets.filter((t) => ids.includes(t.id));
  const status = async () => Object.fromEntries((await scanWorkspace(root, await lib.list(), targets)).map((s) => [s.id, s.status]));
  return { lib, pdf, style, root, targets, byId, status };
}

describe('targets', () => {
  it('installs folder targets as exact copies', () =>
    withTempDir(async (dir) => {
      const { pdf, root, targets, byId } = await setup(dir);
      await applySkill(root, pdf, byId('claude', 'copilot', 'codex'), targets);
      for (const folder of ['.claude/skills', '.github/skills', '.codex/skills']) {
        assert.equal(await read(path.join(root, folder, 'pdf/scripts/extract.py')), 'print("x")\n');
      }
      const lock = await readLock(root);
      assert.deepEqual(Object.keys(lock.skills.pdf.targets).sort(), ['claude', 'codex', 'copilot']);
      assert.equal(lock.skills.pdf.hash, pdf.hash);
      assert.deepEqual(lock.skills.pdf.source, pdf.source);
    }));

  it('writes Cursor rules with supporting files next to them', () =>
    withTempDir(async (dir) => {
      const { pdf, style, root, targets, byId } = await setup(dir);
      await applySkill(root, pdf, byId('cursor'), targets);
      await applySkill(root, style, byId('cursor'), targets);
      const rule = await read(path.join(root, '.cursor/rules/pdf.mdc'));
      assert.match(rule, /^---\ndescription: Work with PDFs\.\nalwaysApply: false\n---\n\n> Supporting files for this rule are in `\.cursor\/rules\/pdf\/`/);
      assert.match(rule, /Run `scripts\/extract\.py`/);
      assert.ok(await exists(path.join(root, '.cursor/rules/pdf/scripts/extract.py')));
      assert.ok(!(await exists(path.join(root, '.cursor/rules/pdf/SKILL.md'))));
      assert.ok(!(await exists(path.join(root, '.cursor/rules/style'))), 'no files folder for a skill without supporting files');
      assert.doesNotMatch(await read(path.join(root, '.cursor/rules/style.mdc')), /Supporting files/);
    }));

  it('maintains the AGENTS.md section, keeping the rest of the file', () =>
    withTempDir(async (dir) => {
      const { pdf, style, root, targets, byId } = await setup(dir);
      await writeTree(root, { 'AGENTS.md': '# Project\n\nUse pnpm.\n' });
      await applySkill(root, pdf, byId('agents'), targets);
      await applySkill(root, style, byId('agents'), targets);
      let agents = await read(path.join(root, 'AGENTS.md'));
      assert.ok(agents.startsWith('# Project\n\nUse pnpm.\n\n<!-- skill-hub:begin -->\n## Skills\n'));
      assert.match(agents, /- \*\*pdf\*\*: Work with PDFs\. See `\.agents\/skills\/pdf\/SKILL\.md`\.\n- \*\*style\*\*/);
      assert.ok(await exists(path.join(root, '.agents/skills/pdf/scripts/extract.py')));

      await removeSkill(root, 'pdf', targets);
      agents = await read(path.join(root, 'AGENTS.md'));
      assert.doesNotMatch(agents, /pdf/);
      assert.match(agents, /\*\*style\*\*/);

      await removeSkill(root, 'style', targets);
      assert.equal(await read(path.join(root, 'AGENTS.md')), '# Project\n\nUse pnpm.\n');
    }));

  it('deletes an AGENTS.md that only held the skills section', () =>
    withTempDir(async (dir) => {
      const { style, root, targets, byId } = await setup(dir);
      await applySkill(root, style, byId('agents'), targets);
      assert.ok(await exists(path.join(root, 'AGENTS.md')));
      await removeSkill(root, 'style', targets);
      assert.ok(!(await exists(path.join(root, 'AGENTS.md'))));
    }));

  it('re-applying with fewer targets removes the dropped ones', () =>
    withTempDir(async (dir) => {
      const { pdf, root, targets, byId } = await setup(dir);
      await applySkill(root, pdf, byId('claude', 'cursor'), targets);
      await applySkill(root, pdf, byId('claude'), targets);
      assert.ok(!(await exists(path.join(root, '.cursor/rules/pdf.mdc'))));
      assert.deepEqual(Object.keys((await readLock(root)).skills.pdf.targets), ['claude']);
    }));
});

describe('workspace status', () => {
  it('tracks synced, outdated, modified, conflict, missing and unmanaged skills', () =>
    withTempDir(async (dir) => {
      const { lib, pdf, style, root, targets, byId, status } = await setup(dir);
      await applySkill(root, pdf, byId('claude', 'cursor'), targets);
      await applySkill(root, style, byId('claude'), targets);
      assert.deepEqual(await status(), { pdf: 'synced', style: 'synced' });

      // CRLF checkouts don't count as edits.
      const installed = path.join(root, '.claude/skills/style/SKILL.md');
      await fs.writeFile(installed, (await read(installed)).replace(/\n/g, '\r\n'));
      assert.equal((await status()).style, 'synced');

      await writeTree(pdf.dir, { 'SKILL.md': skillMd('pdf', 'Work with PDFs, v2.') });
      assert.equal((await status()).pdf, 'outdated');

      await writeTree(root, { '.claude/skills/style/SKILL.md': skillMd('style', 'Edited locally.') });
      assert.equal((await status()).style, 'modified');

      await writeTree(style.dir, { 'extra.md': 'new in hub' });
      assert.equal((await status()).style, 'conflict');

      await fs.rm(path.join(root, '.claude'), { recursive: true });
      const afterDelete = await scanWorkspace(root, await lib.list(), targets);
      const pdfState = afterDelete.find((s) => s.id === 'pdf')!;
      assert.equal(pdfState.status, 'outdated', 'still installed for Cursor');
      assert.deepEqual(pdfState.missing, ['claude']);
      assert.equal(afterDelete.find((s) => s.id === 'style')!.status, 'missing');

      await writeTree(root, { '.github/skills/hand-made/SKILL.md': skillMd('hand-made', 'Copied in by hand.') });
      assert.equal((await status())['hand-made'], 'unmanaged');
    }));

  it('saveToHub pushes workspace edits into the hub and marks the skill synced', () =>
    withTempDir(async (dir) => {
      const { lib, pdf, root, targets, byId } = await setup(dir);
      await applySkill(root, pdf, byId('claude', 'cursor'), targets);
      await writeTree(root, { '.claude/skills/pdf/SKILL.md': skillMd('pdf', 'Improved in the repo.') });

      const [modified] = (await scanWorkspace(root, await lib.list(), targets)).filter((s) => s.id === 'pdf');
      assert.equal(modified.status, 'modified');
      const saved = await saveToHub(modified, lib, targets);

      assert.equal(saved.description, 'Improved in the repo.');
      assert.deepEqual(saved.source, pdf.source, 'keeps the original source');
      assert.match(await read(path.join(root, '.cursor/rules/pdf.mdc')), /Improved in the repo/, 'other targets get the new version');
      const [after] = (await scanWorkspace(root, await lib.list(), targets)).filter((s) => s.id === 'pdf');
      assert.equal(after.status, 'synced');
    }));

  it('removeSkill cleans every target and the lock file', () =>
    withTempDir(async (dir) => {
      const { pdf, root, targets, byId } = await setup(dir);
      await applySkill(root, pdf, byId('claude', 'cursor', 'agents'), targets);
      await removeSkill(root, 'pdf', targets);
      assert.deepEqual(await scanWorkspace(root, [], targets), []);
      assert.ok(!(await exists(path.join(root, LOCK_FILE))), 'empty lock file is deleted');
      assert.ok(!(await exists(path.join(root, '.claude/skills/pdf'))));
      assert.ok(!(await exists(path.join(root, '.cursor/rules/pdf'))));
    }));

  it('targetStates reports each target separately', () =>
    withTempDir(async (dir) => {
      const { lib, pdf, root, targets, byId } = await setup(dir);
      await applySkill(root, pdf, byId('claude', 'copilot', 'cursor'), targets);
      await fs.writeFile(path.join(root, '.github/skills/pdf/SKILL.md'), 'edited');
      await fs.rm(path.join(root, '.cursor/rules/pdf.mdc'));
      await fs.mkdir(path.join(root, '.codex/skills/pdf'), { recursive: true });
      await fs.writeFile(path.join(root, '.codex/skills/pdf/SKILL.md'), skillMd('pdf', 'Hand-copied.'));

      assert.deepEqual(await targetStates(root, 'pdf', targets, pdf), {
        claude: 'synced',
        copilot: 'modified',
        cursor: 'missing',
        agents: 'none',
        codex: 'unmanaged',
      });

      await fs.writeFile(path.join(pdf.dir, 'SKILL.md'), skillMd('pdf', 'Work with PDFs, v2.'));
      const newer = (await lib.get('pdf'))!;
      assert.equal((await targetStates(root, 'pdf', targets, newer)).claude, 'outdated');
    }));
});
