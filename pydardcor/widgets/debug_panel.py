from PySide6.QtWidgets import (QWidget, QVBoxLayout, QTreeWidget, 
                               QTreeWidgetItem, QPushButton, QScrollArea)
from PySide6.QtCore import Qt

class CollapsibleSection(QWidget):
    def __init__(self, title, content_widget):
        super().__init__()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        self.toggle_btn = QPushButton(title)
        self.toggle_btn.setStyleSheet("""
            QPushButton {
                text-align: left;
                padding: 4px;
                background-color: #2c2c2c;
                color: #cccccc;
                border: none;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #3c3c3c;
            }
        """)
        self.toggle_btn.clicked.connect(self.toggle_content)
        
        self.content = content_widget
        self.is_expanded = True
        
        layout.addWidget(self.toggle_btn)
        layout.addWidget(self.content)
        
    def toggle_content(self):
        self.is_expanded = not self.is_expanded
        self.content.setVisible(self.is_expanded)

class DebugPanel(QWidget):
    """Debug panel showing Variables, Watch, Call Stack, and Breakpoints."""

    def __init__(self, parent=None):
        super().__init__(parent)
        
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setStyleSheet("QScrollArea { border: none; }")
        
        self.container = QWidget()
        self.layout = QVBoxLayout(self.container)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(1)
        
        # Variables View
        self.variables_tree = QTreeWidget()
        self.variables_tree.setHeaderLabels(["Variables", "Value"])
        self.layout.addWidget(CollapsibleSection("▼ VARIABLES", self.variables_tree))
        
        # Watch View
        self.watch_tree = QTreeWidget()
        self.watch_tree.setHeaderLabels(["Watch"])
        self.layout.addWidget(CollapsibleSection("▼ WATCH", self.watch_tree))
        
        # Call Stack View
        self.callstack_tree = QTreeWidget()
        self.callstack_tree.setHeaderLabels(["Call Stack"])
        self.layout.addWidget(CollapsibleSection("▼ CALL STACK", self.callstack_tree))
        
        # Breakpoints View
        self.breakpoints_tree = QTreeWidget()
        self.breakpoints_tree.setHeaderLabels(["Breakpoints"])
        self.layout.addWidget(CollapsibleSection("▼ BREAKPOINTS", self.breakpoints_tree))
        
        self.layout.addStretch()
        
        self.scroll.setWidget(self.container)
        main_layout.addWidget(self.scroll)

    def update_variables(self, variables: list):
        self.variables_tree.clear()
        for var in variables:
            item = QTreeWidgetItem([var.get("name", ""), str(var.get("value", ""))])
            self.variables_tree.addTopLevelItem(item)

    def update_callstack(self, stack_frames: list):
        self.callstack_tree.clear()
        for frame in stack_frames:
            name = frame.get("name", "Unknown")
            line = frame.get("line", "?")
            item = QTreeWidgetItem([f"{name} (Line {line})"])
            self.callstack_tree.addTopLevelItem(item)
