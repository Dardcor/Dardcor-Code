---
title: "📖 Przewodnik instalacji — Dardcor Code"
version: 3.8.40
lastUpdated: 2026-06-28
---

# 📖 Przewodnik instalacji — Dardcor Code

> Kompletne odniesienie do instalacji Dardcor Code. Szybka wersja: [Szybki start w README](../README.md#-quick-start).

## Spis treści

- [Metody instalacji](#metody-instalacji)
- [Konfiguracja narzędzi CLI](#konfiguracja-narzędzi-cli)
- [Konfiguracja protokołów (MCP + A2A)](#konfiguracja-protokołów-mcp--a2a)
- [Konfiguracja timeoutów](#konfiguracja-timeoutów)
- [Tryb osobnych portów](#tryb-osobnych-portów)
- [Void Linux (xbps-src)](#void-linux-xbps-src-template)
- [Deinstalacja](#deinstalacja)

---

## Metody instalacji

### npm (zalecane)

```bash
npm install -g Dardcor Code
Dardcor Code
```

Dashboard otwiera się pod adresem `http://localhost:20128`, a bazowy URL API to `http://localhost:20128/v1`.

### pnpm

```bash
pnpm add -g Dardcor Code@latest --allow-build=better-sqlite3 --allow-build=@swc/core
Dardcor Code
```

> **Użytkownicy pnpm:** flaga `--allow-build` jest wymagana, aby włączyć natywne skrypty budowania dla `better-sqlite3` i `@swc/core`. Polecenie `pnpm approve-builds -g` nie jest obsługiwane przy globalnych instalacjach w pnpm v11.

### Arch Linux (AUR)

```bash
yay -S Dardcor Code-bin
systemctl --user enable --now Dardcor Code.service
```

[Pakiet AUR](https://aur.archlinux.org/packages/Dardcor Code-bin) instaluje Dardcor Code i udostępnia usługę użytkownika systemd.

### Ze źródeł

```bash
npm install
PORT=20128 DASHBOARD_PORT=20129 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run dev
```

> **Uwaga:** `npm install` przy pierwszym uruchomieniu automatycznie generuje `.env` z `.env.example`. Kolejne instalacje nie nadpisują istniejącego `.env`, więc Twoje zmiany są zachowane. Aby ponownie zainicjować, usuń `.env` przed ponownym uruchomieniem.

### Docker

Zobacz [Przewodnik Docker](./DOCKER_GUIDE.md) — pełna konfiguracja Docker, profile Compose i HTTPS z Caddy.

### Aplikacja desktopowa (Electron)

Dardcor Code dostarcza opakowanie desktopowe oparte na Electron 41 + electron-builder 26.10. Dostępne skrypty (katalog główny workspace):

```bash
npm run electron:dev          # Run desktop with hot-reload
npm run electron:build        # Build for current OS (auto-detected)
npm run electron:build:win    # Windows installer (NSIS + portable)
npm run electron:build:mac    # macOS (dmg + zip, arm64+x64)
npm run electron:build:linux  # Linux (AppImage + deb + rpm)
npm run electron:smoke:packaged  # Smoke-test packaged build
```

Instalatory desktopowe są dołączane do GitHub Releases. Pełny opis Electron (podpisywanie, mostek IPC, dystrybucje): [`ELECTRON_GUIDE.md`](./ELECTRON_GUIDE.md) _(criado em fase posterior)_.

### Serwer headless (CI/automatyzacja)

Do nienadzorowanych instalacji (Docker, Kubernetes, CI) użyj:

```bash
Dardcor Code setup --non-interactive
Dardcor Code providers test-batch
```

W połączeniu ze zmiennymi środowiskowymi (`INITIAL_PASSWORD`, `OMNIROUTE_WS_BRIDGE_SECRET` itd.) pozwala to w pełni skryptowalnie uruchomić instancję Dardcor Code.

### Opcje CLI

| Polecenie               | Opis                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `Dardcor Code`             | Uruchom serwer (`PORT=20128`, API i dashboard na tym samym porcie)   |
| `Dardcor Code setup`       | Prowadzony onboarding CLI: hasło i pierwszy provider                 |
| `Dardcor Code doctor`      | Lokalne testy zdrowia bez uruchamiania serwera                       |
| `Dardcor Code providers`   | Odkrywaj, listuj, waliduj i testuj providerów z CLI                  |
| `Dardcor Code config`      | Konfiguracja narzędzi CLI — list, get, set, validate                 |
| `Dardcor Code status`      | Offline status dashboard — wersja, DB, narzędzia, config             |
| `Dardcor Code logs`        | Strumień logów użycia z API (obsługuje `--follow`)                   |
| `Dardcor Code update`      | Sprawdź lub zastosuj aktualizacje Dardcor Code                          |
| `Dardcor Code provider`    | Zarządzaj połączeniami providerów — add, list, remove, test, default |
| `Dardcor Code --port 3000` | Ustaw kanoniczny/API port na 3000                                    |
| `Dardcor Code --mcp`       | Uruchom serwer MCP (transport stdio)                                 |
| `Dardcor Code --no-open`   | Nie otwieraj przeglądarki automatycznie                              |
| `Dardcor Code --help`      | Pokaż pomoc                                                          |

Konfigurację headless można zautomatyzować flagami lub zmiennymi środowiskowymi:

```bash
Dardcor Code setup --non-interactive --password "$OMNIROUTE_PASSWORD"
Dardcor Code setup --non-interactive --add-provider --provider openai --api-key "$OPENAI_API_KEY"
Dardcor Code setup --non-interactive --add-provider --provider openai --api-key "$OPENAI_API_KEY" --test-provider
```

Uruchom lokalną diagnostykę bez otwierania dashboardu:

```bash
Dardcor Code doctor
Dardcor Code doctor --json
Dardcor Code doctor --no-liveness
```

Zarządzaj providerami z SSH lub skryptów bez otwierania dashboardu:

```bash
Dardcor Code providers available
Dardcor Code providers available --search openai
Dardcor Code providers available --category api-key
Dardcor Code providers list
Dardcor Code providers test <id-or-name>
Dardcor Code providers test-all
Dardcor Code providers validate
```

---

## Konfiguracja narzędzi CLI

### 1) Podłącz providerów i utwórz klucz API

1. Otwórz Dashboard → `Providers` i podłącz co najmniej jednego providera (OAuth lub klucz API).
2. Otwórz Dashboard → `Endpoints` i utwórz klucz API.
3. (Opcjonalnie) Otwórz Dashboard → `Combos` i ustaw łańcuch fallback.

### 2) Wskaż narzędzie do kodowania

```txt
Base URL: http://localhost:20128/v1
API Key:  [copy from Endpoint page]
Model:    if/qwen3.8-max-preview (or any provider/model prefix)
```

Jeśli edytor nie może wysłać `Authorization: Bearer ...`, użyj zamiast tego stokenizowanej bazy zgodności:

```txt
Base URL: http://localhost:20128/api/v1/vscode/YOUR_KEY/
Models URL: http://localhost:20128/api/v1/vscode/YOUR_KEY/models
Chat URL: http://localhost:20128/api/v1/vscode/YOUR_KEY/chat/completions
Ollama Tags URL: http://localhost:20128/api/v1/vscode/YOUR_KEY/api/tags
```

Działa z Claude Code, Codex CLI, Cursor, Cline, OpenClaw, OpenCode oraz SDK zgodnymi z OpenAI.

#### Autokonfiguracja przez `setup-*`

Zamiast ręcznie wklejać base URL i klucz, pozwól Dardcor Code zapisać konfigurację
każdego narzędzia na podstawie żywego katalogu modeli. Jedno polecenie na narzędzie:

```bash
Dardcor Code setup-codex        # ~/.codex/<name>.config.toml profiles
Dardcor Code setup-claude       # ~/.claude/profiles/<name>/settings.json
Dardcor Code setup-opencode     # ~/.config/opencode/opencode.json (openai-compatible)
Dardcor Code setup-cline        # Cline CLI + VS Code extension settings
Dardcor Code setup-kilo         # Kilo Code
Dardcor Code setup-continue     # ~/.continue/config.yaml (Continue / cn)
Dardcor Code setup-cursor       # prints Cursor's in-app steps
Dardcor Code setup-roo          # Roo Code import + autoImport pointer
Dardcor Code setup-crush        # ~/.config/crush/crush.json
Dardcor Code setup-goose        # ~/.config/goose/config.yaml
Dardcor Code setup-aider        # ~/.aider.conf.yml
Dardcor Code setup-qwen         # ~/.qwen/settings.json + ~/.qwen/.env
```

Każde przyjmuje `--remote <url> --api-key <key>`, aby skonfigurować lokalne narzędzie względem
**zdalnego** Dardcor Code, oraz `--dry-run` do podglądu. Launchery
`Dardcor Code launch` (Claude Code) i `Dardcor Code launch-codex` (Codex) uruchamiają CLI
z wstrzykniętym właściwym env, bez zapisu jakiejkolwiek konfiguracji.

Pełna tabela (co każde polecenie zapisuje, wszystkie flagi, local vs remote, konwencje
base-URL `/v1`): **[Integracje CLI](./CLI-INTEGRATIONS.md)**.

Szczegółowa konfiguracja per narzędzie (Claude Code, Codex CLI, Cursor, Cline, OpenClaw, Kilo Code, Copilot i inne): dedykowany **[Przewodnik narzędzi CLI](../reference/CLI-TOOLS.md)**.

---

## Konfiguracja protokołów (MCP + A2A)

### Konfiguracja MCP (Model Context Protocol)

Uruchom transport MCP w trybie stdio:

```bash
Dardcor Code --mcp
```

Zalecany przebieg walidacji:

```bash
# 1. Start MCP server
Dardcor Code --mcp

# 2. From your MCP client, call:
Dardcor Code_get_health        # Should return system health
Dardcor Code_list_combos       # Should return active combos

# 3. Or run the full E2E suite:
npm run test:protocols:e2e
```

#### Konfiguracja klienta MCP

**Claude Code:**

```bash
claude mcp add-server Dardcor Code --type http --url http://localhost:20128/api/mcp/stream
```

**Cursor / Cline:**

Dodaj do ustawień MCP:

```json
{
  "mcpServers": {
    "Dardcor Code": {
      "command": "Dardcor Code",
      "args": ["--mcp"],
      "env": {}
    }
  }
}
```

**Pełna dokumentacja MCP:** [MCP Server README](../../open-sse/mcp-server/README.md) — 87 narzędzi, konfiguracje IDE, klienci Python/TS/Go.

### Konfiguracja A2A (Agent-to-Agent Protocol)

Zweryfikuj Agent Card:

```bash
curl http://localhost:20128/.well-known/agent.json
```

Wyślij zadanie:

```bash
curl -X POST http://localhost:20128/a2a \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"quickstart","method":"message/send","params":{"skill":"quota-management","messages":[{"role":"user","content":"Give me a short quota summary."}]}}'
```

**Pełna dokumentacja A2A:** [A2A Server README](../../src/lib/a2a/README.md) — JSON-RPC 2.0, skills, streaming, cykl życia zadań.

---

## Konfiguracja timeoutów

### Podstawowe timeouty

W większości wdrożeń wystarczą te dwie zmienne:

| Zmienna                  | Domyślnie                       | Cel                                                                                                                                            |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQUEST_TIMEOUT_MS`     | `600000`                        | Wspólna baza dla timeoutu startu odpowiedzi upstream, ukrytych timeoutów Undici, żądań TLS fingerprint oraz timeoutów request/proxy mostka API |
| `STREAM_IDLE_TIMEOUT_MS` | dziedziczy `REQUEST_TIMEOUT_MS` | Maksymalna przerwa między chunkami streamu, po której Dardcor Code przerywa strumień SSE                                                          |

Zachowana jest kompatybilność wsteczna: istniejące `FETCH_TIMEOUT_MS`, `API_BRIDGE_PROXY_TIMEOUT_MS` i inne zmienne timeoutów per warstwa nadal działają i nadpisują wspólną bazę.

### Uwagi specyficzne dla providerów

Dla upstreamów zgodnych z Claude Code (`anthropic-compatible-cc-*`) Dardcor Code wyprowadza nagłówek wychodzący `X-Stainless-Timeout` z rozstrzygniętego timeoutu fetch, aby timeouty odczytu po stronie providera pozostały zsynchronizowane z konfiguracją env.

Dla zewnętrznych reverse proxy zgodnych z Claude Code Dardcor Code utrzymuje domyślny zestaw `anthropic-beta` konserwatywny i, gdy `Client Cache Control` jest na `Auto`, przekazuje tylko markery `cache_control` dostarczone przez klienta. Włącz przełącznik per połączenie „Enable redact-thinking beta” tylko wtedy, gdy upstream wymaga zredagowanych strumieni myślenia Claude.

### Zaawansowane nadpisania timeoutów

| Zmienna                                  | Domyślnie                                    | Cel                                                               |
| ---------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `FETCH_TIMEOUT_MS`                       | dziedziczy `REQUEST_TIMEOUT_MS`              | Timeout startu odpowiedzi upstream do momentu nadejścia nagłówków |
| `FETCH_HEADERS_TIMEOUT_MS`               | dziedziczy `FETCH_TIMEOUT_MS`                | Limit czasu Undici na odebranie nagłówków odpowiedzi upstream     |
| `FETCH_BODY_TIMEOUT_MS`                  | dziedziczy `FETCH_TIMEOUT_MS`                | Limit czasu Undici między chunkami body upstream (`0` wyłącza)    |
| `FETCH_CONNECT_TIMEOUT_MS`               | `30000`                                      | Timeout połączenia TCP Undici                                     |
| `FETCH_KEEPALIVE_TIMEOUT_MS`             | `4000`                                       | Timeout bezczynnego gniazda keep-alive Undici                     |
| `TLS_CLIENT_TIMEOUT_MS`                  | dziedziczy `FETCH_TIMEOUT_MS`                | Timeout żądań TLS fingerprint przez `wreq-js`                     |
| `API_BRIDGE_PROXY_TIMEOUT_MS`            | dziedziczy `REQUEST_TIMEOUT_MS` lub `600000` | Timeout przekierowania proxy `/v1` z portu API na port dashboardu |
| `API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS`   | `max(API_BRIDGE_PROXY_TIMEOUT_MS, 300000)`   | Timeout przychodzącego żądania na serwerze mostka API             |
| `API_BRIDGE_SERVER_HEADERS_TIMEOUT_MS`   | `60000`                                      | Timeout przychodzących nagłówków na serwerze mostka API           |
| `API_BRIDGE_SERVER_KEEPALIVE_TIMEOUT_MS` | `5000`                                       | Timeout keep-alive na serwerze mostka API                         |
| `API_BRIDGE_SERVER_SOCKET_TIMEOUT_MS`    | `0`                                          | Timeout bezczynności gniazda na serwerze mostka API (`0` wyłącza) |

> **Uwaga:** Przy żądaniach streamingowych `FETCH_TIMEOUT_MS` obejmuje tylko nawiązanie połączenia / oczekiwanie na pierwszą odpowiedź upstream. Gdy stream jest aktywny, Dardcor Code przerywa tylko przy rzeczywistym zastoju (`STREAM_IDLE_TIMEOUT_MS`) lub bezczynności body Undici (`FETCH_BODY_TIMEOUT_MS`).

### Zgodność z reverse proxy

Jeśli uruchamiasz Dardcor Code za Nginx, Caddy, Cloudflare lub innym reverse proxy, upewnij się, że timeouty proxy są też wyższe niż timeouty stream/fetch Dardcor Code.

---

## Tryb osobnych portów

Uruchom API i Dashboard na osobnych portach w zaawansowanych scenariuszach (reverse proxy, sieć kontenerów):

```bash
PORT=20128 DASHBOARD_PORT=20129 Dardcor Code
# API:       http://localhost:20128/v1
# Dashboard: http://localhost:20129
```

---

## Void Linux (xbps-src) Template

Dla użytkowników Void Linux możesz zbudować natywny pakiet przez `xbps-src`. Zapisz ten blok jako `srcpkgs/Dardcor Code/template`:

```bash
# Template file for 'Dardcor Code'
pkgname=Dardcor Code
version=3.8.0
revision=1
hostmakedepends="nodejs python3 make"
depends="openssl"
short_desc="Universal AI gateway with smart routing for multiple LLM providers"
maintainer="zenobit <zenobit@disroot.org>"
license="MIT"
homepage="https://github.com/diegosouzapw/Dardcor Code"
distfiles="https://github.com/diegosouzapw/Dardcor Code/archive/refs/tags/v${version}.tar.gz"
# Regenerate the checksum for each release with:
#   curl -L -o /tmp/Dardcor Code.tar.gz "https://github.com/diegosouzapw/Dardcor Code/archive/refs/tags/v${version}.tar.gz" && sha256sum /tmp/Dardcor Code.tar.gz
checksum=PLACEHOLDER_REGENERATE_PER_RELEASE
system_accounts="_Dardcor Code"
Dardcor Code_homedir="/var/lib/Dardcor Code"
export NODE_ENV=production
export npm_config_engine_strict=false
export npm_config_loglevel=error
export npm_config_fund=false
export npm_config_audit=false

do_build() {
	local _gyp_arch
	case "$XBPS_TARGET_MACHINE" in
		aarch64*) _gyp_arch=arm64 ;;
		armv7*|armv6*) _gyp_arch=arm ;;
		i686*) _gyp_arch=ia32 ;;
		*) _gyp_arch=x64 ;;
	esac

	NODE_ENV=development npm ci --ignore-scripts
	npm run build
	cp -r .next/static .next/standalone/.next/static
	[ -d public ] && cp -r public .next/standalone/public || true

	local _node_gyp=/usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js
	(cd node_modules/better-sqlite3 && node "$_node_gyp" rebuild --arch="$_gyp_arch")

	local _bs3_release=.next/standalone/node_modules/better-sqlite3/build/Release
	mkdir -p "$_bs3_release"
	cp node_modules/better-sqlite3/build/Release/better_sqlite3.node "$_bs3_release/"

	rm -rf .next/standalone/node_modules/@img

	for _mod in pino-abstract-transport split2 process-warning; do
		cp -r "node_modules/$_mod" .next/standalone/node_modules/
	done
}

do_check() {
	npm run test:unit
}

do_install() {
	vmkdir usr/lib/Dardcor Code/.next
	vcopy .next/standalone/. usr/lib/Dardcor Code/.next/standalone

	for _d in \
		.next/standalone/.next/server/app/dashboard \
		.next/standalone/.next/server/app/dashboard/settings \
		.next/standalone/.next/server/app/dashboard/providers; do
		touch "${DESTDIR}/usr/lib/Dardcor Code/${_d}/.keep"
	done

	cat > "${WRKDIR}/Dardcor Code" <<'EOF'
#!/bin/sh
export PORT="${PORT:-20128}"
export DATA_DIR="${DATA_DIR:-${XDG_DATA_HOME:-${HOME}/.local/share}/Dardcor Code}"
export APP_LOG_TO_FILE="${APP_LOG_TO_FILE:-false}"
mkdir -p "${DATA_DIR}"
exec node /usr/lib/Dardcor Code/.next/standalone/server.js "$@"
EOF
	vbin "${WRKDIR}/Dardcor Code"
}

post_install() {
	vlicense LICENSE
}
```

---

## Deinstalacja

| Polecenie                | Działanie                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `npm run uninstall`      | Usuwa aplikację systemową, ale **zachowuje DB i konfiguracje** w `~/.Dardcor Code`.     |
| `npm run uninstall:full` | Usuwa aplikację ORAZ trwale **kasuje wszystkie konfiguracje, klucze i bazy danych**. |

> Szczegółowe instrukcje deinstalacji dla wszystkich metod: [UNINSTALL.md](./UNINSTALL.md).
