import os
from PySide6.QtWidgets import (
    QWidget, QHBoxLayout, QPushButton, QLabel, 
    QMenu, QSpacerItem, QSizePolicy
)
from PySide6.QtGui import QAction
from PySide6.QtCore import Signal, Qt

def _parse_symbols_from_file(file_path):
    """Read a file and return parsed outline symbols for languages like Python, JS, TS, etc."""
    try:
        from pydardcor.file_explorer.outline_panel import parse_outline_symbols
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return parse_outline_symbols(content, file_path)
    except Exception:
        return []

class BreadcrumbsBar(QWidget):
    """
    VS Code-style Breadcrumbs navigation bar widget.
    Shows clickable file path segments and the current symbol.
    """
    segment_clicked = Signal(str)
    symbol_selected = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_file = None
        self.symbols = []
        self.symbol_btn = None
        
        self.setFixedHeight(24)
        self.setObjectName("BreadcrumbsBar")
        
        self.layout = QHBoxLayout(self)
        self.layout.setContentsMargins(10, 0, 10, 0)
        self.layout.setSpacing(2)
        self.layout.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        
        # Apply strict dark purple theme from Dardcor-Code design system
        self.setStyleSheet("""
            QWidget#BreadcrumbsBar {
                background-color: #000000;
                border-bottom: 1px solid #3c0068;
            }
            QPushButton {
                background: transparent;
                border: none;
                color: #cccccc;
                padding: 2px 4px;
                border-radius: 3px;
                text-align: left;
            }
            QPushButton:hover {
                background-color: #1a0033;
                color: #cccccc;
            }
            QPushButton:pressed {
                background-color: #4a0072;
            }
            QPushButton::menu-indicator {
                image: none;
            }
            QLabel.Separator {
                color: #cccccc;
                font-family: 'codicon';
                padding: 0px 2px;
            }
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #3c0068;
            }
            QMenu::item {
                padding: 4px 24px 4px 8px;
            }
            QMenu::item:selected {
                background-color: #1a0033;
            }
        """)

    def _clear_layout(self):
        """Clears existing path and symbol segments from the layout."""
        self.symbol_btn = None
        while self.layout.count():
            item = self.layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
            elif item.spacerItem():
                pass

    def _add_separator(self):
        """Adds a codicon right chevron separator (>)."""
        sep = QLabel("\ueab4")  # standard codicon chevron-right
        sep.setProperty("class", "Separator")
        self.layout.addWidget(sep)

    def update_breadcrumbs(self, file_path: str, current_line: int = -1):
        """Updates the breadcrumbs bar to reflect the given file path and current line symbol."""
        self.current_file = file_path
        self._clear_layout()
        
        if not file_path:
            return
            
        parts = os.path.normpath(file_path).split(os.sep)
        current_path = ""
        
        # Add file path segments
        for part in parts:
            if not part:
                continue
                
            current_path += part + os.sep
            
            btn = QPushButton(part)
            btn.setCursor(Qt.PointingHandCursor)
            
            # Use default argument binding to lock the current_path value
            btn.clicked.connect(lambda checked=False, p=current_path: self.segment_clicked.emit(p))
            self.layout.addWidget(btn)
            
            self._add_separator()
            
        # Parse symbols for the file
        self.symbols = _parse_symbols_from_file(file_path)
        
        # Add symbol segment at the end
        self.symbol_btn = QPushButton("{}")
        self.symbol_btn.setCursor(Qt.PointingHandCursor)
        self.symbol_btn.clicked.connect(self._show_symbol_menu)
        self.layout.addWidget(self.symbol_btn)
        
        # Add spacer to push everything left
        self.layout.addSpacerItem(QSpacerItem(40, 20, QSizePolicy.Expanding, QSizePolicy.Minimum))
        
        # Determine and set the correct active symbol based on line number
        self.update_current_symbol(current_line)

    def update_current_symbol(self, line_number: int):
        """Finds and displays the most relevant symbol based on the line number."""
        if not hasattr(self, "symbol_btn") or self.symbol_btn is None:
            return
            
        if not self.symbols:
            self.symbol_btn.setText("{}")
            self.symbol_btn.setDisabled(True)
            return
            
        self.symbol_btn.setDisabled(False)
        best_symbol = None
        
        def find_best(syms):
            nonlocal best_symbol
            for sym in syms:
                sym_line = sym.get('line', 0)
                if sym_line <= line_number:
                    if not best_symbol or sym_line > best_symbol.get('line', 0):
                        best_symbol = sym
                if sym.get('children'):
                    find_best(sym['children'])
                    
        find_best(self.symbols)
        
        if best_symbol:
            sym_name = best_symbol.get('name', '{}')
            self.symbol_btn.setText(sym_name)
        else:
            self.symbol_btn.setText("{}")

    def _show_symbol_menu(self):
        """Shows a dropdown menu with all parsed symbols for the current file."""
        if not self.symbols:
            return
            
        menu = QMenu(self)
        
        def populate_menu(syms, prefix=""):
            for sym in syms:
                sym_name = sym.get('name', 'Unknown')
                sym_line = sym.get('line', 0)
                display_name = f"{prefix}{sym_name}"
                
                action = QAction(display_name, self)
                action.triggered.connect(lambda checked=False, l=sym_line: self.symbol_selected.emit(l))
                menu.addAction(action)
                
                if sym.get('children'):
                    populate_menu(sym['children'], prefix + "  ")
                    
        populate_menu(self.symbols)
        menu.exec(self.symbol_btn.mapToGlobal(self.symbol_btn.rect().bottomLeft()))


    def on_file_changed(self, file_path: str):
        """Slot to handle external file_changed signals and update breadcrumbs."""
        self.update_breadcrumbs(file_path, 0)
