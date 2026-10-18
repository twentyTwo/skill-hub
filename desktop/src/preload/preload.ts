/** Exposes `window.skillHub`: one call function and one event stream. The renderer gets nothing else from Node. */
import { contextBridge, ipcRenderer } from 'electron';
import { API_CHANNEL, AppEvent, Bridge, EVENT_CHANNEL } from '../shared/api';

const bridge: Bridge = {
  call: (async (method: string, ...args: unknown[]) => {
    const result = (await ipcRenderer.invoke(API_CHANNEL, method, args)) as { ok: true; value: unknown } | { ok: false; error: string };
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }) as Bridge['call'],
  onEvent: (listener) => {
    ipcRenderer.on(EVENT_CHANNEL, (_event, payload: AppEvent) => listener(payload));
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('skillHub', bridge);
