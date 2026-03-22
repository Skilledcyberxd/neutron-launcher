/**
 * Neutron Launcher - Java Runtime Manager
 * Downloads, extracts, and manages a bundled JRE 21 inside the launcher.
 * Players never need to install Java separately.
 */

const path   = require('path');
const fs     = require('fs-extra');
const https  = require('https');
const http   = require('http');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');
const logger = require('./logger');

// ── Adoptium Temurin JRE 21 download URLs (Windows x64 / Linux x64) ──────
const JRE_BUILDS = {
  win32: {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jre_x64_windows_hotspot_21.0.5_11.zip',
    filename: 'jre21-win.zip',
    exePath: 'jdk-21.0.5+11-jre/bin/java.exe',
    version: '21.0.5',
  },
  linux: {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jre_x64_linux_hotspot_21.0.5_11.tar.gz',
    filename: 'jre21-linux.tar.gz',
    exePath: 'jdk-21.0.5+11-jre/bin/java',
    version: '21.0.5',
  },
};

class JavaRuntimeManager {
  constructor(dataPath) {
    // dataPath = app.getPath('userData')
    this.runtimeDir = path.join(dataPath, 'runtime', 'jre21');
    this.platform   = process.platform === 'win32' ? 'win32' : 'linux';
    this.build      = JRE_BUILDS[this.platform];
    this._cachedPath = null;
  }

  // ── Public: get java.exe path (download if missing) ───────────────────
  async getJavaPath(progressCallback) {
    // 1. Check bundled JRE
    const bundled = this._getBundledPath();
    if (bundled) {
      logger.info(`Using bundled JRE 21: ${bundled}`);
      this._cachedPath = bundled;
      return bundled;
    }

    // 2. Download bundled JRE
    logger.info('Bundled JRE not found, downloading JRE 21...');
    await this.downloadAndExtract(progressCallback);

    const afterDownload = this._getBundledPath();
    if (afterDownload) {
      this._cachedPath = afterDownload;
      return afterDownload;
    }

    // 3. Last resort: system java
    logger.warn('Bundled JRE unavailable, falling back to system java');
    return 'java';
  }

  // ── Check if bundled JRE is already installed ─────────────────────────
  _getBundledPath() {
    const candidates = [
      path.join(this.runtimeDir, this.build.exePath),
      // Also check a flat structure in case extraction differs
      path.join(this.runtimeDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    // Search recursively for java.exe in runtimeDir
    return this._findJavaInDir(this.runtimeDir);
  }

  _findJavaInDir(dir, depth = 0) {
    if (depth > 5 || !fs.existsSync(dir)) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const found = this._findJavaInDir(full, depth + 1);
          if (found) return found;
        } else {
          const target = process.platform === 'win32' ? 'java.exe' : 'java';
          if (e.name === target) {
            // Verify it's actually runnable
            try {
              execSync(`"${full}" -version 2>&1`, { timeout: 4000, windowsHide: true });
              return full;
            } catch { /* not executable */ }
          }
        }
      }
    } catch {}
    return null;
  }

  // ── Download + extract JRE ────────────────────────────────────────────
  async downloadAndExtract(progressCallback) {
    await fs.ensureDir(this.runtimeDir);

    const tmpFile = path.join(this.runtimeDir, this.build.filename);

    // Download
    await this._downloadFile(this.build.url, tmpFile, (p) => {
      if (progressCallback) progressCallback({ ...p, stage: 'java-download' });
    });

    // Extract
    if (progressCallback) progressCallback({
      stage: 'java-extract', label: 'Extracting Java 21...', percent: 95,
    });

    if (this.build.filename.endsWith('.zip')) {
      await this._extractZip(tmpFile, this.runtimeDir);
    } else {
      await this._extractTarGz(tmpFile, this.runtimeDir);
    }

    // Cleanup archive
    await fs.remove(tmpFile);

    // Make java executable on Linux
    if (this.platform !== 'win32') {
      const javaExe = this._getBundledPath();
      if (javaExe) {
        try { fs.chmodSync(javaExe, '755'); } catch {}
      }
    }

    if (progressCallback) progressCallback({
      stage: 'java-done', label: 'Java 21 ready!', percent: 100,
    });

    logger.info('JRE 21 downloaded and extracted successfully');
  }

  _downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const doRequest = (requestUrl) => {
        const mod = requestUrl.startsWith('https') ? https : http;
        const req = mod.get(requestUrl, { headers: { 'User-Agent': 'NeutronLauncher/1.0' } }, (res) => {
          // Follow redirects
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} downloading JRE`));
            return;
          }

          const total     = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded  = 0;
          let lastTime    = Date.now();
          let lastBytes   = 0;

          const file = fs.createWriteStream(dest);

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            const now  = Date.now();
            const diff = (now - lastTime) / 1000;
            let speed  = 0;
            if (diff > 0.5) {
              speed    = Math.round((downloaded - lastBytes) / diff / 1024);
              lastTime = now; lastBytes = downloaded;
            }
            onProgress({
              downloaded, total,
              percent: total ? Math.round((downloaded / total) * 100) : 0,
              speed,
              label: `Downloading Java 21... ${total ? Math.round(downloaded / 1024 / 1024) + '/' + Math.round(total / 1024 / 1024) + ' MB' : ''}`,
            });
          });

          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error', reject);
          res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('JRE download timed out')); });
      };
      doRequest(url);
    });
  }

  async _extractZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(destDir, true);
        resolve();
      } catch (err) {
        reject(new Error('Failed to extract JRE zip: ' + err.message));
      }
    });
  }

  async _extractTarGz(tarPath, destDir) {
    // On Linux use system tar
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const proc = spawn('tar', ['-xzf', tarPath, '-C', destDir], { windowsHide: true });
      proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exit ${code}`)));
      proc.on('error', reject);
    });
  }

  // ── Check if JRE is already downloaded ───────────────────────────────
  isInstalled() {
    return !!this._getBundledPath();
  }

  // ── Get JRE version string for display ───────────────────────────────
  getVersion() {
    const p = this._getBundledPath();
    if (!p) return null;
    try {
      const out = execSync(`"${p}" -version 2>&1`, { timeout: 4000, windowsHide: true }).toString();
      const m = out.match(/version "([^"]+)"/);
      return m ? m[1] : 'Unknown';
    } catch { return null; }
  }

  // ── Delete bundled JRE (for reinstall) ───────────────────────────────
  async delete() {
    await fs.remove(this.runtimeDir);
    this._cachedPath = null;
    logger.info('Bundled JRE deleted');
  }
}

module.exports = JavaRuntimeManager;
