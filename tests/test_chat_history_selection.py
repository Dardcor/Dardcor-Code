from pathlib import Path
import unittest


class ChatHistorySelectionTest(unittest.TestCase):
    def test_chat_history_owns_selectable_copy_interaction_contract(self):
        source = Path("dardcor_agent/chat/panel.py").read_text(encoding="utf-8")
        class_body = source.split("class UpwardComboBox", 1)[0]

        self.assertIn("self.setReadOnly(True)", class_body)
        self.assertIn("Qt.TextSelectableByMouse", class_body)
        self.assertIn("Qt.TextSelectableByKeyboard", class_body)
        self.assertIn("Qt.LinksAccessibleByMouse", class_body)
        self.assertIn("Qt.LinksAccessibleByKeyboard", class_body)
        self.assertIn("self.setFocusPolicy(Qt.StrongFocus)", class_body)
        self.assertIn("self.viewport().setCursor(Qt.IBeamCursor)", class_body)

    def test_main_window_clipboard_shortcuts_use_focused_qt_widget_first(self):
        source = Path("pydardcor/app/main_window.py").read_text(encoding="utf-8")

        self.assertIn("def _copy_from_focused_widget", source)
        self.assertIn("def _paste_into_focused_widget", source)
        self.assertIn("copy_action.triggered.connect(self._copy_from_focused_widget)", source)
        self.assertIn("paste_action.triggered.connect(self._paste_into_focused_widget)", source)
        self.assertNotIn(
            "copy_action.triggered.connect(lambda: self._editor_tabs.current_editor().copy()",
            source,
        )

    def test_chat_controls_support_collapse_icon_copy_retry_revert_and_queue(self):
        panel_source = Path("dardcor_agent/chat/panel.py").read_text(encoding="utf-8")
        main_source = Path("pydardcor/app/main_window.py").read_text(encoding="utf-8")

        self.assertIn("[+]", panel_source)
        self.assertIn("[-]", panel_source)
        self.assertIn("copy_msg:", panel_source)
        self.assertIn("&#x1F4CB;", panel_source)
        self.assertIn("retry_msg:", panel_source)
        self.assertIn("revert_msg:", panel_source)
        self.assertIn("def _retry_message", panel_source)
        self.assertIn("def _revert_message", panel_source)
        self.assertIn("self._input.setEnabled(True)", panel_source)
        self.assertIn("self._queued_chat_messages", main_source)
        self.assertIn("self._chat_generation_active", main_source)
        self.assertIn("def _run_next_queued_chat_message", main_source)
        self.assertIn("def _render_history_html_content", panel_source)
        self.assertIn("def _collapsible_block_token", panel_source)
        self.assertIn("@@COLLAPSIBLE_BLOCK_", panel_source)
        self.assertNotIn(
            "paste_action.triggered.connect(lambda: self._editor_tabs.current_editor().paste()",
            main_source,
        )

    def test_chat_input_auto_grows_with_content(self):
        panel_source = Path("dardcor_agent/chat/panel.py").read_text(encoding="utf-8")

        self.assertIn("def _adjust_height", panel_source)
        self.assertIn("self.document().documentLayout().documentSize()", panel_source)
        self.assertIn("setMaximumHeight", panel_source)
        self.assertIn("setMinimumHeight", panel_source)
        self.assertNotIn("self._input.setFixedHeight(50)", panel_source)

    def test_collapse_uses_url_scheme_without_underscore_and_hides_body_when_collapsed(self):
        panel_source = Path("dardcor_agent/chat/panel.py").read_text(encoding="utf-8")

        self.assertIn("toggleblock:", panel_source)
        self.assertNotIn("toggle_block:", panel_source)
        self.assertIn("expanded\"] else \"\"", panel_source)
        self.assertIn("if block[\"expanded\"]:", panel_source)

    def test_queue_dedup_runs_against_all_pending_messages(self):
        main_source = Path("pydardcor/app/main_window.py").read_text(encoding="utf-8")
        panel_source = Path("dardcor_agent/chat/panel.py").read_text(encoding="utf-8")

        self.assertIn("message in self._queued_chat_messages", main_source)
        self.assertNotIn("self._queued_chat_messages[-1] == message", main_source)
        self.assertIn("self._is_message_duplicate", panel_source)
        self.assertIn("pending_messages_changed", main_source)


if __name__ == "__main__":
    unittest.main()
