/**
 * Neutron Launcher - Fabric & Vanilla Manager
 * Manages Vanilla + Fabric versions 1.21 – 1.21.11: fetch, install, delete
 */

const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');

const FABRIC_META_URL  = 'https://meta.fabricmc.net/v2';
const MOJANG_MANIFEST  = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

// ── All supported Minecraft versions (newest first) ───────────────────────
const SUPPORTED_MC_VERSIONS = [
  '1.21.11',
  '1.21.10',
  '1.21.9',
  '1.21.8',
  '1.21.7',
  '1.21.6',
  '1.21.5',
  '1.21.4',
  '1.21.3',
  '1.21.2',
  '1.21.1',
  '1.21',
];

class FabricManager {
  constructor(configManager, downloader) {
    this.config = configManager;
    this.dl = downloader;
  }

  // ── Get full supported version list (vanilla + fabric) ─────────────────
  async getSupportedVersions() {
    // 1. Find which of our versions Mojang actually publishes
    let validMojangSet = new Set(SUPPORTED_MC_VERSIONS);
    try {
      const manifest = await this.dl.fetchJson(MOJANG_MANIFEST);
      const mojangIds = new Set(manifest.versions.map(v => v.id));
      validMojangSet = new Set(SUPPORTED_MC_VERSIONS.filter(v => mojangIds.has(v)));
      logger.info(`Mojang manifest: ${validMojangSet.size} valid versions`);
    } catch (err) {
      logger.warn('Could not reach Mojang manifest:', err.message);
    }

    // 2. Fetch top 2 stable Fabric loader versions
    let stableLoaders = [{ version: '0.16.14', stable: true }];
    try {
      const loaders = await this.dl.fetchJson(`${FABRIC_META_URL}/versions/loader`);
      const filtered = loaders.filter(l => l.stable).slice(0, 2);
      if (filtered.length) stableLoaders = filtered;
    } catch (err) {
      logger.warn('Could not fetch Fabric loaders, using fallback:', err.message);
    }

    // 3. Find which MC versions Fabric supports
    let fabricSupportedSet = new Set(SUPPORTED_MC_VERSIONS);
    try {
      const fabricGame = await this.dl.fetchJson(`${FABRIC_META_URL}/versions/game`);
      fabricSupportedSet = new Set(fabricGame.filter(v => v.stable).map(v => v.version));
    } catch (err) {
      logger.warn('Could not fetch Fabric game versions:', err.message);
    }

    // 4. Build combined list: vanilla + fabric per MC version
    const versions = [];

    for (const mcVer of SUPPORTED_MC_VERSIONS) {
      const available = validMojangSet.has(mcVer);

      // Vanilla entry
      versions.push({
        id: `vanilla-${mcVer}`,
        mcVersion: mcVer,
        loaderVersion: null,
        type: 'vanilla',
        displayName: `✦ Vanilla ${mcVer}`,
        stable: true,
        available,
      });

      // Fabric entries
      if (fabricSupportedSet.has(mcVer)) {
        for (const loader of stableLoaders) {
          versions.push({
            id: `fabric-${mcVer}-${loader.version}`,
            mcVersion: mcVer,
            loaderVersion: loader.version,
            type: 'fabric',
            displayName: `⬡ Fabric ${mcVer}  [${loader.version}]`,
            stable: loader.stable,
            available,
          });
        }
      }
    }

    logger.info(`getSupportedVersions → ${versions.length} total entries`);
    return versions;
  }

  // ── Get installed versions (vanilla- and fabric- prefixed) ─────────────
  getInstalledVersions() {
    const versionsDir = this.config.getVersionsDir();
    if (!fs.existsSync(versionsDir)) return [];

    return fs.readdirSync(versionsDir)
      .filter(d => d.startsWith('vanilla-') || d.startsWith('fabric-'))
      .map(d => {
        const jsonPath = path.join(versionsDir, d, `${d}.json`);
        const installed = fs.existsSync(jsonPath);
        const type = d.startsWith('vanilla-') ? 'vanilla' : 'fabric';
        return {
          id: d,
          type,
          installed,
          path: path.join(versionsDir, d),
          displayName: type === 'vanilla'
            ? `✦ ${d.replace('vanilla-', 'Vanilla ')}`
            : `⬡ ${d.replace('fabric-', 'Fabric ')}`,
        };
      });
  }

