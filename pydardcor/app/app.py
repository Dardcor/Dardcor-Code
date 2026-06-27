"""Dardcor Code - Desktop Application Entry Point.

Full VS Code Dark+ theme applied globally via QApplication stylesheet.
"""

import sys
import os
import signal

# Suppress Qt QPA font warnings on Windows (DirectWrite font database issues with legacy/bitmap fonts)
if os.name == "nt":
    existing = os.environ.get("QT_LOGGING_RULES", "")
    if "qt.qpa.fonts" not in existing:
        os.environ["QT_LOGGING_RULES"] = f"{existing};qt.qpa.fonts=false;qt.qpa.fonts.warning=false".strip(";")

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt, QTimer, QLocale
from PySide6.QtGui import QFont, QPalette, QColor, QIcon, QFontDatabase

import ctypes
if os.name == 'nt':
    myappid = 'dardcor.code.ide.1.0'
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
    except Exception:
        pass

from .main_window import MainWindow
from .theme_manager import ThemeManager
from ..core.crash_reporter import setup_crash_reporter

def run_desktop_app():
    """Launch the Dardcor Code desktop application."""
    
    setup_crash_reporter()

    # High DPI support
    if hasattr(Qt, "AA_EnableHighDpiScaling"):
        QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    if hasattr(Qt, "AA_UseHighDpiPixmaps"):
        QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    app = QApplication(sys.argv)
    # Fix Qt locale float parsing bugs in QSvgRenderer (e.g. for European/Indonesian locales using comma as decimal point)
    QLocale.setDefault(QLocale.c())
    app.setApplicationName("Dardcor Code")
    app.setApplicationDisplayName("Dardcor Code")
    app.setOrganizationName("Dardcor")
    app.setOrganizationDomain("dardcor.com")
    if hasattr(app, "setDesktopFileName"):
        app.setDesktopFileName("dardcor-code")
    app.setStyle("Fusion")

    # Set default font
    default_font = QFont("Inter", 9)
    default_font.setStyleHint(QFont.SansSerif)
    app.setFont(default_font)

    # Apply VS Code dark theme stylesheet via ThemeManager
    ThemeManager.apply_theme(app, "dark+")

    # Set app icon globally
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    logo_path = os.path.join(base_dir, "image", "dardcor.png")
    if os.path.exists(logo_path):
        app.setWindowIcon(QIcon(logo_path))

    # Load codicon font
    codicon_path = os.path.join(base_dir, "pydardcor", "assets", "codicon.ttf")
    if os.path.exists(codicon_path):
        QFontDatabase.addApplicationFont(codicon_path)

    # Heavy initialization happens here
    window = MainWindow()
    
    # Force the OS to not paint a white background before Qt renders
    window.setAttribute(Qt.WA_NoSystemBackground, True)
    
    # Once main window is ready to paint, show it
    window.show()

    # ── Ctrl+C / SIGINT graceful + force-exit ────────────────────────────
    def _handle_sigint(sig, frame):
        """
        Called when user presses Ctrl+C.
        1. Ask Qt to quit gracefully (closes windows, runs closeEvent).
        2. If it doesn't fully exit within 1.5 s, force-kill the process.
           This is needed because PTY reader threads can block on read().
        """
        import threading

        def _force_exit():
            import time
            time.sleep(1.5)
            os._exit(0)   # hard kill — guaranteed to stop everything

        threading.Thread(target=_force_exit, daemon=True).start()
        app.quit()

    signal.signal(signal.SIGINT,  _handle_sigint)
    signal.signal(signal.SIGTERM, _handle_sigint)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle_sigint)

    # Keep a timer alive on the app object (not a local var) so Python's
    # signal handler gets a chance to run every 200 ms inside the Qt loop.
    app._sigint_timer = QTimer(app)
    def _python_yield():
        pass
    app._sigint_timer.timeout.connect(_python_yield)
    app._sigint_timer.start(200)

    sys.exit(app.exec())
