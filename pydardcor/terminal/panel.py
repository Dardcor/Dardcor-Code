import os
import platform
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QStackedWidget,
    QComboBox, QSizePolicy, QSplitter, QListWidget, QListWidgetItem, QLabel
)
from PySide6.QtCore import Qt, QSize, QPoint
from PySide6.QtGui import QFont, QAction

from .instance import TerminalInstance
from .backend import get_shell_cmd


def get_available_shells():
    import platform
    import os
    shells = []
    if platform.system() == "Windows":
        # PowerShell
        pwsh_path = None
        for path in os.environ.get("PATH", "").split(os.pathsep):
            p = os.path.join(path, "pwsh.exe")
            if os.path.isfile(p):
                pwsh_path = p
                break
        if pwsh_path:
            shells.append({"name": "PowerShell (pwsh)", "path": pwsh_path})
        
        powershell_path = None
        for path in os.environ.get("PATH", "").split(os.pathsep):
            p = os.path.join(path, "powershell.exe")
            if os.path.isfile(p):
                powershell_path = p
                break
        if powershell_path:
            shells.append({"name": "PowerShell (powershell)", "path": powershell_path})
            
        # Command Prompt
        cmd_path = None
        for path in os.environ.get("PATH", "").split(os.pathsep):
            p = os.path.join(path, "cmd.exe")
            if os.path.isfile(p):
                cmd_path = p
                break
        if cmd_path:
            shells.append({"name": "Command Prompt", "path": cmd_path})
            
        # Git Bash
        git_bash_candidates = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
            os.path.join(os.environ.get("LocalAppData", ""), r"Programs\Git\bin\bash.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), r"AppData\Local\Programs\Git\bin\bash.exe")
        ]
        for path in os.environ.get("PATH", "").split(os.pathsep):
            git_bash_candidates.append(os.path.join(path, "bash.exe"))
            
        git_bash_path = None
        for cand in git_bash_candidates:
            if os.path.isfile(cand):
                if "git" in cand.lower() or os.path.exists(os.path.join(os.path.dirname(cand), "git.exe")):
                    git_bash_path = cand
                    break
        if git_bash_path:
            shells.append({"name": "Git Bash", "path": git_bash_path})
        elif any(os.path.isfile(c) for c in git_bash_candidates):
            for cand in git_bash_candidates:
                if os.path.isfile(cand):
                    shells.append({"name": "Bash", "path": cand})
                    break
    else:
        # Unix
        for shell_name, exec_name in [("Bash", "bash"), ("Zsh", "zsh"), ("Sh", "sh")]:
            found = False
            for base in ["/bin", "/usr/bin", "/usr/local/bin"]:
                p = os.path.join(base, exec_name)
                if os.path.isfile(p):
                    shells.append({"name": shell_name, "path": p})
                    found = True
                    break
            if not found:
                for base in os.environ.get("PATH", "").split(os.pathsep):
                    p = os.path.join(base, exec_name)
                    if os.path.isfile(p):
                        shells.append({"name": shell_name, "path": p})
                        break
                        
    seen = set()
    unique_shells = []
    for s in shells:
        if s["path"] not in seen:
            seen.add(s["path"])
            unique_shells.append(s)
            
    if not unique_shells:
        if platform.system() == "Windows":
            unique_shells.append({"name": "Command Prompt", "path": "cmd.exe"})
        else:
            unique_shells.append({"name": "Default Shell", "path": os.environ.get("SHELL", "/bin/bash")})
    return unique_shells


