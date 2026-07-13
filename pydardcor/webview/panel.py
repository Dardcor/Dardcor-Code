from __future__ import annotations
import os
import json
import logging
from typing import Any, Callable, Dict, List, Optional, Set
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings, QWebEngineProfile
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWidgets import QWidget, QVBoxLayout, QSizePolicy
from PySide6.QtCore import Qt, QUrl, Signal, QTimer, QEvent
from PySide6.QtGui import QWindow

from .message_router import WebviewMessageRouter
from .options import (
    WebviewOptions,
    WebviewPanelOptions,
    WebviewViewOptions,
    PortMapping,
)
from .serializer import WebviewStateManager, WebviewPanelSerializer
from .protocol import WebviewProtocol
from .transferable import DraggableWebviewMixin
from ..core.uri import URI

logger = logging.getLogger(__name__)


class Webview(QWidget):
    on_did_receive_message = Signal(str, dict)
    on_did_change_title = Signal(str, str)
    on_did_update_state = Signal(str, dict)

    def __init__(self, view_id: str, options: Optional[WebviewOptions] = None,
                 parent=None):
        super().__init__(parent)
        self.view_id = view_id
        self._options = options or WebviewOptions()
        self._html = ""
        self._initial_state: Optional[Dict[str, Any]] = None
        self._hidden = False
        self._retain_context = False
        self._cached_html: Optional[str] = None
        self._page_loaded = False

        self._setup_ui()
        self._protocol = WebviewProtocol()
        self._state_manager = WebviewStateManager.get(view_id)

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._profile = QWebEngineProfile(self.view_id, self)
        self._profile.setHttpCacheType(QWebEngineProfile.MemoryHttpCache)

        settings = self._profile.settings()
        settings.setAttribute(QWebEngineSettings.JavascriptEnabled, self._options.enable_scripts)
        settings.setAttribute(QWebEngineSettings.JavascriptCanOpenWindows, False)
        settings.setAttribute(QWebEngineSettings.JavascriptCanAccessClipboard, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.ErrorPageEnabled, False)
        settings.setAttribute(QWebEngineSettings.HyperlinkAuditingEnabled, False)
        settings.setAttribute(QWebEngineSettings.WebGLEnabled, True)
        settings.setAttribute(QWebEngineSettings.Accelerated2dCanvasEnabled, True)
        settings.setAttribute(QWebEngineSettings.AutoLoadImages, True)
        settings.setAttribute(QWebEngineSettings.PluginsEnabled, False)
        settings.setAttribute(QWebEngineSettings.FullScreenSupportEnabled, False)

        self._webview = QWebEngineView(self)
        self._webview.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self._webview.setPage(QWebEnginePage(self._profile, self._webview))

        self._router = WebviewMessageRouter(self.view_id)
        self._router.message_received.connect(self._on_message_received)
        self._router.webview_ready.connect(self._on_webview_ready)

        self._channel = QWebChannel()
        self._channel.registerObject("vscode", self._router)
        self._webview.page().setWebChannel(self._channel)

        self._webview.page().loadFinished.connect(self._on_load_finished)
        self._webview.page().titleChanged.connect(self._on_title_changed)

        layout.addWidget(self._webview)

    def set_options(self, options: WebviewOptions):
        self._options = options
        settings = self._profile.settings()
        settings.setAttribute(QWebEngineSettings.JavascriptEnabled, options.enable_scripts)
        self._router.set_port_mappings(options.port_mapping)
        if self._html:
            self._reload_with_csp()

    def get_options(self) -> WebviewOptions:
        return self._options

    def set_html(self, html: str):
        self._html = html
        self._cached_html = html
        self._reload_with_csp()

    def get_html(self) -> str:
        return self._html

    def _reload_with_csp(self):
        state = self._state_manager.get_state() or self._initial_state
        injected = self._protocol.inject_into_html(
            self._html,
            state=state,
            enable_command_uris=self._options.enable_command_uris,
            local_resource_roots=self._options.local_resource_roots,
        )
        base_url = QUrl("vscode-resource://vscode-resource.vscode-cdn.net/")
        self._cached_html = injected
        self._webview.setHtml(injected, base_url)
        self._page_loaded = False

    def set_initial_state(self, state: Dict[str, Any]):
        self._initial_state = state
        self._state_manager.set_state(state)

    def get_state(self) -> Dict[str, Any]:
        return self._state_manager.get_state()

    def post_message(self, message: dict):
        self._router.send_message(message)
        js = f"""
        (function() {{
            var data = {json.dumps(message)};
            var event = new MessageEvent('message', {{ data: data }});
            window.dispatchEvent(event);
        }})();
        """
        self._webview.page().runJavaScript(js)

    def as_webview_uri(self, local_uri: URI) -> str:
        return self._protocol.resource_loader.as_webview_uri(local_uri)

    def run_javascript(self, script: str):
        self._webview.page().runJavaScript(script)

    def register_message_handler(self, command: str, handler: Callable):
        self._router.register_handler(command, handler)

    def unregister_message_handler(self, command: str):
        self._router.unregister_handler(command)

    @property
    def csp_source(self) -> str:
        return self._protocol.csp.csp_source

    @property
    def page(self) -> QWebEnginePage:
        return self._webview.page()

    @property
    def webview_view(self) -> QWebEngineView:
        return self._webview

    @property
    def router(self) -> WebviewMessageRouter:
        return self._router

    def set_retain_context(self, enabled: bool):
        self._retain_context = enabled

    def hide_webview(self):
        self._hidden = True
        if not self._retain_context:
            self._cached_html = self._html
            self._webview.setHtml("")

    def show_webview(self):
        self._hidden = False
        if self._cached_html and not self._webview.page().url().toString():
            self._reload_with_csp()

    def _on_message_received(self, view_id: str, message: dict):
        self.on_did_receive_message.emit(view_id, message)

    def _on_webview_ready(self, view_id: str):
        pass

    def _on_load_finished(self, ok: bool):
        if ok:
            self._page_loaded = True
            js_state = json.dumps(self._state_manager.get_state())
            init_js = f"""
            (function() {{
                if (window.__vscode_state_persistence) {{
                    window.__vscode_state_persistence.setState({js_state});
                }}
                if (window._vscode_bridge && typeof window._vscode_bridge.onReady === 'function') {{
                    window._vscode_bridge.onReady();
                }}
            }})();
            """
            QTimer.singleShot(100, lambda: self._webview.page().runJavaScript(init_js))

    def _on_title_changed(self, title: str):
        self.on_did_change_title.emit(self.view_id, title)

    def cleanup(self):
        self._router.cleanup()
        self._webview.page().setWebChannel(None)
        self._webview.stop()
        self._webview.setParent(None)
        self._webview.deleteLater()
        self._profile.deleteLater()
        self._channel = None


