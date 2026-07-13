from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QScrollArea, QPushButton, QHBoxLayout,
    QTextEdit, QLabel, QSplitter, QLineEdit, QListWidget, QTreeWidget,
    QTreeWidgetItem, QMenu, QApplication, QFrame, QSizePolicy,
    QInputDialog, QMessageBox, QCompleter, QAbstractItemView, QHeaderView,
    QListWidgetItem, QLayout, QStackedWidget, QCheckBox, QTabWidget,
)
from PySide6.QtCore import Qt, Signal, QMimeData, QPoint, QTimer, QStringListModel, QByteArray, QDataStream, QIODevice
from PySide6.QtGui import (
    QDrag, QFont, QKeySequence, QShortcut, QPixmap, QTextCursor,
    QIcon, QColor, QPainter, QBrush, QPen, QFontMetrics
)
from .kernel_client import KernelClient
import json
import re
import uuid
import html as html_mod
import base64
import io
import os

MIME_CELL_ID = "application/x-dardcor-notebook-cell"

class CellOutputWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.setSpacing(2)

    def add_output(self, msg_type: str, content: dict):
        if msg_type == "stream":
            text = content.get("text", "")
            name = content.get("name", "stdout")
            w = QTextEdit()
            w.setReadOnly(True)
            w.setPlainText(text)
            color = "#d4d4d4" if name == "stdout" else "#f48771"
            w.setStyleSheet(f"QTextEdit {{ background: transparent; color: {color}; border: none; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; }}")
            w.setMaximumHeight(max(30, min(len(text.split('\n')) * 20 + 10, 600)))
            w.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
            self._layout.addWidget(w)

        elif msg_type == "display_data":
            self._render_data(content.get("data", {}))

        elif msg_type == "execute_result":
            data = content.get("data", {})
            if data:
                exec_count = content.get("execution_count", "")
                header = QLabel(f"Out[{exec_count}]:")
                header.setStyleSheet("color: #888; font-weight: bold; font-size: 11px; padding: 2px 0;")
                self._layout.addWidget(header)
                self._render_data(data)

        elif msg_type == "error":
            ename = content.get("ename", "")
            evalue = content.get("evalue", "")
            traceback = content.get("traceback", [])
            text = "\n".join(traceback) if traceback else f"{ename}: {evalue}"
            w = QTextEdit()
            w.setReadOnly(True)
            w.setPlainText(text)
            w.setStyleSheet("QTextEdit { background: #2d1b1b; color: #f48771; border: 1px solid #5a1d1d; border-radius: 3px; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; }")
            self._layout.addWidget(w)

    def _render_data(self, data: dict):
        if "image/png" in data and data["image/png"]:
            try:
                img_data = data["image/png"]
                if isinstance(img_data, str):
                    img_bytes = base64.b64decode(img_data)
                else:
                    img_bytes = img_data
                pixmap = QPixmap()
                pixmap.loadFromData(img_bytes, "PNG")
                if not pixmap.isNull():
                    lbl = QLabel()
                    scaled = pixmap.scaled(min(pixmap.width(), 640), min(pixmap.height(), 480),
                                          Qt.KeepAspectRatio, Qt.SmoothTransformation)
                    lbl.setPixmap(scaled)
                    lbl.setStyleSheet("background: transparent; padding: 4px;")
                    self._layout.addWidget(lbl)
            except Exception:
                pass

        if "image/svg+xml" in data and data["image/svg+xml"]:
            svg_text = data["image/svg+xml"]
            w = QTextEdit()
            w.setReadOnly(True)
            w.setHtml(f"<div>{svg_text}</div>")
            w.setStyleSheet("background: transparent; border: none;")
            self._layout.addWidget(w)

        if "text/html" in data and data["text/html"]:
            html_content = data["text/html"]
            w = QTextEdit()
            w.setReadOnly(True)
            w.setHtml(html_content)
            w.setStyleSheet("QTextEdit { background: transparent; color: #d4d4d4; border: 1px solid #333; border-radius: 3px; }")
            self._layout.addWidget(w)

        if "text/markdown" in data and data["text/markdown"]:
            md = data["text/markdown"]
            w = QTextEdit()
            w.setReadOnly(True)
            w.setMarkdown(md)
            w.setStyleSheet("background: transparent; color: #d4d4d4; border: none;")
            self._layout.addWidget(w)

        if "text/plain" in data and data["text/plain"]:
            if "image/png" not in data and "image/svg+xml" not in data and "text/html" not in data and "text/markdown" not in data:
                text = data["text/plain"]
                w = QTextEdit()
                w.setReadOnly(True)
                w.setPlainText(text)
                w.setStyleSheet("QTextEdit { background: transparent; color: #d4d4d4; border: none; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; }")
                self._layout.addWidget(w)

    def clear_outputs(self):
        while self._layout.count():
            item = self._layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()


