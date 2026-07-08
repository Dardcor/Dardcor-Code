from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set


class StorageScope(Enum):
    """Storage scope like VS Code StorageScope."""
    GLOBAL = "global"          # across all workspaces
    WORKSPACE = "workspace"    # per workspace
    PROFILE = "profile"        # per profile


class StorageTarget(Enum):
    USER = "user"
    MACHINE = "machine"


# ---------------------------------------------------------------------------
# Storage database
# ---------------------------------------------------------------------------

class _StorageDB:
    """SQLite-backed key-value store."""

    def __init__(self, db_path: str):
        self._path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn: Optional[sqlite3.Connection] = None
        self._lock = threading.RLock()
        self._connect()

    def _connect(self) -> None:
        self._conn = sqlite3.connect(
            self._path,
            check_same_thread=False,
            timeout=10,
        )
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS storage (
                key TEXT NOT NULL,
                scope TEXT NOT NULL,
                value TEXT,
                expires_at REAL DEFAULT NULL,
                PRIMARY KEY (key, scope)
            )
        """)
        self._conn.commit()

    def get(self, key: str, scope: str) -> Optional[str]:
        with self._lock:
            try:
                cur = self._conn.execute(
                    "SELECT value, expires_at FROM storage WHERE key=? AND scope=?",
                    (key, scope)
                )
                row = cur.fetchone()
                if row is None:
                    return None
                value, expires_at = row
                if expires_at is not None and time.time() > expires_at:
                    # Expired
                    self._conn.execute(
                        "DELETE FROM storage WHERE key=? AND scope=?", (key, scope)
                    )
                    self._conn.commit()
                    return None
                return value
            except Exception:
                return None

    def set(self, key: str, scope: str, value: str, ttl_seconds: Optional[float] = None) -> None:
        expires_at = time.time() + ttl_seconds if ttl_seconds else None
        with self._lock:
            try:
                self._conn.execute(
                    """
                    INSERT INTO storage (key, scope, value, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key, scope) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at
                    """,
                    (key, scope, value, expires_at)
                )
                self._conn.commit()
            except Exception:
                pass

    def delete(self, key: str, scope: str) -> None:
        with self._lock:
            try:
                self._conn.execute(
                    "DELETE FROM storage WHERE key=? AND scope=?", (key, scope)
                )
                self._conn.commit()
            except Exception:
                pass

    def get_all(self, scope: str) -> Dict[str, str]:
        with self._lock:
            try:
                cur = self._conn.execute(
                    "SELECT key, value, expires_at FROM storage WHERE scope=?", (scope,)
                )
                now = time.time()
                result = {}
                for key, value, expires_at in cur.fetchall():
                    if expires_at is None or now <= expires_at:
                        result[key] = value
                return result
            except Exception:
                return {}

    def keys(self, scope: str) -> List[str]:
        with self._lock:
            try:
                cur = self._conn.execute(
                    "SELECT key FROM storage WHERE scope=? AND (expires_at IS NULL OR expires_at > ?)",
                    (scope, time.time())
                )
                return [row[0] for row in cur.fetchall()]
            except Exception:
                return []

    def clear_scope(self, scope: str) -> None:
        with self._lock:
            try:
                self._conn.execute("DELETE FROM storage WHERE scope=?", (scope,))
                self._conn.commit()
            except Exception:
                pass

    def purge_expired(self) -> int:
        """Remove all expired entries. Returns count removed."""
        with self._lock:
            try:
                cur = self._conn.execute(
                    "DELETE FROM storage WHERE expires_at IS NOT NULL AND expires_at <= ?",
                    (time.time(),)
                )
                self._conn.commit()
                return cur.rowcount
            except Exception:
                return 0

    def close(self) -> None:
        with self._lock:
            if self._conn:
                self._conn.close()
                self._conn = None


# ---------------------------------------------------------------------------
# Storage Service
# ---------------------------------------------------------------------------

class StorageService:
    """
    Persistent key-value storage service.
    Mirrors VS Code IStorageService.
    """

    def __init__(self, global_db_path: str, workspace_db_path: Optional[str] = None):
        self._global_db = _StorageDB(global_db_path)
        self._workspace_db: Optional[_StorageDB] = (
            _StorageDB(workspace_db_path) if workspace_db_path else None
        )
        self._cache: Dict[str, Dict[str, Any]] = {
            StorageScope.GLOBAL.value: {},
            StorageScope.WORKSPACE.value: {},
        }
        self._change_listeners: List[Callable[[StorageScope, str], None]] = []
        self._lock = threading.RLock()

    def _db_for_scope(self, scope: StorageScope) -> _StorageDB:
        if scope == StorageScope.WORKSPACE and self._workspace_db:
            return self._workspace_db
        return self._global_db

    def _scope_key(self, scope: StorageScope) -> str:
        return scope.value

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def get(
        self,
        key: str,
        scope: StorageScope = StorageScope.GLOBAL,
        default: Any = None,
    ) -> Any:
        """Retrieve a value from storage."""
        scope_key = self._scope_key(scope)
        with self._lock:
            if key in self._cache.get(scope_key, {}):
                return self._cache[scope_key][key]

        raw = self._db_for_scope(scope).get(key, scope_key)
        if raw is None:
            return default

        try:
            value = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            value = raw

        with self._lock:
            if scope_key not in self._cache:
                self._cache[scope_key] = {}
            self._cache[scope_key][key] = value

        return value

    def store(
        self,
        key: str,
        value: Any,
        scope: StorageScope = StorageScope.GLOBAL,
        target: StorageTarget = StorageTarget.USER,
        ttl_seconds: Optional[float] = None,
    ) -> None:
        """Store a value persistently."""
        scope_key = self._scope_key(scope)
        raw = json.dumps(value, ensure_ascii=False)

        with self._lock:
            if scope_key not in self._cache:
                self._cache[scope_key] = {}
            self._cache[scope_key][key] = value

        self._db_for_scope(scope).set(key, scope_key, raw, ttl_seconds)
        self._notify_change(scope, key)

    def remove(self, key: str, scope: StorageScope = StorageScope.GLOBAL) -> None:
        """Remove a key from storage."""
        scope_key = self._scope_key(scope)
        with self._lock:
            self._cache.get(scope_key, {}).pop(key, None)

        self._db_for_scope(scope).delete(key, scope_key)
        self._notify_change(scope, key)

    def get_boolean(
        self,
        key: str,
        scope: StorageScope = StorageScope.GLOBAL,
        default: bool = False,
    ) -> bool:
        val = self.get(key, scope, default)
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            return val.lower() in ("true", "1", "yes")
        return bool(val)

    def get_number(
        self,
        key: str,
        scope: StorageScope = StorageScope.GLOBAL,
        default: float = 0.0,
    ) -> float:
        val = self.get(key, scope, default)
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    def get_string(
        self,
        key: str,
        scope: StorageScope = StorageScope.GLOBAL,
        default: str = "",
    ) -> str:
        val = self.get(key, scope, default)
        return str(val) if val is not None else default

    def keys(self, scope: StorageScope = StorageScope.GLOBAL) -> List[str]:
        scope_key = self._scope_key(scope)
        return self._db_for_scope(scope).keys(scope_key)

    def clear(self, scope: StorageScope = StorageScope.GLOBAL) -> None:
        """Clear all keys in a scope."""
        scope_key = self._scope_key(scope)
        with self._lock:
            self._cache[scope_key] = {}
        self._db_for_scope(scope).clear_scope(scope_key)

    def flush(self) -> None:
        """Flush in-memory cache to disk (writes are already immediate)."""
        pass  # Writes are immediate via SQLite

    def switch_workspace(self, workspace_db_path: str) -> None:
        """Switch to a different workspace database."""
        if self._workspace_db:
            self._workspace_db.close()
        self._workspace_db = _StorageDB(workspace_db_path)
        with self._lock:
            self._cache[StorageScope.WORKSPACE.value] = {}

    # ------------------------------------------------------------------
    # Change listeners
    # ------------------------------------------------------------------

    def on_change(self, callback: Callable[[StorageScope, str], None]) -> None:
        self._change_listeners.append(callback)

    def _notify_change(self, scope: StorageScope, key: str) -> None:
        for cb in self._change_listeners:
            try:
                cb(scope, key)
            except Exception:
                pass

    def close(self) -> None:
        self._global_db.close()
        if self._workspace_db:
            self._workspace_db.close()


# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------

_global_storage: Optional[StorageService] = None
_storage_lock = threading.Lock()


def get_storage_service() -> StorageService:
    global _global_storage
    if _global_storage is None:
        with _storage_lock:
            if _global_storage is None:
                from pydardcor.core.config import get_user_data_dir
                data_dir = get_user_data_dir()
                global_db = os.path.join(data_dir, "global_storage.db")
                _global_storage = StorageService(global_db_path=global_db)
    return _global_storage


def reset_storage_service() -> None:
    global _global_storage
    with _storage_lock:
        if _global_storage:
            _global_storage.close()
        _global_storage = None
