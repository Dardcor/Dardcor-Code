"""Search Panel - VS Code style search across files."""

import os
import threading
import re
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLineEdit, QPushButton,
    QLabel, QTreeWidget, QTreeWidgetItem, QMessageBox
)
from PySide6.QtCore import Signal, Qt, QObject, QEvent, QTimer
from PySide6.QtGui import QColor

from ..core.filesystem import FileSystem
from ..file_explorer.panel import get_file_icon


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
        self.line_edit.setStyleSheet(f"background: transparent; border: none; color: {colors['foreground']}; font-size: 13px; padding: 0px;")
        self.layout.addWidget(self.line_edit)
        
        self.update_style(False)
        
        self._filter = FocusFilter(self, self.line_edit)
        self.line_edit.installEventFilter(self._filter)
        
    def paintEvent(self, event):
        from PySide6.QtGui import QPainter
        from PySide6.QtWidgets import QStyleOption, QStyle
        opt = QStyleOption()
        opt.initFrom(self)
        p = QPainter(self)
        self.style().drawPrimitive(QStyle.PE_Widget, opt, p, self)
        p.end()

    def update_style(self, focused):
        bg = self.colors["selection"]
        border = self.colors["accent"] if focused else self.colors["border"]
        self.setStyleSheet(f"""
            VSCodeInputBox {{
                background-color: {bg};
                border: 1px solid {border};
                border-radius: 2px;
            }}
        """)
        
    def add_button(self, btn):
        self.layout.addWidget(btn)
        
    def text(self):
        return self.line_edit.text()
        
    def setText(self, text):
        self.line_edit.setText(text)
        
    def lineEdit(self):
        return self.line_edit


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
        self.setObjectName("searchPanel")

        # Debounce timer for real-time search
        self._search_timer = QTimer(self)
        self._search_timer.setSingleShot(True)
        self._search_timer.timeout.connect(self._search)

        # Connect search finished signal to display slot
        self.search_finished.connect(self._display_results)

        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("""
            background-color: #000000;
            border-bottom: 1px solid #000000;
        """)
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(20, 0, 8, 0)

        title = QLabel("SEARCH")
        title.setStyleSheet("""
            color: #bbbbbb;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 1.2px;
        """)
        header_layout.addWidget(title)
        header_layout.addStretch()

        # Refresh button
        refresh_btn = QPushButton("\u21BB")
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setToolTip("Refresh")
        refresh_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 14px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """)
        refresh_btn.clicked.connect(self._search)
        header_layout.addWidget(refresh_btn)

        # Collapse all
        collapse_btn = QPushButton("\u2212")
        collapse_btn.setFixedSize(22, 22)
        collapse_btn.setToolTip("Collapse All")
        collapse_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 14px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """)
        collapse_btn.clicked.connect(lambda: self._results.collapseAll())
        header_layout.addWidget(collapse_btn)

        layout.addWidget(header)

        # Get Theme Colors
        from ..app.theme_manager import ThemeManager
        theme = ThemeManager.THEMES.get(ThemeManager._current_theme, ThemeManager.THEMES["dark+"])
        colors = theme["colors"]

        # Search inputs area
        search_area = QWidget()
        search_area.setStyleSheet("background-color: #000000;")
        search_layout = QVBoxLayout(search_area)
        search_layout.setContentsMargins(12, 8, 12, 8)
        search_layout.setSpacing(6)

        # Search input row
        search_row_widget = QWidget()
        search_row = QHBoxLayout(search_row_widget)
        search_row.setContentsMargins(0, 0, 0, 0)
        search_row.setSpacing(4)

        # Chevron to toggle replace row
        self._replace_toggle_btn = QPushButton("\u25bc")  # Start expanded
        self._replace_toggle_btn.setFixedSize(18, 28)
        self._replace_toggle_btn.setToolTip("Toggle Replace")
        self._replace_toggle_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 10px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """)
        self._replace_toggle_btn.clicked.connect(self._toggle_replace)
        search_row.addWidget(self._replace_toggle_btn)

        # Search box (container widget)
        self._query_input_box = VSCodeInputBox("Search", colors)
        self._query_input = self._query_input_box.lineEdit()
        self._query_input.textChanged.connect(self._on_query_changed)
        search_row.addWidget(self._query_input_box)

        # Match case
        self._case_btn = QPushButton("Aa")
        self._case_btn.setCheckable(True)
        self._case_btn.setFixedSize(22, 20)
        self._case_btn.setToolTip("Match Case")
        self._case_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._case_btn.toggled.connect(self._search)
        self._query_input_box.add_button(self._case_btn)

        # Whole word
        self._word_btn = QPushButton("ab")
        self._word_btn.setCheckable(True)
        self._word_btn.setFixedSize(22, 20)
        self._word_btn.setToolTip("Match Whole Word")
        self._word_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._word_btn.toggled.connect(self._search)
        self._query_input_box.add_button(self._word_btn)

        # Regex
        self._regex_btn = QPushButton(".*")
        self._regex_btn.setCheckable(True)
        self._regex_btn.setFixedSize(22, 20)
        self._regex_btn.setToolTip("Use Regular Expression")
        self._regex_btn.setStyleSheet(self._toggle_btn_style(colors))
        self._regex_btn.toggled.connect(self._search)
        self._query_input_box.add_button(self._regex_btn)

        # Details button (...) on the far right
        self._details_btn = QPushButton("...")
        self._details_btn.setCheckable(True)
        self._details_btn.setChecked(True)  # Start expanded
        self._details_btn.setFixedSize(20, 28)
        self._details_btn.setToolTip("Toggle Search Details")
        self._details_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                padding: 0px; font-size: 14px; font-weight: bold; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
            QPushButton:checked { background-color: %s; color: #ffffff; }
        """ % colors["accent"])
        self._details_btn.clicked.connect(self._toggle_details)
        search_row.addWidget(self._details_btn)

        search_layout.addWidget(search_row_widget)

        # Replace row
        self._replace_widget = QWidget()
        replace_row = QHBoxLayout(self._replace_widget)
        replace_row.setContentsMargins(0, 0, 0, 0)
        replace_row.setSpacing(4)

        # Spacer on the left matching the chevron toggle button
        replace_left_spacer = QWidget()
        replace_left_spacer.setFixedWidth(18)
        replace_row.addWidget(replace_left_spacer)

        # Replace input container
        self._replace_input_box = VSCodeInputBox("Replace", colors)
        self._replace_input = self._replace_input_box.lineEdit()
        self._replace_input.textChanged.connect(self._on_query_changed)
        replace_row.addWidget(self._replace_input_box)

        # Replace All button inside the input container on the far right
        replace_btn = QPushButton("\u21b7")
        replace_btn.setFixedSize(22, 20)
        replace_btn.setToolTip("Replace All")
        replace_btn.setStyleSheet(self._toggle_btn_style(colors))
        replace_btn.clicked.connect(self._replace_all)
        self._replace_input_box.add_button(replace_btn)

        # Spacer on the right matching the details button
        replace_right_spacer = QWidget()
        replace_right_spacer.setFixedWidth(20)
        replace_row.addWidget(replace_right_spacer)

        search_layout.addWidget(self._replace_widget)

        # Details widget container (include/exclude panel)
        self._details_widget = QWidget()
        details_layout = QVBoxLayout(self._details_widget)
        details_layout.setContentsMargins(0, 0, 0, 0)
        details_layout.setSpacing(6)

        # Files to include row
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

        # Files to exclude row
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

        search_layout.addWidget(self._details_widget)

        layout.addWidget(search_area)

        # Results count
        self._count_label = QLabel("")
        self._count_label.setStyleSheet("""
            color: #888888;
            font-size: 11px;
            padding: 4px 12px;
            background-color: #000000;
        """)
        self._count_label.hide()
        layout.addWidget(self._count_label)

        # Results tree
        self._results = QTreeWidget()
        self._results.setHeaderHidden(True)
        self._results.setIndentation(16)
        self._results.setAnimated(False)
        self._results.setStyleSheet("""
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
        """)
        self._results.itemClicked.connect(self._on_result_clicked)
        layout.addWidget(self._results)

    def _toggle_replace(self):
        visible = not self._replace_widget.isVisible()
        self._replace_widget.setVisible(visible)
        self._replace_toggle_btn.setText("\u25bc" if visible else "\u25b6")

    def _toggle_details(self):
        visible = self._details_btn.isChecked()
        self._details_widget.setVisible(visible)

    def _on_query_changed(self):
        query = self._query_input.text().strip()
        if not query:
            self._results.clear()
            self._count_label.hide()
            self._search_timer.stop()
            return
        self._search_timer.start(300)

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

    def _search(self):
        query = self._query_input.text().strip()
        if not query:
            return
        if not self._root_path or not os.path.isdir(self._root_path):
            self._results.clear()
            self._count_label.setText("Open a folder to search")
            self._count_label.show()
            return

        self._results.clear()
        self._count_label.setText("Searching...")
        self._count_label.show()

        file_pattern = self._include_input.text().strip() or None
        exclude_pattern = self._exclude_input.text().strip() or None

        def do_search():
            results = self._fs.grep(
                query, self._root_path,
                case_sensitive=self._case_btn.isChecked(),
                is_regex=self._regex_btn.isChecked(),
                whole_word=self._word_btn.isChecked(),
                file_pattern=file_pattern,
                exclude_pattern=exclude_pattern,
            )
            self.search_finished.emit(query, results)

        threading.Thread(target=do_search, daemon=True).start()

    def _replace_all(self):
        query = self._query_input.text()
        if not query:
            return
        replacement = self._replace_input.text()
        
        reply = QMessageBox.question(
            self, "Replace All",
            f"Replace '{query}' with '{replacement}' across all files?",
            QMessageBox.Yes | QMessageBox.No
        )
        if reply != QMessageBox.Yes:
            return

        file_pattern = self._include_input.text().strip() or None
        exclude_pattern = self._exclude_input.text().strip() or None
        results = self._fs.grep(
            query, self._root_path,
            case_sensitive=self._case_btn.isChecked(),
            is_regex=self._regex_btn.isChecked(),
            whole_word=self._word_btn.isChecked(),
            file_pattern=file_pattern,
            exclude_pattern=exclude_pattern,
        )

        files_to_modify = set(r["file"] for r in results)
        if not files_to_modify:
            QMessageBox.information(self, "Replace All", "No matches found.")
            return

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

        QMessageBox.information(self, "Replace All", f"Replaced {replaced_count} occurrences.")
        self._search()  # Refresh results

    def _display_results(self, query: str, results: list):
        self._results.clear()
        files = {}
        total_matches = 0

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

            line_item = QTreeWidgetItem()
            content = r["content"][:150].strip()
            line_item.setText(0, f"  {r['line']}:  {content}")
            line_item.setData(0, Qt.UserRole, fpath)
            line_item.setData(0, Qt.UserRole + 1, r["line"])
            line_item.setForeground(0, QColor("#bbbbbb"))
            files[fpath]["item"].addChild(line_item)
            files[fpath]["count"] += 1
            total_matches += 1

        # Update file item text with count
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

        # Expand all
        self._results.expandAll()

    def _on_result_clicked(self, item: QTreeWidgetItem, column: int):
        path = item.data(0, Qt.UserRole)
        line = item.data(0, Qt.UserRole + 1) or 1
        if path and os.path.isfile(path):
            self.file_selected.emit(path, line)

    def set_root(self, path: str):
        self._root_path = path or ""
        if self._query_input.text().strip():
            self._search()

    def focus_query(self):
        self._query_input.setFocus()
        self._query_input.selectAll()
