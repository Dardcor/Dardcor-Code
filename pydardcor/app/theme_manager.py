"""Theme Manager - VS Code style dynamic theming."""

import os
import json
from typing import Dict, Any, List

from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QPalette, QColor

class ThemeManager:
    """Manages color themes and dynamically applies stylesheets to QApplication."""
    
    _current_theme = "dark+"
    
    # Pre-defined base themes
    THEMES = {
        "dark+": {
            "name": "Dark+ (default dark)",
            "type": "dark",
            "colors": {
                "background": "#000000",
                "foreground": "#cccccc",
                "sidebar": "#000000",
                "activity_bar": "#000000",
                "activity_bar_fg": "#cccccc",
                "selection": "#2c004a",
                "hover": "#1a0033",
                "border": "#3c0068",
                "accent": "#4a0072",
                "accent_hover": "#5a009c",
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
    def get_theme_list(cls) -> List[Dict[str, str]]:
        """Return list of available themes for theme picker UI."""
        return [
            {"id": tid, "name": data["name"], "type": data["type"]}
            for tid, data in cls.THEMES.items()
        ]

    @classmethod
    def current_theme_id(cls) -> str:
        return cls._current_theme

    @classmethod
    def apply_theme(cls, app: QApplication, theme_id: str):
        if theme_id not in cls.THEMES:
            theme_id = "dark+"
            
        cls._current_theme = theme_id
        theme_data = cls.THEMES[theme_id]
        c = theme_data["colors"]
        
        # 1. Update global stylesheet
        tooltip_bg = "#1e1e1e" if c["background"] in ("#000000",) else c["background"]
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
        """
        
        app.setStyleSheet(stylesheet)
        
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
