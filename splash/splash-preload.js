/**
 * Splash window preload — exposes progress IPC to the splash renderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashBridge', {
  onProgress: (callback) => {
    ipcRenderer.on('splash:progress', (_, data) => callback(data));
  },
});
