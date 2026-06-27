from PySide6.QtWidgets import (QWidget, QVBoxLayout, QScrollArea, 
                               QPushButton, QHBoxLayout, QTextEdit, QLabel)
from PySide6.QtCore import Qt
from .kernel_client import KernelClient

class NotebookCell(QWidget):
    def __init__(self, cell_type: str = "code", content: str = "", parent=None):
        super().__init__(parent)
        self.cell_type = cell_type # "code" or "markdown"
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(5, 5, 5, 5)
        
        # Toolbar
        toolbar = QHBoxLayout()
        self.type_label = QLabel("Code" if cell_type == "code" else "Markdown")
        self.btn_run = QPushButton("▶ Run")
        toolbar.addWidget(self.type_label)
        toolbar.addStretch()
        toolbar.addWidget(self.btn_run)
        
        # Input (In a real app, this would be a Monaco Editor instance)
        self.editor = QTextEdit()
        self.editor.setPlainText(content)
        self.editor.setMaximumHeight(150)
        
        # Output
        self.output_area = QTextEdit()
        self.output_area.setReadOnly(True)
        self.output_area.hide()
        
        layout.addLayout(toolbar)
        layout.addWidget(self.editor)
        layout.addWidget(self.output_area)
        
        self.setStyleSheet("""
            NotebookCell {
                border: 1px solid #454545;
                border-radius: 4px;
                background: #1e1e1e;
                margin-bottom: 10px;
            }
            QTextEdit {
                background: #252526;
                color: #d4d4d4;
                border: none;
            }
        """)

from PySide6.QtCore import Qt, Signal

class NotebookEditor(QWidget):
    """Editor for .ipynb files."""
    
    content_changed = Signal(str)
    save_requested = Signal()
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._file_path = ""
        self._is_dirty = False
        
        self.kernel = KernelClient()
        self.kernel.start()
        
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        
        # Toolbar
        tb_layout = QHBoxLayout()
        self.btn_add_code = QPushButton("+ Code")
        self.btn_add_md = QPushButton("+ Markdown")
        self.btn_interrupt = QPushButton("⏹ Interrupt")
        tb_layout.addWidget(self.btn_add_code)
        tb_layout.addWidget(self.btn_add_md)
        tb_layout.addWidget(self.btn_interrupt)
        tb_layout.addStretch()
        main_layout.addLayout(tb_layout)
        
        # Cells Area
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.cells_container = QWidget()
        self.cells_layout = QVBoxLayout(self.cells_container)
        self.cells_layout.setAlignment(Qt.AlignTop)
        
        self.scroll.setWidget(self.cells_container)
        main_layout.addWidget(self.scroll)
        
        self.btn_add_code.clicked.connect(lambda: self.add_cell("code"))
        self.btn_add_md.clicked.connect(lambda: self.add_cell("markdown"))
        self.btn_interrupt.clicked.connect(self.kernel.interrupt)

    def add_cell(self, cell_type: str, content: str = ""):
        cell = NotebookCell(cell_type, content)
        
        if cell_type == "code":
            cell.btn_run.clicked.connect(lambda: self.run_cell(cell))
            
        self.cells_layout.addWidget(cell)
        return cell

    def run_cell(self, cell: NotebookCell):
        code = cell.editor.toPlainText()
        cell.output_area.clear()
        cell.output_area.show()
        
        def handle_output(msg):
            msg_type = msg.get("msg_type")
            content = msg.get("content", {})
            if msg_type == "stream":
                text = cell.output_area.toPlainText() + content.get("text", "")
                cell.output_area.setPlainText(text)
            elif msg_type == "error":
                text = cell.output_area.toPlainText() + content.get("evalue", "") + "\n"
                cell.output_area.setPlainText(text)
                
        self.kernel.execute_code(code, handle_output)

    def load_ipynb(self, file_path: str):
        import json
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            for cell_data in data.get("cells", []):
                cell_type = cell_data.get("cell_type", "code")
                source = "".join(cell_data.get("source", []))
                self.add_cell(cell_type, source)
        except Exception as e:
            self.add_cell("markdown", f"# Error loading notebook\n{e}")

    def get_file_path(self):
        return self._file_path

    def is_dirty(self):
        return self._is_dirty

    def get_language(self):
        return "jupyter"

    def save(self):
        # Dummy save for now
        self._is_dirty = False

    def save_as(self, path):
        self._file_path = path
        self._is_dirty = False
