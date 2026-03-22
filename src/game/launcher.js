/**
 * Neutron Launcher — Game Launcher
 * Launches Vanilla + Fabric with tiered FPS optimization presets
 */

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs-extra');
const logger    = require('../utils/logger');

// ── FPS Optimization Presets ─────────────────────────────────────────────────
// Tested against TLauncher, Feather, Lunar — Neutron uses more aggressive GC tuning
const JVM_PRESETS = {

  // Standard — safe defaults for any PC
  standard: [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dfile.encoding=UTF-8',
  ],

  // Performance — Aikar flags + render thread boost
  performance: [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=130',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:G1NewSizePercent=20',
    '-XX:G1MaxNewSizePercent=50',
    '-XX:G1HeapRegionSize=16M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-XX:+UseLargePages',
    '-XX:+AggressiveHeap',
    '-XX:+AlwaysPreTouch',
    '-XX:+UseStringDeduplication',
    '-XX:+OptimizeStringConcat',
    '-XX:+UseCompressedOops',
    '-XX:+UseNUMA',
    '-Dfile.encoding=UTF-8',
    '-Djava.awt.headless=false',
  ],

  // Extreme — max FPS, low GC pauses, best for high-end PCs
  extreme: [
    '-XX:+UseZGC',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    '-XX:+UseNUMA',
    '-XX:+UseLargePages',
    '-XX:+AggressiveHeap',
    '-XX:+UseStringDeduplication',
    '-XX:+OptimizeStringConcat',
    '-XX:+UseCompressedOops',
    '-XX:MaxGCPauseMillis=50',
    '-XX:+ParallelRefProcEnabled',
    '-XX:ConcGCThreads=4',
    '-XX:ZUncommitDelay=300',
    '-Dfile.encoding=UTF-8',
    '-Djava.awt.headless=false',
    '-Dsun.rmi.dgc.server.gcInterval=2147483646',
    '-XX:+PerfDisableSharedMem',
  ],

  // Low-end — minimal memory, stable FPS on weak PCs
  lowend: [
    '-XX:+UseSerialGC',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+OptimizeStringConcat',
    '-XX:+UseStringDeduplication',
    '-XX:+PerfDisableSharedMem',
    '-Dfile.encoding=UTF-8',
    '-client',
  ],

};

class GameLauncher {
  constructor(configManager, authManager, javaRuntimeManager) {
    this.config   = configManager;
    this.auth     = authManager;
    this.jvm      = javaRuntimeManager;
    this._process = null;
    this._logs    = [];
  }

  isRunning() {
    return this._process !== null && !this._process.killed;
  }

