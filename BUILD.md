# Neutron Launcher — Build Guide

## Prerequisites

Make sure these are installed:
- Node.js 18+  → https://nodejs.org
- Git (optional)

---

## Step 1 — Install dependencies

```cmd
cd neutron-launcher
npm install
```

---

## Step 2 — Generate the app icon

You need `assets/icon.ico` for the installer.

**Option A — Automatic (easiest):**
```cmd
npm install sharp png-to-ico
node scripts/make-icon.js
```

**Option B — Manual (online tool):**
1. Go to https://convertio.co/svg-ico/
2. Upload `assets/logo.svg`
3. Download the result
4. Save it as `assets/icon.ico`

---

## Step 3 — Build the installer

```cmd
npm run build
```

This creates:
```
dist/
  Neutron Launcher Setup 1.0.0.exe   ← Windows installer
```

---

## Step 4 — Build a portable .exe (optional, no install needed)

```cmd
npm run build:portable
```

Creates:
```
dist/
  NeutronLauncher-1.0.0-portable.exe  ← Just double-click to run
```

---

## What the installer does

When a user runs `Neutron Launcher Setup 1.0.0.exe`:

1. Shows a license agreement screen
2. Lets them choose install directory (default: `C:\Program Files\Neutron Launcher`)
3. Installs the launcher
4. Creates a **Desktop shortcut**
5. Creates a **Start Menu** entry
6. Shows a "Launch Neutron Launcher" checkbox at the end

Uninstall is available via Windows Settings → Apps → Neutron Launcher.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `icon.ico not found` | Run `node scripts/make-icon.js` or manually create the icon |
| `NSIS error` | Make sure `electron-builder` is installed: `npm install electron-builder` |
| `App not starting after install` | Run as administrator once to allow firewall rules |
| Build hangs | Delete `dist/` folder and try again |

---

## Distributing

After building, share `dist/Neutron Launcher Setup 1.0.0.exe` with your users.
They just download and double-click — no Node.js or technical knowledge needed.
