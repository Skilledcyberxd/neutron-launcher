/**
 * Neutron Launcher — Main Process
 * Splash screen → update check → main window
 */

const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron');
const path    = require('path');
const fs      = require('fs-extra');
const Store   = require('electron-store');

app.setName('Neutron Launcher');
const isDev  = process.argv.includes('--dev');
const store  = new Store({ name: 'neutron-config' });

// ── Lazy-load modules after app ready ────────────────────────────────────────
let logger, AuthManager, GameLauncher, Downloader, FabricManager;
let ConfigManager, JavaRuntimeManager, updater;
let configManager, authManager, gameLauncher, downloader, fabricManager, javaRuntimeMgr;

let splashWindow = null;
let mainWindow   = null;

// ── Splash Window ────────────────────────────────────────────────────────────
function createSplashWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  splashWindow = new BrowserWindow({
    width:           480,
    height:          360,
    x:               Math.round((width  - 480) / 2),
    y:               Math.round((height - 360) / 2),
    frame:           false,
    transparent:     true,
    resizable:       false,
    skipTaskbar:     true,
    alwaysOnTop:     true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload:          path.join(__dirname, 'splash', 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash', 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

// Send progress to splash
function splashProgress(status, percent = null, version = null) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:progress', { status, percent, version });
  }
}

// ── Main Window ───────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          780,
    minWidth:        1100,
    minHeight:       680,
    frame:           false,
    transparent:     false,
    resizable:       true,
    center:          true,
    show:            false,
    title:           'Neutron Launcher',
    backgroundColor: '#07091A',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      webSecurity:      !isDev,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Startup Sequence ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Show splash immediately
  createSplashWindow();
  await delay(300);

  splashProgress('Initializing…', 5, app.getVersion());

  // Load modules
  logger            = require('./src/utils/logger');
  ConfigManager     = require('./src/utils/config');
  AuthManager       = require('./src/auth/authManager');
  Downloader        = require('./src/game/downloader');
  FabricManager     = require('./src/game/fabric');
  GameLauncher      = require('./src/game/launcher');
  JavaRuntimeManager= require('./src/utils/javaRuntime');
  updater           = require('./src/utils/updater');

  logger.info('Neutron Launcher starting — v' + app.getVersion());
  splashProgress('Loading configuration…', 15);
  await delay(200);

  // Init managers
  configManager   = new ConfigManager(store);
  authManager     = new AuthManager(configManager);
  downloader      = new Downloader(configManager);
  fabricManager   = new FabricManager(configManager, downloader);
  javaRuntimeMgr  = new JavaRuntimeManager(app.getPath('userData'));
  gameLauncher    = new GameLauncher(configManager, authManager, javaRuntimeMgr);

  splashProgress('Checking for updates…', 30);

  // ── Update check ──────────────────────────────────────────────────────────
  updater.onStatus((status, pct) => {
    const base = 30;
    const prog = pct != null ? base + Math.round(pct * 0.5) : base;
    splashProgress(status, prog);
  });

  let updateInfo = { available: false };
  try {
    updateInfo = await updater.checkForUpdates();
  } catch (err) {
    logger.warn('Update check failed: ' + err.message);
  }

  if (updateInfo.available) {
    splashProgress('Update available — ' + updateInfo.version, 50);
    await delay(400);

    // Create main window hidden (needed to show update modal)
    createMainWindow();
    await waitForMainWindow();

    // Close splash
    closeSplash();

    // Show update modal in main window
    mainWindow.show();
    mainWindow.webContents.send('update:available', updateInfo);

    // Wait for user decision via IPC (handled below)
    return;
  }

  // No update needed — continue launch
  splashProgress('Verifying files…', 70);
  await delay(300);
  splashProgress('Almost ready…', 90);

  createMainWindow();
  await waitForMainWindow();

  splashProgress('Launching!', 100);
  await delay(500);

  closeSplash();
  mainWindow.show();
  logger.info('Launcher ready');
});

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

