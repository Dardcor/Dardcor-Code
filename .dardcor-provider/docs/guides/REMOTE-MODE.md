---
title: "Remote Mode — Drive a remote Dardcor Code from your laptop"
version: 3.8.40
lastUpdated: 2026-06-28
---

# Remote Mode

Run the `Dardcor Code` CLI on your laptop while Dardcor Code itself runs somewhere else
(a VPS, a home server, another machine on your Tailnet). You log in once with
`Dardcor Code connect`, and from then on **every** CLI command targets that remote
server — same commands, same output, just executed against the remote.

There is no second tool to install: remote mode is the regular `Dardcor Code` CLI
plus scoped **access tokens**.

```bash
npm install -g Dardcor Code                 # the normal CLI
Dardcor Code connect 192.168.0.15           # log in (password → scoped token)
Dardcor Code models list                    # ← now lists the REMOTE server's models
Dardcor Code configure codex                # ← writes a local Codex profile from the remote catalog
```

---

## How it works

```
your laptop                              remote Dardcor Code (VPS)
┌────────────────────┐                   ┌───────────────────────────────┐
│ Dardcor Code CLI      │  POST /api/cli/connect  (password → token)         │
│  context: vps      │ ───────────────►  │ mints a scoped access token    │
│  baseUrl, token    │  Authorization: Bearer oma_live_…                  │
│                    │ ───────────────►  │ every management route, scope- │
│ writes configs     │ ◄───────────────  │ checked per the token's scope  │
│ LOCALLY            │                   └───────────────────────────────┘
└────────────────────┘
```

- **Contexts** store one server each (`~/.Dardcor Code/config.json`, `chmod 600`).
  `Dardcor Code contexts use <name>` switches the active server; `default` is local.
- **Access tokens** (`oma_live_…`) authorize management commands. They are
  distinct from inference API keys (`sk-…`, used for `/v1/chat/completions`).
- Only the SHA-256 hash of a token is stored server-side. The plaintext is shown
  **once**, at creation.

---

## Connecting

### With the management password (bootstrap)

```bash
Dardcor Code connect 192.168.0.15
# Management password for http://192.168.0.15:20128: ********
# ✔ Connected to http://192.168.0.15:20128 — context '192.168.0.15' (scope: admin)
```

The password flow mints an **admin** token by default (you hold the password, so
you already have full control). Downscope with `--scope`:

```bash
Dardcor Code connect 192.168.0.15 --scope write
```

Options: `--port <p>` (when the host has none), `--name <ctx>` (context name),
`--scope read|write|admin`. A full URL is honoured as-is:
`Dardcor Code connect https://omni.example.com`.

### With a pre-generated token

Generate a scoped token in the dashboard (or with `Dardcor Code tokens create`) and
paste it — no password needed:

```bash
Dardcor Code connect 192.168.0.15 --key oma_live_xxxxxxxx
```

The CLI validates it via `GET /api/cli/whoami` and saves it as the active context.

---

## Scopes

Three levels, hierarchical (`admin ⊃ write ⊃ read`):

| Scope   | Can do                                                                       |
| ------- | ---------------------------------------------------------------------------- |
| `read`  | list/inspect — `models list`, `providers status`, `logs`, `usage`, `cost`    |
| `write` | read **+** configure/apply — `setup-codex`, `keys add`, `config set`, combos |
| `admin` | write **+** manage — `tokens` CRUD, add providers, services, policy, oauth   |

The server infers the scope each route requires from the HTTP method
(`GET`→read, mutations→write) plus an admin allowlist for sensitive surfaces
(`/api/cli/tokens`, `/api/providers` mutations, `/api/oauth`, `/api/services`, …).
A token with insufficient scope gets `403` with a clear message.

> Routes that spawn processes (`/api/services/*`, `/api/mcp/*`, …) stay
> **loopback-only** — a remote token can never reach them, regardless of scope.

---

## Connecting Antigravity on a remote install

Antigravity uses Google's firstparty/nativeapp consent screen. Google only
releases the authorization code when the **loopback redirect**
(`http://127.0.0.1:<port>/callback`) is **reachable from the browser that
approves the sign-in**. On a remote VPS install that loopback lives on the
server, not on your machine, so the consent screen **hangs forever and never
emits a code** — the normal "paste the callback URL" fallback has nothing to
paste. (This is a Google-side constraint: the same hang happens in any proxy
that uses the bundled Antigravity desktop client, not just Dardcor Code.)

The dashboard detects this before you get stuck: opening **Providers → Antigravity →
Connect** from a non-localhost address replaces the generic "copy the callback URL"
notice with the two remedies below, each with your host and port already filled in.
(A LAN address counts — `192.168.x.x` is not localhost as far as this callback is
concerned.)

There are two supported ways to connect Antigravity to a remote Dardcor Code.

