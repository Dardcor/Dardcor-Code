from __future__ import annotations

import json
import os
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from PySide6.QtWidgets import QWidget

from PySide6.QtWidgets import QSplitter, QWidget as QW, QVBoxLayout, QHBoxLayout, QApplication
from PySide6.QtCore import Qt, QByteArray, QMimeData, QPoint, QRect, Signal, QObject
from PySide6.QtGui import QDrag, QPainter, QColor, QPen


class GridNode(QSplitter):
    """A node in the grid layout, either horizontal or vertical.
    Supports nested splitting for complex layouts.
    """

    def __init__(self, orientation=Qt.Horizontal, parent=None):
        super().__init__(orientation, parent)
        self.setChildrenCollapsible(False)
        self.setOpaqueResize(False)
        self.setHandleWidth(4)
        self.setStyleSheet("""
            QSplitter::handle {
                background: #2b2b2b;
            }
            QSplitter::handle:hover {
                background: #007acc;
            }
        """)

    def split_widget(self, widget: QW, new_widget: QW, orientation: Qt.Orientation):
        """Splits the space of an existing widget with a new widget."""
        index = self.indexOf(widget)
        if index == -1:
            return False
        if self.orientation() == orientation:
            self.insertWidget(index + 1, new_widget)
        else:
            sizes = self.sizes()
            sub_splitter = GridNode(orientation, self)
            widget.setParent(None)
            sub_splitter.addWidget(widget)
            sub_splitter.addWidget(new_widget)
            self.insertWidget(index, sub_splitter)
            self.setSizes(sizes)
        return True

    def remove_widget(self, widget: QW):
        """Remove a widget from this splitter, cleaning up empty sub-splitters."""
        index = self.indexOf(widget)
        if index == -1:
            return False
        widget.setParent(None)
        widget.hide()
        if self.count() == 0:
            parent_split = self.parent()
            while parent_split and not isinstance(parent_split, QSplitter):
                parent_split = parent_split.parent()
            if parent_split and isinstance(parent_split, QSplitter):
                parent_split_widget = parent_split
                my_index = parent_split_widget.indexOf(self)
                if my_index >= 0:
                    remaining = self.widget(0) if self.count() > 0 else None
                    self.setParent(None)
                    self.deleteLater()
                    if remaining:
                        parent_split_widget.insertWidget(my_index, remaining)
        return True

    def get_all_widgets(self) -> list[QW]:
        """Recursively collect all leaf widgets."""
        result = []
        for i in range(self.count()):
            w = self.widget(i)
            if isinstance(w, GridNode):
                result.extend(w.get_all_widgets())
            else:
                result.append(w)
        return result


class GridLayoutConfig:
    """Configuration for a specific grid layout preset."""

    def __init__(self, name: str = "single", orientation: Qt.Orientation = Qt.Horizontal,
                 columns: int = 1, rows: int = 1):
        self.name = name
        self.orientation = orientation
        self.columns = columns
        self.rows = rows

    @classmethod
    def from_preset(cls, preset: str) -> "GridLayoutConfig":
        mapping = {
            "single": cls("single", Qt.Horizontal, 1, 1),
            "two_columns": cls("two_columns", Qt.Horizontal, 2, 1),
            "three_columns": cls("three_columns", Qt.Horizontal, 3, 1),
            "two_rows": cls("two_rows", Qt.Vertical, 1, 2),
            "three_rows": cls("three_rows", Qt.Vertical, 1, 3),
            "grid_2x2": cls("grid_2x2", Qt.Horizontal, 2, 2),
            "grid_3x3": cls("grid_3x3", Qt.Horizontal, 3, 3),
            "three_right": cls("three_right", Qt.Horizontal, 2, 2),
        }
        return mapping.get(preset, cls())


class GridLayoutPreset:
    """Predefined layout presets matching VS Code editor layouts."""

    PRESETS = {
        "single": {"columns": 1, "rows": 1, "label": "Single"},
        "two_columns": {"columns": 2, "rows": 1, "label": "Two Columns"},
        "three_columns": {"columns": 3, "rows": 1, "label": "Three Columns"},
        "two_rows": {"columns": 1, "rows": 2, "label": "Two Rows"},
        "three_rows": {"columns": 1, "rows": 3, "label": "Three Rows"},
        "grid_2x2": {"columns": 2, "rows": 2, "label": "Grid (2x2)"},
        "grid_3x3": {"columns": 3, "rows": 3, "label": "Grid (3x3)"},
        "three_right": {"columns": 2, "rows": 2, "label": "Three Right"},
    }

    @classmethod
    def get_preset(cls, name: str) -> dict:
        return cls.PRESETS.get(name, cls.PRESETS["single"])

    @classmethod
    def get_names(cls) -> list[str]:
        return list(cls.PRESETS.keys())

    @classmethod
    def get_labels(cls) -> list[str]:
        return [p["label"] for p in cls.PRESETS.values()]


