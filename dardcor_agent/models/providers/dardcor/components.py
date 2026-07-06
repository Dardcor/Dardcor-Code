"""Dardcor built-in provider panel for the Models dashboard."""

import os

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from dardcor_agent.models.provider_meta import provider_card_meta, provider_key_status
from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider
from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY


class DardcorProviderPanel(QWidget):
    """Read-only overview for the built-in Dardcor orchestrators."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: #000000; }")

        content = QWidget()
        content.setStyleSheet("background: #000000;")
        layout = QVBoxLayout(content)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(16)

        header = QFrame()
        header.setStyleSheet(
            "QFrame { background: #0d1b2e; border: 1px solid #1e3a5f; border-radius: 12px; }"
        )
        header_layout = QVBoxLayout(header)
        header_layout.setContentsMargins(20, 18, 20, 18)
        header_layout.setSpacing(10)

        title_row = QHBoxLayout()
        icon = QLabel("D")
        icon.setFixedSize(40, 40)
        icon.setAlignment(Qt.AlignCenter)
        icon.setStyleSheet(
            "color: #ffffff; font-size: 20px; font-weight: 700;"
            "background: #0e639c; border-radius: 10px; border: none;"
        )
        title_row.addWidget(icon)

        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        title = QLabel("Dardcor MAX")
        title.setStyleSheet("color: #e4e4e7; font-size: 18px; font-weight: 700; border: none; background: transparent;")
        title_col.addWidget(title)
        subtitle = QLabel("Strongest built-in orchestrator · multi-provider reasoning · advanced coding mode")
        subtitle.setStyleSheet("color: #94a3b8; font-size: 12px; border: none; background: transparent;")
        title_col.addWidget(subtitle)
        title_row.addLayout(title_col, stretch=1)

        badge = QLabel("Max 2.5x")
        badge.setStyleSheet(
            "color: #86efac; font-size: 11px; font-weight: 600;"
            "background: #14532d; border: 1px solid #166534; border-radius: 6px; padding: 4px 10px;"
        )
        title_row.addWidget(badge)
        header_layout.addLayout(title_row)

        desc = QLabel(
            "Dardcor MAX combines your active AI providers into one high-power coding engine. It selects the "
            "strongest available route for difficult tasks, coordinates tools, browser control, web research, "
            "and verification, then keeps the experience clean with compact usage feedback."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #cbd5e1; font-size: 12px; line-height: 1.5; border: none; background: transparent;")
        header_layout.addWidget(desc)
        layout.addWidget(header)

        secrets_card = QFrame()
        secrets_card.setStyleSheet(
            "QFrame { background: #111315; border: 1px solid #2c2e33; border-radius: 10px; }"
        )
        secrets_layout = QVBoxLayout(secrets_card)
        secrets_layout.setContentsMargins(16, 14, 16, 14)
        secrets_layout.setSpacing(8)

        secrets_title = QLabel("Configured secret sources")
        secrets_title.setStyleSheet("color: #e4e4e7; font-size: 13px; font-weight: 600; border: none; background: transparent;")
        secrets_layout.addWidget(secrets_title)

        secret_counts = self._secret_provider_counts()
        if secret_counts:
            for provider, count in secret_counts.items():
                row = QLabel(f"  •  {provider}: {count} key{'s' if count != 1 else ''} configured")
                row.setStyleSheet("color: #94a3b8; font-size: 12px; border: none; background: transparent;")
                secrets_layout.addWidget(row)
        else:
            empty = QLabel("No secrets.json or .env keys detected yet. Enable a provider tab and add a key.")
            empty.setWordWrap(True)
            empty.setStyleSheet("color: #6b7280; font-size: 12px; border: none; background: transparent;")
            secrets_layout.addWidget(empty)

        secrets_path = self._secrets_path_hint()
        if secrets_path:
            path_lbl = QLabel(f"Optional: {secrets_path}")
            path_lbl.setWordWrap(True)
            path_lbl.setStyleSheet("color: #4b5563; font-size: 11px; border: none; background: transparent;")
            secrets_layout.addWidget(path_lbl)

        layout.addWidget(secrets_card)

        backends_title = QLabel("Dardcor MAX backend order")
        backends_title.setStyleSheet("color: #e4e4e7; font-size: 13px; font-weight: 600; border: none; background: transparent;")
        layout.addWidget(backends_title)

        for provider_name in DardcorV1Provider._PREFERRED_PROVIDERS:
            pdef = PROVIDER_REGISTRY.get(provider_name)
            if not pdef:
                continue
            layout.addWidget(self._backend_row(provider_name, pdef))

        layout.addStretch()
        scroll.setWidget(content)

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.addWidget(scroll)

    def _secret_provider_counts(self) -> dict[str, int]:
        try:
            secrets = DardcorV1Provider()._load_secrets()
            return {name: len(values) for name, values in secrets.items() if values}
        except Exception:
            return {}

    def _secrets_path_hint(self) -> str:
        try:
            from pydardcor.core.config import get_user_data_dir

            return os.path.join(get_user_data_dir(), "secrets.json")
        except Exception:
            return ""

    def _backend_row(self, provider_name: str, provider_def: dict) -> QFrame:
        row = QFrame()
        row.setStyleSheet(
            "QFrame { background: #0a0a0c; border: 1px solid #1e1e20; border-radius: 8px; }"
            "QFrame:hover { border-color: #2c2e33; }"
        )
        row_layout = QHBoxLayout(row)
        row_layout.setContentsMargins(14, 10, 14, 10)
        row_layout.setSpacing(10)

        icon = QLabel(str(provider_def.get("icon", "•")))
        icon.setFixedSize(28, 28)
        icon.setAlignment(Qt.AlignCenter)
        color = provider_def.get("color", "#4da3ff")
        icon.setStyleSheet(
            f"color: {color}; font-size: 14px; font-weight: 700;"
            f"background: #111315; border: 1px solid #2c2e33; border-radius: 6px; border: none;"
        )
        row_layout.addWidget(icon)

        text_col = QVBoxLayout()
        text_col.setSpacing(2)
        name_lbl = QLabel(provider_def.get("name", provider_name))
        name_lbl.setStyleSheet("color: #e4e4e7; font-size: 13px; font-weight: 600; border: none; background: transparent;")
        text_col.addWidget(name_lbl)
        meta_lbl = QLabel(provider_card_meta(provider_name, provider_def))
        meta_lbl.setStyleSheet("color: #6b7280; font-size: 11px; border: none; background: transparent;")
        text_col.addWidget(meta_lbl)
        row_layout.addLayout(text_col, stretch=1)

        states = DardcorV1Provider()._load_provider_states()
        active = bool(states.get(provider_name))
        status = "Active" if active else provider_key_status(provider_name, provider_def)
        status_color = "#22c55e" if active or status == "Key set" else "#94a3b8"
        if status in ("Built-in", "OAuth accounts"):
            status_color = "#60a5fa"
        status_lbl = QLabel(status)
        status_lbl.setStyleSheet(
            f"color: {status_color}; font-size: 11px; font-weight: 600;"
            f"background: #111315; border: 1px solid #2c2e33; border-radius: 6px; padding: 3px 8px;"
        )
        row_layout.addWidget(status_lbl)
        return row