### Option A — local login helper (recommended)

Run the OAuth on **your own computer**, where `127.0.0.1` is reachable. The helper
talks to Google directly, so the consent completes where the dashboard's version
cannot.

**If you are already connected** (`Dardcor Code connect <host>`), there is nothing to
copy — the helper delivers the credential to that install for you:

```bash
# On your LOCAL machine (needs Node.js + a browser):
Dardcor Code connect 192.168.0.15        # once — mints an admin-scoped context token
npx Dardcor Code login antigravity
#   ↳ opens the Google consent, captures the callback on a local loopback port,
#     exchanges it, and POSTs the credential to the active context:
#
#   Antigravity connected on http://192.168.0.15:20128 (connection abc123).
#   Nothing to paste — you can close this terminal.
```

The push happens automatically whenever the active context points at another
machine. Force it either way with `--push` / `--no-push`, or aim at a specific
context with `--context <name>`.

**If your machine cannot reach the VPS** (firewalled, no SSH, air-gapped desk), the
helper still works — it only ever _needs_ Google. Use `--no-push`, or just let the
push fail: it falls back to printing the blob rather than discarding an
authorization you already completed.

```bash
npx Dardcor Code login antigravity --no-push
#   Dardcor Code-cred-v1.eyJ2IjoxLCJ...
```

Then, in the **remote** dashboard: **Providers → Antigravity → Connect**, and paste
the `Dardcor Code-cred-v1.…` blob into the **Step 2** field (it accepts either a
callback URL or a credential blob). Dardcor Code decodes it, runs the Cloud Code
onboarding server-side, and persists the connection.

> The blob contains a refresh token — treat it like a password. On the push path it
> is sent once over your context's authenticated connection; on the paste path, over
> your dashboard connection. Either way it is stored encrypted at rest, and a
> successful push never prints it to your terminal.

Flags: `--no-browser` (print the URL instead of auto-opening), `--port <n>`
(pin the loopback port), `--timeout <ms>`, `--push` / `--no-push` (override the
automatic delivery), `--context <name>` (target a specific context).

### Option B — SSH local-forward tunnel

If you have SSH access to the VPS, forward the dashboard port so that the
loopback callback resolves back to the server through the tunnel:

```bash
# On your LOCAL machine:
ssh -L 20128:127.0.0.1:20128 user@your-vps
# then open http://localhost:20128 in your LOCAL browser and connect Antigravity
# normally — the 127.0.0.1:20128/callback redirect now reaches the VPS via SSH.
```

Because you reach the dashboard as `localhost:20128`, the Google consent
completes and the callback is delivered to the server through the same tunnel —
no blob needed. Keep the tunnel open until the connection shows as active.

Unlike the fixed-loopback providers below, **one forward is enough** here: the
Antigravity callback rides the dashboard port itself, so there is no second
provider-specific port to tunnel.

> A fully headless alternative (no helper, no tunnel) is to configure your **own**
> Google OAuth web credentials + a public base URL; see the provider's OAuth
> environment variables. The two options above need no extra Google setup.

---

## Connecting Codex / Grok on a remote install (fixed-loopback providers)

Codex, xAI (`xai-oauth`) and Grok CLI (`grok-cli`) register a **fixed** loopback
`redirect_uri` with their upstream OAuth app. Dardcor Code cannot change it — the
provider always sends the browser back to the same hardcoded address:

| Provider    | Fixed callback the provider redirects to |
| ----------- | ---------------------------------------- |
| `codex`     | `http://localhost:1455/auth/callback`    |
| `xai-oauth` | `http://127.0.0.1:56121/callback`        |
| `grok-cli`  | `http://127.0.0.1:56122/callback`        |

`localhost` there means **the machine running the browser**, while Dardcor Code's PKCE
callback server listens on the **server's** loopback. Open the dashboard at a LAN
address like `http://192.168.0.15:20128` and the two never meet: the authorization
code is delivered to your own laptop's `localhost:1455`, where nothing is listening,
and the provider fails the sign-in without surfacing an error.

