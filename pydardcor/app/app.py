"""Dardcor Code - Desktop Application Entry Point.

Full VS Code Dark+ theme applied globally via QApplication stylesheet.
"""

import sys
import os
import signal

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

    # Auto-create the global user directory (~/.dardcor-code) on every run
    from ..core.config import ensure_user_dirs
    ensure_user_dirs()

    # High DPI support
    if hasattr(Qt, "AA_EnableHighDpiScaling"):
        QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    if hasattr(Qt, "AA_UseHighDpiPixmaps"):
        QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    if os.environ.get("DARDCOR_DISABLE_GPU") == "1":
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = "--disable-gpu --disable-software-rasterizer"
        QApplication.setAttribute(Qt.AA_UseSoftwareOpenGL)
    else:
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = "--enable-gpu-rasterization --enable-oop-rasterization --enable-zero-copy"

    app = QApplication(sys.argv)
    QLocale.setDefault(QLocale.c())
    app.setApplicationName("Dardcor Code")
    app.setApplicationDisplayName("Dardcor Code")
    if hasattr(app, "setDesktopFileName"):
        app.setDesktopFileName("dardcor-code")
    app.setStyle("Fusion")

    # Set a dark palette immediately to prevent white flash before stylesheet is fully rendered
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(0, 0, 0))
    palette.setColor(QPalette.WindowText, QColor(255, 255, 255))
    palette.setColor(QPalette.Base, QColor(0, 0, 0))
    palette.setColor(QPalette.AlternateBase, QColor(10, 10, 10))
    palette.setColor(QPalette.ToolTipBase, QColor(0, 0, 0))
    palette.setColor(QPalette.ToolTipText, QColor(255, 255, 255))
    palette.setColor(QPalette.Text, QColor(255, 255, 255))
    palette.setColor(QPalette.Button, QColor(20, 20, 20))
    palette.setColor(QPalette.ButtonText, QColor(255, 255, 255))
    palette.setColor(QPalette.BrightText, QColor(255, 0, 0))
    palette.setColor(QPalette.Link, QColor(42, 130, 218))
    palette.setColor(QPalette.Highlight, QColor(42, 130, 218))
    palette.setColor(QPalette.HighlightedText, QColor(255, 255, 255))
    app.setPalette(palette)

    from ..core.config import get_config
    cfg = get_config()
    ui_zoom = getattr(cfg, "ui_zoom", 0)
    default_font = QFont("Inter", max(6, 9 + ui_zoom))
    default_font.setStyleHint(QFont.SansSerif)
    app.setFont(default_font)

    ThemeManager.register_extension_themes()
    ThemeManager._current_zoom_level = getattr(cfg, "ui_zoom", 0)
    ThemeManager.apply_theme(app, cfg.color_theme or "dardcor-purple")

    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    logo_path = os.path.join(base_dir, "image", "dardcor.png")
    if os.path.exists(logo_path):
        app.setWindowIcon(QIcon(logo_path))

    # Load codicon font
    codicon_path = os.path.join(base_dir, "assets", "codicon.ttf")
    if os.path.exists(codicon_path):
        QFontDatabase.addApplicationFont(codicon_path)

    # Heavy initialization happens here
    window = MainWindow()
    
    # Once main window is ready to paint, show it
    window.show()

    # ── Ctrl+C / SIGINT graceful + force-exit ────────────────────────────
    _signal_registered = set()

    def _handle_sigint(sig, frame):
        if sig in _signal_registered:
            return
        _signal_registered.add(sig)

        import threading

        def _force_exit():
            import time
            time.sleep(1.5)
            os._exit(0)

        threading.Thread(target=_force_exit, daemon=True).start()
        app.quit()

    signal.signal(signal.SIGINT, _handle_sigint)
    signal.signal(signal.SIGTERM, _handle_sigint)
    for sig_name in ("SIGBREAK", "SIGHUP", "SIGQUIT"):
        if hasattr(signal, sig_name):
            signal.signal(getattr(signal, sig_name), _handle_sigint)

    # Keep a timer alive on the app object (not a local var) so Python's
    # signal handler gets a chance to run every 200 ms inside the Qt loop.
    app._sigint_timer = QTimer(app)
    def _python_yield():
        pass
    app._sigint_timer.timeout.connect(_python_yield)
    app._sigint_timer.start(200)

    sys.exit(app.exec())