class TerminalTabItemWidget(QWidget):
    """Custom widget for terminal list items in the sidebar with hover action buttons."""
    
    def __init__(self, index, name, container, parent=None, on_split=None, on_close=None):
        super().__init__(parent)
        self.container = container
        self.on_split = on_split
        self.on_close = on_close
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)
        layout.setSpacing(6)
        
        # Always use the standard terminal prompt icon \uea85 to match VS Code exactly
        self.icon_char = "\uea85"
        if getattr(self.container, "custom_icon", None):
            self.icon_char = self.container.custom_icon
            
        self.icon_label = QLabel(self.icon_char)
        self.icon_label.setFont(QFont("codicon", 11))
        
        color_style = "color: #cccccc;"
        if getattr(self.container, "custom_color", None):
            color_style = f"color: {self.container.custom_color};"
        self.icon_label.setStyleSheet(f"{color_style} background: transparent;")
        layout.addWidget(self.icon_label)
        
        # Name display (e.g. "powershell" or "Python" matching VS Code exact styling)
        display_name = name
        if getattr(self.container, "custom_name", None):
            display_name = self.container.custom_name
        else:
            if display_name.lower() == "powershell" or display_name.lower() == "pwsh":
                display_name = "powershell"
            elif display_name.lower() == "cmd":
                display_name = "Command Prompt"
            else:
                display_name = display_name.capitalize()
            
        self.text_label = QLabel(display_name)
        self.text_label.setStyleSheet("color: #cccccc; font-family: 'Segoe UI', sans-serif; font-size: 11px; background: transparent;")
        layout.addWidget(self.text_label)
        
        layout.addStretch(1)
        
        # Split button (visible on hover)
        self.split_btn = QPushButton("\uea6a")
        self.split_btn.setFont(QFont("codicon", 10))
        self.split_btn.setFixedSize(16, 16)
        self.split_btn.setCursor(Qt.PointingHandCursor)
        self.split_btn.setToolTip("Split Terminal")
        self.split_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #888888;
                font-family: "codicon";
                font-size: 10px;
                padding: 0px; /* Override global QPushButton padding */
            }
            QPushButton:hover {
                color: #ffffff;
                background-color: rgba(255, 255, 255, 0.15);
                border-radius: 2px;
            }
        """)
        self.split_btn.hide() # Hidden by default
        if on_split:
            self.split_btn.clicked.connect(on_split)
        layout.addWidget(self.split_btn)
        
        # Trash button (visible on hover)
        self.close_btn = QPushButton("\uea87")
        self.close_btn.setFont(QFont("codicon", 10))
        self.close_btn.setFixedSize(16, 16)
        self.close_btn.setCursor(Qt.PointingHandCursor)
        self.close_btn.setToolTip("Kill Terminal")
        self.close_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #888888;
                font-family: "codicon";
                font-size: 10px;
                padding: 0px; /* Override global QPushButton padding */
            }
            QPushButton:hover {
                color: #ff5555;
                background-color: rgba(255, 255, 255, 0.15);
                border-radius: 2px;
            }
        """)
        self.close_btn.hide() # Hidden by default
        if on_close:
            self.close_btn.clicked.connect(on_close)
        layout.addWidget(self.close_btn)

    def enterEvent(self, event):
        self.split_btn.show()
        self.close_btn.show()
        super().enterEvent(event)

    def leaveEvent(self, event):
        self.split_btn.hide()
        self.close_btn.hide()
        super().leaveEvent(event)

    def contextMenuEvent(self, event):
        from PySide6.QtWidgets import QMenu, QInputDialog, QColorDialog
        from PySide6.QtGui import QAction
        
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #3c0068;
            }
            QMenu::item {
                padding: 6px 20px;
            }
            QMenu::item:selected {
                background-color: #3c0068;
                color: #ffffff;
            }
            QMenu::separator {
                height: 1px;
                background: #3c0068;
                margin: 4px 0px;
            }
        """)

        rename_action = QAction("Rename...", self)
        rename_action.triggered.connect(self._rename_tab)
        menu.addAction(rename_action)
        
        change_color_action = QAction("Change Color...", self)
        change_color_action.triggered.connect(self._change_color)
        menu.addAction(change_color_action)
        
        change_icon_action = QAction("Change Icon...", self)
        change_icon_action.triggered.connect(self._change_icon)
        menu.addAction(change_icon_action)
        
        menu.addSeparator()

        split_action = QAction("Split Terminal", self)
        if self.on_split:
            split_action.triggered.connect(self.on_split)
        menu.addAction(split_action)
        
        kill_action = QAction("Kill Terminal", self)
        if self.on_close:
            kill_action.triggered.connect(self.on_close)
        menu.addAction(kill_action)
        
        menu.addSeparator()
        
        move_editor_action = QAction("Move into Editor Area", self)
        move_editor_action.triggered.connect(self._move_to_editor)
        menu.addAction(move_editor_action)

        menu.exec(event.globalPos())

    def _rename_tab(self):
        from PySide6.QtWidgets import QInputDialog
        new_name, ok = QInputDialog.getText(self, "Rename Terminal", "Name:", text=self.text_label.text())
        if ok and new_name:
            self.text_label.setText(new_name)
            self.container.custom_name = new_name
            try:
                p = self.parentWidget().parentWidget()
                if hasattr(p, 'currentRow'):
                    idx = p.currentRow()
                    tp = p.parentWidget().parentWidget()
                    if hasattr(tp, '_combo_box'):
                        tp._combo_box.setItemText(idx, f"{idx + 1}: {new_name}")
            except Exception:
                pass
            
    def _change_color(self):
        from PySide6.QtWidgets import QColorDialog
        color = QColorDialog.getColor(parent=self)
        if color.isValid():
            self.icon_label.setStyleSheet(f"color: {color.name()}; background: transparent;")
            self.container.custom_color = color.name()
            
    def _change_icon(self):
        from PySide6.QtWidgets import QInputDialog
        icons = ["\uea85 (Default)", "\uea71 (Bash)", "\uea93 (Cmd)", "\ueabc (Ubuntu)", "\uea9c (Python)", "\ueac4 (Warning)"]
        icon_str, ok = QInputDialog.getItem(self, "Select Icon", "Icon:", icons, 0, False)
        if ok and icon_str:
            new_icon = icon_str.split(" ")[0]
            self.icon_label.setText(new_icon)
            self.container.custom_icon = new_icon

    def _move_to_editor(self):
        # Notify the TerminalPanel to move this instance out
        p = self.parentWidget()
        while p:
            if hasattr(p, '_move_terminal_to_editor'):
                try:
                    idx = p._list_widget.row(p._list_widget.itemAt(self.mapTo(p._list_widget, self.rect().topLeft())))
                    if idx < 0:
                        idx = p._combo_box.currentIndex()
                    p._move_terminal_to_editor(idx)
                except Exception:
                    pass
                break
            p = p.parentWidget()


class SplitTerminalContainer(QSplitter):
    """Container that holds and splits TerminalInstances horizontally."""
    
    def __init__(self, workdir, shell=None, parent=None):
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
        self.shell = shell
        self.instances = []
        self.add_instance(shell=shell)

    def add_instance(self, shell=None):
        inst = TerminalInstance(workdir=self.workdir, shell=shell)
        self.instances.append(inst)
        self.addWidget(inst)
        inst.show()
        count = len(self.instances)
        if count > 1:
            w = self.width() // count if self.width() > 0 else 100
            self.setSizes([w] * count)
        return inst

    def write_input(self, text: str):
        active_inst = None
        for inst in self.instances:
            if inst.hasFocus():
                active_inst = inst
                break
        if not active_inst and self.instances:
            active_inst = self.instances[-1]
        if active_inst:
            active_inst.send_text(text)

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
        self.setStyleSheet("background-color: #000000;")
        self._setup_ui()
        self._new_terminal()

    def get_toolbar(self):
        return self._toolbar

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Toolbar container
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
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #3c0068;
                selection-background-color: #3c0068;
            }
        """)
        self._combo_box.currentIndexChanged.connect(self._switch_tab)
        # Hidden from UI but kept in memory to maintain tab index sync
        # tb_layout.addWidget(self._combo_box)

        # Action buttons
        for icon, tooltip in [
            ("\uea60", "New Terminal"),
            ("\ueab0", "Launch Profile"),
            ("\uea6a", "Split Terminal"),
            ("\uea87", "Kill Terminal"),
            ("\ueb60", "Toggle Terminal Tabs"),
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
                    padding: 0px; /* Override global QPushButton padding */
                }
                QPushButton:hover {
                    background-color: rgba(90,93,94,0.31);
                }
            """)
            if icon == "\uea60":
                btn.clicked.connect(lambda checked=False: self._new_terminal())
            elif icon == "\ueab0":
                btn.clicked.connect(lambda checked=False, b=btn: self._show_profiles_menu(b))
            elif icon == "\uea6a":
                btn.clicked.connect(self._split_terminal)
            elif icon == "\uea87":
                btn.clicked.connect(self._kill_current)
            elif icon == "\ueb60":
                btn.clicked.connect(self._toggle_sidebar_visibility)
            elif icon == "\uea7c":
                btn.clicked.connect(lambda checked=False, b=btn: self._show_more_actions_menu(b))
            tb_layout.addWidget(btn)

        # Main splitter (Terminals | Tabs sidebar)
        self._main_splitter = QSplitter(Qt.Horizontal)
        self._main_splitter.setHandleWidth(1)
        self._main_splitter.setStyleSheet("""
            QSplitter::handle {
                background-color: #000000;
            }
        """)

        # Stack for instances
        self._stack = QStackedWidget()
        self._main_splitter.addWidget(self._stack)

        # Tabs sidebar
        self._sidebar_container = QWidget()
        self._sidebar_container.setStyleSheet("background-color: #000000; border-left: 1px solid #000000;")
        self._sidebar_layout = QVBoxLayout(self._sidebar_container)
        self._sidebar_layout.setContentsMargins(0, 0, 0, 0)
        self._sidebar_layout.setSpacing(0)

        self._list_widget = QListWidget()
        self._list_widget.setStyleSheet("""
            QListWidget {
                background-color: #000000;
                border: none;
                outline: none;
            }
            QListWidget::item {
                border-bottom: 1px solid #000000;
            }
            QListWidget::item:hover {
                background-color: rgba(255, 255, 255, 0.05);
            }
            QListWidget::item:selected {
                background-color: rgba(60, 0, 104, 0.2);
                border-left: 3px solid #3c0068;
            }
        """)
        self._list_widget.itemSelectionChanged.connect(self._on_sidebar_selection_changed)
        self._sidebar_layout.addWidget(self._list_widget)

        self._main_splitter.addWidget(self._sidebar_container)
        self._main_splitter.setSizes([800, 200])

        layout.addWidget(self._main_splitter)

    def get_toolbar(self):
        return self._toolbar

    def _new_terminal(self, shell=None):
        idx = len(self._terminals)
        container = SplitTerminalContainer(workdir=self._current_workdir, shell=shell)
        self._terminals.append(container)
        self._stack.addWidget(container)
        
        shell_name = "powershell"
        if shell:
            shell_name = os.path.basename(shell).replace(".exe", "").lower()
        else:
            default_shell = get_shell_cmd()
            shell_name = os.path.basename(default_shell).replace(".exe", "").lower()

        self._combo_box.addItem(f"{idx + 1}: {shell_name}")
        self._stack.setCurrentWidget(container)
        self._combo_box.setCurrentIndex(idx)
        
        self._update_sidebar_list()
        if not self.isVisible():
            self.show()

    def _split_terminal(self):
        idx = self._combo_box.currentIndex()
        if 0 <= idx < len(self._terminals):
            container = self._terminals[idx]
            container.add_instance(shell=container.shell)

    def _split_terminal_at(self, idx):
        if 0 <= idx < len(self._terminals):
            container = self._terminals[idx]
            container.add_instance(shell=container.shell)

    def _close_tab(self, idx):
        if idx < 0 or idx >= len(self._terminals):
            return

        if len(self._terminals) <= 1:
            container = self._terminals[0]
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
            return

        container = self._terminals[idx]
        container.kill_all()
        self._terminals.pop(idx)
        self._stack.removeWidget(container)
        
        self._combo_box.blockSignals(True)
        self._combo_box.removeItem(idx)
        self._combo_box.blockSignals(False)
        
        container.deleteLater()

        new_idx = max(0, idx - 1)
        if len(self._terminals) > 0:
            self._combo_box.setCurrentIndex(new_idx)
            self._stack.setCurrentWidget(self._terminals[new_idx])

        self._update_sidebar_list()

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
            self._list_widget.blockSignals(True)
            self._list_widget.setCurrentRow(idx)
            self._list_widget.blockSignals(False)

    def _on_sidebar_selection_changed(self):
        row = self._list_widget.currentRow()
        if 0 <= row < len(self._terminals):
            self._stack.setCurrentWidget(self._terminals[row])
            self._combo_box.blockSignals(True)
            self._combo_box.setCurrentIndex(row)
            self._combo_box.blockSignals(False)

    def _toggle_sidebar_visibility(self):
        visible = not self._sidebar_container.isVisible()
        self._sidebar_container.setVisible(visible)
        if visible:
            self._main_splitter.setSizes([self.width() - 200, 200])
        else:
            self._main_splitter.setSizes([self.width(), 0])

    def _move_terminal_to_editor(self, idx):
        if idx < 0 or idx >= len(self._terminals):
            return

        container = self._terminals[idx]
        
        self._terminals.pop(idx)
        self._stack.removeWidget(container)
        
        self._combo_box.blockSignals(True)
        self._combo_box.removeItem(idx)
        self._combo_box.blockSignals(False)
        
        new_idx = max(0, idx - 1)
        if len(self._terminals) > 0:
            self._combo_box.setCurrentIndex(new_idx)
            self._stack.setCurrentWidget(self._terminals[new_idx])

        self._update_sidebar_list()
        
        p = self.parentWidget()
        while p:
            if hasattr(p, '_editor_tabs'):
                shell_name = "Terminal"
                if container.shell:
                    shell_name = os.path.basename(container.shell).replace(".exe", "").lower()
                
                p._editor_tabs.add_custom_tab(container, shell_name)
                break
            p = p.parentWidget()

    def _update_sidebar_list(self):
        self._list_widget.clear()
        self._combo_box.blockSignals(True)
        self._combo_box.clear()

        for i, container in enumerate(self._terminals):
            shell = container.shell
            if getattr(container, "custom_name", None):
                shell_name = container.custom_name
            else:
                shell_name = "powershell"
                if shell:
                    shell_name = os.path.basename(shell).replace(".exe", "").lower()
                else:
                    default_shell = get_shell_cmd()
                    shell_name = os.path.basename(default_shell).replace(".exe", "").lower()

            self._combo_box.addItem(f"{i + 1}: {shell_name}")

            item = QListWidgetItem(self._list_widget)
            item.setSizeHint(QSize(0, 32))

            widget = TerminalTabItemWidget(
                index=i,
                name=shell_name,
                container=container,
                parent=self._list_widget,
                on_split=lambda checked=False, idx=i: self._split_terminal_at(idx),
                on_close=lambda checked=False, idx=i: self._close_tab(idx)
            )
            self._list_widget.addItem(item)
            self._list_widget.setItemWidget(item, widget)

        curr_idx = self._stack.currentIndex()
        if 0 <= curr_idx < len(self._terminals):
            self._combo_box.setCurrentIndex(curr_idx)
            self._list_widget.setCurrentRow(curr_idx)

        self._combo_box.blockSignals(False)

    def _show_profiles_menu(self, button):
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #3c0068;
            }
            QMenu::item {
                padding: 6px 20px;
            }
            QMenu::item:selected {
                background-color: #3c0068;
                color: #ffffff;
            }
        """)
        
        shells = get_available_shells()
        for s in shells:
            action = QAction(s["name"], self)
            action.triggered.connect(lambda checked=False, p=s["path"]: self._new_terminal(shell=p))
            menu.addAction(action)

        menu.exec(button.mapToGlobal(QPoint(0, button.height())))

    def _show_more_actions_menu(self, button):
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #3c0068;
            }
            QMenu::item {
                padding: 6px 20px;
            }
            QMenu::item:selected {
                background-color: #3c0068;
                color: #ffffff;
            }
        """)

        clear_action = QAction("Clear Terminal", self)
        clear_action.triggered.connect(self.clear)
        menu.addAction(clear_action)

        toggle_tabs_action = QAction("Toggle Terminal Tabs", self)
        toggle_tabs_action.triggered.connect(self._toggle_sidebar_visibility)
        menu.addAction(toggle_tabs_action)

        menu.exec(button.mapToGlobal(QPoint(0, button.height())))

    def set_workdir(self, path):
        self._current_workdir = path
        for container in self._terminals:
            container.kill_all()
            self._stack.removeWidget(container)
            container.deleteLater()
        self._terminals.clear()
        self._combo_box.clear()
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
