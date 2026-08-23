# miawrouter

CLI launcher for the MiawRouter local AI routing gateway and dashboard.

`miawrouter` installs, starts, and manages the MiawRouter server locally. The server exposes one OpenAI-compatible endpoint (`/v1`) and a dashboard, and routes requests across 40+ upstream providers with format translation, fallback, credential management, quota tracking, and token refresh.

---

## Install

```bash
npm install -g miawrouter
```

Or run directly:

```bash
npx miawrouter
```

## Start

```bash
miawrouter
```

- Dashboard: `http://127.0.0.1:21128/dashboard`
- API: `http://127.0.0.1:21128/v1`
- Data directory: `~/.miawrouter`

### CLI options

```bash
miawrouter                    # start with default settings
miawrouter --port 8080        # custom port
miawrouter --no-browser       # don't open the browser
miawrouter --log              # show server logs
miawrouter --tray             # run in system tray mode
miawrouter --skip-update      # skip the auto-update check
miawrouter --help             # show all options
```

### Migrate from a legacy installation

```bash
miawrouter migrate --from-9router
```

Reads providers, keys, and combos from a legacy install through its authenticated export API and imports them into the running MiawRouter gateway. See `miawrouter migrate --help`.

---

## Point a CLI tool at MiawRouter

```
Claude Code / Codex / Cursor / Cline / any OpenAI-compatible tool:
  Endpoint: http://127.0.0.1:21128/v1
  API Key:  [from the dashboard → API Keys]
  Model:    cc/claude-opus-4-7   (or any model/combo id)
```

Any tool that supports an OpenAI- or Claude-compatible API works.

---

## Data location

- **macOS/Linux**: `~/.miawrouter` (SQLite at `~/.miawrouter/db/data.sqlite`)
- **Windows**: `%APPDATA%\miawrouter`
- **Docker**: `/app/data` (mount `~/.miawrouter` to persist)

---

## Documentation

- [Full README](../README.md)
- [Docker guide](../DOCKER.md)
- [Security policy](../SECURITY.md)

## License

MIT — see [LICENSE](LICENSE).
