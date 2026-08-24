# Dardcor Code

A local AI routing gateway with a built-in dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers, handling format translation, model-combo fallback, multi-account fallback, OAuth and API-key credential management, token refresh, quota and usage tracking, and optional cloud sync.

Dardcor Code runs on your machine. Nothing leaves it unless you point it at a provider.

- **Dashboard**: `http://127.0.0.1:21128/dashboard`
- **API**: `http://127.0.0.1:21128/v1` (OpenAI-compatible)
- **Data directory**: `~/.dardcor-code` (SQLite database, secrets, logs)
- **Runtime port**: `21128` (dev `21127`, updater/status `21129`)

---

## Quick start

### Install globally (CLI)

```bash
npm install -g dardcor-code
dardcor-code
```

The dashboard opens automatically at `http://127.0.0.1:21128/dashboard`.

### Run from source

```bash
cp .env.example .env
npm install
PORT=21128 NEXT_PUBLIC_BASE_URL=http://127.0.0.1:21128 npm run dev
```

Production:

```bash
npm run build
PORT=21128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://127.0.0.1:21128 npm run start
```

### Docker (local image)

```bash
docker build -t dardcor-code .
docker run -d --name dardcor-code -p 21128:21128 \
  -v "$HOME/.dardcor-code:/app/data" -e DATA_DIR=/app/data dardcor-code
```

See [DOCKER.md](DOCKER.md) for details. The image is built and run locally under the name `dardcor-code`; there is no published remote image.

---

## First run

1. Open the dashboard through localhost and create a password. There is **no default password**; `INITIAL_PASSWORD` is an optional local-only bootstrap (see below).
2. Copy the generated API key from the dashboard.
3. Connect providers (OAuth subscription providers, API keys, or free providers) in **Dashboard → Providers**.
4. Point your CLI tool at `http://127.0.0.1:21128/v1` with the dashboard API key.

### Configuring a CLI tool

```
Claude Code / Codex / Cursor / Cline / any OpenAI-compatible tool:
  Base URL:  http://127.0.0.1:21128/v1
  API Key:   [from dashboard → API Keys]
  Model:     cc/claude-opus-4-7   (or any model/combo id)
```

### Migrating from a legacy installation

```bash
dardcor-code migrate --from-9router
```

Reads providers, keys, and combos from a legacy install through its authenticated export API and imports them into Dardcor Code. See `dardcor-code migrate --help`.

---

## Providers and routing

- **40+ providers**, one file per provider in `open-sse/providers/registry/`: OpenAI, Anthropic, Gemini, DeepSeek, Groq, xAI, Mistral, OpenRouter, GLM, Kimi, MiniMax, and more, plus subscription OAuth providers (Claude Code, Codex, GitHub Copilot, Cursor) and free providers (Kiro, OpenCode Free, Vertex).
- **Self-hosted providers**: STT, TTS, and embeddings served from your own machine (whisper.cpp, llama.cpp, vLLM, Kokoro-FastAPI, etc.) via a per-connection `baseUrl`.
- **Format translation** pivots through OpenAI as the intermediate format, with direct routes for fragile pairs (thinking blocks, tool ids, non-base64 images).
- **Combos**: ordered fallback chains you define in the dashboard (`subscription → cheap → free`).
- **Multi-account**: round-robin or priority routing across accounts per provider.
- **Auto token refresh**: OAuth tokens refresh before expiry.

### Response caching (L0–L3)

Dardcor Code includes four fail-open cache layers under `open-sse/cache/`:

- **L0** — prompt-cache orchestration: stable-prefix tracking and breakpoint insertion so token compressors never mutate a prefix a provider has cached.
- **L1** — exact-match response cache: in-memory TTL + bounded LRU keyed by a SHA-256 hash of the normalized request. Deterministic (`temperature=0`/seed-pinned), non-streaming, tool-free requests only.
- **L2** — semantic response cache: reuses responses for semantically similar requests using real embeddings (injected `semanticEmbed` callback hitting the local `/v1/embeddings` route) plus cosine similarity.
- **L3** — content-address dedup: replaces a large block in the mutable last message with a compact reference only when an identical block already exists earlier in the same request context.

