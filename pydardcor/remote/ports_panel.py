"""Port Forwarding Panel - Full port management with SSH tunneling and protocol detection."""

import subprocess
import os
import re
import json
import socket
import threading
import logging
from typing import List, Dict, Optional, Callable
from dataclasses import dataclass, field, asdict
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTreeWidget, QTreeWidgetItem, QLineEdit, QInputDialog, QMessageBox,
    QHeaderView, QMenu, QAbstractItemView, QCheckBox, QComboBox,
    QGroupBox, QFormLayout, QSpinBox, QFrame,
)
from PySide6.QtCore import Qt, Signal, QTimer, QPoint
from PySide6.QtGui import QColor, QAction, QFont, QPainter

logger = logging.getLogger(__name__)

try:
    import paramiko
    HAS_PARAMIKO = True
except ImportError:
    HAS_PARAMIKO = False


@dataclass
class PortForward:
    """Represents a port forwarding rule."""
    local_port: int
    target_host: str = "127.0.0.1"
    target_port: int = 0
    protocol: str = "TCP"
    label: str = ""
    source: str = "User"
    status: str = "Forwarded"
    auto_open: bool = False
    via_ssh: Optional[str] = None


class PortForwardingPanel(QWidget):
    """Panel for managing port forwarding with SSH tunnel support."""

    port_opened = Signal(int)
    port_closed = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._forwards: Dict[int, PortForward] = {}
        self._ssh_tunnels: Dict[int, threading.Thread] = {}
        self._detected_ports: List[dict] = []
        self._setup_ui()
        self._refresh_timer = QTimer(self)
        self._refresh_timer.timeout.connect(self._refresh)
        self._refresh_timer.start(5000)
        self._refresh()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QWidget()
        header.setFixedHeight(30)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2c004a;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 8, 0)

        title = QLabel("PORTS")
        title.setStyleSheet("color: #bbbbbb; font-size: 10px; font-weight: 600; letter-spacing: 1.2px;")
        h_lay.addWidget(title)
        h_lay.addStretch()

        actions = [
            ("+", "Forward a Port", self._add_port),
            ("\u2191", "Local Forward", self._add_local_forward),
            ("\u2193", "Remote Forward (SSH)", self._add_ssh_forward),
            ("\u21bb", "Refresh", self._refresh),
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
        self._tree.setHeaderLabels(["Port", "Protocol", "Source", "Status", "Target"])
        self._tree.setColumnWidth(0, 60)
        self._tree.setColumnWidth(1, 70)
        self._tree.setColumnWidth(2, 120)
        self._tree.setColumnWidth(3, 90)
        self._tree.setAlternatingRowColors(True)
        self._tree.setSelectionMode(QAbstractItemView.ExtendedSelection)
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
            QTreeWidget::item { padding: 2px 4px; }
            QTreeWidget::item:selected { background-color: #2c004a; }
            QTreeWidget::item:alternate { background-color: #0a0a0a; }
            QHeaderView::section {
                background-color: #0d0d0d;
                color: #888888;
                border: none;
                border-bottom: 1px solid #2c004a;
                padding: 4px;
                font-size: 11px;
            }
        """)
        layout.addWidget(self._tree)

    # ── Public API ──────────────────────────────────────────────────────

    def register_port(self, port: int, source: str = "Live Server",
                      status: str = "Running", protocol: str = "TCP",
                      label: str = ""):
        """Register a port to appear in the panel."""
        fwd = PortForward(
            local_port=int(port),
            protocol=protocol,
            source=source,
            status=status,
            label=label,
            target_port=int(port),
        )
        self._forwards[int(port)] = fwd
        self._update_tree()

    def add_forward(self, forward: PortForward) -> bool:
        """Add a port forwarding rule."""
        if forward.local_port in self._forwards:
            return False

        self._forwards[forward.local_port] = forward

        if forward.via_ssh and HAS_PARAMIKO:
            pass

        self._update_tree()
        return True

    def remove_forward(self, port: int) -> bool:
        """Remove a forwarding rule."""
        if port in self._forwards:
            del self._forwards[port]
            self._close_ssh_tunnel(port)
            self._update_tree()
            return True
        return False

    def get_forwards(self) -> List[PortForward]:
        return list(self._forwards.values())

    # ── SSH Tunneling ───────────────────────────────────────────────────

    def _start_ssh_tunnel(self, forward: PortForward) -> bool:
        """Start an SSH tunnel for port forwarding using subprocess."""
        if not forward.via_ssh:
            return False

        ssh_cmd = forward.via_ssh
        local_port = forward.local_port

        def _tunnel():
            try:
                cmd = [
                    "ssh", "-N", "-L",
                    f"127.0.0.1:{local_port}:{forward.target_host}:{forward.target_port}",
                    ssh_cmd,
                ]
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                self._ssh_tunnels[local_port] = proc
                proc.wait()
            except Exception:
                pass
            finally:
                if local_port in self._forwards:
                    self._forwards[local_port].status = "Disconnected"
                    self._update_tree()

        thread = threading.Thread(target=_tunnel, daemon=True)
        thread.start()
        return True

    def _close_ssh_tunnel(self, port: int):
        if port in self._ssh_tunnels:
            try:
                self._ssh_tunnels[port].terminate()
            except Exception:
                pass
            del self._ssh_tunnels[port]

    # ── UI Actions ──────────────────────────────────────────────────────

    def _add_port(self):
        port, ok = QInputDialog.getInt(self, "Forward Port", "Port number:", 3000, 1, 65535)
        if ok:
            forward = PortForward(local_port=port, source="User", status="Forwarded")
            self.add_forward(forward)

    def _add_local_forward(self):
        dialog = QInputDialog(self)
        port, ok = QInputDialog.getInt(self, "Local Port Forward",
                                        "Local port to forward from:", 8080, 1, 65535)
        if not ok:
            return
        target_host, ok = QInputDialog.getText(self, "Local Port Forward",
                                                "Target host:", text="localhost")
        if not ok:
            return
        target_port, ok = QInputDialog.getInt(self, "Local Port Forward",
                                               "Target port:", 80, 1, 65535)
        if not ok:
            return
        forward = PortForward(
            local_port=port,
            target_host=target_host,
            target_port=target_port,
            source="User",
            status="Forwarded",
        )
        self.add_forward(forward)

    def _add_ssh_forward(self):
        port, ok = QInputDialog.getInt(self, "SSH Remote Forward",
                                        "Remote port to forward:", 3000, 1, 65535)
        if not ok:
            return
        ssh_host, ok = QInputDialog.getText(self, "SSH Remote Forward",
                                             "SSH connection (user@host):")
        if not ok or not ssh_host:
            return
        forward = PortForward(
            local_port=port,
            source="SSH Tunnel",
            status="Forwarded",
            via_ssh=ssh_host,
        )
        self.add_forward(forward)

    def _show_context_menu(self, pos: QPoint):
        item = self._tree.itemAt(pos)
        if not item:
            return
        port = int(item.text(0))

        menu = QMenu(self)
        menu.setStyleSheet("QMenu { background: #000000; color: #cccccc; border: 1px solid #2c004a; } "
                           "QMenu::item { padding: 6px 20px; } "
                           "QMenu::item:selected { background: #2c004a; }")

        open_action = QAction("Open in Browser", self)
        open_action.triggered.connect(lambda: self._open_in_browser(port))
        menu.addAction(open_action)

        copy_action = QAction("Copy Local Address", self)
        copy_action.triggered.connect(lambda: self._copy_address(port))
        menu.addAction(copy_action)

        menu.addSeparator()

        label_action = QAction("Change Label...", self)
        label_action.triggered.connect(lambda: self._change_label(port))
        menu.addAction(label_action)

        menu.addSeparator()

        remove_action = QAction("Stop Forwarding", self)
        remove_action.triggered.connect(lambda: self.remove_forward(port))
        menu.addAction(remove_action)

        menu.exec(self._tree.viewport().mapToGlobal(pos))

    def _on_item_double_clicked(self, item: QTreeWidgetItem, column: int):
        port = int(item.text(0))
        self._open_in_browser(port)

    def _open_in_browser(self, port: int):
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{port}")

    def _copy_address(self, port: int):
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(f"http://127.0.0.1:{port}")

    def _change_label(self, port: int):
        fwd = self._forwards.get(port)
        if not fwd:
            return
        label, ok = QInputDialog.getText(self, "Change Label", "Label:", text=fwd.label or "")
        if ok:
            fwd.label = label
            self._update_tree()

    # ── Port Detection ──────────────────────────────────────────────────

    def _detect_ports(self) -> List[dict]:
        """Detect listening ports on the system."""
        ports = []
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
                result = subprocess.run(
                    ["netstat", "-an"], capture_output=True, text=True,
                    timeout=5, **kwargs
                )
                for line in result.stdout.splitlines():
                    if "LISTENING" in line:
                        parts = line.split()
                        if len(parts) >= 2:
                            addr = parts[1]
                            if ":" in addr:
                                port = addr.split(":")[-1]
                                proto = parts[0] if len(parts) > 0 else "TCP"
                                try:
                                    port_num = int(port)
                                    if port_num > 0 and port_num <= 65535:
                                        ports.append({
                                            "port": port_num,
                                            "protocol": proto,
                                            "source": "System",
                                            "status": "Listening",
                                        })
                                except ValueError:
                                    pass
            else:
                result = subprocess.run(
                    ["ss", "-tlnp"], capture_output=True, text=True,
                    timeout=5
                )
                for line in result.stdout.splitlines()[1:]:
                    parts = line.split()
                    if len(parts) >= 4:
                        addr = parts[3]
                        if ":" in addr:
                            port = addr.split(":")[-1]
                            try:
                                port_num = int(port)
                                ports.append({
                                    "port": port_num,
                                    "protocol": "TCP",
                                    "source": "System",
                                    "status": "Listening",
                                })
                            except ValueError:
                                pass
        except Exception as e:
            logger.error(f"Port detection error: {e}")

        seen = set()
        unique = []
        for p in ports:
            if p["port"] not in seen:
                seen.add(p["port"])
                unique.append(p)
        return sorted(unique, key=lambda x: x["port"])[:30]

    def _merge_ports(self, detected: List[dict]) -> List[PortForward]:
        merged: Dict[int, PortForward] = {}
        for item in detected:
            merged[item["port"]] = PortForward(
                local_port=item["port"],
                protocol=item.get("protocol", "TCP"),
                source=item.get("source", "System"),
                status=item.get("status", "Listening"),
            )
        for port, fwd in self._forwards.items():
            merged[port] = fwd
        return sorted(merged.values(), key=lambda x: x.local_port)

    def _refresh(self):
        """Refresh the port list."""
        def _detect():
            return self._detect_ports()

        def _on_done(detected):
            self._detected_ports = detected
            self._update_tree()

        threading.Thread(
            target=lambda: QTimer.singleShot(0, lambda: _on_done(_detect())),
            daemon=True
        ).start()

    def _update_tree(self):
        """Update the tree widget with merged port list."""
        self._tree.clear()
        merged = self._merge_ports(self._detected_ports)
        for entry in merged:
            label = entry.label or str(entry.local_port)
            target = f"{entry.target_host}:{entry.target_port}" if entry.target_port else ""
            if entry.via_ssh:
                target += f" \u2192 {entry.via_ssh}"

            item = QTreeWidgetItem([
                str(entry.local_port),
                entry.protocol,
                entry.source,
                entry.status,
                target,
            ])

            if entry.source == "Live Server":
                item.setForeground(2, QColor("#569cd6"))
                item.setForeground(3, QColor("#569cd6"))
            elif entry.status == "Forwarded":
                item.setForeground(3, QColor("#73c991"))
            elif entry.status == "Listening":
                item.setForeground(3, QColor("#888888"))

            self._tree.addTopLevelItem(item)

    def cleanup(self):
        self._refresh_timer.stop()
        for port in list(self._ssh_tunnels.keys()):
            self._close_ssh_tunnel(port)
