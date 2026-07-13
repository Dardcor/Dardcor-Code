import os
import platform
import json
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QStackedWidget,
    QComboBox, QSizePolicy, QSplitter, QListWidget, QListWidgetItem,
    QLabel, QAbstractItemView, QMenu, QInputDialog, QColorDialog,
    QFileDialog
)
from PySide6.QtCore import Qt, QSize, QPoint, Signal
from PySide6.QtGui import QFont, QAction, QKeySequence, QShortcut

from .instance import TerminalInstance
from .backend import get_shell_cmd


def get_available_shells():
    import platform
    import os
    shells = []
    if platform.system() == "Windows":
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

        cmd_path = None
        for path in os.environ.get("PATH", "").split(os.pathsep):
            p = os.path.join(path, "cmd.exe")
            if os.path.isfile(p):
                cmd_path = p
                break
        if cmd_path:
            shells.append({"name": "Command Prompt", "path": cmd_path})

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


TERMINAL_COLOR_THEMES = {
    "Dark+ (default)": {
        "background": "#000000",
        "foreground": "#cccccc",
        "cursor": "#aeafad",
        "selectionBackground": "#264f78",
        "black": "#000000", "red": "#cd3131", "green": "#0dbc79",
        "yellow": "#e5e510", "blue": "#2472c8", "magenta": "#bc3fbc",
        "cyan": "#11a8cd", "white": "#e5e5e5",
        "brightBlack": "#666666", "brightRed": "#f14c4c", "brightGreen": "#23d18b",
        "brightYellow": "#f5f543", "brightBlue": "#3b8eea", "brightMagenta": "#d670d6",
        "brightCyan": "#29b8db", "brightWhite": "#e5e5e5"
    },
    "Light+ (default)": {
        "background": "#ffffff",
        "foreground": "#333333",
        "cursor": "#333333",
        "selectionBackground": "#add6ff",
        "black": "#000000", "red": "#cd3131", "green": "#00bc00",
        "yellow": "#949800", "blue": "#0451a5", "magenta": "#bc05bc",
        "cyan": "#0598bc", "white": "#555555",
        "brightBlack": "#666666", "brightRed": "#cd3131", "brightGreen": "#14ce14",
        "brightYellow": "#b5ba00", "brightBlue": "#0451a5", "brightMagenta": "#bc05bc",
        "brightCyan": "#0598bc", "brightWhite": "#a5a5a5"
    },
    "Solarized Dark": {
        "background": "#002b36",
        "foreground": "#839496",
        "cursor": "#839496",
        "selectionBackground": "#073642",
        "black": "#073642", "red": "#dc322f", "green": "#859900",
        "yellow": "#b58900", "blue": "#268bd2", "magenta": "#d33682",
        "cyan": "#2aa198", "white": "#eee8d5",
        "brightBlack": "#002b36", "brightRed": "#cb4b16", "brightGreen": "#586e75",
        "brightYellow": "#657b83", "brightBlue": "#839496", "brightMagenta": "#6c71c4",
        "brightCyan": "#93a1a1", "brightWhite": "#fdf6e3"
    },
    "Solarized Light": {
        "background": "#fdf6e3",
        "foreground": "#657b83",
        "cursor": "#657b83",
        "selectionBackground": "#eee8d5",
        "black": "#073642", "red": "#dc322f", "green": "#859900",
        "yellow": "#b58900", "blue": "#268bd2", "magenta": "#d33682",
        "cyan": "#2aa198", "white": "#eee8d5",
        "brightBlack": "#002b36", "brightRed": "#cb4b16", "brightGreen": "#586e75",
        "brightYellow": "#657b83", "brightBlue": "#839496", "brightMagenta": "#6c71c4",
        "brightCyan": "#93a1a1", "brightWhite": "#fdf6e3"
    },
    "Monokai": {
        "background": "#272822",
        "foreground": "#f8f8f2",
        "cursor": "#f8f8f2",
        "selectionBackground": "#49483e",
        "black": "#272822", "red": "#f92672", "green": "#a6e22e",
        "yellow": "#f4bf75", "blue": "#66d9ef", "magenta": "#ae81ff",
        "cyan": "#a1efe4", "white": "#f8f8f2",
        "brightBlack": "#75715e", "brightRed": "#f92672", "brightGreen": "#a6e22e",
        "brightYellow": "#f4bf75", "brightBlue": "#66d9ef", "brightMagenta": "#ae81ff",
        "brightCyan": "#a1efe4", "brightWhite": "#f9f8f5"
    },
    "Dracula": {
        "background": "#282a36",
        "foreground": "#f8f8f2",
        "cursor": "#f8f8f2",
        "selectionBackground": "#44475a",
        "black": "#21222c", "red": "#ff5555", "green": "#50fa7b",
        "yellow": "#f1fa8c", "blue": "#bd93f9", "magenta": "#ff79c6",
        "cyan": "#8be9fd", "white": "#f8f8f2",
        "brightBlack": "#6272a4", "brightRed": "#ff6e6e", "brightGreen": "#69ff94",
        "brightYellow": "#ffffa5", "brightBlue": "#d6acff", "brightMagenta": "#ff92df",
        "brightCyan": "#a4ffff", "brightWhite": "#ffffff"
    },
    "Nord": {
        "background": "#2e3440",
        "foreground": "#d8dee9",
        "cursor": "#d8dee9",
        "selectionBackground": "#434c5e",
        "black": "#3b4252", "red": "#bf616a", "green": "#a3be8c",
        "yellow": "#ebcb8b", "blue": "#81a1c1", "magenta": "#b48ead",
        "cyan": "#88c0d0", "white": "#e5e9f0",
        "brightBlack": "#4c566a", "brightRed": "#bf616a", "brightGreen": "#a3be8c",
        "brightYellow": "#ebcb8b", "brightBlue": "#81a1c1", "brightMagenta": "#b48ead",
        "brightCyan": "#8fbcbb", "brightWhite": "#eceff4"
    },
    "GitHub Dark": {
        "background": "#0d1117",
        "foreground": "#c9d1d9",
        "cursor": "#c9d1d9",
        "selectionBackground": "#1f6feb",
        "black": "#484f58", "red": "#ff7b72", "green": "#3fb950",
        "yellow": "#d29922", "blue": "#58a6ff", "magenta": "#bc8cff",
        "cyan": "#39c5cf", "white": "#b1bac4",
        "brightBlack": "#6e7681", "brightRed": "#ffa198", "brightGreen": "#56d364",
        "brightYellow": "#e3b341", "brightBlue": "#79c0ff", "brightMagenta": "#d2a8ff",
        "brightCyan": "#56d4dd", "brightWhite": "#f0f6fc"
    },
    "One Dark Pro": {
        "background": "#1e1e1e",
        "foreground": "#abb2bf",
        "cursor": "#abb2bf",
        "selectionBackground": "#3a3f4b",
        "black": "#1e1e1e", "red": "#e06c75", "green": "#98c379",
        "yellow": "#d19a66", "blue": "#61afef", "magenta": "#c678dd",
        "cyan": "#56b6c2", "white": "#abb2bf",
        "brightBlack": "#5c6370", "brightRed": "#e06c75", "brightGreen": "#98c379",
        "brightYellow": "#d19a66", "brightBlue": "#61afef", "brightMagenta": "#c678dd",
        "brightCyan": "#56b6c2", "brightWhite": "#ffffff"
    }
}


