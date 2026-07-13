from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem, QPushButton,
    QScrollArea, QLineEdit, QLabel, QInputDialog, QMenu, QHBoxLayout
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor


class DebugPanel(QWidget):
    """Legacy debug panel widget - delegates to the full panel in debug/panel.py."""

    evaluate_requested = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._dap_client = None
        self._watch_expressions = []

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setStyleSheet("QScrollArea { border: none; }")

        self.container = QWidget()
        self.layout = QVBoxLayout(self.container)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(1)

        self.variables_tree = QTreeWidget()
        self.variables_tree.setColumnCount(2)
        self.variables_tree.setHeaderLabels(["Name", "Value"])
        self.variables_tree.setAlternatingRowColors(False)
        self.variables_tree.setAnimated(True)
        self.variables_tree.setStyleSheet("""
            QTreeWidget { background-color: #000000; color: #cccccc; border: none; font-size: 12px; }
            QTreeWidget::item { padding: 2px 4px; }
            QTreeWidget::item:selected { background-color: #04395e; }
            QTreeWidget::item:hover { background-color: #1a1a2e; }
        """)
        self.variables_tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.variables_tree.customContextMenuRequested.connect(
            lambda pos: self._show_context_menu(self.variables_tree, pos))
        self.variables_tree.itemExpanded.connect(self._on_var_expanded)
        self.layout.addWidget(self._make_header("VARIABLES", self.variables_tree))

        self.watch_tree = QTreeWidget()
        self.watch_tree.setColumnCount(2)
        self.watch_tree.setHeaderLabels(["Expression", "Value"])
        self.watch_tree.setStyleSheet("""
            QTreeWidget { background-color: #000000; color: #cccccc; border: none; font-size: 12px; }
            QTreeWidget::item { padding: 2px 4px; }
            QTreeWidget::item:selected { background-color: #04395e; }
        """)
        self.watch_tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.watch_tree.customContextMenuRequested.connect(
            lambda pos: self._show_watch_context_menu(pos))
        self.layout.addWidget(self._make_header("WATCH", self.watch_tree))

        self.callstack_tree = QTreeWidget()
        self.callstack_tree.setHeaderHidden(True)
        self.callstack_tree.setStyleSheet("""
            QTreeWidget { background-color: #000000; color: #cccccc; border: none; font-size: 12px; }
            QTreeWidget::item { padding: 2px 4px; }
            QTreeWidget::item:selected { background-color: #04395e; }
        """)
        self.layout.addWidget(self._make_header("CALL STACK", self.callstack_tree))

        self.breakpoints_tree = QTreeWidget()
        self.breakpoints_tree.setHeaderHidden(True)
        self.breakpoints_tree.setStyleSheet("""
            QTreeWidget { background-color: #000000; color: #cccccc; border: none; font-size: 12px; }
            QTreeWidget::item { padding: 2px 4px; }
        """)
        self.layout.addWidget(self._make_header("BREAKPOINTS", self.breakpoints_tree))

        console_row = QWidget()
        console_row.setStyleSheet("background-color: #0a0a0a;")
        cr_lay = QHBoxLayout(console_row)
        cr_lay.setContentsMargins(4, 2, 4, 2)
        prompt = QLabel("> ")
        prompt.setStyleSheet("color: #89d185; font-weight: bold;")
        cr_lay.addWidget(prompt)
        self._console_input = QLineEdit()
        self._console_input.setPlaceholderText("Debug expression")
        self._console_input.setStyleSheet("""
            QLineEdit { background-color: #1a1a1a; color: #cccccc; border: 1px solid #333;
            border-radius: 2px; padding: 3px 6px; font-family: 'Consolas', 'Courier New'; }
            QLineEdit:focus { border-color: #007acc; }
        """)
        self._console_input.returnPressed.connect(lambda: self.evaluate_requested.emit(self._console_input.text().strip()))
        cr_lay.addWidget(self._console_input)

        self.layout.addWidget(console_row)
        self.layout.addStretch()

        self.scroll.setWidget(self.container)
        main_layout.addWidget(self.scroll)

        # Placeholder items
        for t in [self.variables_tree, self.callstack_tree, self.breakpoints_tree]:
            ph = QTreeWidgetItem(["Not debugging"])
            ph.setForeground(0, QColor("#888888"))
            t.addTopLevelItem(ph)

        ph = QTreeWidgetItem(["Right-click to add"])
        ph.setForeground(0, QColor("#888888"))
        self.watch_tree.addTopLevelItem(ph)

    def _make_header(self, title, tree):
        btn = QPushButton(f"\u25bc {title}")
        btn.setStyleSheet("""
            QPushButton { text-align: left; padding: 4px 8px;
            background-color: #1a1a1a; color: #bbbbbb;
            border: none; border-bottom: 1px solid #2b2b2b;
            font-size: 11px; font-weight: 600; }
            QPushButton:hover { background-color: #2a2a2a; }
        """)
        btn.clicked.connect(lambda: tree.setVisible(not tree.isVisible()))
        return btn

    def set_dap_client(self, client):
        self._dap_client = client

    def clear(self):
        for tree in [self.variables_tree, self.watch_tree, self.callstack_tree, self.breakpoints_tree]:
            tree.clear()
            ph = QTreeWidgetItem(["Not debugging"])
            ph.setForeground(0, QColor("#888888"))
            tree.addTopLevelItem(ph)

    def _show_context_menu(self, tree, pos):
        item = tree.itemAt(pos)
        if not item:
            return
        menu = QMenu()
        copy_name = menu.addAction("Copy Name")
        copy_name.triggered.connect(lambda: self._copy(item.text(0)))
        copy_val = menu.addAction("Copy Value")
        copy_val.triggered.connect(lambda: self._copy(item.text(1)))
        add_watch = menu.addAction("Add to Watch")
        add_watch.triggered.connect(lambda: self._add_watch(item.text(0)))
        menu.exec(tree.viewport().mapToGlobal(pos))

    def _show_watch_context_menu(self, pos):
        tree = self.watch_tree
        item = tree.itemAt(pos)
        menu = QMenu()
        add = menu.addAction("Add Expression...")
        add.triggered.connect(self._add_watch_dialog)
        if item and item.text(0) not in ("Right-click to add",):
            rem = menu.addAction("Remove")
            rem.triggered.connect(lambda: self._remove_watch(item.text(0)))
            edit = menu.addAction("Edit...")
            edit.triggered.connect(lambda: self._edit_watch(item))
        menu.exec(tree.viewport().mapToGlobal(pos))

    def _on_var_expanded(self, item):
        if not self._dap_client:
            return
        ref = item.data(0, Qt.UserRole)
        if ref and ref > 0:
            if item.childCount() == 1:
                first = item.child(0)
                if first.text(0) == "loading...":
                    item.removeChild(first)
                    children = self._dap_client.variables(ref)
                    for child in children:
                        ci = QTreeWidgetItem([child.get("name", ""), child.get("value", "")])
                        ci.setForeground(1, QColor(self._type_color(child.get("type", ""))))
                        cref = child.get("variablesReference", 0)
                        ci.setData(0, Qt.UserRole, cref)
                        if cref > 0:
                            ci.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
                            ci.addChild(QTreeWidgetItem(["loading..."]))
                        item.addChild(ci)

    def _type_color(self, t):
        colors = {
            "str": "#ce9178", "string": "#ce9178",
            "int": "#b5cea8", "float": "#b5cea8", "number": "#b5cea8",
            "bool": "#569cd6", "boolean": "#569cd6",
            "list": "#dcdcaa", "tuple": "#dcdcaa", "array": "#dcdcaa",
            "dict": "#4ec9b0", "map": "#4ec9b0", "object": "#4ec9b0",
            "NoneType": "#808080", "None": "#808080", "function": "#dcdcaa",
        }
        return colors.get(t.lower(), "#cccccc") if t else "#cccccc"

    def _copy(self, text):
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(text)

    def _add_watch(self, expr):
        if expr and expr not in self._watch_expressions:
            self._watch_expressions.append(expr)
        self._refresh_watches()

    def _add_watch_dialog(self):
        text, ok = QInputDialog.getText(self, "Add Watch", "Expression:")
        if ok and text:
            self._add_watch(text)

    def _remove_watch(self, expr):
        if expr in self._watch_expressions:
            self._watch_expressions.remove(expr)
        self._refresh_watches()

    def _edit_watch(self, item):
        old = item.text(0)
        text, ok = QInputDialog.getText(self, "Edit Watch", "Expression:", text=old)
        if ok and text:
            idx = self._watch_expressions.index(old)
            self._watch_expressions[idx] = text
            self._refresh_watches()

    def _refresh_watches(self):
        self.watch_tree.clear()
        if not self._watch_expressions:
            ph = QTreeWidgetItem(["Right-click to add"])
            ph.setForeground(0, QColor("#888888"))
            self.watch_tree.addTopLevelItem(ph)
            return
        for expr in self._watch_expressions:
            item = QTreeWidgetItem([expr, "..."])
            item.setForeground(0, QColor("#cccccc"))
            self.watch_tree.addTopLevelItem(item)
            self._evaluate_watch(expr, item)

    def _evaluate_watch(self, expr, item):
        if not self._dap_client:
            return
        import threading
        def worker():
            try:
                tid = self._dap_client.get_current_thread_id()
                frames = self._dap_client.stack_trace(tid, levels=1)
                if frames:
                    result = self._dap_client.evaluate(expr, frame_id=frames[0].get("id", 0), context="watch")
                    if result:
                        from PySide6.QtCore import QTimer
                        QTimer.singleShot(0, lambda: item.setText(1, result.get("result", "")))
            except Exception:
                pass
        threading.Thread(target=worker, daemon=True).start()