class NotebookCell(QFrame):
    run_requested = Signal(object)
    move_up_requested = Signal(object)
    move_down_requested = Signal(object)
    copy_requested = Signal(object)
    cut_requested = Signal(object)
    paste_requested = Signal(object)
    delete_requested = Signal(object)
    split_requested = Signal(object)
    merge_up_requested = Signal(object)
    content_changed = Signal()

    _drag_start_pos = None

    def __init__(self, cell_type: str = "code", content: str = "", parent=None):
        super().__init__(parent)
        self.cell_id = str(uuid.uuid4())
        self.cell_type = cell_type
        self._collapsed = False
        self.metadata = {}
        self.setAcceptDrops(True)

        self._main_layout = QVBoxLayout(self)
        self._main_layout.setContentsMargins(0, 0, 0, 0)
        self._main_layout.setSpacing(0)

        self._build_toolbar()
        self._build_editor(content)
        self._build_output()

        self.setFrameShape(QFrame.StyledPanel)
        self.setStyleSheet("""
            NotebookCell {
                border: 1px solid #454545;
                border-radius: 4px;
                background: #1e1e1e;
                margin-bottom: 6px;
            }
            NotebookCell:hover {
                border-color: #5a5a5a;
            }
        """)

    def _build_toolbar(self):
        self.toolbar = QWidget()
        self.toolbar.setFixedHeight(32)
        self.toolbar.setStyleSheet("background: #252526; border-bottom: 1px solid #333; border-radius: 4px 4px 0 0;")
        tb = QHBoxLayout(self.toolbar)
        tb.setContentsMargins(6, 0, 6, 0)
        tb.setSpacing(3)

        self.type_label = QLabel("Code" if self.cell_type == "code" else "Markdown")
        self.type_label.setStyleSheet("color: #569cd6; font-weight: bold; font-size: 11px; padding: 0 4px;")
        tb.addWidget(self.type_label)

        self.btn_collapse = QPushButton("▼")
        self.btn_collapse.setFixedSize(22, 22)
        self.btn_collapse.setToolTip("Collapse cell")
        self.btn_collapse.setStyleSheet("QPushButton { background: transparent; border: none; color: #888; font-size: 10px; } QPushButton:hover { color: #fff; }")
        self.btn_collapse.clicked.connect(self.toggle_collapse)
        tb.addWidget(self.btn_collapse)

        self.btn_move_up = QPushButton("↑")
        self.btn_move_up.setFixedSize(22, 22)
        self.btn_move_up.setToolTip("Move cell up")
        self.btn_move_up.setStyleSheet("QPushButton { background: transparent; border: none; color: #888; font-size: 12px; } QPushButton:hover { color: #fff; }")
        self.btn_move_up.clicked.connect(lambda: self.move_up_requested.emit(self))
        tb.addWidget(self.btn_move_up)

        self.btn_move_down = QPushButton("↓")
        self.btn_move_down.setFixedSize(22, 22)
        self.btn_move_down.setToolTip("Move cell down")
        self.btn_move_down.setStyleSheet("QPushButton { background: transparent; border: none; color: #888; font-size: 12px; } QPushButton:hover { color: #fff; }")
        self.btn_move_down.clicked.connect(lambda: self.move_down_requested.emit(self))
        tb.addWidget(self.btn_move_down)

        tb.addStretch()

        self.btn_copy = QPushButton("Copy")
        self.btn_copy.setFixedHeight(22)
        self.btn_copy.setToolTip("Copy cell")
        self.btn_copy.setStyleSheet("QPushButton { background: transparent; border: none; color: #888; font-size: 11px; padding: 0 6px; } QPushButton:hover { color: #fff; }")
        self.btn_copy.clicked.connect(lambda: self.copy_requested.emit(self))
        tb.addWidget(self.btn_copy)

        self.btn_cut = QPushButton("Cut")
        self.btn_cut.setFixedHeight(22)
        self.btn_cut.setToolTip("Cut cell")
        self.btn_cut.setStyleSheet("QPushButton { background: transparent; border: none; color: #888; font-size: 11px; padding: 0 6px; } QPushButton:hover { color: #fff; }")
        self.btn_cut.clicked.connect(lambda: self.cut_requested.emit(self))
        tb.addWidget(self.btn_cut)

        if self.cell_type == "code":
            self.btn_run = QPushButton("▶ Run")
            self.btn_run.setFixedHeight(22)
            self.btn_run.setToolTip("Execute cell")
            self.btn_run.setStyleSheet("QPushButton { background: #0e639c; color: white; border: none; border-radius: 3px; padding: 0 10px; font-size: 11px; font-weight: bold; } QPushButton:hover { background: #1177bb; }")
            tb.addWidget(self.btn_run)
        else:
            self.btn_run = None

        self._main_layout.addWidget(self.toolbar)

    def _build_editor(self, content: str):
        self.editor = QTextEdit()
        self.editor.setPlainText(content)
        self.editor.setMinimumHeight(40)
        self.editor.setMaximumHeight(250)
        self.editor.setStyleSheet("""
            QTextEdit {
                background: #1e1e1e;
                color: #d4d4d4;
                border: none;
                border-bottom: 1px solid #333;
                padding: 6px;
                font-family: 'Consolas', 'Courier New', monospace;
                font-size: 13px;
            }
            QTextEdit:focus {
                border-bottom: 1px solid #0e639c;
            }
        """)
        self.editor.setTabStopDistance(QFontMetrics(self.editor.font()).horizontalAdvance(' ') * 4)
        self.editor.textChanged.connect(self.content_changed.emit)
        self._main_layout.addWidget(self.editor)

    def _build_output(self):
        self.output_area = CellOutputWidget()
        self.output_area.setVisible(False)
        self._main_layout.addWidget(self.output_area)

    def toggle_collapse(self):
        self._collapsed = not self._collapsed
        if self._collapsed:
            self.editor.setVisible(False)
            self.output_area.setVisible(False)
            self.btn_collapse.setText("▶")
            self.btn_collapse.setToolTip("Expand cell")
        else:
            self.editor.setVisible(True)
            if self.output_area._layout.count() > 0:
                self.output_area.setVisible(True)
            self.btn_collapse.setText("▼")
            self.btn_collapse.setToolTip("Collapse cell")

    def set_collapsed(self, collapsed: bool):
        self._collapsed = collapsed
        if collapsed:
            self.editor.setVisible(False)
            self.output_area.setVisible(False)
            self.btn_collapse.setText("▶")
        else:
            self.editor.setVisible(True)
            if self.output_area._layout.count() > 0:
                self.output_area.setVisible(True)
            self.btn_collapse.setText("▼")

    def get_source(self) -> str:
        return self.editor.toPlainText()

    def set_source(self, text: str):
        self.editor.setPlainText(text)

    def clear_outputs(self):
        self.output_area.clear_outputs()
        self.output_area.setVisible(False)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            NotebookCell._drag_start_pos = event.position().toPoint()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if not (event.buttons() & Qt.LeftButton):
            return
        if NotebookCell._drag_start_pos is None:
            return
        if (event.position().toPoint() - NotebookCell._drag_start_pos).manhattanLength() < QApplication.startDragDistance():
            return
        self._start_drag()
        NotebookCell._drag_start_pos = None

    def _start_drag(self):
        drag = QDrag(self)
        mime = QMimeData()
        mime.setData(MIME_CELL_ID, self.cell_id.encode('utf-8'))
        drag.setMimeData(mime)
        drag.exec_(Qt.MoveAction)

    def dragEnterEvent(self, event):
        if event.mimeData().hasFormat(MIME_CELL_ID):
            event.acceptProposedAction()

    def dragMoveEvent(self, event):
        if event.mimeData().hasFormat(MIME_CELL_ID):
            pos_in_cell = event.position().toPoint().y()
            mid = self.height() / 2
            if pos_in_cell < mid:
                self.setStyleSheet("NotebookCell { border: 2px solid #0e639c; border-top: 3px solid #0e639c; background: #1e1e1e; }")
            else:
                self.setStyleSheet("NotebookCell { border: 2px solid #0e639c; border-bottom: 3px solid #0e639c; background: #1e1e1e; }")
            event.acceptProposedAction()

    def dragLeaveEvent(self, event):
        self.setStyleSheet("NotebookCell { border: 1px solid #454545; border-radius: 4px; background: #1e1e1e; }")

    def dropEvent(self, event):
        self.setStyleSheet("NotebookCell { border: 1px solid #454545; border-radius: 4px; background: #1e1e1e; }")
        if event.mimeData().hasFormat(MIME_CELL_ID):
            dragged_id = event.mimeData().data(MIME_CELL_ID).data().decode('utf-8')
            if dragged_id != self.cell_id:
                pos_in_cell = event.position().toPoint().y()
                mid = self.height() / 2
                insert_after = pos_in_cell >= mid
                parent_editor = self._find_parent_editor()
                if parent_editor:
                    parent_editor._handle_cell_drop(dragged_id, self.cell_id, insert_after)
                event.acceptProposedAction()

    def _find_parent_editor(self):
        p = self.parent()
        while p:
            if isinstance(p, NotebookEditor):
                return p
            p = p.parent()
        return None

    def contextMenuEvent(self, event):
        menu = QMenu(self)
        mk = lambda text, slot: menu.addAction(text, slot)

        mk("Run Cell", lambda: self.run_requested.emit(self))
        if self.cell_type == "code":
            mk("Run Below", lambda: self._run_below())
        mk("Copy Cell", lambda: self.copy_requested.emit(self))
        mk("Cut Cell", lambda: self.cut_requested.emit(self))
        mk("Paste Cell", lambda: self.paste_requested.emit(self))
        mk("Delete Cell", lambda: self.delete_requested.emit(self))
        menu.addSeparator()
        mk("Move Up", lambda: self.move_up_requested.emit(self))
        mk("Move Down", lambda: self.move_down_requested.emit(self))
        menu.addSeparator()
        mk("Split Cell", lambda: self.split_requested.emit(self))
        mk("Merge Cell Above", lambda: self.merge_up_requested.emit(self))
        menu.addSeparator()
        act = menu.addAction("Collapse" if not self._collapsed else "Expand")
        act.triggered.connect(self.toggle_collapse)
        mk("Clear Outputs", self.clear_outputs)

        menu.exec_(event.globalPos())

    def _run_below(self):
        parent = self._find_parent_editor()
        if parent:
            idx = parent._get_cell_index(self)
            if idx is not None and idx + 1 < len(parent.cells):
                parent.run_cell(parent.cells[idx + 1])

    def focus_editor(self):
        self.editor.setFocus()