Every layer fails open: cache errors never break the request path. Toggle them in Dashboard → Endpoint settings. A request can opt out per call with the `X-Dardcor-Token-Saver: off` header.

---

## Security

Local-first by design. The default posture binds to loopback; only loopback is trusted unless you deliberately expose the service.

- **No default password.** First-run password creation and `INITIAL_PASSWORD` bootstrap both require loopback access.
- **`REQUIRE_API_KEY` defaults on.** Fresh installs require a valid API key on `/v1/*` and `/v1beta/*`, including model catalogs.
- **Generated, persisted 0600 secrets.** `JWT_SECRET`, `API_KEY_SECRET`, and `MACHINE_ID_SALT` default to 32-byte random values persisted under `$DATA_DIR` with mode 0600. Known weak supplied values are rejected at startup.
- **Forwarded-header spoofing blocked.** `custom-server.js` derives the client IP from the TCP socket and strips attacker-controlled `X-Forwarded-For`, trusting forwarding headers only from a loopback reverse proxy.
- **Retained high-risk features** (MITM proxy, OAuth session extraction/import, codex bulk import, quota auto-ping) are preserved but carry real exposure; see [SECURITY.md](SECURITY.md) before enabling them.

See [SECURITY.md](SECURITY.md) for the full threat model.

---

## Environment variables

`DARDCOR_*` names are primary where the runtime defines them; standard `PORT` / `DATA_DIR` / `HOSTNAME` remain as documented. See `.env.example` for the full contract.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `21128` | Service port |
| `DATA_DIR` | `~/.dardcor-code` | Main app data location (SQLite at `$DATA_DIR/db/data.sqlite`) |
| `HOSTNAME` | framework default | Bind host (Docker default `0.0.0.0`) |
| `JWT_SECRET` | auto-generated 0600 file | Dashboard auth cookie signing secret |
| `API_KEY_SECRET` | auto-generated 0600 file | HMAC secret for generated API keys |
| `MACHINE_ID_SALT` | auto-generated 0600 file | Salt for stable machine-ID hashing |
| `INITIAL_PASSWORD` | unset | Optional local-only first-login bootstrap |
| `REQUIRE_API_KEY` | `true` (fresh installs) | Gate `/v1/*` behind a valid API key |
| `BASE_URL` | `http://localhost:21128` | Internal base URL for cloud sync jobs; stays local by default |
| `CLOUD_URL` | `https://dardcor-code.web.id` | Cloud sync endpoint base (config, never a hardcoded remote default for requests) |
| `ENABLE_REQUEST_LOGS` | `false` | Request/response logs under `logs/` |
| `DARDCOR_PROXY_CLIENT_MAX_BODY_SIZE` | `128mb` | Max client body size for the proxy route |
| `DARDCOR_API_KEY` | — | API key the CLI uses when talking to the gateway |

---

## Performance

Token-saver and cache features exist and are enabled through the dashboard, but their effect is not yet measured. Published numbers are intentionally absent: **run [docs/BENCHMARKS.md](docs/BENCHMARKS.md) locally to produce results** for your workload before relying on any claimed savings.

---

## Repository layout

- `src/` — Next.js app: dashboard and `/v1` compat APIs
- `open-sse/` — provider-agnostic routing/translation engine (usable standalone)
- `cli/` — the `dardcor-code` launcher package (install/start/tray, published separately)
- `tests/` — independent vitest suite (not wired into root `npm test`; see CLAUDE.md)
- `docs/` — architecture, audit, security, and migration records

## Origin

This project is a private fork of an upstream open-source routing gateway. The provenance record (source tag, tarball, checksum) lives in [docs/UPSTREAM.md](docs/UPSTREAM.md). License: MIT — see [LICENSE](LICENSE).
