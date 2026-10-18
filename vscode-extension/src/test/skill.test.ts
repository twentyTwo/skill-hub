import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFrontmatter, withFrontmatter } from '../core/frontmatter';
import { metaFromMarkdown, nameForFile, slugify, summarize, toSkillMarkdown, validateSkillName } from '../core/skill';

describe('frontmatter', () => {
  it('parses YAML frontmatter and returns the body', () => {
    const { data, body, hasFrontmatter } = parseFrontmatter('---\nname: pdf\ndescription: >-\n  Work with\n  PDF files.\n---\n# Title\n');
    assert.equal(hasFrontmatter, true);
    assert.deepEqual(data, { name: 'pdf', description: 'Work with PDF files.' });
    assert.equal(body, '# Title\n');
  });

  it('handles CRLF, a BOM and empty frontmatter', () => {
    assert.deepEqual(parseFrontmatter('﻿---\r\nname: x\r\n---\r\nbody').data, { name: 'x' });
    const empty = parseFrontmatter('---\n---\nbody');
    assert.equal(empty.hasFrontmatter, true);
    assert.equal(empty.body, 'body');
  });

  it('falls back to line parsing when the YAML is invalid', () => {
    const { data } = parseFrontmatter('---\nname: api\ndescription: Use when: adding endpoints\n---\n');
    assert.equal(data.name, 'api');
    assert.equal(data.description, 'Use when: adding endpoints');
  });

  it('leaves text without frontmatter alone', () => {
    assert.deepEqual(parseFrontmatter('# Hello\n---\nnot frontmatter'), { data: {}, body: '# Hello\n---\nnot frontmatter', hasFrontmatter: false });
  });

  it('round-trips through withFrontmatter, quoting values that need it', () => {
    const text = withFrontmatter({ name: 'a', description: 'Use when: x' }, '\n\n# Body');
    assert.equal(text, '---\nname: a\ndescription: "Use when: x"\n---\n\n# Body\n');
    assert.deepEqual(parseFrontmatter(text).data, { name: 'a', description: 'Use when: x' });
  });
});

describe('skill metadata', () => {
  it('reads name and description, falling back to the first paragraph', () => {
    assert.deepEqual(metaFromMarkdown('---\nname: x\ndescription: y\n---\n', 'fallback'), { name: 'x', description: 'y' });
    assert.deepEqual(metaFromMarkdown('# Title\n\nFirst   paragraph\nwraps.\n\nSecond.', 'fallback'), {
      name: 'fallback',
      description: 'First paragraph wraps.',
    });
  });

  it('summarize skips headings, comments and code fences, and truncates', () => {
    assert.equal(summarize('# H\n\n<!-- c -->\n\n```\ncode\n```\n\nReal text.'), 'Real text.');
    assert.equal(summarize('x'.repeat(300)).length, 200);
    assert.equal(summarize('# Only a heading'), 'Only a heading');
  });

  it('slugify produces valid skill names', () => {
    assert.equal(slugify('PDF Processing!'), 'pdf-processing');
    assert.equal(slugify('  Café -- Déjà vu '), 'cafe-deja-vu');
    assert.equal(slugify('***'), 'skill');
    assert.equal(slugify('a'.repeat(80)).length, 64);
  });

  it('validateSkillName follows the Agent Skills rules', () => {
    assert.equal(validateSkillName('api-conventions'), undefined);
    assert.ok(validateSkillName('Api'));
    assert.ok(validateSkillName('a--b'));
    assert.ok(validateSkillName('-a'));
    assert.ok(validateSkillName(''));
  });

  it('nameForFile uses the folder for generic file names', () => {
    assert.equal(nameForFile('react-hooks.mdc'), 'react-hooks');
    assert.equal(nameForFile('testing.instructions.md'), 'testing');
    assert.equal(nameForFile('README.md', 'my-repo'), 'my-repo');
    assert.equal(nameForFile('AGENTS.md', 'tools'), 'tools');
    assert.equal(nameForFile('SKILL.md', 'pdf'), 'pdf');
  });
});

describe('toSkillMarkdown', () => {
  it('passes a complete SKILL.md through untouched', () => {
    const text = '---\nname: PDF Tools\ndescription: d\nlicense: MIT\n---\nbody';
    assert.deepEqual(toSkillMarkdown(text, 'SKILL.md'), { content: text, meta: { name: 'PDF Tools', description: 'd' } });
  });

  it('converts a Cursor rule, keeping the description and dropping Cursor-only keys', () => {
    const { content, meta } = toSkillMarkdown('---\ndescription: React patterns\nglobs: "*.tsx"\nalwaysApply: false\n---\nUse hooks.', 'react.mdc');
    assert.deepEqual(meta, { name: 'react', description: 'React patterns' });
    assert.equal(content, '---\nname: react\ndescription: React patterns\n---\n\nUse hooks.\n');
  });

  it('converts plain markdown using its first paragraph', () => {
    const { meta } = toSkillMarkdown('# Style\n\nWrite short functions.\n', 'AGENTS.md', 'acme-api');
    assert.deepEqual(meta, { name: 'acme-api', description: 'Write short functions.' });
  });

  it('adds a description to a SKILL.md that lacks one', () => {
    const { content } = toSkillMarkdown('---\nname: x\nlicense: MIT\n---\nDoes x.', 'SKILL.md');
    assert.deepEqual(parseFrontmatter(content).data, { name: 'x', description: 'Does x.', license: 'MIT' });
  });
});
