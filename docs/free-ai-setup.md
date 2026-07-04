# Free AI Setup for Dardcor Code

How to use **free / subscription-backed** models in Dardcor via legitimate gateways (no token scraping).

---

## Option A — 9Router (recommended for Claude / GPT / Gemini)

9Router is a local OpenAI-compatible proxy. It handles OAuth login to Claude Code, Codex, Antigravity, etc., and routes requests through subscription → cheap → **free** tiers.

### Steps

1. Install and run 9Router locally (see [decolua/9router](https://github.com/decolua/9router)):
   ```bash
   PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
   ```
2. Open the 9Router dashboard → **Providers** → connect **Kiro AI** (free Claude) or **OpenCode Free**.
3. In Dardcor: **Models Dashboard** → provider **9Router (Gateway)** → base URL `http://localhost:20128/v1`.
4. Set env var (optional, from dashboard):
   ```env
   NINEROUTER_API_KEY=your-key-from-dashboard
   ```

### Models (examples)

| Model ID | Description |
|----------|-------------|
| `kr/claude-sonnet-4.5` | Claude via Kiro (free) |
| `auto` | 3-tier fallback (subscription → cheap → free) |

**Indonesian:** Jalankan 9Router di PC, login provider lewat dashboard mereka, lalu pilih **NineRouter** di Dardcor. Gratis Claude/GPT lewat OAuth resmi, bukan curi token.

---

## Option B — OpenCode Zen (no auth)

OpenCode Zen exposes free coding models at a fixed HTTPS endpoint.

1. In Dardcor: **Models Dashboard** → **OpenCode Zen (Free)**.
2. Base URL: `https://opencode.ai/zen/v1` (default in registry).
3. API key usually **not required**; optional:
   ```env
   OPENCODE_ZEN_API_KEY=your-key-here
   ```

### Free models

- `grok-code`, `code-supernova`, `qwen3-coder`, `kimi-k2`, `glm-4.6`, `minimax-m2`, `deepseek-v3.2`

**Indonesian:** Pilih **OpenCode Zen** — tanpa login, langsung pakai model gratis.

---

## Option C — Your own API keys

Copy `.env.example` to `.env` (never commit `.env`) and fill keys for providers you use:

```bash
copy .env.example .env
```

Or use **user data** `secrets.json` (see `database/models/dardcor-secrets.example.json`).

---

## Detect running gateways

Dardcor can check if local gateways are up:

```python
from dardcor_agent.models.providers.gateway import detect_running_gateways
print(detect_running_gateways())  # {'NineRouter': True/False, 'OpenCode': True/False}
```

---

## Security notes

- Do **not** commit `.env` or real API keys to Git.
- Avoid opening untrusted workspaces that ship a malicious `.env` — Dardcor v1 may read workspace env files.
- Prefer keys in user-data `secrets.json` or system env vars over project `.env`.
