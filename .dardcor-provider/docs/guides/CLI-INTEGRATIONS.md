---
title: "CLI Integrations — point any coding CLI at Dardcor Code"
version: 3.8.40
lastUpdated: 2026-06-28
---

# CLI Integrations

Dardcor Code ships a family of `setup-*` commands that configure a coding
CLI (Codex, Claude Code, OpenCode, Cline, …) to use Dardcor Code as its backend — so
the tool talks to **one** endpoint and Dardcor Code routes to the right provider with
auto-fallback. Each command reads the **live** model catalog from a running
Dardcor Code (local or remote) and writes the tool's own config file on **your**
machine. The API key is referenced by an environment variable wherever the tool
supports it. Commands that persist a tool-local environment file are noted below.

There are also two launchers — `Dardcor Code launch` (Claude Code) and
`Dardcor Code launch-codex` (Codex) — that spawn the CLI with the right env injected,
without writing any config at all.

For the one-time, hand-written base setup of the two richest integrations, see the
per-tool deep dives:

- [Claude Code configuration](./CLAUDE-CODE-CONFIGURATION.md)
- [Codex CLI configuration](./CODEX-CLI-CONFIGURATION.md)
- [Remote Mode](./REMOTE-MODE.md) — drive a remote Dardcor Code (VPS / Tailnet) from your laptop

---

## Master table

Every command honours the **active context** (set with `Dardcor Code connect`, see
[Remote Mode](./REMOTE-MODE.md)) or explicit `--remote <url> --api-key <key>` flags.
"Local vs remote" below means: with no flags it targets `http://localhost:20128`;
with `--remote` (or an active remote context) it fetches the catalog from that
server and writes the config locally.

| Command | Tool | What it writes | Key flags | Local vs remote |
|---------|------|----------------|-----------|-----------------|
| `Dardcor Code setup-codex` | OpenAI Codex CLI | `~/.codex/<name>.config.toml` — one profile per compatible text model (`codex --profile <name>`) | `--remote` `--api-key` `--only` `--dry-run` `--port` `--codex-home` | Both |
| `Dardcor Code setup-claude` | Claude Code | `~/.claude/profiles/<name>/settings.json` — one profile per matched model (`CLAUDE_CONFIG_DIR`) | `--remote` `--api-key` `--only` `--dry-run` `--port` `--claude-home` | Both |
| `Dardcor Code setup-opencode` | OpenCode (openai-compatible) | `~/.config/opencode/opencode.json` — `Dardcor Code` provider with every catalog model (`opencode -m Dardcor Code/<model>`) | `--remote` `--api-key` `--only` `--model` `--dry-run` `--port` | Both |
| `Dardcor Code setup-cline` | Cline | `~/.cline/data/{globalState,secrets}.json` (CLI mode) + prints VS Code extension settings | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--cline-dir` | Both |
| `Dardcor Code setup-kilo` | Kilo Code | `~/.local/share/kilo/auth.json` (CLI) + merges `kilocode.*` into VS Code `settings.json` if present | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--auth-path` `--vscode-settings` | Both |
| `Dardcor Code setup-continue` | Continue / `cn` CLI | `~/.continue/config.yaml` — `provider: openai` models, key via `${{ secrets.OMNIROUTE_API_KEY }}` | `--remote` `--api-key` `--only` `--dry-run` `--port` `--config-path` | Both |
| `Dardcor Code setup-cursor` | Cursor | Nothing — prints the in-app steps (Cursor config is opaque SQLite) | `--remote` `--api-key` `--only` `--port` | Both |
| `Dardcor Code setup-roo` | Roo Code | `~/.Dardcor Code/roo-settings.json` (import doc) + sets `roo-cline.autoImportSettingsPath` if a VS Code `settings.json` exists | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--import-path` `--vscode-settings` | Both |
| `Dardcor Code setup-crush` | Crush | `~/.config/crush/crush.json` — `openai-compat` provider, key via `$OMNIROUTE_API_KEY` | `--remote` `--api-key` `--only` `--dry-run` `--port` `--config-path` | Both |
| `Dardcor Code setup-goose` | Goose | `~/.config/goose/config.yaml` (`GOOSE_PROVIDER`/`OPENAI_HOST`/`GOOSE_MODEL`) + prints env recipe | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--config-path` | Both |
| `Dardcor Code setup-aider` | Aider | `~/.aider.conf.yml` (`openai-api-base` + `model: openai/<id>`) + prints env recipe | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--config-path` | Both |
| `Dardcor Code setup-qwen` | Qwen Code | `~/.qwen/settings.json` — V4 `modelProviders.openai` array + `OMNIROUTE_API_KEY` in `~/.qwen/.env` | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--config-path` `--env-path` | Both |
| `Dardcor Code launch` | Claude Code | Nothing — spawns `claude` with `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` injected | `--remote` `--api-key` `--token` `--profile` `--port` | Both |
| `Dardcor Code launch-codex` | OpenAI Codex CLI | Nothing — spawns `codex` with the `Dardcor Code` provider injected via `-c` flags | `--remote` `--api-key` `--profile` (`-p`) `--port` | Both |

