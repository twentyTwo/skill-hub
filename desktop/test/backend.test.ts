import * as assert from 'assert/strict';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import { writeFile } from '../../vscode-extension/src/core/fsutil';
import { readLock } from '../../vscode-extension/src/core/lock';
import type { AppEvent, AppState, ProjectVM } from '../src/shared/api';
import { Backend } from '../src/main/backend';
import { createFixture, Fixture } from './fixture';

async function makeBackend(root: string, settings: Record<string, unknown>): Promise<{ backend: Backend; events: AppEvent[]; opened: string[] }> {
  const dataDir = path.join(root, 'user-data');
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ editorCommand: '', ...settings }));
  const events: AppEvent[] = [];
  const opened: string[] = [];
  const backend = new Backend({
    dataDir,
    version: '0.0.0-test',
    emit: (e) => events.push(e),
    pickFolders: async () => [],
    openPath: async (p) => void opened.push(p),
    reveal: () => undefined,
    openExternal: async () => undefined,
  });
  await backend.init();
  return { backend, events, opened };
}

function project(state: AppState, name: string): ProjectVM {
  const p = state.projects.find((x) => x.name === name);
  assert.ok(p, `project ${name}`);
  return p;
}

function statusOf(state: AppState, projectName: string, id: string): string | undefined {
  return project(state, projectName).skills.find((s) => s.id === id)?.status;
}

