import unittest
from unittest.mock import mock_open, patch


class TestBrowserControl(unittest.TestCase):
    def test_chrome_args_enable_local_remote_debugging(self):
        from pydardcor.browser.chrome_launcher import build_agent_chrome_args

        with patch("pydardcor.browser.chrome_launcher._get_agent_profile_dir", return_value="profile"):
            args = build_agent_chrome_args("chrome", "http://localhost:3000", controlled=True)

        self.assertIn("--remote-debugging-port=9222", args)
        self.assertIn("--remote-debugging-address=127.0.0.1", args)
        self.assertIn("--remote-allow-origins=*", args)
        self.assertIn("--user-data-dir=profile", args)
        self.assertEqual(args[-1], "http://localhost:3000")

    def test_agent_exposes_browser_tools(self):
        from dardcor_agent.chat.agent import TOOLS

        names = {tool["function"]["name"] for tool in TOOLS}
        self.assertIn("open_browser", names)
        self.assertIn("browser_open", names)
        self.assertIn("browser_observe", names)
        self.assertIn("browser_eval", names)
        self.assertIn("browser_click", names)
        self.assertIn("browser_type", names)
        self.assertIn("browser_screenshot", names)

    def test_banner_html_contains_visible_indicator(self):
        from dardcor_agent.chat.browser_control import CONTROL_BANNER_TEXT, controlled_banner_html

        html = controlled_banner_html()
        self.assertIn(CONTROL_BANNER_TEXT, html)
        self.assertIn("dardcor-ai-browser-banner", html)

    def test_type_script_escapes_user_text(self):
        from dardcor_agent.chat.browser_control import browser_type

        with patch("dardcor_agent.chat.browser_control.browser_eval") as eval_mock:
            eval_mock.return_value = {"ok": True}
            result = browser_type('hello "world"')

        self.assertEqual(result, {"ok": True})
        self.assertIn('hello \\"world\\"', eval_mock.call_args.args[0])

    def test_screenshot_returns_path_not_base64_blob(self):
        from dardcor_agent.chat.browser_control import browser_screenshot

        with patch("dardcor_agent.chat.browser_control._cdp_call") as cdp_mock:
            with patch("dardcor_agent.capabilities.storage.timestamped_path", return_value="shot.png"):
                cdp_mock.return_value = {"result": {"data": "iVBORw0KGgo="}}
                with patch("builtins.open", mock_open()):
                    result = browser_screenshot()

        self.assertEqual(result["path"], "shot.png")
        self.assertNotIn("data", result)


if __name__ == "__main__":
    unittest.main()
