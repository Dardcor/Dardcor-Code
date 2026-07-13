"""Search Panel - VS Code style search across files."""

import os
import re
import json
import threading
import subprocess
import shutil
from pathlib import Path
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLineEdit, QPushButton,
    QLabel, QTreeWidget, QTreeWidgetItem, QMessageBox, QCheckBox,
    QStyledItemDelegate, QStyleOptionViewItem, QStyle, QComboBox,
    QToolTip, QMenu, QApplication,
)
from PySide6.QtCore import (
    Signal, Qt, QObject, QEvent, QTimer, QUrl,
)
from PySide6.QtGui import (
    QColor, QPainter, QDesktopServices, QKeySequence, QShortcut,
)

from ..core.filesystem import FileSystem
from ..file_explorer.panel import get_file_icon

# ---------------------------------------------------------------------------
# Search history storage
# ---------------------------------------------------------------------------
_SEARCH_HISTORY: list[str] = []
_SEARCH_HISTORY_MAX = 50


def _load_history():
    global _SEARCH_HISTORY
    try:
        history_path = Path(__file__).parent / ".search_history.json"
        if history_path.exists():
            data = json.loads(history_path.read_text(encoding="utf-8"))
            _SEARCH_HISTORY = data[: _SEARCH_HISTORY_MAX]
    except Exception:
        pass


