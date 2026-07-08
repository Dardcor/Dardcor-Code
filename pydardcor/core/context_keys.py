"""
Context Key Engine — TASK-0004
==============================
Full `when` clause evaluator yang meniru VS Code:
  src/vs/platform/contextkey/common/contextkey.ts
  src/vs/platform/contextkey/common/contextKeyExpr.ts
  src/vs/platform/contextkey/browser/contextKeyService.ts

Mendukung semua operator VS Code:
  - Bare key:          editorFocus
  - Negation:          !editorFocus
  - Equality:          resourceLangId == 'python'
  - In-equality:       config.tabSize != 4
  - Greater/Less:      lineCount > 100
  - Regex match:       resourceFilename =~ /\\.py$/
  - In set:            resourceLangId in supportedLangs
  - Not in set:        resourceLangId not in unsupportedLangs
  - AND:               editorFocus && editorTextFocus
  - OR:                inDebugMode || inRunningSession
  - Parentheses:       (a && b) || c
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set


# ---------------------------------------------------------------------------
# Token types for the when-clause parser
# ---------------------------------------------------------------------------

_TK_KEY = "KEY"
_TK_NOT = "NOT"
_TK_EQ = "EQ"
_TK_NEQ = "NEQ"
_TK_GT = "GT"
_TK_GTE = "GTE"
_TK_LT = "LT"
_TK_LTE = "LTE"
_TK_REGEX = "REGEX"
_TK_IN = "IN"
_TK_NOT_IN = "NOT_IN"
_TK_AND = "AND"
_TK_OR = "OR"
_TK_LPAREN = "LPAREN"
_TK_RPAREN = "RPAREN"
_TK_VALUE = "VALUE"
_TK_EOF = "EOF"


@dataclass
class _Token:
    type: str
    value: str = ""


# ---------------------------------------------------------------------------
# Lexer
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(
    r"""
    \s+                             # whitespace (skip)
    | (not\s+in)                   # not in
    | (!=)                         # !=
    | (==)                         # ==
    | (>=)                         # >=
    | (<=)                         # <=
    | (>)                          # >
    | (<)                          # <
    | (=~)                         # =~ regex
    | (&&)                         # AND
    | (\|\|)                       # OR
    | (!)                          # NOT
    | (\()                         # (
    | (\))                         # )
    | ('(?:[^'\\\\]|\\\\.)*')      # single-quoted string
    | ("(?:[^"\\\\]|\\\\.)*")      # double-quoted string
    | (/(?:[^/\\\\]|\\\\.)+/)      # regex literal /pattern/
    | ([A-Za-z_][A-Za-z0-9_.]*)   # identifier / key
    | ([0-9]+(?:\.[0-9]+)?)        # number
    """,
    re.VERBOSE,
)


def _tokenize(expr: str) -> List[_Token]:
    tokens: List[_Token] = []
    pos = 0
    n = len(expr)

    while pos < n:
        m = _TOKEN_RE.match(expr, pos)
        if m is None:
            pos += 1  # skip unknown char
            continue
        matched = m.group(0)
        if matched.strip() == "":
            pos = m.end()
            continue

        stripped = matched.strip()

        if stripped == "&&":
            tokens.append(_Token(_TK_AND))
        elif stripped == "||":
            tokens.append(_Token(_TK_OR))
        elif stripped == "!":
            tokens.append(_Token(_TK_NOT))
        elif stripped in ("!=",):
            tokens.append(_Token(_TK_NEQ))
        elif stripped in ("==",):
            tokens.append(_Token(_TK_EQ))
        elif stripped == ">=":
            tokens.append(_Token(_TK_GTE))
        elif stripped == "<=":
            tokens.append(_Token(_TK_LTE))
        elif stripped == ">":
            tokens.append(_Token(_TK_GT))
        elif stripped == "<":
            tokens.append(_Token(_TK_LT))
        elif stripped == "=~":
            tokens.append(_Token(_TK_REGEX))
        elif stripped == "(":
            tokens.append(_Token(_TK_LPAREN))
        elif stripped == ")":
            tokens.append(_Token(_TK_RPAREN))
        elif stripped.startswith("not") and "in" in stripped:
            tokens.append(_Token(_TK_NOT_IN))
        elif stripped == "in":
            tokens.append(_Token(_TK_IN))
        elif stripped.startswith("/") and stripped.endswith("/"):
            # Regex literal
            tokens.append(_Token(_TK_VALUE, stripped[1:-1]))
        elif stripped.startswith(("'", '"')):
            # Quoted string
            tokens.append(_Token(_TK_VALUE, stripped[1:-1]))
        else:
            # identifier or number — may be 'in' keyword
            if stripped == "in":
                tokens.append(_Token(_TK_IN))
            else:
                # Could be a key or a plain value
                tokens.append(_Token(_TK_KEY, stripped))

        pos = m.end()

    tokens.append(_Token(_TK_EOF))
    return tokens


# ---------------------------------------------------------------------------
# AST nodes
# ---------------------------------------------------------------------------

class _Expr:
    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        raise NotImplementedError


@dataclass
class _BareKey(_Expr):
    key: str

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        val = ctx.get(self.key)
        if val is None or val == "" or val is False or val == 0:
            return False
        return True


@dataclass
class _NotExpr(_Expr):
    operand: _Expr

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        return not self.operand.evaluate(ctx)


@dataclass
class _CmpExpr(_Expr):
    key: str
    op: str
    value: Any

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        lhs = ctx.get(self.key)
        rhs = self.value

        # Try numeric comparison
        try:
            lhs_n = float(lhs) if lhs is not None else None
            rhs_n = float(rhs)
            if lhs_n is None:
                return False
            if self.op == "==":
                return lhs_n == rhs_n
            if self.op == "!=":
                return lhs_n != rhs_n
            if self.op == ">":
                return lhs_n > rhs_n
            if self.op == ">=":
                return lhs_n >= rhs_n
            if self.op == "<":
                return lhs_n < rhs_n
            if self.op == "<=":
                return lhs_n <= rhs_n
        except (TypeError, ValueError):
            pass

        # String comparison
        lhs_s = str(lhs) if lhs is not None else ""
        rhs_s = str(rhs)
        if self.op == "==":
            return lhs_s == rhs_s
        if self.op == "!=":
            return lhs_s != rhs_s
        return False


@dataclass
class _RegexExpr(_Expr):
    key: str
    pattern: str

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        val = ctx.get(self.key)
        if val is None:
            return False
        try:
            return bool(re.search(self.pattern, str(val)))
        except re.error:
            return False


@dataclass
class _InExpr(_Expr):
    key: str
    collection_key: str
    negate: bool = False

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        val = ctx.get(self.key)
        collection = ctx.get(self.collection_key)
        if collection is None:
            result = False
        elif isinstance(collection, (list, set, tuple)):
            result = val in collection
        elif isinstance(collection, dict):
            result = val in collection
        else:
            result = val == collection
        return (not result) if self.negate else result


@dataclass
class _AndExpr(_Expr):
    left: _Expr
    right: _Expr

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        return self.left.evaluate(ctx) and self.right.evaluate(ctx)


@dataclass
class _OrExpr(_Expr):
    left: _Expr
    right: _Expr

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        return self.left.evaluate(ctx) or self.right.evaluate(ctx)


@dataclass
class _LiteralExpr(_Expr):
    value: bool

    def evaluate(self, ctx: "ContextKeyContext") -> bool:
        return self.value


# ---------------------------------------------------------------------------
# Parser (recursive descent)
# ---------------------------------------------------------------------------

class _Parser:
    def __init__(self, tokens: List[_Token]):
        self._tokens = tokens
        self._pos = 0

    def _peek(self) -> _Token:
        return self._tokens[self._pos]

    def _consume(self, expected_type: Optional[str] = None) -> _Token:
        tok = self._tokens[self._pos]
        if expected_type and tok.type != expected_type:
            raise SyntaxError(
                f"Expected {expected_type} but got {tok.type!r} ({tok.value!r})"
            )
        self._pos += 1
        return tok

    def parse(self) -> _Expr:
        expr = self._parse_or()
        self._consume(_TK_EOF)
        return expr

    def _parse_or(self) -> _Expr:
        left = self._parse_and()
        while self._peek().type == _TK_OR:
            self._consume()
            right = self._parse_and()
            left = _OrExpr(left, right)
        return left

    def _parse_and(self) -> _Expr:
        left = self._parse_unary()
        while self._peek().type == _TK_AND:
            self._consume()
            right = self._parse_unary()
            left = _AndExpr(left, right)
        return left

    def _parse_unary(self) -> _Expr:
        if self._peek().type == _TK_NOT:
            self._consume()
            operand = self._parse_primary()
            return _NotExpr(operand)
        return self._parse_primary()

    def _parse_primary(self) -> _Expr:
        tok = self._peek()

        if tok.type == _TK_LPAREN:
            self._consume()
            expr = self._parse_or()
            self._consume(_TK_RPAREN)
            return expr

        if tok.type == _TK_KEY:
            key = tok.value
            self._consume()
            next_tok = self._peek()

            if next_tok.type == _TK_EQ:
                self._consume()
                rhs = self._consume().value
                # Resolve boolean literals
                if rhs == "true":
                    rhs = True
                elif rhs == "false":
                    rhs = False
                return _CmpExpr(key, "==", rhs)

            if next_tok.type == _TK_NEQ:
                self._consume()
                rhs = self._consume().value
                return _CmpExpr(key, "!=", rhs)

            if next_tok.type == _TK_GT:
                self._consume()
                rhs = self._consume().value
                return _CmpExpr(key, ">", rhs)

            if next_tok.type == _TK_GTE:
                self._consume()
                rhs = self._consume().value
                return _CmpExpr(key, ">=", rhs)

            if next_tok.type == _TK_LT:
                self._consume()
                rhs = self._consume().value
                return _CmpExpr(key, "<", rhs)

            if next_tok.type == _TK_LTE:
                self._consume()
                rhs = self._consume().value
                return _CmpExpr(key, "<=", rhs)

            if next_tok.type == _TK_REGEX:
                self._consume()
                pattern = self._consume().value
                return _RegexExpr(key, pattern)

            if next_tok.type == _TK_IN:
                self._consume()
                collection_key = self._consume().value
                return _InExpr(key, collection_key, negate=False)

            if next_tok.type == _TK_NOT_IN:
                self._consume()
                collection_key = self._consume().value
                return _InExpr(key, collection_key, negate=True)

            return _BareKey(key)

        # Fallback: treat VALUE or anything else as a bare true/false
        if tok.type == _TK_VALUE:
            self._consume()
            if tok.value.lower() == "true":
                return _LiteralExpr(True)
            if tok.value.lower() == "false":
                return _LiteralExpr(False)
            return _BareKey(tok.value)

        # Skip unknown
        self._consume()
        return _LiteralExpr(False)


# ---------------------------------------------------------------------------
# Expression cache
# ---------------------------------------------------------------------------

_expr_cache: Dict[str, _Expr] = {}
_expr_cache_lock = threading.Lock()


def _parse_expr(when_clause: str) -> _Expr:
    """Parse and cache a when clause expression."""
    with _expr_cache_lock:
        if when_clause not in _expr_cache:
            try:
                tokens = _tokenize(when_clause)
                _expr_cache[when_clause] = _Parser(tokens).parse()
            except Exception:
                _expr_cache[when_clause] = _LiteralExpr(False)
        return _expr_cache[when_clause]


# ---------------------------------------------------------------------------
# Context Key Context (snapshot of current context)
# ---------------------------------------------------------------------------

class ContextKeyContext:
    """
    Snapshot of context key values.
    Passed to expression.evaluate().
    """

    def __init__(self, data: Dict[str, Any]):
        self._data = data

    def get(self, key: str) -> Any:
        return self._data.get(key)

    def __contains__(self, key: str) -> bool:
        return key in self._data


# ---------------------------------------------------------------------------
# Context Key Service
# ---------------------------------------------------------------------------

class ContextKeyService:
    """
    Manages the current context key state and evaluates when clauses.

    Mirrors VS Code's IContextKeyService.
    """

    def __init__(self):
        self._context: Dict[str, Any] = {}
        self._lock = threading.RLock()
        self._change_callbacks: List[Callable[[Set[str]], None]] = []
        self._init_defaults()

    def _init_defaults(self):
        """Initialize VS Code standard context keys to sensible defaults."""
        defaults = {
            # Editor focus
            "editorFocus": False,
            "editorTextFocus": False,
            "editorReadonly": False,
            "editorHasSelection": False,
            "editorHasMultipleSelections": False,
            "editorHasMultipleLines": False,
            "editorLineNumber": 1,
            "editorColumnNumber": 1,

            # Input focus
            "inputFocus": False,

            # Debug
            "inDebugMode": False,
            "debugState": "inactive",
            "debugType": "",
            "inDebugRepl": False,

            # Terminal
            "terminalFocus": False,
            "terminalIsOpen": False,

            # SCM
            "scmProvider": "",

            # Explorer
            "explorerViewletFocus": False,
            "explorerViewletVisible": True,
            "filesExplorerFocus": False,
            "openEditorsFocus": False,

            # Language / file
            "resourceLangId": "",
            "resourceFilename": "",
            "resourceExtname": "",
            "resourcePath": "",
            "resourceDirname": "",
            "resourceIsReadonly": False,

            # Configuration
            "config.editor.wordWrap": "off",
            "config.editor.fontSize": 14,
            "config.editor.tabSize": 4,

            # Panel
            "panelVisible": False,
            "panelPosition": "bottom",

            # Sidebar
            "sideBarVisible": True,
            "activeViewlet": "",
            "activePanel": "",

            # View state
            "workbenchState": "empty",
            "workspaceFolderCount": 0,
            "isLinux": False,
            "isMac": False,
            "isWindows": True,
            "isWeb": False,

            # Extensions
            "extensionStatus": "",
        }
        self._context.update(defaults)

    def set(self, key: str, value: Any) -> None:
        """Set a context key value and notify listeners."""
        changed: Set[str] = set()
        with self._lock:
            old = self._context.get(key)
            if old != value:
                self._context[key] = value
                changed.add(key)

        if changed:
            self._notify_changed(changed)

    def set_many(self, values: Dict[str, Any]) -> None:
        """Set multiple context keys atomically."""
        changed: Set[str] = set()
        with self._lock:
            for key, value in values.items():
                old = self._context.get(key)
                if old != value:
                    self._context[key] = value
                    changed.add(key)

        if changed:
            self._notify_changed(changed)

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._context.get(key, default)

    def remove(self, key: str) -> None:
        with self._lock:
            self._context.pop(key, None)

    def evaluate(self, when_clause: str) -> bool:
        """
        Evaluate a VS Code when clause string against current context.

        Examples:
            ctx.evaluate("editorFocus && resourceLangId == 'python'")
            ctx.evaluate("!inDebugMode")
        """
        if not when_clause or when_clause.strip() == "":
            return True  # Empty clause = always true

        if when_clause.strip() == "never":
            return False

        if when_clause.strip() == "always":
            return True

        with self._lock:
            snapshot = dict(self._context)

        ctx = ContextKeyContext(snapshot)
        try:
            expr = _parse_expr(when_clause.strip())
            return expr.evaluate(ctx)
        except Exception:
            return False

    def on_change(self, callback: Callable[[Set[str]], None]) -> None:
        """Register a callback that fires when any context key changes."""
        self._change_callbacks.append(callback)

    def _notify_changed(self, changed_keys: Set[str]) -> None:
        for cb in self._change_callbacks:
            try:
                cb(changed_keys)
            except Exception:
                pass

    def get_snapshot(self) -> Dict[str, Any]:
        """Return a copy of the current context."""
        with self._lock:
            return dict(self._context)


# ---------------------------------------------------------------------------
# Global Context Key Service singleton
# ---------------------------------------------------------------------------

_global_ctx_service: Optional[ContextKeyService] = None
_ctx_lock = threading.Lock()


def get_context_key_service() -> ContextKeyService:
    """Return the global ContextKeyService singleton."""
    global _global_ctx_service
    if _global_ctx_service is None:
        with _ctx_lock:
            if _global_ctx_service is None:
                _global_ctx_service = ContextKeyService()
    return _global_ctx_service


def reset_context_key_service() -> None:
    """Reset the global service (for tests)."""
    global _global_ctx_service
    with _ctx_lock:
        _global_ctx_service = None


def evaluate_when(when_clause: str) -> bool:
    """Convenience: evaluate a when clause against the global context."""
    return get_context_key_service().evaluate(when_clause)