class VariableExplorer(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(2)

        header = QLabel("VARIABLES")
        header.setStyleSheet("color: #888; font-size: 11px; font-weight: bold; padding: 6px; background: #252526; border-bottom: 1px solid #333;")
        layout.addWidget(header)

        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(["Name", "Type", "Value"])
        self.tree.setRootIsDecorated(False)
        self.tree.setAlternatingRowColors(True)
        self.tree.setStyleSheet("""
            QTreeWidget { background: #1e1e1e; color: #d4d4d4; border: none; font-size: 12px; }
            QTreeWidget::item { padding: 2px 4px; }
            QTreeWidget::item:alternate { background: #252526; }
            QTreeWidget::item:hover { background: #2a2d2e; }
            QHeaderView::section { background: #333; color: #ccc; border: none; padding: 3px; font-size: 11px; }
        """)
        self.tree.header().setStretchLastSection(True)
        self.tree.header().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.tree.header().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        layout.addWidget(self.tree)

        self.btn_refresh = QPushButton("Refresh")
        self.btn_refresh.setStyleSheet("QPushButton { background: #0e639c; color: white; border: none; padding: 4px; font-size: 11px; } QPushButton:hover { background: #1177bb; }")
        layout.addWidget(self.btn_refresh)
        self.setMinimumWidth(200)

    def set_variables(self, variables: list):
        self.tree.clear()
        for var in variables:
            item = QTreeWidgetItem([var.get("name", ""), var.get("type", ""), var.get("value", "")])
            if var.get("type") in ("int", "float", "bool"):
                item.setForeground(1, QColor("#b5cea8"))
            elif var.get("type") in ("str", "bytes"):
                item.setForeground(1, QColor("#ce9178"))
            elif var.get("type") in ("list", "tuple", "set", "dict"):
                item.setForeground(1, QColor("#569cd6"))
            else:
                item.setForeground(1, QColor("#dcdcaa"))
            self.tree.addTopLevelItem(item)


class OutlinePanel(QWidget):
    outline_activated = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(2)

        header = QLabel("OUTLINE")
        header.setStyleSheet("color: #888; font-size: 11px; font-weight: bold; padding: 6px; background: #252526; border-bottom: 1px solid #333;")
        layout.addWidget(header)

        self.list_widget = QListWidget()
        self.list_widget.setStyleSheet("""
            QListWidget { background: #1e1e1e; color: #d4d4d4; border: none; font-size: 12px; }
            QListWidget::item { padding: 4px 8px; border-bottom: 1px solid #2a2a2a; }
            QListWidget::item:hover { background: #2a2d2e; }
            QListWidget::item:selected { background: #094771; }
        """)
        self.list_widget.itemClicked.connect(self._on_item_clicked)
        layout.addWidget(self.list_widget)
        self.setMinimumWidth(180)

    def rebuild(self, cells: list):
        self.list_widget.clear()
        for i, cell in enumerate(cells):
            text = cell.get_source()
            if cell.cell_type == "markdown":
                for m in re.finditer(r'^(#{1,6})\s+(.+)$', text, re.MULTILINE):
                    level = len(m.group(1))
                    title = m.group(2)
                    prefix = "  " * (level - 1)
                    item = QListWidgetItem(f"{prefix}# {title}")
                    item.setData(Qt.UserRole, i)
                    font = item.font()
                    font.setBold(True) if level == 1 else None
                    item.setForeground(QColor("#569cd6"))
                    self.list_widget.addItem(item)
            elif cell.cell_type == "code":
                for m in re.finditer(r'^#\s+(.+)$', text, re.MULTILINE):
                    title = m.group(1)
                    item = QListWidgetItem(f"  {title}")
                    item.setData(Qt.UserRole, i)
                    item.setForeground(QColor("#6a9955"))
                    self.list_widget.addItem(item)

    def _on_item_clicked(self, item):
        idx = item.data(Qt.UserRole)
        if idx is not None:
            self.outline_activated.emit(idx)


class SearchBar(QWidget):
    next_requested = Signal()
    previous_requested = Signal()
    text_changed = Signal(str)
    closed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(6, 2, 6, 2)
        layout.setSpacing(4)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search cells...")
        self.search_input.setStyleSheet("""
            QLineEdit { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555;
                        border-radius: 3px; padding: 3px 6px; font-size: 12px; }
            QLineEdit:focus { border-color: #0e639c; }
        """)
        self.search_input.textChanged.connect(self.text_changed.emit)
        self.search_input.returnPressed.connect(self.next_requested.emit)
        layout.addWidget(self.search_input)

        self.btn_prev = QPushButton("▲")
        self.btn_prev.setFixedSize(24, 24)
        self.btn_prev.setToolTip("Previous match")
        self.btn_prev.setStyleSheet("QPushButton { background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; } QPushButton:hover { background: #444; }")
        self.btn_prev.clicked.connect(self.previous_requested.emit)
        layout.addWidget(self.btn_prev)

        self.btn_next = QPushButton("▼")
        self.btn_next.setFixedSize(24, 24)
        self.btn_next.setToolTip("Next match")
        self.btn_next.setStyleSheet("QPushButton { background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; } QPushButton:hover { background: #444; }")
        self.btn_next.clicked.connect(self.next_requested.emit)
        layout.addWidget(self.btn_next)

        self.match_label = QLabel("")
        self.match_label.setStyleSheet("color: #888; font-size: 11px;")
        layout.addWidget(self.match_label)

        layout.addStretch()

        self.btn_close = QPushButton("✕")
        self.btn_close.setFixedSize(22, 22)
        self.btn_close.setToolTip("Close search")
        self.btn_close.setStyleSheet("QPushButton { background: transparent; border: none; color: #888; } QPushButton:hover { color: #fff; }")
        self.btn_close.clicked.connect(self.closed.emit)
        layout.addWidget(self.btn_close)

        self.setStyleSheet("background: #2d2d2d; border-bottom: 1px solid #444;")

    def set_match_count(self, current: int, total: int):
        if total > 0:
            self.match_label.setText(f"{current + 1} of {total}")
        else:
            self.match_label.setText("No matches")

    def focus_search(self):
        self.search_input.setFocus()
        self.search_input.selectAll()


class NotebookEditor(QWidget):
    content_changed = Signal(str)
    save_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._file_path = ""
        self._is_dirty = False
        self.cells = []
        self._clipboard_cell = None
        self._search_results = []
        self._search_current = -1

        self.kernel = KernelClient()
        self.kernel.start()

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        self._build_toolbar(main_layout)

        self.search_bar = SearchBar()
        self.search_bar.setVisible(False)
        self.search_bar.text_changed.connect(self._on_search_text)
        self.search_bar.next_requested.connect(self._search_next)
        self.search_bar.previous_requested.connect(self._search_prev)
        self.search_bar.closed.connect(lambda: self.search_bar.setVisible(False))
        main_layout.addWidget(self.search_bar)

        splitter = QSplitter(Qt.Horizontal)

        cells_container = QWidget()
        cells_layout = QVBoxLayout(cells_container)
        cells_layout.setContentsMargins(0, 0, 0, 0)
        cells_layout.setSpacing(0)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.scroll.setStyleSheet("QScrollArea { background: #1e1e1e; border: none; }")
        self.cells_container = QWidget()
        self.cells_layout = QVBoxLayout(self.cells_container)
        self.cells_layout.setContentsMargins(8, 8, 8, 8)
        self.cells_layout.setSpacing(6)
        self.cells_layout.setAlignment(Qt.AlignTop)

        self.scroll.setWidget(self.cells_container)
        cells_layout.addWidget(self.scroll)

        splitter.addWidget(cells_container)

        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(0)

        self.right_tabs = QTabWidget()
        self.right_tabs.setTabPosition(QTabWidget.South)
        self.right_tabs.setStyleSheet("""
            QTabWidget::pane { background: #1e1e1e; border: none; }
            QTabBar::tab { background: #2d2d2d; color: #888; padding: 4px 10px; border: none; font-size: 11px; }
            QTabBar::tab:selected { background: #1e1e1e; color: #fff; border-bottom: 2px solid #0e639c; }
        """)

        self.variable_explorer = VariableExplorer()
        self.right_tabs.addTab(self.variable_explorer, "Variables")

        self.outline_panel = OutlinePanel()
        self.outline_panel.outline_activated.connect(self._on_outline_activated)
        self.right_tabs.addTab(self.outline_panel, "Outline")

        right_layout.addWidget(self.right_tabs)
        self.right_tabs.setVisible(False)

        splitter.addWidget(right_panel)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 1)

        main_layout.addWidget(splitter)

        self._setup_shortcuts()

    def _build_toolbar(self, main_layout):
        tb = QWidget()
        tb.setFixedHeight(36)
        tb.setStyleSheet("background: #2d2d2d; border-bottom: 1px solid #444;")
        tb_layout = QHBoxLayout(tb)
        tb_layout.setContentsMargins(8, 0, 8, 0)
        tb_layout.setSpacing(4)

        btn_style = """QPushButton { background: transparent; color: #ccc; border: 1px solid #555;
                        border-radius: 3px; padding: 3px 8px; font-size: 11px; }
                       QPushButton:hover { background: #3a3a3a; color: #fff; }"""
        btn_run_style = """QPushButton { background: #0e639c; color: white; border: none; border-radius: 3px;
                            padding: 3px 12px; font-size: 11px; font-weight: bold; }
                           QPushButton:hover { background: #1177bb; }"""

        self.btn_add_code = QPushButton("+ Code")
        self.btn_add_code.setStyleSheet(btn_style)
        tb_layout.addWidget(self.btn_add_code)

        self.btn_add_md = QPushButton("+ Markdown")
        self.btn_add_md.setStyleSheet(btn_style)
        tb_layout.addWidget(self.btn_add_md)

        sep = QLabel("|")
        sep.setStyleSheet("color: #555; padding: 0 2px;")
        tb_layout.addWidget(sep)

        self.btn_run_all = QPushButton("▶▶ Run All")
        self.btn_run_all.setStyleSheet(btn_run_style)
        tb_layout.addWidget(self.btn_run_all)

        tb_layout.addStretch()

        self.btn_search = QPushButton("🔍 Search")
        self.btn_search.setStyleSheet(btn_style)
        self.btn_search.clicked.connect(self._toggle_search)
        tb_layout.addWidget(self.btn_search)

        self.btn_variables = QPushButton("Variables")
        self.btn_variables.setStyleSheet(btn_style)
        self.btn_variables.setCheckable(True)
        self.btn_variables.clicked.connect(self._toggle_variables)
        tb_layout.addWidget(self.btn_variables)

        self.btn_outline = QPushButton("Outline")
        self.btn_outline.setStyleSheet(btn_style)
        self.btn_outline.setCheckable(True)
        self.btn_outline.clicked.connect(self._toggle_outline)
        tb_layout.addWidget(self.btn_outline)

        sep2 = QLabel("|")
        sep2.setStyleSheet("color: #555; padding: 0 2px;")
        tb_layout.addWidget(sep2)

        self.btn_export = QPushButton("Export")
        self.btn_export.setStyleSheet(btn_style)
        self.btn_export.clicked.connect(self._export_script)
        tb_layout.addWidget(self.btn_export)

        self.btn_interrupt = QPushButton("⏹ Interrupt")
        self.btn_interrupt.setStyleSheet(btn_style)
        tb_layout.addWidget(self.btn_interrupt)

        self.btn_restart = QPushButton("↻ Restart")
        self.btn_restart.setStyleSheet(btn_style)
        tb_layout.addWidget(self.btn_restart)

        main_layout.addWidget(tb)

        self.btn_add_code.clicked.connect(lambda: self.add_cell("code"))
        self.btn_add_md.clicked.connect(lambda: self.add_cell("markdown"))
        self.btn_run_all.clicked.connect(self.run_all_cells)
        self.btn_interrupt.clicked.connect(self.kernel.interrupt)
        self.btn_restart.clicked.connect(self._restart_kernel)

    def _setup_shortcuts(self):
        QShortcut(QKeySequence("Ctrl+Shift+X"), self, self._cut_current_cell)
        QShortcut(QKeySequence("Ctrl+Shift+C"), self, self._copy_current_cell)
        QShortcut(QKeySequence("Ctrl+Shift+V"), self, self._paste_after_current)
        QShortcut(QKeySequence("Ctrl+Shift+Up"), self, self._move_current_up)
        QShortcut(QKeySequence("Ctrl+Shift+Down"), self, self._move_current_down)
        QShortcut(QKeySequence("Ctrl+Enter"), self, self._run_current_cell)
        QShortcut(QKeySequence("Shift+Enter"), self, self._run_and_advance)
        QShortcut(QKeySequence("Ctrl+/"), self, self._toggle_search)
        QShortcut(QKeySequence("Escape"), self, self._on_escape)

    def _on_escape(self):
        if self.search_bar.isVisible():
            self.search_bar.setVisible(False)
            self._clear_search_highlights()

    def _toggle_search(self):
        visible = not self.search_bar.isVisible()
        self.search_bar.setVisible(visible)
        if visible:
            self.search_bar.focus_search()

    def _toggle_variables(self):
        show = self.btn_variables.isChecked()
        self.right_tabs.setVisible(True if (show or self.btn_outline.isChecked()) else False)
        self.right_tabs.setCurrentWidget(self.variable_explorer)
        if show:
            self.refresh_variables()
        self.btn_outline.setChecked(False)

    def _toggle_outline(self):
        show = self.btn_outline.isChecked()
        self.right_tabs.setVisible(True if (show or self.btn_variables.isChecked()) else False)
        self.right_tabs.setCurrentWidget(self.outline_panel)
        if show:
            self.refresh_outline()
        self.btn_variables.setChecked(False)

    def _restart_kernel(self):
        self.kernel.restart()
        for cell in self.cells:
            cell.clear_outputs()

    def add_cell(self, cell_type: str, content: str = "") -> NotebookCell:
        cell = NotebookCell(cell_type, content)
        self._connect_cell_signals(cell)
        self.cells.append(cell)
        self.cells_layout.addWidget(cell)
        self._mark_dirty()
        self.refresh_outline()
        return cell

    def _connect_cell_signals(self, cell: NotebookCell):
        if cell.cell_type == "code":
            cell.run_requested.connect(self.run_cell)
        cell.move_up_requested.connect(self.move_cell_up)
        cell.move_down_requested.connect(self.move_cell_down)
        cell.copy_requested.connect(self.copy_cell)
        cell.cut_requested.connect(self.cut_cell)
        cell.paste_requested.connect(self.paste_after_cell)
        cell.delete_requested.connect(self.delete_cell)
        cell.split_requested.connect(self.split_cell)
        cell.merge_up_requested.connect(self.merge_cell_up)
        cell.content_changed.connect(lambda: self._mark_dirty())

    def _get_cell_index(self, cell: NotebookCell) -> int:
        for i, c in enumerate(self.cells):
            if c.cell_id == cell.cell_id:
                return i
        return -1

    def run_cell(self, cell: NotebookCell):
        code = cell.editor.toPlainText().strip()
        if not code:
            return
        cell.clear_outputs()
        cell.output_area.setVisible(True)
        cell.output_area.add_output("stream", {"text": f"In [{self.kernel._execution_count + 1}]:\n", "name": "stdout"})

        def handle_output(msg):
            msg_type = msg.get("msg_type")
            content = msg.get("content", {})
            cell.output_area.add_output(msg_type, content)
            if msg_type == "execute_reply":
                self.refresh_variables()

        self.kernel.execute_code(code, handle_output)

    def run_all_cells(self):
        for cell in self.cells:
            if cell.cell_type == "code":
                self.run_cell(cell)

    def move_cell_up(self, cell: NotebookCell):
        idx = self._get_cell_index(cell)
        if idx > 0:
            self.cells.insert(idx - 1, self.cells.pop(idx))
            self._rebuild_layout()
            self._mark_dirty()
            self.refresh_outline()

    def move_cell_down(self, cell: NotebookCell):
        idx = self._get_cell_index(cell)
        if idx < len(self.cells) - 1:
            self.cells.insert(idx + 1, self.cells.pop(idx))
            self._rebuild_layout()
            self._mark_dirty()
            self.refresh_outline()

    def copy_cell(self, cell: NotebookCell):
        self._clipboard_cell = {
            "cell_type": cell.cell_type,
            "source": cell.get_source(),
            "metadata": dict(cell.metadata)
        }

    def cut_cell(self, cell: NotebookCell):
        self.copy_cell(cell)
        self.delete_cell(cell)

    def paste_after_cell(self, cell: NotebookCell):
        if self._clipboard_cell is None:
            return
        idx = self._get_cell_index(cell)
        new_cell = self.add_cell(self._clipboard_cell["cell_type"], self._clipboard_cell["source"])
        new_cell.metadata = dict(self._clipboard_cell["metadata"])
        if idx >= 0:
            self.cells.remove(new_cell)
            self.cells.insert(idx + 1, new_cell)
            self._rebuild_layout()
        self._mark_dirty()
        self.refresh_outline()

    def delete_cell(self, cell: NotebookCell):
        idx = self._get_cell_index(cell)
        if idx >= 0:
            self.cells.pop(idx)
            self.cells_layout.removeWidget(cell)
            cell.deleteLater()
            self._mark_dirty()
            self.refresh_outline()

    def split_cell(self, cell: NotebookCell):
        text = cell.get_source()
        cursor = cell.editor.textCursor()
        pos = cursor.position()
        if 0 < pos < len(text):
            before = text[:pos]
            after = text[pos:]
            cell.set_source(before)
            new_cell = self.add_cell(cell.cell_type, after)
            idx = self._get_cell_index(cell)
            if idx >= 0:
                self.cells.remove(new_cell)
                self.cells.insert(idx + 1, new_cell)
                self._rebuild_layout()
            self._mark_dirty()

    def merge_cell_up(self, cell: NotebookCell):
        idx = self._get_cell_index(cell)
        if idx > 0:
            above = self.cells[idx - 1]
            if above.cell_type == cell.cell_type:
                above.set_source(above.get_source() + "\n" + cell.get_source())
                self.delete_cell(cell)
                above.editor.moveCursor(QTextCursor.End)
                above.editor.setFocus()
                self._mark_dirty()

    def _handle_cell_drop(self, dragged_id: str, target_id: str, insert_after: bool):
        dragged_idx = None
        target_idx = None
        for i, c in enumerate(self.cells):
            if c.cell_id == dragged_id:
                dragged_idx = i
            if c.cell_id == target_id:
                target_idx = i
        if dragged_idx is None or target_idx is None:
            return
        cell = self.cells.pop(dragged_idx)
        if dragged_idx < target_idx:
            target_idx -= 1
        new_pos = target_idx + (1 if insert_after else 0)
        self.cells.insert(new_pos, cell)
        self._rebuild_layout()
        self._mark_dirty()

    def _rebuild_layout(self):
        for cell in self.cells:
            self.cells_layout.removeWidget(cell)
        for cell in self.cells:
            self.cells_layout.addWidget(cell)
        self.refresh_outline()

    def refresh_variables(self):
        if self.right_tabs.isVisible() and self.right_tabs.currentWidget() == self.variable_explorer:
            variables = self.kernel.get_variables()
            self.variable_explorer.set_variables(variables)

    def refresh_outline(self):
        if self.right_tabs.isVisible() and self.right_tabs.currentWidget() == self.outline_panel:
            self.outline_panel.rebuild(self.cells)

    def _on_outline_activated(self, idx: int):
        if 0 <= idx < len(self.cells):
            cell = self.cells[idx]
            cell.focus_editor()
            self.scroll.ensureWidgetVisible(cell)

    def _on_search_text(self, text: str):
        self._clear_search_highlights()
        self._search_results = []
        self._search_current = -1
        if not text:
            self.search_bar.set_match_count(0, 0)
            return
        for i, cell in enumerate(self.cells):
            source = cell.get_source()
            if text.lower() in source.lower():
                self._search_results.append(i)
                self._highlight_cell(i, True)
        if self._search_results:
            self._search_current = 0
            self._scroll_to_cell(self._search_results[0])
            self._highlight_search_result(self._search_results[0], True)
        self.search_bar.set_match_count(self._search_current, len(self._search_results))

    def _search_next(self):
        if not self._search_results:
            return
        if self._search_current >= 0:
            self._highlight_search_result(self._search_results[self._search_current], False)
        self._search_current = (self._search_current + 1) % len(self._search_results)
        idx = self._search_results[self._search_current]
        self._scroll_to_cell(idx)
        self._highlight_search_result(idx, True)
        self.search_bar.set_match_count(self._search_current, len(self._search_results))

    def _search_prev(self):
        if not self._search_results:
            return
        if self._search_current >= 0:
            self._highlight_search_result(self._search_results[self._search_current], False)
        self._search_current = (self._search_current - 1) % len(self._search_results)
        idx = self._search_results[self._search_current]
        self._scroll_to_cell(idx)
        self._highlight_search_result(idx, True)
        self.search_bar.set_match_count(self._search_current, len(self._search_results))

    def _highlight_cell(self, idx: int, on: bool):
        if 0 <= idx < len(self.cells):
            cell = self.cells[idx]
            if on:
                cell.setStyleSheet("NotebookCell { border: 2px solid #cca700; border-radius: 4px; background: #1e1e1e; }")
            else:
                cell.setStyleSheet("NotebookCell { border: 1px solid #454545; border-radius: 4px; background: #1e1e1e; }")

    def _highlight_search_result(self, idx: int, active: bool):
        if 0 <= idx < len(self.cells):
            cell = self.cells[idx]
            color = "#0e639c" if active else "#cca700"
            cell.setStyleSheet(f"NotebookCell {{ border: 2px solid {color}; border-radius: 4px; background: #1e1e1e; }}")

    def _scroll_to_cell(self, idx: int):
        if 0 <= idx < len(self.cells):
            self.scroll.ensureWidgetVisible(self.cells[idx])

    def _clear_search_highlights(self):
        for cell in self.cells:
            cell.setStyleSheet("NotebookCell { border: 1px solid #454545; border-radius: 4px; background: #1e1e1e; }")

    def _run_current_cell(self):
        editor = self._get_focused_cell()
        if editor:
            self.run_cell(editor)

    def _run_and_advance(self):
        editor = self._get_focused_cell()
        if editor:
            self.run_cell(editor)
            idx = self._get_cell_index(editor)
            if idx is not None and idx + 1 < len(self.cells):
                self.cells[idx + 1].focus_editor()

    def _get_focused_cell(self):
        for cell in self.cells:
            if cell.editor.hasFocus():
                return cell
        return None

    def _copy_current_cell(self):
        cell = self._get_focused_cell()
        if cell:
            self.copy_cell(cell)

    def _cut_current_cell(self):
        cell = self._get_focused_cell()
        if cell:
            self.cut_cell(cell)

    def _paste_after_current(self):
        cell = self._get_focused_cell()
        if cell:
            self.paste_after_cell(cell)

    def _move_current_up(self):
        cell = self._get_focused_cell()
        if cell:
            self.move_cell_up(cell)

    def _move_current_down(self):
        cell = self._get_focused_cell()
        if cell:
            self.move_cell_down(cell)

    def _export_script(self):
        from PySide6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(self, "Export to Python Script", "", "Python Files (*.py);;All Files (*)")
        if not path:
            return
        lines = ["# ---\n# Generated from Jupyter Notebook\n# ---\n\n"]
        for i, cell in enumerate(self.cells):
            source = cell.get_source().strip()
            if not source:
                continue
            if cell.cell_type == "markdown":
                for sline in source.split('\n'):
                    if sline.strip():
                        lines.append(f"# {sline.strip()}\n")
                lines.append("\n")
            else:
                lines.append(f"# In[{i + 1}]:\n")
                lines.append(source)
                if not source.endswith('\n'):
                    lines.append('\n')
                lines.append('\n')
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        QMessageBox.information(self, "Export Complete", f"Notebook exported to:\n{path}")

    def load_ipynb(self, file_path: str):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            cells_data = data.get("cells", data.get("worksheets", [{}])[0].get("cells", []) if "worksheets" in data else [])
            for cell_data in cells_data:
                cell_type = cell_data.get("cell_type", "code")
                source = "".join(cell_data.get("source", []))
                metadata = cell_data.get("metadata", {})
                cell = self.add_cell(cell_type, source)
                cell.metadata = dict(metadata)
                outputs = cell_data.get("outputs", [])
                for out in outputs:
                    output_type = out.get("output_type", "")
                    if output_type == "stream":
                        cell.output_area.add_output("stream", out)
                    elif output_type == "display_data":
                        cell.output_area.add_output("display_data", out)
                    elif output_type == "execute_result":
                        cell.output_area.add_output("execute_result", out)
                    elif output_type == "error":
                        cell.output_area.add_output("error", out)
                if outputs:
                    cell.output_area.setVisible(True)
        except Exception as e:
            self.add_cell("markdown", f"# Error loading notebook\n{str(e)}")
        self._mark_dirty()

    def save_ipynb(self, file_path: str):
        cells_json = []
        for cell in self.cells:
            cells_json.append({
                "cell_type": cell.cell_type,
                "source": cell.get_source().splitlines(keepends=True),
                "metadata": cell.metadata,
                "outputs": []
            })
        nb = {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3"
                },
                "language_info": {
                    "name": "python",
                    "version": "3.x"
                }
            },
            "cells": cells_json
        }
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(nb, f, indent=1)

    def get_file_path(self):
        return self._file_path

    def is_dirty(self):
        return self._is_dirty

    def get_language(self):
        return "jupyter"

    def save(self):
        if self._file_path:
            self.save_ipynb(self._file_path)
        self._is_dirty = False

    def save_as(self, path):
        self._file_path = path
        self.save_ipynb(path)
        self._is_dirty = False

    def reveal_cell_line(self, cell_line: str):
        try:
            parts = cell_line.split(":")
            cell_idx = int(parts[0].replace("Cell ", "")) - 1
            if 0 <= cell_idx < len(self.cells):
                cell = self.cells[cell_idx]
                cell.editor.setFocus()
                self.scroll.ensureWidgetVisible(cell)
        except Exception:
            pass

    def _mark_dirty(self):
        if not self._is_dirty:
            self._is_dirty = True
            self.content_changed.emit("")


