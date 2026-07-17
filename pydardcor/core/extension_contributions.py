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
class MenuItemContribution:
    command: str = ""
    label: str = ""
    group: str = ""
    order: float = 0.0
    when: str = ""
    extension: str = ""


@dataclass
class ThemeContribution:
    id: str = ""
    label: str = ""
    uiTheme: str = ""
    path: str = ""


@dataclass
class ViewContainerContribution:
    id: str = ""
    title: str = ""
    icon: str = ""
    location: str = "activitybar"


@dataclass
class ViewContribution:
    container_id: str = ""
    id: str = ""
    name: str = ""
    when: str = ""
    type: str = "tree"


@dataclass
class ColorContribution:
    id: str = ""
    description: str = ""
    defaults: Dict[str, str] = field(default_factory=dict)


@dataclass
class IconContribution:
    id: str = ""
    description: str = ""
    default: Dict[str, str] = field(default_factory=dict)


@dataclass
class ProblemPatternContribution:
    name: str = ""
    regexp: str = ""
    file: int = 1
    line: int = 1
    column: int = 0
    severity: int = 4
    message: int = 1


@dataclass
class ProblemMatcherContribution:
    name: str = ""
    label: str = ""
    owner: str = ""
    source: str = ""
    severity: str = "error"
    pattern: Optional[ProblemPatternContribution] = None


@dataclass
class TaskDefinitionContribution:
    type: str = ""
    required: List[str] = field(default_factory=list)
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AuthenticationContribution:
    id: str = ""
    label: str = ""


@dataclass
class NotebookRendererContribution:
    id: str = ""
    displayName: str = ""
    entrypoint: str = ""


@dataclass
class NotebookTypeContribution:
    type: str = ""
    displayName: str = ""
    selector: List[Dict[str, str]] = field(default_factory=list)
    priority: str = "default"


@dataclass
class CustomEditorContribution:
    viewType: str = ""
    displayName: str = ""
    selector: List[Dict[str, str]] = field(default_factory=list)
    priority: str = "default"


@dataclass
class ExtensionContributions:
    commands: List[CommandContribution] = field(default_factory=list)
    languages: List[LanguageContribution] = field(default_factory=list)
    grammars: List[GrammarContribution] = field(default_factory=list)
    snippets: List[SnippetContribution] = field(default_factory=list)
    themes: List[ThemeContribution] = field(default_factory=list)
    view_containers: List[ViewContainerContribution] = field(default_factory=list)
    views: List[ViewContribution] = field(default_factory=list)
    configuration: Any = None
    menus: Dict[str, Any] = field(default_factory=dict)
    keybindings: List[Dict[str, Any]] = field(default_factory=list)
    colors: List[ColorContribution] = field(default_factory=list)
    icons: List[IconContribution] = field(default_factory=list)
    problem_matchers: List[ProblemMatcherContribution] = field(default_factory=list)
    problem_patterns: List[ProblemPatternContribution] = field(default_factory=list)
    task_definitions: List[TaskDefinitionContribution] = field(default_factory=list)
    authentication: List[AuthenticationContribution] = field(default_factory=list)
    notebook_renderers: List[NotebookRendererContribution] = field(default_factory=list)
    notebook_types: List[NotebookTypeContribution] = field(default_factory=list)
    custom_editors: List[CustomEditorContribution] = field(default_factory=list)


