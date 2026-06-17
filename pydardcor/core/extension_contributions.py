"""Phase B: Parse VSIX package.json contributions (languages, snippets, grammars, configuration)."""

import os
import json
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field


@dataclass
class LanguageContribution:
    id: str = ""
    extensions: List[str] = field(default_factory=list)
    aliases: List[str] = field(default_factory=list)
    configuration: str = ""


@dataclass
class GrammarContribution:
    language: str = ""
    scope_name: str = ""
    path: str = ""
    embeddedLanguages: Dict[str, str] = field(default_factory=dict)


@dataclass
class SnippetContribution:
    language: str = ""
    path: str = ""


@dataclass
class CommandContribution:
    command: str = ""
    title: str = ""
    category: str = ""


@dataclass
class ThemeContribution:
    id: str = ""
    label: str = ""
    uiTheme: str = ""
    path: str = ""


@dataclass
class ExtensionContributions:
    commands: List[CommandContribution] = field(default_factory=list)
    languages: List[LanguageContribution] = field(default_factory=list)
    grammars: List[GrammarContribution] = field(default_factory=list)
    snippets: List[SnippetContribution] = field(default_factory=list)
    themes: List[ThemeContribution] = field(default_factory=list)
    configuration: Any = None
    menus: Dict[str, Any] = field(default_factory=dict)
    keybindings: List[Dict[str, Any]] = field(default_factory=list)


class ContributionParser:
    def __init__(self):
        self._cache: Dict[str, ExtensionContributions] = {}

    def parse_extension(self, ext_path: str) -> ExtensionContributions:
        if ext_path in self._cache:
            return self._cache[ext_path]

        manifest_path = os.path.join(ext_path, "package.json")
        if not os.path.exists(manifest_path):
            result = ExtensionContributions()
            self._cache[ext_path] = result
            return result

        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            result = ExtensionContributions()
            self._cache[ext_path] = result
            return result

        contributes = data.get("contributes", {})
        result = ExtensionContributions()

        for cmd in contributes.get("commands", []):
            result.commands.append(CommandContribution(
                command=cmd.get("command", ""),
                title=cmd.get("title", ""),
                category=cmd.get("category", ""),
            ))

        for lang in contributes.get("languages", []):
            result.languages.append(LanguageContribution(
                id=lang.get("id", ""),
                extensions=list(lang.get("extensions", [])),
                aliases=list(lang.get("aliases", [])),
                configuration=lang.get("configuration", ""),
            ))

        for grammar in contributes.get("grammars", []):
            lang_id = grammar.get("language", "")
            scope = grammar.get("scopeName", "")
            grammar_path = grammar.get("path", "")
            embedded = grammar.get("embeddedLanguages", {})

            full_path = os.path.join(ext_path, grammar_path) if grammar_path else ""
            result.grammars.append(GrammarContribution(
                language=lang_id,
                scope_name=scope,
                path=full_path,
                embeddedLanguages=embedded,
            ))

        for snippet in contributes.get("snippets", []):
            lang_id = snippet.get("language", "")
            snippet_path = snippet.get("path", "")
            full_path = os.path.join(ext_path, snippet_path) if snippet_path else ""
            result.snippets.append(SnippetContribution(
                language=lang_id,
                path=full_path,
            ))

        for theme in contributes.get("themes", []):
            theme_path = theme.get("path", "")
            full_path = os.path.join(ext_path, theme_path) if theme_path else ""
            result.themes.append(ThemeContribution(
                id=theme.get("id", ""),
                label=theme.get("label", ""),
                uiTheme=theme.get("uiTheme", ""),
                path=full_path,
            ))

        result.configuration = contributes.get("configuration")
        result.menus = contributes.get("menus", {})

        for kb in contributes.get("keybindings", []):
            result.keybindings.append(kb)

        self._cache[ext_path] = result
        return result

    def get_all_languages(self) -> List[LanguageContribution]:
        from .extension_manager import get_extension_manager
        mgr = get_extension_manager()
        all_langs = []
        seen_ids = set()
        for ext in mgr.get_installed_extensions():
            contribs = self.parse_extension(ext.path)
            for lang in contribs.languages:
                if lang.id and lang.id not in seen_ids:
                    seen_ids.add(lang.id)
                    all_langs.append(lang)
        return all_langs

    def get_all_commands(self) -> List[CommandContribution]:
        from .extension_manager import get_extension_manager
        mgr = get_extension_manager()
        all_cmds = []
        seen = set()
        for ext in mgr.get_installed_extensions():
            contribs = self.parse_extension(ext.path)
            for cmd in contribs.commands:
                if cmd.command and cmd.command not in seen:
                    seen.add(cmd.command)
                    all_cmds.append(cmd)
        return all_cmds

    def load_snippets(self, snippet_path: str) -> List[Dict[str, Any]]:
        if not os.path.exists(snippet_path):
            return []
        try:
            with open(snippet_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            snippets = []
            for key, val in data.items():
                snippets.append({
                    "label": val.get("prefix", key),
                    "insertText": val.get("body", ""),
                    "description": val.get("description", ""),
                    "detail": val.get("description", ""),
                })
            return snippets
        except Exception:
            return []

    def load_language_config(self, config_path: str) -> Dict[str, Any]:
        if not os.path.exists(config_path):
            return {}
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}


_parser_instance: Optional[ContributionParser] = None


def get_contribution_parser() -> ContributionParser:
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = ContributionParser()
    return _parser_instance
