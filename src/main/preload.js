// Preload for the browser-chrome window (the toolbar UI, not the visited pages).
// Exposes a small, safe API to the renderer via contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiblockle', {
  getBlockingState: () => ipcRenderer.invoke('get-blocking-state'),
  setBlockingEnabled: (enabled) => ipcRenderer.invoke('set-blocking-enabled', enabled),
  isBlocked: (url) => ipcRenderer.invoke('is-blocked', url),
  onBlocked: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ai-blocked', listener);
    return () => ipcRenderer.removeListener('ai-blocked', listener);
  },
});
