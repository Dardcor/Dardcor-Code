"""Git Clone Dialog - VS Code style clone repository dialog."""

import os
import threading
import subprocess
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QFileDialog, QProgressBar, QMessageBox
)
from PySide6.QtCore import Signal, Qt, QTimer


class GitCloneDialog(QDialog):
    """Dialog for cloning a git repository."""

    clone_complete = Signal(str)  # emits the cloned path

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Git: Clone Repository")
        self.setFixedSize(550, 220)
        self.setStyleSheet("""
            QDialog { background-color: #1e1e1e; }
            QLabel { color: #d4d4d4; font-size: 12px; }
            QLineEdit {
                background-color: #1a0033;
                color: #d4d4d4;
                border: 1px solid #3c0068;
                padding: 6px 10px;
                font-size: 12px;
                border-radius: 3px;
            }
            QLineEdit:focus { border: 1px solid #6600aa; }
            QPushButton {
                background-color: #2c004a;
                color: #d4d4d4;
                border: 1px solid #3c0068;
                padding: 6px 16px;
                border-radius: 4px;
                font-size: 12px;
            }
            QPushButton:hover { background-color: #3c0068; }
        """)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        layout.addWidget(QLabel("Repository URL:"))
        self._url_input = QLineEdit()
        self._url_input.setPlaceholderText("https://github.com/user/repo.git")
        layout.addWidget(self._url_input)

        path_row = QHBoxLayout()
        layout.addWidget(QLabel("Clone to:"))
        self._path_input = QLineEdit()
        self._path_input.setText(os.path.expanduser("~/Projects"))
        path_row.addWidget(self._path_input)

        browse_btn = QPushButton("Browse...")
        browse_btn.clicked.connect(self._browse)
        path_row.addWidget(browse_btn)
        layout.addLayout(path_row)

        self._progress = QProgressBar()
        self._progress.setRange(0, 0)
        self._progress.setTextVisible(False)
        self._progress.setFixedHeight(4)
        self._progress.setStyleSheet("""
            QProgressBar { background: #0d0d0d; border: none; }
            QProgressBar::chunk { background: #4a0072; }
        """)
        self._progress.hide()
        layout.addWidget(self._progress)

        self._status_label = QLabel("")
        self._status_label.setStyleSheet("color: #888888; font-size: 11px;")
        layout.addWidget(self._status_label)

        btn_row = QHBoxLayout()
        btn_row.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(cancel_btn)

        clone_btn = QPushButton("Clone")
        clone_btn.setStyleSheet("""
            QPushButton {
                background-color: #0e639c;
                color: #ffffff;
                border: none;
                padding: 6px 20px;
            }
            QPushButton:hover { background-color: #1177bb; }
        """)
        clone_btn.clicked.connect(self._clone)
        btn_row.addWidget(clone_btn)
        layout.addLayout(btn_row)

    def _browse(self):
        path = QFileDialog.getExistingDirectory(self, "Select Directory", self._path_input.text())
        if path:
            self._path_input.setText(path)

    def _clone(self):
        url = self._url_input.text().strip()
        dest = self._path_input.text().strip()
        if not url:
            QMessageBox.warning(self, "Error", "Please enter a repository URL.")
            return
        if not dest:
            QMessageBox.warning(self, "Error", "Please select a destination folder.")
            return

        # Extract repo name from URL
        repo_name = url.rstrip("/").split("/")[-1]
        if repo_name.endswith(".git"):
            repo_name = repo_name[:-4]
        clone_path = os.path.join(dest, repo_name)

        self._progress.show()
        self._status_label.setText("Cloning repository...")

        def _do_clone():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                result = subprocess.run(
                    ["git", "clone", url, clone_path],
                    capture_output=True, text=True, timeout=120,
                    **kwargs
                )
                if result.returncode == 0:
                    QTimer.singleShot(0, lambda: self._on_success(clone_path))
                else:
                    QTimer.singleShot(0, lambda: self._on_error(result.stderr))
            except Exception as e:
                QTimer.singleShot(0, lambda: self._on_error(str(e)))

        threading.Thread(target=_do_clone, daemon=True).start()

    def _on_success(self, path):
        self._progress.hide()
        self._status_label.setText(f"✓ Cloned to {path}")
        self.clone_complete.emit(path)
        self.accept()

    def _on_error(self, error):
        self._progress.hide()
        self._status_label.setText(f"✕ {error}")
        QMessageBox.warning(self, "Clone Failed", error)
