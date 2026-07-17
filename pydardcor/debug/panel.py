"""Debug Panel - VS Code style run and debug sidebar panel."""

import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QComboBox, QScrollArea,
    QLineEdit, QInputDialog, QMenu, QHeaderView, QSplitter,
    QAbstractItemView, QFrame
)
from PySide6.QtCore import Signal, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QAction
from pydardcor.workspace.workspace_trust import WorkspaceTrust


class SectionWidget(QWidget):
    """Collapsible section with header and tree content."""

    def __init__(self, title: str, object_name: str = ""):
        super().__init__()
        self._expanded = True
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._header = QPushButton(f"\u25bc {title}")
        self._header.setObjectName(object_name or title.lower().replace(" ", "_"))
        self._header.setStyleSheet("""
            QPushButton {
                text-align: left; padding: 4px 8px;
                background-color: #1a1a1a; color: #bbbbbb;
                border: none; border-bottom: 1px solid #2b2b2b;
                font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
            }
            QPushButton:hover { background-color: #2a2a2a; }
        """)
        self._header.clicked.connect(self._toggle)
        layout.addWidget(self._header)

        self._tree = QTreeWidget()
        self._tree.setObjectName(object_name + "_tree" if object_name else "")
        self._tree.setHeaderHidden(True)
        self._tree.setRootIsDecorated(True)
        self._tree.setAnimated(True)
        self._tree.setIndentation(16)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000; color: #cccccc;
                border: none; font-size: 12px;
            }
            QTreeWidget::item { padding: 2px 4px; }
            QTreeWidget::item:selected { background-color: #04395e; }
            QTreeWidget::item:hover { background-color: #1a1a2e; }
        """)
        self._tree.header().setStretchLastSection(False)
        layout.addWidget(self._tree)

        self._placeholder = QTreeWidgetItem(["Not debugging"])
        self._placeholder.setForeground(0, QColor("#888888"))
        self._tree.addTopLevelItem(self._placeholder)

    def _toggle(self):
        self._expanded = not self._expanded
        self._tree.setVisible(self._expanded)
        arrow = "\u25bc" if self._expanded else "\u25b6"
        self._header.setText(f"{arrow} {self._header.text()[2:]}")

    def tree(self) -> QTreeWidget:
        return self._tree

    def clear(self):
        self._tree.clear()

    def set_placeholder(self, text: str):
        self._tree.clear()
        ph = QTreeWidgetItem([text])
        ph.setForeground(0, QColor("#888888"))
        self._tree.addTopLevelItem(ph)

    def expand_all(self):
        self._tree.expandAll()


class DebugConsole(QWidget):
    """Mini REPL console for debug expression evaluation."""

    evaluate_requested = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.setMaximumHeight(150)

        self._output = QTreeWidget()
        self._output.setHeaderHidden(True)
        self._output.setRootIsDecorated(False)
        self._output.setStyleSheet("""
            QTreeWidget {
                background-color: #0a0a0a; color: #cccccc;
                border: none; border-top: 1px solid #2b2b2b;
                font-size: 12px; font-family: 'Consolas', 'Courier New', monospace;
            }
            QTreeWidget::item { padding: 1px 4px; }
        """)
        self._output.setMaximumHeight(100)
        layout.addWidget(self._output)

        input_row = QWidget()
        input_row.setStyleSheet("background-color: #0a0a0a;")
        ir_lay = QHBoxLayout(input_row)
        ir_lay.setContentsMargins(4, 2, 4, 2)

        prompt = QLabel("> ")
        prompt.setStyleSheet("color: #89d185; font-weight: bold; font-size: 12px;")
        ir_lay.addWidget(prompt)

        self._input = QLineEdit()
        self._input.setPlaceholderText("Debug console expression")
        self._input.setStyleSheet("""
            QLineEdit {
                background-color: #1a1a1a; color: #cccccc;
                border: 1px solid #333333; border-radius: 2px;
                padding: 3px 6px; font-size: 12px;
                font-family: 'Consolas', 'Courier New', monospace;
            }
            QLineEdit:focus { border-color: #007acc; }
        """)
        self._input.returnPressed.connect(self._on_evaluate)
        ir_lay.addWidget(self._input)

        layout.addWidget(input_row)

    def _on_evaluate(self):
        text = self._input.text().strip()
        if not text:
            return
        item = QTreeWidgetItem([f"> {text}"])
        item.setForeground(0, QColor("#89d185"))
        self._output.addTopLevelItem(item)
        self._output.scrollToBottom()
        self._input.clear()
        self.evaluate_requested.emit(text)

    def append_result(self, expression: str, result: str):
        item = QTreeWidgetItem([f"  = {result}"])
        item.setForeground(0, QColor("#cccccc"))
        self._output.addTopLevelItem(item)
        self._output.scrollToBottom()

    def append_error(self, expression: str, error: str):
        item = QTreeWidgetItem([f"  x {error}"])
        item.setForeground(0, QColor("#f14c4c"))
        self._output.addTopLevelItem(item)
        self._output.scrollToBottom()

    def append_output(self, text: str, category: str = "stdout"):
        color = "#cccccc" if category == "stdout" else "#f4a261" if category == "stderr" else "#888888"
        item = QTreeWidgetItem([text.rstrip()])
        item.setForeground(0, QColor(color))
        self._output.addTopLevelItem(item)
        self._output.scrollToBottom()

    def clear_console(self):
        self._output.clear()


class DebugPanel(QWidget):
    """Full-featured debug sidebar panel."""

    run_requested = Signal()
    debug_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._dap_client = None
        self._frame_id_map: dict = {}
        self._watch_expressions: list = []
        self._breakpoint_data: list = []
        self._loaded_script_data: list = []
        self._variable_cache: dict = {}
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

    def set_session_names(self, names: list):
        self._session_combo.clear()
        if names:
            self._session_combo.show()
            self._session_combo.addItems(names)
        else:
            self._session_combo.hide()

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

        btn_style = ("QPushButton { background: #1a0033; color: #89d185; font-size: 13px; "
                     "border: 1px solid #3c0068; border-radius: 3px; padding: 2px 8px; } "
                     "QPushButton:hover { background: #2c004a; } "
                     "QPushButton:disabled { color: #555555; border-color: #1a0033; }")
        stop_style = ("QPushButton { background: transparent; color: #f14c4c; font-size: 13px; border: none; } "
                      "QPushButton:hover { background: #1a0033; border-radius: 3px; } "
                      "QPushButton:disabled { color: #555555; }")
        step_style = ("QPushButton { background: transparent; color: #cccccc; font-size: 11px; "
                      "border: none; padding: 2px 5px; } "
                      "QPushButton:hover { background: #1a0033; border-radius: 3px; } "
                      "QPushButton:disabled { color: #555555; }")

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

        self._restart_btn = QPushButton("\u21bb")
        self._restart_btn.setFixedSize(24, 24)
        self._restart_btn.setToolTip("Restart (Ctrl+Shift+F5)")
        self._restart_btn.setStyleSheet(step_style)
        self._restart_btn.clicked.connect(self._on_restart)
        self._restart_btn.setEnabled(False)
        rb_lay.addWidget(self._restart_btn)

        self._config_combo = QComboBox()
        self._config_combo.addItems(["Python: Current File", "Python: Module"])
        self._config_combo.setStyleSheet(
            "QComboBox { background: #0a0a0a; color: #cccccc; border: 1px solid #333333; "
            "padding: 2px 6px; font-size: 12px; }"
        )
        rb_lay.addWidget(self._config_combo)

        self._session_combo = QComboBox()
        self._session_combo.setStyleSheet(
            "QComboBox { background: #0a0a0a; color: #cccccc; border: 1px solid #333333; "
            "padding: 2px 6px; font-size: 12px; }"
        )
        self._session_combo.hide()
        rb_lay.addWidget(self._session_combo)

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

        self._variables_section = SectionWidget("VARIABLES", "variables")
        self._variables_section.tree().setColumnCount(2)
        self._variables_section.tree().setHeaderLabels(["Name", "Value"])
        self._variables_section.tree().header().setStretchLastSection(True)
        self._variables_section.tree().setAlternatingRowColors(False)
        self._variables_section.tree().setContextMenuPolicy(Qt.CustomContextMenu)
        self._variables_section.tree().customContextMenuRequested.connect(
            lambda pos: self._show_var_context_menu(self._variables_section.tree(), pos))
        self._variables_section.tree().itemExpanded.connect(self._on_var_item_expanded)
        c_lay.addWidget(self._variables_section)

        self._watch_section = SectionWidget("WATCH", "watch")
        self._watch_section.tree().setColumnCount(2)
        self._watch_section.tree().setHeaderLabels(["Expression", "Value"])
        self._watch_section.tree().header().setStretchLastSection(True)
        self._watch_section.tree().setContextMenuPolicy(Qt.CustomContextMenu)
        self._watch_section.tree().customContextMenuRequested.connect(
            lambda pos: self._show_watch_context_menu(pos))
        c_lay.addWidget(self._watch_section)

        self._callstack_section = SectionWidget("CALL STACK", "callstack")
        self._callstack_section.tree().setContextMenuPolicy(Qt.CustomContextMenu)
        self._callstack_section.tree().customContextMenuRequested.connect(
            lambda pos: self._show_callstack_context_menu(pos))
        self._callstack_section.tree().itemClicked.connect(self._on_frame_clicked)
        c_lay.addWidget(self._callstack_section)

        self._breakpoints_section = SectionWidget("BREAKPOINTS", "breakpoints")
        self._breakpoints_section.tree().setContextMenuPolicy(Qt.CustomContextMenu)
        self._breakpoints_section.tree().customContextMenuRequested.connect(
            lambda pos: self._show_breakpoint_context_menu(pos))
        c_lay.addWidget(self._breakpoints_section)

        self._loaded_scripts_section = SectionWidget("LOADED SCRIPTS", "loadedscripts")
        self._loaded_scripts_section.tree().setContextMenuPolicy(Qt.CustomContextMenu)
        c_lay.addWidget(self._loaded_scripts_section)

        self._debug_console = DebugConsole()
        self._debug_console.evaluate_requested.connect(self._on_debug_console_evaluate)
        c_lay.addWidget(self._debug_console)

        c_lay.addStretch()
        scroll.setWidget(content)
        layout.addWidget(scroll)

    def _set_debug_buttons(self, active: bool):
        self._stop_btn.setEnabled(active)
        self._continue_btn.setEnabled(active)
        self._step_over_btn.setEnabled(active)
        self._step_in_btn.setEnabled(active)
        self._step_out_btn.setEnabled(active)
        self._restart_btn.setEnabled(active)
        self._debug_btn.setEnabled(not active)

    def _on_run(self):
        from ..core.config import get_config
        trust_manager = WorkspaceTrust()
        if not trust_manager.is_trusted(get_config().workspace_path or ""):
            self._debug_console.append_error("Run", "Execution is disabled because this workspace is untrusted.")
            return
        self.run_requested.emit()

    def _on_start(self):
        from ..core.config import get_config
        trust_manager = WorkspaceTrust()
        if not trust_manager.is_trusted(get_config().workspace_path or ""):
            self._debug_console.append_error("Debug", "Debugger is disabled because this workspace is untrusted.")
            return
        self._set_debug_buttons(True)
        self._status_label.setText("Starting...")
        self.debug_requested.emit()

    def _on_stop(self):
        if self._dap_client:
            threading.Thread(target=self._dap_client.disconnect, daemon=True).start()
        self._set_debug_buttons(False)
        self._status_label.setText("")
        self._clear_debug_data()

    def _on_continue(self):
        if self._dap_client:
            tid = self._dap_client.get_current_thread_id()
            threading.Thread(target=self._dap_client.continue_, args=(tid,), daemon=True).start()

    def _on_step_over(self):
        if self._dap_client:
            tid = self._dap_client.get_current_thread_id()
            threading.Thread(target=self._dap_client.next, args=(tid,), daemon=True).start()

    def _on_step_in(self):
        if self._dap_client:
            tid = self._dap_client.get_current_thread_id()
            threading.Thread(target=self._dap_client.step_in, args=(tid,), daemon=True).start()

    def _on_step_out(self):
        if self._dap_client:
            tid = self._dap_client.get_current_thread_id()
            threading.Thread(target=self._dap_client.step_out, args=(tid,), daemon=True).start()

    def _on_restart(self):
        if self._dap_client:
            threading.Thread(target=self._dap_client.restart, daemon=True).start()

    def _on_dap_event(self, event_name: str, body: dict):
        if event_name == "stopped":
            self._set_debug_buttons(True)
            thread_id = body.get("threadId", 0)
            reason = body.get("reason", "")
            desc = body.get("description", "")
            text = body.get("text", "")
            label = f"Paused ({reason})"
            if desc:
                label += f" - {desc}"
            self._status_label.setText(label)

            all_vars = {}
            if "allThreadsStopped" in body:
                all_vars = body

            self._update_from_debugger(thread_id)

        elif event_name == "continued":
            self._set_debug_buttons(True)
            self._status_label.setText("Running...")

        elif event_name == "terminated":
            self._set_debug_buttons(False)
            self._status_label.setText("Stopped")
            self._clear_debug_data()

        elif event_name == "exited":
            code = body.get("exitCode", 0)
            self._status_label.setText(f"Exited ({code})")
            QTimer.singleShot(2000, lambda: self._set_debug_buttons(False))

        elif event_name == "thread":
            pass

        elif event_name == "output":
            category = body.get("category", "console")
            output = body.get("output", "")
            if category in ("stdout", "stderr", "console"):
                self._debug_console.append_output(output, category)

        elif event_name == "module":
            reason = body.get("reason", "")
            module = body.get("module", {})
            if reason == "new" and module.get("id"):
                pass

        elif event_name == "loadedSource":
            source = body.get("source", {})
            if source.get("path") or source.get("name"):
                pass

        elif event_name == "breakpoint":
            reason = body.get("reason", "")
            bp = body.get("breakpoint", {})
            if reason in ("changed", "new"):
                pass

        elif event_name == "capabilities":
            pass

    def _update_from_debugger(self, thread_id: int):
        if not self._dap_client:
            return

        def worker():
            try:
                frames = self._dap_client.stack_trace(thread_id)
                QTimer.singleShot(0, lambda: self._update_callstack(frames))

                if frames:
                    frame_id = frames[0].get("id", 0)
                    self._frame_id_map = {f.get("id", 0): f for f in frames}
                    scopes = self._dap_client.scopes(frame_id)
                    QTimer.singleShot(0, lambda: self._update_variables(scopes, frame_id))

                QTimer.singleShot(0, self._update_watch_expressions)

            except Exception as e:
                import traceback
                logger.error(f"Debug update error: {e}\n{traceback.format_exc()}")

        threading.Thread(target=worker, daemon=True).start()

    def _update_callstack(self, frames: list):
        tree = self._callstack_section.tree()
        tree.clear()
        for i, frame in enumerate(frames[:50]):
            name = frame.get("name", "unknown")
            src = frame.get("source", {})
            path = src.get("path", "") or src.get("name", "")
            line = frame.get("line", 0)
            short = path.split("/")[-1].split("\\")[-1] if path else "?"
            text = f"{name}  ({short}:{line})" if i > 0 else f"\u25b6 {name}  ({short}:{line})"
            item = QTreeWidgetItem([text])
            item.setData(0, Qt.UserRole, frame.get("id", 0))
            if i == 0:
                item.setForeground(0, QColor("#89d185"))
                font = item.font(0)
                font.setBold(True)
                item.setFont(0, font)
            else:
                item.setForeground(0, QColor("#cccccc"))
            tree.addTopLevelItem(item)
        if not frames:
            ph = QTreeWidgetItem(["No call stack"])
            ph.setForeground(0, QColor("#888888"))
            tree.addTopLevelItem(ph)

    def _update_variables(self, scopes: list, frame_id: int):
        tree = self._variables_section.tree()
        tree.clear()
        self._variable_cache.clear()

        for scope in scopes:
            scope_name = scope.get("name", "Scope")
            vars_ref = scope.get("variablesReference", 0)
            scope_item = QTreeWidgetItem([scope_name, ""])
            scope_item.setForeground(0, QColor("#89d185"))
            font = scope_item.font(0)
            font.setBold(True)
            scope_item.setFont(0, font)

            if vars_ref:
                variables = self._dap_client.variables(vars_ref)
                self._variable_cache[vars_ref] = variables
                for var in variables:
                    child = self._make_var_item(var)
                    scope_item.addChild(child)
                scope_item.setExpanded(scope.get("expensive", False) if scope_name != "Globals" else False)
            else:
                ph = QTreeWidgetItem(["(empty)"])
                ph.setForeground(0, QColor("#888888"))
                scope_item.addChild(ph)

            tree.addTopLevelItem(scope_item)
        if not scopes:
            ph = QTreeWidgetItem(["No variables"])
            ph.setForeground(0, QColor("#888888"))
            tree.addTopLevelItem(ph)

    def _make_var_item(self, var: dict) -> QTreeWidgetItem:
        name = var.get("name", "")
        value = var.get("value", "")
        var_type = var.get("type", "")
        vars_ref = var.get("variablesReference", 0)
        named_vars = var.get("namedVariables", 0)
        indexed_vars = var.get("indexedVariables", 0)

        display = value
        if var_type:
            display = f"{value}  ({var_type})"

        item = QTreeWidgetItem([name, display])
        item.setData(0, Qt.UserRole, vars_ref)
        item.setData(1, Qt.UserRole, var_type)

        if vars_ref > 0:
            item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
            placeholder = QTreeWidgetItem(["loading..."])
            placeholder.setData(0, Qt.UserRole, -1)
            item.addChild(placeholder)
            if named_vars or indexed_vars:
                item.setText(1, f"{value}  [{named_vars + indexed_vars} children]")

        var_type_lower = (var_type or "").lower()
        if var_type_lower in ("str", "string"):
            color = "#ce9178"
        elif var_type_lower in ("int", "float", "number"):
            color = "#b5cea8"
        elif var_type_lower in ("bool", "boolean"):
            color = "#569cd6"
        elif var_type_lower in ("list", "tuple", "set", "array"):
            color = "#dcdcaa"
        elif var_type_lower in ("dict", "map", "object"):
            color = "#4ec9b0"
        elif var_type_lower == "none":
            color = "#808080"
        elif var_type_lower == "function":
            color = "#dcdcaa"
        else:
            color = "#cccccc"

        item.setForeground(0, QColor("#cccccc"))
        item.setForeground(1, QColor(color))

        return item

    def _on_var_item_expanded(self, item: QTreeWidgetItem):
        if not self._dap_client:
            return
        vars_ref = item.data(0, Qt.UserRole)
        if not vars_ref or vars_ref < 0:
            return

        child_count = item.childCount()
        if child_count == 1:
            first = item.child(0)
            if first.data(0, Qt.UserRole) == -1:
                item.removeChild(first)

                if vars_ref in self._variable_cache:
                    children_data = self._variable_cache[vars_ref]
                else:
                    children_data = self._dap_client.variables(vars_ref)
                    self._variable_cache[vars_ref] = children_data

                for child_var in children_data:
                    child_item = self._make_var_item(child_var)
                    item.addChild(child_item)

    def _update_watch_expressions(self):
        tree = self._watch_section.tree()
        tree.clear()
        if not self._watch_expressions:
            ph = QTreeWidgetItem(["Right-click to add watch"])
            ph.setForeground(0, QColor("#888888"))
            tree.addTopLevelItem(ph)
            return

        for expr in self._watch_expressions:
            item = QTreeWidgetItem([expr, "Evaluating..."])
            item.setForeground(0, QColor("#cccccc"))
            item.setForeground(1, QColor("#888888"))
            tree.addTopLevelItem(item)
            self._do_evaluate_watch(expr, item)

    def _do_evaluate_watch(self, expr: str, item: QTreeWidgetItem):
        if not self._dap_client:
            return
        def worker():
            try:
                tid = self._dap_client.get_current_thread_id()
                frames = self._dap_client.stack_trace(tid, levels=1)
                if frames:
                    frame_id = frames[0].get("id", 0)
                    result = self._dap_client.evaluate(expr, frame_id=frame_id, context="watch")
                    if result:
                        val = result.get("result", "")
                        var_type = result.get("type", "")
                        display = f"{val}  ({var_type})" if var_type else val
                        QTimer.singleShot(0, lambda: self._set_watch_item_value(item, display))
                    else:
                        QTimer.singleShot(0, lambda: self._set_watch_item_value(item, "(error)"))
                else:
                    QTimer.singleShot(0, lambda: self._set_watch_item_value(item, "(not running)"))
            except Exception:
                QTimer.singleShot(0, lambda: self._set_watch_item_value(item, "(error)"))
        threading.Thread(target=worker, daemon=True).start()

    def _set_watch_item_value(self, item: QTreeWidgetItem, value: str):
        try:
            item.setText(1, value)
            if value == "(error)":
                item.setForeground(1, QColor("#f14c4c"))
            elif value == "(not running)":
                item.setForeground(1, QColor("#888888"))
            else:
                item.setForeground(1, QColor("#b5cea8"))
        except RuntimeError:
            pass

    def _on_frame_clicked(self, item: QTreeWidgetItem, column: int):
        frame_id = item.data(0, Qt.UserRole)
        if frame_id and self._dap_client:
            def worker():
                try:
                    scopes = self._dap_client.scopes(frame_id)
                    QTimer.singleShot(0, lambda: self._update_variables(scopes, frame_id))
                except Exception:
                    pass
            threading.Thread(target=worker, daemon=True).start()

    def _on_debug_console_evaluate(self, expression: str):
        if not self._dap_client:
            self._debug_console.append_error(expression, "Not debugging")
            return
        def worker():
            try:
                tid = self._dap_client.get_current_thread_id()
                frames = self._dap_client.stack_trace(tid, levels=1)
                frame_id = frames[0].get("id", 0) if frames else 0
                result = self._dap_client.evaluate(expression, frame_id=frame_id, context="repl")
                if result:
                    val = result.get("result", "")
                    var_type = result.get("type", "")
                    display = f"{val}" + (f"  ({var_type})" if var_type else "")
                    QTimer.singleShot(0, lambda: self._debug_console.append_result(expression, display))
                else:
                    QTimer.singleShot(0, lambda: self._debug_console.append_error(expression, "(no result)"))
            except Exception as e:
                QTimer.singleShot(0, lambda: self._debug_console.append_error(expression, str(e)))
        threading.Thread(target=worker, daemon=True).start()

    def _show_var_context_menu(self, tree: QTreeWidget, pos):
        item = tree.itemAt(pos)
        if not item:
            return
        menu = QMenu()
        copy_name = QAction("Copy Name", self)
        copy_name.triggered.connect(lambda: self._copy_text(item.text(0)))
        menu.addAction(copy_name)
        copy_value = QAction("Copy Value", self)
        copy_value.triggered.connect(lambda: self._copy_text(item.text(1)))
        menu.addAction(copy_value)
        add_watch = QAction("Add to Watch", self)
        add_watch.triggered.connect(lambda: self._add_watch(item.text(0)))
        menu.addAction(add_watch)

        if item.data(0, Qt.UserRole) and self._dap_client:
            set_val = QAction("Set Value...", self)
            set_val.triggered.connect(lambda: self._set_variable_value(item))
            menu.addAction(set_val)

        menu.exec(tree.viewport().mapToGlobal(pos))

    def _show_watch_context_menu(self, pos):
        tree = self._watch_section.tree()
        item = tree.itemAt(pos)
        menu = QMenu()
        add_watch = QAction("Add Expression...", self)
        add_watch.triggered.connect(self._add_watch_dialog)
        menu.addAction(add_watch)
        if item and item.text(0) != "Right-click to add watch":
            remove_watch = QAction("Remove Expression", self)
            remove_watch.triggered.connect(lambda: self._remove_watch(item.text(0)))
            menu.addAction(remove_watch)
            edit_watch = QAction("Edit Expression...", self)
            edit_watch.triggered.connect(lambda: self._edit_watch(item))
            menu.addAction(edit_watch)
        menu.exec(tree.viewport().mapToGlobal(pos))

    def _show_callstack_context_menu(self, pos):
        tree = self._callstack_section.tree()
        item = tree.itemAt(pos)
        menu = QMenu()
        if item:
            copy = QAction("Copy", self)
            copy.triggered.connect(lambda: self._copy_text(item.text(0)))
            menu.addAction(copy)
        menu.exec(tree.viewport().mapToGlobal(pos))

    def _show_breakpoint_context_menu(self, pos):
        tree = self._breakpoints_section.tree()
        menu = QMenu()
        enable_all = QAction("Enable All Breakpoints", self)
        disable_all = QAction("Disable All Breakpoints", self)
        remove_all = QAction("Remove All Breakpoints", self)
        menu.addAction(enable_all)
        menu.addAction(disable_all)
        menu.addAction(remove_all)
        menu.exec(tree.viewport().mapToGlobal(pos))

    def _copy_text(self, text: str):
        from PySide6.QtGui import QClipboard
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(text)

    def _add_watch(self, expression: str):
        if expression and expression not in self._watch_expressions:
            self._watch_expressions.append(expression)
        self._update_watch_expressions()

    def _add_watch_dialog(self):
        text, ok = QInputDialog.getText(self, "Add Watch", "Expression to watch:")
        if ok and text:
            self._add_watch(text)

    def _remove_watch(self, expression: str):
        if expression in self._watch_expressions:
            self._watch_expressions.remove(expression)
        self._update_watch_expressions()

    def _edit_watch(self, item: QTreeWidgetItem):
        old = item.text(0)
        text, ok = QInputDialog.getText(self, "Edit Watch", "Expression:", text=old)
        if ok and text:
            if old in self._watch_expressions:
                idx = self._watch_expressions.index(old)
                self._watch_expressions[idx] = text
            self._update_watch_expressions()

    def _set_variable_value(self, item: QTreeWidgetItem):
        name = item.text(0)
        value, ok = QInputDialog.getText(self, "Set Variable Value", f"{name} =", text=item.text(1).split("  (")[0])
        if ok and value and self._dap_client:
            parent = item.parent()
            if parent:
                parent_vars_ref = parent.data(0, Qt.UserRole)
                if parent_vars_ref:
                    def worker():
                        try:
                            self._dap_client.set_variable(parent_vars_ref, name, value)
                        except Exception:
                            pass
                    threading.Thread(target=worker, daemon=True).start()

    def update_breakpoints(self, breakpoints: list):
        self._breakpoint_data = breakpoints
        tree = self._breakpoints_section.tree()
        tree.clear()
        file_groups = {}
        for bp in breakpoints:
            path = bp.get("path", bp.get("source", {}).get("path", "unknown"))
            file_groups.setdefault(path, []).append(bp)
        if not file_groups:
            ph = QTreeWidgetItem(["No breakpoints set"])
            ph.setForeground(0, QColor("#888888"))
            tree.addTopLevelItem(ph)
            return
        for path, points in file_groups.items():
            short = path.split("/")[-1].split("\\")[-1]
            file_item = QTreeWidgetItem([f"{short}  ({len(points)})"])
            file_item.setForeground(0, QColor("#cccccc"))
            for bp in points:
                line = bp.get("line", 0)
                cond = bp.get("condition", "")
                log = bp.get("logMessage", "")
                hit = bp.get("hitCondition", "")
                enabled = bp.get("enabled", True)
                bp_text = f"Line {line}"
                if cond:
                    bp_text += f" [if: {cond}]"
                if log:
                    bp_text += f" [log: {log[:30]}]"
                if hit:
                    bp_text += f" [hit: {hit}]"
                bp_item = QTreeWidgetItem([bp_text])
                bp_item.setForeground(0, QColor("#f14c4c" if enabled else "#888888"))
                file_item.addChild(bp_item)
            file_item.setExpanded(True)
            tree.addTopLevelItem(file_item)

    def update_loaded_scripts(self, sources: list):
        self._loaded_script_data = sources
        tree = self._loaded_scripts_section.tree()
        tree.clear()
        if not sources:
            ph = QTreeWidgetItem(["No loaded scripts"])
            ph.setForeground(0, QColor("#888888"))
            tree.addTopLevelItem(ph)
            return
        for src in sources:
            path = src.get("path", src.get("name", "?"))
            item = QTreeWidgetItem([path])
            item.setForeground(0, QColor("#cccccc"))
            tree.addTopLevelItem(item)

    def _clear_debug_data(self):
        for section in [self._variables_section, self._watch_section,
                        self._callstack_section, self._breakpoints_section,
                        self._loaded_scripts_section]:
            try:
                section.set_placeholder("Not debugging")
            except (RuntimeError, AttributeError):
                pass
        self._frame_id_map.clear()
        self._variable_cache.clear()
