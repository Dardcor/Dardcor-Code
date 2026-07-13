"""MCP Server Management Dialog — add/edit/remove MCP servers with UI."""

from __future__ import annotations

import os
import json
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QLineEdit, QFrame, QScrollArea, QWidget, QMessageBox,
    QTextEdit, QFileDialog, QCheckBox, QGroupBox, QFormLayout,
)
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QFont

from dardcor_agent.extensibility.mcp_registry import MCPRegistry, MCPServerDef


class MCPServerCard(QFrame):
    """Card widget for a single MCP server entry."""

    edit_requested = Signal(str)
    delete_requested = Signal(str)
    toggle_requested = Signal(str, bool)

    def __init__(self, server: MCPServerDef, parent=None):
        super().__init__(parent)
        self._server = server
        self.setFixedHeight(80)
        self.setStyleSheet("""
            MCPServerCard {
                background-color: #111315;
                border: 1px solid #2c2e33;
                border-radius: 8px;
                margin: 4px 0px;
            }
            MCPServerCard:hover {
                border-color: #3c0068;
            }
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(8)

        info = QVBoxLayout()
        info.setSpacing(2)

        name_row = QHBoxLayout()
        name_lbl = QLabel(server.name)
        name_lbl.setStyleSheet("color: #e4e4e7; font-size: 13px; font-weight: 600; border: none;")
        name_row.addWidget(name_lbl)

        type_lbl = QLabel("stdio" if server.command else "url")
        type_lbl.setStyleSheet("""
            color: #a855f7; font-size: 9px; border: 1px solid #3c0068;
            border-radius: 3px; padding: 1px 5px; background: #1a0030;
        """)
        name_row.addWidget(type_lbl)

        enabled_lbl = QLabel("ON" if server.enabled else "OFF")
        enabled_lbl.setStyleSheet(f"""
            color: {'#22c55e' if server.enabled else '#6b7280'};
            font-size: 9px; border: 1px solid {'#14532d' if server.enabled else '#2c2e33'};
            border-radius: 3px; padding: 1px 5px;
            background: {'#052e16' if server.enabled else '#111315'};
        """)
        name_row.addWidget(enabled_lbl)
        name_row.addStretch()
        info.addLayout(name_row)

        detail = server.command or server.url or ""
        if server.args:
            detail += " " + " ".join(server.args)
        detail_lbl = QLabel(detail[:80] + ("..." if len(detail) > 80 else ""))
        detail_lbl.setStyleSheet("color: #6b7280; font-size: 10px; border: none; font-family: monospace;")
        info.addWidget(detail_lbl)
        layout.addLayout(info, stretch=1)

        btn_layout = QVBoxLayout()
        btn_layout.setSpacing(4)

        edit_btn = QPushButton("Edit")
        edit_btn.setFixedSize(50, 24)
        edit_btn.setStyleSheet("""
            QPushButton {
                background: #1a1d21; color: #e4e4e7; border: 1px solid #2c2e33;
                border-radius: 4px; font-size: 10px;
            }
            QPushButton:hover { background: #2c2e33; }
        """)
        edit_btn.clicked.connect(lambda: self.edit_requested.emit(server.name))
        btn_layout.addWidget(edit_btn)

        del_btn = QPushButton("Delete")
        del_btn.setFixedSize(50, 24)
        del_btn.setStyleSheet("""
            QPushButton {
                background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d;
                border-radius: 4px; font-size: 10px;
            }
            QPushButton:hover { background: #7f1d1d; }
        """)
        del_btn.clicked.connect(lambda: self.delete_requested.emit(server.name))
        btn_layout.addWidget(del_btn)

        toggle_btn = QPushButton("ON" if server.enabled else "OFF")
        toggle_btn.setFixedSize(50, 24)
        toggle_btn.setStyleSheet(f"""
            QPushButton {{
                background: {'#052e16' if server.enabled else '#1a1d21'};
                color: {'#22c55e' if server.enabled else '#6b7280'};
                border: 1px solid {'#14532d' if server.enabled else '#2c2e33'};
                border-radius: 4px; font-size: 10px;
            }}
            QPushButton:hover {{ background: {'#166534' if server.enabled else '#2c2e33'}; }}
        """)
        toggle_btn.clicked.connect(lambda: self.toggle_requested.emit(server.name, not server.enabled))
        btn_layout.addWidget(toggle_btn)

        layout.addLayout(btn_layout)


class MCPServerEditDialog(QDialog):
    """Dialog for adding or editing an MCP server."""

    def __init__(self, server: MCPServerDef | None = None, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Edit MCP Server" if server else "Add MCP Server")
        self.setMinimumSize(500, 400)
        self.setStyleSheet("QDialog { background-color: #000000; color: #e4e4e7; }")

        self._server = server or MCPServerDef(name="")
        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        form = QFormLayout()
        form.setSpacing(8)

        self._name_input = QLineEdit(self._server.name)
        self._name_input.setPlaceholderText("e.g., my-database-server")
        self._name_input.setStyleSheet("""
            QLineEdit { background: #111315; color: #e4e4e7; border: 1px solid #2c2e33;
            border-radius: 6px; padding: 6px 10px; font-size: 12px; }
        """)
        form.addRow("Name:", self._name_input)

        self._type_combo = QPushButton("Command" if self._server.command else "URL")
        self._type_combo.setFixedHeight(30)
        self._type_combo.setStyleSheet("""
            QPushButton { background: #1a1d21; color: #e4e4e7; border: 1px solid #2c2e33;
            border-radius: 6px; padding: 4px 12px; font-size: 12px; }
            QPushButton:hover { background: #2c2e33; }
        """)
        self._use_command = bool(self._server.command)
        self._type_combo.clicked.connect(self._toggle_type)
        form.addRow("Type:", self._type_combo)

        self._cmd_input = QLineEdit(self._server.command or "")
        self._cmd_input.setPlaceholderText("e.g., npx")
        self._cmd_input.setStyleSheet(self._name_input.styleSheet())
        form.addRow("Command:", self._cmd_input)

        self._args_input = QLineEdit(" ".join(self._server.args) if self._server.args else "")
        self._args_input.setPlaceholderText("e.g., -y @modelcontextprotocol/server-filesystem /path")
        self._args_input.setStyleSheet(self._name_input.styleSheet())
        form.addRow("Args:", self._args_input)

        self._url_input = QLineEdit(self._server.url or "")
        self._url_input.setPlaceholderText("e.g., https://mcp.example.com/sse")
        self._url_input.setStyleSheet(self._name_input.styleSheet())
        self._url_input.setVisible(not self._use_command)
        form.addRow("URL:", self._url_input)

        self._env_input = QTextEdit()
        env_text = "\n".join(f"{k}={v}" for k, v in self._server.env.items())
        self._env_input.setPlainText(env_text)
        self._env_input.setPlaceholderText("KEY=VALUE pairs, one per line")
        self._env_input.setFixedHeight(80)
        self._env_input.setStyleSheet("""
            QTextEdit { background: #111315; color: #e4e4e7; border: 1px solid #2c2e33;
            border-radius: 6px; padding: 6px 10px; font-size: 11px; font-family: monospace; }
        """)
        form.addRow("Env:", self._env_input)

        layout.addLayout(form)

        btn_row = QHBoxLayout()
        btn_row.addStretch()
        save_btn = QPushButton("Save")
        save_btn.setFixedSize(100, 32)
        save_btn.setStyleSheet("""
            QPushButton {
                background: #7c3aed; color: white; border: none;
                border-radius: 6px; font-size: 12px; font-weight: bold;
            }
            QPushButton:hover { background: #6d28d9; }
        """)
        save_btn.clicked.connect(self._save)
        btn_row.addWidget(save_btn)

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setFixedSize(100, 32)
        cancel_btn.setStyleSheet("""
            QPushButton {
                background: #1a1d21; color: #e4e4e7; border: 1px solid #2c2e33;
                border-radius: 6px; font-size: 12px;
            }
            QPushButton:hover { background: #2c2e33; }
        """)
        cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(cancel_btn)
        layout.addLayout(btn_row)

        self._update_visibility()

    def _toggle_type(self):
        self._use_command = not self._use_command
        self._type_combo.setText("Command" if self._use_command else "URL")
        self._update_visibility()

    def _update_visibility(self):
        is_cmd = self._use_command
        self._cmd_input.setVisible(is_cmd)
        self._args_input.setVisible(is_cmd)
        self._url_input.setVisible(not is_cmd)

    def _save(self):
        name = self._name_input.text().strip()
        if not name:
            QMessageBox.warning(self, "Error", "Server name is required.")
            return
        self._server.name = name
        if self._use_command:
            self._server.command = self._cmd_input.text().strip()
            args_text = self._args_input.text().strip()
            self._server.args = args_text.split() if args_text else []
            self._server.url = None
        else:
            self._server.url = self._url_input.text().strip()
            self._server.command = None
            self._server.args = []

        env = {}
        for line in self._env_input.toPlainText().strip().splitlines():
            line = line.strip()
            if "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
        self._server.env = env
        self.accept()

    def get_server(self) -> MCPServerDef:
        return self._server


class MCPManagerDialog(QDialog):
    """Main MCP server management dialog."""

    def __init__(self, mcp_registry: MCPRegistry, parent=None):
        super().__init__(parent)
        self._registry = mcp_registry
        self.setWindowTitle("MCP Server Manager")
        self.setMinimumSize(600, 450)
        self.setStyleSheet("QDialog { background-color: #000000; color: #e4e4e7; }")

        layout = QVBoxLayout(self)
        layout.setSpacing(8)

        header = QLabel("Model Context Protocol (MCP) Servers")
        header.setStyleSheet("font-size: 15px; font-weight: bold; color: #e4e4e7; border: none; padding: 8px 0;")
        layout.addWidget(header)

        desc = QLabel("MCP servers connect the AI agent to external tools, databases, and APIs.")
        desc.setStyleSheet("color: #6b7280; font-size: 11px; border: none;")
        desc.setWordWrap(True)
        layout.addWidget(desc)

        action_row = QHBoxLayout()
        add_btn = QPushButton("+ Add Server")
        add_btn.setFixedHeight(32)
        add_btn.setStyleSheet("""
            QPushButton {
                background: #7c3aed; color: white; border: none;
                border-radius: 6px; font-size: 12px; font-weight: bold;
                padding: 0 14px;
            }
            QPushButton:hover { background: #6d28d9; }
        """)
        add_btn.clicked.connect(self._add_server)
        action_row.addWidget(add_btn)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setFixedHeight(32)
        refresh_btn.setStyleSheet("""
            QPushButton {
                background: #1a1d21; color: #e4e4e7; border: 1px solid #2c2e33;
                border-radius: 6px; font-size: 12px; padding: 0 14px;
            }
            QPushButton:hover { background: #2c2e33; }
        """)
        refresh_btn.clicked.connect(self._load_servers)
        action_row.addWidget(refresh_btn)
        action_row.addStretch()
        layout.addLayout(action_row)

        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setStyleSheet("""
            QScrollArea { border: none; background: transparent; }
            QScrollBar:vertical { width: 6px; background: transparent; }
            QScrollBar::handle:vertical { background: #2c2e33; border-radius: 3px; }
        """)
        self._container = QWidget()
        self._container.setStyleSheet("background: transparent;")
        self._list_layout = QVBoxLayout(self._container)
        self._list_layout.setContentsMargins(0, 0, 0, 0)
        self._list_layout.setSpacing(2)
        self._list_layout.addStretch()
        self._scroll.setWidget(self._container)
        layout.addWidget(self._scroll, stretch=1)

        close_btn = QPushButton("Close")
        close_btn.setFixedHeight(32)
        close_btn.setStyleSheet("""
            QPushButton {
                background: #1a1d21; color: #e4e4e7; border: 1px solid #2c2e33;
                border-radius: 6px; font-size: 12px;
            }
            QPushButton:hover { background: #2c2e33; }
        """)
        close_btn.clicked.connect(self.accept)
        layout.addWidget(close_btn)

        self._load_servers()

    def _load_servers(self):
        self._clear_list()
        servers = self._registry.list_servers()
        if not servers:
            empty = QLabel("No MCP servers configured. Click '+ Add Server' to add one.")
            empty.setStyleSheet("color: #6b7280; font-size: 12px; border: none; padding: 24px;")
            empty.setAlignment(Qt.AlignCenter)
            self._list_layout.insertWidget(0, empty)
            return
        for server in servers:
            card = MCPServerCard(server)
            card.edit_requested.connect(self._edit_server)
            card.delete_requested.connect(self._delete_server)
            card.toggle_requested.connect(self._toggle_server)
            self._list_layout.insertWidget(self._list_layout.count() - 1, card)

    def _clear_list(self):
        while self._list_layout.count() > 1:
            item = self._list_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

    def _add_server(self):
        dialog = MCPServerEditDialog(parent=self)
        if dialog.exec():
            server = dialog.get_server()
            self._registry.set_server(server)
            self._registry.save()
            self._load_servers()

    def _edit_server(self, name: str):
        server = self._registry.get(name)
        if not server:
            return
        dialog = MCPServerEditDialog(server, parent=self)
        if dialog.exec():
            self._registry.set_server(dialog.get_server())
            self._registry.save()
            self._load_servers()

    def _delete_server(self, name: str):
        reply = QMessageBox.question(
            self, "Delete Server",
            f"Delete MCP server '{name}'?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        if reply == QMessageBox.Yes:
            servers = {s.name: s for s in self._registry.list_servers()}
            if name in servers:
                del servers[name]
                self._registry._servers = {k: v for k, v in servers.items()}
                self._registry.save()
                self._load_servers()

    def _toggle_server(self, name: str, enabled: bool):
        if enabled:
            self._registry.enable(name)
        else:
            self._registry.disable(name)
        self._registry.save()
        self._load_servers()