class ContributionParser:
    def __init__(self):
        self._cache: Dict[str, ExtensionContributions] = {}
        self._snippet_cache: Dict[str, List[Dict[str, Any]]] = {}

    def clear_cache(self):
        self._cache.clear()
        self._snippet_cache.clear()

    @staticmethod
    def _load_nls(ext_path: str) -> Dict[str, str]:
        nls_path = os.path.join(ext_path, "package.nls.json")
        if not os.path.exists(nls_path):
            return {}
        try:
            with open(nls_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {k: v if isinstance(v, str) else v.get("message", "")
                    for k, v in data.items()}
        except Exception:
            return {}

    @staticmethod
    def _nls(value: str, nls: Dict[str, str]) -> str:
        if isinstance(value, str) and len(value) > 2 and value.startswith("%") and value.endswith("%"):
            return nls.get(value[1:-1], value)
        return value

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

        nls = self._load_nls(ext_path)
        contributes = data.get("contributes", {})
        result = ExtensionContributions()

        for cmd in contributes.get("commands", []):
            title = cmd.get("title", "")
            if isinstance(title, dict):
                title = title.get("value", "")
            result.commands.append(CommandContribution(
                command=cmd.get("command", ""),
                title=self._nls(title, nls),
                category=self._nls(cmd.get("category", ""), nls),
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

        vc_root = contributes.get("viewsContainers", {})
        for location in ("activitybar", "panel"):
            for vc in vc_root.get(location, []):
                icon_rel = vc.get("icon", "")
                icon_path = os.path.normpath(os.path.join(ext_path, icon_rel)) if icon_rel else ""
                result.view_containers.append(ViewContainerContribution(
                    id=vc.get("id", ""),
                    title=self._nls(vc.get("title", vc.get("id", "")), nls),
                    icon=icon_path,
                    location=location,
                ))

        views_root = contributes.get("views", {})
        if isinstance(views_root, dict):
            for container_id, view_list in views_root.items():
                if not isinstance(view_list, list):
                    continue
                for v in view_list:
                    result.views.append(ViewContribution(
                        container_id=container_id,
                        id=v.get("id", ""),
                        name=self._nls(v.get("name", v.get("id", "")), nls),
                        when=v.get("when", ""),
                        type=v.get("type", "tree"),
                    ))

        result.configuration = contributes.get("configuration")
        result.menus = contributes.get("menus", {})

        for kb in contributes.get("keybindings", []):
            result.keybindings.append(kb)

        for color in contributes.get("colors", []):
            result.colors.append(ColorContribution(
                id=color.get("id", ""),
                description=color.get("description", ""),
                defaults=color.get("defaults", {}),
            ))

        for icon in contributes.get("productIconThemes", []):
            result.icons.append(IconContribution(
                id=icon.get("id", ""),
                description=icon.get("description", ""),
                default=icon.get("default", {}),
            ))

        for pm in contributes.get("problemMatchers", []):
            pattern_data = pm.get("pattern", {})
            if isinstance(pattern_data, list):
                pattern_data = pattern_data[0] if pattern_data else {}
            if not isinstance(pattern_data, dict):
                pattern_data = {}
            pattern = ProblemPatternContribution(
                name=pattern_data.get("regexp", ""),
                regexp=pattern_data.get("regexp", ""),
                file=int(pattern_data.get("file", 1)),
                line=int(pattern_data.get("line", 1)),
                column=int(pattern_data.get("column", 0)),
                severity=int(pattern_data.get("severity", 4)),
                message=int(pattern_data.get("message", 1)),
            ) if pattern_data else None
            result.problem_matchers.append(ProblemMatcherContribution(
                name=pm.get("name", ""),
                label=pm.get("label", ""),
                owner=pm.get("owner", ""),
                source=pm.get("source", ""),
                severity=pm.get("severity", "error"),
                pattern=pattern,
            ))

        for pp in contributes.get("problemPatterns", []):
            result.problem_patterns.append(ProblemPatternContribution(
                name=pp.get("name", ""),
                regexp=pp.get("regexp", ""),
                file=int(pp.get("file", 1)),
                line=int(pp.get("line", 1)),
                column=int(pp.get("column", 0)),
                severity=int(pp.get("severity", 4)),
                message=int(pp.get("message", 1)),
            ))

        for td in contributes.get("taskDefinitions", []):
            result.task_definitions.append(TaskDefinitionContribution(
                type=td.get("type", ""),
                required=list(td.get("required", [])),
                properties=td.get("properties", {}),
            ))

        for auth in contributes.get("authentication", []):
            result.authentication.append(AuthenticationContribution(
                id=auth.get("id", ""),
                label=auth.get("label", ""),
            ))

        for nr in contributes.get("notebookRenderer", []):
            result.notebook_renderers.append(NotebookRendererContribution(
                id=nr.get("id", ""),
                displayName=nr.get("displayName", ""),
                entrypoint=nr.get("entrypoint", ""),
            ))

        for nt in contributes.get("notebooks", []):
            result.notebook_types.append(NotebookTypeContribution(
                type=nt.get("type", ""),
                displayName=nt.get("displayName", ""),
                selector=nt.get("selector", []),
                priority=nt.get("priority", "default"),
            ))

        for ce in contributes.get("customEditors", []):
            result.custom_editors.append(CustomEditorContribution(
                viewType=ce.get("viewType", ""),
                displayName=ce.get("displayName", ""),
                selector=ce.get("selector", []),
                priority=ce.get("priority", "default"),
            ))

        for auth in contributes.get("authentication", []):
            result.authentication.append(AuthenticationContribution(
                id=auth.get("id", ""),
                label=auth.get("label", ""),
            ))

        for color in contributes.get("colors", []):
            result.colors.append(ColorContribution(
                id=color.get("id", ""),
                description=color.get("description", ""),
                defaults=color.get("defaults", {}),
            ))

        for icon in contributes.get("productIconThemes", []):
            result.icons.append(IconContribution(
                id=icon.get("id", ""),
                description=icon.get("description", ""),
                default=icon.get("default", {}),
            ))

        for pm in contributes.get("problemMatchers", []):
            pattern_data = pm.get("pattern", {})
            if isinstance(pattern_data, list):
                pattern_data = pattern_data[0] if pattern_data else {}
            if not isinstance(pattern_data, dict):
                pattern_data = {}
            pattern = ProblemPatternContribution(
                name=pattern_data.get("regexp", ""),
                regexp=pattern_data.get("regexp", ""),
                file=int(pattern_data.get("file", 1)),
                line=int(pattern_data.get("line", 1)),
                column=int(pattern_data.get("column", 0)),
                severity=int(pattern_data.get("severity", 4)),
                message=int(pattern_data.get("message", 1)),
            ) if pattern_data else None
            result.problem_matchers.append(ProblemMatcherContribution(
                name=pm.get("name", ""),
                label=pm.get("label", ""),
                owner=pm.get("owner", ""),
                source=pm.get("source", ""),
                severity=pm.get("severity", "error"),
                pattern=pattern,
            ))

        for pp in contributes.get("problemPatterns", []):
            result.problem_patterns.append(ProblemPatternContribution(
                name=pp.get("name", ""),
                regexp=pp.get("regexp", ""),
                file=int(pp.get("file", 1)),
                line=int(pp.get("line", 1)),
                column=int(pp.get("column", 0)),
                severity=int(pp.get("severity", 4)),
                message=int(pp.get("message", 1)),
            ))

        for td in contributes.get("taskDefinitions", []):
            result.task_definitions.append(TaskDefinitionContribution(
                type=td.get("type", ""),
                required=list(td.get("required", [])),
                properties=td.get("properties", {}),
            ))

        for auth in contributes.get("authentication", []):
            result.authentication.append(AuthenticationContribution(
                id=auth.get("id", ""),
                label=auth.get("label", ""),
            ))

        for nr in contributes.get("notebookRenderer", []):
            result.notebook_renderers.append(NotebookRendererContribution(
                id=nr.get("id", ""),
                displayName=nr.get("displayName", ""),
                entrypoint=nr.get("entrypoint", ""),
            ))

        for nt in contributes.get("notebooks", []):
            result.notebook_types.append(NotebookTypeContribution(
                type=nt.get("type", ""),
                displayName=nt.get("displayName", ""),
                selector=nt.get("selector", []),
                priority=nt.get("priority", "default"),
            ))

        for ce in contributes.get("customEditors", []):
            result.custom_editors.append(CustomEditorContribution(
                viewType=ce.get("viewType", ""),
                displayName=ce.get("displayName", ""),
                selector=ce.get("selector", []),
                priority=ce.get("priority", "default"),
            ))

        for color in contributes.get("colors", []):
            result.colors.append(ColorContribution(
                id=color.get("id", ""),
                description=color.get("description", ""),
                defaults=color.get("defaults", {}),
            ))

        for icon in contributes.get("productIconThemes", []):
            result.icons.append(IconContribution(
                id=icon.get("id", ""),
                description=icon.get("description", ""),
                default=icon.get("default", {}),
            ))

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
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            for cmd in contribs.commands:
                if cmd.command and cmd.command not in seen:
                    seen.add(cmd.command)
                    all_cmds.append(cmd)
        return all_cmds

    @staticmethod
    def _parse_menu_group(group: str) -> tuple:
        if not group:
            return ("extensions", 0.0)
        if "@" in group:
            name, order_str = group.rsplit("@", 1)
            try:
                return (name, float(order_str))
            except ValueError:
                return (name or group, 0.0)
        return (group, 0.0)

    @staticmethod
    def _menu_command_id(entry: Any) -> str:
        if isinstance(entry, str):
            return entry
        if isinstance(entry, dict):
            cmd = entry.get("command", "")
            if isinstance(cmd, dict):
                return cmd.get("command", "")
            return cmd or ""
        return ""

    def get_menu_items(self, menu_id: str) -> List[MenuItemContribution]:
        from .extension_manager import get_extension_manager

        results: List[MenuItemContribution] = []
        seen_commands: set = set()

        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            menu_entries = contribs.menus.get(menu_id, [])
            if not isinstance(menu_entries, list):
                continue

            cmd_lookup = {c.command: c for c in contribs.commands if c.command}

            for entry in menu_entries:
                if not isinstance(entry, dict):
                    continue
                if entry.get("submenu"):
                    continue

                command_id = self._menu_command_id(entry)
                if not command_id or command_id in seen_commands:
                    continue

                cmd_info = cmd_lookup.get(command_id)
                if not cmd_info or not cmd_info.title:
                    continue

                label = cmd_info.title
                if cmd_info.category:
                    label = f"{cmd_info.category}: {cmd_info.title}"

                group_name, order = self._parse_menu_group(entry.get("group", ""))

                results.append(MenuItemContribution(
                    command=command_id,
                    label=label,
                    group=group_name,
                    order=order,
                    when=entry.get("when", ""),
                    extension=ext.name,
                ))
                seen_commands.add(command_id)

        results.sort(key=lambda m: (m.group, m.order, m.label.lower()))
        return results

    def load_snippets(self, snippet_path: str) -> List[Dict[str, Any]]:
        if not os.path.exists(snippet_path):
            return []
        try:
            with open(snippet_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            snippets = []
            for key, val in data.items():
                if not isinstance(val, dict):
                    continue
                body = val.get("body", "")
                if isinstance(body, list):
                    body = "\n".join(str(line) for line in body)
                prefixes = val.get("prefix", key)
                if isinstance(prefixes, str):
                    prefixes = [prefixes]
                for prefix in prefixes:
                    snippets.append({
                        "label": prefix,
                        "insertText": body,
                        "description": val.get("description", key),
                        "detail": val.get("description", key),
                    })
            return snippets
        except Exception:
            return []

    def get_snippets_for_language(self, language_id: str) -> List[Dict[str, Any]]:
        if language_id in self._snippet_cache:
            return self._snippet_cache[language_id]

        from .extension_manager import get_extension_manager
        results: List[Dict[str, Any]] = []
        try:
            for ext in get_extension_manager().get_installed_extensions():
                if not ext.enabled:
                    continue
                contribs = self.parse_extension(ext.path)
                for snip in contribs.snippets:
                    if snip.language == language_id and snip.path:
                        results.extend(self.load_snippets(snip.path))
        except Exception:
            pass

        self._snippet_cache[language_id] = results
        return results

    def load_language_config(self, config_path: str) -> Dict[str, Any]:
        if not os.path.exists(config_path):
            return {}
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def get_activitybar_containers(self) -> List[Dict[str, Any]]:
        from .extension_manager import get_extension_manager

        containers: List[Dict[str, Any]] = []
        seen_ids = set()
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            if not contribs.view_containers:
                continue

            views_by_container: Dict[str, List[ViewContribution]] = {}
            for v in contribs.views:
                views_by_container.setdefault(v.container_id, []).append(v)

            for vc in contribs.view_containers:
                if vc.location != "activitybar" or not vc.id or vc.id in seen_ids:
                    continue
                seen_ids.add(vc.id)
                containers.append({
                    "container": vc,
                    "views": views_by_container.get(vc.id, []),
                    "ext_name": ext.name,
                    "ext_path": ext.path,
                })
        return containers

    def get_all_themes(self) -> List[ThemeContribution]:
        from .extension_manager import get_extension_manager
        themes = []
        seen = set()
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            for theme in contribs.themes:
                if theme.id and theme.id not in seen:
                    seen.add(theme.id)
                    themes.append(theme)
        return themes

    def get_all_colors(self) -> List[ColorContribution]:
        from .extension_manager import get_extension_manager
        colors = []
        seen = set()
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            for color in contribs.colors:
                if color.id and color.id not in seen:
                    seen.add(color.id)
                    colors.append(color)
        return colors

    def get_all_task_definitions(self) -> List[TaskDefinitionContribution]:
        from .extension_manager import get_extension_manager
        tasks = []
        seen = set()
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            for td in contribs.task_definitions:
                if td.type and td.type not in seen:
                    seen.add(td.type)
                    tasks.append(td)
        return tasks

    def get_all_authentication_providers(self) -> List[AuthenticationContribution]:
        from .extension_manager import get_extension_manager
        auths = []
        seen = set()
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            for a in contribs.authentication:
                if a.id and a.id not in seen:
                    seen.add(a.id)
                    auths.append(a)
        return auths

    def get_all_custom_editors(self) -> List[CustomEditorContribution]:
        from .extension_manager import get_extension_manager
        editors = []
        seen = set()
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            for ce in contribs.custom_editors:
                if ce.viewType and ce.viewType not in seen:
                    seen.add(ce.viewType)
                    editors.append(ce)
        return editors

    def get_all_notebook_types(self) -> List[NotebookTypeContribution]:
        from .extension_manager import get_extension_manager
        types = []
        seen = set()
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contribs = self.parse_extension(ext.path)
            for nt in contribs.notebook_types:
                if nt.type and nt.type not in seen:
                    seen.add(nt.type)
                    types.append(nt)
        return types


_parser_instance: Optional[ContributionParser] = None


def get_contribution_parser() -> ContributionParser:
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = ContributionParser()
    return _parser_instance
