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

        # We move the terminal controls into a toolbar widget to be embedded in BottomPanel
        self._toolbar = QWidget()
        tb_layout = QHBoxLayout(self._toolbar)
        tb_layout.setContentsMargins(0, 0, 0, 0)
        tb_layout.setSpacing(0)

        from PySide6.QtWidgets import QComboBox, QSizePolicy
        self._combo_box = QComboBox()
        self._combo_box.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Fixed)
        self._combo_box.setStyleSheet("""
            QComboBox {
                background: transparent;
                border: none;
                color: #cccccc;
                font-family: "Segoe UI", sans-serif;
                font-size: 12px;
                padding: 0px 8px;
            }
            QComboBox::drop-down {
                border: none;
                background: transparent;
                width: 15px;
            }
            QComboBox QAbstractItemView {
                background-color: #252526;
                color: #cccccc;
                border: 1px solid #454545;
                selection-background-color: #094771;
            }
        """)
        self._combo_box.currentIndexChanged.connect(self._switch_tab)
        tb_layout.addWidget(self._combo_box)

        from PySide6.QtGui import QFont
        # Action buttons
        for icon, tooltip in [
            ("\uea60", "New Terminal"),
            ("\ueab0", "Launch Profile"),
            ("\uea6a", "Split Terminal"),
            ("\uea87", "Kill Terminal"),
            ("\uea7c", "More Actions..."),
        ]:
            btn = QPushButton(icon)
            btn.setFont(QFont("codicon", 14))
            btn.setFixedSize(28, 28)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent; border: none;
                    color: #cccccc; font-size: 14px;
                    font-family: "codicon";
                    border-radius: 3px;
                }
                QPushButton:hover {
                    background-color: rgba(90,93,94,0.31);
                }
            """)
            if icon == "\uea60":
                btn.clicked.connect(self._new_terminal)
            elif icon == "\uea87":
                btn.clicked.connect(self._kill_current)
            tb_layout.addWidget(btn)

        # Terminal stack
        self._stack = QStackedWidget()
        layout.addWidget(self._stack)

    def get_toolbar(self):
        return self._toolbar

    def _new_terminal(self):
        idx = len(self._terminals)
        term = TerminalInstance(workdir=self._current_workdir)
        self._terminals.append(term)
        self._stack.addWidget(term)
        self._combo_box.addItem(f"powershell ({idx + 1})")
        self._stack.setCurrentWidget(term)
        self._combo_box.setCurrentIndex(idx)
        if not self.isVisible():
            self.show()

    def _close_tab(self, idx):
        if len(self._terminals) <= 1:
            return
        term = self._terminals[idx]
        term.kill()
        self._terminals.pop(idx)
        self._stack.removeWidget(term)
        self._combo_box.removeItem(idx)
        term.deleteLater()

    def _kill_current(self):
        idx = self._combo_box.currentIndex()
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
