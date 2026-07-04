"""Outline Panel - VS Code style outline view for current file."""

import ast
import os
import re

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QSizePolicy
)
from PySide6.QtCore import Signal, Qt, QSize
from PySide6.QtGui import QColor, QIcon, QPainter, QPen


def parse_outline_symbols(content: str, file_path: str = "") -> list:
    """Parse enough symbols for editor outline across common text files."""
    ext = os.path.splitext(file_path.lower())[1]
    if ext == ".py":
        return _parse_python_symbols(content)
    if ext in {".js", ".jsx", ".ts", ".tsx"}:
        return _parse_js_symbols(content)
    if ext == ".vue":
        return _parse_vue_symbols(content)
    return _parse_text_symbols(content)


def _parse_python_symbols(content: str) -> list:
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return _parse_text_symbols(content)

    symbols = []

    def add_children(node, target):
        for child in getattr(node, "body", []):
            if isinstance(child, ast.ClassDef):
                item = {"name": child.name, "type": "class", "line": child.lineno, "children": []}
                target.append(item)
                add_children(child, item["children"])
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                item = {"name": child.name, "type": "function", "line": child.lineno, "children": []}
                target.append(item)
                add_children(child, item["children"])
            elif isinstance(child, (ast.Assign, ast.AnnAssign)):
                name = _python_assignment_name(child)
                if name:
                    target.append({"name": name, "type": "variable", "line": child.lineno, "children": []})

    add_children(tree, symbols)
    return symbols


def _python_assignment_name(node) -> str:
    if isinstance(node, ast.AnnAssign):
        return node.target.id if isinstance(node.target, ast.Name) else ""
    for target in getattr(node, "targets", []):
        if isinstance(target, ast.Name):
            return target.id
    return ""


def _parse_js_symbols(content: str) -> list:
    patterns = [
        (r"^\s*(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)", "class"),
        (r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", "function"),
        (r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^=]*\)\s*=>", "function"),
        (r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b", "function"),
        (r"^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", "method"),
    ]
    symbols = []
    for line_no, line in enumerate(content.splitlines(), 1):
        if line.lstrip().startswith("//"):
            continue
        for pattern, kind in patterns:
            match = re.match(pattern, line)
            if match:
                symbols.append({"name": match.group(1), "type": kind, "line": line_no, "children": []})
                break
    return symbols or _parse_text_symbols(content)


def _parse_vue_symbols(content: str) -> list:
    symbols = []
    template = re.search(r"<template\b[^>]*>(.*?)</template>", content, re.IGNORECASE | re.DOTALL)
    if template:
        start_line = content[:template.start(1)].count("\n")
        for offset, line in enumerate(template.group(1).splitlines(), start_line + 1):
            match = re.search(r"<([A-Z][\w.-]*)\b", line)
            if match:
                symbols.append({"name": match.group(1), "type": "class", "line": offset, "children": []})

    for script in re.finditer(r"<script\b[^>]*>(.*?)</script>", content, re.IGNORECASE | re.DOTALL):
        line_offset = content[:script.start(1)].count("\n")
        for sym in _parse_js_symbols(script.group(1)):
            entry = dict(sym)
            entry["line"] = line_offset + sym["line"]
            symbols.append(entry)
    return symbols or _parse_text_symbols(content)


def _parse_text_symbols(content: str) -> list:
    symbols = []
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped:
            continue
        markdown = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if markdown:
            symbols.append({"name": markdown.group(2).strip(), "type": "section", "line": line_no, "children": []})
        elif stripped.endswith(":") and len(stripped) <= 80:
            symbols.append({"name": stripped[:-1].strip(), "type": "section", "line": line_no, "children": []})
    return symbols[:100]


class SectionHeaderButton(QPushButton):
    """Custom button that draws a VS Code-style vector chevron to match FileExplorer."""
    def __init__(self, text, collapsed=True, parent=None):
        super().__init__(text, parent)
        self._collapsed = collapsed
        self.setMinimumHeight(24)
        self.setCursor(Qt.PointingHandCursor)
        self.setObjectName("SectionHeaderButton")
        
        # Load colors from ThemeManager if available
        bg_color = "#000000"
        fg_color = "#cccccc"
        hover_color = "#1a1a1a"
        border_color = "#3c0068"
        try:
            from pydardcor.app.theme_manager import ThemeManager
            theme = ThemeManager.THEMES.get(ThemeManager._current_theme, {})
            colors = theme.get("colors", {})
            bg_color = colors.get("background", bg_color)
            fg_color = colors.get("foreground", fg_color)
            hover_color = colors.get("hover", hover_color)
            # Use fixed purple for section borders
            border_color = "#3c0068"
        except Exception:
            pass

        self.setStyleSheet(f"""
            QPushButton#SectionHeaderButton {{
                background-color: {bg_color};
                color: {fg_color};
                font-family: "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
                font-size: 11px;
                font-weight: bold;
                text-align: left;
                padding-left: 14px;
                padding-top: 2px;
                padding-bottom: 2px;
                border: none;
                border-top: 1px solid {border_color};
            }}
            QPushButton#SectionHeaderButton:hover {{
                background-color: {hover_color};
            }}
        """)

    def set_collapsed(self, collapsed):
        self._collapsed = collapsed
        self.update()

    def paintEvent(self, event):
        super().paintEvent(event)
        
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        cx = 6
        cy = self.height() // 2

        pen = QPen(QColor("#858585"))
        pen.setWidth(2)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)

        if self._collapsed:
            # > rightward chevron
            painter.drawLine(cx - 2, cy - 3, cx + 2, cy)
            painter.drawLine(cx + 2, cy, cx - 2, cy + 3)
        else:
            # v downward chevron
            painter.drawLine(cx - 3, cy - 2, cx, cy + 2)
            painter.drawLine(cx, cy + 2, cx + 3, cy - 2)

        painter.end()


