import { promises as fs } from 'fs';
import * as path from 'path';
import { parseFrontmatter, withFrontmatter } from './frontmatter';
import { SkillMeta } from './types';

export const SKILL_FILE = 'SKILL.md';
const MAX_NAME_LENGTH = 64;

/** File names that say nothing about their content, so the surrounding folder or repo names the skill instead. */
const GENERIC_STEMS = new Set(['readme', 'agents', 'claude', 'gemini', 'copilot-instructions', 'instructions', 'index', 'rules', 'skill']);

/** Agent Skills keys worth keeping when converting other markdown into a SKILL.md. */
const PORTABLE_KEYS = ['license', 'allowed-tools', 'metadata', 'compatibility'];

export function isSkillFileName(name: string): boolean {
  return name.toLowerCase() === 'skill.md';
}

export async function findSkillFile(dir: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return undefined;
  }
  const hit = names.find((n) => n === SKILL_FILE) ?? names.find(isSkillFileName);
  return hit ? path.join(dir, hit) : undefined;
}

export async function readSkillMeta(dir: string, fallbackName = path.basename(dir)): Promise<SkillMeta> {
  const file = await findSkillFile(dir);
  if (!file) throw new Error(`No ${SKILL_FILE} found in ${dir}`);
  return metaFromMarkdown(await fs.readFile(file, 'utf8'), fallbackName);
}

export function metaFromMarkdown(text: string, fallbackName: string): SkillMeta {
  const { data, body } = parseFrontmatter(text);
  return {
    name: str(data.name) || fallbackName,
    description: str(data.description) || summarize(body),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** First prose paragraph of a markdown body, used when a file has no description. */
export function summarize(body: string, max = 200): string {
  const prose = body
    .replace(/\r\n/g, '\n')
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const paragraph of prose.split(/\n\s*\n/)) {
    const text = paragraph
      .split('\n')
      .filter((line) => !/^\s*(#|<!--|```|---|\||>)/.test(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  const heading = /^#+\s+(.+)$/m.exec(body);
  return heading ? heading[1].trim() : '';
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/, '');
  return slug || 'skill';
}

/** Returns an error message, or undefined when `name` is a valid Agent Skills name. */
export function validateSkillName(name: string): string | undefined {
  if (!name) return 'A name is required.';
  if (name.length > MAX_NAME_LENGTH) return `Use at most ${MAX_NAME_LENGTH} characters.`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return 'Use lowercase letters, numbers and single hyphens, e.g. "api-conventions".';
  return undefined;
}

/** Name of the nearest non-hidden folder above a forward-slash relative file path, or `fallback`. */
export function contextNameFor(relPath: string, fallback: string): string {
  const folders = relPath.split('/').slice(0, -1).filter((part) => part && !part.startsWith('.'));
  return folders.length ? folders[folders.length - 1] : fallback;
}

/** Skill name for a markdown file being imported as a skill. */
export function nameForFile(fileName: string, contextName?: string): string {
  const stem = fileName.replace(/\.(md|mdc|markdown|txt)$/i, '').replace(/\.(instructions|prompt)$/i, '');
  const generic = isSkillFileName(fileName) || GENERIC_STEMS.has(stem.toLowerCase());
  return slugify(generic && contextName ? contextName : stem);
}

/**
 * Turns any markdown file (plain .md, Copilot instructions, Cursor .mdc rules...) into SKILL.md content with
 * `name` and `description` frontmatter. A SKILL.md that already has both passes through untouched.
 */
export function toSkillMarkdown(text: string, fileName: string, contextName?: string): { content: string; meta: SkillMeta } {
  const { data, body, hasFrontmatter } = parseFrontmatter(text);
  if (isSkillFileName(fileName) && hasFrontmatter && str(data.name) && str(data.description)) {
    return { content: text, meta: { name: str(data.name), description: str(data.description) } };
  }
  const name = str(data.name) ? slugify(str(data.name)) : nameForFile(fileName, contextName);
  const description = str(data.description) || summarize(body) || `Instructions imported from ${fileName}.`;
  const portable = Object.fromEntries(PORTABLE_KEYS.filter((key) => key in data).map((key) => [key, data[key]]));
  return { content: withFrontmatter({ name, description, ...portable }, body), meta: { name, description } };
}

export function skillTemplate(name: string, description: string): string {
  const title = name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return withFrontmatter(
    { name, description },
    `# ${title}

## When to use

Describe the situations where this skill applies.

## Instructions

1. First step.
2. Second step.

## Examples

Show a short example of the expected input and result.
`,
  );
}