class WebviewPanel(QWidget, DraggableWebviewMixin):
    on_did_dispose = Signal(str)
    on_did_change_view_state = Signal(str, dict)

    def __init__(self, view_type: str, title: str,
                 panel_options: Optional[WebviewPanelOptions] = None,
                 webview_options: Optional[WebviewOptions] = None,
                 parent=None):
        super().__init__(parent)
        self.view_type = view_type
        self._title = title
        self._panel_options = panel_options or WebviewPanelOptions()
        self._serializer: Optional[WebviewPanelSerializer] = None
        self._disposed = False
        self._revealed = False

        self._webview = Webview(
            view_id=view_type,
            options=webview_options,
            parent=self,
        )
        self._webview.set_retain_context(self._panel_options.retain_context_when_hidden)
        self._webview.on_did_receive_message.connect(self._on_message)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self._webview)

        self._setup_serializer()

    def _setup_serializer(self):
        serializer = WebviewStateManager.get_serializer(self.view_type)
        if serializer:
            self._serializer = serializer

    @property
    def webview(self) -> Webview:
        return self._webview

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str):
        self._title = value

    @property
    def options(self) -> WebviewPanelOptions:
        return self._panel_options

    @property
    def visible(self) -> bool:
        return self.isVisible()

    @property
    def active(self) -> bool:
        return self.isVisible() and self.isActiveWindow()

    @property
    def disposed(self) -> bool:
        return self._disposed

    def reveal(self, preserve_focus: bool = False):
        self._revealed = True
        self.show()
        self.raise_()
        if not preserve_focus:
            self.setFocus()

    def set_html(self, html: str):
        self._webview.set_html(html)

    def post_message(self, message: dict):
        self._webview.post_message(message)

    def on_did_receive_message(self, handler: Callable):
        self._webview.on_did_receive_message.connect(
            lambda vid, msg: handler(msg)
        )

    def set_serializer(self, serializer: WebviewPanelSerializer):
        self._serializer = serializer
        WebviewStateManager.register_serializer(self.view_type, serializer)

    def serialize_state(self) -> Optional[str]:
        if self._serializer:
            return self._serializer.serialize()
        state = self._webview.get_state()
        if state:
            return json.dumps(state)
        return None

    def dispose(self):
        if self._disposed:
            return
        self._disposed = True
        self._webview.cleanup()
        self.setParent(None)
        self.deleteLater()
        self.on_did_dispose.emit(self.view_type)

    def _on_message(self, view_id: str, message: dict):
        pass

    def changeEvent(self, event):
        if event.type() == QEvent.Hidden:
            if self._panel_options.retain_context_when_hidden:
                self._webview.hide_webview()
            else:
                self._webview.hide_webview()
        elif event.type() == QEvent.Show:
            self._webview.show_webview()
        super().changeEvent(event)

    def mousePressEvent(self, event):
        super().mousePressEvent(event)
        if event.button() == Qt.LeftButton:
            self.start_drag(
                self.view_type, self.view_type, self._title,
                html=self._webview.get_html(),
                state=self._webview.get_state(),
            )


