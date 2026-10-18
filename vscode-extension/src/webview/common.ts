/** Helpers shared by the Skill Hub webview scripts. Runs in the browser, so no `vscode` or Node imports. */
import type { SkillStatus } from '../shared/status';
import { STATUS } from '../shared/status';

interface VsCodeApi<S> {
  postMessage(message: unknown): void;
  getState(): S | undefined;
  setState(state: S): void;
}

declare function acquireVsCodeApi<S>(): VsCodeApi<S>;

let api: VsCodeApi<unknown> | undefined;

/** The webview API; may only be acquired once per page. */
export function vscodeApi<S>(): VsCodeApi<S> {
  api ??= acquireVsCodeApi<unknown>();
  return api as VsCodeApi<S>;
}

/** HTML that is already safe to insert. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Tagged template that escapes every interpolated value except Html, arrays of Html, and false/null/undefined (which render nothing). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0];
  values.forEach((value, i) => {
    out += piece(value) + strings[i + 1];
  });
  return new Html(out);
}

function piece(value: unknown): string {
  if (value === false || value === null || value === undefined) return '';
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(piece).join('');
  return esc(String(value));
}

export function icon(name: string, className = ''): Html {
  return html`<i class="codicon codicon-${name}${className ? ` ${className}` : ''}" aria-hidden="true"></i>`;
}

/** Status badge: a glyph on the status colour, with the label for screen readers and as a tooltip. */
export function statusBadge(status: SkillStatus): Html {
  const info = STATUS[status];
  return html`<span class="sh-status sh-status--${status}" role="img" aria-label="${info.label}" title="${info.label}">${info.glyph}</span>`;
}

export function statusPill(status: SkillStatus, label = STATUS[status].label): Html {
  return html`<span class="sh-status sh-status--pill sh-status--${status}">${STATUS[status].glyph} ${label}</span>`;
}

/** Value for a `data-vscode-context` attribute, which drives the `webview/context` menus in package.json. */
export function menuContext(values: Record<string, string | boolean>): string {
  return JSON.stringify({ preventDefaultContextMenuItems: true, ...values });
}

/**
 * Replaces `el`'s content, keeping keyboard focus on the element with the same `data-focus` key, so re-rendering
 * on every state update doesn't throw the user's place away.
 */
export function render(el: Element, content: Html): void {
  const active = document.activeElement;
  const key = active && el.contains(active) ? active.getAttribute('data-focus') : null;
  el.innerHTML = content.value;
  if (key) el.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`)?.focus();
}

/** Calls `handler` for clicks on (or inside) elements matching `selector` under `root`. */
export function onClick(root: Element | Document, selector: string, handler: (el: HTMLElement, event: MouseEvent) => void): void {
  root.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>(selector);
    if (target && (root === document || (root as Element).contains(target))) handler(target, event as MouseEvent);
  });
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