class InteractiveWindow(NotebookEditor):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._history = []
        self._history_index = -1
        self._input_history = []
        self.setWindowTitle("Interactive Window")

        for btn in [self.btn_add_code, self.btn_add_md, self.btn_run_all, self.btn_search,
                     self.btn_variables, self.btn_outline, self.btn_export]:
            btn.setVisible(False)

        self._current_cell = self.add_cell("code", "")
        self._current_cell.btn_run.clicked.disconnect()
        self._current_cell.btn_run.clicked.connect(lambda: self._execute_repl())
        self._current_cell.editor.installEventFilter(self)

    def _execute_repl(self):
        code = self._current_cell.get_source().strip()
        if not code:
            return
        self._input_history.append(code)
        self._history_index = len(self._input_history)
        self.run_cell(self._current_cell)
        new_cell = self.add_cell("code", "")
        new_cell.btn_run.clicked.connect(lambda: self._execute_repl())
        new_cell.editor.installEventFilter(self)
        self._current_cell = new_cell
        new_cell.focus_editor()
        self.scroll.verticalScrollBar().setValue(self.scroll.verticalScrollBar().maximum())

    def eventFilter(self, obj, event):
        from PySide6.QtCore import QEvent
        if obj is self._current_cell.editor and event.type() == QEvent.KeyPress:
            if event.key() == Qt.Key_Up and self._input_history:
                if self._history_index > 0:
                    self._history_index -= 1
                    self._current_cell.set_source(self._input_history[self._history_index])
                    cursor = self._current_cell.editor.textCursor()
                    cursor.movePosition(QTextCursor.End)
                    self._current_cell.editor.setTextCursor(cursor)
                return True
            elif event.key() == Qt.Key_Down and self._input_history:
                if self._history_index < len(self._input_history) - 1:
                    self._history_index += 1
                    self._current_cell.set_source(self._input_history[self._history_index])
                else:
                    self._history_index = len(self._input_history)
                    self._current_cell.set_source("")
                cursor = self._current_cell.editor.textCursor()
                cursor.movePosition(QTextCursor.End)
                self._current_cell.editor.setTextCursor(cursor)
                return True
            elif event.key() == Qt.Key_Return and event.modifiers() & Qt.ShiftModifier:
                cursor = self._current_cell.editor.textCursor()
                cursor.insertText("\n")
                return True
            elif event.key() == Qt.Key_Return and not (event.modifiers() & Qt.ShiftModifier):
                self._execute_repl()
                return True
        return super().eventFilter(obj, event)
