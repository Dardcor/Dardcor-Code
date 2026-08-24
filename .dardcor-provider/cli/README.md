# dardcor-code

CLI launcher for the Dardcor Code local AI routing gateway and dashboard.

`dardcor-code` installs, starts, and manages the Dardcor Code server locally. The server exposes one OpenAI-compatible endpoint (`/v1`) and a dashboard, and routes requests across 40+ upstream providers with format translation, fallback, credential management, quota tracking, and token refresh.

---

## Install

```bash
npm install -g dardcor-code
```

Or run directly:

```bash
npx dardcor-code
```

## Start

```bash
dardcor-code
```

- Dashboard: `http://127.0.0.1:21128/dashboard`
- API: `http://127.0.0.1:21128/v1`
- Data directory: `~/.dardcor-code`

### CLI options

```bash
dardcor-code                    # start with default settings
dardcor-code --port 8080        # custom port
dardcor-code --no-browser       # don't open the browser
dardcor-code --log              # show server logs
dardcor-code --tray             # run in system tray mode
dardcor-code --skip-update      # skip the auto-update check
dardcor-code --help             # show all options
```

### Migrate from a legacy installation

```bash
dardcor-code migrate --from-9router
```

Reads providers, keys, and combos from a legacy install through its authenticated export API and imports them into the running Dardcor Code gateway. See `dardcor-code migrate --help`.

---

## Point a CLI tool at Dardcor Code

```
Claude Code / Codex / Cursor / Cline / any OpenAI-compatible tool:
  Endpoint: http://127.0.0.1:21128/v1
  API Key:  [from the dashboard → API Keys]
  Model:    cc/claude-opus-4-7   (or any model/combo id)
```

Any tool that supports an OpenAI- or Claude-compatible API works.

---

## Data location

- **macOS/Linux**: `~/.dardcor-code` (SQLite at `~/.dardcor-code/db/data.sqlite`)
- **Windows**: `%APPDATA%\dardcor-code`
- **Docker**: `/app/data` (mount `~/.dardcor-code` to persist)

---

## Documentation

- [Full README](../README.md)
- [Docker guide](../DOCKER.md)
- [Security policy](../SECURITY.md)

## License

MIT — see [LICENSE](LICENSE).
