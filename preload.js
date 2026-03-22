/**
 * Neutron Launcher — Preload Script
 * Secure IPC bridge exposing safe APIs to the renderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neutron', {

  window: {
    minimize:    () => ipcRenderer.send('window:minimize'),
    maximize:    () => ipcRenderer.send('window:maximize'),
    close:       () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  update: {
    check:      ()    => ipcRenderer.invoke('update:check'),
    skip:       (v)   => ipcRenderer.invoke('update:skip', v),
    download:   ()    => ipcRenderer.invoke('update:download'),
    clearCache: ()    => ipcRenderer.invoke('update:clearCache'),
    getVersion: ()    => ipcRenderer.invoke('update:getVersion'),
  },

  auth: {
    loginMicrosoft:    ()       => ipcRenderer.invoke('auth:getMicrosoftToken'),
    loginOffline:      (name)   => ipcRenderer.invoke('auth:loginOffline', name),
    getAccounts:       ()       => ipcRenderer.invoke('auth:getAccounts'),
    switchAccount:     (uuid)   => ipcRenderer.invoke('auth:switchAccount', uuid),
    removeAccount:     (uuid)   => ipcRenderer.invoke('auth:removeAccount', uuid),
    getCurrentAccount: ()       => ipcRenderer.invoke('auth:getCurrentAccount'),
    refreshToken:      (uuid)   => ipcRenderer.invoke('auth:refreshToken', uuid),
  },

  fabric: {
    getVersions:          ()    => ipcRenderer.invoke('fabric:getVersions'),
    getInstalledVersions: ()    => ipcRenderer.invoke('fabric:getInstalledVersions'),
    installVersion:       (v)   => ipcRenderer.invoke('fabric:installVersion', v),
    deleteVersion:        (v)   => ipcRenderer.invoke('fabric:deleteVersion', v),
  },

  game: {
    launch:    (opts) => ipcRenderer.invoke('game:launch', opts),
    stop:      ()     => ipcRenderer.invoke('game:stop'),
    isRunning: ()     => ipcRenderer.invoke('game:isRunning'),
  },

  config: {
    get:    (key)      => ipcRenderer.invoke('config:get', key),
    set:    (key, val) => ipcRenderer.invoke('config:set', key, val),
    getAll: ()         => ipcRenderer.invoke('config:getAll'),
    reset:  ()         => ipcRenderer.invoke('config:reset'),
  },

  system: {
    getInfo:     () => ipcRenderer.invoke('system:getInfo'),
    getRamUsage: () => ipcRenderer.invoke('system:getRamUsage'),
  },

  java: {
    getStatus: () => ipcRenderer.invoke('java:getStatus'),
    download:  () => ipcRenderer.invoke('java:download'),
    delete:    () => ipcRenderer.invoke('java:delete'),
  },

  mods: {
    getList:    () => ipcRenderer.invoke('mods:getList'),
    migrate:    () => ipcRenderer.invoke('mods:migrate'),
    toggle:     (p, en) => ipcRenderer.invoke('mods:toggle', p, en),
    delete:     (p)     => ipcRenderer.invoke('mods:delete', p),
    openFolder: ()      => ipcRenderer.invoke('mods:openFolder'),
  },

  dialog: {
    selectJava:    () => ipcRenderer.invoke('dialog:selectJava'),
    selectGameDir: () => ipcRenderer.invoke('dialog:selectGameDir'),
    exportLogs:    () => ipcRenderer.invoke('dialog:exportLogs'),
  },

  shell: {
    openExternal: (url)  => ipcRenderer.invoke('shell:openExternal', url),
    openPath:     (path) => ipcRenderer.invoke('shell:openPath', path),
  },

  logs: {
    getLauncherLogs: () => ipcRenderer.invoke('logs:getLauncherLogs'),
  },

  app: {
    getPath:    (n) => ipcRenderer.invoke('app:getPath', n),
    getVersion: ()  => ipcRenderer.invoke('app:getVersion'),
    getAppPath: ()  => ipcRenderer.invoke('app:getAppPath'),
  },

  debug: {
    msmcVersion: () => ipcRenderer.invoke('debug:msmcVersion'),
  },

  on: (channel, callback) => {
    const allowed = [
      'download:progress', 'java:progress',
      'game:log', 'game:exit', 'game:crash',
      'update:available', 'update:progress',
    ];
    if (!allowed.includes(channel)) return;
    const sub = (_, ...args) => callback(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },

  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
