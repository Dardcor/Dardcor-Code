from __future__ import annotations
import json
import logging
from typing import Any, Callable, Dict, List, Optional
from PySide6.QtCore import QObject, Slot, Signal
from .options import PortMapping

logger = logging.getLogger(__name__)


class WebviewMessageRouter(QObject):
    message_received = Signal(str, dict)
    webview_ready = Signal(str)
    webview_disposed = Signal(str)
    port_mapping_changed = Signal(str)

    def __init__(self, view_id: str):
        super().__init__()
        self.view_id = view_id
        self._message_handlers: Dict[str, Callable] = {}
        self._pending_messages: List[dict] = []
        self._ready = False
        self._port_mappings: List[PortMapping] = []
        self._state: Dict[str, Any] = {}

    @Slot(str)
    def postMessage(self, message_str: str):
        try:
            msg = json.loads(message_str)
            if isinstance(msg, dict) and msg.get("__vscode_message"):
                actual = msg.get("data", msg)
                self._handle_message(actual)
            else:
                self._handle_message(msg)
        except json.JSONDecodeError:
            logger.warning(f"[{self.view_id}] Invalid JSON from webview")
        except Exception as e:
            logger.error(f"[{self.view_id}][{self.view_id}] Message routing error: {e}")

    def _handle_message(self, message: dict):
        self.message_received.emit(self.view_id, message)
        command = message.get("command", "")
        if command in self._message_handlers:
            try:
                self._message_handlers[command](message)
            except Exception as e:
                logger.error(f"[{self.view_id}] Handler for '{command}' error: {e}")
        handlers = self._message_handlers.get("*")
        if handlers:
            try:
                handlers(message)
            except Exception as e:
                logger.error(f"[{self.view_id}] Wildcard handler error: {e}")

    @Slot()
    def onReady(self):
        self._ready = True
        self.webview_ready.emit(self.view_id)
        for msg in self._pending_messages:
            self._send_to_js(msg)
        self._pending_messages.clear()

    @Slot(str)
    def setState(self, state_json: str):
        try:
            self._state = json.loads(state_json)
        except json.JSONDecodeError:
            self._state = {}

    @Slot(result=str)
    def getState(self) -> str:
        return json.dumps(self._state)

    def register_handler(self, command: str, handler: Callable):
        self._message_handlers[command] = handler

    def unregister_handler(self, command: str):
        self._message_handlers.pop(command, None)

    def send_message(self, message: dict):
        if self._ready:
            self._send_to_js(message)
        else:
            self._pending_messages.append(message)

    def _send_to_js(self, message: dict):
        try:
            js = f"""
            (function() {{
                var data = {json.dumps(message)};
                var event = new MessageEvent('message', {{ data: data }});
                window.dispatchEvent(event);
            }})();
            """
            # Signal to parent to run JavaScript
            self._pending_messages.append(message)  # will be picked up via signal
        except Exception as e:
            logger.error(f"[{self.view_id}] Failed to queue JS message: {e}")

    def set_port_mappings(self, mappings: List[PortMapping]):
        self._port_mappings = mappings
        self.port_mapping_changed.emit(self.view_id)

    def get_port_mappings(self) -> List[PortMapping]:
        return self._port_mappings

    def resolve_port(self, port: int) -> int:
        for mapping in self._port_mappings:
            if mapping.webview_port == port:
                return mapping.extension_host_port
        return port

    def cleanup(self):
        self._message_handlers.clear()
        self._pending_messages.clear()
        self._port_mappings.clear()
        self._ready = False
        self.webview_disposed.emit(self.view_id)
