from __future__ import annotations

import os
import json
import threading
import struct
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING
from dataclasses import dataclass, field, asdict
from pathlib import Path

if TYPE_CHECKING:
    from pydardcor.app.main_window import MainWindow

try:
    from PySide6.QtCore import (
        Qt, QRect, QTimer, Signal, QObject, QByteArray, QDataStream,
        QIODevice, QPoint, QSize, QRectF
    )
    from PySide6.QtWidgets import QApplication, QWidget, QMainWindow
    from PySide6.QtGui import QScreen, QWindow, QCloseEvent
    HAS_QT = True
except ImportError:
    HAS_QT = False


WINDOW_STATE_FILE = "window_state.json"


@dataclass
class WindowState:
    x: int = 100
    y: int = 100
    width: int = 1280
    height: int = 800
    maximized: bool = False
    fullscreen: bool = False
    presentation_mode: bool = False
    workspace_path: str = ""
    zoom_level: int = 0
    title: str = "Dardcor Code"
    screen_index: int = -1
    dpi_scale: float = 1.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "WindowState":
        valid_keys = set(cls.__dataclass_fields__)
        filtered = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered)


class WindowLayoutPersistence:
    """Persists window layout (position, size, state) to disk as JSON."""

    def __init__(self, storage_dir: str | None = None):
        if storage_dir is None:
            from pydardcor.core.config import get_user_data_dir
            storage_dir = get_user_data_dir()
        self._file_path = os.path.join(storage_dir, WINDOW_STATE_FILE)
        self._lock = threading.Lock()

    def save(self, states: list[dict]) -> None:
        with self._lock:
            try:
                os.makedirs(os.path.dirname(self._file_path), exist_ok=True)
                with open(self._file_path, "w", encoding="utf-8") as f:
                    json.dump({"windows": states, "version": 2}, f, indent=2)
            except (OSError, IOError):
                pass

    def load(self) -> list[dict]:
        with self._lock:
            try:
                if not os.path.exists(self._file_path):
                    return []
                with open(self._file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data.get("windows", [])
            except (OSError, IOError, json.JSONDecodeError):
                return []

    def save_single(self, state: WindowState) -> None:
        states = self.load()
        ws_path = state.workspace_path
        for i, s in enumerate(states):
            if s.get("workspace_path") == ws_path:
                states[i] = state.to_dict()
                break
        else:
            states.append(state.to_dict())
        self.save(states)

    def clear(self) -> None:
        with self._lock:
            try:
                if os.path.exists(self._file_path):
                    os.remove(self._file_path)
            except OSError:
                pass


class MultiWindowIPC(QObject):
    """Inter-process communication manager for multi-window coordination.
    Uses QLocalServer/QLocalSocket for named-pipe IPC between windows.
    """
    message_received = Signal(str, object)

    def __init__(self, server_name: str = "dardcor-code-ipc"):
        super().__init__()
        self._server_name = server_name
        self._server = None
        self._connections: list = []
        self._is_server = False

    def start_server(self):
        if not HAS_QT:
            return
        from PySide6.QtNetwork import QLocalServer
        QLocalServer.removeServer(self._server_name)
        self._server = QLocalServer()
        self._server.newConnection.connect(self._on_new_connection)
        self._server.listen(self._server_name)
        self._is_server = True

    def _on_new_connection(self):
        if not self._server:
            return
        conn = self._server.nextPendingConnection()
        if conn:
            conn.readyRead.connect(lambda: self._on_data(conn))
            self._connections.append(conn)

    def _on_data(self, conn):
        while conn and conn.bytesAvailable() > 0:
            try:
                data = conn.readAll()
                msg = json.loads(data.data().decode("utf-8"))
                msg_type = msg.get("type", "")
                payload = msg.get("payload", {})
                self.message_received.emit(msg_type, payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

    def send_message(self, msg_type: str, payload: dict | None = None):
        if not HAS_QT:
            return
        from PySide6.QtNetwork import QLocalSocket
        sock = QLocalSocket()
        sock.connectToServer(self._server_name)
        if sock.waitForConnected(1000):
            msg = json.dumps({"type": msg_type, "payload": payload or {}})
            sock.write(msg.encode("utf-8"))
            sock.waitForBytesWritten(500)
            sock.disconnectFromServer()

    def shutdown(self):
        if self._server:
            self._server.close()
            self._server = None
        for conn in self._connections:
            try:
                conn.disconnectFromServer()
            except RuntimeError:
                pass
        self._connections.clear()


class PresentationModeManager(QObject):
    """Manages presentation mode for a window — fullscreen + minimal UI."""
    toggled = Signal(bool)

    def __init__(self, window: QMainWindow):
        super().__init__(window)
        self._window = window
        self._active = False
        self._saved_geometry: QRect | None = None
        self._saved_show_tabs = "multiple"

    @property
    def is_active(self) -> bool:
        return self._active

    def toggle(self):
        if self._active:
            self.exit()
        else:
            self.enter()

    def enter(self):
        if self._active:
            return
        self._saved_geometry = self._window.geometry()
        from ..core.config import get_config
        cfg = get_config()
        self._saved_show_tabs = getattr(cfg, "show_tabs", "multiple")
        cfg.show_tabs = "none"
        cfg.save()
        screen = QApplication.primaryScreen()
        if screen:
            geo = screen.availableGeometry()
            self._window.setGeometry(geo)
        self._window.showFullScreen()
        self._active = True
        self._update_ui_for_mode()
        self.toggled.emit(True)

    def exit(self):
        if not self._active:
            return
        from ..core.config import get_config
        cfg = get_config()
        cfg.show_tabs = self._saved_show_tabs
        cfg.save()
        if self._saved_geometry:
            self._window.setGeometry(self._saved_geometry)
        self._window.showNormal()
        self._active = False
        self._update_ui_for_mode()
        self.toggled.emit(False)

    def _update_ui_for_mode(self):
        win = self._window
        if hasattr(win, "_title_bar"):
            win._title_bar.setVisible(not self._active)
        if hasattr(win, "_status_bar"):
            win._status_bar.setVisible(not self._active)
        if hasattr(win, "_activity_bar"):
            win._activity_bar.setVisible(not self._active)
        if hasattr(win, "_editor_tabs"):
            for g in win._editor_tabs._groups:
                g._update_tab_row_visibility()


class WindowTaskbarProgress(QObject):
    """Windows taskbar progress indicator for long-running tasks."""

    def __init__(self, window: QMainWindow):
        super().__init__(window)
        self._window = window
        self._current_value = 0
        self._maximum = 100
        self._state = 0  # 0=no progress, 1=indeterminate, 2=normal, 4=paused, 8=error

    def set_progress(self, value: int, maximum: int = 100):
        self._current_value = value
        self._maximum = maximum
        self._state = 2
        self._apply()

    def set_indeterminate(self):
        self._state = 1
        self._apply()

    def set_paused(self):
        self._state = 4
        self._apply()

    def set_error(self):
        self._state = 8
        self._apply()

    def clear(self):
        self._state = 0
        self._apply()

    def _apply(self):
        if os.name != "nt":
            return
        try:
            import ctypes
            from ctypes import wintypes
            win_id = int(self._window.winId())
            taskbar_list = ctypes.windll.shell32.TaskbarList3
            if taskbar_list:
                taskbar_list.HrInit()
                if self._state == 0:
                    taskbar_list.SetProgressState(win_id, 0)
                elif self._state == 1:
                    taskbar_list.SetProgressState(win_id, 1)
                elif self._state in (2, 4, 8):
                    taskbar_list.SetProgressState(win_id, self._state)
                    if self._state == 2:
                        taskbar_list.SetProgressValue(win_id, self._current_value, self._maximum)
        except (AttributeError, ImportError, OSError):
            pass


class WindowJumpList:
    """Windows jump list for recent files in the taskbar."""

    def __init__(self, app_user_model_id: str = "DardcorCode"):
        self._app_id = app_user_model_id
        self._recent_items: list[str] = []

    def set_recent_files(self, file_paths: list[str]):
        self._recent_items = [p for p in file_paths if os.path.exists(p)][:20]
        self._apply()

    def add_recent_file(self, file_path: str):
        norm = os.path.normpath(file_path)
        if norm in self._recent_items:
            self._recent_items.remove(norm)
        self._recent_items.insert(0, norm)
        self._recent_items = self._recent_items[:20]
        self._apply()

    def _apply(self):
        if os.name != "nt":
            return
        try:
            import ctypes
            from ctypes import wintypes
            dest_list = ctypes.windll.shell32.SHAddToRecentDocs
            for path in self._recent_items:
                dest_list(2, ctypes.c_wchar_p(path))
        except (AttributeError, ImportError):
            pass


class DPIManager(QObject):
    """Multi-monitor DPI handling for proper scaling across screens."""

    def __init__(self, window: QMainWindow):
        super().__init__(window)
        self._window = window
        self._current_scale = 1.0
        self._screens: list[QScreen] = []

    def get_screen_for_window(self) -> QScreen | None:
        if not HAS_QT:
            return None
        screen = QApplication.screenAt(self._window.mapToGlobal(QPoint(0, 0)))
        return screen or QApplication.primaryScreen()

    def get_dpi_scale(self, screen: QScreen | None = None) -> float:
        if not HAS_QT or not screen:
            screen = self.get_screen_for_window()
        if not screen:
            return 1.0
        logical = screen.logicalDotsPerInch()
        return logical / 96.0 if logical > 0 else 1.0

    def scale_value(self, value: int, target_screen: QScreen | None = None) -> int:
        scale = self.get_dpi_scale(target_screen)
        return max(1, int(value * scale + 0.5))

    def update_window_scale(self):
        scale = self.get_dpi_scale()
        if abs(scale - self._current_scale) > 0.01:
            self._current_scale = scale
            self._window.setAttribute(Qt.WA_ContentsPropagated, True)


    def scale_font(self, base_size: int) -> int:
        return self.scale_value(base_size)

    def scale_geometry(self, x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
        screen = self.get_screen_for_window()
        scale = self.get_dpi_scale(screen)
        return (
            int(x * scale), int(y * scale),
            int(w * scale), int(h * scale)
        )


class SnapZoneOverlay(QWidget):
    """Visual overlay when window is being snapped (Windows Aero Snap)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(
            Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
            | Qt.X11BypassWindowManagerHint
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self._target_rect: QRect | None = None

    def show_for(self, rect: QRect):
        self._target_rect = rect
        self.setGeometry(rect)
        self.show()

    def hide_snap(self):
        self.hide()
        self._target_rect = None

    def paintEvent(self, event):
        if not self._target_rect:
            return
        from PySide6.QtGui import QPainter, QColor, QPen
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.fillRect(self.rect(), QColor(124, 58, 237, 40))
        pen = QPen(QColor(124, 58, 237, 200), 3)
        painter.setPen(pen)
        painter.drawRoundedRect(self.rect().adjusted(2, 2, -2, -2), 8, 8)
        painter.end()


class MultiWindowManager(QObject):
    """Manages lifecycle of multiple independent editor windows with IPC,
    persistence, DPI handling, taskbar integration, and snap support.
    """

    window_opened = Signal(int)
    window_closed = Signal(int)
    window_focus_changed = Signal(int)

    def __init__(self, parent: QObject | None = None):
        super().__init__(parent)
        self._windows: Dict[int, "MainWindow"] = {}
        self._lock = threading.RLock()
        self._window_factory: Optional[Callable[[Optional[str]], "MainWindow"]] = None
        self._active_window_id: Optional[int] = None
        self._listeners: List[Callable[[str, int], None]] = []
        self._persistence = WindowLayoutPersistence()
        self._ipc = MultiWindowIPC()
        self._ipc.message_received.connect(self._on_ipc_message)
        self._jump_list = WindowJumpList()
        self._snap_overlay: SnapZoneOverlay | None = None
        self._window_counter = 0

    def set_factory(self, factory: Callable[[Optional[str]], "MainWindow"]) -> None:
        self._window_factory = factory

    def start_ipc_server(self):
        self._ipc.start_server()

    def open_window(self, workspace_path: Optional[str] = None,
                    state: Optional[WindowState] = None,
                    restore_from_persistence: bool = False) -> Optional["MainWindow"]:
        if self._window_factory is None:
            return None
        if restore_from_persistence:
            state = self._restore_state_for_workspace(workspace_path)
        win = self._window_factory(workspace_path)
        if state:
            self._apply_state(win, state)
        self._window_counter += 1

        # Apply default size if no state
        if not state:
            screen = QApplication.primaryScreen()
            if screen:
                avail = screen.availableGeometry()
                win.resize(int(avail.width() * 0.8), int(avail.height() * 0.8))
                win.move(avail.x() + int(avail.width() * 0.1),
                         avail.y() + int(avail.height() * 0.1))
            else:
                win.resize(1000, 700)

        win_id = id(win)
        with self._lock:
            self._windows[win_id] = win
            self._active_window_id = win_id

        try:
            win.destroyed.connect(lambda: self._on_window_destroyed(win_id))
        except Exception:
            pass

        self._notify("open", win_id)
        self.window_opened.emit(win_id)
        return win

    def close_window(self, window_id: int) -> bool:
        with self._lock:
            win = self._windows.get(window_id)
        if win:
            self._save_window_state(win, window_id)
            try:
                win.close()
            except Exception:
                pass
            return True
        return False

    def _on_window_destroyed(self, window_id: int) -> None:
        with self._lock:
            self._windows.pop(window_id, None)
            if self._active_window_id == window_id:
                self._active_window_id = next(iter(self._windows)) if self._windows else None
        self._notify("close", window_id)
        self.window_closed.emit(window_id)
        if not self._windows:
            self._save_all_states()

    def get_focused_window(self) -> Optional["MainWindow"]:
        with self._lock:
            return self._windows.get(self._active_window_id)

    def get_all_windows(self) -> List["MainWindow"]:
        with self._lock:
            return list(self._windows.values())

    def get_window_count(self) -> int:
        with self._lock:
            return len(self._windows)

    def set_active_window(self, window_id: int) -> None:
        with self._lock:
            self._active_window_id = window_id
        self._notify("focus", window_id)
        self.window_focus_changed.emit(window_id)

    def _apply_state(self, win: "MainWindow", state: WindowState) -> None:
        try:
            if state.fullscreen:
                win.showFullScreen()
                return
            screen = QApplication.primaryScreen()
            if screen and state.screen_index >= 0:
                screens = QApplication.screens()
                if state.screen_index < len(screens):
                    screen = screens[state.screen_index]

            dpi = DPIManager(win)
            scale = state.dpi_scale if state.dpi_scale > 0 else dpi.get_dpi_scale(screen)
            x = max(-100, int(state.x * scale)) if state.x != -1 else 100
            y = max(-100, int(state.y * scale)) if state.y != -1 else 100
            w = max(400, int(state.width * scale)) if state.width > 0 else 1280
            h = max(300, int(state.height * scale)) if state.height > 0 else 800
            if screen:
                geo = screen.availableGeometry()
                w = min(w, geo.width())
                h = min(h, geo.height())
            win.setGeometry(int(x), int(y), int(w), int(h))
            if state.maximized:
                win.showMaximized()
            if hasattr(win, "setWindowTitle") and state.title:
                win.setWindowTitle(state.title)
            if hasattr(win, "_title_bar") and hasattr(win._title_bar.command_center, "set_title"):
                win._title_bar.command_center.set_title(state.title)
        except Exception:
            pass

    def _restore_state_for_workspace(self, workspace_path: Optional[str]) -> Optional[WindowState]:
        states = self._persistence.load()
        for s in states:
            if s.get("workspace_path") == workspace_path:
                return WindowState.from_dict(s)
        return None

    def _save_window_state(self, win: "MainWindow", window_id: int) -> None:
        try:
            state = WindowState()
            if win.isFullScreen():
                state.fullscreen = True
            else:
                geo = win.geometry()
                state.x = geo.x()
                state.y = geo.y()
                state.width = geo.width()
                state.height = geo.height()
                state.maximized = win.isMaximized()
            if hasattr(win, "_config"):
                state.workspace_path = win._config.workspace_path or ""
            if hasattr(win, "windowTitle"):
                state.title = win.windowTitle()
            screen = QApplication.screenAt(win.mapToGlobal(QPoint(0, 0)))
            if screen:
                screens = QApplication.screens()
                state.screen_index = screens.index(screen) if screen in screens else -1
            dpi = DPIManager(win)
            state.dpi_scale = dpi.get_dpi_scale(screen)
            self._persistence.save_single(state)
        except Exception:
            pass

    def save_states(self) -> List[dict]:
        states = []
        with self._lock:
            for win_id, win in self._windows.items():
                try:
                    state = WindowState()
                    if not win.isFullScreen():
                        geo = win.geometry()
                        state.x = geo.x()
                        state.y = geo.y()
                        state.width = geo.width()
                        state.height = geo.height()
                        state.maximized = win.isMaximized()
                    else:
                        state.fullscreen = True
                    if hasattr(win, "_config"):
                        state.workspace_path = win._config.workspace_path or ""
                    if hasattr(win, "windowTitle"):
                        state.title = win.windowTitle()
                    states.append(state.to_dict())
                except Exception:
                    pass
        return states

    def _save_all_states(self):
        states = self.save_states()
        self._persistence.save(states)

    def restore_all_windows(self) -> list["MainWindow"]:
        restored = []
        states = self._persistence.load()
        for s in states:
            state = WindowState.from_dict(s)
            win = self.open_window(state.workspace_path, state)
            if win:
                restored.append(win)
        return restored

    def send_ipc_message(self, msg_type: str, payload: dict | None = None):
        self._ipc.send_message(msg_type, payload)

    def _on_ipc_message(self, msg_type: str, payload: dict):
        if msg_type == "open_file":
            file_path = payload.get("path", "")
            focus_win = self.get_focused_window()
            if focus_win and hasattr(focus_win, "_open_file_in_editor"):
                focus_win._open_file_in_editor(file_path)
        elif msg_type == "focus_window":
            ws_path = payload.get("workspace_path", "")
            for win in self.get_all_windows():
                if hasattr(win, "_config") and win._config.workspace_path == ws_path:
                    win.raise_()
                    win.activateWindow()
                    break
        elif msg_type == "execute_command":
            cmd = payload.get("command", "")
            focus_win = self.get_focused_window()
            if focus_win and hasattr(focus_win, "_execute_command"):
                focus_win._execute_command(cmd)
        elif msg_type == "theme_changed":
            theme = payload.get("theme", "")
            for win in self.get_all_windows():
                if hasattr(win, "_set_theme"):
                    win._set_theme(theme)
        elif msg_type == "settings_changed":
            for win in self.get_all_windows():
                if hasattr(win, "_config"):
                    from ..core.config import reset_config
                    reset_config()
                    from ..core.config import get_config
                    win._config = get_config()

    def set_jump_list(self, file_paths: list[str]):
        self._jump_list.set_recent_files(file_paths)

    def add_jump_list_item(self, file_path: str):
        self._jump_list.add_recent_file(file_path)

    def create_snap_overlay(self) -> SnapZoneOverlay:
        if not self._snap_overlay:
            self._snap_overlay = SnapZoneOverlay()
        return self._snap_overlay

    def show_snap_overlay(self, rect: QRect):
        overlay = self.create_snap_overlay()
        overlay.show_for(rect)

    def hide_snap_overlay(self):
        if self._snap_overlay:
            self._snap_overlay.hide_snap()

    def on_window_event(self, callback: Callable[[str, int], None]) -> None:
        self._listeners.append(callback)

    def _notify(self, event: str, window_id: int) -> None:
        for cb in self._listeners:
            try:
                cb(event, window_id)
            except Exception:
                pass

    def shutdown(self):
        self._save_all_states()
        self._ipc.shutdown()
        if self._snap_overlay:
            self._snap_overlay.close()


# Global singleton
_multi_window_manager: Optional[MultiWindowManager] = None
_mwm_lock = threading.Lock()


def get_multi_window_manager() -> MultiWindowManager:
    global _multi_window_manager
    if _multi_window_manager is None:
        with _mwm_lock:
            if _multi_window_manager is None:
                _multi_window_manager = MultiWindowManager()
    return _multi_window_manager