describe('desktop backend', () => {
  let tmp: string;
  let fixture: Fixture;
  let backend: Backend;
  let opened: string[];

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-hub-desktop-'));
    fixture = await createFixture(tmp);
    ({ backend, opened } = await makeBackend(tmp, { libraryPath: fixture.hub, projects: fixture.projects }));
  });

  after(async () => {
    backend.dispose();
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  it('reports every project, the status of each skill, and where hub skills are used', async () => {
    const state = await backend.getState();
    const { names } = fixture;
    assert.equal(state.skills.length, 6);
    assert.equal(statusOf(state, names.main, 'pdf'), 'outdated');
    assert.equal(statusOf(state, names.main, 'tech-debt-audit'), 'synced');
    assert.equal(statusOf(state, names.main, 'frontend-design'), 'modified');
    assert.equal(statusOf(state, names.conflicted, 'pdf'), 'conflict');
    assert.equal(statusOf(state, names.broken, 'webapp-testing'), 'missing');
    assert.equal(statusOf(state, names.second, 'release-notes'), 'unmanaged');

    assert.equal(project(state, names.main).health, 'edits');
    assert.equal(project(state, names.broken).health, 'broken');
    assert.equal(project(state, names.gone).exists, false);
    assert.deepEqual(
      project(state, names.main).targets.filter((t) => t.on).map((t) => t.id),
      ['claude', 'agents'],
    );

    const pdf = state.skills.find((s) => s.id === 'pdf')!;
    assert.deepEqual(pdf.usedIn.map((u) => u.project).sort(), [names.conflicted, names.main, names.second].sort());
    assert.equal(pdf.source.label, 'anthropics/skills');
    assert.equal(state.skills.find((s) => s.id === 'docx')!.usedIn.length, 0);

    // Each row offers the one action from DESIGN.md §2.
    const actions = Object.fromEntries(project(state, names.main).skills.map((s) => [s.id, s.action?.id]));
    assert.deepEqual(actions, { pdf: 'update', 'tech-debt-audit': undefined, 'frontend-design': 'saveToHub' });
    assert.equal(project(state, names.conflicted).skills.find((s) => s.id === 'pdf')!.action?.id, 'resolve');
    assert.equal(project(state, names.second).skills.find((s) => s.id === 'release-notes')!.action?.id, 'addToHub');
  });

  it('shows a conflict as a diff of the project copy against the hub', async () => {
    const vm = await backend.conflict(fixture.projects[2], 'pdf');
    assert.equal(vm.canMerge, true);
    const local = vm.diff.filter((l) => l.kind === 'local').map((l) => l.text);
    const hub = vm.diff.filter((l) => l.kind === 'added').map((l) => l.text);
    assert.ok(local.includes('Use pypdf to read fields.'));
    assert.ok(local.includes('Local: "Ask before overwriting."'));
    assert.deepEqual(hub, ['Use pdfplumber; fall back to OCR.']);
  });

  it('"Update all safe" updates outdated and missing skills but never edited or conflicting ones', async () => {
    const n = await backend.updateAllSafe();
    assert.equal(n, 3); // pdf in skill-hub and web-store, webapp-testing restored in data-pipeline
    backend.refresh();
    const state = await backend.getState();
    const { names } = fixture;
    assert.equal(statusOf(state, names.main, 'pdf'), 'synced');
    assert.equal(statusOf(state, names.second, 'pdf'), 'synced');
    assert.equal(statusOf(state, names.broken, 'webapp-testing'), 'synced');
    assert.equal(statusOf(state, names.main, 'frontend-design'), 'modified');
    assert.equal(statusOf(state, names.conflicted, 'pdf'), 'conflict');
  });

  it('merges both versions with conflict markers, then pushes the result to the hub', async () => {
    const root = fixture.projects[2];
    const file = path.join(root, '.claude', 'skills', 'pdf', 'SKILL.md');
    await backend.projectAction(root, 'pdf', 'merge');
    const merged = await fs.readFile(file, 'utf8');
    assert.match(merged, /<<<<<<< docs-site \(local\)\nUse pypdf to read fields\.\n=======\nUse pdfplumber; fall back to OCR\.\n>>>>>>> hub/);
    assert.deepEqual(opened, [file], 'opens the merged SKILL.md (editor command is off, so with the default app)');

    // The user settles the markers, then keeps the local result.
    await fs.writeFile(file, merged.replace(/<<<<<<<[\s\S]*?>>>>>>> hub\n/, 'Use pdfplumber; fall back to OCR.\n'));
    await backend.projectAction(root, 'pdf', 'keepLocal');
    backend.refresh();
    const state = await backend.getState();
    assert.equal(statusOf(state, fixture.names.conflicted, 'pdf'), 'synced');
    // Every other project that uses pdf now has an update.
    assert.equal(statusOf(state, fixture.names.main, 'pdf'), 'outdated');
    const hubText = await fs.readFile(path.join(fixture.hub, 'skills', 'pdf', 'SKILL.md'), 'utf8');
    assert.match(hubText, /Local: "Ask before overwriting\."/);
  });

  it('applies a hub skill to a project, keeping agents it already has', async () => {
    const root = fixture.projects[0];
    assert.deepEqual(await backend.applyWarnings('docx', { roots: [root], targets: ['claude'] }), []);
    await backend.applySkill('docx', { roots: [root], targets: ['claude'] });
    await backend.applySkill('docx', { roots: [root], targets: ['copilot'] });
    const lock = await readLock(root);
    assert.deepEqual(Object.keys(lock.skills.docx.targets).sort(), ['claude', 'copilot']);
  });

  it('warns before applying over an edited copy', async () => {
    const warnings = await backend.applyWarnings('frontend-design', { roots: [fixture.projects[0]], targets: ['claude'] });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /edited there/);
  });

  it('adds untracked skills to the hub', async () => {
    await backend.projectAction(fixture.projects[1], 'release-notes', 'addToHub');
    backend.refresh();
    const state = await backend.getState();
    assert.ok(state.skills.some((s) => s.id === 'release-notes'));
    assert.equal(statusOf(state, fixture.names.second, 'release-notes'), 'synced');
  });

  it('adds and removes projects without touching their files', async () => {
    const extra = path.join(tmp, 'projects', 'extra');
    await fs.mkdir(extra, { recursive: true });
    await backend.addProjects([extra, extra]);
    assert.equal(backend.store.settings.projects.filter((p) => p === extra).length, 1);
    await backend.removeProject(extra);
    assert.ok(!backend.store.settings.projects.includes(extra));
    assert.ok((await fs.stat(extra)).isDirectory());
    assert.ok(backend.store.activity.some((a) => a.text.includes('Stopped tracking extra')));
  });
});

