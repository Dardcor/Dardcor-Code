"""Bottom Panel - Unified container for Problems, Output, Debug, Terminal."""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QStackedWidget, QSizePolicy
from PySide6.QtCore import Qt

class BottomPanelButton(QPushButton):
    def __init__(self, text, parent=None):
        super().__init__(text, parent)
        self.setFixedHeight(35)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                background: transparent;
                color: #888888;
                border: none;
                border-bottom: 1px solid transparent;
                padding: 0px 14px;
                font-size: 11px;
                font-weight: normal;
                letter-spacing: 0.5px;
            }
            QPushButton:hover {
                color: #cccccc;
            }
            QPushButton:checked {
                color: #cccccc;
                border-bottom: 1px solid #cccccc;
                font-weight: bold;
            }
        """)
        self.setCheckable(True)

class BottomPanel(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("bottomPanel")
        
        self._problems_widget = None
        self._output_widget = None
        self._debug_widget = None
        self._terminal_widget = None
        
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header bar
        self.header = QWidget()
        self.header.setFixedHeight(35)
        self.header.setStyleSheet("""
            background-color: #000000;
            border-top: 1px solid #3c0068;
        """)
        self.header_layout = QHBoxLayout(self.header)
        self.header_layout.setContentsMargins(0, 0, 4, 0)
        self.header_layout.setSpacing(0)

        # Left tabs
        self.tabs_container = QWidget()
        self.tabs_layout = QHBoxLayout(self.tabs_container)
        self.tabs_layout.setContentsMargins(0, 0, 0, 0)
        self.tabs_layout.setSpacing(0)
        
        self.btn_problems = BottomPanelButton("Problems")
        self.btn_output = BottomPanelButton("Output")
        self.btn_debug = BottomPanelButton("Debug Console")
        self.btn_terminal = BottomPanelButton("Terminal")
        
        self.tabs_layout.addWidget(self.btn_problems)
        self.tabs_layout.addWidget(self.btn_output)
        self.tabs_layout.addWidget(self.btn_debug)
        self.tabs_layout.addWidget(self.btn_terminal)
        
        self.header_layout.addWidget(self.tabs_container)
        self.header_layout.addStretch(1) # push terminal tabs to the right
        
        # Right controls container (will hold terminal toolbar)
        self.right_controls = QWidget()
        self.right_layout = QHBoxLayout(self.right_controls)
        self.right_layout.setContentsMargins(0, 0, 0, 0)
        self.right_layout.setSpacing(0)
        self.header_layout.addWidget(self.right_controls)

        from PySide6.QtGui import QFont
        # Add panel close button at the very right
        close_btn = QPushButton("\uea76") # Codicon close
        close_btn.setFont(QFont("codicon", 14))
        close_btn.setFixedSize(28, 28)
        close_btn.setToolTip("Close Panel")
        close_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none;
                color: #cccccc; font-size: 14px;
                font-family: "codicon";
                border-radius: 3px;
            }
            QPushButton:hover {
                background-color: rgba(90,93,94,0.31);
            }
        """)
        close_btn.clicked.connect(lambda: self.hide())
        self.header_layout.addWidget(close_btn)

        layout.addWidget(self.header)

        # Stack
        self._stack = QStackedWidget()
        layout.addWidget(self._stack)
        
        # Connect
        self.btn_problems.clicked.connect(lambda: self.switch_view(0))
        self.btn_output.clicked.connect(lambda: self.switch_view(1))
        self.btn_debug.clicked.connect(lambda: self.switch_view(2))
        self.btn_terminal.clicked.connect(lambda: self.switch_view(3))

        # Default to Terminal
        self.switch_view(3)

    def set_panels(self, problems, output, debug, terminal):
        self._problems_widget = problems
        self._output_widget = output
        self._debug_widget = debug
        self._terminal_widget = terminal
        
        self._stack.addWidget(problems)
        self._stack.addWidget(output)
        self._stack.addWidget(debug)
        self._stack.addWidget(terminal)
        
        # Move terminal controls (QTabBar + actions) into the right controls container
        if hasattr(terminal, "get_toolbar"):
            toolbar = terminal.get_toolbar()
            self.right_layout.addWidget(toolbar)

    def switch_view(self, index: int):
        self._stack.setCurrentIndex(index)
        
        self.btn_problems.setChecked(index == 0)
        self.btn_output.setChecked(index == 1)
        self.btn_debug.setChecked(index == 2)
        self.btn_terminal.setChecked(index == 3)
        
        # Only show terminal toolbar when Terminal is active
        self.right_controls.setVisible(index == 3)

    def set_active_view(self, name: str):
        mapping = {"problems": 0, "output": 1, "debug": 2, "terminal": 3}
        if name in mapping:
            self.switch_view(mapping[name])
            self.show()

    def current_view_name(self):
        idx = self._stack.currentIndex()
        if idx == 0: return "problems"
        if idx == 1: return "output"
        if idx == 2: return "debug"
        if idx == 3: return "terminal"
        return ""