def _save_history():
    try:
        history_path = Path(__file__).parent / ".search_history.json"
        history_path.write_text(
            json.dumps(_SEARCH_HISTORY, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


def _push_history(query: str):
    global _SEARCH_HISTORY
    query = query.strip()
    if not query:
        return
    if query in _SEARCH_HISTORY:
        _SEARCH_HISTORY.remove(query)
    _SEARCH_HISTORY.insert(0, query)
    if len(_SEARCH_HISTORY) > _SEARCH_HISTORY_MAX:
        _SEARCH_HISTORY = _SEARCH_HISTORY[: _SEARCH_HISTORY_MAX]
    _save_history()


_load_history()


# ---------------------------------------------------------------------------
# Ripgrep detection
# ---------------------------------------------------------------------------
def _find_rg() -> str | None:
    rg = shutil.which("rg")
    if rg:
        return rg
    for candidate in [
        r"C:\Program Files\rg\rg.exe",
        r"C:\Program Files (x86)\rg\rg.exe",
        r"C:\tools\rg\rg.exe",
        "/usr/bin/rg",
        "/usr/local/bin/rg",
        "/opt/homebrew/bin/rg",
    ]:
        if os.path.isfile(candidate):
            return candidate
    return None


_RG_PATH: str | None = _find_rg()


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
GLOBAL_EXCLUDE_PATTERNS = [
    ".git/",
    ".svn/",
    ".hg/",
    "__pycache__/",
    "node_modules/",
    ".venv/",
    "venv/",
    ".env/",
    "env/",
    ".tox/",
    ".mypy_cache/",
    ".pytest_cache/",
    ".ruff_cache/",
    "dist/",
    "build/",
    ".eggs/",
    ".next/",
    ".nuxt/",
    "target/",
    "bin/",
    "obj/",
    ".idea/",
    ".vs/",
    "*.pyc",
    "*.pyo",
    "*.exe",
    "*.dll",
    "*.so",
    "*.dylib",
    "*.class",
    "*.jpg",
    "*.jpeg",
    "*.png",
    "*.gif",
    "*.bmp",
    "*.ico",
    "*.webp",
    "*.mp3",
    "*.mp4",
    "*.wav",
    "*.avi",
    "*.mov",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.bz2",
    "*.pdf",
    "*.doc",
    "*.docx",
    "*.xls",
    "*.xlsx",
    "*.ttf",
    "*.otf",
    "*.woff",
    "*.woff2",
    "*.db",
    "*.sqlite",
]

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


# ---------------------------------------------------------------------------
# Focus filter
# ---------------------------------------------------------------------------
class FocusFilter(QObject):
    def __init__(self, container, line_edit):
        super().__init__(line_edit)
        self.container = container
        self.line_edit = line_edit
        self._focused = False

    def eventFilter(self, obj, event):
        if obj == self.line_edit:
            if event.type() == QEvent.FocusIn and not self._focused:
                self._focused = True
                self.container.update_style(True)
            elif event.type() == QEvent.FocusOut and self._focused:
                self._focused = False
                self.container.update_style(False)
        return super().eventFilter(obj, event)


# ---------------------------------------------------------------------------
# Highlight delegate
# ---------------------------------------------------------------------------
class SearchHighlightDelegate(QStyledItemDelegate):
    HIGHLIGHT_COLOR = QColor(234, 92, 0, 102)

    def __init__(self, pattern_getter, parent=None):
        super().__init__(parent)
        self._get_pattern = pattern_getter

    def paint(self, painter, option, index):
        text = index.data(Qt.DisplayRole) or ""
        line_num = index.data(Qt.UserRole + 1)
        pattern = self._get_pattern() if line_num else None

        opt = QStyleOptionViewItem(option)
        self.initStyleOption(opt, index)

        painter.save()

        if opt.state & QStyle.State_Selected:
            painter.fillRect(opt.rect, opt.palette.highlight())
            fg = opt.palette.highlightedText().color()
        else:
            fg = index.data(Qt.ForegroundRole) or QColor("#bbbbbb")
            if opt.state & QStyle.State_MouseOver:
                painter.fillRect(opt.rect, QColor("#2a2d2e"))

        if not pattern or not text:
            painter.setPen(fg)
            painter.drawText(opt.rect.adjusted(4, 0, -4, 0), Qt.AlignVCenter, text)
            painter.restore()
            return

        marker = ":  "
        split_at = text.find(marker)
        if split_at < 0:
            painter.setPen(fg)
            painter.drawText(opt.rect.adjusted(4, 0, -4, 0), Qt.AlignVCenter, text)
            painter.restore()
            return

        prefix = text[: split_at + len(marker)]
        body = text[split_at + len(marker) :]

        fm = opt.fontMetrics
        x = opt.rect.x() + 4
        y = opt.rect.y() + (opt.rect.height() + fm.ascent() - fm.descent()) // 2

        painter.setPen(fg)
        painter.drawText(x, y, prefix)
        x += fm.horizontalAdvance(prefix)

        pos = 0
        for match in pattern.finditer(body):
            if match.start() > pos:
                plain = body[pos : match.start()]
                painter.setPen(fg)
                painter.drawText(x, y, plain)
                x += fm.horizontalAdvance(plain)

            matched = body[match.start() : match.end()]
            w = fm.horizontalAdvance(matched)
            h = fm.height()
            painter.fillRect(
                x,
                opt.rect.y() + (opt.rect.height() - h) // 2,
                w,
                h,
                self.HIGHLIGHT_COLOR,
            )
            painter.setPen(QColor("#ffffff"))
            painter.drawText(x, y, matched)
            x += w
            pos = match.end()

        if pos < len(body):
            painter.setPen(fg)
            painter.drawText(x, y, body[pos:])

        painter.restore()


# ---------------------------------------------------------------------------
# VSCode-style input box
# ---------------------------------------------------------------------------
class VSCodeInputBox(QWidget):
    def __init__(self, placeholder, colors, parent=None):
        super().__init__(parent)
        self.colors = colors
        self.setFixedHeight(28)
        self.layout = QHBoxLayout(self)
        self.layout.setContentsMargins(6, 1, 4, 1)
        self.layout.setSpacing(2)

        self.line_edit = QLineEdit(self)
        self.line_edit.setPlaceholderText(placeholder)
        self.line_edit.setStyleSheet(
            f"background: transparent; border: none; color: {colors['foreground']}; font-size: 13px; padding: 0px;"
        )
        self.layout.addWidget(self.line_edit)

        self.update_style(False)

        self._filter = FocusFilter(self, self.line_edit)
        self.line_edit.installEventFilter(self._filter)

    def paintEvent(self, event):
        opt = QStyleOptionViewItem()
        opt.initFrom(self)
        p = QPainter(self)
        self.style().drawPrimitive(QStyle.PE_Widget, opt, p, self)
        p.end()

    def update_style(self, focused):
        bg = self.colors["selection"]
        border = self.colors["accent"] if focused else self.colors["border"]
        self.setStyleSheet(
            f"""
            VSCodeInputBox {{
                background-color: {bg};
                border: 1px solid {border};
                border-radius: 2px;
            }}
        """
        )

    def add_button(self, btn):
        self.layout.addWidget(btn)

    def text(self):
        return self.line_edit.text()

    def setText(self, text):
        self.line_edit.setText(text)

    def lineEdit(self):
        return self.line_edit


# ---------------------------------------------------------------------------
# Search tree widget
# ---------------------------------------------------------------------------
class SearchTreeWidget(QTreeWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setSelectionMode(QTreeWidget.ExtendedSelection)
        self._navigated_items: list[QTreeWidgetItem] = []
        self._nav_index = -1

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Delete:
            panel = self.parent()
            while panel and not hasattr(panel, "dismiss_selected_results"):
                panel = panel.parent()
            if panel and hasattr(panel, "dismiss_selected_results"):
                panel.dismiss_selected_results()
                event.accept()
                return
        super().keyPressEvent(event)

    def mouseMoveEvent(self, event):
        item = self.itemAt(event.position().toPoint())
        if item and item.data(0, Qt.UserRole):
            path = item.data(0, Qt.UserRole)
            if os.path.isfile(path):
                line = item.data(0, Qt.UserRole + 1) or 1
                tooltip = _make_preview_tooltip(path, int(line))
                QToolTip.showText(event.globalPosition().toPoint(), tooltip, self)
            else:
                QToolTip.hideText()
        else:
            QToolTip.hideText()
        super().mouseMoveEvent(event)

    def leaveEvent(self, event):
        QToolTip.hideText()
        super().leaveEvent(event)


def _make_preview_tooltip(filepath: str, line: int, num_context: int = 3) -> str:
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except Exception:
        return f"<b>{os.path.basename(filepath)}</b><br><i>Cannot read file</i>"

    start = max(0, line - 1 - num_context)
    end = min(len(lines), line + num_context)
    parts = [f"<b style='color:#569cd6;'>{os.path.basename(filepath)}</b>&nbsp;&nbsp;line {line}"]
    parts.append(f"<span style='color:#606060;'>{'=' * 40}</span>")
    for i in range(start, end):
        lineno = i + 1
        text = lines[i].rstrip("\n\r").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if lineno == line:
            parts.append(f"<span style='background-color:#264f78;color:#ffffff;padding:0 2px;'>{lineno:>4}: {text}</span>")
        else:
            parts.append(f"<span style='color:#969696;'>{lineno:>4}: {text}</span>")
    return "<br>".join(parts)


# ---------------------------------------------------------------------------
# SearchPanel
# ---------------------------------------------------------------------------
class SearchPanel(QWidget):
    """VS Code style search panel for searching across files."""

    file_selected = Signal(str, int)
    search_finished = Signal(str, list)

    def __init__(self, root_path: str = None, parent=None):
        super().__init__(parent)
        self._fs = FileSystem()
        self._root_path = root_path or os.path.expanduser("~")
        self._total_matches = 0
        self._total_files = 0
        self._last_results: list = []
        self._highlight_pattern = None
        self.setObjectName("searchPanel")

        # Debounce timer
        self._search_timer = QTimer(self)
        self._search_timer.setSingleShot(True)
        self._search_timer.timeout.connect(self._search)

        self.search_finished.connect(self._display_results)

        # History index for up/down navigation in query field
        self._history_index = -1

        self._setup_ui()
        self._setup_shortcuts()

        from ..app.theme_manager import ThemeManager

        ThemeManager.patch_widget(self)

    # ======================================================================
    # UI Setup
    # ======================================================================
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._build_header(layout)
        self._build_search_area(layout)
        self._build_results(layout)

    def _build_header(self, layout):
        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet(
            "background-color: #000000; border-bottom: 1px solid #000000;"
        )
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(20, 0, 8, 0)

        title = QLabel("SEARCH")
        title.setStyleSheet(
            "color: #bbbbbb; font-size: 11px; font-weight: 600; letter-spacing: 1.2px;"
        )
        header_layout.addWidget(title)
        header_layout.addStretch()

        self._context_lines_btn = QPushButton(" {} ")
        self._context_lines_btn.setCheckable(True)
        self._context_lines_btn.setFixedSize(24, 22)
        self._context_lines_btn.setToolTip("Show Context Lines")
        self._context_lines_btn.setStyleSheet(
            """
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 12px; border-radius: 3px; font-weight: bold;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
            QPushButton:checked { background-color: #7c3aed; color: #ffffff; }
        """
        )
        self._context_lines_btn.clicked.connect(self._toggle_context_lines)
        header_layout.addWidget(self._context_lines_btn)

        # Context line count combo
        self._context_count_combo = QComboBox()
        self._context_count_combo.addItems(["1", "2", "3", "5", "10"])
        self._context_count_combo.setCurrentIndex(0)
        self._context_count_combo.setFixedWidth(36)
        self._context_count_combo.setToolTip("Context Lines Count")
        self._context_count_combo.setStyleSheet(
            """
            QComboBox {
                background: transparent; border: none; color: #bbbbbb;
                font-size: 10px; padding: 0 2px;
            }
            QComboBox::drop-down { border: none; width: 0; }
            QComboBox:hover { background-color: rgba(90,93,94,0.31); }
        """
        )
        self._context_count_combo.currentTextChanged.connect(self._toggle_context_lines)
        header_layout.addWidget(self._context_count_combo)

        refresh_btn = QPushButton("\u21BB")
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setToolTip("Refresh")
        refresh_btn.setStyleSheet(
            """
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 14px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """
        )
        refresh_btn.clicked.connect(self._search)
        header_layout.addWidget(refresh_btn)

        collapse_btn = QPushButton("\u2212")
        collapse_btn.setFixedSize(22, 22)
        collapse_btn.setToolTip("Collapse All")
        collapse_btn.setStyleSheet(
            """
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 14px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """
        )
        collapse_btn.clicked.connect(lambda: self._results.collapseAll())
        header_layout.addWidget(collapse_btn)

        self._open_in_editor_btn = QPushButton("\u2197")
        self._open_in_editor_btn.setFixedSize(22, 22)
        self._open_in_editor_btn.setToolTip("Open in Editor")
        self._open_in_editor_btn.setStyleSheet(
            """
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 14px; border-radius: 3px; font-weight: bold;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """
        )
        self._open_in_editor_btn.clicked.connect(self._open_results_in_editor)
        header_layout.addWidget(self._open_in_editor_btn)

        layout.addWidget(header)

    def _build_search_area(self, layout):
        from ..app.theme_manager import ThemeManager

        colors = ThemeManager.get_canonical_colors()

        search_area = QWidget()
        search_area.setStyleSheet("background-color: #000000;")
        search_layout = QVBoxLayout(search_area)
        search_layout.setContentsMargins(12, 8, 12, 8)
        search_layout.setSpacing(6)

        # ===================== Search row =====================
        search_row_widget = QWidget()
        search_row = QHBoxLayout(search_row_widget)
        search_row.setContentsMargins(0, 0, 0, 0)
        search_row.setSpacing(4)

        self._replace_toggle_btn = QPushButton("\u25bc")
        self._replace_toggle_btn.setFixedSize(18, 28)
        self._replace_toggle_btn.setToolTip("Toggle Replace")
        self._replace_toggle_btn.setStyleSheet(
            """
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 10px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """
        )
        self._replace_toggle_btn.clicked.connect(self._toggle_replace)
        search_row.addWidget(self._replace_toggle_btn)

        self._query_input_box = VSCodeInputBox("Search", colors)
        self._query_input = self._query_input_box.lineEdit()
        self._query_input.textChanged.connect(self._on_query_changed)
        self._query_input.installEventFilter(self)
        search_row.addWidget(self._query_input_box)

        # Toggle buttons inside search box
        self._case_btn = QPushButton("Aa")
        self._case_btn.setCheckable(True)
        self._case_btn.setFixedSize(22, 20)
        self._case_btn.setToolTip("Match Case")
        self._case_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._case_btn.toggled.connect(self._on_query_changed)
        self._query_input_box.add_button(self._case_btn)

        self._word_btn = QPushButton("ab")
        self._word_btn.setCheckable(True)
        self._word_btn.setFixedSize(22, 20)
        self._word_btn.setToolTip("Match Whole Word")
        self._word_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._word_btn.toggled.connect(self._on_query_changed)
        self._query_input_box.add_button(self._word_btn)

        self._regex_btn = QPushButton(".*")
        self._regex_btn.setCheckable(True)
        self._regex_btn.setFixedSize(22, 20)
        self._regex_btn.setToolTip("Use Regular Expression")
        self._regex_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._regex_btn.toggled.connect(self._on_query_changed)
        self._query_input_box.add_button(self._regex_btn)

        # Follow symlinks toggle
        self._symlink_btn = QPushButton("\u2194")
        self._symlink_btn.setCheckable(True)
        self._symlink_btn.setChecked(True)
        self._symlink_btn.setFixedSize(22, 20)
        self._symlink_btn.setToolTip("Follow Symlinks")
        self._symlink_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._symlink_btn.toggled.connect(self._on_query_changed)
        self._query_input_box.add_button(self._symlink_btn)

        # Use ripgrep toggle
        self._rg_btn = QPushButton("RG")
        self._rg_btn.setCheckable(True)
        self._rg_btn.setChecked(_RG_PATH is not None)
        self._rg_btn.setEnabled(_RG_PATH is not None)
        self._rg_btn.setFixedSize(22, 20)
        self._rg_btn.setToolTip(
            f"Use ripgrep{' (not found)' if _RG_PATH is None else ''}"
        )
        self._rg_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._rg_btn.toggled.connect(self._on_query_changed)
        self._query_input_box.add_button(self._rg_btn)

        # AI Semantic Search
        self._ai_search_btn = QPushButton("AI")
        self._ai_search_btn.setCheckable(True)
        self._ai_search_btn.setFixedSize(22, 20)
        self._ai_search_btn.setToolTip("AI Semantic Search")
        self._ai_search_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._ai_search_btn.toggled.connect(self._on_query_changed)
        self._query_input_box.add_button(self._ai_search_btn)

        self._details_btn = QPushButton("...")
        self._details_btn.setCheckable(True)
        self._details_btn.setChecked(True)
        self._details_btn.setFixedSize(20, 28)
        self._details_btn.setToolTip("Toggle Search Details")
        self._details_btn.setStyleSheet(
            """
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 14px; font-weight: bold; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
            QPushButton:checked { background-color: %s; color: #ffffff; }
        """
            % colors["accent"]
        )
        self._details_btn.clicked.connect(self._toggle_details)
        search_row.addWidget(self._details_btn)

        search_layout.addWidget(search_row_widget)

        # ===================== Replace row =====================
        self._replace_widget = QWidget()
        replace_row = QHBoxLayout(self._replace_widget)
        replace_row.setContentsMargins(0, 0, 0, 0)
        replace_row.setSpacing(4)

        replace_left_spacer = QWidget()
        replace_left_spacer.setFixedWidth(18)
        replace_row.addWidget(replace_left_spacer)

        self._replace_input_box = VSCodeInputBox("Replace", colors)
        self._replace_input = self._replace_input_box.lineEdit()
        self._replace_input.textChanged.connect(self._on_replace_changed)
        self._replace_input.returnPressed.connect(self._replace_next)
        replace_row.addWidget(self._replace_input_box)

        # Replace single (next) button
        replace_next_btn = QPushButton("\u21b5")
        replace_next_btn.setFixedSize(22, 20)
        replace_next_btn.setToolTip("Replace (Next)")
        replace_next_btn.setStyleSheet(self._toggle_btn_style(colors))
        replace_next_btn.clicked.connect(self._replace_next)
        self._replace_input_box.add_button(replace_next_btn)

        # Replace all button
        replace_all_btn = QPushButton("\u21b7")
        replace_all_btn.setFixedSize(22, 20)
        replace_all_btn.setToolTip("Replace All")
        replace_all_btn.setStyleSheet(self._toggle_btn_style(colors))
        replace_all_btn.clicked.connect(self._replace_all)
        self._replace_input_box.add_button(replace_all_btn)

        replace_right_spacer = QWidget()
        replace_right_spacer.setFixedWidth(20)
        replace_row.addWidget(replace_right_spacer)

        search_layout.addWidget(self._replace_widget)

        # ===================== Details widget =====================
        self._details_widget = QWidget()
        details_layout = QVBoxLayout(self._details_widget)
        details_layout.setContentsMargins(0, 0, 0, 0)
        details_layout.setSpacing(6)

        # Files to include
        include_row = QHBoxLayout()
        include_row.setContentsMargins(0, 0, 0, 0)
        include_row.setSpacing(4)
        include_left_spacer = QWidget()
        include_left_spacer.setFixedWidth(18)
        include_row.addWidget(include_left_spacer)
        self._include_input_box = VSCodeInputBox("files to include (e.g. *.py, src/)", colors)
        self._include_input = self._include_input_box.lineEdit()
        self._include_input.textChanged.connect(self._on_query_changed)
        include_row.addWidget(self._include_input_box)
        include_right_spacer = QWidget()
        include_right_spacer.setFixedWidth(20)
        include_row.addWidget(include_right_spacer)
        details_layout.addLayout(include_row)

        # Files to exclude
        exclude_row = QHBoxLayout()
        exclude_row.setContentsMargins(0, 0, 0, 0)
        exclude_row.setSpacing(4)
        exclude_left_spacer = QWidget()
        exclude_left_spacer.setFixedWidth(18)
        exclude_row.addWidget(exclude_left_spacer)
        self._exclude_input_box = VSCodeInputBox("files to exclude", colors)
        self._exclude_input = self._exclude_input_box.lineEdit()
        self._exclude_input.textChanged.connect(self._on_query_changed)
        exclude_row.addWidget(self._exclude_input_box)
        exclude_right_spacer = QWidget()
        exclude_right_spacer.setFixedWidth(20)
        exclude_row.addWidget(exclude_right_spacer)
        details_layout.addLayout(exclude_row)

        # Global exclude label (read-only display)
        global_exclude_row = QHBoxLayout()
        global_exclude_row.setContentsMargins(0, 0, 0, 0)
        global_exclude_row.setSpacing(4)
        global_left_spacer = QWidget()
        global_left_spacer.setFixedWidth(18)
        global_exclude_row.addWidget(global_left_spacer)
        global_exclude_label = QLabel("Global exclude patterns active")
        global_exclude_label.setStyleSheet("color: #666666; font-size: 9px; padding: 0 4px;")
        global_exclude_row.addWidget(global_exclude_label)
        details_layout.addLayout(global_exclude_row)

        search_layout.addWidget(self._details_widget)

        layout.addWidget(search_area)

        # ===================== Count label =====================
        self._count_label = QLabel("")
        self._count_label.setStyleSheet(
            "color: #888888; font-size: 11px; padding: 4px 12px; background-color: #000000;"
        )
        self._count_label.hide()
        layout.addWidget(self._count_label)

    def _build_results(self, layout):
        self._results = SearchTreeWidget(self)
        self._results.setHeaderHidden(True)
        self._results.setIndentation(16)
        self._results.setAnimated(False)
        self._results.setStyleSheet(
            """
            QTreeWidget {
                background-color: #000000;
                border: none;
                color: #cccccc;
                font-family: "Segoe UI", sans-serif;
                font-size: 13px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 1px 4px;
                min-height: 22px;
            }
            QTreeWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QTreeWidget::item:hover:!selected {
                background-color: #2a2d2e;
            }
        """
        )
        self._results.setMouseTracking(True)
        self._results.itemClicked.connect(self._on_result_clicked)
        self._results.itemDoubleClicked.connect(self._on_result_double_clicked)
        self._results.setItemDelegate(
            SearchHighlightDelegate(lambda: self._highlight_pattern, self._results)
        )
        layout.addWidget(self._results)

    def _setup_shortcuts(self):
        # F4 / Shift+F4 navigation
        self._next_shortcut = QShortcut(QKeySequence(Qt.Key_F4), self)
        self._next_shortcut.activated.connect(self._navigate_next)
        self._prev_shortcut = QShortcut(QKeySequence(Qt.SHIFT | Qt.Key_F4), self)
        self._prev_shortcut.activated.connect(self._navigate_previous)

    # ======================================================================
    # Helpers
    # ======================================================================
    def _toggle_btn_style(self, colors):
        return """
            QPushButton {
                background: transparent;
                border: 1px solid transparent;
                border-radius: 2px;
                color: #cccccc;
                padding: 0px;
                font-size: 10px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }
            QPushButton:checked {
                background-color: %s;
                border: 1px solid %s;
            }
        """ % (colors["accent"], colors["accent"])

    def _toggle_replace(self):
        visible = not self._replace_widget.isVisible()
        self._replace_widget.setVisible(visible)
        self._replace_toggle_btn.setText("\u25bc" if visible else "\u25b6")

    def _toggle_details(self):
        self._details_widget.setVisible(self._details_btn.isChecked())

    def _on_query_changed(self):
        query = self._query_input.text().strip()
        if not query:
            self._results.clear()
            self._count_label.hide()
            self._search_timer.stop()
            return
        self._search_timer.start(300)

    def _on_replace_changed(self):
        query = self._query_input.text().strip()
        if query and self._last_results:
            self._display_results(query, self._last_results)

    # ======================================================================
    # Event filter for history navigation
    # ======================================================================
    def eventFilter(self, obj, event):
        if obj is self._query_input and event.type() == QEvent.KeyPress:
            key = event.key()
            if key == Qt.Key_Up:
                self._history_navigate(-1)
                return True
            elif key == Qt.Key_Down:
                self._history_navigate(1)
                return True
        return super().eventFilter(obj, event)

    def _history_navigate(self, direction: int):
        if not _SEARCH_HISTORY:
            return
        if self._history_index == -1 and direction == -1:
            self._history_index = 0
        else:
            self._history_index += direction
        self._history_index = max(0, min(self._history_index, len(_SEARCH_HISTORY) - 1))
        query = _SEARCH_HISTORY[self._history_index]
        self._query_input.setText(query)
        self._query_input.selectAll()

    # ======================================================================
    # Search execution
    # ======================================================================
    def _search(self):
        query = self._query_input.text().strip()
        if not query:
            return
        if not self._root_path or not os.path.isdir(self._root_path):
            self._results.clear()
            self._count_label.setText("Open a folder to search")
            self._count_label.show()
            return

        _push_history(query)
        self._history_index = -1

        self._results.clear()
        self._count_label.setText("Searching...")
        self._count_label.show()

        file_pattern = self._include_input.text().strip() or None
        exclude_pattern = self._exclude_input.text().strip() or None
        use_rg = self._rg_btn.isChecked() and _RG_PATH is not None

        def do_search():
            if use_rg:
                results = self._rg_search(
                    query, self._root_path,
                    case_sensitive=self._case_btn.isChecked(),
                    is_regex=self._regex_btn.isChecked(),
                    whole_word=self._word_btn.isChecked(),
                    file_pattern=file_pattern,
                    exclude_pattern=exclude_pattern,
                    follow_symlinks=self._symlink_btn.isChecked(),
                )
            else:
                results = self._fs.grep(
                    query, self._root_path,
                    case_sensitive=self._case_btn.isChecked(),
                    is_regex=self._regex_btn.isChecked(),
                    whole_word=self._word_btn.isChecked(),
                    file_pattern=file_pattern,
                    exclude_pattern=exclude_pattern,
                    ai_search=self._ai_search_btn.isChecked(),
                )
            self._last_results = results
            self.search_finished.emit(query, results)

        threading.Thread(target=do_search, daemon=True).start()

    # ======================================================================
    # Ripgrep search
    # ======================================================================
    def _rg_search(
        self,
        query: str,
        root: str,
        case_sensitive: bool = False,
        is_regex: bool = False,
        whole_word: bool = False,
        file_pattern: str = None,
        exclude_pattern: str = None,
        follow_symlinks: bool = True,
        max_results: int = 500,
    ) -> list:
        if not _RG_PATH:
            return self._fs.grep(query, root, case_sensitive, is_regex, whole_word, max_results, file_pattern, exclude_pattern)

        cmd = [_RG_PATH, "--json", "--no-heading", "--line-number", "--color", "never"]
        if not case_sensitive:
            cmd.append("-i")
        if is_regex:
            cmd.append("--regex")
        else:
            cmd.append("--fixed-strings")
        if whole_word:
            cmd.append("--word-regexp")
        if follow_symlinks:
            cmd.append("-L")
        else:
            cmd.append("--no-follow")
        cmd.extend(["-g", "!.git/"])
        for gpat in GLOBAL_EXCLUDE_PATTERNS:
            cmd.extend(["-g", f"!{gpat}"])
        if file_pattern:
            for pat in re.split(r"[,;]", file_pattern):
                pat = pat.strip()
                if pat:
                    cmd.extend(["-g", pat])
        if exclude_pattern:
            for pat in re.split(r"[,;]", exclude_pattern):
                pat = pat.strip()
                if pat:
                    cmd.extend(["-g", f"!{pat}"])
        cmd.append("--")
        cmd.append(query)
        cmd.append(root)

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return self._fs.grep(query, root, case_sensitive, is_regex, whole_word, max_results, file_pattern, exclude_pattern)

        results = []
        for raw_line in proc.stdout.splitlines():
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                entry = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") != "match":
                continue
            data = entry.get("data", {})
            fpath = data.get("path", {}).get("text", "")
            if not fpath:
                continue
            abs_path = os.path.join(root, fpath) if not os.path.isabs(fpath) else fpath
            abs_path = os.path.normpath(abs_path)
            if not os.path.isfile(abs_path):
                continue
            line_num = data.get("line_number", 1)
            content = data.get("lines", {}).get("text", "")
            results.append({
                "file": abs_path,
                "line": line_num,
                "content": content.rstrip("\n\r"),
                "relative": fpath,
            })
            if len(results) >= max_results:
                break

        results.sort(key=lambda r: (r["file"], r["line"]))
        return results

    # ======================================================================
    # Highlight pattern builder
    # ======================================================================
    def _build_highlight_pattern(self, query: str):
        flags = 0 if self._case_btn.isChecked() else re.IGNORECASE
        pattern_str = query
        try:
            if not self._regex_btn.isChecked():
                pattern_str = re.escape(query)
            if self._word_btn.isChecked():
                pattern_str = rf"\b{pattern_str}\b"
            return re.compile(pattern_str, flags)
        except re.error:
            return None

    # ======================================================================
    # Display results
    # ======================================================================
    def _display_results(self, query: str, results: list):
        self._results.clear()
        self._highlight_pattern = self._build_highlight_pattern(query)
        files = {}
        total_matches = 0

        show_context = self._context_lines_btn.isChecked()
        try:
            context_count = int(self._context_count_combo.currentText())
        except ValueError:
            context_count = 1
        replacement = self._replace_input.text()

        # Pre-compile replace preview pattern
        pattern = None
        if replacement and query:
            try:
                flags = 0 if self._case_btn.isChecked() else re.IGNORECASE
                q_pat = query
                if not self._regex_btn.isChecked():
                    q_pat = re.escape(q_pat)
                if self._word_btn.isChecked():
                    q_pat = rf"\b{q_pat}\b"
                pattern = re.compile(q_pat, flags)
            except Exception:
                pass

        for r in results[:500]:
            fpath = r["file"]
            if fpath not in files:
                file_item = QTreeWidgetItem()
                rel = r.get("relative", os.path.basename(fpath))
                dirname = os.path.dirname(rel)
                basename = os.path.basename(fpath)
                display = f"{basename}"
                if dirname:
                    display += f"  {dirname}"
                file_item.setText(0, display)
                file_item.setData(0, Qt.UserRole, fpath)
                file_item.setForeground(0, QColor("#cccccc"))
                file_item.setIcon(0, get_file_icon(fpath))
                files[fpath] = {"item": file_item, "count": 0}
                self._results.addTopLevelItem(file_item)

            content = r["content"][:150].strip()
            replaced_text = None
            if pattern:
                try:
                    replaced_text, count = pattern.subn(replacement, content)
                except Exception:
                    pass

            if show_context:
                self._add_result_with_context(
                    fpath, r, content, replaced_text, files,
                    context_count, replacement, pattern,
                )
                total_matches += 1
            else:
                line_item = QTreeWidgetItem()
                if replaced_text and replaced_text != content:
                    line_item.setText(0, f"  {r['line']}:  {content}   \u2794   {replaced_text}")
                    line_item.setForeground(0, QColor("#73c991"))
                else:
                    line_item.setText(0, f"  {r['line']}:  {content}")
                    line_item.setForeground(0, QColor("#bbbbbb"))
                line_item.setData(0, Qt.UserRole, fpath)
                line_item.setData(0, Qt.UserRole + 1, r["line"])
                files[fpath]["item"].addChild(line_item)
                files[fpath]["count"] += 1
                total_matches += 1

        # Update file counts
        for fpath, data in files.items():
            current_text = data["item"].text(0)
            data["item"].setText(0, f"{current_text}  ({data['count']} matches)")

        file_count = len(files)
        if total_matches > 0:
            self._count_label.setText(f"{total_matches} results in {file_count} files")
        else:
            self._count_label.setText("No results found")
            no_item = QTreeWidgetItem()
            no_item.setText(0, "No results found")
            no_item.setForeground(0, QColor("#888888"))
            self._results.addTopLevelItem(no_item)

        self._results.expandAll()

    def _add_result_with_context(
        self, fpath, r, content, replaced_text, files,
        context_count, replacement, pattern,
    ):
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except Exception:
            return
        match_idx = r["line"] - 1

        for ci in range(max(0, match_idx - context_count), match_idx):
            prev_num = ci + 1
            prev_content = lines[ci].rstrip("\n\r")
            prev_item = QTreeWidgetItem()
            prev_item.setText(0, f"  {prev_num}:  {prev_content}")
            prev_item.setData(0, Qt.UserRole, fpath)
            prev_item.setData(0, Qt.UserRole + 1, prev_num)
            prev_item.setForeground(0, QColor("#666666"))
            files[fpath]["item"].addChild(prev_item)

        # Main match line
        line_item = QTreeWidgetItem()
        if replaced_text and replaced_text != content:
            line_item.setText(0, f"  {r['line']}:  {content}   \u2794   {replaced_text}")
            line_item.setForeground(0, QColor("#73c991"))
        else:
            line_item.setText(0, f"  {r['line']}:  {content}")
            line_item.setForeground(0, QColor("#bbbbbb"))
        font = line_item.font(0)
        font.setBold(True)
        line_item.setFont(0, font)
        line_item.setData(0, Qt.UserRole, fpath)
        line_item.setData(0, Qt.UserRole + 1, r["line"])
        files[fpath]["item"].addChild(line_item)
        files[fpath]["count"] += 1

        for ci in range(match_idx + 1, min(len(lines), match_idx + 1 + context_count)):
            next_num = ci + 1
            next_content = lines[ci].rstrip("\n\r")
            next_item = QTreeWidgetItem()
            next_item.setText(0, f"  {next_num}:  {next_content}")
            next_item.setData(0, Qt.UserRole, fpath)
            next_item.setData(0, Qt.UserRole + 1, next_num)
            next_item.setForeground(0, QColor("#666666"))
            files[fpath]["item"].addChild(next_item)

    # ======================================================================
    # Context lines toggle
    # ======================================================================
    def _toggle_context_lines(self):
        query = self._query_input.text().strip()
        if query and self._last_results:
            self._display_results(query, self._last_results)

    # ======================================================================
    # Replace
    # ======================================================================
    def _replace_next(self):
        """Replace the first selected or first match with the replacement text."""
        query = self._query_input.text().strip()
        replacement = self._replace_input.text()
        if not query:
            return

        # Find the first match item selected or the first in the tree
        target_item = None
        selected = self._results.selectedItems()
        for sel in selected:
            if sel.data(0, Qt.UserRole + 1):
                target_item = sel
                break
        if not target_item:
            target_item = self._results.topLevelItem(0)
            if target_item and target_item.childCount() > 0:
                target_item = target_item.child(0)

        if not target_item:
            QMessageBox.information(self, "Replace", "No match to replace.")
            return

        path = target_item.data(0, Qt.UserRole)
        line = target_item.data(0, Qt.UserRole + 1)
        if not path or not line:
            return

        try:
            content = self._fs.read_file(path)
            lines = content.splitlines(keepends=True)
            idx = int(line) - 1
            if idx < 0 or idx >= len(lines):
                return
            old_line = lines[idx]

            flags = 0 if self._case_btn.isChecked() else re.IGNORECASE
            q_pat = query
            try:
                if not self._regex_btn.isChecked():
                    q_pat = re.escape(q_pat)
                if self._word_btn.isChecked():
                    q_pat = rf"\b{q_pat}\b"
                pat = re.compile(q_pat, flags)
            except re.error:
                return

            new_line, count = pat.subn(replacement, old_line, count=1)
            if count == 0:
                return
            lines[idx] = new_line
            self._fs.write_file(path, "".join(lines))
        except Exception as e:
            QMessageBox.warning(self, "Replace Error", str(e))
            return

        self._search()

    def _replace_all(self):
        query = self._query_input.text()
        if not query:
            return
        replacement = self._replace_input.text()

        reply = QMessageBox.question(
            self, "Replace All",
            f"Replace '{query}' with '{replacement}' across all files?",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return

        file_pattern = self._include_input.text().strip() or None
        exclude_pattern = self._exclude_input.text().strip() or None
        use_rg = self._rg_btn.isChecked() and _RG_PATH is not None

        if use_rg:
            results = self._rg_search(
                query, self._root_path,
                case_sensitive=self._case_btn.isChecked(),
                is_regex=self._regex_btn.isChecked(),
                whole_word=self._word_btn.isChecked(),
                file_pattern=file_pattern,
                exclude_pattern=exclude_pattern,
                follow_symlinks=self._symlink_btn.isChecked(),
            )
        else:
            results = self._fs.grep(
                query, self._root_path,
                case_sensitive=self._case_btn.isChecked(),
                is_regex=self._regex_btn.isChecked(),
                whole_word=self._word_btn.isChecked(),
                file_pattern=file_pattern,
                exclude_pattern=exclude_pattern,
            )

        if not results:
            QMessageBox.information(self, "Replace All", "No matches found.")
            return

        files_to_modify = set(r["file"] for r in results)

        flags = 0 if self._case_btn.isChecked() else re.IGNORECASE
        try:
            if not self._regex_btn.isChecked():
                query = re.escape(query)
            if self._word_btn.isChecked():
                query = rf"\b{query}\b"
            pattern = re.compile(query, flags)
        except re.error as e:
            QMessageBox.warning(self, "Regex Error", str(e))
            return

        replaced_count = 0
        for fpath in files_to_modify:
            try:
                content = self._fs.read_file(fpath)
                new_content, count = pattern.subn(replacement, content)
                if count > 0:
                    self._fs.write_file(fpath, new_content)
                    replaced_count += count
            except Exception as e:
                print(f"Error replacing in {fpath}: {e}")

        QMessageBox.information(
            self, "Replace All", f"Replaced {replaced_count} occurrences."
        )
        self._search()

    # ======================================================================
    # F4 / Shift+F4 navigation
    # ======================================================================
    def _collect_all_result_items(self) -> list[QTreeWidgetItem]:
        items = []
        for i in range(self._results.topLevelItemCount()):
            file_item = self._results.topLevelItem(i)
            for j in range(file_item.childCount()):
                child = file_item.child(j)
                if child.data(0, Qt.UserRole + 1):
                    items.append(child)
        return items

    def _navigate_next(self):
        items = self._collect_all_result_items()
        if not items:
            return
        selected = self._results.selectedItems()
        if selected:
            last = selected[-1]
            for idx, item in enumerate(items):
                if item is last and idx + 1 < len(items):
                    self._select_and_open(items[idx + 1])
                    return
        self._select_and_open(items[0])

    def _navigate_previous(self):
        items = self._collect_all_result_items()
        if not items:
            return
        selected = self._results.selectedItems()
        if selected:
            first = selected[0]
            for idx, item in enumerate(items):
                if item is first and idx - 1 >= 0:
                    self._select_and_open(items[idx - 1])
                    return
        self._select_and_open(items[-1])

    def _select_and_open(self, item: QTreeWidgetItem):
        self._results.clearSelection()
        item.setSelected(True)
        self._results.scrollToItem(item)
        self._on_result_clicked(item, 0)

    # ======================================================================
    # Open in editor
    # ======================================================================
    def _open_results_in_editor(self):
        query = self._query_input.text()
        if not query:
            return

        lines = [f"// Search Results for: {query}"]
        lines.append(f"// {self._total_matches} results in {self._total_files} files\n")

        for i in range(self._results.topLevelItemCount()):
            file_item = self._results.topLevelItem(i)
            data = file_item.data(0, Qt.UserRole)
            file_path = data if isinstance(data, str) else ""
            lines.append(f"{file_path}:")
            for j in range(file_item.childCount()):
                child = file_item.child(j)
                child_data = child.data(0, Qt.UserRole)
                child_line = child.data(0, Qt.UserRole + 1)
                if child_line:
                    content = child.text(0).split(":", 1)[-1].strip()
                    lines.append(f"  {child_line}: {content}")
            lines.append("")

        content = "\n".join(lines)
        from ..core.event_bus import EventBus

        EventBus.instance().emit(
            "search_editor_requested", {"query": query, "content": content}
        )

    # ======================================================================
    # Result click / double-click
    # ======================================================================
    def _on_result_clicked(self, item: QTreeWidgetItem, column: int):
        path = item.data(0, Qt.UserRole)
        line = item.data(0, Qt.UserRole + 1) or 1
        if path and os.path.isfile(path):
            self.file_selected.emit(path, int(line))

    def _on_result_double_clicked(self, item: QTreeWidgetItem, column: int):
        path = item.data(0, Qt.UserRole)
        if path and os.path.isfile(path):
            QDesktopServices.openUrl(QUrl.fromLocalFile(path))

    # ======================================================================
    # Dismiss
    # ======================================================================
    def dismiss_selected_results(self):
        selected = self._results.selectedItems()
        if not selected:
            return

        for item in selected:
            parent = item.parent()
            if parent:
                parent.removeChild(item)
                count = parent.childCount()
                base_text = parent.text(0).split("  (")[0]
                if count > 0:
                    parent.setText(0, f"{base_text}  ({count} matches)")
                else:
                    idx = self._results.indexOfTopLevelItem(parent)
                    if idx >= 0:
                        self._results.takeTopLevelItem(idx)
            else:
                idx = self._results.indexOfTopLevelItem(item)
                if idx >= 0:
                    self._results.takeTopLevelItem(idx)

        total_matches = 0
        total_files = 0
        for i in range(self._results.topLevelItemCount()):
            item = self._results.topLevelItem(i)
            if item.data(0, Qt.UserRole):
                total_files += 1
                total_matches += item.childCount()

        if total_matches > 0:
            self._count_label.setText(f"{total_matches} results in {total_files} files")
        else:
            self._count_label.setText("No results found")

    # ======================================================================
    # Public API
    # ======================================================================
    def set_root(self, path: str):
        self._root_path = path or ""
        if self._query_input.text().strip():
            self._search()

    def focus_query(self):
        self._query_input.setFocus()
        self._query_input.selectAll()
