import os
import re
import json
import base64
import datetime
import webbrowser
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
                               QFileDialog, QMessageBox, QSplitter, QTextEdit,
                               QApplication, QDialog, QFrame)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtCore import QTimer, Signal, QUrl, QObject, Slot, Qt
from PySide6.QtGui import QKeySequence, QShortcut, QDesktopServices, QFont

try:
    import mistune
    HAS_MISTUNE = True
except ImportError:
    HAS_MISTUNE = False

EMOJI_MAP = {
    ":smile:": "\U0001F60A", ":laughing:": "\U0001F606", ":wink:": "\U0001F609",
    ":heart:": "\u2764\uFE0F", ":star:": "\u2B50", ":fire:": "\U0001F525",
    ":+1:": "\U0001F44D", ":-1:": "\U0001F44E", ":clap:": "\U0001F44F",
    ":tada:": "\U0001F389", ":rocket:": "\U0001F680", ":check:": "\u2705",
    ":warning:": "\u26A0\uFE0F", ":question:": "\u2753", ":info:": "\u2139\uFE0F",
    ":bug:": "\U0001F41B", ":book:": "\U0001F4D6", ":pencil:": "\u270F\uFE0F",
    ":link:": "\U0001F517", ":email:": "\U0001F4E7", ":page:": "\U0001F4C4",
    ":folder:": "\U0001F4C1", ":file:": "\U0001F4C4", ":calendar:": "\U0001F4C5",
    ":clock:": "\U0001F550", ":lock:": "\U0001F512", ":key:": "\U0001F511",
    ":bulb:": "\U0001F4A1", ":gear:": "\u2699\uFE0F", ":hammer:": "\U0001F528",
    ":wrench:": "\U0001F527", ":microscope:": "\U0001F52C", ":telescope:": "\U0001F52D",
    ":computer:": "\U0001F4BB", ":phone:": "\U0001F4F1", ":globe:": "\U0001F310",
    ":x:": "\u274C", ":100:": "\U0001F4AF", ":chart:": "\U0001F4CA",
    ":wave:": "\U0001F44B", ":ok:": "\U0001F44C", ":muscle:": "\U0001F4AA",
    ":pray:": "\U0001F64F", ":eyes:": "\U0001F440", ":zzz:": "\U0001F4A4",
}


class PreviewSyncBridge(QObject):
    scroll_changed = Signal(float)
    link_clicked = Signal(str)
    preview_loaded = Signal()

    @Slot(float)
    def on_preview_scroll(self, scroll_top):
        self.scroll_changed.emit(scroll_top)

    @Slot(str)
    def on_link_clicked(self, url):
        self.link_clicked.emit(url)

    @Slot()
    def on_preview_loaded(self):
        self.preview_loaded.emit()


