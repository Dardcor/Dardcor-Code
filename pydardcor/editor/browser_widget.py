from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLineEdit, QPushButton, QLabel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtCore import QUrl, Qt
from PySide6.QtGui import QIcon

class BrowserWidget(QWidget):
    """
    A simple web browser widget to display localhost or web pages inside the editor.
    """
    def __init__(self, url=None, parent=None, controlled_by_ai: bool = False):
        super().__init__(parent)
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)
        
        # Navigation Bar
        self.nav_bar = QWidget()
        self.nav_bar.setFixedHeight(30)
        self.nav_bar.setStyleSheet("background-color: #1a0033; border-bottom: 1px solid #3c0068;")
        nav_layout = QHBoxLayout(self.nav_bar)
        nav_layout.setContentsMargins(5, 0, 5, 0)
        nav_layout.setSpacing(5)
        
        self.btn_back = QPushButton("◀")
        self.btn_forward = QPushButton("▶")
        self.btn_reload = QPushButton("↻")
        
        for btn in [self.btn_back, self.btn_forward, self.btn_reload]:
            btn.setFixedSize(24, 24)
            btn.setStyleSheet("QPushButton { background: transparent; color: #cccccc; border: none; font-size: 14px;} QPushButton:hover { background: #2c004a; border-radius: 3px; }")
            nav_layout.addWidget(btn)
            
        self.url_bar = QLineEdit()
        self.url_bar.setStyleSheet("background-color: #0d0d0d; color: #cccccc; border: 1px solid #3c0068; border-radius: 4px; padding: 2px 5px;")
        nav_layout.addWidget(self.url_bar)
        self.layout.addWidget(self.nav_bar)

        if controlled_by_ai:
            self.ai_banner = QLabel("This browser is controlled by AI")
            self.ai_banner.setFixedHeight(24)
            self.ai_banner.setAlignment(Qt.AlignCenter)
            self.ai_banner.setStyleSheet(
                "background:#3c0068;color:#fff;font-size:12px;font-weight:600;"
                "border-bottom:1px solid #5a009c;"
            )
            self.layout.addWidget(self.ai_banner)
        
        # Web View
        self.web_view = QWebEngineView(self)
        self.layout.addWidget(self.web_view)
        
        # Connections
        self.btn_back.clicked.connect(self.web_view.back)
        self.btn_forward.clicked.connect(self.web_view.forward)
        self.btn_reload.clicked.connect(self.web_view.reload)
        self.url_bar.returnPressed.connect(self._load_url_from_bar)
        self.web_view.urlChanged.connect(self._update_url_bar)
        
        if url:
            self.load_url(url)

    def _load_url_from_bar(self):
        url_text = self.url_bar.text()
        if not url_text.startswith("http://") and not url_text.startswith("https://"):
            url_text = "http://" + url_text
        self.load_url(url_text)
        
    def _update_url_bar(self, qurl):
        self.url_bar.setText(qurl.toString())

    def load_url(self, url: str):
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "http://" + url
        self.web_view.setUrl(QUrl(url))
        self.url_bar.setText(url)
        
    def get_file_path(self):
        return ""
        
    def is_dirty(self):
        return False
        
    def get_language(self):
        return "browser"
