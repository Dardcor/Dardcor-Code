import time
import unittest
from unittest.mock import MagicMock, patch

from PySide6.QtWidgets import QApplication


class TestIconPixmapCaching(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._app = QApplication.instance() or QApplication([])

    def test_render_svg_reuses_cached_icon(self):
        from pydardcor.file_explorer.panel import SVG_PYTHON, _render_svg

        first = _render_svg(SVG_PYTHON)
        second = _render_svg(SVG_PYTHON)
        self.assertIs(first, second)

    def test_get_file_icon_reuses_cached_icon(self):
        from pydardcor.file_explorer.panel import get_file_icon

        path = "demo/example.py"
        first = get_file_icon(path)
        second = get_file_icon(path)
        self.assertIs(first, second)


class TestDiagnosticsDebounce(unittest.TestCase):
    def test_diagnostics_manager_batches_listener_calls(self):
        from pydardcor.lsp.diagnostics_manager import DiagnosticsManager

        mgr = DiagnosticsManager(debounce_ms=50)
        calls = []
        mgr.on_diagnostics_update(lambda uri, markers: calls.append((uri, len(markers))))

        params = {
            "uri": "file:///tmp/a.py",
            "diagnostics": [{
                "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}},
                "severity": 1,
                "message": "err",
            }],
        }
        mgr.handle_publish_diagnostics(params)
        mgr.handle_publish_diagnostics(params)
        self.assertEqual(calls, [])
        time.sleep(0.12)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "file:///tmp/a.py")
        self.assertEqual(calls[0][1], 1)


class TestGitBridgeDebounce(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._app = QApplication.instance() or QApplication([])

    def test_request_refresh_coalesces_poll_updates(self):
        from pydardcor.git.bridge import GitBridge

        bridge = GitBridge()
        bridge._workspace = "/tmp"
        bridge.refreshData = MagicMock()
        bridge.refreshGraph = MagicMock()

        bridge.requestRefresh()
        bridge.requestRefresh()
        self.assertTrue(bridge._refresh_timer.isActive())
        self.assertEqual(bridge.refreshData.call_count, 0)

        bridge._auto_refresh()
        bridge.refreshData.assert_called_once()
        bridge.refreshGraph.assert_called_once()


class TestProblemsPanelDebounce(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._app = QApplication.instance() or QApplication([])

    def test_set_problems_schedules_single_rebuild(self):
        from pydardcor.ui_shared.problems_panel import ProblemsPanel

        panel = ProblemsPanel()
        panel._rebuild = MagicMock()

        panel.set_problems("a.py", [{"severity": "error", "line": 1, "col": 1, "message": "x", "source": "t"}])
        panel.set_problems("b.py", [{"severity": "warning", "line": 2, "col": 1, "message": "y", "source": "t"}])
        panel._rebuild.assert_not_called()
        self.assertTrue(panel._rebuild_timer.isActive())


class TestGitPanelLazyLoad(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._app = QApplication.instance() or QApplication([])

    def test_webview_not_created_at_init(self):
        from pydardcor.git.panel import GitPanel

        with patch("pydardcor.git.panel.QWebEngineView") as webview_cls:
            panel = GitPanel()
            self.assertFalse(panel._webview_loaded)
            self.assertIsNone(panel.webview)
            webview_cls.assert_not_called()


if __name__ == "__main__":
    unittest.main()
