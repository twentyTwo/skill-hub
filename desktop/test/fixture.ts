/**
 * Builds a sandbox hub and projects in every state the UI shows: up to date, update available, edited, both changed,
 * files missing, not tracked, and a project folder that no longer exists. Used by the tests and `npm run demo`.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { writeFile } from '../../vscode-extension/src/core/fsutil';
import { Library } from '../../vscode-extension/src/core/library';
import { buildTargets } from '../../vscode-extension/src/core/targets';
import { LibrarySkill, SkillSource } from '../../vscode-extension/src/core/types';
import { applySkill } from '../../vscode-extension/src/core/workspace';

function skillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

const PDF_V1 = `# PDF

## Filling forms

Use pypdf to read fields.
Always keep the original file.
`;

const PDF_V2 = `# PDF

## Filling forms

Use pdfplumber; fall back to OCR.
Always keep the original file.
`;

const PDF_LOCAL = `# PDF

## Filling forms

Use pypdf to read fields.
Always keep the original file.
Local: "Ask before overwriting."
`;

interface Spec {
  id: string;
  description: string;
  body: string;
  source: SkillSource;
  files?: Record<string, string>;
}

const SKILLS: Spec[] = [
  { id: 'pdf', description: 'Read, extract and fill PDF files.', body: PDF_V1, source: { type: 'github', owner: 'anthropics', repo: 'skills', path: 'skills/pdf' }, files: { 'scripts/fill.py': 'print("fill")\n' } },
  {
    id: 'tech-debt-audit',
    description: 'User-invoked tech debt and architecture audit with file-cited findings.',
    body: '# Tech debt audit\n\nWalk the repo, then write TECH_DEBT_AUDIT.md.',
    source: { type: 'github', owner: 'ksimback', repo: 'tech-debt-skill', path: '' },
  },
  { id: 'frontend-design', description: 'Distinctive, production-grade front-end UI.', body: '# Frontend design\n\nPick a clear visual direction first.', source: { type: 'github', owner: 'anthropics', repo: 'skills', path: 'skills/frontend-design' } },
  { id: 'docx', description: 'Create and edit Word documents.', body: '# DOCX\n\nUse python-docx.', source: { type: 'github', owner: 'anthropics', repo: 'skills', path: 'skills/docx' } },
  { id: 'webapp-testing', description: 'Test local web apps with a headless browser.', body: '# Web app testing\n\nStart the server, then drive it with Playwright.', source: { type: 'github', owner: 'anthropics', repo: 'skills', path: 'skills/webapp-testing' } },
  { id: 'review-checklist', description: 'Your own checklist for reviewing pull requests.', body: '# Review checklist\n\n- Tests cover the change\n- Names say what things are', source: { type: 'created' } },
];

async function addSkill(library: Library, spec: Spec, body = spec.body): Promise<LibrarySkill> {
  const staging = await fs.mkdtemp(path.join(path.dirname(library.root), 'staging-'));
  try {
    await writeFile(path.join(staging, 'SKILL.md'), skillMd(spec.id, spec.description, body));
    for (const [rel, content] of Object.entries(spec.files ?? {})) await writeFile(path.join(staging, ...rel.split('/')), content);
    return await library.add(staging, spec.source, { id: spec.id, overwrite: true });
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

export interface Fixture {
  hub: string;
  projects: string[];
  /** The project names, in the order of `projects`. */
  names: { main: string; second: string; conflicted: string; broken: string; gone: string };
}

export async function createFixture(root: string): Promise<Fixture> {
  const hub = path.join(root, 'hub');
  const library = new Library(hub);
  const skills = new Map<string, LibrarySkill>();
  for (const spec of SKILLS) skills.set(spec.id, await addSkill(library, spec));

  const targets = buildTargets();
  const pick = (...ids: string[]) => targets.filter((t) => ids.includes(t.id));
  const names = { main: 'skill-hub', second: 'web-store', conflicted: 'docs-site', broken: 'data-pipeline', gone: 'old-prototype' };
  const dir = (name: string) => path.join(root, 'projects', name);
  for (const name of Object.values(names)) if (name !== names.gone) await fs.mkdir(dir(name), { recursive: true });

  const apply = (project: string, id: string, ...targetIds: string[]) => applySkill(dir(project), skills.get(id)!, pick(...targetIds), targets);
  await apply(names.main, 'pdf', 'claude', 'agents');
  await apply(names.main, 'tech-debt-audit', 'claude', 'agents');
  await apply(names.main, 'frontend-design', 'claude');
  await apply(names.second, 'pdf', 'claude', 'copilot');
  await apply(names.second, 'frontend-design', 'claude');
  await apply(names.second, 'webapp-testing', 'claude');
  await apply(names.second, 'review-checklist', 'claude');
  await apply(names.conflicted, 'pdf', 'claude');
  await apply(names.conflicted, 'review-checklist', 'claude');
  await apply(names.broken, 'webapp-testing', 'agents');

  // The hub moves on: every project using pdf now has an update.
  await addSkill(library, SKILLS[0], PDF_V2);
  // docs-site also edited pdf, so it's "both changed".
  await writeFile(path.join(dir(names.conflicted), '.claude', 'skills', 'pdf', 'SKILL.md'), skillMd('pdf', SKILLS[0].description, PDF_LOCAL));
  // skill-hub edited frontend-design.
  await fs.appendFile(path.join(dir(names.main), '.claude', 'skills', 'frontend-design', 'SKILL.md'), '\nPrefer CSS variables for colours.\n');
  // data-pipeline lost its installed files (e.g. a fresh clone that ignores skill folders).
  await fs.rm(path.join(dir(names.broken), '.agents'), { recursive: true, force: true });
  // web-store has a skill nobody applied through Skill Hub.
  await writeFile(path.join(dir(names.second), '.claude', 'skills', 'release-notes', 'SKILL.md'), skillMd('release-notes', 'Draft release notes from merged PRs.', '# Release notes'));

  return {
    hub,
    projects: [names.main, names.second, names.conflicted, names.broken, names.gone].map(dir),
    names,
  };
}
