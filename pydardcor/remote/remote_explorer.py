"""Remote Explorer Panel - VS Code style remote explorer sidebar."""

import os
import logging
from typing import Optional, List, Dict
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTreeWidget, QTreeWidgetItem, QInputDialog, QMessageBox,
    QHeaderView, QMenu, QAbstractItemView, QGroupBox, QLineEdit,
    QSplitter, QFrame, QCheckBox, QTextEdit, QDialog,
    QDialogButtonBox, QFormLayout, QComboBox, QSpinBox,
)
from PySide6.QtCore import Qt, Signal, QTimer, QPoint
from PySide6.QtGui import QColor, QAction, QFont, QIcon, QPainter, QPixmap

from .ssh_manager import RemoteSSHManager, SSHHostConfig
from .wsl import WSLManager
from .container_manager import DockerManager
from .tunnel import RemoteTunnelManager
from .codespaces import CodespacesManager

logger = logging.getLogger(__name__)


class RemoteTargetDialog(QDialog):
    """Dialog for adding/editing a remote target."""

    def __init__(self, parent=None, target: dict = None):
        super().__init__(parent)
        self.setWindowTitle("Remote Target")
        self.setMinimumWidth(400)
        self._target = target or {}
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)

        form = QFormLayout()
        form.setSpacing(8)

        self._type_combo = QComboBox()
        self._type_combo.addItems(["SSH", "WSL", "Docker", "Dev Container", "Tunnel"])
        self._type_combo.setCurrentText(self._target.get("type", "SSH"))
        form.addRow("Type:", self._type_combo)

        self._name_input = QLineEdit(self._target.get("name", ""))
        self._name_input.setPlaceholderText("Display name")
        form.addRow("Name:", self._name_input)

        self._host_input = QLineEdit(self._target.get("host", ""))
        self._host_input.setPlaceholderText("hostname or IP")
        form.addRow("Host:", self._host_input)

        self._user_input = QLineEdit(self._target.get("user", ""))
        self._user_input.setPlaceholderText("username")
        form.addRow("User:", self._user_input)

        self._port_input = QSpinBox()
        self._port_input.setRange(1, 65535)
        self._port_input.setValue(self._target.get("port", 22))
        form.addRow("Port:", self._port_input)

        self._key_input = QLineEdit(self._target.get("identity_file", ""))
        self._key_input.setPlaceholderText("~/.ssh/id_rsa")
        form.addRow("Identity File:", self._key_input)

        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def get_target(self) -> dict:
        return {
            "type": self._type_combo.currentText(),
            "name": self._name_input.text(),
            "host": self._host_input.text(),
            "user": self._user_input.text(),
            "port": self._port_input.value(),
            "identity_file": self._key_input.text(),
        }


