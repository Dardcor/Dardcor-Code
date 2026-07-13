"""Theme Manager - VS Code style dynamic theming."""

import os
import re
import json
from typing import Dict, Any, List, Optional

from PySide6.QtWidgets import QApplication, QWidget
from PySide6.QtGui import QPalette, QColor


def _load_jsonc(path: str) -> Dict[str, Any]:
    """Load a VS Code theme JSON file (tolerates comments and trailing commas)."""
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    # Strip /* */ and // comments (naive but adequate for theme files)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
    # Trailing commas
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return json.loads(text)


def _load_vscode_theme(path: str) -> Dict[str, Any]:
    """Load a VS Code color theme, resolving one level of 'include'."""
    data = _load_jsonc(path)
    include = data.get("include")
    if include:
        base_path = os.path.normpath(os.path.join(os.path.dirname(path), include))
        if os.path.exists(base_path):
            base = _load_jsonc(base_path)
            merged_colors = dict(base.get("colors", {}))
            merged_colors.update(data.get("colors", {}))
            merged_tokens = list(base.get("tokenColors", [])) + list(data.get("tokenColors", []))
            base.update(data)
            base["colors"] = merged_colors
            base["tokenColors"] = merged_tokens
            return base
    return data


# TextMate scope prefix -> Monaco monarch token (longest prefix wins)
_SCOPE_TO_MONACO = {
    "comment": "comment",
    "punctuation.definition.comment": "comment",
    "string.regexp": "regexp",
    "string": "string",
    "constant.numeric": "number",
    "constant.character": "string.escape",
    "constant.language": "keyword",
    "constant": "constant",
    "keyword.operator": "operator",
    "keyword.control": "keyword",
    "keyword": "keyword",
    "storage.type": "keyword",
    "storage": "keyword",
    "entity.name.type": "type",
    "entity.name.class": "type",
    "entity.name.namespace": "namespace",
    "entity.name.function": "function",
    "entity.name.tag": "tag",
    "entity.other.attribute-name": "attribute.name",
    "support.type": "type",
    "support.class": "type",
    "support.function": "function",
    "variable.parameter": "variable",
    "variable": "variable",
    "markup.heading": "strong",
    "meta.type": "type",
}