  // ── Install a version ───────────────────────────────────────────────────
  async installVersion(versionId, progressCallback) {
    const isVanilla = versionId.startsWith('vanilla-');
    const isFabric  = versionId.startsWith('fabric-');
    if (!isVanilla && !isFabric) throw new Error(`Unknown version type: ${versionId}`);

    let mcVersion, loaderVersion;
    if (isVanilla) {
      mcVersion = versionId.replace('vanilla-', '');
    } else {
      const stripped = versionId.replace('fabric-', '');
      const parts = stripped.split('-');
      loaderVersion = parts[parts.length - 1];
      mcVersion = parts.slice(0, parts.length - 1).join('-');
    }

    logger.info(`Installing ${isVanilla ? 'Vanilla' : 'Fabric'} ${mcVersion}${loaderVersion ? ` / loader ${loaderVersion}` : ''}`);

    const versionsDir = this.config.getVersionsDir();
    const versionDir  = path.join(versionsDir, versionId);
    await fs.ensureDir(versionDir);

    // Fabric profile JSON
    let fabricProfile = null;
    if (isFabric) {
      progressCallback({ stage: 'profile', label: `Fetching Fabric profile ${mcVersion}…`, percent: 5 });
      const profileUrl = `${FABRIC_META_URL}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
      try {
        fabricProfile = await this.dl.fetchJson(profileUrl);
      } catch (err) {
        throw new Error(`Fabric ${mcVersion} loader ${loaderVersion} not available: ${err.message}`);
      }
      await fs.writeJson(path.join(versionDir, `${versionId}.json`), fabricProfile, { spaces: 2 });
    }

    // Step 1: Minecraft client JAR + version JSON
    progressCallback({ stage: 'client', label: `Downloading Minecraft ${mcVersion}…`, percent: 15 });
    const versionData = await this._downloadMinecraftClient(mcVersion, progressCallback);

    if (isVanilla) {
      await fs.writeJson(path.join(versionDir, `${versionId}.json`), versionData, { spaces: 2 });
    }

    // Step 2: Libraries
    progressCallback({ stage: 'libraries', label: 'Downloading libraries…', percent: 40 });
    const libs = [...(versionData.libraries || [])];
    if (isFabric && fabricProfile) {
      libs.push(...(fabricProfile.libraries || []));
    }
    await this._downloadLibraries(libs, progressCallback);

    // Step 3: Assets
    progressCallback({ stage: 'assets', label: 'Downloading assets…', percent: 70 });
    await this._downloadAssets(versionData, progressCallback);

    progressCallback({ stage: 'done', label: 'Installation complete!', percent: 100 });
    logger.info(`${versionId} installed successfully`);
  }

  async _downloadMinecraftClient(mcVersion, progressCallback) {
    const manifest = await this.dl.fetchJson(MOJANG_MANIFEST);
    const versionInfo = manifest.versions.find(v => v.id === mcVersion);
    if (!versionInfo) throw new Error(`Minecraft ${mcVersion} not found in Mojang manifest. It may not be released yet.`);

    const versionData = await this.dl.fetchJson(versionInfo.url);
    const clientDl    = versionData.downloads.client;
    const jarDir      = path.join(this.config.getVersionsDir(), mcVersion);
    const jarDest     = path.join(jarDir, `${mcVersion}.jar`);
    await fs.ensureDir(jarDir);

    await this.dl.downloadFile(clientDl.url, jarDest, {
      sha1: clientDl.sha1,
      label: `minecraft-${mcVersion}.jar`,
      progressCallback,
    });

    await fs.writeJson(path.join(jarDir, `${mcVersion}.json`), versionData, { spaces: 2 });
    return versionData;
  }

  async _downloadLibraries(libraries, progressCallback) {
    const tasks = [];
    const seen  = new Set();

    for (const lib of libraries) {
      if (!this._isCompatible(lib)) continue;

      const artifact = lib.downloads?.artifact;
      if (artifact?.path && !seen.has(artifact.path)) {
        seen.add(artifact.path);
        tasks.push({
          url: artifact.url,
          dest: path.join(this.config.getLibrariesDir(), artifact.path),
          sha1: artifact.sha1,
          label: path.basename(artifact.path),
        });
      }

      // Natives
      const osKey = process.platform === 'win32' ? 'windows' : 'linux';
      const nativeKey = lib.natives?.[osKey];
      if (nativeKey) {
        const nat = lib.downloads?.classifiers?.[nativeKey];
        if (nat?.path && !seen.has(nat.path)) {
          seen.add(nat.path);
          tasks.push({
            url: nat.url,
            dest: path.join(this.config.getLibrariesDir(), nat.path),
            sha1: nat.sha1,
            label: path.basename(nat.path),
          });
        }
      }

      // Fabric-style: lib.name only (maven coordinates, no downloads block)
      if (!lib.downloads && lib.name) {
        const mavenPath = this._nameToMavenPath(lib.name);
        if (mavenPath && !seen.has(mavenPath)) {
          seen.add(mavenPath);
          const base = lib.url || 'https://maven.fabricmc.net/';
          tasks.push({
            url: base.endsWith('/') ? base + mavenPath : base + '/' + mavenPath,
            dest: path.join(this.config.getLibrariesDir(), mavenPath),
            label: path.basename(mavenPath),
          });
        }
      }
    }

    logger.info(`Downloading ${tasks.length} library files`);
    await this.dl.downloadMany(tasks, (p) => {
      progressCallback({ ...p, stage: 'libraries', label: `Libraries ${p.completed ?? 0}/${p.total ?? tasks.length}` });
    });
  }

  _nameToMavenPath(name) {
    try {
      const [groupId, artifactId, version] = name.split(':');
      const groupPath = groupId.replace(/\./g, '/');
      return `${groupPath}/${artifactId}/${version}/${artifactId}-${version}.jar`;
    } catch { return null; }
  }

  async _downloadAssets(versionData, progressCallback) {
    const assetIndex = versionData.assetIndex;
    if (!assetIndex) return;

    const indexDest = path.join(this.config.getAssetsDir(), 'indexes', `${assetIndex.id}.json`);
    await this.dl.downloadFile(assetIndex.url, indexDest, {
      sha1: assetIndex.sha1,
      label: `asset-index-${assetIndex.id}`,
    });

    const indexData = await fs.readJson(indexDest);
    const tasks = [];

    for (const [, obj] of Object.entries(indexData.objects || {})) {
      const prefix = obj.hash.substring(0, 2);
      const dest   = path.join(this.config.getAssetsDir(), 'objects', prefix, obj.hash);
      if (!fs.existsSync(dest)) {
        tasks.push({
          url: `https://resources.download.minecraft.net/${prefix}/${obj.hash}`,
          dest,
          sha1: obj.hash,
          label: obj.hash.substring(0, 8),
        });
      }
    }

    logger.info(`Downloading ${tasks.length} asset objects`);
    await this.dl.downloadMany(tasks, (p) => {
      progressCallback({ ...p, stage: 'assets', label: `Assets ${p.completed ?? 0}/${p.total ?? tasks.length}` });
    });
  }

  _isCompatible(lib) {
    if (!lib.rules) return true;
    const osName = process.platform === 'win32' ? 'windows' : 'linux';
    return lib.rules.every(rule => {
      const matches = !rule.os || rule.os.name === osName;
      return rule.action === 'allow' ? matches : !matches;
    });
  }

  async deleteVersion(versionId) {
    const versionDir = path.join(this.config.getVersionsDir(), versionId);
    if (fs.existsSync(versionDir)) {
      await fs.remove(versionDir);
      logger.info(`Deleted version: ${versionId}`);
    }
  }
}

module.exports = FabricManager;
