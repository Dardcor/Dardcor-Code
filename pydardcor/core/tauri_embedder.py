"""Embedded Tauri Widget for Antigravity Tools."""

import os
import subprocess
from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel
from PySide6.QtGui import QWindow
from PySide6.QtCore import Qt, QTimer

if os.name == "nt":
    try:
        import win32gui
        import win32process
        import win32con
        _HAS_WIN32 = True
    except ImportError:
        win32gui = win32process = win32con = None
        _HAS_WIN32 = False
else:
    win32gui = win32process = win32con = None
    _HAS_WIN32 = False

class EmbeddedTauriWidget(QWidget):
    """Embeds a running Tauri application directly into a PySide6 widget."""
    
    def __init__(self, tauri_dir: str, parent=None):
        super().__init__(parent)
        self.tauri_dir = tauri_dir
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)
        
        self.loading_lbl = QLabel("Compiling and launching Antigravity Tauri backend...\nThis may take a few minutes for the first run.")
        self.loading_lbl.setAlignment(Qt.AlignCenter)
        self.loading_lbl.setStyleSheet("color: #cccccc; font-size: 14px; background-color: #000000;")
        self.layout.addWidget(self.loading_lbl)
        
        self.process = None
        self.hwnd = None
        self.embedded_widget = None
        
        self._launch_tauri()
        
    def _launch_tauri(self):
        # Try to find the built release executable first
        exe_path = os.path.join(self.tauri_dir, "src-tauri", "target", "release", "antigravity_manager.exe")
        
        if os.path.exists(exe_path):
            self.loading_lbl.setText("Launching Antigravity Tools...")
            self.process = subprocess.Popen([exe_path], cwd=os.path.dirname(exe_path))
        else:
            self.loading_lbl.setText("Building Antigravity Tauri backend...\nPlease wait, NPM & Cargo are compiling your project...")
            # If not built, launch via dev (the background task is building it, but if user runs it now, it will launch the dev server)
            self.process = subprocess.Popen(["npm", "run", "tauri", "dev"], cwd=self.tauri_dir, shell=True)
            
        # Start a polling timer to catch the window once it appears
        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(self._check_for_window)
        self.poll_timer.start(1000) # Poll every 1 second
        
    def _check_for_window(self):
        # Antigravity Tools uses hiddenTitle and transparent in its tauri.conf.json
        # Wait until it creates the window and becomes visible.
        hwnd = win32gui.FindWindow(None, "Antigravity Tools")
        if not hwnd:
            hwnd = win32gui.FindWindow(None, "Antigravity Manager")
            
        if hwnd and win32gui.IsWindowVisible(hwnd):
            self.hwnd = hwnd
            self.poll_timer.stop()
            self._embed_window()
            
    def _embed_window(self):
        if not self.hwnd: return
        
        # Remove standard Windows title bar and borders to make it seamless
        style = win32gui.GetWindowLong(self.hwnd, win32con.GWL_STYLE)
        style &= ~win32con.WS_CAPTION
        style &= ~win32con.WS_THICKFRAME
        style &= ~win32con.WS_SYSMENU
        win32gui.SetWindowLong(self.hwnd, win32con.GWL_STYLE, style)
        
        # Embed the HWND into PySide6
        window = QWindow.fromWinId(self.hwnd)
        self.embedded_widget = QWidget.createWindowContainer(window, self)
        
        # Replace the loading label with the actual Tauri app!
        self.loading_lbl.hide()
        self.layout.addWidget(self.embedded_widget)
        
    def closeEvent(self, event):
        # Ensure we kill the Tauri process when PySide6 closes
        if self.process:
            self.process.terminate()
        super().closeEvent(event)
