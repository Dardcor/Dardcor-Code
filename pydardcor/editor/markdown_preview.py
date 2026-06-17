import os
import re
from PySide6.QtWidgets import QWidget, QVBoxLayout
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtCore import QTimer, Signal, QUrl

try:
    import mistune
    HAS_MISTUNE = True
except ImportError:
    HAS_MISTUNE = False

class MarkdownPreviewWidget(QWidget):
    """
    VS Code-style Markdown Preview widget for Dardcor Code.
    Renders markdown files with a dark purple theme and auto-updates on file changes.
    """
    scroll_synced = Signal(float)

    def __init__(self, file_path=None, parent=None):
        super().__init__(parent)
        self.file_path = file_path
        self._last_mtime = 0
        
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        
        self.web_view = QWebEngineView(self)
        self.layout.addWidget(self.web_view)
        
        # Setup file watching timer for auto-refresh
        self.refresh_timer = QTimer(self)
        self.refresh_timer.timeout.connect(self.check_file_changes)
        self.refresh_timer.start(1000) # Check every 1 second
        
        # Basic scroll tracking
        self.web_view.page().scrollPositionChanged.connect(self._on_scroll_position_changed)
        
        if self.file_path:
            self.load_file(self.file_path)

    def _on_scroll_position_changed(self, pos):
        # QPointF from scrollPositionChanged, emitting Y coordinate
        self.scroll_synced.emit(pos.y())

    def load_file(self, file_path):
        self.file_path = file_path
        if os.path.exists(file_path):
            self._last_mtime = os.path.getmtime(file_path)
            self.update_preview()

    def check_file_changes(self):
        if self.file_path and os.path.exists(self.file_path):
            current_mtime = os.path.getmtime(self.file_path)
            if current_mtime > self._last_mtime:
                self._last_mtime = current_mtime
                self.update_preview()

    def update_preview(self):
        if not self.file_path or not os.path.exists(self.file_path):
            return
            
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            content = f"**Error reading file:** {e}"
            
        html_content = self._render_markdown(content)
        styled_html = self._apply_theme(html_content)
        
        # Allow relative images and links to work by setting baseUrl
        base_url = QUrl.fromLocalFile(os.path.dirname(self.file_path) + "/")
        self.web_view.setHtml(styled_html, base_url)

    def _render_markdown(self, text):
        if HAS_MISTUNE:
            try:
                # Use mistune for proper rendering
                markdown = mistune.create_markdown(plugins=['strikethrough', 'footnotes', 'table', 'url'])
                return markdown(text)
            except Exception:
                pass # Fallback to basic regex if mistune fails
                
        # Basic regex fallback if mistune is not installed
        html = text
        html = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', html)
        html = re.sub(r'\*(.*?)\*', r'<i>\1</i>', html)
        html = re.sub(r'^# (.*?)$', r'<h1>\1</h1>', html, flags=re.MULTILINE)
        html = re.sub(r'^## (.*?)$', r'<h2>\1</h2>', html, flags=re.MULTILINE)
        html = re.sub(r'^### (.*?)$', r'<h3>\1</h3>', html, flags=re.MULTILINE)
        html = re.sub(r'`(.*?)`', r'<code>\1</code>', html)
        html = html.replace('\n\n', '<br><br>')
        return html

    def _apply_theme(self, html_content):
        # Dark purple theme matching Dardcor Code's aesthetic
        css = """
        <style>
            :root {
                --bg-color: #1e1b2e;
                --text-color: #d4d4d4;
                --accent-color: #b4a4f4;
                --border-color: #3b3259;
                --code-bg: #2d2844;
            }
            body {
                background-color: var(--bg-color);
                color: var(--text-color);
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                padding: 20px;
                line-height: 1.6;
                margin: 0;
            }
            h1, h2, h3, h4, h5, h6 {
                color: var(--accent-color);
                border-bottom: 1px solid var(--border-color);
                padding-bottom: 5px;
                margin-top: 24px;
                margin-bottom: 16px;
                font-weight: 600;
            }
            a { color: #8e7cc3; text-decoration: none; }
            a:hover { text-decoration: underline; }
            code {
                background-color: var(--code-bg);
                padding: 2px 4px;
                border-radius: 4px;
                font-family: Consolas, monospace;
                font-size: 0.9em;
            }
            pre {
                background-color: var(--code-bg);
                padding: 16px;
                border-radius: 6px;
                overflow-x: auto;
                border: 1px solid var(--border-color);
            }
            pre code {
                background-color: transparent;
                padding: 0;
                font-size: 0.9em;
            }
            blockquote {
                border-left: 4px solid var(--accent-color);
                margin: 0;
                padding: 0 16px;
                color: #a098c0;
                background-color: rgba(45, 40, 68, 0.3);
            }
            table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
            th, td { border: 1px solid var(--border-color); padding: 8px 12px; text-align: left; }
            th { background-color: var(--code-bg); color: var(--accent-color); }
            img { max-width: 100%; }
        </style>
        """
        
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            {css}
        </head>
        <body>
            {html_content}
        </body>
        </html>
        """