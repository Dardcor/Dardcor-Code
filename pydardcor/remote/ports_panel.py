"""Port Forwarding Panel - VS Code style ports management."""

import subprocess
import os
import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTreeWidget, QTreeWidgetItem, QLineEdit, QInputDialog, QMessageBox
)
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QColor


class PortForwardingPanel(QWidget):
    """Panel for managing port forwarding (VS Code Ports panel)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._ports = []
        self._registered = {}
        self._setup_ui()
        self._refresh_timer = QTimer(self)
        self._refresh_timer.timeout.connect(self.refresh)
        self._refresh_timer.start(5000)
        self.refresh()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(30)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2c004a;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 8, 0)

        title = QLabel("PORTS")
        title.setStyleSheet("color: #bbbbbb; font-size: 10px; font-weight: 600; letter-spacing: 1.2px;")
        h_lay.addWidget(title)
        h_lay.addStretch()

        add_btn = QPushButton("+")
        add_btn.setFixedSize(22, 22)
        add_btn.setToolTip("Forward a Port")
        add_btn.setStyleSheet("QPushButton { background: transparent; border: none; color: #cccccc; font-size: 16px; } QPushButton:hover { background: #2c004a; }")
        add_btn.clicked.connect(self._add_port)
        h_lay.addWidget(add_btn)

        refresh_btn = QPushButton("↻")
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setToolTip("Refresh")
        refresh_btn.setStyleSheet("QPushButton { background: transparent; border: none; color: #cccccc; font-size: 14px; } QPushButton:hover { background: #2c004a; }")
        refresh_btn.clicked.connect(self.refresh)
        h_lay.addWidget(refresh_btn)

        layout.addWidget(header)

        # Tree
        self._tree = QTreeWidget()
        self._tree.setHeaderLabels(["Port", "Protocol", "Source", "Status"])
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 12px;
            }
            QTreeWidget::item { padding: 2px; }
            QTreeWidget::item:selected { background-color: #2c004a; }
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

    def register_port(self, port: int, source: str = "Live Server", status: str = "Running", protocol: str = "TCP"):
        """Pin a port in the panel (e.g. Live Server) across refreshes."""
        info = {
            "port": int(port),
            "protocol": protocol,
            "source": source,
            "status": status,
        }
        self._registered[int(port)] = info
        self._upsert_tree_item(info)

    def _upsert_tree_item(self, info: dict):
        port_str = str(info["port"])
        for i in range(self._tree.topLevelItemCount()):
            item = self._tree.topLevelItem(i)
            if item.text(0) == port_str:
                item.setText(1, info["protocol"])
                item.setText(2, info["source"])
                item.setText(3, info["status"])
                item.setForeground(3, self._status_color(info))
                return
        item = QTreeWidgetItem([
            port_str,
            info["protocol"],
            info["source"],
            info["status"],
        ])
        item.setForeground(3, self._status_color(info))
        self._tree.addTopLevelItem(item)

    def _status_color(self, info: dict) -> QColor:
        if info.get("source") == "Live Server":
            return QColor("#569cd6")
        if info.get("status") == "Forwarded":
            return QColor("#569cd6")
        return QColor("#73c991")

    def _merge_ports(self, detected: list) -> list:
        merged = {p["port"]: p for p in detected}
        for port, info in self._registered.items():
            merged[port] = info
        return sorted(merged.values(), key=lambda x: x["port"])

    def refresh(self):
        """Detect listening ports on the system."""
        self._tree.clear()

        def _detect():
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
                                    try:
                                        port_num = int(port)
                                        if port_num > 1024:
                                            ports.append({
                                                "port": port_num,
                                                "protocol": "TCP",
                                                "source": "System",
                                                "status": "Listening"
                                            })
                                    except ValueError:
                                        pass
                else:
                    result = subprocess.run(
                        ["ss", "-tlnp"], capture_output=True, text=True,
                        timeout=5, **kwargs
                    )
                    for line in result.stdout.splitlines()[1:]:
                        parts = line.split()
                        if len(parts) >= 4:
                            addr = parts[3]
                            if ":" in addr:
                                port = addr.split(":")[-1]
                                try:
                                    port_num = int(port)
                                    if port_num > 1024:
                                        ports.append({
                                            "port": port_num,
                                            "protocol": "TCP",
                                            "source": "System",
                                            "status": "Listening"
                                        })
                                except ValueError:
                                    pass
            except Exception:
                pass
            # Deduplicate
            seen = set()
            unique = []
            for p in ports:
                if p["port"] not in seen:
                    seen.add(p["port"])
                    unique.append(p)
            return sorted(unique, key=lambda x: x["port"])[:20]

        def _on_done(ports):
            self._ports = self._merge_ports(ports)
            self._tree.clear()
            for p in self._ports:
                self._upsert_tree_item(p)

        threading.Thread(target=lambda: QTimer.singleShot(0, lambda: _on_done(_detect())), daemon=True).start()

    def _add_port(self):
        port, ok = QInputDialog.getInt(self, "Forward Port", "Port number:", 3000, 1, 65535)
        if ok:
            self.register_port(port, source="User", status="Forwarded")
