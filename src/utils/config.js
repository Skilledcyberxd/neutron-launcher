/**
 * Neutron Launcher - Config Manager
 * Manages persistent launcher settings with defaults
 */

const path = require('path');
const os = require('os');
const { app } = require('electron');

const DEFAULTS = {
  // Game
  gameDir: path.join(os.homedir(), '.neutron', 'minecraft'),
  selectedVersion: 'vanilla-1.21.4',
  allocatedRam: 2,
  javaPath: 'java',
  jvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
  performanceMode: false,
  optimizationMode: 'performance',
  fullscreen: false,
  autoConnect: '',

  // Accounts
  accounts: [],
  currentAccount: null,

  // UI
  theme: 'dark',
  accentColor: '#4DC8F0',
  language: 'en',
  minimizeOnLaunch: true,
  showSystemInfo: true,

  // Launcher
  autoUpdate: true,
  closeOnLaunch: false,
  keepLogs: true,
  maxLogLines: 5000,
};

class ConfigManager {
  constructor(store) {
    this.store = store;
    // Migrate / apply defaults if first run
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (this.store.get(key) === undefined) {
        this.store.set(key, value);
      }
    }
  }

  get(key) {
    return this.store.get(key, DEFAULTS[key]);
  }

  set(key, value) {
    this.store.set(key, value);
  }

  getAll() {
    const result = {};
    for (const key of Object.keys(DEFAULTS)) {
      result[key] = this.store.get(key, DEFAULTS[key]);
    }
    return result;
  }

  reset() {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      this.store.set(key, value);
    }
  }

  getGameDir() {
    return this.get('gameDir');
  }

  getVersionsDir() {
    return path.join(this.getGameDir(), 'versions');
  }

  getAssetsDir() {
    return path.join(this.getGameDir(), 'assets');
  }

  getLibrariesDir() {
    return path.join(this.getGameDir(), 'libraries');
  }

  getModsDir(version) {
    return path.join(this.getGameDir(), 'mods', version || '');
  }
}

module.exports = ConfigManager;
