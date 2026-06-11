import { contextBridge, ipcRenderer } from "electron";

const INVOKE_CHANNELS = new Set([
  "state:load",
  "state:save",
  "history:search",
  "bookmarks:list",
  "bookmarks:add",
  "bookmarks:remove",
]);

const SEND_CHANNELS = new Set([
  "tab:ensure",
  "tab:bounds",
  "tab:hide",
  "tab:close",
  "tab:navigate",
  "tab:back",
  "tab:forward",
  "tab:reload",
  "tab:stop",
  "tab:focus",
  "tab:devtools",
  "views:overlay",
  "views:html-fullscreen",
]);

const ON_CHANNELS = new Set(["tab:updated", "tab:focused", "tab:open", "shortcut", "views:html-fullscreen"]);

contextBridge.exposeInMainWorld("api", {
  invoke: (channel: string, payload?: unknown) => {
    if (!INVOKE_CHANNELS.has(channel)) throw new Error(`Blocked invoke channel: ${channel}`);
    return ipcRenderer.invoke(channel, payload);
  },
  send: (channel: string, payload?: unknown) => {
    if (!SEND_CHANNELS.has(channel)) throw new Error(`Blocked send channel: ${channel}`);
    ipcRenderer.send(channel, payload);
  },
  on: (channel: string, fn: (payload: unknown) => void) => {
    if (!ON_CHANNELS.has(channel)) throw new Error(`Blocked on channel: ${channel}`);
    const listener = (_event: unknown, payload: unknown) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
