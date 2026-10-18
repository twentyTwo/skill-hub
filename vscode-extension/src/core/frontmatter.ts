import { parse, stringify } from 'yaml';

const FRONTMATTER = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

export function parseFrontmatter(text: string): ParsedMarkdown {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, body: text, hasFrontmatter: false };
  const source = match[1] ?? '';
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = parse(source);
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Hand-written frontmatter is often not strict YAML (e.g. an unquoted "description: Use when: ...").
    data = lenientParse(source);
  }
  return { data, body: text.slice(match[0].length), hasFrontmatter: true };
}

/** Reads top-level `key: value` lines, ignoring anything YAML-specific. */
function lenientParse(source: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (match && match[2]) data[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return data;
}

export function withFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = stringify(data, { lineWidth: 0 }).trimEnd();
  const content = body.replace(/^\s*\n/, '').replace(/\s*$/, '\n');
  return `---\n${yaml}\n---\n\n${content}`;
}
