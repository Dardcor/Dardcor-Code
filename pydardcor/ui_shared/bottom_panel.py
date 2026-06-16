"""Bottom Panel - Unified container for Problems, Output, Debug, Terminal."""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QStackedWidget, QSplitter
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont

class BottomPanelButton(QPushButton):
    def __init__(self, text, parent=None):
        super().__init__(text, parent)
        self.setFixedHeight(35)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                background: transparent;
                color: #969696;
                border: none;
                border-bottom: 2px solid transparent;
                padding: 0px 16px;
                font-family: "Segoe UI", sans-serif;
                font-size: 11px;
                font-weight: 600;
            }
            QPushButton:hover {
                color: #e7e7e7;
            }
            QPushButton:checked {
                color: #ffffff;
                border-bottom: 2px solid #3c0068; /* Purple accent */
            }
        """)
        self.setCheckable(True)

class BottomPanel(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("bottomPanel")
        self.setStyleSheet("background-color: #000000;")
        
        self._problems_widget = None
        self._output_widget = None
        self._debug_widget = None
        self._terminal_widget = None
        self._is_maximized = False
        self._prev_sizes = None
        
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header bar styled like VS Code
        self.header = QWidget()
        self.header.setFixedHeight(35)
        self.header.setStyleSheet("""
            background-color: #000000;
            border-bottom: 1px solid #000000;
        """)
        self.header_layout = QHBoxLayout(self.header)
        self.header_layout.setContentsMargins(0, 0, 4, 0)
        self.header_layout.setSpacing(0)

        # Left tabs (Uppercase like VS Code)
        self.tabs_container = QWidget()
        self.tabs_layout = QHBoxLayout(self.tabs_container)
        self.tabs_layout.setContentsMargins(0, 0, 0, 0)
        self.tabs_layout.setSpacing(0)
        
        self.btn_problems = BottomPanelButton("PROBLEMS")
        self.btn_problems.setObjectName("btnProblems")
        self.btn_output = BottomPanelButton("OUTPUT")
        self.btn_output.setObjectName("btnOutput")
        self.btn_debug = BottomPanelButton("DEBUG CONSOLE")
        self.btn_debug.setObjectName("btnDebugConsole")
        self.btn_terminal = BottomPanelButton("TERMINAL")
        self.btn_terminal.setObjectName("btnTerminal")
        
        self.tabs_layout.addWidget(self.btn_problems)
        self.tabs_layout.addWidget(self.btn_output)
        self.tabs_layout.addWidget(self.btn_debug)
        self.tabs_layout.addWidget(self.btn_terminal)
        
        self.header_layout.addWidget(self.tabs_container)
        self.header_layout.addStretch(1) # push terminal controls and actions to the right
        
        # Right controls container (will hold terminal toolbar)
        self.right_controls = QWidget()
        self.right_layout = QHBoxLayout(self.right_controls)
        self.right_layout.setContentsMargins(0, 0, 0, 0)
        self.right_layout.setSpacing(0)
        self.header_layout.addWidget(self.right_controls)

        # Add maximize button
        self.btn_maximize = QPushButton("\ueaaf") # chevron-up (maximize)
        self.btn_maximize.setFont(QFont("codicon", 14))
        self.btn_maximize.setFixedSize(28, 28)
        self.btn_maximize.setToolTip("Maximize Panel Size")
        self.btn_maximize.setStyleSheet("""
            QPushButton {
                background: transparent; border: none;
                color: #cccccc; font-size: 14px;
                font-family: "codicon";
                border-radius: 3px;
                padding: 0px; /* Override global QPushButton padding */
            }
            QPushButton:hover {
                background-color: rgba(90,93,94,0.31);
            }
        """)
        self.btn_maximize.clicked.connect(self._toggle_maximize)
        self.header_layout.addWidget(self.btn_maximize)

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
                padding: 0px; /* Override global QPushButton padding */
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

    def _toggle_maximize(self):
        self._is_maximized = not self._is_maximized
        if self._is_maximized:
            self.btn_maximize.setText("\ueaab") # chevron-down (restore)
            self.btn_maximize.setToolTip("Restore Panel Size")
        else:
            self.btn_maximize.setText("\ueaaf") # chevron-up (maximize)
            self.btn_maximize.setToolTip("Maximize Panel Size")
            
        parent_splitter = self.parent()
        if isinstance(parent_splitter, QSplitter):
            editor_container = parent_splitter.widget(0)
            if self._is_maximized:
                # Save previous sizes before hiding
                self._prev_sizes = parent_splitter.sizes()
                if editor_container:
                    editor_container.hide()
            else:
                if editor_container:
                    editor_container.show()
                # Restore previous sizes
                if self._prev_sizes:
                    parent_splitter.setSizes(self._prev_sizes)
                else:
                    parent_splitter.setSizes([600, 250])

    def hideEvent(self, event):
        # Restore editor container visibility if panel is closed/hidden while maximized
        if self._is_maximized:
            self._toggle_maximize()
        super().hideEvent(event)