class RemoteExplorerPanel(QWidget):
    """Sidebar panel for managing remote connections à la VS Code Remote Explorer."""

    connect_requested = Signal(str, str)
    open_folder_requested = Signal(str)

    def __init__(self, ssh_manager: RemoteSSHManager = None,
                 wsl_manager: WSLManager = None,
                 docker_manager: DockerManager = None,
                 tunnel_manager: RemoteTunnelManager = None,
                 codespaces_manager: CodespacesManager = None,
                 parent=None):
        super().__init__(parent)
        self._ssh = ssh_manager or RemoteSSHManager(self)
        self._wsl = wsl_manager or WSLManager()
        self._docker = docker_manager or DockerManager(self)
        self._tunnels = tunnel_manager or RemoteTunnelManager()
        self._codespaces = codespaces_manager or CodespacesManager()
        self._targets: List[dict] = []
        self._setup_ui()
        self._load_targets()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QWidget()
        header.setFixedHeight(30)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2c004a;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 8, 0)

        title = QLabel("REMOTE EXPLORER")
        title.setStyleSheet("color: #bbbbbb; font-size: 10px; font-weight: 600; letter-spacing: 1.2px;")
        h_lay.addWidget(title)
        h_lay.addStretch()

        actions = [
            ("+", "Add Remote", self._add_target),
            ("\u21bb", "Refresh", self._refresh_all),
        ]
        for text, tooltip, callback in actions:
            btn = QPushButton(text)
            btn.setFixedSize(22, 22)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("QPushButton { background: transparent; border: none; color: #cccccc; font-size: 14px; } QPushButton:hover { background: #2c004a; }")
            btn.clicked.connect(callback)
            h_lay.addWidget(btn)

        layout.addWidget(header)

        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(16)
        self._tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tree.customContextMenuRequested.connect(self._show_context_menu)
        self._tree.itemDoubleClicked.connect(self._on_item_double_clicked)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 12px;
                outline: none;
            }
            QTreeWidget::item { padding: 4px 2px; }
            QTreeWidget::item:selected { background-color: #2c004a; }
            QTreeWidget::branch:has-siblings:!adjoins-item { border-image: none; }
        """)
        layout.addWidget(self._tree)

    def _add_section(self, title: str, color: str = "#888888"):
        item = QTreeWidgetItem(self._tree, [title])
        item.setFlags(item.flags() & ~Qt.ItemIsSelectable)
        font = QFont()
        font.setBold(True)
        font.setPointSize(9)
        item.setFont(0, font)
        item.setForeground(0, QColor(color))
        item.setExpanded(True)
        return item

    def _add_target_item(self, parent: QTreeWidgetItem, name: str,
                         subtitle: str = "", icon_char: str = "",
                         data: dict = None):
        item = QTreeWidgetItem(parent, [name])
        if subtitle:
            item.setText(1, subtitle)
        if data:
            item.setData(0, Qt.UserRole, data)
        font = QFont()
        font.setPointSize(11)
        item.setFont(0, font)
        item.setForeground(0, QColor("#cccccc"))
        return item

    def _refresh_all(self):
        self._tree.clear()
        self._load_targets()
        self._build_tree()

    def _load_targets(self):
        self._targets.clear()

        ssh_hosts = self._ssh.get_hosts()
        for host in ssh_hosts:
            self._targets.append({
                "type": "SSH",
                "name": host.label or host.hostname,
                "host": host.hostname,
                "user": host.user,
                "port": host.port,
                "identity_file": host.identity_file,
                "group": host.group,
            })

        wsl_dists = self._wsl.list_distributions()
        for dist in wsl_dists:
            self._targets.append({
                "type": "WSL",
                "name": f"WSL: {dist}",
                "host": dist,
            })

        containers = self._docker.list_containers()
        for c in containers[:10]:
            self._targets.append({
                "type": "Docker",
                "name": c.name or c.id[:12],
                "host": c.id,
                "image": c.image,
                "status": c.status,
            })

        tunnel_targets = self._tunnels.get_tunnels()
        for t in tunnel_targets:
            self._targets.append({
                "type": "Tunnel",
                "name": t.get("name", f"Tunnel: {t.get('tunnel_id', 'unknown')}"),
                "host": t.get("tunnel_id", ""),
            })

    def _build_tree(self):
        self._tree.clear()

        groups = {"SSH": [], "WSL": [], "Docker": [], "Tunnel": [], "Dev Container": []}
        for t in self._targets:
            ttype = t.get("type", "SSH")
            groups.setdefault(ttype, []).append(t)

        icons = {"SSH": "\U0001f310", "WSL": "\U0001f4bb", "Docker": "\U0001f433",
                 "Tunnel": "\U0001f525", "Dev Container": "\U0001f4e6"}

        for section_name, targets in groups.items():
            if not targets:
                continue
            section = self._add_section(f"{icons.get(section_name, '')} {section_name}",
                                        "#569cd6" if section_name == "SSH" else "#73c991")
            for t in targets:
                name = t.get("name", "Unknown")
                subtitle = t.get("host", "")
                if t.get("user"):
                    subtitle = f"{t['user']}@{subtitle}"
                if t.get("status"):
                    subtitle = f"{subtitle} [{t['status']}]"
                self._add_target_item(section, name, subtitle=subtitle, data=t)

    def _add_target(self):
        dialog = RemoteTargetDialog(self)
        if dialog.exec() == QDialog.Accepted:
            target = dialog.get_target()
            if target["type"] == "SSH":
                host = SSHHostConfig(
                    hostname=target["host"],
                    label=target["name"],
                    user=target["user"],
                    port=target["port"],
                    identity_file=target["identity_file"],
                )
                self._ssh.add_host(host)
            self._refresh_all()

    def _show_context_menu(self, pos: QPoint):
        item = self._tree.itemAt(pos)
        if not item or not item.data(0, Qt.UserRole):
            return

        target = item.data(0, Qt.UserRole)
        ttype = target.get("type", "")

        menu = QMenu(self)
        menu.setStyleSheet("QMenu { background: #000000; color: #cccccc; border: 1px solid #2c004a; } "
                           "QMenu::item { padding: 6px 20px; } "
                           "QMenu::item:selected { background: #2c004a; }")

        connect_action = QAction(f"Connect to {target.get('name', '')}", self)
        connect_action.triggered.connect(lambda: self._connect_to(target))
        menu.addAction(connect_action)

        open_folder_action = QAction("Open Folder...", self)
        open_folder_action.triggered.connect(lambda: self._open_remote_folder(target))
        menu.addAction(open_folder_action)

        if ttype == "SSH":
            menu.addSeparator()
            edit_action = QAction("Edit...", self)
            edit_action.triggered.connect(lambda: self._edit_target(target))
            menu.addAction(edit_action)

            remove_action = QAction("Remove", self)
            remove_action.triggered.connect(lambda: self._remove_target(target))
            menu.addAction(remove_action)

        menu.exec(self._tree.viewport().mapToGlobal(pos))

    def _on_item_double_clicked(self, item: QTreeWidgetItem, column: int):
        target = item.data(0, Qt.UserRole)
        if target:
            self._connect_to(target)

    def _connect_to(self, target: dict):
        ttype = target.get("type", "")
        host = target.get("host", "")
        if ttype == "SSH":
            self._ssh.connect_to_host(host)
        elif ttype == "WSL":
            self._wsl.open_distro(host)
        elif ttype == "Docker":
            pass
        self.connect_requested.emit(ttype, host)

    def _open_remote_folder(self, target: dict):
        path, ok = QInputDialog.getText(self, "Open Remote Folder", "Path:")
        if ok and path:
            self.open_folder_requested.emit(f"{target.get('type', '')}:{target.get('host', '')}:{path}")

    def _edit_target(self, target: dict):
        dialog = RemoteTargetDialog(self, target)
        if dialog.exec() == QDialog.Accepted:
            self._refresh_all()

    def _remove_target(self, target: dict):
        host = target.get("host", "")
        if host:
            self._ssh.remove_host(host)
            self._refresh_all()

    def get_ssh_manager(self) -> RemoteSSHManager:
        return self._ssh

    def get_wsl_manager(self) -> WSLManager:
        return self._wsl

    def get_docker_manager(self) -> DockerManager:
        return self._docker