Notes on flags (verified in the command source):

- `--remote <url>` — fetch the catalog from a remote Dardcor Code (overrides `--port`
  and the active context). `--api-key <key>` supplies the credential for that
  server (defaults to the `OMNIROUTE_API_KEY` env var, or the active context's token).
- `--only <patterns>` — comma-separated substrings; keep only model IDs that match
  (e.g. `--only glm,kimi`). Available on `setup-codex`, `setup-claude`,
  `setup-opencode`, `setup-continue`, `setup-cursor`, `setup-crush`.
- `--dry-run` — print exactly what would be written without touching the
  filesystem. Available on every `setup-*` command **except** `setup-cursor`
  (which never writes a file).
- `--model <id>` — required (or picked interactively) for the tools that have no
  model auto-discovery: Cline, Kilo, Roo, Goose, Qwen, Aider. Those tools
  also accept `--yes` for non-interactive runs (which then requires `--model`).
  `setup-opencode` takes `--model` to set the default top-level model.
- `--port <port>` — local Dardcor Code port (default `20128`, ignored when `--remote`
  is set). Present on all `setup-*` and both launchers.
- The two launchers (`launch`, `launch-codex`) accept `--profile <name>` to select
  a profile written by `setup-claude` / `setup-codex`, plus pass-through args for
  the underlying `claude` / `codex` binary.

> `setup-opencode` is the **lightweight openai-compatible** OpenCode integration.
> There is also a richer plugin integration — `Dardcor Code setup opencode` — which
> installs `@Dardcor Code/opencode-plugin`. They are different commands; the table
> above documents `setup-opencode`.

---

## Local usage

With Dardcor Code running on `localhost:20128`, just run the setup command for your
tool. The catalog is fetched from the local server.

```bash
# Codex: write a profile per matched model into ~/.codex/
Dardcor Code setup-codex
codex --profile glm52            # use a generated profile

# Claude Code: write per-model profiles, then launch one
Dardcor Code setup-claude
Dardcor Code launch --profile glm52

# OpenCode: write the openai-compatible provider with all catalog models
Dardcor Code setup-opencode
export OMNIROUTE_API_KEY=sk-...  # referenced via {env:OMNIROUTE_API_KEY}, never on disk
opencode -m Dardcor Code/glm/glm-5.2 "..."

# Tools without auto-discovery need an explicit model:
Dardcor Code setup-aider --model glm/glm-5.2
Dardcor Code setup-qwen --model qwen/qwen3.8-max-preview

# Preview without writing anything:
Dardcor Code setup-continue --dry-run
```

Launch without writing any config at all (env-injection only):

```bash
Dardcor Code launch                 # Claude Code → local Dardcor Code
Dardcor Code launch-codex           # Codex CLI → local Dardcor Code
Dardcor Code launch-codex --profile glm52
```

---

## Remote usage

Point any setup command at a remote Dardcor Code with `--remote` + `--api-key`. The
catalog is fetched from the remote; the config is written on your local machine.

```bash
# OpenCode against a remote VPS, keep only glm/kimi models
Dardcor Code setup-opencode --remote http://192.168.0.15:20128 --api-key oma_live_xxx \
  --only glm,kimi
opencode -m Dardcor Code/glm/glm-5.2 "..."   # export OMNIROUTE_API_KEY first

# Codex profiles from a remote catalog
Dardcor Code setup-codex --remote http://192.168.0.15:20128 --api-key oma_live_xxx

# Launch a CLI straight against the remote
Dardcor Code launch       --remote http://192.168.0.15:20128 --api-key oma_live_xxx
Dardcor Code launch-codex --remote http://192.168.0.15:20128 --api-key oma_live_xxx
```

Instead of passing `--remote`/`--api-key` every time, log in once and let the
**active context** supply them automatically:

```bash
Dardcor Code connect 192.168.0.15        # mints a scoped token, stores the context
Dardcor Code setup-codex                 # ← now uses the remote catalog
Dardcor Code setup-opencode              # ← same
Dardcor Code launch                      # ← Claude Code against the remote
```

See [Remote Mode](./REMOTE-MODE.md) for contexts, scopes, and token management.

---

## Base URL conventions (which tools want `/v1`)

Dardcor Code exposes the OpenAI surface at `/v1`, the Anthropic surface at the root,
and a native Gemini surface at `/v1beta`. Each integration is wired to the form its
tool expects (verified in the command source):

| Integration | Base URL written | `/v1`? |
|-------------|------------------|--------|
| `setup-cline` (`openAiBaseUrl`) | root | No — Cline appends `/v1/chat/completions` |
| `setup-goose` (`OPENAI_HOST`) | root | No — Goose appends the path |
| `setup-aider` (`OPENAI_API_BASE`) | root | No — LiteLLM appends `/v1/chat/completions` |
| `setup-kilo`, `setup-roo`, `setup-continue`, `setup-crush`, `setup-cursor` | with `/v1` | Yes |
| `setup-claude` (`ANTHROPIC_BASE_URL`), `launch` | root | No — Claude Code appends `/v1/messages` |
| `setup-codex`, `launch-codex` (`model_providers.Dardcor Code.base_url`) | with `/v1` | Yes |
| `setup-qwen` (`modelProviders.openai[].baseUrl`) | with `/v1` | Yes |

---

## Keeping native deps on update: `--include=optional`

When you update with `Dardcor Code update` (after confirming, or with `--apply`),
Dardcor Code runs the install with `--include=optional` baked in:

```bash
npm install -g Dardcor Code@latest --include=optional
```

This is **not** a flag you pass to `Dardcor Code update` — it is always applied by the
updater. It guarantees the `optionalDependencies` (`better-sqlite3`, `keytar`,
`tls-client`, the LLMLingua SLM stack) survive the update even if your npm config
has `omit=optional` set, which would otherwise silently drop the native SQLite
driver and OS-keyring binding. To preview the exact command without applying:

```bash
Dardcor Code update --dry-run
# [DRY RUN] Would run: npm install -g Dardcor Code@latest --include=optional
```

Other `Dardcor Code update` flags (verified in source): `--check` (exit 1 if
outdated), `--apply` (install without prompting), `--changelog`, `--no-backup`,
`--yes`.

---

## See also

- [Claude Code configuration](./CLAUDE-CODE-CONFIGURATION.md) — the deeper Claude Code guide
- [Codex CLI configuration](./CODEX-CLI-CONFIGURATION.md) — the one-time `[model_providers.Dardcor Code]` base setup
- [Remote Mode](./REMOTE-MODE.md) — contexts, scoped access tokens, driving a remote server
- [CLI Tools reference](../reference/CLI-TOOLS.md) — the full catalog of supported tools + dashboard pages
- [Setup Guide](./SETUP_GUIDE.md) — install methods and first-run onboarding
