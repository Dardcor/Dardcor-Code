# Docker

Run Dardcor Code in a container. The image is built and run **locally** under the name `dardcor-code`; there is no published remote image.

---

## Quick start

```bash
docker build -t dardcor-code .
docker run -d \
  --name dardcor-code \
  -p 21128:21128 \
  -v "$HOME/.dardcor-code:/app/data" \
  -e DATA_DIR=/app/data \
  dardcor-code
```

App listens on port `21128`. Open: http://localhost:21128

## Manage container

```bash
docker logs -f dardcor-code        # view logs
docker stop dardcor-code           # stop
docker start dardcor-code          # start again
docker rm -f dardcor-code          # remove
```

## Data persistence

```bash
-v "$HOME/.dardcor-code:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.dardcor-code/` (macOS/Linux) or `%APPDATA%\dardcor-code\` (Windows). In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

Host path: `$HOME/.dardcor-code/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

## Optional env vars

```bash
docker run -d \
  --name dardcor-code \
  -p 21128:21128 \
  -v "$HOME/.dardcor-code:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=21128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  dardcor-code
```

## Optional Headroom sidecar

The Dardcor Code image does not bundle Python or Headroom. To use Headroom in Docker, run it as a separate service and point Dardcor Code at that proxy:

```yaml
services:
  dardcor-code:
    image: dardcor-code:latest
    ports:
      - "21128:21128"
    volumes:
      - "$HOME/.dardcor-code:/app/data"
    environment:
      DATA_DIR: /app/data
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
    ports:
      - "8787:8787"
```

In the dashboard, open `Endpoint` → `Token Saver` → `Headroom`, confirm the URL is `http://headroom:8787`, recheck status, then enable Headroom.

If Headroom runs on the Docker host instead of as a sidecar, use `http://host.docker.internal:8787` on macOS/Windows. On Linux, add `--add-host=host.docker.internal:host-gateway` or the equivalent compose `extra_hosts` entry.

## Update to latest

```bash
docker build -t dardcor-code .
docker rm -f dardcor-code
# re-run the quick start command
```

---

# For Developers

## Build image locally (test)

```bash
docker build -t dardcor-code .

docker run --rm -p 21128:21128 \
  -v "$HOME/.dardcor-code:/app/data" \
  -e DATA_DIR=/app/data \
  dardcor-code
```

There is no CI publish step: the image stays local. `docker-compose.yml` at the repo root defines the same `dardcor-code` service (port `21128`, volume `dardcor-code-data`) with an optional Headroom sidecar.
