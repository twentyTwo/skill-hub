/** Line diffs for the review and conflict panels, and the two-way merge behind "Merge both". No Node or DOM imports. */
import type { DiffLine } from './api';

type Op = { kind: 'same' | 'a' | 'b'; text: string };

/** Above this many lines between the common prefix and suffix, the middle is shown as a block replace. */
const MAX_LCS_LINES = 3000;

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Line diff of `a` → `b`: `a` lines are ones only in `a`, `b` lines only in `b`. Removals come before additions in a hunk. */
export function diffLines(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): Op => ({ kind: 'same', text }));
  const tail = a.slice(endA).map((text): Op => ({ kind: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length > MAX_LCS_LINES || midB.length > MAX_LCS_LINES) {
    return [...head, ...midA.map((text): Op => ({ kind: 'a', text })), ...midB.map((text): Op => ({ kind: 'b', text })), ...tail];
  }

  // lcs[i][j] = length of the longest common subsequence of midA[i..] and midB[j..].
  const n = midA.length;
  const m = midB.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const middle: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      middle.push({ kind: 'same', text: midA[i++] });
      j++;
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) middle.push({ kind: 'a', text: midA[i++] });
    else middle.push({ kind: 'b', text: midB[j++] });
  }
  return [...head, ...middle, ...tail];
}

/**
 * The diff as display lines, keeping `context` unchanged lines around each change and collapsing the rest into gaps.
 * `aKind`/`bKind` name what the two sides are in the UI.
 */
export function displayDiff(a: string, b: string, aKind: DiffLine['kind'], bKind: DiffLine['kind'], context = 2): DiffLine[] {
  const ops = diffLines(splitLines(a), splitLines(b));
  const near = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.kind === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) near[k] = true;
  });
  const out: DiffLine[] = [];
  ops.forEach((op, index) => {
    if (!near[index]) {
      const last = out[out.length - 1];
      if (last?.kind === 'gap') last.text = String(Number(last.text) + 1);
      else out.push({ kind: 'gap', text: '1' });
      return;
    }
    out.push({ kind: op.kind === 'same' ? 'same' : op.kind === 'a' ? aKind : bKind, text: op.text });
  });
  return out;
}

/**
 * Both versions in one text: lines they share once, and each place they differ as a git-style conflict block
 * (`<<<<<<< ours` / `=======` / `>>>>>>> theirs`), which VS Code and most editors offer to resolve.
 */
export function mergeWithMarkers(ours: string, theirs: string, oursLabel: string, theirsLabel: string): { text: string; conflicts: number } {
  const ops = diffLines(splitLines(ours), splitLines(theirs));
  const out: string[] = [];
  let conflicts = 0;
  for (let index = 0; index < ops.length; ) {
    if (ops[index].kind === 'same') {
      out.push(ops[index++].text);
      continue;
    }
    const a: string[] = [];
    const b: string[] = [];
    while (index < ops.length && ops[index].kind !== 'same') {
      const op = ops[index++];
      (op.kind === 'a' ? a : b).push(op.text);
    }
    conflicts++;
    out.push(`<<<<<<< ${oursLabel}`, ...a, '=======', ...b, `>>>>>>> ${theirsLabel}`);
  }
  const eol = /\r\n/.test(ours) ? '\r\n' : '\n';
  return { text: out.join(eol) + eol, conflicts };
}
