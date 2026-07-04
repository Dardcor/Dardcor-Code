import os
import unittest


os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


class TestNotificationService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication

        cls.app = QApplication.instance() or QApplication([])

    def test_queues_after_visible_limit_and_drains_on_dismiss(self):
        from PySide6.QtWidgets import QWidget

        from pydardcor.ui_shared.notification_service import NotificationService

        parent = QWidget()
        parent.resize(800, 600)
        service = NotificationService(parent)

        for index in range(5):
            service.show_info(f"msg {index}")

        self.assertEqual(service.visible_count, 3)
        self.assertEqual(service.queued_count, 2)
        self.assertEqual(service.unread_count, 5)

        service.dismiss_oldest()
        self.app.processEvents()

        self.assertEqual(service.visible_count, 3)
        self.assertEqual(service.queued_count, 1)
        self.assertEqual(service.unread_count, 4)

    def test_action_button_runs_callback_and_dismisses(self):
        from PySide6.QtWidgets import QWidget

        from pydardcor.ui_shared.notification_service import NotificationService

        parent = QWidget()
        service = NotificationService(parent)
        called = []

        service.show_warning("Needs attention", actions=[("Fix", lambda: called.append("fix"))])

        toast = service._toasts[0]
        button = toast.action_buttons[0]
        button.click()
        self.app.processEvents()

        self.assertEqual(called, ["fix"])
        self.assertEqual(service.visible_count, 0)
        self.assertEqual(service.unread_count, 0)

    def test_status_bar_notification_state_updates_tooltip(self):
        from pydardcor.ui_shared.status_bar import StatusBar

        status = StatusBar()

        status.set_notifications(0)
        self.assertEqual(status._notif_btn.toolTip(), "No Notifications")

        status.set_notifications(2)
        self.assertEqual(status._notif_btn.toolTip(), "2 Notifications")


if __name__ == "__main__":
    unittest.main()
