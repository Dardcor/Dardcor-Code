from __future__ import annotations
import json
import logging
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


class WebviewPanelSerializer:
    def __init__(self, view_type: str, serializers: Optional[Dict[str, "WebviewPanelSerializer"]] = None):
        self._view_type = view_type
        self._serialize_handler: Optional[Callable[[], Dict[str, Any]]] = None
        self._deserialize_handler: Optional[Callable[[Dict[str, Any]], None]] = None

    @property
    def view_type(self) -> str:
        return self._view_type

    def on_serialize(self, handler: Callable[[], Dict[str, Any]]):
        self._serialize_handler = handler

    def on_deserialize(self, handler: Callable[[Dict[str, Any]], None]):
        self._deserialize_handler = handler

    def serialize(self) -> Optional[str]:
        if self._serialize_handler:
            try:
                state = self._serialize_handler()
                return json.dumps({"viewType": self._view_type, "state": state})
            except Exception as e:
                logger.error(f"Serializer error for {self._view_type}: {e}")
        return None

    def deserialize(self, data: str) -> bool:
        try:
            parsed = json.loads(data)
            if parsed.get("viewType") != self._view_type:
                return False
            state = parsed.get("state", {})
            if self._deserialize_handler:
                self._deserialize_handler(state)
                return True
        except Exception as e:
            logger.error(f"Deserializer error for {self._view_type}: {e}")
        return False


class WebviewStateManager:
    _instances: Dict[str, "WebviewStateManager"] = {}
    _serializers: Dict[str, WebviewPanelSerializer] = {}

    def __init__(self, view_id: str):
        self.view_id = view_id
        self._state: Dict[str, Any] = {}
        self._pending_state: Optional[str] = None

    @classmethod
    def get(cls, view_id: str) -> "WebviewStateManager":
        if view_id not in cls._instances:
            cls._instances[view_id] = WebviewStateManager(view_id)
        return cls._instances[view_id]

    @classmethod
    def register_serializer(cls, view_type: str, serializer: WebviewPanelSerializer):
        cls._serializers[view_type] = serializer

    @classmethod
    def get_serializer(cls, view_type: str) -> Optional[WebviewPanelSerializer]:
        return cls._serializers.get(view_type)

    def set_state(self, state: Dict[str, Any]):
        self._state = state

    def get_state(self) -> Dict[str, Any]:
        return self._state

    def save_pending(self, data: str):
        self._pending_state = data

    def load_pending(self) -> Optional[str]:
        data = self._pending_state
        self._pending_state = None
        return data

    @classmethod
    def save_all(cls) -> Dict[str, str]:
        result = {}
        for view_id, mgr in cls._instances.items():
            serialized = mgr._serialize_current()
            if serialized:
                result[view_id] = serialized
        return result

    def _serialize_current(self) -> Optional[str]:
        serializer = self._serializers.get(self.view_id)
        if serializer:
            return serializer.serialize()
        if self._state:
            return json.dumps({"viewType": self.view_id, "state": self._state})
        return None

    @classmethod
    def restore_all(cls, data: Dict[str, str]):
        for view_id, serialized in data.items():
            mgr = cls.get(view_id)
            serializer = cls._serializers.get(view_id)
            if serializer:
                serializer.deserialize(serialized)