class TerminalTabItemWidget(QWidget):
    def __init__(self, index, name, container, parent=None, on_split=None, on_close=None):
        super().__init__(parent)
        self.container = container
        self.on_split = on_split
        self.on_close = on_close
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)
        layout.setSpacing(6)

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

        display_name = name
        if getattr(self.container, "custom_name", None):
            display_name = self.container.custom_name
        else:
            if display_name.lower() in ("powershell", "pwsh"):
                display_name = "powershell"
            elif display_name.lower() == "cmd":
                display_name = "Command Prompt"
            else:
                display_name = display_name.capitalize()

        self.text_label = QLabel(display_name)
        self.text_label.setStyleSheet("color: #cccccc; font-family: 'Segoe UI', sans-serif; font-size: 11px; background: transparent;")
        layout.addWidget(self.text_label)

        # Cwd label (shows on hover via tooltip or as subtitle)
        self.cwd_label = QLabel("")
        self.cwd_label.setStyleSheet("color: #666666; font-family: 'Segoe UI', sans-serif; font-size: 9px; background: transparent;")
        self.cwd_label.setVisible(False)
        layout.addWidget(self.cwd_label)

        layout.addStretch(1)

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
                padding: 0px;
            }
            QPushButton:hover {
                color: #ffffff;
                background-color: rgba(255, 255, 255, 0.15);
                border-radius: 2px;
            }
        """)
        self.split_btn.hide()
        if on_split:
            self.split_btn.clicked.connect(on_split)
        layout.addWidget(self.split_btn)

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
                padding: 0px;
            }
            QPushButton:hover {
                color: #ff5555;
                background-color: rgba(255, 255, 255, 0.15);
                border-radius: 2px;
            }
        """)
        self.close_btn.hide()
        if on_close:
            self.close_btn.clicked.connect(on_close)
        layout.addWidget(self.close_btn)

    def update_info(self, index, name):
        display_name = name
        if getattr(self.container, "custom_name", None):
            display_name = self.container.custom_name
        else:
            if display_name.lower() in ("powershell", "pwsh"):
                display_name = "powershell"
            elif display_name.lower() == "cmd":
                display_name = "Command Prompt"
            else:
                display_name = display_name.capitalize()
        self.text_label.setText(display_name)

        self.icon_char = "\uea85"
        if getattr(self.container, "custom_icon", None):
            self.icon_char = self.container.custom_icon
        self.icon_label.setText(self.icon_char)

        color_style = "color: #cccccc;"
        if getattr(self.container, "custom_color", None):
            color_style = f"color: {self.container.custom_color};"
        self.icon_label.setStyleSheet(f"{color_style} background: transparent;")

        # Update cwd from first instance
        if self.container.instances:
            cwd = self.container.instances[0].get_workdir()
            self.cwd_label.setText(cwd)

    def enterEvent(self, event):
        self.split_btn.show()
        self.close_btn.show()
        if self.container.instances:
            cwd = self.container.instances[0].get_workdir()
            self.cwd_label.setText(cwd)
            self.cwd_label.setVisible(True)
        super().enterEvent(event)

    def leaveEvent(self, event):
        self.split_btn.hide()
        self.close_btn.hide()
        self.cwd_label.setVisible(False)
        super().leaveEvent(event)

    def contextMenuEvent(self, event):
        menu = QMenu(self)

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

        set_cwd_action = QAction("Set CWD...", self)
        set_cwd_action.triggered.connect(self._set_cwd)
        menu.addAction(set_cwd_action)

        edit_env_action = QAction("Environment Variables...", self)
        edit_env_action.triggered.connect(self._edit_env_vars)
        menu.addAction(edit_env_action)

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
        new_name, ok = QInputDialog.getText(self, "Rename Terminal", "Name:", text=self.text_label.text())
        if ok and new_name:
            self.text_label.setText(new_name)
            self.container.custom_name = new_name
            p = self.parentWidget().parentWidget()
            if hasattr(p, '_combo_box'):
                idx = p._combo_box.findText(self.text_label.text())
                if idx >= 0:
                    pass

    def _change_color(self):
        color = QColorDialog.getColor(parent=self)
        if color.isValid():
            self.icon_label.setStyleSheet(f"color: {color.name()}; background: transparent;")
            self.container.custom_color = color.name()

    def _change_icon(self):
        icons = ["\uea85 (Default)", "\uea71 (Bash)", "\uea93 (Cmd)", "\ueabc (Ubuntu)", "\uea9c (Python)", "\ueac4 (Warning)"]
        icon_str, ok = QInputDialog.getItem(self, "Select Icon", "Icon:", icons, 0, False)
        if ok and icon_str:
            new_icon = icon_str.split(" ")[0]
            self.icon_label.setText(new_icon)
            self.container.custom_icon = new_icon

    def _set_cwd(self):
        cwd = QFileDialog.getExistingDirectory(self, "Select Working Directory",
                                                self.container.instances[0].get_workdir() if self.container.instances else "")
        if cwd:
            for inst in self.container.instances:
                inst.set_workdir(cwd)

    def _edit_env_vars(self):
        if not self.container.instances:
            return
        inst = self.container.instances[0]
        current_vars = inst.get_env_vars()
        vars_str = "\n".join(f"{k}={v}" for k, v in current_vars.items())

        text, ok = QInputDialog.getMultiLineText(self, "Environment Variables",
                                                  "One per line: KEY=VALUE", vars_str)
        if ok:
            new_vars = {}
            for line in text.strip().split("\n"):
                line = line.strip()
                if line and "=" in line:
                    k, v = line.split("=", 1)
                    new_vars[k.strip()] = v.strip()
            for instance in self.container.instances:
                instance.set_env_vars(new_vars)

    def _move_to_editor(self):
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