PREVIEW_QWEBCHANNEL_JS = """
"use strict";
var QWebChannelMessageTypes={signal:1,propertyUpdate:2,init:3,idle:4,debug:5,invokeMethod:6,connectToSignal:7,disconnectFromSignal:8,setProperty:9,response:10};
var QWebChannel=function(transport,initCallback){var channel=this;this.transport=transport;this.transport.onmessage=function(message){var data=message.data;if(typeof data==="string"){try{data=JSON.parse(data)}catch(e){return}}
if(data&&data.type===QWebChannelMessageTypes.response){if(channel.pendingCallbacks&&channel.pendingCallbacks[data.id]){var cb=channel.pendingCallbacks[data.id];delete channel.pendingCallbacks[data.id];cb(data)}}else if(data&&data.type===QWebChannelMessageTypes.signal&&channel.signalHandlers&&channel.signalHandlers[data.signal]){channel.signalHandlers[data.signal].forEach(function(h){h(data.args)})}else if(data&&data.type===QWebChannelMessageTypes.propertyUpdate){channel.onPropertyUpdate(data)}};this.execCallbacks={};this.pendingCallbacks={};this.signalHandlers={};this.objects={};this.onPropertyUpdate=function(data){for(var i in data.properties){var obj=channel.objects[data.object];if(obj){obj.__property__[i]=data.properties[i];if(obj['on'+i.charAt(0).toUpperCase()+i.substr(1)]){obj['on'+i.charAt(0).toUpperCase()+i.substr(1)](data.properties[i])}}}};this.connectToSignal=function(object,signal,handler){if(!channel.signalHandlers[object+'::'+signal]){channel.signalHandlers[object+'::'+signal]=[]}
channel.signalHandlers[object+'::'+signal].push(handler);channel.transport.send(JSON.stringify({type:QWebChannelMessageTypes.connectToSignal,object:object,signal:signal}))};this.exec=function(object,method,args,responseCallback){if(responseCallback){var requestId=String(Math.random()).slice(2);channel.pendingCallbacks[requestId]=responseCallback;channel.transport.send(JSON.stringify({type:QWebChannelMessageTypes.invokeMethod,object:object,method:method,args:args,id:requestId}))}else{channel.transport.send(JSON.stringify({type:QWebChannelMessageTypes.invokeMethod,object:object,method:method,args:args}))}};this.transport.send(JSON.stringify({type:QWebChannelMessageTypes.init}));if(initCallback){initCallback(channel)}
var initInterval=setInterval(function(){if(channel.objects&&Object.keys(channel.objects).length>0){clearInterval(initInterval);if(initCallback)initCallback(channel)}},50)}
QWebChannel.prototype=Object.create(QWebChannel.prototype);
"""

MARKDOWN_PREVIEW_CSS = """
<style>
    :root {
        --bg-color: #1e1b2e;
        --text-color: #d4d4d4;
        --accent-color: #b4a4f4;
        --border-color: #3b3259;
        --code-bg: #2d2844;
        --toolbar-bg: #1a1a2e;
        --hover-bg: #3c3259;
        --selection-bg: #5a009c;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: var(--bg-color);
        color: var(--text-color);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
    }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: #0a0a0a; }
    ::-webkit-scrollbar-thumb { background: #2c004a; border-radius: 0; }
    ::-webkit-scrollbar-thumb:hover { background: #3c0068; }
    #preview-scroll {
        width: 100%;
        height: 100%;
        overflow-y: auto;
        overflow-x: auto;
        padding: 20px 24px;
    }
    #preview-scroll h1, #preview-scroll h2, #preview-scroll h3,
    #preview-scroll h4, #preview-scroll h5, #preview-scroll h6 {
        color: var(--accent-color);
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 6px;
        margin-top: 24px;
        margin-bottom: 16px;
        font-weight: 600;
        line-height: 1.25;
    }
    #preview-scroll h1 { font-size: 2em; }
    #preview-scroll h2 { font-size: 1.5em; }
    #preview-scroll h3 { font-size: 1.25em; }
    #preview-scroll a { color: #8e7cc3; text-decoration: none; }
    #preview-scroll a:hover { text-decoration: underline; color: #b4a4f4; }
    #preview-scroll code {
        background-color: var(--code-bg);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: Consolas, 'Cascadia Code', monospace;
        font-size: 0.9em;
    }
    #preview-scroll pre {
        background-color: var(--code-bg);
        padding: 16px;
        border-radius: 6px;
        overflow-x: auto;
        border: 1px solid var(--border-color);
        margin: 16px 0;
    }
    #preview-scroll pre code {
        background-color: transparent;
        padding: 0;
        font-size: 0.9em;
        line-height: 1.5;
    }
    #preview-scroll blockquote {
        border-left: 4px solid var(--accent-color);
        margin: 16px 0;
        padding: 8px 16px;
        color: #a098c0;
        background-color: rgba(45, 40, 68, 0.3);
        border-radius: 0 4px 4px 0;
    }
    #preview-scroll table {
        border-collapse: collapse;
        width: 100%;
        margin-bottom: 16px;
        display: block;
        overflow-x: auto;
    }
    #preview-scroll th, #preview-scroll td {
        border: 1px solid var(--border-color);
        padding: 8px 12px;
        text-align: left;
    }
    #preview-scroll th {
        background-color: var(--code-bg);
        color: var(--accent-color);
        font-weight: 600;
    }
    #preview-scroll tr:nth-child(even) { background-color: rgba(45, 40, 68, 0.2); }
    #preview-scroll img {
        max-width: 100%;
        border-radius: 4px;
        margin: 8px 0;
    }
    #preview-scroll ul, #preview-scroll ol {
        padding-left: 24px;
        margin: 8px 0;
    }
    #preview-scroll li { margin: 4px 0; }
    #preview-scroll hr {
        border: none;
        border-top: 1px solid var(--border-color);
        margin: 24px 0;
    }
    #preview-scroll p { margin: 8px 0; }
    #preview-scroll .task-list-item { list-style: none; margin-left: -24px; }
    #preview-scroll .task-list-item input { margin-right: 8px; }
    #preview-scroll .contains-task-list { padding-left: 24px; }

    /* KaTeX */
    .katex-display { margin: 16px 0; overflow-x: auto; overflow-y: hidden; }
    .katex { font-size: 1.1em; }

    /* Mermaid */
    .mermaid {
        text-align: center;
        margin: 16px 0;
        padding: 8px;
        background: rgba(45, 40, 68, 0.3);
        border-radius: 6px;
    }

    /* Footnotes */
    #preview-scroll .footnote-ref { font-size: 0.85em; vertical-align: super; }
    #preview-scroll .footnotes { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border-color); }
    #preview-scroll .footnotes ol { font-size: 0.9em; }

    /* Highlight */
    #preview-scroll mark {
        background-color: #594f8d;
        color: #fff;
        padding: 1px 4px;
        border-radius: 3px;
    }
</style>
"""


