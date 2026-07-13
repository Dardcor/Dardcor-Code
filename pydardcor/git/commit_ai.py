"""AI Commit Message Generator — generates conventional commit messages from git diff."""

from __future__ import annotations

import os
import json
import subprocess
import threading
from typing import Optional
from PySide6.QtCore import QObject, Signal


class AICommitGenerator(QObject):
    """Generates commit messages using AI based on git diff."""

    message_ready = Signal(str)
    generation_error = Signal(str)
    generation_started = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)

    def generate(self, workspace_path: str, diff_context: str = ""):
        """Generate a commit message from the current git diff."""
        if not workspace_path:
            self.generation_error.emit("No workspace path set.")
            return

        self.generation_started.emit()
        threading.Thread(
            target=self._generate_impl,
            args=(workspace_path, diff_context),
            daemon=True,
        ).start()

    def _get_diff(self, workspace_path: str) -> str:
        try:
            result = subprocess.run(
                ["git", "diff", "--cached"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
            staged = result.stdout.strip()

            result = subprocess.run(
                ["git", "diff"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
            unstaged = result.stdout.strip()

            result = subprocess.run(
                ["git", "diff", "--name-status"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
            summary = result.stdout.strip()

            combined = ""
            if summary:
                combined += f"Changed files:\n{summary}\n\n"
            if staged:
                if len(staged) > 4000:
                    staged = staged[:2000] + "\n...[truncated]...\n" + staged[-1800:]
                combined += f"Staged changes:\n{staged}\n\n"
            if unstaged:
                if len(unstaged) > 4000:
                    unstaged = unstaged[:2000] + "\n...[truncated]...\n" + unstaged[-1800:]
                combined += f"Unstaged changes:\n{unstaged}"
            return combined.strip()
        except Exception as e:
            return f"Error getting diff: {e}"

    def _get_recent_commits(self, workspace_path: str) -> str:
        try:
            result = subprocess.run(
                ["git", "log", "--oneline", "-5"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.stdout.strip()
        except Exception:
            return ""

    def _generate_impl(self, workspace_path: str, diff_context: str):
        try:
            diff = diff_context or self._get_diff(workspace_path)
            recent = self._get_recent_commits(workspace_path)

            if not diff:
                self.message_ready.emit("feat: no changes detected")
                return

            prompt = (
                "Generate a conventional commit message based on the following git diff.\n\n"
                "Rules:\n"
                "- Use conventional commit format: type(scope): description\n"
                "- Types: feat, fix, docs, style, refactor, perf, test, chore, ci\n"
                "- Keep the subject line under 72 characters\n"
                "- If needed, add a blank line then bullet points for details\n"
                "- Be concise but descriptive\n\n"
                f"Recent commits for context:\n{recent}\n\n"
                f"Diff:\n{diff[:8000]}"
            )

            api_key = os.environ.get("DARDCOR_CODE_API_KEY", os.environ.get("OPENAI_API_KEY", ""))
            if not api_key:
                self.message_ready.emit(self._fallback_generate(diff))
                return

            import urllib.request
            import urllib.error

            payload = json.dumps({
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": "You are a git commit message generator. Output ONLY the commit message, no explanations."},
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 200,
                "temperature": 0.3,
            }).encode("utf-8")

            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                msg = data["choices"][0]["message"]["content"].strip()
                # Clean up
                msg = msg.strip("'\"`")
                self.message_ready.emit(msg if msg else self._fallback_generate(diff))

        except Exception as e:
            try:
                msg = self._fallback_generate(self._get_diff(workspace_path))
                self.message_ready.emit(msg)
            except Exception:
                self.generation_error.emit(f"Failed to generate commit message: {e}")

    def _fallback_generate(self, diff: str) -> str:
        """Generate a simple commit message from diff summary without AI."""
        lines = diff.splitlines()
        changed_files = [l for l in lines if l.strip() and (l.startswith(("A\t", "M\t", "D\t", "R\t", "C\t")) or "\t" in l)]
        added = [l for l in lines if l.startswith("A\t")]
        modified = [l for l in lines if l.startswith("M\t")]
        deleted = [l for l in lines if l.startswith("D\t")]

        if added and not modified and not deleted:
            return f"feat: add {len(added)} new file{'s' if len(added) > 1 else ''}"
        elif deleted and not added and not modified:
            return f"chore: remove {len(deleted)} file{'s' if len(deleted) > 1 else ''}"
        elif modified and not added and not deleted:
            return f"fix: update {len(modified)} file{'s' if len(modified) > 1 else ''}"
        else:
            total = len(added) + len(modified) + len(deleted)
            parts = []
            if added:
                parts.append(f"+{len(added)}")
            if modified:
                parts.append(f"~{len(modified)}")
            if deleted:
                parts.append(f"-{len(deleted)}")
            return f"feat: update {total} file{'s' if total > 1 else ''} ({', '.join(parts)})"
