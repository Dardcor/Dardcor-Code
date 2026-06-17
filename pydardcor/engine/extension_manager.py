"""Extension Manager - Functional extension system for Dardcor Code."""

import os
import json
import zipfile
import importlib.util
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Callable


EXTENSIONS_DIR = os.path.join(os.path.expanduser("~"), ".dardcor-code", "extensions")
BUILTIN_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extensions")


@dataclass
class InstalledExtension:
    name: str
    display_name: str
    description: str
    version: str
    publisher: str
    enabled: bool = True
    path: str = ""
    manifest: Optional[Dict[str, Any]] = None


@dataclass
class CommandEntry:
    command_id: str
    label: str
    handler: Callable
    shortcut: str = ""
    category: str = ""


@dataclass
class MenuItemEntry:
    menu: str
    label: str
    command_id: str
    shortcut: str = ""
    position: str = ""


@dataclass
class StatusBarEntry:
    item_id: str
    text: str
    tooltip: str = ""
    command_id: str = ""
    priority: int = 100
    color: str = ""


class DardcorAPI:
    """API object passed to extensions during activation."""

    def __init__(self, ext_name: str, manager: "ExtensionManager"):
        self._ext_name = ext_name
        self._manager = manager

    def register_command(self, command_id: str, label: str, handler: Callable, shortcut: str = ""):
        cmd_id = f"{self._ext_name}.{command_id}"
        entry = CommandEntry(cmd_id, label, handler, shortcut, self._ext_name)
        self._manager._commands[cmd_id] = entry
        return cmd_id

    def add_menu_item(self, menu: str, label: str, command_id: str, shortcut: str = "", position: str = ""):
        cmd_id = f"{self._ext_name}.{command_id}"
        item = MenuItemEntry(menu, label, cmd_id, shortcut, position)
        self._manager._menu_items.append(item)

    def add_status_bar_item(self, item_id: str, text: str, tooltip: str = "", command_id: str = "", priority: int = 100, color: str = ""):
        sid = f"{self._ext_name}.{item_id}"
        cmd_id = f"{self._ext_name}.{command_id}" if command_id else ""
        entry = StatusBarEntry(sid, text, tooltip, cmd_id, priority, color)
        self._manager._status_bar_items[sid] = entry

    def remove_status_bar_item(self, item_id: str):
        sid = f"{self._ext_name}.{item_id}"
        self._manager._status_bar_items.pop(sid, None)

    def show_info(self, message: str):
        self._manager._emit("notification", {"type": "info", "message": message})

    def show_warning(self, message: str):
        self._manager._emit("notification", {"type": "warning", "message": message})

    def show_error(self, message: str):
        self._manager._emit("notification", {"type": "error", "message": message})

    def get_active_editor_content(self) -> str:
        return self._manager._emit("get_active_editor_content", {}) or ""

    def get_active_editor_path(self) -> str:
        return self._manager._emit("get_active_editor_path", "") or ""

    def set_active_editor_content(self, content: str):
        self._manager._emit("set_active_editor_content", content)

    def insert_text_at_cursor(self, text: str):
        self._manager._emit("insert_text_at_cursor", text)

    def open_file(self, path: str):
        self._manager._emit("open_file", path)

    def get_config(self, key: str, default: Any = None) -> Any:
        return self._manager._emit("get_config", {"key": key, "default": default})

    def set_config(self, key: str, value: Any):
        self._manager._emit("set_config", {"key": key, "value": value})

    def get_workspace_path(self) -> str:
        return self._manager._emit("get_workspace_path", "") or ""

    def get_extension_path(self) -> str:
        if self._ext_name in self._manager._extensions:
            return self._manager._extensions[self._ext_name].path
        return ""

    def log(self, message: str):
        self._manager._emit("log", {"ext": self._ext_name, "message": message})

    def on_event(self, event_name: str, handler: Callable):
        self._manager._event_listeners.setdefault(event_name, []).append((self._ext_name, handler))

    def dispose(self):
        for event_name, listeners in self._manager._event_listeners.items():
            self._manager._event_listeners[event_name] = [
                (name, h) for name, h in listeners if name != self._ext_name
            ]


