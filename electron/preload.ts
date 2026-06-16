import { contextBridge, ipcRenderer } from "electron";

const INVOKE_CHANNELS = new Set([
  "state:load",
  "state:save",
  "history:search",
  "history:autocomplete",
  "suggest:fetch",
  "weather:fetch",
  "blocker:toggle",
  "blocker:state",
  "bookmarks:list",
  "bookmarks:add",
  "bookmarks:remove",
  "tabs:searchContent",
  "downloads:list",
  "downloads:open",
  "downloads:show",
  "extensions:add",
  "extensions:addFromUrl",
  "extensions:list",
  "extensions:remove",
  "app:setDefaultBrowser",
  "app:isDefaultBrowser",
  "update:check",
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
  "tab:find",
  "tab:stopFind",
  "tab:openExternal",
  "tab:suspend",
  "tab:zoom",
  "tab:popout",
  "tab:setMuted",
  "tab:pip",
  "tab:mediaToggle",
  "permission:respond",
  "views:overlay",
  "views:scrollbar",
  "views:html-fullscreen",
  "window:titlebar",
  "update:install",
]);

const ON_CHANNELS = new Set([
  "tab:updated",
  "tab:focused",
  "tab:open",
  "tab:found",
  "tab:suspended",
  "tab:popin",
  "download:updated",
  "permission:request",
  "shortcut",
  "views:html-fullscreen",
  "update:status",
]);

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
