/** Renderer state: the latest AppState from the main process, plus what's only on screen (view, selection, filters). */
import type { AppState, ConflictVM, SearchResultVM } from '../shared/api';

export type View = 'library' | 'discover' | 'projects' | 'sources' | 'activity' | 'settings' | 'project';
export type LibraryFilter = 'all' | 'github' | 'local' | 'builtin' | 'update' | 'unused';
export type ConflictChoice = 'merge' | 'hub' | 'local';

export type DiscoverState =
  | { status: 'idle'; query: string }
  | { status: 'busy'; query: string }
  | { status: 'done'; query: string; results: SearchResultVM[] }
  | { status: 'error'; query: string; message: string };

export const ui = {
  view: 'library' as View,
  /** The project shown by the `project` view. */
  projectRoot: undefined as string | undefined,
  /** Library selection. */
  selectedSkill: undefined as string | undefined,
  filter: 'all' as LibraryFilter,
  /** Text filter on the Library, set from the global search. */
  query: '',
  /** Selected skill-in-project (matrix cell or project row). */
  cell: undefined as { root: string; id: string } | undefined,
  /** Loaded diff for a conflicted cell, keyed by `root\0id`. */
  conflict: undefined as { key: string; vm?: ConflictVM; error?: string } | undefined,
  choice: 'merge' as ConflictChoice,
  /** Choice to preselect the next time a conflict loads. */
  nextChoice: undefined as ConflictChoice | undefined,
  discover: { status: 'idle', query: '' } as DiscoverState,
};

export const store: { app?: AppState } = {};

type Handler = (el: HTMLElement, event: Event) => void;
const handlers = new Map<string, Handler>();

/** Registers what a click on `[data-act="<name>"]` does. */
export function on(name: string, handler: Handler): void {
  handlers.set(name, handler);
}

export function dispatch(el: HTMLElement, event: Event): boolean {
  const handler = handlers.get(el.dataset.act ?? '');
  if (!handler) return false;
  handler(el, event);
  return true;
}

let renderer: () => void = () => undefined;

export function setRenderer(fn: () => void): void {
  renderer = fn;
}

export function rerender(): void {
  renderer();
}

export function go(view: View, options: { projectRoot?: string; focus?: boolean } = {}): void {
  if (view !== ui.view || options.projectRoot !== ui.projectRoot) ui.cell = undefined;
  ui.view = view;
  if (options.projectRoot) ui.projectRoot = options.projectRoot;
  rerender();
  document.getElementById('main')?.scrollTo(0, 0);
  if (options.focus !== false) document.querySelector<HTMLElement>('#main h1')?.focus();
}

export function cellKey(root: string, id: string): string {
  return `${root}\0${id}`;
}