class MarkdownPreviewWidget(QWidget):
    scroll_synced = Signal(float)

    def __init__(self, file_path=None, parent=None, editor=None):
        super().__init__(parent)
        self.file_path = file_path
        self.editor = editor
        self._last_mtime = 0
        self._auto_preview = True
        self._source_visible = False
        self._scripts_enabled = False
        self._scroll_sync_enabled = True
        self._preview_content = ""
        self._is_scrolling_programmatically = False

        self._setup_ui()
        self._setup_shortcuts()

        if self.file_path:
            self.load_file(self.file_path)

        if editor and hasattr(editor, 'content_changed'):
            editor.content_changed.connect(self._on_editor_content_changed)

        if editor and hasattr(editor, '_bridge') and editor._bridge:
            try:
                editor._bridge.editor_scroll_changed.connect(self._on_editor_scroll_changed)
            except AttributeError:
                pass

        self.refresh_timer = QTimer(self)
        self.refresh_timer.timeout.connect(self.check_file_changes)
        self.refresh_timer.start(1000)

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._build_toolbar()

        self.splitter = QSplitter()
        self.splitter.setHandleWidth(2)
        self.splitter.setStyleSheet("QSplitter::handle { background-color: #3b3259; }")

        self.source_edit = QTextEdit()
        self.source_edit.setReadOnly(True)
        self.source_edit.setFont(QFont("Consolas", 12))
        self.source_edit.setStyleSheet("""
            QTextEdit {
                background-color: #1e1b2e;
                color: #d4d4d4;
                font-family: Consolas, 'Cascadia Code', monospace;
                font-size: 13px;
                border: none;
                padding: 8px;
            }
        """)
        self.source_edit.setVisible(False)

        self.web_view = QWebEngineView(self)
        wv_settings = self.web_view.page().profile().settings()
        wv_settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        wv_settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        wv_settings.setAttribute(QWebEngineSettings.JavascriptEnabled, True)
        wv_settings.setAttribute(QWebEngineSettings.JavascriptCanOpenWindows, False)
        wv_settings.setAttribute(QWebEngineSettings.JavascriptCanAccessClipboard, False)

        from pydardcor.app.theme_manager import ThemeManager
        self.web_view.setZoomFactor(1.1 ** ThemeManager._current_zoom_level)

        self.web_view.page().scrollPositionChanged.connect(self._on_webview_scroll_changed)

        self._sync_bridge = PreviewSyncBridge()
        self._sync_bridge.scroll_changed.connect(self._on_preview_bridge_scroll)
        self._sync_bridge.link_clicked.connect(self._on_link_clicked)
        self._sync_bridge.preview_loaded.connect(self._on_preview_loaded)

        self._channel = QWebChannel()
        self._channel.registerObject("preview_bridge", self._sync_bridge)
        self.web_view.page().setWebChannel(self._channel)

        self.splitter.addWidget(self.source_edit)
        self.splitter.addWidget(self.web_view)
        layout.addWidget(self.splitter)

    def _build_toolbar(self):
        tw = QWidget()
        tw.setFixedHeight(34)
        tw.setStyleSheet("""
            QWidget#mdToolbar {
                background-color: #1a1a2e;
                border-bottom: 1px solid #3b3259;
            }
            QPushButton {
                background-color: #2d2844;
                color: #d4d4d4;
                border: 1px solid #3b3259;
                border-radius: 3px;
                padding: 2px 7px;
                font-size: 11px;
                min-height: 20px;
                font-family: 'Segoe UI', sans-serif;
            }
            QPushButton:hover {
                background-color: #3c3259;
                border-color: #5a009c;
            }
            QPushButton:pressed, QPushButton:checked {
                background-color: #5a009c;
                border-color: #7b00d6;
            }
            QPushButton:disabled { opacity: 0.4; }
        """)
        tw.setObjectName("mdToolbar")
        tlo = QHBoxLayout(tw)
        tlo.setContentsMargins(6, 2, 6, 2)
        tlo.setSpacing(3)

        def tb(text, tip, handler):
            b = QPushButton(text)
            b.setToolTip(tip)
            b.setFixedWidth(30)
            b.clicked.connect(handler)
            tlo.addWidget(b)
            return b

        self.btn_bold = tb("B", "Bold (Ctrl+B)", lambda: self._insert_md("****", -2))
        self.btn_bold.setStyleSheet("font-weight: bold;")

        self.btn_italic = tb("I", "Italic (Ctrl+I)", lambda: self._insert_md("**", -1))
        self.btn_italic.setStyleSheet("font-style: italic; font-family: serif;")

        sep1 = QFrame(); sep1.setFrameShape(QFrame.VLine); sep1.setStyleSheet("border: none; border-left: 1px solid #3b3259; margin: 2px 4px;"); sep1.setFixedWidth(2)
        tlo.addWidget(sep1)

        self.btn_h1 = tb("H1", "Heading 1", lambda: self._insert_line("# "))
        self.btn_h2 = tb("H2", "Heading 2", lambda: self._insert_line("## "))
        self.btn_h3 = tb("H3", "Heading 3", lambda: self._insert_line("### "))

        sep2 = QFrame(); sep2.setFrameShape(QFrame.VLine); sep2.setStyleSheet("border: none; border-left: 1px solid #3b3259; margin: 2px 4px;"); sep2.setFixedWidth(2)
        tlo.addWidget(sep2)

        self.btn_ul = tb("\u2261", "Bullet List", lambda: self._insert_line("- "))
        self.btn_ol = tb("#", "Numbered List", lambda: self._insert_line("1. "))

        sep3 = QFrame(); sep3.setFrameShape(QFrame.VLine); sep3.setStyleSheet("border: none; border-left: 1px solid #3b3259; margin: 2px 4px;"); sep3.setFixedWidth(2)
        tlo.addWidget(sep3)

        self.btn_link = tb("\uD83D\uDD17", "Insert Link", self._insert_link)
        self.btn_link.setFixedWidth(32)
        self.btn_img = tb("\uD83D\uDDBC", "Insert Image", self._insert_image)
        self.btn_img.setFixedWidth(32)
        self.btn_table = tb("\u229E", "Insert Table", lambda: self._insert_md(
            "\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n", 0
        ))
        self.btn_table.setFixedWidth(32)

        sep4 = QFrame(); sep4.setFrameShape(QFrame.VLine); sep4.setStyleSheet("border: none; border-left: 1px solid #3b3259; margin: 2px 4px;"); sep4.setFixedWidth(2)
        tlo.addWidget(sep4)

        self.btn_code = tb("<>", "Code Block", lambda: self._insert_md("\n```\n\n```\n", -5))
        self.btn_code.setFont(QFont("Consolas", 10))

        tlo.addStretch()

        self.btn_scroll = QPushButton("\u21C5")
        self.btn_scroll.setToolTip("Toggle Scroll Sync")
        self.btn_scroll.setCheckable(True)
        self.btn_scroll.setChecked(self._scroll_sync_enabled)
        self.btn_scroll.setFixedWidth(30)
        self.btn_scroll.toggled.connect(lambda c: setattr(self, '_scroll_sync_enabled', c))
        tlo.addWidget(self.btn_scroll)

        self.btn_auto = QPushButton("Auto")
        self.btn_auto.setToolTip("Toggle Auto Preview")
        self.btn_auto.setCheckable(True)
        self.btn_auto.setChecked(self._auto_preview)
        self.btn_auto.toggled.connect(self._toggle_auto)
        self.btn_auto.setFixedWidth(40)
        tlo.addWidget(self.btn_auto)

        self.btn_source = QPushButton("<>")
        self.btn_source.setToolTip("Toggle Source View")
        self.btn_source.setCheckable(True)
        self.btn_source.toggled.connect(self._toggle_source)
        self.btn_source.setFixedWidth(30)
        tlo.addWidget(self.btn_source)

        self.btn_export = QPushButton("\u21E9")
        self.btn_export.setToolTip("Export to HTML")
        self.btn_export.clicked.connect(self._export_html)
        self.btn_export.setFixedWidth(30)
        tlo.addWidget(self.btn_export)

        self.layout().addWidget(tw)

    def _setup_shortcuts(self):
        QShortcut(QKeySequence("Ctrl+B"), self, lambda: self._insert_md("****", -2))
        QShortcut(QKeySequence("Ctrl+I"), self, lambda: self._insert_md("**", -1))

    def _insert_md(self, wrapper, cursor_offset):
        if not self.editor:
            return
        self.editor.insert_text(wrapper)

    def _insert_line(self, prefix):
        if not self.editor:
            return
        self.editor.insert_text(prefix)

    def _insert_link(self):
        if not self.editor:
            return
        self.editor.insert_text("[link text](url)")

    def _insert_image(self):
        if not self.editor:
            return
        self.editor.insert_text("![alt text](image.png)")

    def _toggle_auto(self, checked):
        self._auto_preview = checked

    def _toggle_source(self, checked):
        self._source_visible = checked
        self.source_edit.setVisible(checked)
        if checked and self._preview_content:
            self.source_edit.setPlainText(self._preview_content)

    def _on_webview_scroll_changed(self, pos):
        if self._is_scrolling_programmatically:
            return
        self.scroll_synced.emit(pos.y())

    def _on_preview_bridge_scroll(self, scroll_top):
        if not self._scroll_sync_enabled or not self.editor:
            return
        if hasattr(self.editor, '_view') and self.editor._view:
            self.editor._view.page().runJavaScript(
                f"editor.setScrollTop({scroll_top});"
            )

    def _on_editor_scroll_changed(self, scroll_top, scroll_left):
        if not self._scroll_sync_enabled:
            return
        self._is_scrolling_programmatically = True
        js = (
            "var el = document.getElementById('preview-scroll');"
            "if (el) {"
            f"  var maxScroll = el.scrollHeight - el.clientHeight;"
            f"  var pct = {scroll_top} / (document.documentElement.scrollHeight || 1);"
            f"  el.scrollTop = pct * maxScroll;"
            "}"
        )
        self.web_view.page().runJavaScript(js)
        QTimer.singleShot(50, lambda: setattr(self, '_is_scrolling_programmatically', False))

    def _on_link_clicked(self, url):
        if url.startswith("http://") or url.startswith("https://"):
            webbrowser.open(url)
        elif url.startswith("file://"):
            QDesktopServices.openUrl(QUrl(url))
        elif url.startswith("#"):
            js = (
                "var el = document.getElementById('preview-scroll');"
                f"var target = document.querySelector('[id=\"{url[1:]}\"]');"
                "if (target && el) { el.scrollTop = target.offsetTop - 20; }"
            )
            self.web_view.page().runJavaScript(js)

    def _on_preview_loaded(self):
        pass

    def _on_editor_content_changed(self, content):
        if not self._auto_preview:
            return
        self._preview_content = content
        self._render_and_display(content)

    def update_live_content(self, content):
        self._preview_content = content
        self._render_and_display(content)

    def load_file(self, file_path):
        self.file_path = file_path
        if os.path.exists(file_path):
            self._last_mtime = os.path.getmtime(file_path)
            self.update_preview()

    def check_file_changes(self):
        if not self._auto_preview:
            return
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
        self._preview_content = content
        self._render_and_display(content)

    def _render_and_display(self, raw_markdown):
        html_body = self._render_markdown(raw_markdown)
        full_html = self._generate_preview_html(html_body)
        if self.file_path:
            base_url = QUrl.fromLocalFile(os.path.dirname(self.file_path) + "/")
        else:
            base_url = QUrl()
        self.web_view.setHtml(full_html, base_url)

        if self._source_visible:
            self.source_edit.setPlainText(raw_markdown)

    def _render_markdown(self, text):
        text = self._replace_emoji(text)
        mermaid_blocks = self._extract_mermaid(text)
        text = mermaid_blocks["text"]
        math_blocks = self._extract_math(text)
        text = math_blocks["text"]

        if HAS_MISTUNE:
            try:
                plugins = ['strikethrough', 'footnotes', 'table', 'url']
                if hasattr(mistune, 'task_lists'):
                    plugins.append('task_lists')
                md = mistune.create_markdown(plugins=plugins)
                html = md(text)
            except Exception:
                html = self._basic_render(text)
        else:
            html = self._basic_render(text)

        html = html.replace(
            '{MERMAID_PLACEHOLDER_START}', '<div class="mermaid">'
        ).replace(
            '{MERMAID_PLACEHOLDER_END}', '</div>'
        )
        for i, block in enumerate(mermaid_blocks["blocks"]):
            html = html.replace(
                f'<p>MERMAID_BLOCK_{i}</p>',
                f'<div class="mermaid">{block}</div>'
            )
        html = html.replace('{MATH_PLACEHOLDER_START}', '$$').replace('{MATH_PLACEHOLDER_END}', '$$')
        for i, block in enumerate(math_blocks["blocks"]):
            html = html.replace(
                f'<p>MATH_BLOCK_{i}</p>',
                block
            )
        return html

    def _replace_emoji(self, text):
        for code, emoji in EMOJI_MAP.items():
            text = text.replace(code, emoji)
        return text

    def _extract_mermaid(self, text):
        blocks = []
        def replacer(m):
            blocks.append(m.group(1).strip())
            return f'\n\n<p>MERMAID_BLOCK_{len(blocks)-1}</p>\n\n'
        new_text = re.sub(
            r'```mermaid\s*\n(.*?)```',
            replacer,
            text,
            flags=re.DOTALL
        )
        return {"text": new_text, "blocks": blocks}

    def _extract_math(self, text):
        blocks = []
        def replacer_display(m):
            blocks.append(m.group(0))
            return f'\n\n<p>MATH_BLOCK_{len(blocks)-1}</p>\n\n'
        new_text = re.sub(r'\$\$(.*?)\$\$', replacer_display, text, flags=re.DOTALL)
        block_count = len(blocks)
        def replacer_inline(m):
            blocks.append(m.group(0))
            return f'<span>MATH_BLOCK_{len(blocks)-1}</span>'
        new_text = re.sub(r'(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)', replacer_inline, new_text)
        return {"text": new_text, "blocks": blocks}

    def _basic_render(self, text):
        html = text
        html = re.sub(r'^### (.*?)$', r'<h3>\1</h3>', html, flags=re.MULTILINE)
        html = re.sub(r'^## (.*?)$', r'<h2>\1</h2>', html, flags=re.MULTILINE)
        html = re.sub(r'^# (.*?)$', r'<h1>\1</h1>', html, flags=re.MULTILINE)
        html = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', html)
        html = re.sub(r'\*(.*?)\*', r'<i>\1</i>', html)
        html = re.sub(r'~~(.*?)~~', r'<del>\1</del>', html)
        html = re.sub(r'`(.*?)`', r'<code>\1</code>', html)
        html = re.sub(r'!\[(.*?)\]\((.*?)\)', r'<img src="\2" alt="\1">', html)
        html = re.sub(r'\[(.*?)\]\((.*?)\)', r'<a href="\2">\1</a>', html)
        html = re.sub(r'^---$', r'<hr>', html, flags=re.MULTILINE)
        html = re.sub(r'^> (.*?)$', r'<blockquote>\1</blockquote>', html, flags=re.MULTILINE)
        html = re.sub(r'^- (.*?)$', r'<li>\1</li>', html, flags=re.MULTILINE)
        html = html.replace('\n\n', '</p><p>')
        return f'<p>{html}</p>'

    def _generate_preview_html(self, body_html):
        csp = ""
        if not self._scripts_enabled:
            csp = (
                '<meta http-equiv="Content-Security-Policy" '
                'content="default-src \'self\' \'unsafe-inline\' \'unsafe-eval\' data: blob: file: https:; '
                'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' blob: file: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; '
                'style-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; '
                'img-src \'self\' data: blob: file: https:;">'
            )
        kaTeX_css = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">'

        mermaid_init = (
            '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js">'
            '</script><script>mermaid.initialize({startOnLoad:false,theme:"base",'
            'themeVariables:{primaryColor:"#3b3259",primaryTextColor:"#d4d4d4",'
            'primaryBorderColor:"#5a009c",lineColor:"#8e7cc3",secondaryColor:"#2d2844",'
            'tertiaryColor:"#1e1b2e",background:"#1e1b2e"}});</script>'
        )
        kaTeX_js = (
            '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js">'
            '</script><script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js">'
            '</script>'
        )
        init_js = (
            '<script>'
            'var previewBridge = null;'
            'window.onload = function () {'
            '  var el = document.getElementById("preview-scroll");'
            '  if (el) {'
            '    el.addEventListener("scroll", function () {'
            '      if (previewBridge && typeof previewBridge.on_preview_scroll === "function") {'
            '        previewBridge.on_preview_scroll(el.scrollTop);'
            '      }'
            '    });'
            '    el.addEventListener("click", function (e) {'
            '      var t = e.target;'
            '      while (t && t.tagName !== "A") t = t.parentElement;'
            '      if (t && t.tagName === "A" && previewBridge && typeof previewBridge.on_link_clicked === "function") {'
            '        if (t.hostname !== window.location.hostname || t.protocol === "file:") {'
            '          e.preventDefault();'
            '          previewBridge.on_link_clicked(t.href);'
            '        }'
            '      }'
            '    });'
            '  }'
            '  if (typeof renderMathInElement === "function") {'
            '    renderMathInElement(document.body, {'
            '      delimiters: ['
            '        {left: "$$", right: "$$", display: true},'
            '        {left: "$", right: "$", display: false}'
            '      ],'
            '      throwOnError: false'
            '    });'
            '  }'
            '  if (typeof mermaid !== "undefined" && mermaid.run) {'
            '    mermaid.run({querySelector: ".mermaid"}).then(function() {'
            '      if (previewBridge && typeof previewBridge.on_preview_loaded === "function") {'
            '        previewBridge.on_preview_loaded();'
            '      }'
            '    });'
            '  } else {'
            '    if (previewBridge && typeof previewBridge.on_preview_loaded === "function") {'
            '      previewBridge.on_preview_loaded();'
            '    }'
            '  }'
            '};'
            '</script>'
        )
        qwc_js = f'<script>{PREVIEW_QWEBCHANNEL_JS}</script>'
        channel_init = (
            '<script>'
            '(function(){'
            'if(typeof qt==="undefined"||!qt.webChannelTransport){'
            'setTimeout(arguments.callee,100);return}'
            'new QWebChannel(qt.webChannelTransport,function(channel){'
            'previewBridge=channel.objects.preview_bridge;'
            'if(previewBridge&&typeof previewBridge.on_preview_loaded==="function"){'
            'setTimeout(function(){'
            'var el=document.getElementById("preview-scroll");'
            'if(el&&typeof mermaid!=="undefined"&&mermaid.run){'
            'mermaid.run({querySelector:".mermaid"}).then(function(){'
            'previewBridge.on_preview_loaded()})'
            '}else{previewBridge.on_preview_loaded()}'
            '},200)'
            '}'
            '})'
            '})();'
            '</script>'
        )
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    {csp}
    {kaTeX_css}
    {MARKDOWN_PREVIEW_CSS}
