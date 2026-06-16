"""Output Panel - VS Code style output/log panel."""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QComboBox, QPushButton, QPlainTextEdit
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont, QColor


class OutputPanel(QWidget):
    """Scrollable log output panel matching VS Code's Output tab."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._channels = {}  # name -> list of lines
        self._current = "Dardcor"
        self._setup_ui()
        self.add_channel("Dardcor")
        self.add_channel("Python")
        self.add_channel("Extensions")

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Toolbar
        toolbar = QWidget()
        toolbar.setFixedHeight(30)
        toolbar.setStyleSheet("background: #000000; border-bottom: 1px solid #1a0033;")
        t_lay = QHBoxLayout(toolbar)
        t_lay.setContentsMargins(8, 0, 8, 0)
        t_lay.setSpacing(6)

        self._channel_combo = QComboBox()
        self._channel_combo.setStyleSheet("""
            QComboBox {
                background: #1a0033; color: #cccccc; border: 1px solid #3c0068;
                padding: 2px 6px; font-size: 12px; min-width: 120px;
            }
            QComboBox::drop-down { border: none; }
            QComboBox QAbstractItemView {
                background: #1a0033; color: #cccccc; border: 1px solid #3c0068;
                selection-background-color: #2c004a;
            }
        """)
        self._channel_combo.currentTextChanged.connect(self._switch_channel)
        t_lay.addWidget(self._channel_combo)
        t_lay.addStretch()

        clear_btn = QPushButton("🗑")
        clear_btn.setFixedSize(22, 22)
        clear_btn.setToolTip("Clear Output")
        clear_btn.setStyleSheet("QPushButton { background: transparent; border: none; color: #cccccc; font-size: 13px; } QPushButton:hover { background: #2c004a; }")
        clear_btn.clicked.connect(self.clear)
        t_lay.addWidget(clear_btn)

        layout.addWidget(toolbar)

        # Output area
        self._output = QPlainTextEdit()
        self._output.setReadOnly(True)
        self._output.setStyleSheet("""
            QPlainTextEdit {
                background-color: #000000; color: #cccccc;
                border: none; padding: 4px 8px;
                font-family: "Cascadia Code", "Consolas", monospace;
                font-size: 12px;
                selection-background-color: #264f78;
            }
        """)
        self._output.setLineWrapMode(QPlainTextEdit.NoWrap)
        layout.addWidget(self._output)

    def add_channel(self, name):
        if name not in self._channels:
            self._channels[name] = []
            self._channel_combo.addItem(name)

    def _switch_channel(self, name):
        self._current = name
        lines = self._channels.get(name, [])
        self._output.setPlainText("\n".join(lines))
        self._output.moveCursor(self._output.textCursor().MoveOperation.End)

    def append(self, text, channel=None):
        ch = channel or self._current
        if ch not in self._channels:
            self.add_channel(ch)
        self._channels[ch].append(text)
        if ch == self._current:
            self._output.appendPlainText(text)

    def clear(self):
        self._channels[self._current] = []
        self._output.clear()