class DragDropListWidget(QListWidget):
    rows_reordered = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setDragDropMode(QAbstractItemView.InternalMove)
        self.setDefaultDropAction(Qt.MoveAction)
        self.setDragEnabled(True)
        self.setAcceptDrops(True)
        self.setDropIndicatorShown(True)
        self._suppress_reorder = False

    def dropEvent(self, event):
        self._suppress_reorder = True
        super().dropEvent(event)
        self._suppress_reorder = False
        self.rows_reordered.emit()


class SplitTerminalContainer(QSplitter):
    def __init__(self, workdir, shell=None, env_vars=None, parent=None):
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
        self.env_vars = env_vars or {}
        self.instances = []
        self.add_instance(shell=shell)

    def add_instance(self, shell=None, direction=None):
        if direction is not None and self.count() > 0:
            self.setOrientation(direction)
        inst = TerminalInstance(workdir=self.workdir, shell=shell or self.shell,
                                env_vars=self.env_vars)
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

    def _on_instance_title_changed(self, instance, title):
        p = self.parentWidget()
        while p:
            if hasattr(p, '_on_instance_title_changed'):
                p._on_instance_title_changed(self, title)
                break
            p = p.parentWidget()


class TerminalPanel(QWidget):
    def __init__(self, root_path=None, parent=None):
        super().__init__(parent)
        self._terminals = []
        self._current_workdir = root_path or os.path.expanduser("~")
        self._current_theme_name = "Dark+ (default)"
        self.setObjectName("terminalPanel")
        self.setStyleSheet("background-color: #000000;")
        self._setup_ui()
        self._setup_shortcuts()
        self._new_terminal()

    def get_toolbar(self):
        return self._toolbar

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

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

        actions = [
            ("\uea60", "New Terminal", self._new_terminal),
            ("\ueab0", "Launch Profile", self._show_profiles_menu),
            ("\uea6a", "Split Terminal", self._split_terminal),
            ("\uea87", "Kill Terminal", self._kill_current),
            ("\ueb60", "Toggle Terminal Tabs", self._toggle_sidebar_visibility),
            ("\uea7c", "More Actions...", self._show_more_actions_menu),
        ]

        for icon, tooltip, callback in actions:
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
                    padding: 0px;
                }
                QPushButton:hover {
                    background-color: rgba(90,93,94,0.31);
                }
            """)
            if tooltip == "Launch Profile":
                btn.clicked.connect(lambda checked=False, b=btn: callback(b))
            elif tooltip == "More Actions...":
                btn.clicked.connect(lambda checked=False, b=btn: callback(b))
            else:
                btn.clicked.connect(callback)
            tb_layout.addWidget(btn)

        tb_layout.addWidget(self._combo_box)

        self._main_splitter = QSplitter(Qt.Horizontal)
        self._main_splitter.setHandleWidth(1)
        self._main_splitter.setStyleSheet("""
            QSplitter::handle {
                background-color: #000000;
            }
        """)

        self._stack = QStackedWidget()
        self._main_splitter.addWidget(self._stack)

        self._sidebar_container = QWidget()
        self._sidebar_container.setStyleSheet("background-color: #000000; border-left: 1px solid #000000;")
        self._sidebar_container.setMinimumWidth(0)
        self._sidebar_container.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Expanding)
        self._sidebar_layout = QVBoxLayout(self._sidebar_container)
        self._sidebar_layout.setContentsMargins(0, 0, 0, 0)
        self._sidebar_layout.setSpacing(0)

        self._list_widget = DragDropListWidget()
        self._list_widget.setMinimumWidth(0)
        self._list_widget.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Expanding)
        self._list_widget.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
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
        self._list_widget.rows_reordered.connect(self._on_rows_reordered)
        self._sidebar_layout.addWidget(self._list_widget)

        self._main_splitter.addWidget(self._sidebar_container)
        self._main_splitter.setCollapsible(0, False)
        self._main_splitter.setCollapsible(1, True)
        self._main_splitter.setSizes([800, 200])

        layout.addWidget(self._main_splitter)

    def _setup_shortcuts(self):
        find_shortcut = QShortcut(QKeySequence("Ctrl+F"), self)
        find_shortcut.activated.connect(self._toggle_find)

        new_term_shortcut = QShortcut(QKeySequence("Ctrl+Shift+`"), self)
        new_term_shortcut.activated.connect(self._new_terminal)

    # ── Tab management ────────────────────────────────────────────────────

    def _new_terminal(self, shell=None, env_vars=None):
        idx = len(self._terminals)
        container = SplitTerminalContainer(workdir=self._current_workdir,
                                           shell=shell,
                                           env_vars=env_vars)
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

    def _split_vertical(self, idx):
        if 0 <= idx < len(self._terminals):
            container = self._terminals[idx]
            container.add_instance(shell=container.shell, direction=Qt.Vertical)

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

    # ── Drag-reorder tabs ────────────────────────────────────────────────

    def _on_rows_reordered(self):
        new_order = []
        for i in range(self._list_widget.count()):
            item = self._list_widget.item(i)
            widget = self._list_widget.itemWidget(item)
            if widget:
                container = widget.container
                if container in self._terminals:
                    new_order.append(container)

        if len(new_order) == len(self._terminals):
            self._terminals[:] = new_order
            self._combo_box.blockSignals(True)
            self._combo_box.clear()
            for i, container in enumerate(self._terminals):
                shell = container.shell
                shell_name = "powershell"
                if getattr(container, "custom_name", None):
                    shell_name = container.custom_name
                elif shell:
                    shell_name = os.path.basename(shell).replace(".exe", "").lower()
                else:
                    shell_name = os.path.basename(get_shell_cmd()).replace(".exe", "").lower()
                self._combo_box.addItem(f"{i + 1}: {shell_name}")

            curr_idx = self._stack.currentIndex()
            if 0 <= curr_idx < len(self._terminals):
                self._combo_box.setCurrentIndex(curr_idx)
            self._combo_box.blockSignals(False)

    # ── Search (Ctrl+F) ──────────────────────────────────────────────────

    def _toggle_find(self):
        current = self._stack.currentWidget()
        if isinstance(current, SplitTerminalContainer):
            active_inst = None
            for inst in current.instances:
                if inst.hasFocus():
                    active_inst = inst
                    break
            if not active_inst and current.instances:
                active_inst = current.instances[0]
            if active_inst:
                active_inst.toggle_find()

    # ── Color themes ─────────────────────────────────────────────────────

    def _apply_theme(self, theme_name: str):
        self._current_theme_name = theme_name
        colors = TERMINAL_COLOR_THEMES.get(theme_name, TERMINAL_COLOR_THEMES["Dark+ (default)"])
        for container in self._terminals:
            for inst in container.instances:
                inst.set_theme(colors)

    # ── Font customization ───────────────────────────────────────────────

    def _change_font_family(self):
        family, ok = QInputDialog.getText(self, "Font Family", "Font family:",
                                           text='"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace')
        if ok and family:
            for container in self._terminals:
                for inst in container.instances:
                    inst.set_font_family(family)

    def _change_font_size(self):
        current = 13
        if self._terminals and self._terminals[0].instances:
            current = self._terminals[0].instances[0]._font_size
        size, ok = QInputDialog.getInt(self, "Font Size", "Font size:", current, 8, 72, 1)
        if ok:
            for container in self._terminals:
                for inst in container.instances:
                    inst.set_font_size(size)

    def _change_line_height(self):
        current = 1.2
        if self._terminals and self._terminals[0].instances:
            current = self._terminals[0].instances[0]._line_height
        height, ok = QInputDialog.getDouble(self, "Line Height", "Line height:", current, 0.5, 3.0, 1)
        if ok:
            for container in self._terminals:
                for inst in container.instances:
                    inst.set_line_height(height)

    def _change_cursor_style(self, style=None):
        if style is None:
            styles = ["block", "underline", "bar"]
            style, ok = QInputDialog.getItem(self, "Cursor Style", "Style:", styles, 0, False)
            if not ok:
                return
        blink = True
        if style == "block":
            blink_resp = QInputDialog.getItem(self, "Cursor Blink", "Blink:", ["Yes", "No"], 0, False)
            if blink_resp[1]:
                blink = blink_resp[0] == "Yes"
        for container in self._terminals:
            for inst in container.instances:
                inst.set_cursor_style(style, blink)

    def _toggle_copy_on_select(self):
        enabled = not (self._terminals and self._terminals[0].instances and
                      self._terminals[0].instances[0]._copy_on_select)
        for container in self._terminals:
            for inst in container.instances:
                inst.set_copy_on_select(enabled)

    # ── Environment variables per tab ────────────────────────────────────

    def _edit_env_vars_current(self):
        idx = self._combo_box.currentIndex()
        if 0 <= idx < len(self._terminals):
            container = self._terminals[idx]
            if container.instances:
                inst = container.instances[0]
                current_vars = inst.get_env_vars()
                vars_str = "\n".join(f"{k}={v}" for k, v in current_vars.items())

                text, ok = QInputDialog.getMultiLineText(self, "Environment Variables",
                                                          "One per line: KEY=VALUE", vars_str)
                if ok:
                    new_vars = {}
                    for line in text.strip().split("\n"):
                        line = line.strip()
                        if line and "=" in line:
                            k, v = line.split("=", 1)
                            new_vars[k.strip()] = v.strip()
                    for instance in container.instances:
                        instance.set_env_vars(new_vars)

    # ── Cwd per tab ──────────────────────────────────────────────────────

    def _set_cwd_current(self):
        idx = self._combo_box.currentIndex()
        if 0 <= idx < len(self._terminals):
            container = self._terminals[idx]
            current_cwd = container.instances[0].get_workdir() if container.instances else self._current_workdir
            cwd = QFileDialog.getExistingDirectory(self, "Select Working Directory", current_cwd)
            if cwd:
                for inst in container.instances:
                    inst.set_workdir(cwd)
                self._update_sidebar_list()

    # ── Title change from instance ───────────────────────────────────────

    def _on_instance_title_changed(self, container, title):
        self._update_sidebar_list()

    # ── Sidebar visibility ───────────────────────────────────────────────

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

    # ── Sidebar list update ──────────────────────────────────────────────

    def _update_sidebar_list(self):
        self._list_widget.blockSignals(True)
        self._combo_box.blockSignals(True)

        while self._combo_box.count() > len(self._terminals):
            self._combo_box.removeItem(self._combo_box.count() - 1)

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

            text = f"{i + 1}: {shell_name}"
            if i < self._combo_box.count():
                if self._combo_box.itemText(i) != text:
                    self._combo_box.setItemText(i, text)
            else:
                self._combo_box.addItem(text)

        while self._list_widget.count() > len(self._terminals):
            self._list_widget.takeItem(self._list_widget.count() - 1)

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

            if i < self._list_widget.count():
                item = self._list_widget.item(i)
                widget = self._list_widget.itemWidget(item)
                if widget:
                    widget.update_info(i, shell_name)
            else:
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
        self._list_widget.blockSignals(False)

    # ── Menus ────────────────────────────────────────────────────────────

    def _show_profiles_menu(self, button):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background: #000000; color: #cccccc; border: 1px solid #3c0068; }
            QMenu::item { padding: 6px 20px; }
            QMenu::item:selected { background: #3c0068; }
        """)

        shells = get_available_shells()
        for s in shells:
            action = QAction(s["name"], self)
            action.triggered.connect(lambda checked=False, p=s["path"]: self._new_terminal(shell=p))
            menu.addAction(action)

        menu.addSeparator()

        env_action = QAction("New Terminal with Env Vars...", self)
        env_action.triggered.connect(self._new_terminal_with_env)
        menu.addAction(env_action)

        menu.exec(button.mapToGlobal(QPoint(0, button.height())))

    def _new_terminal_with_env(self):
        text, ok = QInputDialog.getMultiLineText(self, "Environment Variables",
                                                  "One per line: KEY=VALUE")
        if ok:
            env_vars = {}
            for line in text.strip().split("\n"):
                line = line.strip()
                if line and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip()
            self._new_terminal(env_vars=env_vars)

    def _show_more_actions_menu(self, button):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background: #000000; color: #cccccc; border: 1px solid #3c0068; }
            QMenu::item { padding: 6px 20px; }
            QMenu::item:selected { background: #3c0068; }
        """)

        clear_action = QAction("Clear Terminal", self)
        clear_action.triggered.connect(self.clear)
        menu.addAction(clear_action)

        menu.addSeparator()

        toggle_tabs_action = QAction("Toggle Terminal Tabs", self)
        toggle_tabs_action.triggered.connect(self._toggle_sidebar_visibility)
        menu.addAction(toggle_tabs_action)

        menu.addSeparator()

        # Color themes submenu
        themes_menu = menu.addMenu("Color Theme")
        for theme_name in TERMINAL_COLOR_THEMES:
            theme_action = QAction(theme_name, self)
            theme_action.setCheckable(True)
            theme_action.setChecked(theme_name == self._current_theme_name)
            theme_action.triggered.connect(lambda checked=False, tn=theme_name: self._apply_theme(tn))
            themes_menu.addAction(theme_action)

        # Font submenu
        font_menu = menu.addMenu("Font")
        font_family_action = QAction("Font Family...", self)
        font_family_action.triggered.connect(self._change_font_family)
        font_menu.addAction(font_family_action)

        font_size_action = QAction("Font Size...", self)
        font_size_action.triggered.connect(self._change_font_size)
        font_menu.addAction(font_size_action)

        line_height_action = QAction("Line Height...", self)
        line_height_action.triggered.connect(self._change_line_height)
        font_menu.addAction(line_height_action)

        cursor_menu = menu.addMenu("Cursor Style")
        for style in ["block", "underline", "bar"]:
            cs_action = QAction(style.capitalize(), self)
            cs_action.triggered.connect(lambda checked=False, s=style: self._change_cursor_style(s))
            cursor_menu.addAction(cs_action)

        menu.addSeparator()

        copy_on_select_action = QAction("Copy on Selection", self)
        copy_on_select_action.setCheckable(True)
        copy_on_select_action.setChecked(
            self._terminals and self._terminals[0].instances and
            self._terminals[0].instances[0]._copy_on_select
        )
        copy_on_select_action.triggered.connect(self._toggle_copy_on_select)
        menu.addAction(copy_on_select_action)

        menu.addSeparator()

        set_cwd_action = QAction("Set Working Directory...", self)
        set_cwd_action.triggered.connect(self._set_cwd_current)
        menu.addAction(set_cwd_action)

        env_vars_action = QAction("Environment Variables...", self)
        env_vars_action.triggered.connect(self._edit_env_vars_current)
        menu.addAction(env_vars_action)

        menu.addSeparator()

        change_icon_action = QAction("Change Icon...", self)
        menu.addAction(change_icon_action)

        change_color_action = QAction("Change Tab Color...", self)
        menu.addAction(change_color_action)

        menu.addSeparator()

        show_pm_action = QAction("Terminal Process Manager", self)
        menu.addAction(show_pm_action)

        ext_term_action = QAction("Open External Terminal", self)
        ext_term_action.triggered.connect(self._open_external_terminal)
        menu.addAction(ext_term_action)

        menu.exec(button.mapToGlobal(QPoint(0, button.height())))

    def _open_external_terminal(self):
        import subprocess
        if os.name == 'nt':
            subprocess.Popen(["cmd.exe", "/c", "start", "cmd.exe"], cwd=self._current_workdir or ".")

    # ── Public API ───────────────────────────────────────────────────────

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

    def write_input(self, text: str):
        current = self._stack.currentWidget()
        if isinstance(current, SplitTerminalContainer):
            current.write_input(text)

    def closeEvent(self, event):
        for container in self._terminals:
            container.kill_all()
        super().closeEvent(event)
