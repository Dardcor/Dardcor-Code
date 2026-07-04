"""Helpers for injecting extension-contributed items into native Qt context menus."""

from typing import Callable, Optional

from PySide6.QtWidgets import QMenu, QWidget
from PySide6.QtGui import QAction

from ..core.extension_contributions import get_contribution_parser


def find_command_executor(widget: QWidget) -> Optional[Callable[[str], None]]:
    """Walk the widget parent chain to find a command execution callback."""
    p = widget
    while p:
        if hasattr(p, "_run_extension_command"):
            return p._run_extension_command
        if hasattr(p, "_execute_command"):
            return p._execute_command
        p = p.parentWidget()
    return None


def append_extension_context_menu(
    menu: QMenu,
    menu_id: str,
    execute_cb: Optional[Callable[[str], None]] = None,
    parent_widget: Optional[QWidget] = None,
) -> int:
    """Append extension-contributed actions to *menu*. Returns count added."""
    if execute_cb is None and parent_widget is not None:
        execute_cb = find_command_executor(parent_widget)
    if execute_cb is None:
        return 0

    items = get_contribution_parser().get_menu_items(menu_id)
    if not items:
        return 0

    menu.addSeparator()
    current_group: Optional[str] = None
    added = 0
    for item in items:
        group = item.group
        if current_group is not None and group != current_group:
            menu.addSeparator()
        current_group = group

        label = item.label or item.command
        cmd_id = item.command
        action = QAction(label, menu)
        action.triggered.connect(lambda checked=False, c=cmd_id: execute_cb(c))
        menu.addAction(action)
        added += 1
    return added