describe('source checks', () => {
  let tmp: string;
  let backend: Backend;
  let sourceDir: string;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-hub-desktop-src-'));
    sourceDir = path.join(tmp, 'upstream', 'lint-rules');
    await writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: lint-rules\ndescription: House lint rules.\n---\n\n# Lint rules\n\nUse tabs.\n');
    await writeFile(path.join(sourceDir, 'notes.md'), 'old notes\n');
    const project = path.join(tmp, 'projects', 'app');
    await fs.mkdir(project, { recursive: true });
    ({ backend } = await makeBackend(tmp, { libraryPath: path.join(tmp, 'hub'), projects: [project] }));
  });

  after(async () => {
    backend.dispose();
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  it('lists a local source and imports what was ticked, applying it in the same step', async () => {
    const kind = await backend.classify(sourceDir);
    assert.equal(kind.kind, 'local');
    const listing = await backend.listSource(sourceDir);
    assert.deepEqual(
      listing.skills.map((s) => [s.id, s.inHub, s.renamed]),
      [['lint-rules', false, false]],
    );
    const project = backend.store.settings.projects[0];
    const ids = await backend.importListed(listing.token, [0], { roots: [project], targets: ['claude'] });
    assert.deepEqual(ids, ['lint-rules']);
    assert.ok((await readLock(project)).skills['lint-rules']);

    const again = await backend.listSource(sourceDir);
    assert.equal(again.skills[0].inHub, true, 'the same source is "Already in hub"');
    await backend.closeListing(again.token);
  });

  it('finds a newer version at the source, shows what changed, and updates the hub from exactly that', async () => {
    let state = await backend.getState();
    assert.equal(state.skills[0].check, undefined);
    assert.deepEqual(await backend.checkSources(), { newer: [], failed: 0 });
    state = await backend.getState();
    assert.equal(state.skills[0].check?.state, 'current');

    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: lint-rules\ndescription: House lint rules.\n---\n\n# Lint rules\n\nUse spaces.\n');
    await fs.rm(path.join(sourceDir, 'notes.md'));
    await writeFile(path.join(sourceDir, 'examples', 'bad.ts'), 'let x=1\n');
    assert.deepEqual(await backend.checkSources(), { newer: ['lint-rules'], failed: 0 });

    backend.refresh();
    state = await backend.getState();
    const check = state.skills[0].check;
    assert.equal(check?.state, 'newer');
    assert.deepEqual(check?.state === 'newer' && check.changes, [
      { path: 'SKILL.md', change: 'changed' },
      { path: 'examples/bad.ts', change: 'added' },
      { path: 'notes.md', change: 'removed' },
    ]);

    const review = await backend.review('lint-rules');
    assert.equal(review.file, 'SKILL.md');
    assert.equal(review.usedIn, 1);
    assert.deepEqual(
      review.diff.filter((l) => l.kind !== 'same' && l.kind !== 'gap'),
      [
        { kind: 'removed', text: 'Use tabs.' },
        { kind: 'added', text: 'Use spaces.' },
      ],
    );

    const result = await backend.updateFromSource(['lint-rules']);
    assert.deepEqual(result, { changed: ['lint-rules'], failed: [] });
    backend.refresh();
    state = await backend.getState();
    assert.equal(state.skills[0].check?.state, 'current');
    assert.equal(state.projects[0].skills[0].status, 'outdated', 'projects using it now have an update');
  });

  it('validates new skill names', async () => {
    assert.match((await backend.validateName('Bad Name'))!, /lowercase/);
    assert.match((await backend.validateName('lint-rules'))!, /already in your hub/);
    assert.equal(await backend.validateName('fresh-skill'), undefined);
  });
});
