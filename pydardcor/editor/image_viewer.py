"""Image Viewer - Renders image files (png, jpg, svg, etc) in an editor tab."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QLabel, QScrollArea, QHBoxLayout
)
from PySide6.QtGui import QPixmap, QImage, QPainter
from PySide6.QtCore import Qt, QSize


class ImageViewer(QWidget):
    """Editor tab widget for viewing image files."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._file_path = ""
        self._is_dirty = False
        self._setup_ui()
        
    def _setup_ui(self):
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)
        
        self.setStyleSheet("background-color: #1e1e1e;")
        
        # Centered image display with scroll area
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setStyleSheet("QScrollArea { border: none; }")
        
        container = QWidget()
        container_layout = QVBoxLayout(container)
        container_layout.setAlignment(Qt.AlignCenter)
        
        self.image_label = QLabel()
        self.image_label.setAlignment(Qt.AlignCenter)
        
        container_layout.addWidget(self.image_label)
        self.scroll_area.setWidget(container)
        
        self.layout.addWidget(self.scroll_area)
        
        # Info bar at the bottom
        self.info_bar = QWidget()
        self.info_bar.setFixedHeight(30)
        self.info_bar.setStyleSheet("background-color: #000000; border-top: 1px solid #333333;")
        info_layout = QHBoxLayout(self.info_bar)
        info_layout.setContentsMargins(16, 0, 16, 0)
        
        self.size_label = QLabel()
        self.size_label.setStyleSheet("color: #858585; font-size: 11px;")
        info_layout.addWidget(self.size_label)
        info_layout.addStretch()
        
        self.layout.addWidget(self.info_bar)

    def load_image(self, file_path: str):
        self._file_path = file_path
        if not os.path.exists(file_path):
            self.image_label.setText("Image not found")
            self.image_label.setStyleSheet("color: #ff5555;")
            return
            
        try:
            pixmap = QPixmap(file_path)
            if pixmap.isNull():
                self.image_label.setText("Invalid image format or corrupted file")
                self.image_label.setStyleSheet("color: #ff5555;")
                return
                
            self.image_label.setPixmap(pixmap)
            
            # Format file size
            size_bytes = os.path.getsize(file_path)
            if size_bytes < 1024:
                size_str = f"{size_bytes} B"
            elif size_bytes < 1024 * 1024:
                size_str = f"{size_bytes / 1024:.1f} KB"
            else:
                size_str = f"{size_bytes / (1024 * 1024):.2f} MB"
                
            self.size_label.setText(f"{pixmap.width()}x{pixmap.height()} pixels  •  {size_str}")
            
        except Exception as e:
            self.image_label.setText(f"Error loading image: {e}")
            self.image_label.setStyleSheet("color: #ff5555;")

    # Duck-typing for editor tab compatibility
    def get_file_path(self):
        return self._file_path
        
    def is_dirty(self):
        return False
        
    def get_language(self):
        return "image"
        
    def get_content(self):
        return ""
        
    def set_content(self, text: str):
        pass
        
    def save(self):
        pass
        
    def save_as(self, path: str):
        self._file_path = path
