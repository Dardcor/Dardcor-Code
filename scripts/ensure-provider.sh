#!/usr/bin/env bash

ROOT="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
PROVIDER_DIR="$ROOT/.dardcor-provider"
PORT="${DARDCOR_PORT:-25000}"
LOG_DIR="$HOME/.dardcor/logs"
PID_FILE="$HOME/.dardcor/provider.pid"

mkdir -p "$LOG_DIR"

is_port_listening() {
	node -e "const s = require('net').createConnection($PORT, '127.0.0.1'); s.on('connect', () => { s.destroy(); process.exit(0); }); s.on('error', () => process.exit(1));" 2>/dev/null
}

if is_port_listening; then
	# Provider already running, no collision
	exit 0
fi

# Clean up stale PID file
if [ -f "$PID_FILE" ]; then
	OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
	if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
		rm -f "$PID_FILE"
	fi
fi

if [ -d "$PROVIDER_DIR" ]; then
	if [ -f "$PROVIDER_DIR/.next/standalone/server.js" ]; then
		(
			cd "$PROVIDER_DIR/.next/standalone"
			nohup env PORT="$PORT" node server.js >> "$LOG_DIR/provider.log" 2>&1 &
			NEW_PID=$!
			disown $NEW_PID 2>/dev/null || true
			echo "$NEW_PID" > "$PID_FILE"
		)
	elif [ -f "$PROVIDER_DIR/custom-server.js" ]; then
		(
			cd "$PROVIDER_DIR"
			nohup env PORT="$PORT" node custom-server.js >> "$LOG_DIR/provider.log" 2>&1 &
			NEW_PID=$!
			disown $NEW_PID 2>/dev/null || true
			echo "$NEW_PID" > "$PID_FILE"
		)
	else
		(
			cd "$PROVIDER_DIR"
			nohup npm run dev -- --port "$PORT" >> "$LOG_DIR/provider.log" 2>&1 &
			NEW_PID=$!
			disown $NEW_PID 2>/dev/null || true
			echo "$NEW_PID" > "$PID_FILE"
		)
	fi

	# Wait briefly for provider to bind port
	for i in {1..15}; do
		if is_port_listening; then
			break
		fi
		sleep 0.3
	done
fi
