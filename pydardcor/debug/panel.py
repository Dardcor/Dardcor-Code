"""Debug Panel - VS Code style run and debug sidebar panel."""

import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QComboBox, QScrollArea
)
from PySide6.QtCore import Signal
from PySide6.QtGui import QColor


class DebugPanel(QWidget):
    run_requested = Signal()
    debug_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._dap_client = None
        self._setup_ui()

    def set_dap_client(self, client):
        self._dap_client = client
        if client:
            previous = getattr(client, "_event_handler", None)

            def _chained_handler(event_name, body):
                if previous and previous is not _chained_handler:
                    previous(event_name, body)
                self._on_dap_event(event_name, body)

            client.on_event(_chained_handler)

    def set_config_names(self, names: list):
        self._config_combo.clear()
        if names:
            self._config_combo.addItems(names)
        else:
            self._config_combo.addItem("Python: Current File")

    def get_selected_config_name(self) -> str:
        return self._config_combo.currentText()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2b2b2b;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(20, 0, 8, 0)

        title = QLabel("RUN AND DEBUG")
        title.setStyleSheet("color: #bbbbbb; font-size: 11px; font-weight: 600; letter-spacing: 1.2px;")
        h_lay.addWidget(title)
        h_lay.addStretch()
        layout.addWidget(header)

        run_bar = QWidget()
        run_bar.setFixedHeight(35)
        run_bar.setStyleSheet("background-color: #000000;")
        rb_lay = QHBoxLayout(run_bar)
        rb_lay.setContentsMargins(10, 4, 10, 4)

        btn_style = "QPushButton { background: #1a0033; color: #89d185; font-size: 13px; border: 1px solid #3c0068; border-radius: 3px; } QPushButton:hover { background: #2c004a; } QPushButton:disabled { color: #555555; border-color: #1a0033; }"
        stop_style = "QPushButton { background: transparent; color: #f14c4c; font-size: 13px; border: none; } QPushButton:hover { background: #1a0033; border-radius: 3px; } QPushButton:disabled { color: #555555; }"
        step_style = "QPushButton { background: transparent; color: #cccccc; font-size: 11px; border: none; padding: 2px 5px; } QPushButton:hover { background: #1a0033; border-radius: 3px; } QPushButton:disabled { color: #555555; }"

        self._start_btn = QPushButton("Run")
        self._start_btn.setFixedHeight(24)
        self._start_btn.setMinimumWidth(36)
        self._start_btn.setToolTip("Run Current File")
        self._start_btn.setStyleSheet(btn_style)
        self._start_btn.clicked.connect(self._on_run)
        rb_lay.addWidget(self._start_btn)

        self._debug_btn = QPushButton("Dbg")
        self._debug_btn.setFixedSize(30, 24)
        self._debug_btn.setToolTip("Start Debugging (F5)")
        self._debug_btn.setStyleSheet(btn_style)
        self._debug_btn.clicked.connect(self._on_start)
        rb_lay.addWidget(self._debug_btn)

        self._stop_btn = QPushButton("\u25a0")
        self._stop_btn.setFixedSize(24, 24)
        self._stop_btn.setToolTip("Stop (Shift+F5)")
        self._stop_btn.setStyleSheet(stop_style)
        self._stop_btn.clicked.connect(self._on_stop)
        self._stop_btn.setEnabled(False)
        rb_lay.addWidget(self._stop_btn)

        self._continue_btn = QPushButton("\u25b6\u25b6")
        self._continue_btn.setFixedSize(24, 24)
        self._continue_btn.setToolTip("Continue (F5)")
        self._continue_btn.setStyleSheet(step_style)
        self._continue_btn.clicked.connect(self._on_continue)
        self._continue_btn.setEnabled(False)
        rb_lay.addWidget(self._continue_btn)

        self._step_over_btn = QPushButton("\u21af")
        self._step_over_btn.setFixedSize(24, 24)
        self._step_over_btn.setToolTip("Step Over (F10)")
        self._step_over_btn.setStyleSheet(step_style)
        self._step_over_btn.clicked.connect(self._on_step_over)
        self._step_over_btn.setEnabled(False)
        rb_lay.addWidget(self._step_over_btn)

        self._step_in_btn = QPushButton("\u21b3")
        self._step_in_btn.setFixedSize(24, 24)
        self._step_in_btn.setToolTip("Step Into (F11)")
        self._step_in_btn.setStyleSheet(step_style)
        self._step_in_btn.clicked.connect(self._on_step_in)
        self._step_in_btn.setEnabled(False)
        rb_lay.addWidget(self._step_in_btn)

        self._step_out_btn = QPushButton("\u21b1")
        self._step_out_btn.setFixedSize(24, 24)
        self._step_out_btn.setToolTip("Step Out (Shift+F11)")
        self._step_out_btn.setStyleSheet(step_style)
        self._step_out_btn.clicked.connect(self._on_step_out)
        self._step_out_btn.setEnabled(False)
        rb_lay.addWidget(self._step_out_btn)

        self._config_combo = QComboBox()
        self._config_combo.addItems(["Python: Current File", "Python: Module"])
        self._config_combo.setStyleSheet("QComboBox { background: #0a0a0a; color: #cccccc; border: 1px solid #333333; padding: 2px 6px; font-size: 12px; }")
        rb_lay.addWidget(self._config_combo)

        self._status_label = QLabel("")
        self._status_label.setStyleSheet("color: #89d185; font-size: 11px; padding-left: 8px;")
        rb_lay.addWidget(self._status_label)

        layout.addWidget(run_bar)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: #000000; }")

        content = QWidget()
        content.setStyleSheet("background-color: #000000;")
        c_lay = QVBoxLayout(content)
        c_lay.setContentsMargins(0, 0, 0, 0)
        c_lay.setSpacing(0)

        self._variables = self._make_section("VARIABLES")
        c_lay.addWidget(self._variables)

        self._watch = self._make_section("WATCH")
        c_lay.addWidget(self._watch)

        self._call_stack = self._make_section("CALL STACK")
        c_lay.addWidget(self._call_stack)

        self._breakpoints = self._make_section("BREAKPOINTS")
        c_lay.addWidget(self._breakpoints)

        c_lay.addStretch()
        scroll.setWidget(content)
        layout.addWidget(scroll)

    def _make_section(self, title):
        tree = QTreeWidget()
        tree.setHeaderHidden(True)
        tree.setRootIsDecorated(True)
        tree.setStyleSheet("QTreeWidget { background-color: #000000; color: #cccccc; border: none; font-size: 12px; } QTreeWidget::item { padding: 2px; } QTreeWidget::item:selected { background-color: #04395e; }")

        header = QTreeWidgetItem([title])
        header.setForeground(0, QColor("#bbbbbb"))
        f = header.font(0)
        f.setBold(True)
        f.setPointSize(10)
        header.setFont(0, f)
        header.setExpanded(True)

        tree.addTopLevelItem(header)
        tree._header = header

        ph = QTreeWidgetItem(["Not debugging"])
        ph.setForeground(0, QColor("#888888"))
        header.addChild(ph)

        tree.setMaximumHeight(200)
        return tree

    def _set_debug_buttons(self, active: bool):
        self._stop_btn.setEnabled(active)
        self._continue_btn.setEnabled(active)
        self._step_over_btn.setEnabled(active)
        self._step_in_btn.setEnabled(active)
        self._step_out_btn.setEnabled(active)
        self._debug_btn.setEnabled(not active)

    def _on_run(self):
        self.run_requested.emit()

    def _on_start(self):
        self._set_debug_buttons(True)
        self._status_label.setText("Starting...")
        self.debug_requested.emit()

    def _on_stop(self):
        if self._dap_client:
            threading.Thread(target=self._dap_client.disconnect, daemon=True).start()
        self._set_debug_buttons(False)
        self._status_label.setText("")
        self._clear_sections()

    def _on_continue(self):
        if self._dap_client:
            threading.Thread(target=self._dap_client.continue_, daemon=True).start()

    def _on_step_over(self):
        if self._dap_client:
            threading.Thread(target=self._dap_client.next, daemon=True).start()

    def _on_step_in(self):
        if self._dap_client:
            threading.Thread(target=self._dap_client.step_in, daemon=True).start()

    def _on_step_out(self):
        if self._dap_client:
            threading.Thread(target=self._dap_client.step_out, daemon=True).start()

    def _on_dap_event(self, event_name: str, body: dict):
        if event_name == "stopped":
            self._set_debug_buttons(True)
            thread_id = body.get("threadId", 0)
            reason = body.get("reason", "")
            self._status_label.setText(f"Paused ({reason})")
            self._update_from_debugger(thread_id)
        elif event_name == "continued":
            self._set_debug_buttons(True)
            self._status_label.setText("Running...")
        elif event_name == "terminated":
            self._set_debug_buttons(False)
            self._status_label.setText("Stopped")
            self._clear_sections()
        elif event_name == "thread":
            pass

    def _update_from_debugger(self, thread_id: int):
        if not self._dap_client:
            return

        def worker():
            try:
                frames = self._dap_client.stack_trace(thread_id)
                self._update_call_stack(frames)

                if frames:
                    frame_id = frames[0].get("id", 0)
                    scopes = self._dap_client.scopes(frame_id)
                    all_vars = []
                    for scope in scopes:
                        vars_ref = scope.get("variablesReference", 0)
                        if vars_ref:
                            variables = self._dap_client.variables(vars_ref)
                            for v in variables:
                                val = v.get("value", "")
                                if len(val) > 100:
                                    val = val[:100] + "..."
                                all_vars.append(f"{v.get('name', '')} = {val}")
                    self._update_variables(all_vars)
            except Exception:
                pass

        threading.Thread(target=worker, daemon=True).start()

    def _update_call_stack(self, frames: list):
        self._call_stack._header.takeChildren()
        for frame in frames[:20]:
            name = frame.get("name", "unknown")
            loc = frame.get("source", {}).get("path", "")
            line = frame.get("line", 0)
            short_loc = loc.split("/")[-1].split("\\")[-1] if loc else ""
            item = QTreeWidgetItem([f"{name}  ({short_loc}:{line})"])
            item.setForeground(0, QColor("#cccccc"))
            self._call_stack._header.addChild(item)
        if not frames:
            ph = QTreeWidgetItem(["No call stack"])
            ph.setForeground(0, QColor("#888888"))
            self._call_stack._header.addChild(ph)

    def _update_variables(self, var_lines: list):
        self._variables._header.takeChildren()
        for line in var_lines[:50]:
            item = QTreeWidgetItem([line])
            item.setForeground(0, QColor("#cccccc"))
            self._variables._header.addChild(item)
        if not var_lines:
            ph = QTreeWidgetItem(["No variables"])
            ph.setForeground(0, QColor("#888888"))
            self._variables._header.addChild(ph)

    def _clear_sections(self):
        for tree in [self._variables, self._watch, self._call_stack, self._breakpoints]:
            tree._header.takeChildren()
            ph = QTreeWidgetItem(["Not debugging"])
            ph.setForeground(0, QColor("#888888"))
            tree._header.addChild(ph)
