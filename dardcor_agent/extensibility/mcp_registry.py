"""MCP server registry — load and manage MCP server definitions from JSON."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class MCPServerDef:
    """Definition for a single MCP server."""

    name: str
    command: Optional[str] = None
    args: list[str] = field(default_factory=list)
    url: Optional[str] = None
    enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"enabled": self.enabled}
        if self.command is not None:
            data["command"] = self.command
        if self.args:
            data["args"] = list(self.args)
        if self.url is not None:
            data["url"] = self.url
        return data

    @classmethod
    def from_dict(cls, name: str, data: dict[str, Any]) -> MCPServerDef:
        return cls(
            name=name,
            command=data.get("command"),
            args=list(data.get("args") or []),
            url=data.get("url"),
            enabled=bool(data.get("enabled", True)),
        )


class MCPRegistry:
    """Registry of MCP servers backed by a JSON config file."""

    def __init__(self, config_path: str | Path) -> None:
        self.config_path = Path(config_path)
        self._servers: dict[str, MCPServerDef] = {}

    def load(self) -> None:
        """Load server definitions from disk. Missing file yields an empty registry."""
        self._servers = {}
        if not self.config_path.is_file():
            return
        try:
            raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        if not isinstance(raw, dict):
            return
        servers = raw.get("servers", raw)
        if not isinstance(servers, dict):
            return
        for name, entry in servers.items():
            if isinstance(name, str) and isinstance(entry, dict):
                self._servers[name] = MCPServerDef.from_dict(name, entry)

    def save(self) -> None:
        """Persist current server definitions to disk."""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"servers": {name: s.to_dict() for name, s in sorted(self._servers.items())}}
        self.config_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def list_servers(self) -> list[MCPServerDef]:
        """Return all servers sorted by name."""
        return [self._servers[k] for k in sorted(self._servers)]

    def get(self, name: str) -> Optional[MCPServerDef]:
        return self._servers.get(name)

    def set_server(self, server: MCPServerDef) -> None:
        self._servers[server.name] = server

    def enable(self, name: str) -> bool:
        server = self._servers.get(name)
        if server is None:
            return False
        server.enabled = True
        return True

    def disable(self, name: str) -> bool:
        server = self._servers.get(name)
        if server is None:
            return False
        server.enabled = False
        return True

    def enabled_servers(self) -> list[MCPServerDef]:
        return [s for s in self.list_servers() if s.enabled]
