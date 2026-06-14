"""Git Panel - VS Code style Source Control panel using git subprocess."""

import os
import subprocess
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTreeWidget, QTreeWidgetItem, QLineEdit, QScrollArea,
    QFrame, QMenu, QMessageBox, QInputDialog, QApplication
)
from PySide6.QtCore import Signal, Qt, QTimer
from PySide6.QtGui import QColor, QFont


def run_git(args, cwd):
    """Run a git command and return stdout, stderr, returncode."""
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except OSError:
        return "", "git not found or invalid directory", 1
    except subprocess.TimeoutExpired:
        return "", "git command timed out", 1


SECTION_STYLE = """
    QTreeWidget {
        background-color: #000000;
        color: #cccccc;
        border: none;
        outline: none;
        font-size: 12px;
    }
    QTreeWidget::item {
        padding: 2px 4px;
        border: none;
    }
    QTreeWidget::item:selected {
        background-color: #2c004a;
        color: #ffffff;
    }
    QTreeWidget::item:hover {
        background-color: #1a0033;
    }
    QTreeWidget::branch {
        background: transparent;
    }
"""


class GitPanel(QWidget):
    """VS Code-style Source Control (Git) panel."""

    file_open_requested = Signal(str)   # emit file path to open
    diff_open_requested = Signal(str, str, str)  # emit file_path, original, modified
    refreshed = Signal()

    def __init__(self, root_path=None, parent=None):
        super().__init__(parent)
        self._root = root_path or os.path.expanduser("~")
        self._is_git_repo = False
        self._branch = ""
        self._staged = []
        self._unstaged = []
        self._untracked = []
        self._setup_ui()
        self._refresh_timer = QTimer()
        self._refresh_timer.timeout.connect(self.refresh)
        self._refresh_timer.start(3000)  # auto-refresh every 3s
        self.refresh()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(36)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2c004a;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 8, 0)

        title = QLabel("SOURCE CONTROL")
        title.setStyleSheet("color: #bbbbbb; font-size: 10px; font-weight: 600; letter-spacing: 1.2px;")
        h_lay.addWidget(title)
        h_lay.addStretch()

        refresh_btn = QPushButton("↻")
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setToolTip("Refresh")
        refresh_btn.setStyleSheet(self._icon_btn())
        refresh_btn.clicked.connect(self.refresh)
        h_lay.addWidget(refresh_btn)

        layout.addWidget(header)

        # Branch / repo info bar
        self._branch_bar = QLabel("  No Git repository")
        self._branch_bar.setFixedHeight(28)
        self._branch_bar.setStyleSheet("""
            QLabel {
                background-color: #0d0d0d;
                color: #888888;
                font-size: 12px;
                padding-left: 12px;
                border-bottom: 1px solid #1a0033;
            }
        """)
        layout.addWidget(self._branch_bar)

        # Commit message input
        self._commit_msg = QLineEdit()
        self._commit_msg.setPlaceholderText(" Message (Ctrl+Enter to commit)")
        self._commit_msg.setFixedHeight(32)
        self._commit_msg.setStyleSheet("""
            QLineEdit {
                background-color: #1a0033;
                color: #d4d4d4;
                border: 1px solid #3c0068;
                padding: 4px 8px;
                font-size: 12px;
            }
            QLineEdit:focus { border: 1px solid #6600aa; }
        """)
        self._commit_msg.returnPressed.connect(self._commit)
        layout.addWidget(self._commit_msg)

        # Commit + Sync buttons
        btn_row = QWidget()
        btn_row.setStyleSheet("background-color: #000000; border-bottom: 1px solid #1a0033;")
        btn_lay = QHBoxLayout(btn_row)
        btn_lay.setContentsMargins(8, 4, 8, 4)
        btn_lay.setSpacing(6)

        commit_btn = QPushButton("✓ Commit")
        commit_btn.setStyleSheet(self._action_btn())
        commit_btn.clicked.connect(self._commit)
        btn_lay.addWidget(commit_btn)

        sync_btn = QPushButton("↑↓ Sync")
        sync_btn.setStyleSheet(self._action_btn())
        sync_btn.clicked.connect(self._sync)
        btn_lay.addWidget(sync_btn)

        layout.addWidget(btn_row)

        # File trees
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: #000000; } QScrollBar:vertical { width: 8px; background: #000000; } QScrollBar::handle:vertical { background: #2c004a; }")

        content = QWidget()
        content.setStyleSheet("background-color: #000000;")
        self._content_layout = QVBoxLayout(content)
        self._content_layout.setContentsMargins(0, 0, 0, 0)
        self._content_layout.setSpacing(0)

        # Staged changes tree
        self._staged_tree = self._make_section("Staged Changes", "#4ec9b0")
        self._content_layout.addWidget(self._staged_tree)

        # Changes tree
        self._changes_tree = self._make_section("Changes", "#cccccc")
        self._content_layout.addWidget(self._changes_tree)

        # Untracked tree
        self._untracked_tree = self._make_section("Untracked Files", "#888888")
        self._content_layout.addWidget(self._untracked_tree)

        self._content_layout.addStretch()
        scroll.setWidget(content)
        layout.addWidget(scroll)

    def _make_section(self, title, color):
        tree = QTreeWidget()
        tree.setHeaderHidden(True)
        tree.setStyleSheet(SECTION_STYLE)
        tree.setRootIsDecorated(False)
        tree.setContextMenuPolicy(Qt.CustomContextMenu)
        tree.customContextMenuRequested.connect(lambda pos, t=tree: self._show_context_menu(pos, t))
        tree.itemDoubleClicked.connect(self._on_item_double_clicked)

        # Section header item
        header_item = QTreeWidgetItem([f"  {title}"])
        header_item.setExpanded(True)
        header_item.setForeground(0, QColor(color))
        f = header_item.font(0)
        f.setPointSize(10)
        f.setBold(False)
        header_item.setFont(0, f)
        tree.addTopLevelItem(header_item)
        tree.expandItem(header_item)
        tree._section_header = header_item
        tree._title = title
        tree.setMaximumHeight(400)
        return tree

    def refresh(self):
        """Re-run git status and update all trees."""
        stdout, _, rc = run_git(["rev-parse", "--is-inside-work-tree"], self._root)
        self._is_git_repo = (rc == 0)

        if not self._is_git_repo:
            self._branch_bar.setText("  No Git repository")
            self._clear_trees()
            return

        branch_out, _, _ = run_git(["branch", "--show-current"], self._root)
        self._branch = branch_out or "HEAD detached"
        self._branch_bar.setText(f"   {self._branch}")
        self._branch_bar.setStyleSheet("""
            QLabel {
                background-color: #0d0d0d;
                color: #d4d4d4;
                font-size: 12px;
                padding-left: 12px;
                border-bottom: 1px solid #1a0033;
            }
        """)

        status_out, _, _ = run_git(["status", "--porcelain", "-u"], self._root)
        self._staged = []
        self._unstaged = []
        self._untracked = []

        for line in status_out.splitlines():
            if len(line) < 3:
                continue
            xy = line[:2]
            path = line[3:].strip()
            x, y = xy[0], xy[1]

            if x == '?' and y == '?':
                self._untracked.append(path)
            else:
                if x != ' ' and x != '?':
                    self._staged.append((path, x))
                if y != ' ' and y != '?':
                    self._unstaged.append((path, y))

        self._populate_tree(self._staged_tree, self._staged, staged=True)
        self._populate_tree(self._changes_tree, self._unstaged, staged=False)
        self._populate_tree_simple(self._untracked_tree, self._untracked)
        self.refreshed.emit()

    def _clear_trees(self):
        for tree in [self._staged_tree, self._changes_tree, self._untracked_tree]:
            h = tree._section_header
            for i in range(h.childCount() - 1, -1, -1):
                h.removeChild(h.child(i))

    def _populate_tree(self, tree, files, staged=False):
        header = tree._section_header
        for i in range(header.childCount() - 1, -1, -1):
            header.removeChild(header.child(i))

        status_colors = {'M': '#e2c08d', 'A': '#73c991', 'D': '#f14c4c', 'R': '#c586c0', 'C': '#c586c0'}
        status_labels = {'M': 'M', 'A': 'A', 'D': 'D', 'R': 'R', 'C': 'C'}

        for path, status in files:
            item = QTreeWidgetItem()
            basename = os.path.basename(path)
            dirname = os.path.dirname(path)
            label = f"  {basename}"
            if dirname:
                label += f"  {dirname}"
            item.setText(0, label)
            item.setData(0, Qt.UserRole, path)
            color = status_colors.get(status, '#cccccc')
            item.setForeground(0, QColor(color))
            header.addChild(item)

        header.setExpanded(True)
        tree.setMaximumHeight(min(400, 24 + 24 * max(1, len(files))))

    def _populate_tree_simple(self, tree, files):
        header = tree._section_header
        for i in range(header.childCount() - 1, -1, -1):
            header.removeChild(header.child(i))
        for path in files:
            item = QTreeWidgetItem()
            item.setText(0, f"  {os.path.basename(path)}")
            item.setData(0, Qt.UserRole, path)
            item.setForeground(0, QColor("#888888"))
            header.addChild(item)
        header.setExpanded(True)
        tree.setMaximumHeight(min(400, 24 + 24 * max(1, len(files))))

    def _on_item_double_clicked(self, item, col):
        path = item.data(0, Qt.UserRole)
        if path:
            self._open_diff_for_path(path)

    def _open_diff_for_path(self, path):
        full_path = os.path.join(self._root, path)
        
        # Get modified (current disk) content
        modified_content = ""
        if os.path.isfile(full_path):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    modified_content = f.read()
            except Exception:
                pass
                
        # Get original (git HEAD) content
        original_content = ""
        is_untracked = (path in self._untracked)
        if not is_untracked:
            # Run git show HEAD:path
            git_path = path.replace("\\", "/")
            out, err, rc = run_git(["show", f"HEAD:{git_path}"], self._root)
            if rc == 0:
                original_content = out
            else:
                original_content = ""
                
        self.diff_open_requested.emit(full_path, original_content, modified_content)

    def _show_context_menu(self, pos, tree):
        item = tree.itemAt(pos)
        if not item:
            return
        path = item.data(0, Qt.UserRole)
        if not path:
            return

        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background: #1a0033; color: #cccccc; border: 1px solid #3c0068; }
            QMenu::item:selected { background: #2c004a; }
        """)
        stage_act = menu.addAction("Stage Changes")
        unstage_act = menu.addAction("Unstage Changes")
        discard_act = menu.addAction("Discard Changes")
        menu.addSeparator()
        open_diff_act = menu.addAction("Open Diff")
        open_act = menu.addAction("Open File")

        action = menu.exec(tree.viewport().mapToGlobal(pos))
        if action == stage_act:
            run_git(["add", path], self._root)
            self.refresh()
        elif action == unstage_act:
            run_git(["reset", "HEAD", path], self._root)
            self.refresh()
        elif action == discard_act:
            reply = QMessageBox.question(self, "Discard", f"Discard changes to {path}?",
                                          QMessageBox.Yes | QMessageBox.No)
            if reply == QMessageBox.Yes:
                run_git(["checkout", "--", path], self._root)
                self.refresh()
        elif action == open_diff_act:
            self._open_diff_for_path(path)
        elif action == open_act:
            full = os.path.join(self._root, path)
            self.file_open_requested.emit(full)

    def _commit(self):
        msg = self._commit_msg.text().strip()
        if not msg:
            QMessageBox.warning(self, "Commit", "Please enter a commit message.")
            return
        out, err, rc = run_git(["commit", "-m", msg], self._root)
        if rc == 0:
            self._commit_msg.clear()
            self.refresh()
        else:
            QMessageBox.warning(self, "Commit Failed", err or out)

    def _sync(self):
        """Pull then push."""
        out, err, rc = run_git(["pull", "--rebase"], self._root)
        if rc != 0:
            QMessageBox.warning(self, "Pull Failed", err or out)
            return
        out2, err2, rc2 = run_git(["push"], self._root)
        if rc2 != 0:
            QMessageBox.warning(self, "Push Failed", err2 or out2)
        else:
            self.refresh()

    def set_root(self, path):
        self._root = path
        self.refresh()

    def _icon_btn(self):
        return """
            QPushButton { background: transparent; border: none; color: #cccccc; font-size: 14px; border-radius: 3px; }
            QPushButton:hover { background: #2c004a; }
        """

    def _action_btn(self):
        return """
            QPushButton {
                background-color: #2c004a;
                color: #d4d4d4;
                border: 1px solid #3c0068;
                padding: 4px 10px;
                font-size: 12px;
                border-radius: 3px;
            }
            QPushButton:hover { background-color: #3c0068; }
            QPushButton:pressed { background-color: #4a0072; }
        """
