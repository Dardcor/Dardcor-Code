"""Terminal Instance - Single PTY-backed xterm.js terminal."""

import os
import json
import shiboken6
from PySide6.QtWidgets import QWidget, QVBoxLayout
from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebChannel import QWebChannel

from .bridge import TerminalBridge
from .backend import get_shell_cmd, PtyReaderThread
import pydardcor.terminal.backend as backend


class TerminalInstance(QWidget):
    """Single terminal instance backed by pywinpty + xterm.js via QWebEngineView."""

    def __init__(self, workdir: str = None, shell: str = None, parent=None):
        super().__init__(parent)
        self._workdir = workdir or os.path.expanduser("~")
        self._shell = shell
        self._pty = None
        self._reader_thread = None
        self._process = None
        self._frontend_ready = False
        self._pending_data = []          # buffer while frontend loads
        self.destroyed.connect(lambda: self.kill())
        self._setup_ui()
        
        from PySide6.QtCore import QTimer
        self._resize_timer = QTimer(self)
        self._resize_timer.setSingleShot(True)
        self._resize_timer.setInterval(50)
        self._resize_timer.timeout.connect(self._do_fit)

    # ── UI ────────────────────────────────────────────────────────────────

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._view = QWebEngineView(self)
        from PySide6.QtGui import QColor
        self._view.page().setBackgroundColor(QColor(0, 0, 0, 0))
        self._view.setContextMenuPolicy(Qt.CustomContextMenu)
        self._view.customContextMenuRequested.connect(self._show_context_menu)
        
        settings = self._view.page().profile().settings()
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)

        # Disable right-click default menu; allow copy/paste via xterm.js
        self._channel = QWebChannel()
        self._bridge = TerminalBridge(self)
        self._channel.registerObject("backend", self._bridge)
        self._view.page().setWebChannel(self._channel)

        self._bridge.data_from_frontend.connect(self._on_frontend_data)
        self._bridge.resize_requested.connect(self._on_resize)

        self._view.loadFinished.connect(self._on_load_finished)

        html_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "assets", "xterm", "terminal.html"
        )
        self._view.load(QUrl.fromLocalFile(html_path))
        layout.addWidget(self._view)

    # ── Load / shell start ─────────────────────────────────────────────────

    def _on_load_finished(self, ok: bool):
        if not ok:
            return
        self._frontend_ready = True

        # Flush buffered data
        if self._pending_data:
            combined = "".join(self._pending_data)
            self._pending_data.clear()
            self._write_to_frontend(combined)

        # Apply current theme colors
        try:
            from ..app.theme_manager import ThemeManager
            theme_data = ThemeManager.THEMES.get(ThemeManager._current_theme, ThemeManager.THEMES["dark+"])
            c = theme_data["colors"]
            is_dark = (theme_data.get("type", "dark") == "dark")
            
            xt_theme = {
                "background": c["background"],
                "foreground": c["foreground"],
                "cursor": c["foreground"],
                "selectionBackground": c["selection"],
            }
            if not is_dark:
                xt_theme.update({
                    "black": "#000000", "white": "#ffffff",
                    "brightBlack": "#666666", "brightWhite": "#333333"
                })
            
            encoded = json.dumps(xt_theme)
            js = f"if (typeof setTheme === 'function') {{ setTheme({json.dumps(encoded)}); }}"
            self._view.page().runJavaScript(js)
        except Exception:
            pass

        # Small delay so WebChannel handshake completes before shell starts
        QTimer.singleShot(150, self._start_shell)

    def _start_shell(self):
        """Spawn the shell: pywinpty PTY → fallback to QProcess."""
        cmd = self._shell or get_shell_cmd()
        env = os.environ.copy()

        if backend.HAS_PTY:
            try:
                # Add robust arguments for powershell to ensure it stays interactive
                if "powershell" in cmd.lower() or "pwsh" in cmd.lower():
                    if "-NoLogo" not in cmd:
                        cmd = f'{cmd} -NoExit -NoLogo -ExecutionPolicy Bypass'
                
                self._pty = backend.create_pty(120, 30, cmd, self._workdir, env=env)

                self._reader_thread = PtyReaderThread(self._pty, self)
                self._reader_thread.data_ready.connect(self._write_to_frontend)
                self._reader_thread.finished.connect(
                    lambda: self._write_to_frontend("\r\n\x1b[90m[Process ended]\x1b[0m\r\n")
                )
                self._reader_thread.start()
                return

            except Exception as exc:
                self._write_to_frontend(
                    f"\x1b[31m[PTY error: {exc}]\x1b[0m\r\n"
                    f"\x1b[33m[Falling back to QProcess]\x1b[0m\r\n"
                )
                backend.HAS_PTY = False

        # ── QProcess fallback ──────────────────────────────────────────────
        from PySide6.QtCore import QProcess, QProcessEnvironment
        self._process = QProcess(self)
        self._process.setProcessChannelMode(QProcess.MergedChannels)
        self._process.setWorkingDirectory(self._workdir)

        qenv = QProcessEnvironment.systemEnvironment()
        qenv.insert("TERM",    "xterm-256color")
        qenv.insert("COLUMNS", "120")
        qenv.insert("LINES",   "30")
        self._process.setProcessEnvironment(qenv)

        self._process.readyReadStandardOutput.connect(self._on_qprocess_data)
        self._process.finished.connect(self._on_process_finished)

        exe = cmd if isinstance(cmd, str) else cmd[0]
        args = []
        if "powershell" in exe.lower() or "pwsh" in exe.lower():
            args = ["-NoLogo", "-NoExit"]
        elif "cmd" in exe.lower():
            args = ["/Q"]

        self._process.start(exe, args)

    # ── Data flow: backend → frontend ─────────────────────────────────────

    def _write_to_frontend(self, data: str):
        """Send PTY output to xterm.js using JSON encoding (safe for all chars)."""
        if not hasattr(self, "_view") or not shiboken6.isValid(self._view):
            return
        if not self._frontend_ready:
            self._pending_data.append(data)
            return

        # json.dumps produces a properly escaped JS string literal
        encoded = json.dumps(data)
        js = f"if (typeof writeToTerminal === 'function') {{ writeToTerminal({encoded}); }}"
        page = self._view.page()
        if page and shiboken6.isValid(page):
            page.runJavaScript(js)

    def _on_process_finished(self, code, _status):
        self._write_to_frontend(f"\r\n\x1b[90m[Process exited with code {code}]\x1b[0m\r\n")

    def _on_qprocess_data(self):
        raw = self._process.readAllStandardOutput().data()
        text = raw.decode("utf-8", errors="replace")
        self._write_to_frontend(text)

    # ── Data flow: frontend → backend ─────────────────────────────────────

    def _on_frontend_data(self, data: str):
        """Receive keystrokes/paste from xterm.js → send to shell."""
        if self._pty:
            try:
                # pywinpty 3.x write() accepts str
                self._pty.write(data)
            except TypeError:
                # Some builds expect bytes
                try:
                    self._pty.write(data.encode("utf-8"))
                except Exception:
                    pass
            except Exception:
                pass
        elif self._process and self._process.state() != 0:
            self._process.write(data.encode("utf-8"))

    # ── Resize ────────────────────────────────────────────────────────────

    def _on_resize(self, cols: int, rows: int):
        if self._pty:
            try:
                self._pty.set_size(cols, rows)
            except Exception:
                pass
        elif self._process:
            # Send COLUMNS/LINES via environment is not dynamic;
            # for QProcess fallback we can't resize the pseudoterminal.
            pass

    # ── Public API ────────────────────────────────────────────────────────

    def showEvent(self, event):
        super().showEvent(event)
        self._resize_timer.start()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._resize_timer.start()

    def _do_fit(self):
        if hasattr(self, '_view') and shiboken6.isValid(self._view):
            page = self._view.page()
            if page and shiboken6.isValid(page):
                page.runJavaScript("if (typeof scheduleFit === 'function') { scheduleFit(); }")

    def set_workdir(self, path: str):
        self._workdir = path

    def clear(self):
        self._write_to_frontend("\x1b[2J\x1b[H")

    def send_text(self, text: str):
        """Send text programmatically to the shell (e.g. from Run menu)."""
        self._on_frontend_data(text)

    def kill(self):
        if self._reader_thread:
            self._reader_thread.stop()
            self._reader_thread = None
        if self._pty:
            try:
                self._pty.close()
            except Exception:
                pass
            self._pty = None
        if self._process:
            try:
                self._process.kill()
                self._process.waitForFinished(2000)
            except Exception:
                pass
            self._process = None

    def split(self, direction="horizontal"):
        """Stub for splitting this terminal instance."""
        # In a full implementation, this would emit a signal to the parent
        # container to create a QSplitter and add a new TerminalInstance.
        pass

    def closeEvent(self, event):
        self.kill()
        super().closeEvent(event)

    def _show_context_menu(self, pos):
        from PySide6.QtWidgets import QMenu
        from PySide6.QtGui import QAction, QKeySequence
        
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #3c0068;
            }
            QMenu::item {
                padding: 6px 20px;
            }
            QMenu::item:selected {
                background-color: #3c0068;
                color: #ffffff;
            }
            QMenu::separator {
                height: 1px;
                background: #3c0068;
                margin: 4px 0px;
            }
        """)

        copy_action = QAction("Copy", self)
        copy_action.setShortcut(QKeySequence("Ctrl+C"))
        copy_action.triggered.connect(lambda: self._view.page().triggerAction(self._view.page().WebAction.Copy))
        menu.addAction(copy_action)

        paste_action = QAction("Paste", self)
        paste_action.setShortcut(QKeySequence("Ctrl+V"))
        paste_action.triggered.connect(lambda: self._view.page().triggerAction(self._view.page().WebAction.Paste))
        menu.addAction(paste_action)
        
        select_all_action = QAction("Select All", self)
        select_all_action.setShortcut(QKeySequence("Ctrl+A"))
        select_all_action.triggered.connect(lambda: self._view.page().triggerAction(self._view.page().WebAction.SelectAll))
        menu.addAction(select_all_action)
        
        menu.addSeparator()
        
        clear_action = QAction("Clear", self)
        clear_action.setShortcut(QKeySequence("Ctrl+L"))
        clear_action.triggered.connect(self.clear)
        menu.addAction(clear_action)
        
        menu.addSeparator()
        
        split_action = QAction("Split Terminal", self)
        split_action.triggered.connect(lambda: self.split())
        menu.addAction(split_action)
        
        kill_action = QAction("Kill Terminal", self)
        kill_action.triggered.connect(self._request_kill)
        menu.addAction(kill_action)
        
        menu.exec(self._view.mapToGlobal(pos))

    def _request_kill(self):
        """Request the parent to kill this specific instance, effectively acting like the trash button."""
        p = self.parentWidget()
        while p:
            if hasattr(p, 'kill_all'): # It's a SplitContainer
                # Find TerminalPanel
                tp = p.parentWidget()
                while tp:
                    if hasattr(tp, '_kill_current'):
                        # Hacky way to let it know we want to kill this specific instance
                        if len(p.instances) > 1:
                            self.kill()
                            p.instances.remove(self)
                            self.deleteLater()
                        else:
                            # It's the only one in the split, kill the whole tab
                            idx = tp._stack.indexOf(p)
                            if idx >= 0:
                                tp._close_tab(idx)
                        return
                    tp = tp.parentWidget()
                break
            p = p.parentWidget()