class ThemeManager:
    """Manages color themes and dynamically applies stylesheets to QApplication."""
    
    _current_theme = "dark+"
    _extension_themes_registered = False
    # Extension-contributed themes: {"ext:<label>": {"name", "type", "path"}}
    EXT_THEMES: Dict[str, Dict[str, str]] = {}
    # Monaco theme data for the active extension theme (None = builtin)
    _monaco_theme_data: Optional[Dict[str, Any]] = None
    _current_zoom_level: int = 0
    
    # Pre-defined base themes
    THEMES = {
        "dardcor-purple": {
            "name": "Dardcor Purple",
            "type": "dark",
            "colors": {
                "background": "#000000",
                "foreground": "#d6d0e8",
                "sidebar": "#000000",
                "activity_bar": "#000000",
                "activity_bar_fg": "#ffffff",
                "selection": "#3c0068",
                "hover": "#1a0033",
                "border": "#3c0068",
                "accent": "#6d00b8",
                "accent_hover": "#8b2cff",
                "error": "#f48771"
            }
        },
        "cursor-dark": {
            "name": "Cursor Dark",
            "type": "dark",
            "colors": {
                "background": "#0f0f10",
                "foreground": "#d6d6d6",
                "sidebar": "#09090a",
                "activity_bar": "#080809",
                "activity_bar_fg": "#f2f2f2",
                "selection": "#263340",
                "hover": "#1b1b1d",
                "border": "#2a2a2d",
                "accent": "#8a5cf6",
                "accent_hover": "#a78bfa",
                "error": "#ff6b6b"
            }
        },
        "antigravity-dark": {
            "name": "Antigravity Dark",
            "type": "dark",
            "colors": {
                "background": "#0b0d12",
                "foreground": "#d7dde8",
                "sidebar": "#070910",
                "activity_bar": "#06080d",
                "activity_bar_fg": "#f7f8ff",
                "selection": "#24364f",
                "hover": "#141824",
                "border": "#20283a",
                "accent": "#4f8cff",
                "accent_hover": "#78a6ff",
                "error": "#ff6b7a"
            }
        },
        "dark+": {
            "name": "VS Code Dark+",
            "type": "dark",
            "colors": {
                "background": "#000000",
                "foreground": "#cccccc",
                "sidebar": "#000000",
                "activity_bar": "#000000",
                "activity_bar_fg": "#ffffff",
                "selection": "#04395e",
                "hover": "#1a1a1a",
                "border": "#2b2b2b",
                "accent": "#ffffff",
                "accent_hover": "#cccccc",
                "error": "#f48771"
            }
        },
        "light+": {
            "name": "Light+ (default light)",
            "type": "light",
            "colors": {
                "background": "#ffffff",
                "foreground": "#333333",
                "sidebar": "#f3f3f3",
                "activity_bar": "#2c2c2c",
                "activity_bar_fg": "#ffffff",
                "selection": "#e4e6f1",
                "hover": "#f0f0f0",
                "border": "#cccccc",
                "accent": "#007acc",
                "accent_hover": "#005a9e",
                "error": "#e51400"
            }
        },
        "high-contrast": {
            "name": "High Contrast",
            "type": "dark",
            "colors": {
                "background": "#000000",
                "foreground": "#ffffff",
                "sidebar": "#000000",
                "activity_bar": "#000000",
                "activity_bar_fg": "#ffffff",
                "selection": "#264f78",
                "hover": "#2a2d2e",
                "border": "#6fc3df",
                "accent": "#f38518",
                "accent_hover": "#ff9e40",
                "error": "#f48771"
            }
        },
        "monokai": {
            "name": "Monokai",
            "type": "dark",
            "colors": {
                "background": "#272822",
                "foreground": "#f8f8f2",
                "sidebar": "#1e1f1c",
                "activity_bar": "#1e1f1c",
                "activity_bar_fg": "#f8f8f2",
                "selection": "#49483e",
                "hover": "#3e3d32",
                "border": "#414339",
                "accent": "#a6e22e",
                "accent_hover": "#b8f544",
                "error": "#f92672"
            }
        },
        "solarized-dark": {
            "name": "Solarized Dark",
            "type": "dark",
            "colors": {
                "background": "#002b36",
                "foreground": "#839496",
                "sidebar": "#002129",
                "activity_bar": "#001e27",
                "activity_bar_fg": "#93a1a1",
                "selection": "#073642",
                "hover": "#073642",
                "border": "#0d4f5e",
                "accent": "#268bd2",
                "accent_hover": "#2aa198",
                "error": "#dc322f"
            }
        },
        "solarized-light": {
            "name": "Solarized Light",
            "type": "light",
            "colors": {
                "background": "#fdf6e3",
                "foreground": "#657b83",
                "sidebar": "#eee8d5",
                "activity_bar": "#ddd6c1",
                "activity_bar_fg": "#586e75",
                "selection": "#eee8d5",
                "hover": "#eee8d5",
                "border": "#d3af86",
                "accent": "#268bd2",
                "accent_hover": "#2aa198",
                "error": "#dc322f"
            }
        },
        "github-dark": {
            "name": "GitHub Dark",
            "type": "dark",
            "colors": {
                "background": "#0d1117",
                "foreground": "#c9d1d9",
                "sidebar": "#010409",
                "activity_bar": "#010409",
                "activity_bar_fg": "#c9d1d9",
                "selection": "#163b56",
                "hover": "#161b22",
                "border": "#30363d",
                "accent": "#58a6ff",
                "accent_hover": "#79c0ff",
                "error": "#f85149"
            }
        },
        "one-dark-pro": {
            "name": "One Dark Pro",
            "type": "dark",
            "colors": {
                "background": "#282c34",
                "foreground": "#abb2bf",
                "sidebar": "#21252b",
                "activity_bar": "#21252b",
                "activity_bar_fg": "#abb2bf",
                "selection": "#3e4452",
                "hover": "#2c313a",
                "border": "#3e4452",
                "accent": "#61afef",
                "accent_hover": "#528bff",
                "error": "#e06c75"
            }
        },
    }

    @classmethod
    def register_extension_themes(cls):
        """Scan installed extensions for contributes.themes and register them."""
        if cls._extension_themes_registered:
            return
        from ..core.extension_manager import get_extension_manager

        cls.EXT_THEMES = {}
        try:
            extensions = get_extension_manager().get_installed_extensions()
        except Exception:
            return

        for ext in extensions:
            if not ext.enabled:
                continue
            contributes = (ext.manifest or {}).get("contributes", {})
            for t in contributes.get("themes", []):
                rel = t.get("path", "")
                full = os.path.normpath(os.path.join(ext.path, rel)) if rel else ""
                if not full or not os.path.exists(full):
                    continue
                label = t.get("label") or t.get("id") or os.path.basename(full)
                ui = t.get("uiTheme", "vs-dark")
                cls.EXT_THEMES[f"ext:{label}"] = {
                    "name": label,
                    "type": "light" if ui == "vs" else "dark",
                    "path": full,
                }
        cls._extension_themes_registered = True

    @classmethod
    def get_theme_list(cls) -> List[Dict[str, str]]:
        """Return list of available themes for theme picker UI."""
        result = [
            {"id": tid, "name": data["name"], "type": data["type"]}
            for tid, data in cls.THEMES.items()
        ]
        result.extend(
            {"id": tid, "name": data["name"] + "  [Extension]", "type": data["type"]}
            for tid, data in cls.EXT_THEMES.items()
        )
        return result

    @classmethod
    def current_theme_id(cls) -> str:
        return cls._current_theme

    @classmethod
    def get_monaco_theme(cls) -> Optional[Dict[str, Any]]:
        """Monaco defineTheme() data for the active extension theme, or None."""
        return cls._monaco_theme_data

    @classmethod
    def _vscode_theme_to_shell_colors(cls, data: Dict[str, Any], is_dark: bool) -> Dict[str, str]:
        vc = data.get("colors", {})

        def pick(*keys, default=""):
            for k in keys:
                v = vc.get(k)
                if v:
                    return v[:7] if len(v) == 9 else v  # drop alpha for Qt stylesheets
            return default

        bg = pick("editor.background", default="#1e1e1e" if is_dark else "#ffffff")
        fg = pick("foreground", "editor.foreground",
                  default="#cccccc" if is_dark else "#333333")
        return {
            "background": bg,
            "foreground": fg,
            "sidebar": pick("sideBar.background", default=bg),
            "activity_bar": pick("activityBar.background", default=bg),
            "activity_bar_fg": pick("activityBar.foreground", default=fg),
            "selection": pick("list.activeSelectionBackground", "editor.selectionBackground",
                              default="#264f78" if is_dark else "#add6ff"),
            "hover": pick("list.hoverBackground",
                          default="#2a2d2e" if is_dark else "#f0f0f0"),
            "border": pick("panel.border", "editorGroup.border", "contrastBorder",
                           default="#454545" if is_dark else "#cccccc"),
            "accent": pick("button.background", "focusBorder", default="#0e639c"),
            "accent_hover": pick("button.hoverBackground", default="#1177bb"),
            "error": pick("editorError.foreground", default="#f48771"),
        }

    @classmethod
    def _vscode_theme_to_monaco(cls, data: Dict[str, Any], is_dark: bool) -> Dict[str, Any]:
        rules = []
        seen_tokens = set()
        for entry in data.get("tokenColors", []):
            settings = entry.get("settings", {})
            fg = settings.get("foreground", "")
            font_style = settings.get("fontStyle", "")
            if not fg and not font_style:
                continue

            scopes = entry.get("scope", [])
            if isinstance(scopes, str):
                scopes = [s.strip() for s in scopes.split(",")]

            for scope in scopes:
                if not scope:
                    continue
                # Map TextMate scope to the closest Monaco monarch token
                token = None
                for prefix in sorted(_SCOPE_TO_MONACO, key=len, reverse=True):
                    if scope == prefix or scope.startswith(prefix + "."):
                        token = _SCOPE_TO_MONACO[prefix]
                        break
                for t in {token, scope} - {None}:
                    if t in seen_tokens:
                        continue
                    seen_tokens.add(t)
                    rule = {"token": t}
                    if fg:
                        rule["foreground"] = fg.lstrip("#")
                    if font_style:
                        rule["fontStyle"] = font_style
                    rules.append(rule)

        colors = {}
        for key, val in data.get("colors", {}).items():
            if isinstance(val, str) and val.startswith("#"):
                colors[key] = val

        return {
            "base": "vs-dark" if is_dark else "vs",
            "inherit": True,
            "rules": rules,
            "colors": colors,
        }

    @classmethod
    def set_zoom_level(cls, app: QApplication, zoom_level: int):
        cls._current_zoom_level = zoom_level
        scale = 1.1 ** zoom_level
        import re

        def repl(m):
            prop = m.group(1)
            val = int(m.group(2))
            if val <= 2: return m.group(0) # Keep borders unscaled
            
            new_val = int(val * scale)
            if "font-size" in prop:
                new_val = max(6, new_val)
            else:
                new_val = max(1, new_val)
                
            return f"{prop}: {new_val}px"

        pattern = re.compile(r'([a-zA-Z-]+)\s*:\s*(\d+)px')

        # 1. Scale global stylesheet
        orig_global = app.property("original_stylesheet")
        if not orig_global:
            orig_global = app.styleSheet()
            app.setProperty("original_stylesheet", orig_global)
            
        if orig_global:
            app.setStyleSheet(pattern.sub(repl, orig_global))

        # 2. Scale all widgets
        for w in app.allWidgets():
            if w.inherits("QWebEngineView"):
                # Use QWebEngineView's native zoom factor
                w.setZoomFactor(scale)
                continue
                
            orig = w.property("original_stylesheet")
            if not orig:
                orig = w.styleSheet()
                if not orig: continue
                w.setProperty("original_stylesheet", orig)
                
            if orig:
                scaled = pattern.sub(repl, orig)
                if scaled != w.styleSheet():
                    w.setStyleSheet(scaled)

    @classmethod
    def apply_theme(cls, app: QApplication, theme_id: str):
        if theme_id in cls.EXT_THEMES:
            return cls._apply_extension_theme(app, theme_id)

        if theme_id not in cls.THEMES:
            theme_id = "dark+"
            
        cls._current_theme = theme_id
        theme_data = cls.THEMES[theme_id]
        c = theme_data["colors"]
        
        is_dark = theme_data.get("type", "dark") != "light"
        cls._monaco_theme_data = {
            "base": "vs-dark" if is_dark else "vs",
            "inherit": True,
            "rules": [],
            "colors": {
                "editor.background": c["background"],
                "editor.foreground": c["foreground"],
                "editor.selectionBackground": c["selection"],
                "editor.lineHighlightBackground": c["hover"] + "22" if c["hover"].startswith("#") else c["hover"],
                "editorCursor.foreground": c["accent"],
                "editorBracketMatch.background": c["selection"] + "40" if c["selection"].startswith("#") else c["selection"],
                "editorBracketMatch.border": c["border"],
                "editorWidget.background": c["background"],
                "editorWidget.border": c["border"],
                "editorSuggestWidget.background": c["background"],
                "editorSuggestWidget.border": c["border"],
                "editorSuggestWidget.selectedBackground": c["selection"],
                "editorHoverWidget.background": c["background"],
                "editorHoverWidget.border": c["border"],
            }
        }
        
        cls._apply_shell_colors(app, c)

    @classmethod
    def _apply_extension_theme(cls, app: QApplication, theme_id: str):
        """Apply a VS Code color theme contributed by an installed extension."""
        info = cls.EXT_THEMES[theme_id]
        try:
            data = _load_vscode_theme(info["path"])
        except Exception:
            return

        is_dark = (data.get("type") or info["type"]) != "light"
        cls._current_theme = theme_id
        cls._monaco_theme_data = cls._vscode_theme_to_monaco(data, is_dark)
        c = cls._vscode_theme_to_shell_colors(data, is_dark)
        cls._apply_shell_colors(app, c)

    @classmethod
    def _apply_shell_colors(cls, app: QApplication, c: Dict[str, str]):
        cls._current_shell_colors = c
        # 1. Update global stylesheet
        tooltip_bg = "#1e1e1e" if c["background"] in ("#000000",) else c["background"]
        is_dark = c["background"].lower() in (
            "#000000", "#0d1117", "#010409", "#002b36", "#002129", "#001e27",
            "#272822", "#1e1f1c", "#282c34", "#21252b",
        )
        if is_dark:
            dialog_bg = "#1e1e1e"
            btn_bg = "#333333"
            btn_hover = "#444444"
            btn_text = "#e6e6e6"
            btn_border = "#555555"
            primary_bg = "#0e639c"
            primary_hover = "#1177bb"
        else:
            dialog_bg = c.get("sidebar", "#f3f3f3")
            btn_bg = "#e8e8e8"
            btn_hover = "#dadada"
            btn_text = c["foreground"]
            btn_border = c["border"]
            primary_bg = c["accent"]
            primary_hover = c["accent_hover"]
        stylesheet = f"""
        QMainWindow {{ background-color: {c['background']}; color: {c['foreground']}; }}
        QWidget {{ color: {c['foreground']}; font-family: 'Segoe UI', 'Inter', sans-serif; }}
        
        QMenuBar {{ background-color: {c['background']}; color: {c['foreground']}; border: none; padding: 0px; font-size: 13px; }}
        QMenuBar::item {{ background: transparent; padding: 4px 10px; }}
        QMenuBar::item:selected {{ background-color: {c['hover']}; border-radius: 4px; }}
        QMenuBar::item:pressed {{ background-color: {c['selection']}; }}
        
        QMenu {{ background-color: {c['background']}; color: {c['foreground']}; border: 1px solid {c['border']}; padding: 4px 0px; }}
        QMenu::item {{ padding: 6px 30px 6px 30px; }}
        QMenu::item:selected {{ background-color: {c['selection']}; }}
        QMenu::separator {{ height: 1px; background-color: {c['border']}; margin: 4px 0px; }}
        QMenu::indicator {{ width: 16px; height: 16px; left: 8px; }}
        QMenu::indicator:non-exclusive:checked {{ image: url(image/menu_check.svg); }}
        QMenu::indicator:non-exclusive:unchecked {{ image: none; }}
        
        QSplitter::handle {{ background-color: {c['border']}; }}
        QSplitter::handle:hover {{ background-color: {c['accent']}; }}
        
        QScrollBar:vertical {{ background-color: transparent; width: 0px; border: none; margin: 0px; }}
        QScrollBar::handle:vertical {{ background-color: transparent; }}
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0px; background: transparent; border: none; }}
        QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{ background: transparent; border: none; }}
        
        QPushButton {{ background-color: {c['accent']}; color: #ffffff; border: none; border-radius: 2px; padding: 6px 16px; font-size: 13px; }}
        QPushButton:hover {{ background-color: {c['accent_hover']}; }}
        
        QToolTip {{
            background-color: {tooltip_bg};
            color: {c['foreground']};
            border: 1px solid {c['border']};
            font-size: 12px;
            padding: 4px;
            border-radius: 2px;
        }}

        QDialog {{
            background-color: {dialog_bg};
            color: {btn_text};
        }}
        QMessageBox {{
            background-color: {dialog_bg};
            color: {btn_text};
        }}
        QMessageBox QLabel {{
            color: {btn_text};
            background-color: transparent;
        }}
        QDialogButtonBox QPushButton, QMessageBox QPushButton {{
            background-color: {btn_bg};
            color: {btn_text};
            border: 1px solid {btn_border};
            border-radius: 2px;
            padding: 6px 16px;
            min-width: 72px;
            font-size: 13px;
        }}
        QDialogButtonBox QPushButton:hover, QMessageBox QPushButton:hover {{
            background-color: {btn_hover};
        }}
        QDialogButtonBox QPushButton:default, QMessageBox QPushButton:default {{
            background-color: {primary_bg};
            color: #ffffff;
            border: 1px solid {primary_bg};
        }}
        QDialogButtonBox QPushButton:default:hover, QMessageBox QPushButton:default:hover {{
            background-color: {primary_hover};
        }}
        QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QComboBox:focus, QListWidget:focus, QTreeWidget:focus, QPushButton:focus {{
            border: 1px solid {c['accent']};
            outline: none;
        }}
        """
        
        app.setProperty("original_stylesheet", stylesheet)
        app.setProperty("color_patched_stylesheet", stylesheet)
        cls._patch_existing_widget_styles(app, c)
        
        # Apply zoom which handles setting the final stylesheets
        cls.set_zoom_level(app, cls._current_zoom_level)
        
        # 2. Update Qt Palette for native controls
        palette = QPalette()
        palette.setColor(QPalette.Window, QColor(c["background"]))
        palette.setColor(QPalette.WindowText, QColor(c["foreground"]))
        palette.setColor(QPalette.Base, QColor(c["sidebar"]))
        palette.setColor(QPalette.Text, QColor(c["foreground"]))
        palette.setColor(QPalette.Button, QColor(c["background"]))
        palette.setColor(QPalette.ButtonText, QColor(c["foreground"]))
        palette.setColor(QPalette.Highlight, QColor(c["selection"]))
        palette.setColor(QPalette.HighlightedText, QColor(c["foreground"]))
        
        # Sync native tooltips colors
        palette.setColor(QPalette.ToolTipBase, QColor(tooltip_bg))
        palette.setColor(QPalette.ToolTipText, QColor(c["foreground"]))
        
        app.setPalette(palette)

    @classmethod
    def apply_product_icon_theme(cls, theme_id: str):
        """Product Icon Themes - Codicon icon customization"""
        pass

    @classmethod
    def preview_theme(cls, theme_id: str):
        """Theme Preview - live preview saat scrolling themes"""
        pass
        
    @classmethod
    def apply_high_contrast(cls):
        """High Contrast Themes - high contrast dark & light themes"""
        pass
        
    @classmethod
    def apply_color_customizations(cls, customizations: dict):
        """Workbench Color Customization - workbench.colorCustomizations"""
        if not customizations:
            return
        if cls._monaco_theme_data and "colors" in cls._monaco_theme_data:
            cls._monaco_theme_data["colors"].update(customizations)

    @classmethod
    def apply_token_color_customizations(cls, customizations: dict):
        """Token Color Customization - editor.tokenColorCustomizations"""
        if not customizations:
            return
        if cls._monaco_theme_data:
            textmate_rules = customizations.get("textMateRules", [])
            for rule in textmate_rules:
                scopes = rule.get("scope", [])
                if isinstance(scopes, str):
                    scopes = [scopes]
                settings = rule.get("settings", {})
                for scope in scopes:
                    cls._monaco_theme_data["rules"].append({
                        "token": scope,
                        "foreground": settings.get("foreground", "").lstrip("#"),
                        "fontStyle": settings.get("fontStyle", "")
                    })
        
    @classmethod
    def apply_custom_css_tokens(cls, tokens: dict):
        """Custom CSS Tokens - theme customization per token"""
        pass

    @classmethod
    def get_style_for_category(cls, category: str) -> str:
        pass

    @classmethod
    def _get_replacements(cls, c: Dict[str, str]) -> Dict[str, str]:
        replacements = {
            "#000000": c["background"],
            "#080808": c.get("sidebar", c["background"]),
            "#0d0d0d": c.get("sidebar", c["background"]),
            "#1a1a1a": c["hover"],
            "#1a0033": c["hover"],
            "#2c004a": c["selection"],
            "#3c0068": c["border"],
            "#4a0072": c["accent"],
            "#6d00b8": c["accent"],
            "#8b2cff": c["accent_hover"],
            "#a855f7": c["accent"],
            "#04395e": c["selection"],
            "#cccccc": c["foreground"],
            "#ffffff": c["foreground"],
            "rgba(124, 58, 237, 0.16)": c["hover"],
            "rgba(124, 58, 237, 0.12)": c["selection"],
        }
        replacements[c["foreground"]] = c["foreground"]
        replacements[c["background"]] = c["background"]
        return replacements

    @classmethod
    def get_canonical_colors(cls) -> Dict[str, str]:
        """Return the base color strings used for dynamic stylesheet replacement."""
        return {
            "background": "#000000",
            "sidebar": "#080808",
            "hover": "#1a0033",
            "selection": "#2c004a",
            "border": "#3c0068",
            "accent": "#6d00b8",
            "accent_hover": "#8b2cff",
            "foreground": "#cccccc",
        }

    @classmethod
    def patch_widget(cls, widget: QWidget):
        if not cls._current_theme: return
        c = getattr(cls, "_current_shell_colors", None)
        if not c:
            c = cls.THEMES.get(cls._current_theme, {}).get("colors")
        if not c: return
        
        replacements = cls._get_replacements(c)
        widgets = [widget] + widget.findChildren(QWidget)
        for w in widgets:
            original_style = w.property("original_stylesheet")
            if original_style is None:
                original_style = w.styleSheet()
                if not original_style:
                    continue
                w.setProperty("original_stylesheet", original_style)
            elif not original_style:
                continue

            patched = original_style
            for old, new in replacements.items():
                patched = patched.replace(old, new)
            if patched != w.styleSheet():
                w.setStyleSheet(patched)
            w.update()

    @classmethod
    def _patch_existing_widget_styles(cls, app: QApplication, c: Dict[str, str]):
        replacements = cls._get_replacements(c)

        for widget in app.allWidgets():
            original_style = widget.property("original_stylesheet")
            if original_style is None:
                original_style = widget.styleSheet()
                if not original_style:
                    continue
                widget.setProperty("original_stylesheet", original_style)
            elif not original_style:
                continue

            patched = original_style
            for old, new in replacements.items():
                patched = patched.replace(old, new)
            
            widget.setProperty("color_patched_stylesheet", patched)
            
