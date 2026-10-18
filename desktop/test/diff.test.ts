import * as assert from 'assert/strict';
import { describe, it } from 'node:test';
import { diffLines, displayDiff, mergeWithMarkers, splitLines } from '../src/shared/diff';

describe('diff', () => {
  it('finds removed and added lines around common ones', () => {
    const ops = diffLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    assert.deepEqual(
      ops.map((o) => `${o.kind}:${o.text}`),
      ['same:a', 'a:b', 'b:x', 'same:c', 'same:d', 'b:e'],
    );
  });

  it('treats CRLF and LF as the same text', () => {
    assert.deepEqual(splitLines('a\r\nb\r\n'), ['a', 'b']);
    assert.ok(displayDiff('a\r\nb\r\n', 'a\nb\n', 'removed', 'added').every((l) => l.kind !== 'removed' && l.kind !== 'added'));
  });

  it('collapses unchanged lines far from a change into gaps', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line ten');
    const lines = displayDiff(before, after, 'removed', 'added', 2);
    assert.deepEqual(lines[0], { kind: 'gap', text: '8' });
    assert.deepEqual(
      lines.slice(1, 7).map((l) => l.kind),
      ['same', 'same', 'removed', 'added', 'same', 'same'],
    );
    assert.deepEqual(lines[7], { kind: 'gap', text: '7' });
  });

  it('merges two versions, marking each place they differ', () => {
    const { text, conflicts } = mergeWithMarkers('a\nmine\nc\n', 'a\ntheirs\nc\nnew\n', 'local', 'hub');
    assert.equal(conflicts, 2);
    assert.equal(text, 'a\n<<<<<<< local\nmine\n=======\ntheirs\n>>>>>>> hub\nc\n<<<<<<< local\n=======\nnew\n>>>>>>> hub\n');
  });

  it('keeps CRLF line endings when merging a CRLF file', () => {
    assert.equal(mergeWithMarkers('a\r\nb\r\n', 'a\r\nb\r\n', 'l', 'h').text, 'a\r\nb\r\n');
  });
});
