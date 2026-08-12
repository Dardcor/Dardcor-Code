---
title: "Dardcor Code — Uninstall Guide"
version: 3.8.40
lastUpdated: 2026-06-28
---

# Dardcor Code — Uninstall Guide

🌐 **Languages:** 🇺🇸 [English](./UNINSTALL.md) | 🇧🇷 [Português (Brasil)](../i18n/pt-BR/docs/guides/UNINSTALL.md) | 🇪🇸 [Español](../i18n/es/docs/guides/UNINSTALL.md) | 🇫🇷 [Français](../i18n/fr/docs/guides/UNINSTALL.md) | 🇮🇹 [Italiano](../i18n/it/docs/guides/UNINSTALL.md) | 🇷🇺 [Русский](../i18n/ru/docs/guides/UNINSTALL.md) | 🇨🇳 [中文 (简体)](../i18n/zh-CN/docs/guides/UNINSTALL.md) | 🇩🇪 [Deutsch](../i18n/de/docs/guides/UNINSTALL.md) | 🇮🇳 [हिन्दी](../i18n/in/docs/guides/UNINSTALL.md) | 🇹🇭 [ไทย](../i18n/th/docs/guides/UNINSTALL.md) | 🇺🇦 [Українська](../i18n/uk-UA/docs/guides/UNINSTALL.md) | 🇸🇦 [العربية](../i18n/ar/docs/guides/UNINSTALL.md) | 🇯🇵 [日本語](../i18n/ja/docs/guides/UNINSTALL.md) | 🇻🇳 [Tiếng Việt](../i18n/vi/docs/guides/UNINSTALL.md) | 🇧🇬 [Български](../i18n/bg/docs/guides/UNINSTALL.md) | 🇩🇰 [Dansk](../i18n/da/docs/guides/UNINSTALL.md) | 🇫🇮 [Suomi](../i18n/fi/docs/guides/UNINSTALL.md) | 🇮🇱 [עברית](../i18n/he/docs/guides/UNINSTALL.md) | 🇭🇺 [Magyar](../i18n/hu/docs/guides/UNINSTALL.md) | 🇮🇩 [Bahasa Indonesia](../i18n/id/docs/guides/UNINSTALL.md) | 🇰🇷 [한국어](../i18n/ko/docs/guides/UNINSTALL.md) | 🇲🇾 [Bahasa Melayu](../i18n/ms/docs/guides/UNINSTALL.md) | 🇳🇱 [Nederlands](../i18n/nl/docs/guides/UNINSTALL.md) | 🇳🇴 [Norsk](../i18n/no/docs/guides/UNINSTALL.md) | 🇵🇹 [Português (Portugal)](../i18n/pt/docs/guides/UNINSTALL.md) | 🇷🇴 [Română](../i18n/ro/docs/guides/UNINSTALL.md) | 🇵🇱 [Polski](../i18n/pl/docs/guides/UNINSTALL.md) | 🇸🇰 [Slovenčina](../i18n/sk/docs/guides/UNINSTALL.md) | 🇸🇪 [Svenska](../i18n/sv/docs/guides/UNINSTALL.md) | 🇵🇭 [Filipino](../i18n/phi/docs/guides/UNINSTALL.md) | 🇨🇿 [Čeština](../i18n/cs/docs/guides/UNINSTALL.md)

This guide covers how to cleanly remove Dardcor Code from your system.

---

## Quick Uninstall (v3.6.2+)

Dardcor Code provides two built-in scripts for clean removal:

### Keep Your Data

```bash
npm run uninstall
```

This removes the Dardcor Code application but **preserves** your database, configurations, API keys, and provider settings in `~/.Dardcor Code/`. Use this if you plan to reinstall later and want to keep your setup.

### Full Removal

```bash
npm run uninstall:full
```

This removes the application **and permanently erases** all data:

- Database (`storage.sqlite`)
- Provider configurations and API keys
- Backup files
- Log files
- All files in the `~/.Dardcor Code/` directory

> ⚠️ **Warning:** `npm run uninstall:full` is irreversible. All your provider connections, combos, API keys, and usage history will be permanently deleted.

---

## Manual Uninstall

### NPM Global Install

```bash
# Remove the global package
npm uninstall -g Dardcor Code

# (Optional) Remove data directory
rm -rf ~/.Dardcor Code
```

### pnpm Global Install

```bash
pnpm uninstall -g Dardcor Code
rm -rf ~/.Dardcor Code
```

### Docker

```bash
# Stop and remove the container
docker stop Dardcor Code
docker rm Dardcor Code

# Remove the volume (deletes all data)
docker volume rm Dardcor Code-data

# (Optional) Remove the image
docker rmi diegosouzapw/Dardcor Code:latest
```

### Docker Compose

```bash
# Stop and remove containers
docker compose down

# Also remove volumes (deletes all data)
docker compose down -v
```

### Electron Desktop App

**Windows:**

- Open `Settings → Apps → Dardcor Code → Uninstall`
- Or run the NSIS uninstaller from the install directory

**macOS:**

- Drag `Dardcor Code.app` from `/Applications` to Trash
- Remove data: `rm -rf ~/Library/Application Support/Dardcor Code`

**Linux:**

- Remove the AppImage file
- Remove data: `rm -rf ~/.Dardcor Code`

### Source Install (git clone)

```bash
# Remove the cloned directory
rm -rf /path/to/Dardcor Code

# (Optional) Remove data directory
rm -rf ~/.Dardcor Code
```

---

## Data Directories

Dardcor Code stores data in the following locations by default:

| Platform      | Default Path                  | Override                  |
| ------------- | ----------------------------- | ------------------------- |
| Linux         | `~/.Dardcor Code/`               | `DATA_DIR` env var        |
| macOS         | `~/.Dardcor Code/`               | `DATA_DIR` env var        |
| Windows       | `%APPDATA%/Dardcor Code/`        | `DATA_DIR` env var        |
| Docker        | `/app/data/` (mounted volume) | `DATA_DIR` env var        |
| XDG-compliant | `$XDG_CONFIG_HOME/Dardcor Code/` | `XDG_CONFIG_HOME` env var |

### Files in the data directory

| File/Directory       | Description                                       |
| -------------------- | ------------------------------------------------- |
| `storage.sqlite`     | Main database (providers, combos, settings, keys) |
| `storage.sqlite-wal` | SQLite write-ahead log (temporary)                |
| `storage.sqlite-shm` | SQLite shared memory (temporary)                  |
| `call_logs/`         | Request payload archives                          |
| `backups/`           | Automatic database backups                        |
| `log.txt`            | Legacy request log (optional)                     |

---

## Verify Complete Removal

After uninstalling, verify there are no remaining files:

```bash
# Check for global npm package
npm list -g Dardcor Code 2>/dev/null

# Check for data directory
ls -la ~/.Dardcor Code/ 2>/dev/null

# Check for running processes
pgrep -f Dardcor Code
```

If any process is still running, stop it:

```bash
pkill -f Dardcor Code
```
