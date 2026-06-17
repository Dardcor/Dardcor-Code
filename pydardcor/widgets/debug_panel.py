from PySide6.QtWidgets import (QWidget, QVBoxLayout, QTreeWidget, 
                               QTreeWidgetItem, QLabel, QSplitter)
from PySide6.QtCore import Qt

class DebugPanel(QWidget):
    """Debug panel showing Variables, Watch, Call Stack, and Breakpoints."""

    def __init__(self, parent=None):
        super().__init__(parent)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        self.splitter = QSplitter(Qt.Vertical)
        
        # Variables View
        self.variables_tree = QTreeWidget()
        self.variables_tree.setHeaderLabels(["Variables", "Value"])
        self._add_section_header("VARIABLES", self.variables_tree)
        
        # Watch View
        self.watch_tree = QTreeWidget()
        self.watch_tree.setHeaderLabels(["Watch"])
        self._add_section_header("WATCH", self.watch_tree)
        
        # Call Stack View
        self.callstack_tree = QTreeWidget()
        self.callstack_tree.setHeaderLabels(["Call Stack"])
        self._add_section_header("CALL STACK", self.callstack_tree)
        
        # Breakpoints View
        self.breakpoints_tree = QTreeWidget()
        self.breakpoints_tree.setHeaderLabels(["Breakpoints"])
        self._add_section_header("BREAKPOINTS", self.breakpoints_tree)
        
        self.splitter.addWidget(self.variables_tree)
        self.splitter.addWidget(self.watch_tree)
        self.splitter.addWidget(self.callstack_tree)
        self.splitter.addWidget(self.breakpoints_tree)
        
        layout.addWidget(self.splitter)

    def _add_section_header(self, title: str, tree: QTreeWidget):
        # We use tree widgets to act as the section container
        # Real implementation would use QToolBox or collapsible sections
        pass

    def update_variables(self, variables: list):
        self.variables_tree.clear()
        for var in variables:
            item = QTreeWidgetItem([var.get("name", ""), var.get("value", "")])
            self.variables_tree.addTopLevelItem(item)

    def update_callstack(self, stack_frames: list):
        self.callstack_tree.clear()
        for frame in stack_frames:
            name = frame.get("name", "Unknown")
            line = frame.get("line", "?")
            item = QTreeWidgetItem([f"{name} (Line {line})"])
            self.callstack_tree.addTopLevelItem(item)
