/**
 * Neutron Launcher — Smart Updater v2
 * Professional update system:
 * - Remembers skipped versions
 * - Remembers last installed version
 * - Never shows popup for already-installed or skipped updates
 */

const path    = require('path');
const fs      = require('fs-extra');
const https   = require('https');
const http    = require('http');
const { app } = require('electron');
const logger  = require('./logger');

// ── Change this to YOUR raw GitHub URL ───────────────────────────────────────
var UPDATE_MANIFEST_BASE = 'https://raw.githubusercontent.com/Skilledcyberxd/neutron-launcher/refs/heads/main/update.json';

const CURRENT_VERSION = app.getVersion();
const CACHE_DIR       = path.join(app.getPath('userData'), 'update-cache');
const STATE_FILE      = path.join(app.getPath('userData'), 'updater-state.json');

// ── Load/Save persistent update state ────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return fs.readJsonSync(STATE_FILE);
    }
  } catch (e) {}
  return { skippedVersion: null, lastInstalledVersion: null };
}

function saveState(state) {
  try {
    fs.writeJsonSync(STATE_FILE, state, { spaces: 2 });
  } catch (e) {
    logger.warn('[Updater] Could not save state: ' + e.message);
  }
}

class Updater {
  constructor() {
    this._onProgress = null;
    this._onStatus   = null;
    this._manifest   = null;
    this._state      = loadState();
  }

  onProgress(fn) { this._onProgress = fn; }
  onStatus(fn)   { this._onStatus   = fn; }

  _emit(status, percent) {
    logger.info('[Updater] ' + status + (percent != null ? ' ' + percent + '%' : ''));
    if (this._onStatus)  this._onStatus(status, percent);
    if (this._onProgress && percent != null) this._onProgress(percent);
  }

  _isNewer(remote, current) {
    const parse = function(v) { return v.replace(/^v/, '').split('.').map(Number); };
    const r = parse(remote);
    const c = parse(current);
    for (var i = 0; i < 3; i++) {
      if (r[i] > c[i]) return true;
      if (r[i] < c[i]) return false;
    }
    return false;
  }

  // ── Check for updates ─────────────────────────────────────────────────────
  async checkForUpdates() {
    this._emit('Checking for updates…', 0);

    var url = UPDATE_MANIFEST_BASE + '?t=' + Date.now();
    var manifest;

    try {
      manifest = await this._fetchJSON(url);
    } catch (err) {
      logger.warn('[Updater] Could not reach update server: ' + err.message);
      return { available: false, error: err.message };
    }

    this._manifest = manifest;
    var remoteVersion = manifest.version;

    logger.info('[Updater] Current: ' + CURRENT_VERSION + ' | Remote: ' + remoteVersion);

    // ── Not newer ─────────────────────────────────────────────────────────
    if (!this._isNewer(remoteVersion, CURRENT_VERSION)) {
      this._emit('Up to date', 100);
      // Clear skipped version if we're now past it
      if (this._state.skippedVersion && !this._isNewer(this._state.skippedVersion, CURRENT_VERSION)) {
        this._state.skippedVersion = null;
        saveState(this._state);
      }
      return { available: false, current: CURRENT_VERSION };
    }

    // ── Already installed this version (just restarted after update) ──────
    if (this._state.lastInstalledVersion === remoteVersion) {
      logger.info('[Updater] Version ' + remoteVersion + ' already installed — skipping popup');
      this._emit('Up to date', 100);
      // Clear the flag now that we confirmed it's running fine
      this._state.lastInstalledVersion = null;
      saveState(this._state);
      return { available: false, current: CURRENT_VERSION };
    }

    // ── User previously skipped this version (and it's not required) ──────
    if (!manifest.required && this._state.skippedVersion === remoteVersion) {
      logger.info('[Updater] Version ' + remoteVersion + ' was skipped by user');
      this._emit('Update skipped', 100);
      return { available: false, skipped: true, current: CURRENT_VERSION };
    }

    return {
      available:  true,
      required:   manifest.required === true,
      version:    remoteVersion,
      changelog:  manifest.changelog || [],
      current:    CURRENT_VERSION,
    };
  }

  // ── User clicked Skip ─────────────────────────────────────────────────────
  skipVersion(version) {
    this._state.skippedVersion = version;
    saveState(this._state);
    logger.info('[Updater] Skipped version: ' + version);
  }

