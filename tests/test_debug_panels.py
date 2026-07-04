"""Run/Debug and bottom panel integration tests."""

import os
import sys
import tempfile
import unittest


def _qt_app():
    from PySide6.QtWidgets import QApplication

    return QApplication.instance() or QApplication(sys.argv)


class TestLaunchConfig(unittest.TestCase):
    def test_resolve_substitutes_workspace_and_file(self):
        from pydardcor.debug.launch_config import LaunchConfig

        with tempfile.TemporaryDirectory() as workspace:
            current = os.path.join(workspace, "main.py")
            cfg = LaunchConfig({
                "name": "Python: Current File",
                "type": "python",
                "request": "launch",
                "program": "${file}",
                "cwd": "${workspaceFolder}",
            })
            resolved = cfg.resolve(workspace, current)
            self.assertEqual(resolved["program"], current)
            self.assertEqual(resolved["cwd"], workspace)


class TestProblemsPanel(unittest.TestCase):
    def test_set_problems_aggregates_counts(self):
        _qt_app()
        from pydardcor.ui_shared.problems_panel import ProblemsPanel

        panel = ProblemsPanel()
        panel.set_problems("a.py", [
            {"severity": "error", "line": 1, "col": 1, "message": "boom", "source": "syntax"},
            {"severity": "warning", "line": 2, "col": 1, "message": "warn", "source": "flake8"},
        ])
        panel.set_problems("b.py", [
            {"severity": "error", "line": 3, "col": 1, "message": "other", "source": "syntax"},
        ])
        self.assertEqual(panel.get_error_count(), 2)
        self.assertEqual(panel.get_warning_count(), 1)


class TestOutputPanel(unittest.TestCase):
    def test_append_and_clear_channel(self):
        _qt_app()
        from pydardcor.ui_shared.output_panel import OutputPanel

        panel = OutputPanel()
        panel.append("hello", "Debug Console")
        panel._switch_channel("Debug Console")
        self.assertIn("hello", panel._output.toPlainText())
        panel.clear()
        self.assertEqual(panel._channels["Debug Console"], [])
        self.assertEqual(panel._output.toPlainText(), "")


class TestBottomPanel(unittest.TestCase):
    def test_active_view_names(self):
        _qt_app()
        from PySide6.QtWidgets import QWidget
        from pydardcor.ui_shared.bottom_panel import BottomPanel
        from pydardcor.ui_shared.problems_panel import ProblemsPanel
        from pydardcor.ui_shared.output_panel import OutputPanel

        bottom = BottomPanel()
        problems = ProblemsPanel()
        output = OutputPanel()
        debug = OutputPanel()
        terminal = QWidget()
        ports = QWidget()
        bottom.set_panels(problems, output, debug, terminal, ports)

        bottom.set_active_view("problems")
        self.assertEqual(bottom.current_view_name(), "problems")
        bottom.set_active_view("debug")
        self.assertEqual(bottom.current_view_name(), "debug")

    def test_problems_badge_updates_tab_label(self):
        _qt_app()
        from pydardcor.ui_shared.bottom_panel import BottomPanel

        bottom = BottomPanel()
        bottom.update_problems_badge(2, 1)
        self.assertEqual(bottom.btn_problems.text(), "PROBLEMS (3)")
        bottom.update_problems_badge(0, 0)
        self.assertEqual(bottom.btn_problems.text(), "PROBLEMS")


class TestDAPClient(unittest.TestCase):
    def test_event_handler_receives_messages(self):
        from pydardcor.core.dap_client import DAPClient

        client = DAPClient("python", ["python"])
        events = []
        client.on_event(lambda name, body: events.append((name, body)))
        client._handle_message({
            "type": "event",
            "event": "output",
            "body": {"output": "print", "category": "stdout"},
        })
        self.assertEqual(events, [("output", {"output": "print", "category": "stdout"})])

    def test_response_resolves_pending_request(self):
        from pydardcor.core.dap_client import DAPClient
        import threading

        client = DAPClient("python", ["python"])
        event = threading.Event()
        seq = 7
        client._pending[seq] = event
        client._handle_message({
            "type": "response",
            "request_seq": seq,
            "success": True,
            "body": {"threads": []},
        })
        self.assertTrue(event.is_set())
        self.assertEqual(client._results[seq]["body"], {"threads": []})


class TestDebugPanel(unittest.TestCase):
    def test_config_combo_round_trip(self):
        _qt_app()
        from pydardcor.debug.panel import DebugPanel

        panel = DebugPanel()
        panel.set_config_names(["Python: Current File", "Python: Module"])
        self.assertEqual(panel.get_selected_config_name(), "Python: Current File")
        panel._config_combo.setCurrentIndex(1)
        self.assertEqual(panel.get_selected_config_name(), "Python: Module")


if __name__ == "__main__":
    unittest.main()
