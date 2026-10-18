/** Electron entry point: one window, the backend, and the IPC bridge between them. */
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import * as path from 'path';
import { errorMessage } from '../../../vscode-extension/src/core/util';
import { API_CHANNEL, ApiMethod, AppEvent, EVENT_CHANNEL } from '../shared/api';
import { Backend } from './backend';

/** The only methods the renderer may call. Anything else sent over IPC is refused. */
const METHODS: readonly ApiMethod[] = [
  'getState',
  'pickProjectFolders',
  'addProjects',
  'removeProject',
  'projectAction',
  'applyWarnings',
  'applySkill',
  'updateAllSafe',
  'conflict',
  'classify',
  'listSource',
  'importListed',
  'closeListing',
  'pickLocalSource',
  'validateName',
  'createSkill',
  'search',
  'checkSources',
  'review',
  'updateFromSource',
  'deleteSkill',
  'saveSettings',
  'pickLibraryFolder',
  'setGitHubToken',
  'openInEditor',
  'openFolder',
  'reveal',
  'openExternal',
];

let window: BrowserWindow | undefined;
let backend: Backend | undefined;

// Lets `npm run demo` (and tests) run against a sandbox instead of your real settings and hub.
if (process.env.SKILL_HUB_USER_DATA) app.setPath('userData', process.env.SKILL_HUB_USER_DATA);

function send(event: AppEvent): void {
  if (window && !window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    title: 'Skill Hub',
    backgroundColor: '#0D0F12',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => backend?.refresh());

  // Links open in the browser; the window never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null,
  );

  backend = new Backend({
    dataDir: app.getPath('userData'),
    version: app.getVersion(),
    emit: send,
    secrets: safeStorage.isEncryptionAvailable()
      ? {
          encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
          decrypt: (data) => safeStorage.decryptString(Buffer.from(data, 'base64')),
        }
      : undefined,
    pickFolders: async ({ title, multiple }) => {
      const options: Electron.OpenDialogOptions = { title, properties: multiple ? ['openDirectory', 'multiSelections'] : ['openDirectory'] };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },
    openPath: async (target) => {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    },
    reveal: (target) => shell.showItemInFolder(target),
    openExternal: (url) => shell.openExternal(url),
  });
  await backend.init();

  ipcMain.handle(API_CHANNEL, async (event, method: unknown, args: unknown) => {
    if (event.senderFrame?.url && !event.senderFrame.url.startsWith('file://')) return { ok: false, error: 'Refused: unknown sender.' };
    if (typeof method !== 'string' || !METHODS.includes(method as ApiMethod) || !Array.isArray(args)) {
      return { ok: false, error: `Unknown call: ${String(method)}` };
    }
    try {
      const fn = backend![method as ApiMethod] as (...a: unknown[]) => Promise<unknown>;
      return { ok: true, value: await fn.apply(backend, args) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  window = createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(start, (err) => {
    dialog.showErrorBox('Skill Hub could not start', errorMessage(err));
    app.quit();
  });
  app.on('activate', () => {
    if (backend && BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => backend?.dispose());
}
