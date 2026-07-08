"""Notification Sound - Play audio cues for notifications."""

import os
import sys

def play_notification_sound():
    """Play a short, premium, pleasant sound cue."""
    try:
        if sys.platform == "win32":
            import winsound
            # MessageBeep with MB_OK is the standard system sound
            winsound.MessageBeep(winsound.MB_OK)
        else:
            # Unix / macOS fallback
            print("\a", end="", flush=True)
    except Exception:
        pass
