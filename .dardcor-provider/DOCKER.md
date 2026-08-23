# Docker

Run MiawRouter in a container. The image is built and run **locally** under the name `miawrouter`; there is no published remote image.

---

## Quick start

```bash
docker build -t miawrouter .
docker run -d \
  --name miawrouter \
  -p 21128:21128 \
  -v "$HOME/.miawrouter:/app/data" \
  -e DATA_DIR=/app/data \
  miawrouter
```

App listens on port `21128`. Open: http://localhost:21128

## Manage container

```bash
docker logs -f miawrouter        # view logs
docker stop miawrouter           # stop
docker start miawrouter          # start again
docker rm -f miawrouter          # remove
```

## Data persistence

```bash
-v "$HOME/.miawrouter:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.miawrouter/` (macOS/Linux) or `%APPDATA%\miawrouter\` (Windows). In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

Host path: `$HOME/.miawrouter/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

## Optional env vars

```bash
docker run -d \
  --name miawrouter \
  -p 21128:21128 \
  -v "$HOME/.miawrouter:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=21128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  miawrouter
```

## Optional Headroom sidecar

The MiawRouter image does not bundle Python or Headroom. To use Headroom in Docker, run it as a separate service and point MiawRouter at that proxy:

```yaml
services:
  miawrouter:
    image: miawrouter:latest
    ports:
      - "21128:21128"
    volumes:
      - "$HOME/.miawrouter:/app/data"
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
docker build -t miawrouter .
docker rm -f miawrouter
# re-run the quick start command
```

---

# For Developers

## Build image locally (test)

```bash
docker build -t miawrouter .

docker run --rm -p 21128:21128 \
  -v "$HOME/.miawrouter:/app/data" \
  -e DATA_DIR=/app/data \
  miawrouter
```

There is no CI publish step: the image stays local. `docker-compose.yml` at the repo root defines the same `miawrouter` service (port `21128`, volume `miawrouter-data`) with an optional Headroom sidecar.