</head>
<body>
    <div id="preview-scroll">
        {body_html}
    </div>
    {kaTeX_js}
    {mermaid_init}
    {qwc_js}
    {channel_init}
    {init_js}
</body>
</html>"""

    def _export_html(self):
        if not self._preview_content:
            return
        file_path, _ = QFileDialog.getSaveFileName(
            self, "Export Markdown as HTML", "", "HTML Files (*.html);;All Files (*)"
        )
        if not file_path:
            return
        html_body = self._render_markdown(self._preview_content)
        full_html = self._generate_preview_html(html_body)
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(full_html)
            QMessageBox.information(self, "Export Complete", f"HTML exported to:\n{file_path}")
        except Exception as e:
            QMessageBox.warning(self, "Export Failed", str(e))

    def set_editor(self, editor):
        self.editor = editor
        if editor and hasattr(editor, 'content_changed'):
            editor.content_changed.connect(self._on_editor_content_changed)
        if editor and hasattr(editor, '_bridge') and editor._bridge:
            try:
                editor._bridge.editor_scroll_changed.connect(self._on_editor_scroll_changed)
            except AttributeError:
                pass

    def toggle_security(self, enabled):
        self._scripts_enabled = not enabled
        if self._preview_content:
            self._render_and_display(self._preview_content)

    def closeEvent(self, event):
        try:
            self.refresh_timer.stop()
        except Exception:
            pass
        try:
            if hasattr(self, 'web_view') and self.web_view:
                self.web_view.page().setWebChannel(None)
                self.web_view.stop()
                self.web_view.setParent(None)
                self.web_view.deleteLater()
        except Exception:
            pass
        self._channel = None
        self._sync_bridge = None
        super().closeEvent(event)