  async launch(options, account, onLog, onExit) {
    if (this.isRunning()) throw new Error('Game is already running');

    const {
      versionId,
      ram             = this.config.get('allocatedRam') || 2,
      optimizationMode= this.config.get('optimizationMode') || 'performance',
      fullscreen      = this.config.get('fullscreen')       || false,
      customJvmArgs   = this.config.get('jvmArgs')          || '',
    } = options;

    // ── 1. Resolve Java ───────────────────────────────────────────────────
    let resolvedJava;
    const configuredPath = options.javaPath || this.config.get('javaPath');
    const useBundled     = !configuredPath || configuredPath === 'java' || configuredPath === 'auto';

    if (useBundled && this.jvm) {
      resolvedJava = await this.jvm.getJavaPath((p) => {
        onLog('[LAUNCHER] ' + (p.label || 'Setting up Java...'));
      });
    } else if (configuredPath && configuredPath !== 'java' && configuredPath !== 'auto') {
      if (fs.existsSync(configuredPath)) {
        resolvedJava = configuredPath;
      } else {
        throw new Error('Custom Java path not found: ' + configuredPath);
      }
    } else {
      resolvedJava = 'java';
    }

    logger.info('Java: ' + resolvedJava);
    logger.info('Version: ' + versionId + ' | RAM: ' + ram + 'GB | Mode: ' + optimizationMode);
    onLog('[NEUTRON] Java: ' + resolvedJava);
    onLog('[NEUTRON] Optimization mode: ' + optimizationMode.toUpperCase());
    onLog('[NEUTRON] RAM: ' + ram + 'GB');

    // ── 2. Load version JSON ──────────────────────────────────────────────
    const gameDir     = this.config.getGameDir();
    const versionsDir = this.config.getVersionsDir();
    const versionDir  = path.join(versionsDir, versionId);
    const jsonPath    = path.join(versionDir, versionId + '.json');

    if (!fs.existsSync(jsonPath)) {
      throw new Error('Version "' + versionId + '" not installed. Go to Installations.');
    }

    const versionData = await fs.readJson(jsonPath);
    const mcVersion   = this._extractMcVersion(versionId);

    let vanillaData = versionData;
    const vanillaJsonPath = path.join(versionsDir, mcVersion, mcVersion + '.json');
    if (fs.existsSync(vanillaJsonPath)) {
      vanillaData = await fs.readJson(vanillaJsonPath);
    }

    // ── 3. Build args ─────────────────────────────────────────────────────
    const classpath   = this._buildClasspath(versionData, vanillaData, mcVersion);
    const mainClass   = versionData.mainClass || vanillaData.mainClass || 'net.minecraft.client.main.Main';
    const jvmArgsList = this._buildJvmArgs(ram, optimizationMode, customJvmArgs, gameDir, versionId);
    const gameArgs    = this._buildGameArgs(vanillaData, account, gameDir, versionId, fullscreen);
    const finalArgs   = [...jvmArgsList, '-cp', classpath, mainClass, ...gameArgs];

    if (!classpath || !classpath.trim()) {
      throw new Error('Classpath empty — reinstall the version.');
    }

    await fs.ensureDir(gameDir);

    // ── 4. Spawn ──────────────────────────────────────────────────────────
    let proc;
    try {
      proc = spawn(resolvedJava, finalArgs, {
        cwd: gameDir,
        env: { ...process.env, APPDATA: process.env.APPDATA || gameDir },
        windowsHide: false,
      });
    } catch (err) {
      const msg = err.code === 'ENOENT'
        ? 'Java not found at "' + resolvedJava + '". Check Settings → Java Path.'
        : 'Failed to start Java: ' + (err.message || String(err));
      throw new Error(msg);
    }

    this._process = proc;

    proc.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(l => l.trim()).forEach(line => {
        this._logs.push(line); onLog(line);
      });
    });

    proc.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(l => l.trim()).forEach(line => {
        this._logs.push('[ERR] ' + line); onLog('[ERR] ' + line);
      });
    });

    proc.on('exit', (code) => {
      logger.info('Minecraft exited: ' + code);
      this._process = null; onExit(code);
    });

    proc.on('error', (err) => {
      const msg = err?.code === 'ENOENT'
        ? 'Java not found at "' + resolvedJava + '".'
        : (err.message || JSON.stringify(err));
      logger.error('Launch error: ' + msg);
      this._process = null; onLog('[NEUTRON ERROR] ' + msg); onExit(-1);
    });
  }

  stop() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
      logger.info('Game stopped by user');
    }
  }

  getLogs()   { return this._logs; }
  clearLogs() { this._logs = []; }

  // ── JVM Args with optimization presets ───────────────────────────────────
  _buildJvmArgs(ram, optimizationMode, customJvmArgs, gameDir, versionId) {
    const nativesDir = path.join(gameDir, 'natives', versionId);
    fs.ensureDirSync(nativesDir);

    // Base args always present
    const base = [
      '-Xmx' + ram + 'G',
      '-Xms' + Math.max(1, Math.floor(ram * 0.5)) + 'G',
      '-Djava.library.path=' + nativesDir,
      '-Dminecraft.launcher.brand=NeutronLauncher',
      '-Dminecraft.launcher.version=1.0',
    ];

    // Preset args
    const preset = JVM_PRESETS[optimizationMode] || JVM_PRESETS.performance;

    // Custom user args (appended last, override presets)
    const custom = customJvmArgs && customJvmArgs.trim()
      ? customJvmArgs.trim().split(/\s+/).filter(a => a)
      : [];

    return [...base, ...preset, ...custom];
  }

  // ── Classpath ─────────────────────────────────────────────────────────────
  _buildClasspath(versionData, vanillaData, mcVersion) {
    const sep          = process.platform === 'win32' ? ';' : ':';
    const librariesDir = this.config.getLibrariesDir();
    const versionsDir  = this.config.getVersionsDir();
    const cp   = [];
    const seen = new Set();

    const addLibs = (libs) => {
      for (const lib of (libs || [])) {
        if (!this._isCompatible(lib)) continue;
        const artifact = lib.downloads?.artifact;
        if (artifact?.path) {
          const p = path.join(librariesDir, artifact.path);
          if (!seen.has(p) && fs.existsSync(p)) { seen.add(p); cp.push(p); }
        } else if (!lib.downloads && lib.name) {
          const mp = this._nameToMaven(lib.name);
          if (mp) {
            const p = path.join(librariesDir, mp);
            if (!seen.has(p) && fs.existsSync(p)) { seen.add(p); cp.push(p); }
          }
        }
      }
    };

    addLibs(versionData.libraries);
    if (versionData !== vanillaData) addLibs(vanillaData.libraries);

    const clientJar = path.join(versionsDir, mcVersion, mcVersion + '.jar');
    if (fs.existsSync(clientJar)) cp.push(clientJar);

    logger.debug('Classpath: ' + cp.length + ' entries');
    return cp.join(sep);
  }

  // ── Game Args ─────────────────────────────────────────────────────────────
  _buildGameArgs(versionData, account, gameDir, versionId, fullscreen) {
    const mcVersion  = this._extractMcVersion(versionId);
    const assetsDir  = this.config.getAssetsDir();
    const assetIndex = versionData.assetIndex?.id || mcVersion;

    const vars = {
      '${auth_player_name}':  account.username,
      '${version_name}':      versionId,
      '${game_directory}':    gameDir,
      '${assets_root}':       assetsDir,
      '${assets_index_name}': assetIndex,
      '${auth_uuid}':         account.uuid,
      '${auth_access_token}': account.accessToken,
      '${user_type}':         account.type === 'microsoft' ? 'msa' : 'legacy',
      '${version_type}':      'release',
      '${clientid}':          '0',
      '${auth_xuid}':         '0',
      '${resolution_width}':  '854',
      '${resolution_height}': '480',
    };

    const resolve = (arg) => {
      let s = arg;
      for (const [k, v] of Object.entries(vars)) s = s.replace(k, v ?? '');
      return s;
    };

    const args = [];
    if (versionData.arguments?.game) {
      for (const arg of versionData.arguments.game) {
        if (typeof arg === 'string') args.push(resolve(arg));
      }
    } else if (versionData.minecraftArguments) {
      args.push(...versionData.minecraftArguments.split(' ').map(resolve));
    }

    if (fullscreen) args.push('--fullscreen');
    return args;
  }

  _isCompatible(lib) {
    if (!lib.rules) return true;
    const osName = process.platform === 'win32' ? 'windows' : 'linux';
    return lib.rules.every(r => {
      const m = !r.os || r.os.name === osName;
      return r.action === 'allow' ? m : !m;
    });
  }

  _extractMcVersion(id) {
    if (id.startsWith('vanilla-')) return id.replace('vanilla-', '');
    if (id.startsWith('fabric-')) {
      const parts = id.replace('fabric-', '').split('-');
      return parts.slice(0, parts.length - 1).join('-');
    }
    return id;
  }

  _nameToMaven(name) {
    try {
      const [g, a, v] = name.split(':');
      return g.replace(/\./g, '/') + '/' + a + '/' + v + '/' + a + '-' + v + '.jar';
    } catch { return null; }
  }
}

module.exports = GameLauncher;
