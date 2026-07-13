"""Multi-step Input Wizard - VS Code style multi-step input (wizard) dialog."""

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QWidget, QStackedWidget, QLineEdit, QFrame, QListWidget,
    QListWidgetItem, QCheckBox, QApplication
)
from PySide6.QtCore import Signal, Qt, QSize
from PySide6.QtGui import QFont


class WizardStep:
    """Represents a single step in a multi-step wizard."""
    def __init__(self, title: str = "", description: str = ""):
        self.title = title
        self.description = description
        self.widget = QWidget()


class WizardDialog(QDialog):
    """Multi-step wizard dialog with back/next/finish navigation."""

    finished = Signal(dict)  # Emits collected data when wizard completes
    cancelled = Signal()

    def __init__(self, title: str = "", parent=None):
        super().__init__(parent)
        self.setWindowTitle(title or "Wizard")
        self.setFixedSize(520, 480)
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 8px;
            }
        """)
        self.setAttribute(Qt.WA_StyledBackground, True)

        self._steps: list[WizardStep] = []
        self._current_step = 0
        self._collected_data: dict = {}

        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        self._header = QWidget()
        self._header.setFixedHeight(48)
        self._header.setStyleSheet("background-color: #0d0d0d; border-bottom: 1px solid #3c0068;")
        header_layout = QHBoxLayout(self._header)
        header_layout.setContentsMargins(16, 0, 16, 0)

        self._step_label = QLabel()
        self._step_label.setStyleSheet("color: #7c3aed; font-size: 11px; font-weight: bold; background: transparent; letter-spacing: 1px;")
        header_layout.addWidget(self._step_label)

        self._title_label = QLabel()
        self._title_label.setStyleSheet("color: #cccccc; font-size: 14px; font-weight: bold; background: transparent;")
        header_layout.addWidget(self._title_label)

        header_layout.addStretch()

        close_btn = QPushButton("✕")
        close_btn.setFixedSize(28, 28)
        close_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #858585; border: none;
                font-size: 16px; border-radius: 14px;
            }
            QPushButton:hover { background-color: #27272a; color: #ffffff; }
        """)
        close_btn.clicked.connect(self.reject)
        header_layout.addWidget(close_btn)

        layout.addWidget(self._header)

        # Description
        self._desc_label = QLabel()
        self._desc_label.setWordWrap(True)
        self._desc_label.setStyleSheet("color: #858585; font-size: 12px; padding: 8px 16px; background: transparent;")
        self._desc_label.hide()
        layout.addWidget(self._desc_label)

        # Steps stack
        self._stack = QStackedWidget()
        self._stack.setStyleSheet("background: transparent;")
        layout.addWidget(self._stack, 1)

        # Progress bar
        self._progress_bar = QWidget()
        self._progress_bar.setFixedHeight(4)
        self._progress_bar.setStyleSheet("background-color: #1a0033;")
        self._progress_fill = QWidget(self._progress_bar)
        self._progress_fill.setStyleSheet("background-color: #7c3aed;")
        layout.addWidget(self._progress_bar)

        # Button bar
        self._btn_bar = QWidget()
        self._btn_bar.setFixedHeight(48)
        self._btn_bar.setStyleSheet("background-color: #0d0d0d; border-top: 1px solid #1a0033;")
        btn_layout = QHBoxLayout(self._btn_bar)
        btn_layout.setContentsMargins(16, 0, 16, 0)

        self._back_btn = QPushButton("Back")
        self._back_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #858585; border: 1px solid #3c0068;
                border-radius: 4px; padding: 6px 20px; font-size: 12px;
            }
            QPushButton:hover { color: #cccccc; }
            QPushButton:disabled { color: #3c3c3c; border-color: #1a0033; }
        """)
        self._back_btn.clicked.connect(self._go_back)
        btn_layout.addWidget(self._back_btn)

        btn_layout.addStretch()

        self._next_btn = QPushButton("Next")
        self._next_btn.setStyleSheet("""
            QPushButton {
                background-color: #7c3aed; color: white; border: none;
                border-radius: 4px; padding: 6px 20px; font-size: 12px;
            }
            QPushButton:hover { background-color: #6d28d9; }
        """)
        self._next_btn.clicked.connect(self._go_next)
        btn_layout.addWidget(self._next_btn)

        layout.addWidget(self._btn_bar)

    def add_step(self, step: WizardStep):
        """Add a step to the wizard."""
        self._steps.append(step)
        self._stack.addWidget(step.widget)

    def _update_navigation(self):
        """Update button states and labels based on current step."""
        total = len(self._steps)
        current = self._current_step

        self._step_label.setText(f"STEP {current + 1} OF {total}")
        self._title_label.setText(self._steps[current].title if self._steps else "")

        if self._steps[current].description:
            self._desc_label.setText(self._steps[current].description)
            self._desc_label.show()
        else:
            self._desc_label.hide()

        self._back_btn.setEnabled(current > 0)

        if current == total - 1:
            self._next_btn.setText("Finish")
        else:
            self._next_btn.setText("Next")

        self._update_progress()

    def _update_progress(self):
        total = len(self._steps)
        if total <= 1:
            self._progress_bar.hide()
            return
        self._progress_bar.show()
        fraction = (self._current_step + 1) / total
        bar_w = self._progress_bar.width()
        self._progress_fill.setFixedWidth(int(bar_w * fraction))

    def _go_back(self):
        if self._current_step > 0:
            self._collect_step_data()
            self._current_step -= 1
            self._stack.setCurrentIndex(self._current_step)
            self._update_navigation()

    def _go_next(self):
        self._collect_step_data()
        if self._current_step < len(self._steps) - 1:
            self._current_step += 1
            self._stack.setCurrentIndex(self._current_step)
            self._update_navigation()
        else:
            self.finished.emit(self._collected_data)
            self.accept()

    def _collect_step_data(self):
        pass  # Override in subclass to collect data from each step

    def show_dialog(self):
        if not self._steps:
            return
        self._current_step = 0
        self._stack.setCurrentIndex(0)
        self._update_navigation()
        self.exec()


class TextInputStep(QWidget):
    """A wizard step with a text input field."""
    def __init__(self, label: str = "", placeholder: str = "", default: str = "",
                 field_key: str = "value", password: bool = False):
        super().__init__()
        self.field_key = field_key
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 16, 24, 16)
        layout.setSpacing(8)

        if label:
            lbl = QLabel(label)
            lbl.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
            layout.addWidget(lbl)

        self.input = QLineEdit()
        self.input.setPlaceholderText(placeholder)
        self.input.setText(default)
        if password:
            self.input.setEchoMode(QLineEdit.Password)
        self.input.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a; color: #cccccc;
                border: 1px solid #3c0068; border-radius: 4px;
                padding: 8px 12px; font-size: 13px;
            }
            QLineEdit:focus { border: 1px solid #7c3aed; }
        """)
        layout.addWidget(self.input)
        layout.addStretch()

    def get_value(self) -> str:
        return self.input.text()


class CheckboxListStep(QWidget):
    """A wizard step with a list of checkboxes."""
    def __init__(self, label: str, options: list, field_key: str = "selected"):
        super().__init__()
        self.field_key = field_key
        self._checkboxes = []

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 16, 24, 16)
        layout.setSpacing(8)

        if label:
            lbl = QLabel(label)
            lbl.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
            layout.addWidget(lbl)

        for opt in options:
            cb = QCheckBox(opt if isinstance(opt, str) else opt.get("label", ""))
            cb.setChecked(opt.get("checked", False) if isinstance(opt, dict) else False)
            cb.setStyleSheet("""
                QCheckBox {
                    color: #cccccc; font-size: 12px; spacing: 8px;
                }
                QCheckBox::indicator {
                    width: 14px; height: 14px;
                    border: 1px solid #3c0068; border-radius: 3px;
                    background: #000000;
                }
                QCheckBox::indicator:checked {
                    background-color: #7c3aed; border-color: #7c3aed;
                }
            """)
            self._checkboxes.append(cb)
            layout.addWidget(cb)

        layout.addStretch()

    def get_value(self) -> list:
        return [cb.text() for cb in self._checkboxes if cb.isChecked()]