class OutlinePanel(QWidget):
    """Panel showing symbols (classes, functions, etc) for the active file."""

    item_selected = Signal(int)  # Emit line number to jump to
    toggled = Signal(bool)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._collapsed = True
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header - VS Code style collapsible section header
        self._header = SectionHeaderButton("Outline", self._collapsed)
        self._header.clicked.connect(self._toggle_collapse)
        layout.addWidget(self._header)

        # Tree
        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(16)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 12px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 2px;
                border: none;
            }
            QTreeWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QTreeWidget::item:hover {
                background-color: #2a2d2e;
            }
        """)
        self._tree.itemClicked.connect(self._on_item_clicked)
        layout.addWidget(self._tree)

        # Start collapsed
        self._tree.hide()

    def _update_header_text(self):
        self._header.set_collapsed(self._collapsed)

    def _toggle_collapse(self):
        self._collapsed = not self._collapsed
        self._tree.setVisible(not self._collapsed)
        self._update_header_text()
        self.toggled.emit(self._collapsed)

    def set_symbols(self, symbols: list):
        """
        symbols: list of dicts: {'name': str, 'type': str, 'line': int, 'children': list}
        """
        self._tree.clear()
        if not symbols:
            item = QTreeWidgetItem(["No symbols found"])
            item.setForeground(0, QColor("#888888"))
            self._tree.addTopLevelItem(item)
            return

        def add_nodes(parent_item, syms):
            for sym in syms:
                item = QTreeWidgetItem([sym.get('name', 'Unknown')])
                icon_text = "{} "  # fallback
                t = sym.get('type', '')
                if t == 'class':
                    icon_text = "🅲 "
                elif t == 'function' or t == 'method':
                    icon_text = "🅼 "
                elif t == 'variable':
                    icon_text = "🆅 "
                elif t == 'section':
                    icon_text = "# "
                
                item.setText(0, f"{icon_text}{sym.get('name')}")
                item.setData(0, Qt.UserRole, sym.get('line', 1))
                
                if parent_item:
                    parent_item.addChild(item)
                else:
                    self._tree.addTopLevelItem(item)
                    
                if sym.get('children'):
                    add_nodes(item, sym.get('children'))

        add_nodes(None, symbols)
        self._tree.expandAll()

    def parse_and_set_symbols(self, file_path: str):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            self.set_symbols(parse_outline_symbols(content, file_path))
        except Exception:
            self.set_symbols([])

    def _on_item_clicked(self, item: QTreeWidgetItem, col: int):
        line = item.data(0, Qt.UserRole)
        if line:
            self.item_selected.emit(line)