  // ── Download + apply ──────────────────────────────────────────────────────
  async downloadAndApply() {
    if (!this._manifest) throw new Error('No manifest loaded.');

    await fs.ensureDir(CACHE_DIR);

    var fileName = 'neutron-' + this._manifest.version + '.zip';
    var destPath = path.join(CACHE_DIR, fileName);

    if (fs.existsSync(destPath)) {
      logger.info('[Updater] Using cached file: ' + destPath);
      this._emit('Using cached update…', 30);
    } else {
      this._emit('Downloading update…', 5);
      var self = this;
      await this._downloadFile(this._manifest.url, destPath, function(pct) {
        self._emit('Downloading… ' + pct + '%', Math.round(5 + pct * 0.55));
      });
    }

    this._emit('Extracting update…', 65);
    await this._extractUpdate(destPath);

    this._emit('Applying update…', 82);
    await this._applyUpdate();

    // ── Save state BEFORE restart so we know this version was installed ───
    this._state.lastInstalledVersion = this._manifest.version;
    this._state.skippedVersion       = null;
    saveState(this._state);
    logger.info('[Updater] State saved — installed: ' + this._manifest.version);

    this._emit('Restarting launcher…', 100);
    await new Promise(function(r) { setTimeout(r, 1500); });

    app.relaunch();
    app.exit(0);
  }

  // ── Download file with progress ───────────────────────────────────────────
  _downloadFile(url, dest, onPct) {
    return new Promise(function(resolve, reject) {
      function doReq(reqUrl) {
        var mod = reqUrl.startsWith('https') ? https : http;
        var req = mod.get(reqUrl, { headers: { 'User-Agent': 'NeutronLauncher-Updater/1.0' } }, function(res) {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            doReq(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error('HTTP ' + res.statusCode));
            return;
          }
          var total = parseInt(res.headers['content-length'] || '0', 10);
          var downloaded = 0;
          var file = fs.createWriteStream(dest);
          res.on('data', function(chunk) {
            downloaded += chunk.length;
            if (total > 0) onPct(Math.round(downloaded / total * 100));
          });
          res.pipe(file);
          file.on('finish', function() { file.close(); resolve(); });
          file.on('error', reject);
          res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(60000, function() { req.destroy(); reject(new Error('Download timeout')); });
      }
      doReq(url);
    });
  }

  // ── Extract zip ───────────────────────────────────────────────────────────
  async _extractUpdate(zipPath) {
    var extractDir = path.join(CACHE_DIR, 'extracted');
    await fs.ensureDir(extractDir);
    try {
      var AdmZip = require('adm-zip');
      var zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      logger.info('[Updater] Extracted to: ' + extractDir);
    } catch (err) {
      throw new Error('Failed to extract update: ' + err.message);
    }
  }

  // ── Apply update (copy files over running launcher) ───────────────────────
  async _applyUpdate() {
    var extractDir = path.join(CACHE_DIR, 'extracted');
    var appDir     = path.dirname(app.getPath('exe'));
    var srcDir     = extractDir;

    var entries = fs.readdirSync(extractDir);
    if (entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()) {
      srcDir = path.join(extractDir, entries[0]);
    }

    logger.info('[Updater] Applying from: ' + srcDir + ' → ' + appDir);

    var dirs = ['renderer', 'src', 'assets', 'backend', 'splash', 'scripts'];
    for (var i = 0; i < dirs.length; i++) {
      var s = path.join(srcDir, dirs[i]);
      var d = path.join(appDir, dirs[i]);
      if (fs.existsSync(s)) {
        await fs.copy(s, d, { overwrite: true });
        logger.info('[Updater] Updated dir: ' + dirs[i]);
      }
    }

    var files = ['main.js', 'preload.js', 'package.json', 'electron-builder.yml'];
    for (var j = 0; j < files.length; j++) {
      var sf = path.join(srcDir, files[j]);
      var df = path.join(appDir, files[j]);
      if (fs.existsSync(sf)) {
        await fs.copy(sf, df, { overwrite: true });
        logger.info('[Updater] Updated file: ' + files[j]);
      }
    }

    await fs.remove(extractDir);
    logger.info('[Updater] Update applied successfully');
  }

  // ── Fetch JSON ────────────────────────────────────────────────────────────
  _fetchJSON(url) {
    return new Promise(function(resolve, reject) {
      function doReq(reqUrl) {
        var mod = reqUrl.startsWith('https') ? https : http;
        var req = mod.get(reqUrl, { headers: { 'User-Agent': 'NeutronLauncher-Updater/1.0' } }, function(res) {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            doReq(res.headers.location);
            return;
          }
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid JSON in update manifest')); }
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(10000, function() { req.destroy(); reject(new Error('Manifest fetch timeout')); });
      }
      doReq(url);
    });
  }

  async clearCache() {
    if (fs.existsSync(CACHE_DIR)) {
      await fs.remove(CACHE_DIR);
      logger.info('[Updater] Cache cleared');
    }
  }
}

module.exports = new Updater();
