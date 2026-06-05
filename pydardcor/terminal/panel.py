import os
from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QStackedWidget, QTabBar

from .instance import TerminalInstance

class TerminalPanel(QWidget):
    """VS Code style terminal panel with multiple tab support."""

    def __init__(self, root_path=None, parent=None):
        super().__init__(parent)
        self._terminals = []
        self._current_workdir = root_path or os.path.expanduser("~")
        self.setObjectName("terminalPanel")
        self._setup_ui()
        self._new_terminal()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header bar
        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("""
            background-color: #000000;
            border-top: 1px solid #3c0068;
        """)
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(0, 0, 4, 0)
        header_layout.setSpacing(0)

        # Panel tabs
        panel_tabs = QWidget()
        pt_layout = QHBoxLayout(panel_tabs)
        pt_layout.setContentsMargins(0, 0, 0, 0)
        pt_layout.setSpacing(0)

        for label, active in [("PROBLEMS", False), ("OUTPUT", False),
                               ("TERMINAL", True), ("DEBUG CONSOLE", False)]:
            btn = QPushButton(label)
            btn.setFixedHeight(35)
            is_active = (label == "TERMINAL")
            btn.setStyleSheet(f"""
                QPushButton {{
                    background: transparent;
                    color: {"#cccccc" if is_active else "#888888"};
                    border: none;
                    border-bottom: {"1px solid #cccccc" if is_active else "1px solid transparent"};
                    padding: 0px 14px;
                    font-size: 11px;
                    font-weight: {"bold" if is_active else "normal"};
                    letter-spacing: 0.5px;
                }}
                QPushButton:hover {{
                    color: #cccccc;
                }}
            """)
            pt_layout.addWidget(btn)

        header_layout.addWidget(panel_tabs)

        # Terminal tab bar (for multiple terminals)
        self._tab_bar = QTabBar()
        self._tab_bar.setTabsClosable(True)
        self._tab_bar.setMovable(True)
        self._tab_bar.setExpanding(False)
        self._tab_bar.setStyleSheet("""
            QTabBar {
                background: transparent;
                border: none;
            }
            QTabBar::tab {
                background: #000000;
                color: #969696;
                padding: 4px 16px;
                border: none;
                border-right: 1px solid #3c0068;
                font-size: 12px;
                min-width: 60px;
            }
            QTabBar::tab:selected {
                background: #000000;
                color: #cccccc;
                border-bottom: 1px solid #007acc;
            }
            QTabBar::tab:hover:!selected {
                color: #cccccc;
            }
            QTabBar::close-button {
                image: none;
                background: transparent;
                color: #888888;
                subcontrol-position: right;
                padding-right: 2px;
            }
        """)
        self._tab_bar.tabCloseRequested.connect(self._close_tab)
        self._tab_bar.currentChanged.connect(self._switch_tab)
        header_layout.addWidget(self._tab_bar, 1)

        # Action buttons
        for icon, tooltip in [
            ("+", "New Terminal"),
            ("\\u2716", "Kill Terminal"),
            ("\\u2715", "Close Panel"),
        ]:
            btn = QPushButton(icon)
            btn.setFixedSize(28, 28)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent; border: none;
                    color: #cccccc; font-size: 12px;
                    border-radius: 3px;
                }
                QPushButton:hover {
                    background-color: rgba(90,93,94,0.31);
                }
            """)
            if icon == "+":
                btn.clicked.connect(self._new_terminal)
            elif icon == "\\u2716":
                btn.clicked.connect(self._kill_current)
            elif icon == "\\u2715":
                btn.clicked.connect(lambda: self.hide())
            header_layout.addWidget(btn)

        layout.addWidget(header)

        # Terminal stack
        self._stack = QStackedWidget()
        layout.addWidget(self._stack)

    def _new_terminal(self):
        idx = len(self._terminals)
        term = TerminalInstance(workdir=self._current_workdir)
        self._terminals.append(term)
        self._stack.addWidget(term)
        self._tab_bar.addTab(f"Terminal {idx + 1}")
        self._stack.setCurrentWidget(term)
        self._tab_bar.setCurrentIndex(idx)
        if not self.isVisible():
            self.show()

    def _close_tab(self, idx):
        if len(self._terminals) <= 1:
            return
        term = self._terminals[idx]
        term.kill()
        self._terminals.pop(idx)
        self._stack.removeWidget(term)
        self._tab_bar.removeTab(idx)
        term.deleteLater()

    def _kill_current(self):
        idx = self._tab_bar.currentIndex()
        self._close_tab(idx)

    def _switch_tab(self, idx):
        if 0 <= idx < len(self._terminals):
            self._stack.setCurrentWidget(self._terminals[idx])

    def set_workdir(self, path):
        self._current_workdir = path
        current = self._stack.currentWidget()
        if isinstance(current, TerminalInstance):
            current.set_workdir(path)

    def clear(self):
        current = self._stack.currentWidget()
        if isinstance(current, TerminalInstance):
            current.clear()

    def closeEvent(self, event):
        for term in self._terminals:
            term.kill()
        super().closeEvent(event)
