from PySide6.QtWidgets import QWidget, QHBoxLayout, QPushButton
from PySide6.QtCore import Qt, Signal

class DebugToolbar(QWidget):
    """Floating toolbar for debugging actions (Continue, Step, Stop)."""
    
    action_requested = Signal(str) # Emits 'continue', 'next', 'stepIn', 'stepOut', 'pause', 'disconnect'

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(5, 5, 5, 5)
        layout.setSpacing(5)
        
        # In a real implementation, these would have icons
        self.btn_continue = QPushButton("▶ Continue")
        self.btn_next = QPushButton("⏭ Step Over")
        self.btn_step_in = QPushButton("⬇ Step Into")
        self.btn_step_out = QPushButton("⬆ Step Out")
        self.btn_pause = QPushButton("⏸ Pause")
        self.btn_stop = QPushButton("⏹ Stop")
        
        self.btn_continue.clicked.connect(lambda: self.action_requested.emit("continue"))
        self.btn_next.clicked.connect(lambda: self.action_requested.emit("next"))
        self.btn_step_in.clicked.connect(lambda: self.action_requested.emit("stepIn"))
        self.btn_step_out.clicked.connect(lambda: self.action_requested.emit("stepOut"))
        self.btn_pause.clicked.connect(lambda: self.action_requested.emit("pause"))
        self.btn_stop.clicked.connect(lambda: self.action_requested.emit("disconnect"))
        
        layout.addWidget(self.btn_continue)
        layout.addWidget(self.btn_next)
        layout.addWidget(self.btn_step_in)
        layout.addWidget(self.btn_step_out)
        layout.addWidget(self.btn_pause)
        layout.addWidget(self.btn_stop)
        
        self.setStyleSheet("""
            DebugToolbar {
                background-color: #252526;
                border: 1px solid #454545;
                border-radius: 4px;
            }
            QPushButton {
                background-color: transparent;
                border: none;
                color: #cccccc;
                padding: 4px 8px;
            }
            QPushButton:hover {
                background-color: #3d3d3d;
                border-radius: 2px;
            }
        """)

    def set_state(self, is_paused: bool):
        """Update button states based on whether the debugger is paused."""
        self.btn_continue.setEnabled(is_paused)
        self.btn_next.setEnabled(is_paused)
        self.btn_step_in.setEnabled(is_paused)
        self.btn_step_out.setEnabled(is_paused)
        self.btn_pause.setEnabled(not is_paused)
