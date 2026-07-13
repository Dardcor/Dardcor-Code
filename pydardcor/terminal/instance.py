import os
import json
import shiboken6
from PySide6.QtWidgets import QWidget, QVBoxLayout
from PySide6.QtCore import Qt, QTimer, QUrl, QPoint
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebChannel import QWebChannel

from .bridge import TerminalBridge
from .backend import get_shell_cmd, PtyReaderThread
import pydardcor.terminal.backend as backend


class TerminalInstance(QWidget):
    def __init__(self, workdir: str = None, shell: str = None,
                 env_vars: dict = None, parent=None):
        super().__init__(parent)
        self._workdir = workdir or os.path.expanduser("~")
        self._shell = shell
        self._env_vars = env_vars or {}
        self._pty = None
        self._reader_thread = None
        self._process = None
        self._frontend_ready = False
        self._pending_data = []
        self._custom_title = None
        self.destroyed.connect(lambda: self.kill())

        self._font_family = '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace'
        self._font_size = 13
        self._line_height = 1.2
        self._cursor_style = 'block'
        self._cursor_blink = True
        self._scrollback = 10000
        self._copy_on_select = False

        self._setup_ui()

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
        settings.setAttribute(QWebEngineSettings.JavascriptEnabled, True)
        settings.setAttribute(QWebEngineSettings.JavascriptCanOpenWindows, True)

        self._channel = QWebChannel()
        self._bridge = TerminalBridge(self)
        self._channel.registerObject("backend", self._bridge)
        self._view.page().setWebChannel(self._channel)

        self._bridge.data_from_frontend.connect(self._on_frontend_data)
        self._bridge.resize_requested.connect(self._on_resize)
        self._bridge.selection_changed.connect(self._on_selection_changed)
        self._bridge.title_changed.connect(self._on_title_changed)

        self._view.loadFinished.connect(self._on_load_finished)

        import time
        html_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "assets", "xterm", "terminal.html"
        )
        self._view.page().profile().clearHttpCache()
        url = QUrl.fromLocalFile(html_path)
        url.setQuery(f"v={time.time()}")
        self._view.load(url)
        
        from pydardcor.app.theme_manager import ThemeManager
        self._view.setZoomFactor(1.1 ** ThemeManager._current_zoom_level)
        
        layout.addWidget(self._view)

    # ── Load / shell start ─────────────────────────────────────────────────

    def _on_load_finished(self, ok: bool):
        if not ok:
            return
        self._frontend_ready = True

        if self._pending_data:
            combined = "".join(self._pending_data)
            self._pending_data.clear()
            self._write_to_frontend(combined)

        self._apply_all_settings()

        QTimer.singleShot(150, self._start_shell)

    def _apply_all_settings(self):
        if not self._frontend_ready:
            return

        font_js = (
            f"if (typeof setFont === 'function') {{ "
            f"setFont({json.dumps(self._font_family)}, {self._font_size}, {self._line_height}); }}"
        )
        self._view.page().runJavaScript(font_js)

        cursor_js = (
            f"if (typeof setCursorStyle === 'function') {{ "
            f"setCursorStyle({json.dumps(self._cursor_style)}, {str(self._cursor_blink).lower()}); }}"
        )
        self._view.page().runJavaScript(cursor_js)

        scrollback_js = (
            f"if (typeof setScrollback === 'function') {{ "
            f"setScrollback({self._scrollback}); }}"
        )
        self._view.page().runJavaScript(scrollback_js)

        if self._copy_on_select:
            self._view.page().runJavaScript("if (typeof setCopyOnSelect === 'function') { setCopyOnSelect(true); }")

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
            js = f"if (typeof setTheme === 'function') {{ setTheme({encoded}); }}"
            self._view.page().runJavaScript(js)
        except Exception:
            pass

    def _start_shell(self):
        cmd = self._shell or get_shell_cmd()
        env = os.environ.copy()
        env.update(self._env_vars)

        if backend.HAS_PTY:
            try:
                if "powershell" in cmd.lower() or "pwsh" in cmd.lower():
                    if "-NoLogo" not in cmd:
                        ps_init = "Clear-Host; function cmd { if ($args.Count -eq 0) { cmd.exe /k cls } else { cmd.exe @args } }"
                        cmd = f'{cmd} -NoExit -NoLogo -ExecutionPolicy Bypass -Command "{ps_init}"'
                elif "cmd.exe" in cmd.lower() or cmd.strip().lower() == "cmd":
                    if "/k" not in cmd.lower() and "/c" not in cmd.lower():
                        cmd = f'{cmd} /k cls'

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

        from PySide6.QtCore import QProcess, QProcessEnvironment
        self._process = QProcess(self)
        self._process.setProcessChannelMode(QProcess.MergedChannels)
        self._process.setWorkingDirectory(self._workdir)

        qenv = QProcessEnvironment.systemEnvironment()
        qenv.insert("TERM", "xterm-256color")
        qenv.insert("COLUMNS", "120")
        qenv.insert("LINES", "30")
        for k, v in self._env_vars.items():
            qenv.insert(k, v)
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
        if not hasattr(self, "_view") or not shiboken6.isValid(self._view):
            return
        if not self._frontend_ready:
            self._pending_data.append(data)
            return

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
        if self._pty:
            try:
                self._pty.write(data)
            except TypeError:
                try:
                    self._pty.write(data.encode("utf-8"))
                except Exception:
                    pass
            except Exception:
                pass
        elif self._process and self._process.state() != 0:
            self._process.write(data.encode("utf-8"))

    # ── Events from bridge ────────────────────────────────────────────────

    def _on_selection_changed(self, text: str):
        pass

    def _on_title_changed(self, title: str):
        self._custom_title = title
        p = self.parentWidget()
        while p:
            if hasattr(p, '_on_instance_title_changed'):
                p._on_instance_title_changed(self, title)
                break
            p = p.parentWidget()

    # ── Resize ────────────────────────────────────────────────────────────

    def _on_resize(self, cols: int, rows: int):
        if self._pty:
            try:
                self._pty.set_size(cols, rows)
            except Exception:
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

    def get_workdir(self) -> str:
        return self._workdir

    def set_env_vars(self, env_vars: dict):
        self._env_vars = env_vars

    def get_env_vars(self) -> dict:
        return dict(self._env_vars)

    def get_custom_title(self):
        return self._custom_title

    def clear(self):
        self._write_to_frontend("\x1b[2J\x1b[H")

    def send_text(self, text: str):
        self._on_frontend_data(text)

    def write_input(self, text: str):
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

    # ── Font customization ────────────────────────────────────────────────

    def set_font_family(self, family: str):
        self._font_family = family
        if self._frontend_ready:
            js = f"if (typeof setFont === 'function') {{ setFont({json.dumps(family)}, null, null); }}"
            self._view.page().runJavaScript(js)
            self._do_fit()

    def set_font_size(self, size: int):
        self._font_size = size
        if self._frontend_ready:
            js = f"if (typeof setFont === 'function') {{ setFont(null, {size}, null); }}"
            self._view.page().runJavaScript(js)
            self._do_fit()

    def set_line_height(self, height: float):
        self._line_height = height
        if self._frontend_ready:
            js = f"if (typeof setFont === 'function') {{ setFont(null, null, {height}); }}"
            self._view.page().runJavaScript(js)
            self._do_fit()

    def set_cursor_style(self, style: str, blink: bool = True):
        self._cursor_style = style
        self._cursor_blink = blink
        if self._frontend_ready:
            js = f"if (typeof setCursorStyle === 'function') {{ setCursorStyle({json.dumps(style)}, {str(blink).lower()}); }}"
            self._view.page().runJavaScript(js)

    def set_scrollback(self, lines: int):
        self._scrollback = lines
        if self._frontend_ready:
            js = f"if (typeof setScrollback === 'function') {{ setScrollback({lines}); }}"
            self._view.page().runJavaScript(js)

    def set_copy_on_select(self, enabled: bool):
        self._copy_on_select = enabled
        self._bridge.set_copy_on_select(enabled)
        if self._frontend_ready:
            js = f"if (typeof setCopyOnSelect === 'function') {{ setCopyOnSelect({str(enabled).lower()}); }}"
            self._view.page().runJavaScript(js)

    def set_theme(self, theme_colors: dict):
        if self._frontend_ready:
            encoded = json.dumps(theme_colors)
            js = f"if (typeof setTheme === 'function') {{ setTheme({json.dumps(encoded)}); }}"
            self._view.page().runJavaScript(js)

    def toggle_find(self):
        if self._frontend_ready:
            self._view.page().runJavaScript("if (typeof toggleFindBar === 'function') { toggleFindBar(); }")

    # ── Context menu ──────────────────────────────────────────────────────

    def _show_context_menu(self, pos: QPoint):
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

        find_action = QAction("Find...", self)
        find_action.setShortcut(QKeySequence("Ctrl+F"))
        find_action.triggered.connect(self.toggle_find)
        menu.addAction(find_action)

        menu.addSeparator()

        clear_action = QAction("Clear", self)
        clear_action.setShortcut(QKeySequence("Ctrl+L"))
        clear_action.triggered.connect(self.clear)
        menu.addAction(clear_action)

        menu.addSeparator()

        copy_on_select_action = QAction("Copy on Selection", self)
        copy_on_select_action.setCheckable(True)
        copy_on_select_action.setChecked(self._copy_on_select)
        copy_on_select_action.triggered.connect(lambda checked: self.set_copy_on_select(checked))
        menu.addAction(copy_on_select_action)

        menu.addSeparator()

        split_action = QAction("Split Terminal", self)
        split_action.triggered.connect(lambda: self.split())
        menu.addAction(split_action)

        kill_action = QAction("Kill Terminal", self)
        kill_action.triggered.connect(self._request_kill)
        menu.addAction(kill_action)

        menu.exec(self._view.mapToGlobal(pos))

    def _request_kill(self):
        p = self.parentWidget()
        while p:
            if hasattr(p, 'kill_all'):
                tp = p.parentWidget()
                while tp:
                    if hasattr(tp, '_kill_current'):
                        if len(p.instances) > 1:
                            self.kill()
                            p.instances.remove(self)
                            self.deleteLater()
                        else:
                            idx = tp._stack.indexOf(p)
                            if idx >= 0:
                                tp._close_tab(idx)
                        return
                    tp = tp.parentWidget()
                break
            p = p.parentWidget()

    def split(self, direction="horizontal"):
        p = self.parentWidget()
        while p:
            if hasattr(p, 'add_instance'):
                if direction == "vertical":
                    new_inst = p.add_instance(shell=self._shell, direction=Qt.Vertical)
                else:
                    new_inst = p.add_instance(shell=self._shell, direction=Qt.Horizontal)
                return new_inst
            p = p.parentWidget()

    def get_chat_mirror(self) -> str:
        return "\\n".join(self._pending_data[-100:]) if self._pending_data else ""

    def suggest_commands(self) -> list:
        return ["git status", "git log", "python main.py"]

    def closeEvent(self, event):
        self.kill()
        super().closeEvent(event)
