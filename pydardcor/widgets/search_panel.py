"""Search Panel - VS Code style search across files."""

import os
import threading
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLineEdit, QPushButton,
    QLabel, QTreeWidget, QTreeWidgetItem, QCheckBox, QMessageBox
)
from PySide6.QtCore import Signal, Qt
from PySide6.QtGui import QColor, QFont

from ..engine.filesystem import FileSystem


class SearchPanel(QWidget):
    """VS Code style search panel for searching across files."""

    file_selected = Signal(str, int)
    _results_ready = Signal(str, list)

    def __init__(self, root_path: str = None, parent=None):
        super().__init__(parent)
        self._fs = FileSystem()
        self._root_path = root_path or os.path.expanduser("~")
        self._total_matches = 0
        self._results_ready.connect(self._display_results)
        self._total_files = 0
        self.setObjectName("searchPanel")
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
                font-size: 14px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """)
        header_layout.addWidget(refresh_btn)

        # Collapse all
        collapse_btn = QPushButton("\u2212")
        collapse_btn.setFixedSize(22, 22)
        collapse_btn.setToolTip("Collapse All")
        collapse_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #bbbbbb;
                font-size: 14px; border-radius: 3px;
            }
            QPushButton:hover { background-color: rgba(90,93,94,0.31); color: #ffffff; }
        """)
        collapse_btn.clicked.connect(lambda: self._results.collapseAll())
        header_layout.addWidget(collapse_btn)

        layout.addWidget(header)

        # Search inputs
        search_area = QWidget()
        search_area.setStyleSheet("background-color: #000000;")
        search_layout = QVBoxLayout(search_area)
        search_layout.setContentsMargins(12, 8, 12, 8)
        search_layout.setSpacing(6)

        # Search input row with inline match options
        search_row = QHBoxLayout()
        search_row.setSpacing(4)

        self._query_input = QLineEdit()
        self._query_input.setPlaceholderText("Search")
        self._query_input.setFixedHeight(28)
        self._query_input.setStyleSheet(self._input_style())
        self._query_input.returnPressed.connect(self._search)
        search_row.addWidget(self._query_input, 1)
        search_row.setStretch(0, 1)

        self._case_btn = QPushButton("Aa")
        self._case_btn.setCheckable(True)
        self._case_btn.setFixedSize(26, 26)
        self._case_btn.setToolTip("Match Case")
        self._case_btn.setStyleSheet(self._toggle_btn_style())
        search_row.addWidget(self._case_btn)

        self._word_btn = QPushButton("ab")
        self._word_btn.setCheckable(True)
        self._word_btn.setFixedSize(26, 26)
        self._word_btn.setToolTip("Match Whole Word")
        self._word_btn.setStyleSheet(self._toggle_btn_style())
        search_row.addWidget(self._word_btn)

        self._regex_btn = QPushButton(".*")
        self._regex_btn.setCheckable(True)
        self._regex_btn.setFixedSize(26, 26)
        self._regex_btn.setToolTip("Use Regular Expression")
        self._regex_btn.setStyleSheet(self._toggle_btn_style())
        search_row.addWidget(self._regex_btn)

        search_layout.addLayout(search_row)

        replace_row = QHBoxLayout()
        replace_row.setSpacing(4)

        self._replace_input = QLineEdit()
        self._replace_input.setPlaceholderText("Replace")
        self._replace_input.setFixedHeight(28)
        self._replace_input.setStyleSheet(self._input_style())
        replace_row.addWidget(self._replace_input, 1)

        replace_btn = QPushButton("\u21b7")
        replace_btn.setFixedSize(26, 26)
        replace_btn.setToolTip("Replace All")
        replace_btn.setStyleSheet(self._toggle_btn_style())
        replace_btn.clicked.connect(self._replace_all)
        replace_row.addWidget(replace_btn)

        search_layout.addLayout(replace_row)

        include_widget = QWidget()
        include_layout = QHBoxLayout(include_widget)
        include_layout.setContentsMargins(0, 0, 0, 0)
        include_layout.setSpacing(4)
        inc_label = QLabel("Include:")
        inc_label.setStyleSheet("color: #858585; font-size: 10px; padding: 0 4px 0 0;")
        include_layout.addWidget(inc_label)
        self._include_input = QLineEdit()
        self._include_input.setPlaceholderText("*.py, src/")
        self._include_input.setFixedHeight(22)
        self._include_input.setStyleSheet(self._input_style())
        self._include_input.setFont(QFont("Consolas", 9))
        include_layout.addWidget(self._include_input, 1)
        search_layout.addWidget(include_widget)

        exclude_widget = QWidget()
        exclude_layout = QHBoxLayout(exclude_widget)
        exclude_layout.setContentsMargins(0, 0, 0, 0)
        exclude_layout.setSpacing(4)
        exc_label = QLabel("Exclude:")
        exc_label.setStyleSheet("color: #858585; font-size: 10px; padding: 0 4px 0 0;")
        exclude_layout.addWidget(exc_label)
        self._exclude_input = QLineEdit()
        self._exclude_input.setPlaceholderText(".git, node_modules")
        self._exclude_input.setFixedHeight(22)
        self._exclude_input.setStyleSheet(self._input_style())
        self._exclude_input.setFont(QFont("Consolas", 9))
        exclude_layout.addWidget(self._exclude_input, 1)
        search_layout.addWidget(exclude_widget)

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

    def _input_style(self):
        return """
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: 1px solid #2c004a;
                padding: 2px 8px;
                font-size: 13px;
            }
            QLineEdit:focus {
                border: 1px solid #4a0072;
            }
        """

    def _toggle_btn_style(self):
        return """
            QPushButton {
                background: transparent;
                border: 1px solid transparent;
                border-radius: 3px;
                color: #cccccc;
                font-size: 11px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: rgba(90, 93, 94, 0.31);
            }
            QPushButton:checked {
                background-color: rgba(51, 153, 255, 0.4);
                border: 1px solid #4a0072;
            }
        """

    def _search(self):
        query = self._query_input.text().strip()
        if not query:
            return

        self._results.clear()
        self._count_label.setText("Searching...")
        self._count_label.show()

        file_pattern = self._include_input.text().strip() or None

        def do_search():
            results = self._fs.grep(
                query, self._root_path,
                case_sensitive=self._case_btn.isChecked(),
                is_regex=self._regex_btn.isChecked(),
                whole_word=self._word_btn.isChecked(),
                file_pattern=file_pattern,
            )
            self._results_ready.emit(query, results)

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
        results = self._fs.grep(
            query, self._root_path,
            case_sensitive=self._case_btn.isChecked(),
            is_regex=self._regex_btn.isChecked(),
            whole_word=self._word_btn.isChecked(),
            file_pattern=file_pattern,
        )

        files_to_modify = set(r["file"] for r in results)
        if not files_to_modify:
            QMessageBox.information(self, "Replace All", "No matches found.")
            return

        import re
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
        self._root_path = path