class GridLayoutSystem(QW):
    """Root of the grid layout system with support for multiple presets,
    drag-drop between groups, tab preview mode, and editor group splitting.
    """

    layout_changed = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.setSpacing(0)

        self.root_node = GridNode(Qt.Horizontal)
        self._layout.addWidget(self.root_node)

    def set_central_widget(self, widget: QW):
        while self.root_node.count():
            w = self.root_node.widget(0)
            w.setParent(None)
        self.root_node.addWidget(widget)

    def split(self, source_widget: QW, new_widget: QW, direction: str):
        """Split a widget in a specific direction: 'up', 'down', 'left', 'right'."""
        parent_node = source_widget.parent()
        while parent_node and not isinstance(parent_node, GridNode):
            parent_node = parent_node.parent()
        if not parent_node:
            parent_node = self.root_node

        orientation = Qt.Vertical if direction in ('up', 'down') else Qt.Horizontal

        if direction in ('up', 'left'):
            parent_node.split_widget(source_widget, new_widget, orientation)
            parent_node.insertWidget(parent_node.indexOf(source_widget), new_widget)
        else:
            parent_node.split_widget(source_widget, new_widget, orientation)

    def remove_widget(self, widget: QW):
        """Remove a widget from the layout, cleaning up empty nodes."""
        parent_node = widget.parent()
        while parent_node and not isinstance(parent_node, GridNode):
            parent_node = parent_node.parent()
        if parent_node and isinstance(parent_node, GridNode):
            parent_node.remove_widget(widget)

    def apply_preset(self, preset_name: str, groups: list[QW]) -> bool:
        """Apply a named preset layout using the provided list of group widgets."""
        config = GridLayoutConfig.from_preset(preset_name)
        needed = config.columns * config.rows

        while len(groups) < needed:
            from .group import EditorGroup
            new_group = EditorGroup(self)
            groups.append(new_group)

        for g in groups:
            g.setParent(None)

        if self.root_node:
            self._layout.removeWidget(self.root_node)
            self.root_node.deleteLater()

        if preset_name == "single":
            self.root_node = GridNode(Qt.Horizontal)
            self.root_node.addWidget(groups[0])

        elif preset_name == "two_columns":
            self.root_node = GridNode(Qt.Horizontal)
            self.root_node.addWidget(groups[0])
            self.root_node.addWidget(groups[1])

        elif preset_name == "three_columns":
            self.root_node = GridNode(Qt.Horizontal)
            self.root_node.addWidget(groups[0])
            self.root_node.addWidget(groups[1])
            self.root_node.addWidget(groups[2])

        elif preset_name == "two_rows":
            self.root_node = GridNode(Qt.Vertical)
            self.root_node.addWidget(groups[0])
            self.root_node.addWidget(groups[1])

        elif preset_name == "three_rows":
            self.root_node = GridNode(Qt.Vertical)
            self.root_node.addWidget(groups[0])
            self.root_node.addWidget(groups[1])
            self.root_node.addWidget(groups[2])

        elif preset_name == "grid_2x2":
            self.root_node = GridNode(Qt.Horizontal)
            col1 = GridNode(Qt.Vertical, self.root_node)
            col2 = GridNode(Qt.Vertical, self.root_node)
            col1.addWidget(groups[0])
            col1.addWidget(groups[1])
            col2.addWidget(groups[2])
            col2.addWidget(groups[3])
            self.root_node.addWidget(col1)
            self.root_node.addWidget(col2)

        elif preset_name == "grid_3x3":
            self.root_node = GridNode(Qt.Horizontal)
            for col_idx in range(3):
                col = GridNode(Qt.Vertical, self.root_node)
                for row_idx in range(3):
                    idx = col_idx * 3 + row_idx
                    if idx < len(groups):
                        col.addWidget(groups[idx])
                self.root_node.addWidget(col)

        elif preset_name == "three_right":
            self.root_node = GridNode(Qt.Horizontal)
            left_col = GridNode(Qt.Vertical, self.root_node)
            left_col.addWidget(groups[0])
            left_col.addWidget(groups[1])
            self.root_node.addWidget(left_col)
            self.root_node.addWidget(groups[2])

        else:
            self.root_node = GridNode(Qt.Horizontal)
            self.root_node.addWidget(groups[0])

        self._layout.addWidget(self.root_node)
        self.layout_changed.emit(preset_name)
        return True

    def get_current_preset(self) -> str:
        """Determine which preset the current layout most closely matches."""
        if not self.root_node:
            return "single"

        def _count_children(node: GridNode) -> tuple[int, int]:
            cols = 0
            rows = 0
            for i in range(node.count()):
                w = node.widget(i)
                if isinstance(w, GridNode):
                    c, r = _count_children(w)
                    cols += c
                    rows = max(rows, r)
                else:
                    cols += 1
                    rows = max(rows, 1)
            return cols, rows

        orientation = self.root_node.orientation()
        count = self.root_node.count()

        if count <= 1:
            return "single"
        if orientation == Qt.Horizontal:
            if count == 2:
                col1 = self.root_node.widget(0)
                col2 = self.root_node.widget(1)
                if isinstance(col1, GridNode) and col1.orientation() == Qt.Vertical and col1.count() == 2:
                    if isinstance(col2, GridNode) is False:
                        return "three_right"
                    return "grid_2x2"
                return "two_columns" if count == 2 else "three_columns"
            if count == 3:
                return "three_columns"
        if orientation == Qt.Vertical:
            if count == 2:
                return "two_rows"
            if count == 3:
                return "three_rows"
        return "single"
