"""Visible menu/toolbar actions wire to real handlers."""

import unittest
from pathlib import Path
from unittest.mock import MagicMock


class _WindowStub:
    """Minimal MainWindow stand-in: missing attrs become no-op mocks."""

    def __init__(self):
        self._ext_manager = MagicMock()
        self._ext_manager.execute_command.return_value = False
        self._switch_sidebar = MagicMock()
        self._toggle_terminal = MagicMock()
        self._editor_tabs = MagicMock()
        self._navigate_back = MagicMock()
        self._navigate_forward = MagicMock()
        self._show_models_dialog = MagicMock()
        self._show_git_branch_menu = MagicMock()
        self._nav_back_stack = ["a.py", "b.py"]
        self._nav_forward_stack = []
        self._open_file_in_editor = MagicMock()

    def __getattr__(self, name):
        return MagicMock()


class TestVisibleUiActions(unittest.TestCase):
    def test_command_catalog_contains_visible_actions(self):
        from pydardcor.app.main_window import build_default_commands

        ids = {cmd["id"] for cmd in build_default_commands()}

        for cmd_id in (
            "workbench.action.navigateBack",
            "workbench.action.navigateForward",
            "view.testing",
            "view.models",
            "status.gitBranch",
            "view.explorer",
            "view.search",
            "view.sourceControl",
            "view.toggleTerminal",
            "workbench.action.splitEditor",
        ):
            self.assertIn(cmd_id, ids)

    def test_command_palette_lists_core_view_actions(self):
        source = Path("pydardcor/app/main_window.py").read_text(encoding="utf-8")

        for cmd_id in (
            "view.explorer",
            "view.search",
            "view.sourceControl",
            "view.toggleTerminal",
            "workbench.action.splitEditor",
        ):
            self.assertIn(f'"id": "{cmd_id}"', source)

    def test_dispatches_visible_actions(self):
        from pydardcor.app.main_window import MainWindow

        window = _WindowStub()
        window._ext_manager.execute_command.return_value = True

        MainWindow._execute_command(window, "workbench.action.navigateBack")
        MainWindow._execute_command(window, "workbench.action.navigateForward")
        MainWindow._execute_command(window, "view.testing")
        MainWindow._execute_command(window, "view.models")
        MainWindow._execute_command(window, "status.gitBranch")

        window._navigate_back.assert_called_once_with()
        window._navigate_forward.assert_called_once_with()
        window._switch_sidebar.assert_called_once()
        window._show_models_dialog.assert_called_once_with()
        window._show_git_branch_menu.assert_called_once_with()

    def test_execute_command_routes_core_view_actions(self):
        from pydardcor.app.main_window import MainWindow

        window = _WindowStub()

        MainWindow._execute_command(window, "view.explorer")
        MainWindow._execute_command(window, "view.toggleTerminal")
        MainWindow._execute_command(window, "workbench.action.splitEditor")

        self.assertEqual(window._switch_sidebar.call_count, 1)
        window._toggle_terminal.assert_called_once_with()
        window._editor_tabs.split_editor.assert_called_once_with("right")

    def test_navigation_history_reopens_paths(self):
        from pydardcor.app.main_window import MainWindow

        window = _WindowStub()
        window._current_nav_path = lambda: None

        MainWindow._navigate_back(window)
        MainWindow._navigate_forward(window)

        self.assertEqual(window._open_file_in_editor.call_args_list[0].args, ("a.py", False))
        self.assertEqual(window._open_file_in_editor.call_args_list[1].args, ("b.py", False))

    def test_clipboard_shortcuts_use_focused_qt_widget_first(self):
        source = Path("pydardcor/app/main_window.py").read_text(encoding="utf-8")

        self.assertIn("def _copy_from_focused_widget", source)
        self.assertIn("def _paste_into_focused_widget", source)
        self.assertIn("copy_action.triggered.connect(self._copy_from_focused_widget)", source)
        self.assertIn("paste_action.triggered.connect(self._paste_into_focused_widget)", source)


if __name__ == "__main__":
    unittest.main()
