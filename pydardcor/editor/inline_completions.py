"""Inline Completions (Ghost Text) — AI-powered code completions as you type."""

from __future__ import annotations

import os
import json
import threading
import urllib.request
from PySide6.QtCore import QObject, Signal, QTimer
from PySide6.QtGui import QTextCursor


class InlineCompletionProvider(QObject):
    """Provides ghost text completions as the user types in the editor."""

    completion_ready = Signal(str, int, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._debounce_timer = QTimer(self)
        self._debounce_timer.setInterval(400)
        self._debounce_timer.setSingleShot(True)
        self._debounce_timer.timeout.connect(self._do_request)
        self._last_prefix = ""
        self._last_line = 0
        self._last_col = 0
        self._editor = None
        self._enabled = True
        self._abort_flag = False

    def set_enabled(self, enabled: bool):
        self._enabled = enabled
        if not enabled:
            self._debounce_timer.stop()

    def on_text_changed(self, editor):
        if not self._enabled:
            return
        self._editor = editor
        cursor = editor.textCursor() if hasattr(editor, 'textCursor') else None
        if not cursor:
            return
        self._last_line = cursor.blockNumber()
        self._last_col = cursor.columnNumber()

        text = cursor.block().text()[:self._last_col]
        if len(text) < 3:
            self._debounce_timer.stop()
            return

        self._last_prefix = text
        self._abort_flag = False
        self._debounce_timer.start()

    def abort(self):
        self._abort_flag = True
        self._debounce_timer.stop()

    def _do_request(self):
        if self._abort_flag or not self._editor or not self._last_prefix:
            return

        prefix = self._last_prefix
        threading.Thread(target=self._fetch_completion, args=(prefix,), daemon=True).start()

    def _fetch_completion(self, prefix: str):
        try:
            api_key = os.environ.get("DARDCOR_CODE_API_KEY", os.environ.get("OPENAI_API_KEY", ""))
            if not api_key:
                return

            payload = json.dumps({
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a code completion engine. Complete the code prefix. "
                            "Output ONLY the completion text, no explanations. "
                            "Keep it under 50 tokens. Match the indentation."
                        ),
                    },
                    {"role": "user", "content": f"Complete this code:\n```\n{prefix}\n```"},
                ],
                "max_tokens": 50,
                "temperature": 0.2,
                "stop": ["\n\n"],
            }).encode("utf-8")

            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                completion = data["choices"][0]["message"]["content"].strip()

            if completion and not self._abort_flag:
                self.completion_ready.emit(completion, self._last_line, self._last_col)

        except Exception:
            pass