class ExtensionManager:
    """Manages extension discovery, installation, lifecycle, and event dispatch."""

    def __init__(self):
        os.makedirs(EXTENSIONS_DIR, exist_ok=True)
        self._extensions: Dict[str, InstalledExtension] = {}
        self._modules: Dict[str, Any] = {}
        self._apis: Dict[str, DardcorAPI] = {}
        self._commands: Dict[str, CommandEntry] = {}
        self._menu_items: List[MenuItemEntry] = []
        self._status_bar_items: Dict[str, StatusBarEntry] = {}
        self._event_listeners: Dict[str, List] = {}
        self._event_handlers: Dict[str, Callable] = {}
        self._node_extensions: set = set()
        self._load_installed_extensions()

    def set_event_handler(self, event_name: str, handler: Callable):
        self._event_handlers[event_name] = handler

    def _emit(self, event_name: str, data: Any = None) -> Any:
        if event_name in self._event_handlers:
            return self._event_handlers[event_name](data)
        return None

    def fire_event(self, event_name: str, data: Any = None):
        for name, handler in self._event_listeners.get(event_name, []):
            try:
                handler(data)
            except Exception:
                pass

    def _load_installed_extensions(self):
        for scan_dir in [BUILTIN_DIR, EXTENSIONS_DIR]:
            if not os.path.isdir(scan_dir):
                continue
            for entry in os.listdir(scan_dir):
                ext_dir = os.path.join(scan_dir, entry)
                manifest_path = os.path.join(ext_dir, "package.json")

                if os.path.isdir(ext_dir) and os.path.exists(manifest_path):
                    try:
                        with open(manifest_path, "r", encoding="utf-8") as f:
                            manifest_data = json.load(f)

                        ext = InstalledExtension(
                            name=manifest_data.get("name", entry),
                            display_name=manifest_data.get("displayName", manifest_data.get("name", entry)),
                            description=manifest_data.get("description", ""),
                            version=manifest_data.get("version", "1.0.0"),
                            publisher=manifest_data.get("publisher", "unknown"),
                            enabled=True,
                            path=ext_dir,
                            manifest=manifest_data,
                        )
                        if ext.name not in self._extensions:
                            self._extensions[ext.name] = ext
                    except Exception:
                        pass

    def get_installed_extensions(self) -> List[InstalledExtension]:
        return list(self._extensions.values())

    def install_from_vsix(self, vsix_path: str) -> InstalledExtension:
        if not os.path.exists(vsix_path):
            raise FileNotFoundError(f"VSIX file not found: {vsix_path}")

        with zipfile.ZipFile(vsix_path, "r") as zf:
            manifest_path = None
            for name in zf.namelist():
                if name.endswith("package.json") and "/" in name:
                    manifest_path = name
                    break
                elif name == "package.json":
                    manifest_path = name
                    break

            if not manifest_path:
                raise ValueError("Invalid VSIX: no package.json found")

            manifest_bytes = zf.read(manifest_path)
            manifest_data = json.loads(manifest_bytes)

            ext_name = manifest_data.get("name", "unknown-extension")
            ext_dir = os.path.join(EXTENSIONS_DIR, ext_name)

            if os.path.exists(ext_dir):
                import shutil
                shutil.rmtree(ext_dir)

            os.makedirs(ext_dir, exist_ok=True)

            ext_subfolder = os.path.dirname(manifest_path)
            for item in zf.namelist():
                if item.startswith(ext_subfolder) and ext_subfolder:
                    relative = item[len(ext_subfolder):].lstrip("/")
                    if not relative:
                        continue
                    target = os.path.join(ext_dir, relative)
                    if item.endswith("/"):
                        os.makedirs(target, exist_ok=True)
                    else:
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        with zf.open(item) as src, open(target, "wb") as dst:
                            dst.write(src.read())
                elif not ext_subfolder:
                    target = os.path.join(ext_dir, item)
                    if item.endswith("/"):
                        os.makedirs(target, exist_ok=True)
                    else:
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        with zf.open(item) as src, open(target, "wb") as dst:
                            dst.write(src.read())

        ext = InstalledExtension(
            name=manifest_data.get("name", ext_name),
            display_name=manifest_data.get("displayName", manifest_data.get("name", ext_name)),
            description=manifest_data.get("description", ""),
            version=manifest_data.get("version", "1.0.0"),
            publisher=manifest_data.get("publisher", "unknown"),
            enabled=True,
            path=ext_dir,
            manifest=manifest_data,
        )
        self._extensions[ext.name] = ext
        return ext

    def uninstall_extension(self, ext_name: str) -> bool:
        if ext_name not in self._extensions:
            return False
        self.deactivate_extension(ext_name)
        ext = self._extensions[ext_name]
        if os.path.exists(ext.path):
            import shutil
            shutil.rmtree(ext.path)
        del self._extensions[ext_name]
        return True

    def activate_extension(self, ext_name: str) -> Optional[DardcorAPI]:
        if ext_name not in self._extensions:
            return None

        ext = self._extensions[ext_name]
        if not ext.enabled:
            return None

        if ext_name in self._apis:
            return self._apis[ext_name]

        manifest = ext.manifest or {}
        main_file = manifest.get("main", "extension.py")
        main_path = os.path.join(ext.path, main_file)

        if not os.path.exists(main_path):
            return None

        if main_file.endswith(".js"):
            return self._activate_node_extension(ext_name, ext, manifest)

        if main_file.endswith(".py"):
            return self._activate_python_extension(ext_name, ext, main_path)

        return None

    def _activate_python_extension(self, ext_name: str, ext: InstalledExtension, main_path: str) -> Optional[DardcorAPI]:
        try:
            spec = importlib.util.spec_from_file_location(f"dardcor.ext.{ext_name}", main_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            api = DardcorAPI(ext_name, self)
            self._apis[ext_name] = api

            if hasattr(module, "activate"):
                module.activate(api)

            self._modules[ext_name] = module
            return api
        except Exception:
            return None

    def _activate_node_extension(self, ext_name: str, ext: InstalledExtension, manifest: dict) -> Optional[DardcorAPI]:
        from .extension_host import get_extension_host

        host = get_extension_host()
        if not host._ready:
            host.start(self._emit("get_workspace_path", "") or "")

        result = host.load_extension(ext.path)
        if not result:
            return None

        api = DardcorAPI(ext_name, self)
        self._apis[ext_name] = api
        self._node_extensions.add(ext_name)
        return api

    def deactivate_extension(self, ext_name: str):
        if ext_name in self._apis:
            self._apis[ext_name].dispose()
            del self._apis[ext_name]

        if ext_name in self._node_extensions:
            from .extension_host import get_extension_host
            host = get_extension_host()
            host.deactivate_extension(ext_name)
            self._node_extensions.discard(ext_name)

        if ext_name in self._modules:
            module = self._modules[ext_name]
            try:
                if hasattr(module, "deactivate"):
                    module.deactivate()
            except Exception:
                pass
            del self._modules[ext_name]

        self._commands = {k: v for k, v in self._commands.items() if not k.startswith(ext_name + ".")}
        self._menu_items = [m for m in self._menu_items if not m.command_id.startswith(ext_name + ".")]
        self._status_bar_items = {k: v for k, v in self._status_bar_items.items() if not k.startswith(ext_name + ".")}

    def toggle_extension(self, ext_name: str, enabled: bool):
        if ext_name in self._extensions:
            self._extensions[ext_name].enabled = enabled
            if not enabled:
                self.deactivate_extension(ext_name)

    def get_all_commands(self) -> Dict[str, CommandEntry]:
        return self._commands.copy()

    def get_menu_items(self) -> List[MenuItemEntry]:
        return list(self._menu_items)

    def get_status_bar_items(self) -> Dict[str, StatusBarEntry]:
        return self._status_bar_items.copy()

    def execute_command(self, command_id: str) -> bool:
        if command_id in self._commands:
            try:
                self._commands[command_id].handler()
                return True
            except Exception:
                return False
        return False

    def activate_all_enabled(self):
        for name, ext in self._extensions.items():
            if ext.enabled:
                self.activate_extension(name)

    def search_open_vsx(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        import urllib.request
        import urllib.parse

        try:
            encoded_query = urllib.parse.quote(query)
            url = f"https://open-vsx.org/api/-/search?query={encoded_query}&size={limit}"
            req = urllib.request.Request(url, headers={"User-Agent": "DardcorCode/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            results = []
            for ext in data.get("extensions", []):
                results.append({
                    "id": f"{ext.get('namespace', '')}/{ext.get('name', '')}",
                    "name": ext.get("name", ""),
                    "display_name": ext.get("displayName", ext.get("name", "")),
                    "description": ext.get("description", ""),
                    "publisher": ext.get("namespace", ""),
                    "version": ext.get("version", "0.0.0"),
                    "download_count": ext.get("downloadCount", 0),
                    "download_url": ext.get("files", {}).get("download", ""),
                })
            return results
        except Exception:
            return []

    def install_from_open_vsx(self, ext_id: str) -> Optional[InstalledExtension]:
        import urllib.request
        import urllib.parse
        import tempfile

        try:
            if "/" not in ext_id:
                return None

            parts = ext_id.split("/", 1)
            namespace, name = parts[0], parts[1]
            encoded_id = urllib.parse.quote(f"{namespace}/{name}")

            version_url = f"https://open-vsx.org/api/{encoded_id}/latest"
            req = urllib.request.Request(version_url, headers={"User-Agent": "DardcorCode/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                ext_data = json.loads(resp.read().decode("utf-8"))

            download_url = ext_data.get("files", {}).get("download")
            if not download_url:
                return None

            with tempfile.NamedTemporaryFile(suffix=".vsix", delete=False) as tmp:
                tmp_req = urllib.request.Request(download_url, headers={"User-Agent": "DardcorCode/1.0"})
                with urllib.request.urlopen(tmp_req, timeout=60) as dl_resp:
                    tmp.write(dl_resp.read())
                tmp_path = tmp.name

            return self.install_from_vsix(tmp_path)
        except Exception:
            return None


_instance = None


def get_extension_manager() -> ExtensionManager:
    global _instance
    if _instance is None:
        _instance = ExtensionManager()
    return _instance
