/**
 * Neutron Launcher - Downloader
 * Handles all file downloads with progress tracking and verification
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

class Downloader {
  constructor(configManager) {
    this.config = configManager;
    this._activeDownloads = new Map();
  }

  /**
   * Download a file with progress reporting
   * @param {string} url - Source URL
   * @param {string} dest - Destination file path
   * @param {object} opts - { sha1, progressCallback, label }
   */
  async downloadFile(url, dest, opts = {}) {
    await fs.ensureDir(path.dirname(dest));

    // Skip if already exists and hash matches
    if (opts.sha1 && await this._verifyFile(dest, opts.sha1)) {
      logger.debug(`[DL] Skipping (exists): ${path.basename(dest)}`);
      return;
    }

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 30000,
      headers: { 'User-Agent': 'NeutronLauncher/1.0' },
    });

    const total = parseInt(response.headers['content-length'] || '0', 10);
    let downloaded = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    const writer = fs.createWriteStream(dest);

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        const speed = elapsed > 0.5 ? ((downloaded - lastBytes) / elapsed) : 0;

        if (elapsed > 0.5) {
          lastTime = now;
          lastBytes = downloaded;
        }

        if (opts.progressCallback) {
          opts.progressCallback({
            label: opts.label || path.basename(dest),
            downloaded,
            total,
            percent: total ? Math.round((downloaded / total) * 100) : 0,
            speed: Math.round(speed / 1024), // KB/s
          });
        }
      });

      response.data.pipe(writer);

      writer.on('finish', async () => {
        if (opts.sha1 && !await this._verifyFile(dest, opts.sha1)) {
          reject(new Error(`SHA1 mismatch for ${path.basename(dest)}`));
        } else {
          resolve();
        }
      });

      writer.on('error', reject);
      response.data.on('error', reject);
    });
  }

  /**
   * Download multiple files in parallel with concurrency limit
   */
  async downloadMany(tasks, onProgress) {
    const CONCURRENCY = 4;
    let completed = 0;
    const total = tasks.length;

    const queue = [...tasks];
    const workers = Array(Math.min(CONCURRENCY, total)).fill(null).map(async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) continue;
        try {
          await this.downloadFile(task.url, task.dest, {
            sha1: task.sha1,
            label: task.label,
            progressCallback: (p) => {
              if (onProgress) onProgress({ ...p, completed, total });
            },
          });
          completed++;
          if (onProgress) {
            onProgress({
              label: task.label || '',
              completed,
              total,
              percent: Math.round((completed / total) * 100),
              speed: 0,
            });
          }
        } catch (err) {
          logger.warn(`[DL] Failed: ${task.label || task.url} — ${err.message}`);
        }
      }
    });

    await Promise.all(workers);
  }

  async _verifyFile(filePath, expectedSha1) {
    if (!fs.existsSync(filePath)) return false;
    const hash = crypto.createHash('sha1');
    const data = await fs.readFile(filePath);
    hash.update(data);
    return hash.digest('hex') === expectedSha1;
  }

  async fetchJson(url) {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'NeutronLauncher/1.0' },
      timeout: 15000,
    });
    return res.data;
  }
}

module.exports = Downloader;
