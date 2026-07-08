"""
View Pane Container — TASK-0054 & TASK-0055
==============================================
Tabbed view container untuk sidebar dengan view title actions.
Mirip: src/vs/workbench/browser/parts/views/viewPane.ts
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
        QScrollArea, QSizePolicy, QFrame, QSplitter
    )
    from PySide6.QtCore import Qt, Signal, QSize, QPoint
    from PySide6.QtGui import QFont, QMouseEvent
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    @dataclass
    class ViewPaneDescriptor:
        id: str
        title: str
        content_factory: Optional[Callable[[], "QWidget"]] = None
        actions: List[Dict] = field(default_factory=list)
        collapsible: bool = True
        initially_collapsed: bool = False
        weight: int = 1


    class ViewPaneHeader(QWidget):
        """Collapsible pane header — click to expand/collapse."""

        toggle_requested = Signal()

        def __init__(
            self,
            title: str,
            parent: Optional[QWidget] = None,
        ):
            super().__init__(parent)
            self._expanded = True
            self.setFixedHeight(28)
            self.setCursor(Qt.PointingHandCursor)
            self.setStyleSheet("background: #252526;")
            self._setup_ui(title)

        def _setup_ui(self, title: str) -> None:
            layout = QHBoxLayout(self)
            layout.setContentsMargins(8, 0, 6, 0)
            layout.setSpacing(4)

            self._chevron = QLabel("▾")
            self._chevron.setFixedWidth(12)
            self._chevron.setStyleSheet("color: #cccccc; font-size: 10px;")
            layout.addWidget(self._chevron)

            self._title_label = QLabel(title.upper())
            self._title_label.setStyleSheet(
                "color: #bbbcbe; font-size: 11px; font-weight: 600; letter-spacing: 0.8px;"
            )
            self._title_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            layout.addWidget(self._title_label)

            self._actions_widget = QWidget()
            self._actions_layout = QHBoxLayout(self._actions_widget)
            self._actions_layout.setContentsMargins(0, 0, 0, 0)
            self._actions_layout.setSpacing(2)
            self._actions_widget.setVisible(False)
            layout.addWidget(self._actions_widget)

        def add_action(
            self,
            icon: str,
            tooltip: str,
            handler: Optional[Callable] = None,
        ) -> QPushButton:
            btn = QPushButton(icon)
            btn.setFixedSize(20, 20)
            btn.setToolTip(tooltip)
            btn.setFont(QFont("codicon", 12))
            btn.setStyleSheet(
                "QPushButton { background: transparent; border: none; color: #cccccc; border-radius: 3px; }"
                "QPushButton:hover { background: rgba(255,255,255,0.1); }"
            )
            if handler:
                btn.clicked.connect(handler)
            self._actions_layout.addWidget(btn)
            return btn

        def set_expanded(self, expanded: bool) -> None:
            self._expanded = expanded
            self._chevron.setText("▾" if expanded else "▸")

        @property
        def is_expanded(self) -> bool:
            return self._expanded

        def mousePressEvent(self, event: "QMouseEvent") -> None:
            if event.button() == Qt.LeftButton:
                self.toggle_requested.emit()
            super().mousePressEvent(event)

        def enterEvent(self, event) -> None:
            self._actions_widget.setVisible(True)
            super().enterEvent(event)

        def leaveEvent(self, event) -> None:
            self._actions_widget.setVisible(False)
            super().leaveEvent(event)


    class ViewPane(QWidget):
        """
        A single collapsible view pane.
        Contains a header and a content widget.
        """

        def __init__(
            self,
            descriptor: "ViewPaneDescriptor",
            parent: Optional[QWidget] = None,
        ):
            super().__init__(parent)
            self._descriptor = descriptor
            self._content: Optional[QWidget] = None
            self._setup_ui()

        def _setup_ui(self) -> None:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)

            self._header = ViewPaneHeader(self._descriptor.title, self)
            self._header.toggle_requested.connect(self._toggle)
            layout.addWidget(self._header)

            # Add actions from descriptor
            for action in self._descriptor.actions:
                self._header.add_action(
                    action.get("icon", ""),
                    action.get("tooltip", ""),
                    action.get("handler"),
                )

            self._content_area = QWidget()
            self._content_area.setStyleSheet("background: #1e1e1e;")
            self._content_layout = QVBoxLayout(self._content_area)
            self._content_layout.setContentsMargins(0, 0, 0, 0)
            layout.addWidget(self._content_area, 1)

            # Create content from factory
            if self._descriptor.content_factory:
                content = self._descriptor.content_factory()
                if content:
                    self._content = content
                    self._content_layout.addWidget(content)

            # Initially collapsed?
            if self._descriptor.initially_collapsed:
                self._set_expanded(False)

        def _toggle(self) -> None:
            self._set_expanded(not self._header.is_expanded)

        def _set_expanded(self, expanded: bool) -> None:
            self._header.set_expanded(expanded)
            self._content_area.setVisible(expanded)

        def set_content(self, widget: QWidget) -> None:
            if self._content:
                self._content_layout.removeWidget(self._content)
                self._content.setParent(None)
            self._content = widget
            self._content_layout.addWidget(widget)

        def get_content(self) -> Optional[QWidget]:
            return self._content

        @property
        def view_id(self) -> str:
            return self._descriptor.id


    class ViewPaneContainer(QWidget):
        """
        Container for multiple ViewPanes in a sidebar.
        Panes are stacked vertically with a splitter.
        """

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._panes: Dict[str, ViewPane] = {}
            self._setup_ui()

        def _setup_ui(self) -> None:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)

            self._splitter = QSplitter(Qt.Vertical, self)
            self._splitter.setHandleWidth(2)
            self._splitter.setStyleSheet("""
                QSplitter::handle { background: #3c3c3c; }
                QSplitter::handle:hover { background: #555; }
            """)
            layout.addWidget(self._splitter)

        def add_pane(self, descriptor: "ViewPaneDescriptor") -> "ViewPane":
            """Add a view pane to the container."""
            pane = ViewPane(descriptor, self)
            self._panes[descriptor.id] = pane
            self._splitter.addWidget(pane)
            return pane

        def get_pane(self, view_id: str) -> Optional["ViewPane"]:
            return self._panes.get(view_id)

        def remove_pane(self, view_id: str) -> None:
            pane = self._panes.pop(view_id, None)
            if pane:
                pane.setParent(None)
                pane.deleteLater()

        def get_all_panes(self) -> List["ViewPane"]:
            return list(self._panes.values())

else:
    class ViewPaneDescriptor:  # type: ignore
        pass

    class ViewPane:  # type: ignore
        pass

    class ViewPaneContainer:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def add_pane(self, *args, **kwargs):
            pass
