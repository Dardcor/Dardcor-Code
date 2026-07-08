"""
URI Identity Service — TASK-0014
==================================
Canonical URI untuk file dan resource.
Mirip VS Code: src/vs/base/common/uri.ts
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import quote, unquote, urlparse, urlunparse


IS_WINDOWS = sys.platform == "win32"


class URI:
    """
    Immutable URI representation.
    Mirrors VS Code's URI class with scheme/authority/path/query/fragment.
    """

    __slots__ = ("_scheme", "_authority", "_path", "_query", "_fragment", "_str")

    def __init__(
        self,
        scheme: str = "file",
        authority: str = "",
        path: str = "",
        query: str = "",
        fragment: str = "",
    ):
        self._scheme = scheme.lower() if scheme else "file"
        self._authority = authority or ""
        self._path = self._normalize_path(path, scheme)
        self._query = query or ""
        self._fragment = fragment or ""
        self._str: Optional[str] = None

    @staticmethod
    def _normalize_path(path: str, scheme: str) -> str:
        if not path:
            return ""
        # Normalize backslashes on Windows for file URIs
        if scheme == "file" and IS_WINDOWS:
            path = path.replace("\\", "/")
        # Ensure file paths start with /
        if scheme == "file" and path and not path.startswith("/"):
            path = "/" + path
        return path

    @classmethod
    def file(cls, fs_path: str) -> "URI":
        """Create a file:// URI from a filesystem path."""
        fs_path = os.path.abspath(fs_path)
        if IS_WINDOWS:
            # Windows: C:\path → /c:/path
            fs_path = fs_path.replace("\\", "/")
            if fs_path[1] == ":":
                fs_path = "/" + fs_path[0].lower() + fs_path[1:]
        encoded = quote(fs_path, safe="/:")
        return cls(scheme="file", path=encoded)

    @classmethod
    def parse(cls, uri_str: str) -> "URI":
        """Parse a URI string into a URI object."""
        if not uri_str:
            return cls()
        parsed = urlparse(uri_str)
        return cls(
            scheme=parsed.scheme or "file",
            authority=parsed.netloc or "",
            path=unquote(parsed.path or ""),
            query=parsed.query or "",
            fragment=parsed.fragment or "",
        )

    @classmethod
    def from_components(
        cls,
        *,
        scheme: str = "file",
        authority: str = "",
        path: str = "",
        query: str = "",
        fragment: str = "",
    ) -> "URI":
        return cls(scheme, authority, path, query, fragment)

    @property
    def scheme(self) -> str:
        return self._scheme

    @property
    def authority(self) -> str:
        return self._authority

    @property
    def path(self) -> str:
        return self._path

    @property
    def query(self) -> str:
        return self._query

    @property
    def fragment(self) -> str:
        return self._fragment

    @property
    def fs_path(self) -> str:
        """Return the filesystem path (Windows-aware)."""
        path = unquote(self._path)
        if IS_WINDOWS and len(path) >= 3 and path[0] == "/" and path[2] == ":":
            path = path[1:]  # remove leading /
            path = path.replace("/", "\\")
        return path

    @property
    def ext(self) -> str:
        """Return file extension (e.g. '.py')."""
        return os.path.splitext(self._path)[1]

    @property
    def basename(self) -> str:
        """Return the base name of the path."""
        return os.path.basename(unquote(self._path))

    @property
    def dirname(self) -> str:
        """Return the directory part as a URI string."""
        return os.path.dirname(self._path)

    def with_path(self, new_path: str) -> "URI":
        return URI(self._scheme, self._authority, new_path, self._query, self._fragment)

    def with_fragment(self, fragment: str) -> "URI":
        return URI(self._scheme, self._authority, self._path, self._query, fragment)

    def with_query(self, query: str) -> "URI":
        return URI(self._scheme, self._authority, self._path, query, self._fragment)

    def __str__(self) -> str:
        if self._str is None:
            parts = [self._scheme, "://"]
            if self._authority:
                parts.append(self._authority)
            parts.append(quote(self._path, safe="/:@!$&'()*+,;="))
            if self._query:
                parts.append("?" + self._query)
            if self._fragment:
                parts.append("#" + self._fragment)
            self._str = "".join(parts)
        return self._str

    def __repr__(self) -> str:
        return f"URI({str(self)!r})"

    def __eq__(self, other: object) -> bool:
        if isinstance(other, URI):
            return str(self) == str(other)
        if isinstance(other, str):
            return str(self) == other
        return False

    def __hash__(self) -> int:
        return hash(str(self))

    def is_file(self) -> bool:
        return self._scheme == "file"

    def is_untitled(self) -> bool:
        return self._scheme == "untitled"

    def to_json(self) -> dict:
        return {
            "scheme": self._scheme,
            "authority": self._authority,
            "path": self._path,
            "query": self._query,
            "fragment": self._fragment,
        }

    @classmethod
    def from_json(cls, data: dict) -> "URI":
        return cls(**{k: data.get(k, "") for k in ("scheme", "authority", "path", "query", "fragment")})


class URIService:
    """
    URI utility service for canonical path resolution.
    """

    def __init__(self):
        self._canonical_cache: dict = {}

    def canonicalize(self, path_or_uri: str) -> URI:
        """Return a canonical URI for a path."""
        if path_or_uri in self._canonical_cache:
            return self._canonical_cache[path_or_uri]

        if "://" in path_or_uri:
            uri = URI.parse(path_or_uri)
        else:
            uri = URI.file(path_or_uri)

        self._canonical_cache[path_or_uri] = uri
        return uri

    def equals(self, a: str, b: str) -> bool:
        """Check if two paths/URIs refer to the same resource."""
        return self.canonicalize(a) == self.canonicalize(b)

    def relative(self, from_uri: URI, to_uri: URI) -> str:
        """Return relative path from one URI to another."""
        from_path = Path(unquote(from_uri.path))
        to_path = Path(unquote(to_uri.path))
        try:
            return str(to_path.relative_to(from_path))
        except ValueError:
            return str(to_uri)


# Global singleton
_uri_service: Optional[URIService] = None


def get_uri_service() -> URIService:
    global _uri_service
    if _uri_service is None:
        _uri_service = URIService()
    return _uri_service
