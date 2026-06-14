import os
from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QStackedWidget, QComboBox, QSizePolicy, QSplitter
from PySide6.QtCore import Qt

from .instance import TerminalInstance


class SplitTerminalContainer(QSplitter):
    """Container that holds and splits TerminalInstances horizontally."""
    
    def __init__(self, workdir, parent=None):
        super().__init__(Qt.Horizontal, parent)
        self.setHandleWidth(1)
        self.setStyleSheet("""
            QSplitter::handle {
                background-color: #3c0068;
            }
            QSplitter::handle:hover {
                background-color: #4a0072;
            }
        """)
        self.workdir = workdir
        self.instances = []
        self.add_instance()

    def add_instance(self):
        inst = TerminalInstance(workdir=self.workdir)
        self.instances.append(inst)
        self.addWidget(inst)
        inst.show()
        # Distribute width equally
        count = len(self.instances)
        if count > 1:
            w = self.width() // count if self.width() > 0 else 100
            self.setSizes([w] * count)
        return inst

    def kill_all(self):
        for inst in self.instances:
            inst.kill()


class TerminalPanel(QWidget):
    """VS Code style terminal panel with multiple tab and split support."""

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
            elif icon == "\uea6a":
                btn.clicked.connect(self._split_terminal)
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
        container = SplitTerminalContainer(workdir=self._current_workdir)
        self._terminals.append(container)
        self._stack.addWidget(container)
        self._combo_box.addItem(f"powershell ({idx + 1})")
        self._stack.setCurrentWidget(container)
        self._combo_box.setCurrentIndex(idx)
        if not self.isVisible():
            self.show()

    def _split_terminal(self):
        idx = self._combo_box.currentIndex()
        if 0 <= idx < len(self._terminals):
            container = self._terminals[idx]
            container.add_instance()

    def _close_tab(self, idx):
        if len(self._terminals) <= 1:
            # If there's only one tab, but it has multiple split instances, we can kill the active split instance!
            container = self._terminals[0]
            if len(container.instances) > 1:
                inst = container.instances.pop()
                inst.kill()
                inst.deleteLater()
            return
        container = self._terminals[idx]
        container.kill_all()
        self._terminals.pop(idx)
        self._stack.removeWidget(container)
        self._combo_box.removeItem(idx)
        container.deleteLater()

    def _kill_current(self):
        idx = self._combo_box.currentIndex()
        if 0 <= idx < len(self._terminals):
            container = self._terminals[idx]
            if len(container.instances) > 1:
                active_inst = None
                for inst in container.instances:
                    if inst.hasFocus():
                        active_inst = inst
                        break
                if not active_inst:
                    active_inst = container.instances[-1]
                
                active_inst.kill()
                container.instances.remove(active_inst)
                active_inst.deleteLater()
            else:
                self._close_tab(idx)

    def _switch_tab(self, idx):
        if 0 <= idx < len(self._terminals):
            self._stack.setCurrentWidget(self._terminals[idx])

    def set_workdir(self, path):
        self._current_workdir = path
        
        # When switching workspaces, we must kill old terminals 
        # and start a fresh one so the CWD is correctly applied.
        for container in self._terminals:
            container.kill_all()
            self._stack.removeWidget(container)
            container.deleteLater()
            
        self._terminals.clear()
        self._combo_box.clear()
        
        # Spawn a new terminal in the new workspace
        self._new_terminal()

    def clear(self):
        current = self._stack.currentWidget()
        if isinstance(current, SplitTerminalContainer):
            for inst in current.instances:
                inst.clear()

    def closeEvent(self, event):
        for container in self._terminals:
            container.kill_all()
        super().closeEvent(event)
