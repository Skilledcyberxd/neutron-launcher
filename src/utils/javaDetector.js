/**
 * Neutron Launcher - Java Auto-Detector
 * Finds a valid Java 17+ installation on Windows automatically
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ── Common Java install locations on Windows ──────────────────────────────
const WINDOWS_JAVA_DIRS = [
  'C:\\Program Files\\Java',
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\Microsoft',
  'C:\\Program Files\\Amazon Corretto',
  'C:\\Program Files\\Zulu',
  'C:\\Program Files\\BellSoft',
  'C:\\Program Files (x86)\\Java',
  process.env.JAVA_HOME,
  process.env.JDK_HOME,
  process.env.JRE_HOME,
].filter(Boolean);

// ── Java versions preferred for Minecraft 1.21+ (needs Java 21 or 17) ────
const PREFERRED_VERSIONS = [21, 17, 11, 8];

/**
 * Try running `java -version` on a path and return version info
 */
function testJavaPath(javaExe) {
  try {
    // -version prints to stderr
    const output = execSync(`"${javaExe}" -version 2>&1`, {
      timeout: 5000,
      windowsHide: true,
    }).toString();

    // Parse version: '17.0.9', '21.0.1', '1.8.0_391', etc.
    const match = output.match(/version "([^"]+)"/);
    if (!match) return null;

    const raw = match[1];
    let major;
    if (raw.startsWith('1.')) {
      major = parseInt(raw.split('.')[1]); // 1.8 → 8
    } else {
      major = parseInt(raw.split('.')[0]); // 17.0.x → 17
    }

    return { path: javaExe, version: raw, major };
  } catch {
    return null;
  }
}

/**
 * Search a directory for java.exe recursively (depth 3)
 */
function findJavaInDir(dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...findJavaInDir(full, depth + 1));
      } else if (e.name === 'java.exe' || e.name === 'java') {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

/**
 * Main detection function — returns best java.exe path found
 */
function detectJava() {
  const candidates = [];

  // 1. Try `java` from PATH first
  const pathResult = testJavaPath('java');
  if (pathResult) {
    candidates.push(pathResult);
    logger.info(`Java found in PATH: ${pathResult.version}`);
  }

  // 2. Try JAVA_HOME
  if (process.env.JAVA_HOME) {
    const jhPath = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
    const jhResult = testJavaPath(jhPath);
    if (jhResult) {
      candidates.push(jhResult);
      logger.info(`Java found via JAVA_HOME: ${jhResult.version}`);
    }
  }

  // 3. Search common install directories
  for (const dir of WINDOWS_JAVA_DIRS) {
    const exes = findJavaInDir(dir);
    for (const exe of exes) {
      if (candidates.find(c => c.path === exe)) continue;
      const result = testJavaPath(exe);
      if (result) {
        candidates.push(result);
        logger.info(`Java found at ${exe}: ${result.version}`);
      }
    }
  }

  // 4. Try Windows registry lookup
  try {
    const regOutput = execSync(
      'reg query "HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment" /s 2>nul',
      { timeout: 3000, windowsHide: true }
    ).toString();
    const javaHomeMatches = regOutput.matchAll(/JavaHome\s+REG_SZ\s+(.+)/g);
    for (const m of javaHomeMatches) {
      const regPath = path.join(m[1].trim(), 'bin', 'java.exe');
      if (!candidates.find(c => c.path === regPath)) {
        const result = testJavaPath(regPath);
        if (result) {
          candidates.push(result);
          logger.info(`Java found via registry: ${result.version}`);
        }
      }
    }
  } catch {}

  if (candidates.length === 0) {
    logger.warn('No Java installation found');
    return null;
  }

  // Pick the best candidate: prefer Java 21, then 17, then highest available
  for (const preferredMajor of PREFERRED_VERSIONS) {
    const match = candidates.find(c => c.major === preferredMajor);
    if (match) {
      logger.info(`Selected Java ${match.major} at: ${match.path}`);
      return match;
    }
  }

  // Fall back to highest version
  candidates.sort((a, b) => b.major - a.major);
  logger.info(`Selected Java ${candidates[0].major} at: ${candidates[0].path}`);
  return candidates[0];
}

/**
 * Get java path from config, auto-detect if not set or invalid
 */
function resolveJavaPath(configuredPath) {
  // If user set a custom path, test it first
  if (configuredPath && configuredPath !== 'java') {
    const result = testJavaPath(configuredPath);
    if (result) {
      logger.info(`Using configured Java ${result.major}: ${configuredPath}`);
      return configuredPath;
    }
    logger.warn(`Configured Java path invalid: ${configuredPath}, auto-detecting...`);
  }

  // Auto-detect
  const detected = detectJava();
  if (detected) return detected.path;

  return null; // Will cause clear error in launcher
}

module.exports = { detectJava, resolveJavaPath, testJavaPath };
