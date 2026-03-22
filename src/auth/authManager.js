/**
 * Neutron Launcher - Auth Manager
 * Uses msmc for Microsoft auth — no Azure setup needed.
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class AuthManager {
  constructor(configManager) {
    this.config         = configManager;
    this.accounts       = this.config.get('accounts') || [];
    this.currentAccount = this.config.get('currentAccount') || null;
  }

  // ── Microsoft Login ───────────────────────────────────────────────────────
  async loginMicrosoft(BrowserWindowClass) {
    let msmc;
    try {
      msmc = require('msmc');
    } catch {
      throw new Error(
        'msmc not installed.\nRun:  npm install msmc\nThen restart the launcher.'
      );
    }

    logger.info('Starting Microsoft auth via msmc...');
    logger.info('msmc exports: ' + Object.keys(msmc).join(', '));

    let authResult;

    // ── Try msmc v3 API: new Auth("raw").launch("electron") ──────────────
    if (msmc.Auth && typeof msmc.Auth === 'function') {
      try {
        const authObj = new msmc.Auth('raw');
        authResult = await authObj.launch('electron', {
          title: 'Sign in with Microsoft — Neutron Launcher',
          electron: BrowserWindowClass,
        });
      } catch (e) {
        logger.warn('msmc v3 constructor style failed: ' + e.message);
        authResult = null;
      }
    }

    // ── Try msmc v3 static: Auth.launch ──────────────────────────────────
    if (!authResult && msmc.Auth && typeof msmc.Auth.launch === 'function') {
      try {
        authResult = await msmc.Auth.launch('electron', {
          electron: BrowserWindowClass,
        });
      } catch (e) {
        logger.warn('msmc.Auth.launch failed: ' + e.message);
        authResult = null;
      }
    }

    // ── Try top-level function: msmc("raw") ───────────────────────────────
    if (!authResult && typeof msmc === 'function') {
      try {
        authResult = await msmc('raw', BrowserWindowClass);
      } catch (e) {
        logger.warn('msmc() function style failed: ' + e.message);
        authResult = null;
      }
    }

    // ── Try msmc.launch directly ──────────────────────────────────────────
    if (!authResult && typeof msmc.launch === 'function') {
      try {
        authResult = await msmc.launch('electron', {
          electron: BrowserWindowClass,
        });
      } catch (e) {
        logger.warn('msmc.launch failed: ' + e.message);
        authResult = null;
      }
    }

    if (!authResult) {
      throw new Error(
        'msmc failed to launch. Try running:\n\n' +
        '  npm uninstall msmc\n  npm install msmc\n\n' +
        'Then restart the launcher.'
      );
    }

    // ── Validate result ───────────────────────────────────────────────────
    const validate = msmc.validate || msmc.Auth?.validate;
    if (validate && validate(authResult)) {
      throw new Error('Microsoft login was cancelled.');
    }

    logger.info('Auth result type: ' + (authResult?.type || typeof authResult));

    if (authResult.type && authResult.type !== 'Success') {
      throw new Error('Microsoft login failed: ' + authResult.type);
    }

    // ── Get Minecraft token ───────────────────────────────────────────────
    let mcResult;
    try {
      mcResult = await authResult.getMinecraft();
    } catch (e) {
      throw new Error('Failed to get Minecraft token: ' + e.message);
    }

    if (!mcResult) {
      throw new Error('Failed to authenticate with Minecraft services.');
    }

    // ── Build account object ──────────────────────────────────────────────
    const profile = mcResult.profile || mcResult;

    const account = {
      uuid:           profile.id   || uuidv4().replace(/-/g, ''),
      username:       profile.name || 'Unknown',
      type:           'microsoft',
      accessToken:    mcResult.mcToken || mcResult.access_token || '',
      msRefreshToken: authResult.refresh?.token || authResult.token || '',
      skinUrl:        profile.skins?.[0]?.url || null,
      addedAt:        Date.now(),
    };

    this._saveAccount(account);
    logger.info(`Microsoft login success: ${account.username}`);
    return account;
  }

  // ── Offline Login ─────────────────────────────────────────────────────────
  async loginOffline(username) {
    if (!username || username.length < 3 || username.length > 16) {
      throw new Error('Username must be 3–16 characters');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new Error('Username can only contain letters, numbers, and underscores');
    }

    const account = {
      uuid:        uuidv4().replace(/-/g, ''),
      username,
      type:        'offline',
      accessToken: uuidv4().replace(/-/g, ''),
      skinUrl:     null,
      addedAt:     Date.now(),
    };

    this._saveAccount(account);
    logger.info(`Offline login: ${account.username}`);
    return account;
  }

  // ── Token Refresh ─────────────────────────────────────────────────────────
  async refreshToken(uuid) {
    const account = this.accounts.find(a => a.uuid === uuid);
    if (!account || account.type !== 'microsoft') return account;
    if (!account.msRefreshToken) return account;

    try {
      const msmc = require('msmc');
      logger.info(`Refreshing token for ${account.username}...`);

      let refreshed;
      if (msmc.Auth?.refresh) {
        refreshed = await msmc.Auth.refresh(account.msRefreshToken);
      } else if (msmc.refresh) {
        refreshed = await msmc.refresh(account.msRefreshToken);
      } else {
        logger.warn('msmc refresh not available, skipping token refresh');
        return account;
      }

      const mc = await refreshed.getMinecraft();
      account.accessToken    = mc.mcToken || mc.access_token;
      account.msRefreshToken = refreshed.refresh?.token || account.msRefreshToken;
      this._persistAccounts();
      logger.info(`Token refreshed for ${account.username}`);
      return account;
    } catch (err) {
      logger.error('Token refresh failed:', err.message);
      return account; // return old account instead of throwing
    }
  }

  // ── Account Management ────────────────────────────────────────────────────
  _saveAccount(account) {
    const idx = this.accounts.findIndex(a => a.uuid === account.uuid);
    if (idx >= 0) this.accounts[idx] = account;
    else this.accounts.push(account);
    this.currentAccount = account.uuid;
    this._persistAccounts();
  }

  _persistAccounts() {
    this.config.set('accounts', this.accounts);
    this.config.set('currentAccount', this.currentAccount);
  }

  getAccounts() {
    return this.accounts.map(a => ({
      uuid:      a.uuid,
      username:  a.username,
      type:      a.type,
      skinUrl:   a.skinUrl,
      addedAt:   a.addedAt,
      isCurrent: a.uuid === this.currentAccount,
    }));
  }

  getCurrentAccount() {
    return this.accounts.find(a => a.uuid === this.currentAccount) || null;
  }

  switchAccount(uuid) {
    if (!this.accounts.find(a => a.uuid === uuid)) return false;
    this.currentAccount = uuid;
    this.config.set('currentAccount', uuid);
    return true;
  }

  removeAccount(uuid) {
    this.accounts = this.accounts.filter(a => a.uuid !== uuid);
    if (this.currentAccount === uuid) {
      this.currentAccount = this.accounts[0]?.uuid || null;
    }
    this._persistAccounts();
    return true;
  }
}

module.exports = AuthManager;
