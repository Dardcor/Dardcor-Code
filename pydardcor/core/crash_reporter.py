"""Crash Reporter - VS Code style exception handler and crash reporter."""

import sys
import traceback
import os
import datetime
from PySide6.QtWidgets import QMessageBox
from ..core.config import get_user_data_dir


def global_exception_handler(exctype, value, tb):
    """Handle uncaught exceptions globally."""
    
    # Format exception
    error_msg = "".join(traceback.format_exception(exctype, value, tb))
    
    # Log to file
    crash_dir = os.path.join(get_user_data_dir(), "Crashpad")
    os.makedirs(crash_dir, exist_ok=True)
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    crash_file = os.path.join(crash_dir, f"crash_{timestamp}.log")
    
    try:
        with open(crash_file, "w", encoding="utf-8") as f:
            f.write(f"Timestamp: {timestamp}\n")
            f.write(f"Exception Type: {exctype.__name__}\n")
            f.write(f"Message: {value}\n\n")
            f.write(error_msg)
    except Exception:
        pass
        
    # Show user-friendly error
    print(f"CRASH:\n{error_msg}", file=sys.stderr)
    
    try:
        from PySide6.QtWidgets import QApplication
        if QApplication.instance():
            msg_box = QMessageBox()
            msg_box.setIcon(QMessageBox.Critical)
            msg_box.setWindowTitle("Dardcor Code - Crash Reporter")
            msg_box.setText("An unexpected error occurred.")
            msg_box.setInformativeText("The application has encountered a critical error. The error has been logged.")
            msg_box.setDetailedText(error_msg)
            msg_box.exec()
    except Exception:
        pass


def setup_crash_reporter():
    """Install the global exception handler."""
    sys.excepthook = global_exception_handler