class WebviewView(QWidget, DraggableWebviewMixin):
    on_did_dispose = Signal(str)
    on_did_change_visibility = Signal(str, bool)

    def __init__(self, view_type: str, title: str = "",
                 view_options: Optional[WebviewViewOptions] = None,
                 webview_options: Optional[WebviewOptions] = None,
                 parent=None):
        super().__init__(parent)
        self.view_type = view_type
        self._title = title
        self._description = ""
        self._view_options = view_options or WebviewViewOptions()
        self._disposed = False
        self._badge: Optional[str] = None

        self._webview = Webview(
            view_id=view_type,
            options=webview_options,
            parent=self,
        )
        self._webview.set_retain_context(self._view_options.retain_context_when_hidden)
        self._webview.on_did_receive_message.connect(self._on_message)
        self._webview.on_did_change_title.connect(self._on_title_changed)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self._webview)

    @property
    def webview(self) -> Webview:
        return self._webview

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str):
        self._title = value

    @property
    def description(self) -> str:
        return self._description

    @description.setter
    def description(self, value: str):
        self._description = value

    @property
    def badge(self) -> Optional[str]:
        return self._badge

    @badge.setter
    def badge(self, value: Optional[str]):
        self._badge = value

    @property
    def visible(self) -> bool:
        return self.isVisible()

    def set_html(self, html: str):
        self._webview.set_html(html)

    def post_message(self, message: dict):
        self._webview.post_message(message)

    def on_did_receive_message(self, handler: Callable):
        self._webview.on_did_receive_message.connect(
            lambda vid, msg: handler(msg)
        )

    def show_view(self):
        self.show()

    def hide_view(self):
        self.hide()

    def dispose(self):
        if self._disposed:
            return
        self._disposed = True
        self._webview.cleanup()
        self.setParent(None)
        self.deleteLater()
        self.on_did_dispose.emit(self.view_type)

    def _on_message(self, view_id: str, message: dict):
        pass

    def _on_title_changed(self, view_id: str, title: str):
        self._title = title

    def changeEvent(self, event):
        if event.type() == QEvent.Hidden:
            self.on_did_change_visibility.emit(self.view_type, False)
            if self._view_options.retain_context_when_hidden:
                self._webview.hide_webview()
        elif event.type() == QEvent.Show:
            self.on_did_change_visibility.emit(self.view_type, True)
            self._webview.show_webview()
        super().changeEvent(event)

    def mousePressEvent(self, event):
        super().mousePressEvent(event)
        if event.button() == Qt.LeftButton:
            self.start_drag(
                self.view_type, self.view_type, self._title,
                html=self._webview.get_html(),
                state=self._webview.get_state(),
            )


class WebviewEditor(QWidget):
    on_did_dispose = Signal(str)
    on_did_change_view_state = Signal(str, dict)

    def __init__(self, view_type: str, title: str,
                 panel_options: Optional[WebviewPanelOptions] = None,
                 webview_options: Optional[WebviewOptions] = None,
                 parent=None):
        super().__init__(parent)
        self.view_type = view_type
        self._title = title
        self._panel_options = panel_options or WebviewPanelOptions()
        self._disposed = False
        self._is_dirty = False
        self._document_path: Optional[str] = None

        self._webview = Webview(
            view_id=f"editor:{view_type}",
            options=webview_options,
            parent=self,
        )
        self._webview.set_retain_context(self._panel_options.retain_context_when_hidden)
        self._webview.on_did_receive_message.connect(self._on_message)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self._webview)

    @property
    def webview(self) -> Webview:
        return self._webview

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str):
        self._title = value

    @property
    def is_dirty(self) -> bool:
        return self._is_dirty

    @is_dirty.setter
    def is_dirty(self, value: bool):
        self._is_dirty = value

    @property
    def document_path(self) -> Optional[str]:
        return self._document_path

    @document_path.setter
    def document_path(self, value: Optional[str]):
        self._document_path = value

    def set_html(self, html: str):
        self._webview.set_html(html)

    def post_message(self, message: dict):
        self._webview.post_message(message)

    def on_did_receive_message(self, handler: Callable):
        self._webview.on_did_receive_message.connect(
            lambda vid, msg: handler(msg)
        )

    def save(self) -> bool:
        return True

    def revert(self):
        pass

    def dispose(self):
        if self._disposed:
            return
        self._disposed = True
        self._webview.cleanup()
        self.setParent(None)
        self.deleteLater()
        self.on_did_dispose.emit(self.view_type)

    def _on_message(self, view_id: str, message: dict):
        if message.get("command") == "save":
            self._is_dirty = True
        elif message.get("command") == "dirty":
            self._is_dirty = message.get("value", True)

    def changeEvent(self, event):
        if event.type() == QEvent.Hidden:
            if self._panel_options.retain_context_when_hidden:
                self._webview.hide_webview()
        elif event.type() == QEvent.Show:
            self._webview.show_webview()
        super().changeEvent(event)
