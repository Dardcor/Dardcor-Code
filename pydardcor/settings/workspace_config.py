"""Workspace Configuration Files - Handles .vscode/{settings.json, tasks.json, launch.json, extensions.json}."""

import os
import json
import copy
from typing import Dict, List, Optional, Any


def parse_json_with_comments(text: str) -> dict:
    result = []
    in_string = False
    in_line_comment = False
    in_block_comment = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == '\\' and i + 1 < len(text):
                result.append(ch)
                result.append(text[i + 1])
                i += 2
                continue
            elif ch == '"':
                in_string = False
            result.append(ch)
            i += 1
            continue
        if in_line_comment:
            if ch == '\n':
                in_line_comment = False
                result.append(ch)
            i += 1
            continue
        if in_block_comment:
            if ch == '*' and i + 1 < len(text) and text[i + 1] == '/':
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if ch == '"':
            in_string = True
            result.append(ch)
            i += 1
            continue
        if ch == '/' and i + 1 < len(text):
            if text[i + 1] == '/':
                in_line_comment = True
                i += 2
                continue
            elif text[i + 1] == '*':
                in_block_comment = True
                i += 2
                continue
        result.append(ch)
        i += 1
    return json.loads("".join(result))


def _get_vscode_dir(workspace_path: str) -> str:
    return os.path.join(workspace_path, ".vscode") if workspace_path else ""


def _ensure_vscode_dir(workspace_path: str) -> str:
    d = _get_vscode_dir(workspace_path)
    os.makedirs(d, exist_ok=True)
    return d


def _read_json(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return parse_json_with_comments(content)
    except Exception:
        return {}


def _write_json(path: str, data: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)
        f.write("\n")


class WorkspaceSettingsHandler:
    def __init__(self, workspace_path: str = ""):
        self._workspace = workspace_path

    def get_path(self) -> str:
        return os.path.join(_get_vscode_dir(self._workspace), "settings.json") if self._workspace else ""

    def load(self) -> dict:
        return _read_json(self.get_path())

    def save(self, data: dict):
        _write_json(self.get_path(), data)

    def get_setting(self, key: str, default: Any = None) -> Any:
        data = self.load()
        return data.get(key, default)

    def set_setting(self, key: str, value: Any):
        data = self.load()
        data[key] = value
        self.save(data)

    def remove_setting(self, key: str):
        data = self.load()
        data.pop(key, None)
        self.save(data)


class WorkspaceExtensionsHandler:
    def __init__(self, workspace_path: str = ""):
        self._workspace = workspace_path

    def get_path(self) -> str:
        return os.path.join(_get_vscode_dir(self._workspace), "extensions.json") if self._workspace else ""

    def load(self) -> dict:
        return _read_json(self.get_path())

    def save(self, data: dict):
        _write_json(self.get_path(), data)

    def get_recommendations(self) -> List[str]:
        return self.load().get("recommendations", [])

    def add_recommendation(self, ext_id: str):
        data = self.load()
        if "recommendations" not in data:
            data["recommendations"] = []
        if ext_id not in data["recommendations"]:
            data["recommendations"].append(ext_id)
        self.save(data)

    def remove_recommendation(self, ext_id: str):
        data = self.load()
        if "recommendations" in data:
            data["recommendations"] = [e for e in data["recommendations"] if e != ext_id]
        self.save(data)

    def get_unwanted(self) -> List[str]:
        return self.load().get("unwantedRecommendations", [])

    def add_unwanted(self, ext_id: str):
        data = self.load()
        if "unwantedRecommendations" not in data:
            data["unwantedRecommendations"] = []
        if ext_id not in data["unwantedRecommendations"]:
            data["unwantedRecommendations"].append(ext_id)
        self.save(data)

    def remove_unwanted(self, ext_id: str):
        data = self.load()
        if "unwantedRecommendations" in data:
            data["unwantedRecommendations"] = [e for e in data["unwantedRecommendations"] if e != ext_id]
        self.save(data)


DEFAULT_SETTINGS_VALUES = {
    "editor.fontFamily": "Cascadia Code",
    "editor.fontSize": 13,
    "editor.tabSize": 4,
    "editor.wordWrap": "off",
    "editor.minimap.enabled": True,
    "editor.renderWhitespace": "selection",
    "editor.cursorStyle": "line",
    "editor.cursorBlinking": "blink",
    "editor.bracketPairColorization.enabled": True,
    "editor.smoothScrolling": True,
    "editor.stickyScroll.enabled": True,
    "editor.formatOnSave": False,
    "editor.formatOnPaste": False,
    "editor.lineNumbers": "on",
    "editor.fontLigatures": False,
    "editor.mouseWheelZoom": True,
    "editor.autoClosingBrackets": "always",
    "editor.autoClosingQuotes": "always",
    "editor.tabCompletion": "on",
    "editor.suggestOnTriggerCharacters": True,
    "editor.quickSuggestions": {"other": True, "comments": False, "strings": False},
    "editor.wordBasedSuggestions": True,
    "editor.parameterHints.enabled": True,
    "editor.inlayHints.enabled": "on",
    "editor.codeActionsOnSave": {},
    "editor.folding": True,
    "editor.foldingHighlight": True,
    "editor.linkedEditing": True,
    "editor.multiCursorModifier": "alt",
    "editor.copyWithSyntaxHighlighting": True,
    "editor.emptySelectionClipboard": True,
    "editor.suggestSelection": "first",
    "editor.matchBrackets": "always",
    "editor.selectionHighlight": True,
    "editor.occurrencesHighlight": True,
    "editor.renderControlCharacters": True,
    "editor.hideCursorInOverviewRuler": True,
    "editor.overviewRulerBorder": True,
    "editor.padding.top": 0,
    "editor.padding.bottom": 0,
    "editor.unicodeHighlight.ambiguousCharacters": True,
    "editor.unicodeHighlight.invisibleCharacters": True,
    "editor.unusualLineTerminators": "auto",
    "workbench.colorTheme": "dardcor-purple",
    "workbench.sideBar.location": "left",
    "workbench.statusBar.visible": True,
    "workbench.activityBar.visible": True,
    "breadcrumbs.enabled": True,
    "files.encoding": "utf-8",
    "files.eol": "auto",
    "files.autoSave": "afterDelay",
    "files.autoSaveDelay": 1000,
    "files.trimTrailingWhitespace": False,
    "files.insertFinalNewline": False,
    "files.associations": {},
    "terminal.integrated.fontSize": 14,
    "terminal.integrated.cursorStyle": "block",
    "terminal.integrated.defaultProfile.windows": None,
    "telemetry.enableTelemetry": True,
    "window.title": "${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}",
    "window.zoomLevel": 0,
    "window.menuBarVisibility": "default",
    "extensions.autoUpdate": True,
    "debug.console.fontSize": 13,
    "debug.internalConsoleOptions": "neverOpen",
    "search.exclude": {},
    "files.exclude": {},
    "workbench.editor.enablePreview": True,
    "workbench.editor.enablePreviewFromQuickOpen": True,
    "workbench.editor.showTabs": True,
    "workbench.editor.wrapTabs": False,
    "workbench.colorCustomizations": {},
    "editor.tokenColorCustomizations": {},
    "editor.semanticTokenColorCustomizations": {},
    "json.schemas": [],
    "editor.snippetSuggestions": "inline",
}


def get_default_setting(key: str) -> Any:
    return copy.deepcopy(DEFAULT_SETTINGS_VALUES.get(key))


def get_all_defaults() -> Dict[str, Any]:
    return copy.deepcopy(DEFAULT_SETTINGS_VALUES)
