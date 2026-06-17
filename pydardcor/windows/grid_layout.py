from PySide6.QtWidgets import QSplitter, QWidget, QVBoxLayout
from PySide6.QtCore import Qt

class GridNode(QSplitter):
    """A node in the grid layout, either horizontal or vertical."""
    
    def __init__(self, orientation=Qt.Horizontal, parent=None):
        super().__init__(orientation, parent)
        self.setChildrenCollapsible(False)
        self.setOpaqueResize(False)
        self.setStyleSheet("""
            QSplitter::handle {
                background: #2b2b2b;
            }
            QSplitter::handle:hover {
                background: #007acc;
            }
        """)

    def split_widget(self, widget: QWidget, new_widget: QWidget, orientation: Qt.Orientation):
        """Splits the space of an existing widget with a new widget."""
        index = self.indexOf(widget)
        if index == -1:
            return False
            
        if self.orientation() == orientation:
            # We can just insert it in the current splitter
            self.insertWidget(index + 1, new_widget)
        else:
            # We need to create a new sub-splitter
            sizes = self.sizes()
            sub_splitter = GridNode(orientation, self)
            
            # Replace widget with sub_splitter
            widget.setParent(None)
            sub_splitter.addWidget(widget)
            sub_splitter.addWidget(new_widget)
            
            self.insertWidget(index, sub_splitter)
            self.setSizes(sizes)
            
        return True

class GridLayoutSystem(QWidget):
    """Root of the grid layout system."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        
        self.root_node = GridNode(Qt.Horizontal)
        self.layout.addWidget(self.root_node)

    def set_central_widget(self, widget: QWidget):
        """Sets the initial central widget (e.g., the first editor group)."""
        # Clear existing
        while self.root_node.count():
            w = self.root_node.widget(0)
            w.setParent(None)
            
        self.root_node.addWidget(widget)

    def split(self, source_widget: QWidget, new_widget: QWidget, direction: str):
        """
        Split a widget in a specific direction.
        direction: 'up', 'down', 'left', 'right'
        """
        # Find the node containing the source_widget
        parent_node = source_widget.parent()
        while parent_node and not isinstance(parent_node, GridNode):
            parent_node = parent_node.parent()
            
        if not parent_node:
            parent_node = self.root_node
            
        orientation = Qt.Vertical if direction in ('up', 'down') else Qt.Horizontal
        
        # If we insert up or left, the new widget comes first
        if direction in ('up', 'left'):
            parent_node.split_widget(source_widget, new_widget, orientation)
            # Swap them since split_widget appends after
            idx1 = parent_node.indexOf(source_widget)
            idx2 = parent_node.indexOf(new_widget)
            # In Qt, QSplitter doesn't have a direct swap, we have to insert
            parent_node.insertWidget(idx1, new_widget)
        else:
            parent_node.split_widget(source_widget, new_widget, orientation)