function waitForMainWindow() {
  return new Promise(resolve => {
    if (!mainWindow) { resolve(); return; }
    mainWindow.webContents.once('did-finish-load', resolve);
    setTimeout(resolve, 5000); // fallback
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

// ── Window Controls ───────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.on('window:close',    () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

// ── Update IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('update:check', async () => {
  try { return await updater.checkForUpdates(); }
  catch (err) { return { available: false, error: err.message }; }
});

ipcMain.handle('update:download', async () => {
  try {
    updater.onStatus((status, pct) => {
      mainWindow?.webContents.send('update:progress', { status, percent: pct });
    });
    updater.onProgress((pct) => {
      mainWindow?.webContents.send('update:progress', { percent: pct });
    });
    await updater.downloadAndApply();
    return { success: true };
  } catch (err) {
    logger.error('Update failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:skip', (_, version) => {
  updater.skipVersion(version);
  return { success: true };
});

ipcMain.handle('update:clearCache', async () => {
  await updater.clearCache();
  return { success: true };
});

ipcMain.handle('update:getVersion', () => app.getVersion());

// ── Auth IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('auth:getMicrosoftToken', async () => {
  try {
    const { BrowserWindow: BW } = require('electron');
    const result = await authManager.loginMicrosoft(BW);
    return { success: true, data: result };
  } catch (err) {
    logger.error('MS auth failed:', err.message);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('auth:loginOffline',       async (_, u) => { try { return { success:true, data: await authManager.loginOffline(u) }; } catch(e) { return { success:false, error:e.message }; } });
ipcMain.handle('auth:getAccounts',        ()      => authManager.getAccounts());
ipcMain.handle('auth:switchAccount',      (_, id) => authManager.switchAccount(id));
ipcMain.handle('auth:removeAccount',      (_, id) => authManager.removeAccount(id));
ipcMain.handle('auth:getCurrentAccount',  ()      => authManager.getCurrentAccount());
ipcMain.handle('auth:refreshToken',       async (_, id) => { try { return { success:true, data: await authManager.refreshToken(id) }; } catch(e) { return { success:false, error:e.message }; } });

// ── Fabric / Version IPC ──────────────────────────────────────────────────────
ipcMain.handle('fabric:getVersions',          async ()  => { try { return { success:true, data: await fabricManager.getSupportedVersions() }; } catch(e) { return { success:false, error:e.message }; } });
ipcMain.handle('fabric:getInstalledVersions', ()        => fabricManager.getInstalledVersions());
ipcMain.handle('fabric:installVersion',       async (_, v) => {
  try {
    await fabricManager.installVersion(v, (p) => { mainWindow?.webContents.send('download:progress', p); });
    return { success: true };
  } catch(e) { logger.error('Install failed:', e.message); return { success:false, error:e.message }; }
});
ipcMain.handle('fabric:deleteVersion', async (_, v) => { try { await fabricManager.deleteVersion(v); return { success:true }; } catch(e) { return { success:false, error:e.message }; } });

// ── Java Runtime IPC ──────────────────────────────────────────────────────────
ipcMain.handle('java:getStatus',  async () => {
  const installed = javaRuntimeMgr.isInstalled();
  const version   = installed ? javaRuntimeMgr.getVersion() : null;
  return { installed, version, path: installed ? javaRuntimeMgr._getBundledPath() : null };
});
ipcMain.handle('java:download', async () => {
  try {
    await javaRuntimeMgr.downloadAndExtract((p) => { mainWindow?.webContents.send('java:progress', p); });
    return { success:true, path: javaRuntimeMgr._getBundledPath() };
  } catch(e) { logger.error('Java DL failed:', e.message); return { success:false, error:e.message }; }
});
ipcMain.handle('java:delete', async () => { try { await javaRuntimeMgr.delete(); return { success:true }; } catch(e) { return { success:false, error:e.message }; } });

// ── Game Launch IPC ───────────────────────────────────────────────────────────
ipcMain.handle('game:launch', async (_, options) => {
  try {
    const account = authManager.getCurrentAccount();
    if (!account) throw new Error('No account selected.');
    await gameLauncher.launch(options, account,
      (line) => mainWindow?.webContents.send('game:log', line),
      (code) => {
        mainWindow?.webContents.send('game:exit', code);
        if (code !== 0 && code !== null) mainWindow?.webContents.send('game:crash', code);
      }
    );
    return { success: true };
  } catch(e) { logger.error('Launch failed:', e.message); return { success:false, error:e.message }; }
});
ipcMain.handle('game:stop',      () => { gameLauncher.stop(); return { success:true }; });
ipcMain.handle('game:isRunning', () => gameLauncher.isRunning());

// ── Config IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('config:get',    (_, k)    => configManager.get(k));
ipcMain.handle('config:set',    (_, k, v) => { configManager.set(k, v); return true; });
ipcMain.handle('config:getAll', ()        => configManager.getAll());
ipcMain.handle('config:reset',  ()        => { configManager.reset(); return true; });

// ── System Info IPC ───────────────────────────────────────────────────────────
ipcMain.handle('system:getInfo', async () => {
  const os = require('os');
  return { totalRam: Math.round(os.totalmem()/1073741824), freeRam: Math.round(os.freemem()/1073741824), cpus: os.cpus().length, platform: os.platform(), arch: os.arch(), osVersion: os.release(), homedir: os.homedir() };
});
ipcMain.handle('system:getRamUsage', () => {
  const os = require('os');
  const used = os.totalmem() - os.freemem();
  return { total: os.totalmem(), free: os.freemem(), used, percent: Math.round(used/os.totalmem()*100) };
});

// ── Mods IPC ──────────────────────────────────────────────────────────────────
function getModsDir() { return path.join(configManager.get('gameDir'), 'mods'); }

async function migrateModSubfolders() {
  const modsDir = getModsDir();
  if (!fs.existsSync(modsDir)) return { moved:0, removed:[] };
  let moved = 0; const removed = [];
  for (const entry of fs.readdirSync(modsDir, { withFileTypes:true })) {
    if (!entry.isDirectory()) continue;
    const sub  = path.join(modsDir, entry.name);
    const jars = fs.readdirSync(sub).filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'));
    for (const jar of jars) {
      const dest = path.join(modsDir, jar);
      if (!fs.existsSync(dest)) { await fs.move(path.join(sub, jar), dest); moved++; }
    }
    if (fs.readdirSync(sub).length === 0) { await fs.remove(sub); removed.push(entry.name); }
  }
  return { moved, removed };
}

ipcMain.handle('mods:migrate',     async () => { try { return { success:true, ...(await migrateModSubfolders()) }; } catch(e) { return { success:false, error:e.message }; } });
ipcMain.handle('mods:getList',     async () => { await migrateModSubfolders(); const d=getModsDir(); await fs.ensureDir(d); return fs.readdirSync(d).filter(f=>f.endsWith('.jar')||f.endsWith('.jar.disabled')).map(f=>({ name:f.replace('.disabled',''), enabled:!f.endsWith('.disabled'), size:fs.statSync(path.join(d,f)).size, path:path.join(d,f) })); });
ipcMain.handle('mods:toggle',      async (_, p, en) => { try { const np = en?p.replace('.disabled',''):p+'.disabled'; await fs.rename(p,np); return { success:true, newPath:np }; } catch(e) { return { success:false, error:e.message }; } });
ipcMain.handle('mods:delete',      async (_, p)     => { try { await fs.remove(p); return { success:true }; } catch(e) { return { success:false, error:e.message }; } });
ipcMain.handle('mods:openFolder',  async ()         => { const d=getModsDir(); await fs.ensureDir(d); shell.openPath(d); return { success:true }; });

// ── Dialog IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('dialog:selectJava',    async () => { const r=await dialog.showOpenDialog(mainWindow,{title:'Select Java',filters:[{name:'Java',extensions:['exe','']}],properties:['openFile']}); return r.canceled?null:r.filePaths[0]; });
ipcMain.handle('dialog:selectGameDir', async () => { const r=await dialog.showOpenDialog(mainWindow,{title:'Select Game Directory',properties:['openDirectory']}); return r.canceled?null:r.filePaths[0]; });
ipcMain.handle('dialog:exportLogs',    async () => { const r=await dialog.showSaveDialog(mainWindow,{title:'Export Logs',defaultPath:`neutron-logs-${Date.now()}.txt`,filters:[{name:'Text',extensions:['txt']}]}); if(!r.canceled){const lf=path.join(app.getPath('userData'),'neutron-launcher.log'); await fs.copy(lf,r.filePath); return { success:true, path:r.filePath };} return { success:false }; });

// ── Shell / App IPC ───────────────────────────────────────────────────────────
ipcMain.handle('shell:openExternal',   (_, url)  => shell.openExternal(url));
ipcMain.handle('shell:openPath',       (_, p)    => shell.openPath(p));
ipcMain.handle('logs:getLauncherLogs', () => { try { const f=path.join(app.getPath('userData'),'neutron-launcher.log'); return fs.existsSync(f)?fs.readFileSync(f,'utf-8'):''; } catch { return ''; } });
ipcMain.handle('app:getPath',          (_, n)    => app.getPath(n));
ipcMain.handle('app:getVersion',       ()        => app.getVersion());
ipcMain.handle('app:getAppPath',       ()        => app.getAppPath());

// ── Debug IPC ─────────────────────────────────────────────────────────────────
ipcMain.handle('debug:msmcVersion', () => {
  try {
    const msmc = require('msmc');
    const pkg  = require('./node_modules/msmc/package.json');
    return { version: pkg.version, exports: Object.keys(msmc), authType: typeof msmc.Auth, authKeys: msmc.Auth?Object.keys(msmc.Auth):[], launchType: typeof msmc.launch };
  } catch(e) { return { error: e.message }; }
});
