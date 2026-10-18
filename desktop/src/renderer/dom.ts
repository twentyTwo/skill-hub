/** Renderer helpers. The HTML templating and status badges are the extension's webview helpers, reused as-is. */
import type { AppEvent, Bridge, SkillStatus } from '../shared/api';
import { esc, html, Html, render } from '../../../vscode-extension/src/webview/common';
import { STATUS } from '../../../vscode-extension/src/shared/status';

export { byId, esc, html, Html, onClick, plural, render, statusBadge } from '../../../vscode-extension/src/webview/common';
export { STATUS };

declare global {
  interface Window {
    skillHub: Bridge;
  }
}

export const call: Bridge['call'] = (method, ...args) => window.skillHub.call(method, ...args);
export const onEvent = (listener: (event: AppEvent) => void) => window.skillHub.onEvent(listener);
export const isMac = () => window.skillHub.platform === 'darwin';

// ------------------------------------------------------------------ Icons (inline SVG, so nothing loads from the network)

const PATHS: Record<string, string> = {
  logo: '<path d="M12 2.5l8.25 4.75v9.5L12 21.5l-8.25-4.75v-9.5z"/><path d="M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
};

export function svg(name: keyof typeof PATHS | string, label?: string): Html {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  const stroke = name === 'logo' ? 'stroke="#FF9A4D" stroke-width="1.6"' : 'stroke="currentColor" stroke-width="1.8"';
  return new Html(`<svg ${a11y} viewBox="0 0 24 24" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? ''}</svg>`);
}

// ------------------------------------------------------------------ Status text

/** Status glyph + label in the status colour, for rows and the USED IN list. */
export function statusText(status: SkillStatus): Html {
  const info = STATUS[status];
  return html`<span class="st st--${status}">${info.glyph} ${info.label}</span>`;
}

/** Matrix cell / legend square. */
export function statusCellClass(status: SkillStatus): string {
  return `cell sh-status--${status}`;
}

// ------------------------------------------------------------------ Toasts

export function toast(kind: 'info' | 'warning' | 'error', text: string, action?: { label: string; run: () => void }): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  render(
    el,
    html`<div class="toast__text">${text}</div>
      <div class="toast__actions">
        ${action && html`<button class="sh-btn sh-btn--sm" data-toast-action>${action.label}</button>`}
        <button class="icon-btn" data-toast-close aria-label="Dismiss">${svg('close')}</button>
      </div>`,
  );
  const dismiss = () => el.remove();
  el.querySelector('[data-toast-close]')!.addEventListener('click', dismiss);
  el.querySelector('[data-toast-action]')?.addEventListener('click', () => {
    dismiss();
    action!.run();
  });
  host.prepend(el);
  while (host.children.length > 4) host.lastElementChild!.remove();
  if (kind !== 'error') setTimeout(dismiss, kind === 'warning' ? 12000 : 7000);
}

/** Runs an async UI action, turning a failure into an error toast. */
export async function attempt<T>(task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (err) {
    toast('error', err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

// ------------------------------------------------------------------ Dialogs

export interface DialogHandle {
  el: HTMLDialogElement;
  close(): void;
  /** Replaces the dialog's content, keeping focus where it was. */
  update(content: Html): void;
}

/** Opens a modal `<dialog>` (focus trapped, Esc closes). `onClose` runs however it's closed. */
export function openDialog(content: Html, options: { small?: boolean; label: string; onClose?: () => void }): DialogHandle {
  const el = document.createElement('dialog');
  el.className = `dlg${options.small ? ' dlg--sm' : ''}`;
  el.setAttribute('aria-label', options.label);
  render(el, content);
  document.body.append(el);
  el.addEventListener('close', () => {
    options.onClose?.();
    el.remove();
  });
  // A click on the backdrop lands on the dialog element itself.
  el.addEventListener('mousedown', (event) => {
    if (event.target === el) el.close();
  });
  el.showModal();
  el.querySelector<HTMLElement>('[autofocus]')?.focus();
  return { el, close: () => el.close(), update: (next) => render(el, next) };
}

export function confirmDialog(options: { title: string; body?: string; details?: string[]; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const dlg = openDialog(
      html`<div class="dlg__head"><div><h2>${options.title}</h2>${options.body && html`<p>${options.body}</p>`}</div></div>
        ${options.details?.length ? html`<div class="dlg__body"><ul class="dlg__list">${options.details.map((d) => html`<li>${d}</li>`)}</ul></div>` : ''}
        <div class="dlg__foot">
          <span class="spacer"></span>
          <button class="sh-btn" data-no>Cancel</button>
          <button class="sh-btn ${options.danger ? 'sh-btn--danger' : 'sh-btn--primary'}" data-yes autofocus>${options.confirm}</button>
        </div>`,
      { small: true, label: options.title, onClose: () => resolve(result) },
    );
    dlg.el.querySelector('[data-no]')!.addEventListener('click', () => dlg.close());
    dlg.el.querySelector('[data-yes]')!.addEventListener('click', () => {
      result = true;
      dlg.close();
    });
  });
}

// ------------------------------------------------------------------ Formatting

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}
