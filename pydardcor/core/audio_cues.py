"""Audio Cues - VS Code style event sounds for accessibility and task status notifications."""

import os
import threading
from PySide6.QtCore import QObject

class AudioCues(QObject):
    """Plays system sounds or frequencies for specific editor state changes."""

    @staticmethod
    def play_error():
        """Short low frequency beep indicating an error/diagnostic."""
        def _task():
            import winsound
            winsound.Beep(300, 150)
        threading.Thread(target=_task, daemon=True).start()

    @staticmethod
    def play_warning():
        """Mid frequency beep indicating a warning."""
        def _task():
            import winsound
            winsound.Beep(600, 100)
        threading.Thread(target=_task, daemon=True).start()

    @staticmethod
    def play_success():
        """Melodic double-beep for task successes or build completions."""
        def _task():
            import winsound
            winsound.Beep(880, 80)
            winsound.Beep(1200, 100)
        threading.Thread(target=_task, daemon=True).start()

    @staticmethod
    def play_task_started():
        """Single high beep for starting background tasks."""
        def _task():
            import winsound
            winsound.Beep(1000, 80)
        threading.Thread(target=_task, daemon=True).start()

    @staticmethod
    def play_task_failed():
        """Declining beep tone for failures."""
        def _task():
            import winsound
            winsound.Beep(500, 100)
            winsound.Beep(250, 200)
        threading.Thread(target=_task, daemon=True).start()
