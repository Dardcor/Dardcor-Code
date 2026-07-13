from __future__ import annotations
import json
import logging
from typing import Any, Callable, Dict, Optional
from PySide6.QtCore import QObject, Signal, QMimeData
from PySide6.QtGui import QDrag, QPixmap
from PySide6.QtWidgets import QWidget, QApplication

logger = logging.getLogger(__name__)


class WebviewTransferable:
    MIME_TYPE = "application/x-dardcor-webview"

    def __init__(self, view_id: str, view_type: str, title: str,
                 html: str = "", state: Optional[Dict[str, Any]] = None):
        self.view_id = view_id
        self.view_type = view_type
        self.title = title
        self.html = html
        self.state = state or {}

    def to_mime_data(self) -> QMimeData:
        data = QMimeData()
        payload = json.dumps({
            "viewId": self.view_id,
            "viewType": self.view_type,
            "title": self.title,
            "html": self.html,
            "state": self.state,
        })
        data.setData(self.MIME_TYPE, payload.encode("utf-8"))
        data.setText(f"webview:{self.view_type}:{self.view_id}")
        return data

    @classmethod
    def from_mime_data(cls, mime: QMimeData) -> Optional["WebviewTransferable"]:
        if not mime.hasFormat(cls.MIME_TYPE):
            payload = mime.text()
            if payload and payload.startswith("webview:"):
                parts = payload.split(":", 2)
                if len(parts) == 3:
                    return cls(parts[2], parts[1], parts[2])
            return None
        raw = bytes(mime.data(cls.MIME_TYPE)).decode("utf-8")
        try:
            data = json.loads(raw)
            return cls(
                view_id=data.get("viewId", ""),
                view_type=data.get("viewType", ""),
                title=data.get("title", ""),
                html=data.get("html", ""),
                state=data.get("state", {}),
            )
        except Exception as e:
            logger.error(f"Failed to deserialize transferable: {e}")
            return None


class DraggableWebviewMixin:
    def start_drag(self, view_id: str, view_type: str, title: str,
                   html: str = "", state: Optional[Dict] = None):
        transfer = WebviewTransferable(view_id, view_type, title, html, state)
        drag = QDrag(self)
        drag.setMimeData(transfer.to_mime_data())
        pixmap = QPixmap(200, 120)
        pixmap.fill(self.palette().window().color())
        drag.setPixmap(pixmap)
        drag.exec()
