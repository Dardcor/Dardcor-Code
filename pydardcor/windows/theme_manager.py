"""Theme Manager - VS Code style dynamic theming."""

import os
import json
from typing import Dict, Any

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
        }
    }

    @classmethod
    def apply_theme(cls, app: QApplication, theme_id: str):
        if theme_id not in cls.THEMES:
            theme_id = "dark+"
            
        cls._current_theme = theme_id
        theme_data = cls.THEMES[theme_id]
        c = theme_data["colors"]
        
        # 1. Update global stylesheet
        stylesheet = f"""
        QMainWindow {{ background-color: {c['background']}; color: {c['foreground']}; }}
        QWidget {{ color: {c['foreground']}; font-family: 'Segoe UI', 'Inter', sans-serif; }}
        
        QMenuBar {{ background-color: {c['background']}; color: {c['foreground']}; border: none; padding: 0px; font-size: 13px; }}
        QMenuBar::item {{ background: transparent; padding: 4px 10px; }}
        QMenuBar::item:selected {{ background-color: {c['hover']}; border-radius: 4px; }}
        QMenuBar::item:pressed {{ background-color: {c['selection']}; }}
        
        QMenu {{ background-color: {c['background']}; color: {c['foreground']}; border: 1px solid {c['border']}; padding: 4px 0px; }}
        QMenu::item {{ padding: 6px 30px 6px 20px; }}
        QMenu::item:selected {{ background-color: {c['selection']}; }}
        QMenu::separator {{ height: 1px; background-color: {c['border']}; margin: 4px 0px; }}
        
        QSplitter::handle {{ background-color: {c['border']}; }}
        QSplitter::handle:hover {{ background-color: {c['accent']}; }}
        
        QScrollBar:vertical {{ background-color: transparent; width: 0px; border: none; margin: 0px; }}
        QScrollBar::handle:vertical {{ background-color: transparent; }}
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0px; background: transparent; border: none; }}
        QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{ background: transparent; border: none; }}
        
        QPushButton {{ background-color: {c['accent']}; color: #ffffff; border: none; border-radius: 2px; padding: 6px 16px; font-size: 13px; }}
        QPushButton:hover {{ background-color: {c['accent_hover']}; }}
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
        app.setPalette(palette)
