"""
Window Title Variables — TASK-0031
====================================
Resolves VS Code window title template variables.

Supported variables (same as VS Code):
  ${activeEditorShort}     — filename.ext
  ${activeEditorMedium}    — folder/filename.ext
  ${activeEditorLong}      — full absolute path
  ${activeFolderShort}     — parent folder
  ${activeFolderMedium}    — relative folder path
  ${activeFolderLong}      — full folder path
  ${rootName}              — workspace name
  ${rootPath}              — workspace root path
  ${folderName}            — folder name
  ${folderPath}            — folder path
  ${appName}               — Dardcor Code
  ${remoteName}            — Remote name (SSH/WSL)
  ${dirty}                 — ● if file is dirty
  ${separator}             — —
"""

from __future__ import annotations

import os
from typing import Optional


class WindowTitleService:
    """Resolves VS Code window title variables."""

    DEFAULT_TEMPLATE = (
        "${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}"
    )

    def __init__(self, app_name: str = "Dardcor Code"):
        self._app_name = app_name
        self._active_file: str = ""
        self._workspace_path: str = ""
        self._workspace_name: str = ""
        self._remote_name: str = ""
        self._dirty: bool = False
        self._template = self.DEFAULT_TEMPLATE

    def set_template(self, template: str) -> None:
        self._template = template or self.DEFAULT_TEMPLATE

    def set_active_file(self, path: str, dirty: bool = False) -> None:
        self._active_file = path
        self._dirty = dirty

    def set_workspace(self, path: str, name: str = "") -> None:
        self._workspace_path = path
        self._workspace_name = name or os.path.basename(path) if path else ""

    def set_remote(self, remote_name: str) -> None:
        self._remote_name = remote_name

    def resolve(self, template: Optional[str] = None) -> str:
        """Resolve title template to a string."""
        tmpl = template or self._template
        file_path = self._active_file

        # Compute variables
        if file_path:
            filename = os.path.basename(file_path)
            dirname = os.path.dirname(file_path)
            folder_short = os.path.basename(dirname) if dirname else ""

            # Relative path from workspace
            if self._workspace_path:
                try:
                    rel = os.path.relpath(file_path, self._workspace_path)
                    medium = rel.replace("\\", "/")
                except ValueError:
                    medium = filename
            else:
                medium = filename

            active_editor_short = filename
            active_editor_medium = medium
            active_editor_long = file_path.replace("\\", "/")
            active_folder_short = folder_short
            active_folder_medium = os.path.dirname(medium)
            active_folder_long = dirname.replace("\\", "/")
        else:
            active_editor_short = ""
            active_editor_medium = ""
            active_editor_long = ""
            active_folder_short = ""
            active_folder_medium = ""
            active_folder_long = ""

        dirty_str = "● " if self._dirty and file_path else ""
        separator = " — "

        replacements = {
            "${activeEditorShort}": active_editor_short,
            "${activeEditorMedium}": active_editor_medium,
            "${activeEditorLong}": active_editor_long,
            "${activeFolderShort}": active_folder_short,
            "${activeFolderMedium}": active_folder_medium,
            "${activeFolderLong}": active_folder_long,
            "${rootName}": self._workspace_name,
            "${rootPath}": self._workspace_path.replace("\\", "/"),
            "${folderName}": self._workspace_name,
            "${folderPath}": self._workspace_path.replace("\\", "/"),
            "${appName}": self._app_name,
            "${remoteName}": self._remote_name,
            "${dirty}": dirty_str,
            "${separator}": separator,
        }

        result = tmpl
        for var, value in replacements.items():
            result = result.replace(var, value)

        # Clean up double separators from empty vars
        while " —  — " in result:
            result = result.replace(" —  — ", " — ")
        result = result.strip(" —").strip()

        return result or self._app_name


# Global singleton
_title_service: Optional[WindowTitleService] = None


def get_window_title_service() -> WindowTitleService:
    global _title_service
    if _title_service is None:
        _title_service = WindowTitleService()
    return _title_service
