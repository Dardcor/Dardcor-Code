"""Telemetry Service Mock - VS Code style telemetry."""

import os
import json
import uuid
import datetime
from typing import Dict, Any
from ..core.config import get_user_data_dir


class TelemetryService:
    """Mocks telemetry reporting to local log files."""

    def __init__(self):
        self._machine_id = str(uuid.uuid4())
        self._session_id = str(uuid.uuid4())
        self._enabled = self._check_enabled()
        self._log_path = os.path.join(get_user_data_dir(), "telemetry.log")

    def _check_enabled(self) -> bool:
        """Check if telemetry is enabled in settings."""
        try:
            from ..core.config import get_config
            cfg = get_config()
            return getattr(cfg, 'telemetry_enableTelemetry', True)
        except Exception:
            return True

    def public_log(self, event_name: str, properties: Dict[str, Any] = None):
        """Log a telemetry event if telemetry is enabled."""
        if not self._enabled:
            return

        if properties is None:
            properties = {}

        event = {
            "timestamp": datetime.datetime.now().isoformat(),
            "machineId": self._machine_id,
            "sessionId": self._session_id,
            "eventName": event_name,
            "properties": properties
        }

        try:
            os.makedirs(os.path.dirname(self._log_path), exist_ok=True)
            with open(self._log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(event) + "\n")
        except Exception:
            pass

    def public_log_error(self, error: Exception, context: str = ""):
        """Log an exception."""
        self.public_log("error", {
            "type": type(error).__name__,
            "message": str(error),
            "context": context
        })


_telemetry_service = None

def get_telemetry_service() -> TelemetryService:
    global _telemetry_service
    if _telemetry_service is None:
        _telemetry_service = TelemetryService()
    return _telemetry_service