The dashboard detects this before opening the popup and shows the tunnel command
instead of letting the login fail silently (#8046).

### Fix — forward **both** ports

```bash
# On the machine running the BROWSER:
ssh -L 20128:127.0.0.1:20128 -L 1455:127.0.0.1:1455 <user>@192.168.0.15
# then browse to http://localhost:20128 and connect Codex from there
```

Two forwards are required, and forwarding only one still fails:

- **`20128`** (the dashboard port) makes the origin true-localhost, which is what
  makes Dardcor Code start the PKCE callback server at all — a LAN origin never
  reaches that branch.
- **`1455`** (the provider's fixed callback port) is where the browser is sent back
  to; it has to tunnel through to the server's loopback.

Swap `1455` for `56121`/`56122` when connecting xAI or Grok CLI, and `20128` for
your actual dashboard port. Keep the tunnel open until the connection shows as
active.

> **No SSH access?** Codex and Grok CLI also accept a pasted token — the **Paste API
> Key** / **Import auth.json** tab on the connect dialog. That path has no loopback
> callback, so it works from any origin. Codex additionally accepts a bare access
> token or a `~/.codex/auth.json` session blob.

---

## Managing tokens

```bash
Dardcor Code tokens create --name "laptop" --scope write [--expires 30]
#   ↳ prints the secret ONCE — copy it now
Dardcor Code tokens list                 # masked: id, name, scope, prefix, status, expiry
Dardcor Code tokens revoke <id|prefix>   # revoke immediately
Dardcor Code tokens scopes               # explain the three scopes
```

`tokens` commands require an **admin** credential. You can also manage tokens in
the dashboard under **Settings → Access Tokens** (create, revoke, copy-once).

---

## Configuring a coding CLI from the remote catalog

`Dardcor Code configure` reads the **active server's** live model catalog and writes
a config on **your** machine.

```bash
Dardcor Code configure codex
#   Providers: glm, kmc, ollamacloud, opencode-go, …
#   Provider: glm
#   Model id: glm/glm-5.2
#   ✔ Wrote ~/.codex/glm52.config.toml
#   Use it:  codex --profile glm52

# non-interactive
Dardcor Code configure codex --provider glm --model glm/glm-5.2 --name glm52
```

The written profile references the inference key by env var
(`OMNIROUTE_API_KEY`) — the secret is never written to disk. For the one-time
base Codex setup (the `[model_providers.Dardcor Code]` block), see
[CODEX-CLI-CONFIGURATION.md](./CODEX-CLI-CONFIGURATION.md).

### Per-CLI setup commands

Each supported CLI has a remote-aware setup command (all honour the active
context, or `--remote <url> --api-key <key>`):

| CLI         | Command                    | What it writes                                                                                                                                                       |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | `Dardcor Code setup-codex`    | `~/.codex/<name>.config.toml` profiles (per model)                                                                                                                   |
| Claude Code | `Dardcor Code setup-claude`   | `~/.claude/profiles/<name>/settings.json` (per model)                                                                                                                |
| OpenCode    | `Dardcor Code setup-opencode` | `~/.config/opencode/opencode.json` — the `Dardcor Code` openai-compatible provider with every catalog model (run `opencode -m Dardcor Code/<model>`)                       |
| Cline       | `Dardcor Code setup-cline`    | `~/.cline/data/{globalState,secrets}.json` (CLI mode) + prints the VS Code extension settings to paste (OpenAI-compatible, Base URL **without** `/v1`)               |
| Kilo Code   | `Dardcor Code setup-kilo`     | `~/.local/share/kilo/auth.json` (CLI) + VS Code `kilocode.*` settings — OpenAI-compatible, Base URL **with** `/v1`                                                   |
| Continue    | `Dardcor Code setup-continue` | `~/.continue/config.yaml` (VS Code/JetBrains + `cn` CLI) — `provider: openai`, `apiBase` **with** `/v1`, key via `${{ secrets.OMNIROUTE_API_KEY }}`                  |
| Cursor      | `Dardcor Code setup-cursor`   | prints the in-app steps (Settings → Models → Override OpenAI Base URL **with** `/v1` + key + model). Cursor config is opaque SQLite — chat panel only                |
| Roo Code    | `Dardcor Code setup-roo`      | writes a Roo import JSON (`~/.Dardcor Code/roo-settings.json`) + sets `roo-cline.autoImportSettingsPath` + prints UI steps (OpenAI-compatible, Base URL **with** `/v1`) |
| Crush       | `Dardcor Code setup-crush`    | `~/.config/crush/crush.json` — `openai-compat` provider, `base_url` **with** `/v1`, key via `$OMNIROUTE_API_KEY`                                                     |
| Goose       | `Dardcor Code setup-goose`    | `~/.config/goose/config.yaml` (`GOOSE_PROVIDER=openai` + `OPENAI_HOST` **without** `/v1` + `GOOSE_MODEL`) + env recipe                                               |
| Aider       | `Dardcor Code setup-aider`    | `~/.aider.conf.yml` (`openai-api-base` **without** `/v1` + `model: openai/<id>`) + env recipe (`aider --message --yes`)                                              |
| Qwen Code   | `Dardcor Code setup-qwen`     | `~/.qwen/settings.json` V4 `modelProviders.openai` entry + `OMNIROUTE_API_KEY` in `~/.qwen/.env`                                                                     |

```bash
# OpenCode (openai-compatible provider, all catalog models, remote VPS)
Dardcor Code setup-opencode --remote http://192.168.0.15:20128 --api-key oma_live_xxx
Dardcor Code setup-opencode --only glm,kimi        # keep only matching models
opencode -m Dardcor Code/glm/glm-5.2 "..."          # export OMNIROUTE_API_KEY first
```

> OpenCode also has a richer **plugin** integration: `Dardcor Code setup opencode`
> (now remote-aware via `--remote`) installs `@Dardcor Code/opencode-plugin`.
> `setup-opencode` is the lightweight openai-compatible alternative. The API key
> is referenced via `{env:OMNIROUTE_API_KEY}` — never written to disk.

---

## Managing contexts (switch between servers)

A **context** is a saved server (baseUrl + credential + scope). `Dardcor Code connect`
creates one and makes it active; from then on every command targets it. Manage and
switch between them with `Dardcor Code contexts`:

```bash
Dardcor Code contexts list            # all contexts; the active one is marked ●
Dardcor Code contexts current         # the active server, auth status, scope
```

```text
  | Name    | Base URL                  | Auth  | Scope | Description
● | vps     | http://100.67.86.91:20128 | token | admin | Remote Dardcor Code (…)
  | default | http://localhost:20128    | ✗     |       |
```

**Switch servers** — every subsequent command follows the active context:

```bash
Dardcor Code contexts use vps         # → all commands now hit the remote VPS
Dardcor Code tokens list              #   (runs against the VPS)

Dardcor Code contexts use default     # → back to localhost
Dardcor Code tokens list              #   (runs against the local server)
```

**Add a context manually** (instead of `connect`), inspect, or rename:

```bash
Dardcor Code contexts add staging --url https://staging.example.com:20128 \
  --access-token oma_live_xxxx --scope write --description "staging box"
Dardcor Code contexts show staging    # full details for one context
Dardcor Code contexts rename staging stg
```

**Remove a context** — prompts for confirmation; pass `--yes` to skip it
(required for scripts / non-interactive shells, which otherwise decline safely):

```bash
Dardcor Code contexts remove stg --yes
```

> `default` (localhost) cannot be removed. Removing the active context falls back
> to `default`. Tip: removing a context only drops the **local** saved credential —
> revoke the token on the server with `Dardcor Code tokens revoke <id>` to actually
> kill access.

**Export / import** contexts (e.g. to move them between machines — secrets included,
so handle the file carefully):

```bash
Dardcor Code contexts export --out contexts.json     # default: stdout
Dardcor Code contexts import contexts.json            # overwrite; --merge to keep existing
```

---

## Quick end-to-end check

A copy-paste lifecycle to verify a remote setup from scratch — connect, mint a
scoped token, route a command, switch back, and tear down. Replace
`192.168.0.15` with your server's host/IP (Tailscale, LAN, or a public
`https://…` URL).

```bash
# 1. Connect (password → admin token, saved as a context that becomes active)
Dardcor Code connect 192.168.0.15                 # or: --key oma_live_xxxx  (no password)
Dardcor Code contexts current                     # shows the remote server + scope

# 2. Use it — management commands now run against the remote
Dardcor Code tokens create --name laptop --scope read   # mint a narrower token
Dardcor Code tokens list                                 # masked list, from the remote

# 3. Switch back and forth
Dardcor Code contexts use default                 # → local
Dardcor Code contexts use 192-168-0-15            # → remote again (name from `contexts list`)

# 4. Tear down. NOTE: `contexts remove` only deletes the LOCAL credential —
#    it does NOT revoke the token on the server. Revoke server-side first if you
#    want to actually kill access.
Dardcor Code tokens revoke <id|prefix>            # kills access on the server
Dardcor Code contexts remove 192-168-0-15 --yes   # drop the local context (even if active → falls back to default), no prompt
```

> `--yes` makes `contexts remove` non-interactive (required in scripts/CI; without
> it, a non-interactive shell declines safely instead of hanging). Removing the
> **active** context falls back to `default` automatically.

---

## Security notes

- Token plaintext is shown once; only the SHA-256 hash is persisted (same as API keys).
- `Dardcor Code connect` reuses the login brute-force lockout + audit logging.
- Prefer HTTPS or a Tailnet for the transport; a bare host defaults to `http://`
  for LAN/Tailscale convenience — pass a full `https://…` URL for TLS.
- The local context file is `~/.Dardcor Code/config.json` (`chmod 600`); tokens are
  never printed in logs (masked to a prefix).

---

## API endpoints (reference)

| Method | Route                 | Auth                | Scope                      |
| ------ | --------------------- | ------------------- | -------------------------- |
| POST   | `/api/cli/connect`    | management password | — (public, password-gated) |
| GET    | `/api/cli/whoami`     | access token        | read                       |
| GET    | `/api/cli/tokens`     | access token        | admin                      |
| POST   | `/api/cli/tokens`     | access token        | admin                      |
| DELETE | `/api/cli/tokens/:id` | access token        | admin                      |

See [openapi.yaml](../openapi.yaml) for full schemas.
