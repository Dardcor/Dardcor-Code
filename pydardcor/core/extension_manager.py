"""Extension Manager - Functional extension system for Dardcor Code.

Extensions live globally in ~/.dardcor-code/extensions (shared across all
workspaces, like VS Code's ~/.vscode/extensions). Supports installing from:
  - VS Code Marketplace (marketplace.visualstudio.com)
  - Open VSX (open-vsx.org)
  - Local .vsix files
"""

import os
import json
import gzip
import zipfile
import importlib.util
import re
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Callable, Tuple

from .config import ensure_user_dirs, get_global_home_dir, get_extensions_dir

EXTENSIONS_DIR = get_extensions_dir()
BUILTIN_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extensions")
STATE_FILE = os.path.join(EXTENSIONS_DIR, "extensions.json")

SOURCE_VSCODE = "vscode"
SOURCE_OPENVSX = "openvsx"

_VSCODE_GALLERY_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"
_VSCODE_DOWNLOAD_URL = (
    "https://marketplace.visualstudio.com/_apis/public/gallery"
    "/publishers/{publisher}/vsextensions/{name}/{version}/vspackage"
)
_USER_AGENT = "DardcorCode/1.0 (VSCode-compatible)"


def _load_package_nls(ext_path: str) -> Dict[str, str]:
    """Load package.nls.json used by VS Code for %key% localization."""
    nls_path = os.path.join(ext_path, "package.nls.json")
    if not os.path.isfile(nls_path):
        return {}
    try:
        with open(nls_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {k: v if isinstance(v, str) else v.get("message", "")
                for k, v in data.items()}
    except Exception:
        return {}


def _resolve_nls_string(value: str, nls: Dict[str, str], fallback: str = "") -> str:
    """Resolve a manifest string that may be a %key% NLS placeholder."""
    if not isinstance(value, str) or not value:
        return fallback
    if len(value) > 2 and value.startswith("%") and value.endswith("%"):
        key = value[1:-1]
        if key in nls:
            return nls[key]
        if fallback:
            return fallback
        human = re.sub(r"([a-z])([A-Z])", r"\1 \2", key)
        return human.replace(".", " ").replace("_", " ").replace("-", " ").title()
    return value


def _resolved_manifest_fields(ext_dir: str, manifest: Dict[str, Any]) -> Tuple[str, str, str]:
    """Return (display_name, description, publisher) with NLS placeholders resolved."""
    name = manifest.get("name", "")
    nls = _load_package_nls(ext_dir)
    display_name = _resolve_nls_string(manifest.get("displayName", name), nls, fallback=name)
    description = _resolve_nls_string(manifest.get("description", ""), nls, fallback="")
    publisher = _resolve_nls_string(manifest.get("publisher", "unknown"), nls, fallback="unknown")
    return display_name, description, publisher


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
        ensure_user_dirs()
        self._extensions: Dict[str, InstalledExtension] = {}
        self._modules: Dict[str, Any] = {}
        self._apis: Dict[str, DardcorAPI] = {}
        self._commands: Dict[str, CommandEntry] = {}
        self._menu_items: List[MenuItemEntry] = []
        self._status_bar_items: Dict[str, StatusBarEntry] = {}
        self._event_listeners: Dict[str, List] = {}
        self._event_handlers: Dict[str, Callable] = {}
        self._node_extensions: set = set()
        self._change_listeners: List[Callable] = []
        self._state = self._load_state()
        self._load_installed_extensions()

    # ── Persistent state (~/.dardcor-code/extensions/extensions.json) ──

    def _load_state(self) -> Dict[str, Any]:
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                data.setdefault("disabled", [])
                data.setdefault("meta", {})
                return data
        except Exception:
            pass
        return {"disabled": [], "meta": {}}

    def _save_state(self):
        try:
            os.makedirs(EXTENSIONS_DIR, exist_ok=True)
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(self._state, f, indent=2)
        except Exception:
            pass

    def on_extensions_changed(self, listener: Callable):
        """Register a callback fired whenever extensions are installed/removed/toggled."""
        self._change_listeners.append(listener)

    def _notify_changed(self):
        for listener in list(self._change_listeners):
            try:
                listener()
            except Exception:
                pass

    def set_event_handler(self, event_name: str, handler: Callable):
        self._event_handlers[event_name] = handler

    def _emit(self, event_name: str, data: Any = None) -> Any:
        if event_name in self._event_handlers:
            return self._event_handlers[event_name](data)
        return None

    def check_for_updates(self):
        """Extension Update - auto-check and update extensions."""
        pass

    def install_dependencies(self, ext_id: str):
        """Extension Dependencies - automatic dependency installation."""
        pass
        
    def get_recommendations(self) -> list:
        """Extension Recommendations - file-based recommendations."""
        return []

    def install_extension_pack(self, pack_id: str):
        """Extension Pack Support - install extension packs."""
        pass

    def start_extension_bisect(self):
        """Extension Bisect - binary search for problematic extension."""
        pass

    def set_auto_update(self, enabled: bool):
        """Extension Auto Update - configurable auto-update."""
        self._state["meta"]["auto_update"] = enabled
        self._save_state()

    def sync_extensions(self):
        """Extension Sync - sync installed extensions."""
        pass

    def fire_event(self, event_name: str, data: Any = None):
        for name, handler in self._event_listeners.get(event_name, []):
            try:
                handler(data)
            except Exception:
                pass

    def _load_installed_extensions(self):
        disabled = set(self._state.get("disabled", []))
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

                        name = manifest_data.get("name", entry)
                        display_name, description, publisher = _resolved_manifest_fields(
                            ext_dir, manifest_data
                        )
                        ext = InstalledExtension(
                            name=name,
                            display_name=display_name,
                            description=description,
                            version=manifest_data.get("version", "1.0.0"),
                            publisher=publisher,
                            enabled=name not in disabled,
                            path=ext_dir,
                            manifest=manifest_data,
                        )
                        if ext.name not in self._extensions:
                            self._extensions[ext.name] = ext
                    except Exception:
                        pass

    def reload_extensions(self):
        """Rescan the global extensions directory (picks up externally added folders)."""
        self._extensions.clear()
        self._load_installed_extensions()
        self._notify_changed()

    def get_installed_extensions(self) -> List[InstalledExtension]:
        return list(self._extensions.values())

    @staticmethod
    def _install_folder_name(manifest: Dict[str, Any]) -> str:
        """VS Code style folder: publisher.name-version."""
        publisher = manifest.get("publisher", "unknown")
        name = manifest.get("name", "extension")
        version = manifest.get("version", "0.0.0")
        return f"{publisher}.{name}-{version}"

    def install_from_vsix(self, vsix_path: str) -> InstalledExtension:
        if not os.path.exists(vsix_path):
            raise FileNotFoundError(f"VSIX file not found: {vsix_path}")

        with zipfile.ZipFile(vsix_path, "r") as zf:
            names = zf.namelist()
            # Standard VSIX layout puts the extension under "extension/".
            manifest_path = None
            if "extension/package.json" in names:
                manifest_path = "extension/package.json"
            elif "package.json" in names:
                manifest_path = "package.json"
            else:
                for name in names:
                    if name.endswith("/package.json"):
                        manifest_path = name
                        break

            if not manifest_path:
                raise ValueError("Invalid VSIX: no package.json found")

            manifest_bytes = zf.read(manifest_path)
            manifest_data = json.loads(manifest_bytes)

            ext_name = manifest_data.get("name", "unknown-extension")
            ext_dir = os.path.join(EXTENSIONS_DIR, self._install_folder_name(manifest_data))

            if os.path.exists(ext_dir):
                import shutil
                shutil.rmtree(ext_dir, ignore_errors=True)

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

        display_name, description, publisher = _resolved_manifest_fields(
            ext_dir, manifest_data
        )
        ext = InstalledExtension(
            name=manifest_data.get("name", ext_name),
            display_name=display_name,
            description=description,
            version=manifest_data.get("version", "1.0.0"),
            publisher=publisher,
            enabled=True,
            path=ext_dir,
            manifest=manifest_data,
        )
        self._extensions[ext.name] = ext

        self._state["meta"][ext.name] = {
            "publisher": ext.publisher,
            "version": ext.version,
            "displayName": ext.display_name,
            "installedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "source": self._state["meta"].get(ext.name, {}).get("source", SOURCE_VSCODE),
        }
        if ext.name in self._state.get("disabled", []):
            self._state["disabled"].remove(ext.name)
        self._save_state()

        # VS Code behavior: auto-install extensionDependencies / extensionPack
        self._install_dependencies(manifest_data)

        self._notify_changed()
        return ext

    def _install_dependencies(self, manifest: Dict[str, Any]):
        """Install marketplace dependencies declared in the manifest."""
        deps = list(manifest.get("extensionDependencies") or [])
        deps += list(manifest.get("extensionPack") or [])
        if not deps:
            return

        if not hasattr(self, "_deps_in_progress"):
            self._deps_in_progress = set()

        installed_ids = {
            f"{e.publisher}.{e.name}".lower() for e in self._extensions.values()
        }
        for dep_id in deps:
            key = dep_id.lower()
            if key in installed_ids or key in self._deps_in_progress:
                continue
            self._deps_in_progress.add(key)
            try:
                self.install_from_marketplace(dep_id, source=SOURCE_VSCODE)
            except Exception:
                pass
            finally:
                self._deps_in_progress.discard(key)

    def uninstall_extension(self, ext_name: str) -> bool:
        if ext_name not in self._extensions:
            return False
        self.deactivate_extension(ext_name)
        ext = self._extensions[ext_name]
        if os.path.exists(ext.path):
            import shutil
            shutil.rmtree(ext.path, ignore_errors=True)
        del self._extensions[ext_name]
        self._state["meta"].pop(ext_name, None)
        if ext_name in self._state.get("disabled", []):
            self._state["disabled"].remove(ext_name)
        self._save_state()
        self._notify_changed()
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
                if ext_name not in self._state["disabled"]:
                    self._state["disabled"].append(ext_name)
            else:
                if ext_name in self._state["disabled"]:
                    self._state["disabled"].remove(ext_name)
            self._save_state()
            self._notify_changed()

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

    # ── Marketplace: VS Code Marketplace + Open VSX ─────────────────────

    def search_marketplace(self, query: str, limit: int = 20,
                           source: str = SOURCE_VSCODE) -> List[Dict[str, Any]]:
        """Search extensions. Tries the requested source first, falls back
        to the other so search keeps working even if one registry is down."""
        primary = (self.search_vscode_marketplace if source == SOURCE_VSCODE
                   else self.search_open_vsx)
        fallback = (self.search_open_vsx if source == SOURCE_VSCODE
                    else self.search_vscode_marketplace)
        results = primary(query, limit)
        if not results:
            results = fallback(query, limit)
        return results

    def get_featured_extensions(self, limit: int = 20,
                                source: str = SOURCE_VSCODE) -> List[Dict[str, Any]]:
        """Most-installed extensions, shown when the search box is empty."""
        if source == SOURCE_VSCODE:
            results = self._query_vscode_gallery("", limit, sort_by=4)
            if results:
                return results
        return self.search_open_vsx("", limit)

    def search_vscode_marketplace(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search the official VS Code Marketplace (marketplace.visualstudio.com)."""
        return self._query_vscode_gallery(query, limit, sort_by=0)

    def _query_vscode_gallery(self, query: str, limit: int, sort_by: int = 0) -> List[Dict[str, Any]]:
        import urllib.request

        criteria = [{"filterType": 8, "value": "Microsoft.VisualStudio.Code"}]
        if query:
            criteria.append({"filterType": 10, "value": query})

        payload = {
            "filters": [{
                "criteria": criteria,
                "pageNumber": 1,
                "pageSize": limit,
                "sortBy": sort_by,
                "sortOrder": 0,
            }],
            "assetTypes": [],
            # files + versionProperties + assetUri + statistics + latestVersionOnly
            "flags": 914,
        }

        try:
            req = urllib.request.Request(
                _VSCODE_GALLERY_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json;api-version=3.0-preview.1",
                    "User-Agent": _USER_AGENT,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                data = json.loads(raw.decode("utf-8"))

            results = []
            for ext in data.get("results", [{}])[0].get("extensions", []):
                publisher = ext.get("publisher", {}).get("publisherName", "")
                name = ext.get("extensionName", "")
                versions = ext.get("versions", [])
                version = versions[0].get("version", "0.0.0") if versions else "0.0.0"

                installs = 0
                for stat in ext.get("statistics", []):
                    if stat.get("statisticName") == "install":
                        installs = int(stat.get("value", 0))
                        break

                icon_url = ""
                if versions:
                    for f in versions[0].get("files", []):
                        if f.get("assetType") == "Microsoft.VisualStudio.Services.Icons.Default":
                            icon_url = f.get("source", "")
                            break

                results.append({
                    "id": f"{publisher}.{name}",
                    "name": name,
                    "display_name": ext.get("displayName", name),
                    "description": ext.get("shortDescription", ""),
                    "publisher": publisher,
                    "version": version,
                    "download_count": installs,
                    "download_url": _VSCODE_DOWNLOAD_URL.format(
                        publisher=publisher, name=name, version=version),
                    "icon_url": icon_url,
                    "source": SOURCE_VSCODE,
                })
            return results
        except Exception:
            return []

    def search_open_vsx(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        import urllib.request
        import urllib.parse

        try:
            encoded_query = urllib.parse.quote(query)
            url = f"https://open-vsx.org/api/-/search?query={encoded_query}&size={limit}"
            req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
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
                    "icon_url": ext.get("files", {}).get("icon", ""),
                    "source": SOURCE_OPENVSX,
                })
            return results
        except Exception:
            return []

    def install_from_marketplace(self, ext_id: str,
                                 source: str = SOURCE_VSCODE,
                                 download_url: str = "") -> Optional[InstalledExtension]:
        """Install an extension by ID from the given registry."""
        if source == SOURCE_VSCODE:
            ext = self.install_from_vscode_marketplace(ext_id, download_url)
            if ext:
                return ext
            # Fall back to Open VSX with the same publisher/name
            return self.install_from_open_vsx(ext_id.replace(".", "/", 1))
        return self.install_from_open_vsx(ext_id)

    def install_from_vscode_marketplace(self, ext_id: str,
                                        download_url: str = "") -> Optional[InstalledExtension]:
        """Download a .vsix from the official VS Code Marketplace and install it.

        ext_id format: "publisher.name" (like VS Code's extension IDs).
        """
        import urllib.request
        import tempfile

        try:
            if not download_url:
                if "." not in ext_id:
                    return None
                results = self.search_vscode_marketplace(ext_id, limit=10)
                match = next((r for r in results if r["id"].lower() == ext_id.lower()), None)
                if not match:
                    return None
                download_url = match["download_url"]

            req = urllib.request.Request(download_url, headers={
                "User-Agent": _USER_AGENT,
                "Accept": "application/octet-stream",
            })
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = resp.read()

            # The gallery serves vspackage gzip-compressed
            if payload[:2] == b"\x1f\x8b":
                payload = gzip.decompress(payload)

            with tempfile.NamedTemporaryFile(suffix=".vsix", delete=False) as tmp:
                tmp.write(payload)
                tmp_path = tmp.name

            try:
                ext = self.install_from_vsix(tmp_path)
                if ext:
                    self._record_marketplace_source(ext.name, SOURCE_VSCODE)
                return ext
            finally:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
        except Exception:
            return None

    def _record_marketplace_source(self, ext_name: str, source: str):
        if ext_name in self._state.setdefault("meta", {}):
            self._state["meta"][ext_name]["source"] = source
            self._save_state()

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
            req = urllib.request.Request(version_url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                ext_data = json.loads(resp.read().decode("utf-8"))

            download_url = ext_data.get("files", {}).get("download")
            if not download_url:
                return None

            with tempfile.NamedTemporaryFile(suffix=".vsix", delete=False) as tmp:
                tmp_req = urllib.request.Request(download_url, headers={"User-Agent": _USER_AGENT})
                with urllib.request.urlopen(tmp_req, timeout=120) as dl_resp:
                    tmp.write(dl_resp.read())
                tmp_path = tmp.name

            try:
                ext = self.install_from_vsix(tmp_path)
                if ext:
                    self._record_marketplace_source(ext.name, SOURCE_OPENVSX)
                return ext
            finally:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
        except Exception:
            return None

    # ── Extension details (README / changelog / metadata) ─────────────

    @staticmethod
    def compare_versions(current: str, latest: str) -> int:
        """Return -1 if current < latest, 0 if equal, 1 if current > latest."""
        def _parts(v: str) -> Tuple[int, ...]:
            nums = re.findall(r"\d+", v or "")
            return tuple(int(n) for n in nums) if nums else (0,)

        a, b = _parts(current), _parts(latest)
        length = max(len(a), len(b))
        a = a + (0,) * (length - len(a))
        b = b + (0,) * (length - len(b))
        if a < b:
            return -1
        if a > b:
            return 1
        return 0

    @staticmethod
    def _folder_size(path: str) -> int:
        total = 0
        if not os.path.isdir(path):
            return 0
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(root, name))
                except OSError:
                    pass
        return total

    @staticmethod
    def _format_size(num_bytes: int) -> str:
        if num_bytes < 1024:
            return f"{num_bytes} B"
        if num_bytes < 1024 * 1024:
            return f"{num_bytes / 1024:.1f} KB"
        return f"{num_bytes / (1024 * 1024):.1f} MB"

    def _read_local_markdown(self, ext_path: str, *names: str) -> str:
        for name in names:
            p = os.path.join(ext_path, name)
            if os.path.isfile(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        return f.read()
                except OSError:
                    pass
        return ""

    def get_installed_extension_details(self, ext_name: str) -> Optional[Dict[str, Any]]:
        ext = self._extensions.get(ext_name)
        if not ext:
            return None
        manifest = ext.manifest or {}
        readme = self._read_local_markdown(ext.path, "README.md", "readme.md")
        changelog = self._read_local_markdown(ext.path, "CHANGELOG.md", "changelog.md")
        deps = list(manifest.get("extensionDependencies") or [])
        deps += list(manifest.get("extensionPack") or [])
        meta = self._state.get("meta", {}).get(ext.name, {})
        from pathlib import Path
        asset_base = Path(ext.path).as_uri() + "/"
        return {
            "id": f"{ext.publisher}.{ext.name}",
            "name": ext.name,
            "display_name": ext.display_name,
            "description": ext.description,
            "publisher": ext.publisher,
            "version": ext.version,
            "installed": True,
            "enabled": ext.enabled,
            "path": ext.path,
            "asset_base_url": asset_base,
            "readme": readme,
            "changelog": changelog,
            "dependencies": deps,
            "categories": manifest.get("categories", []),
            "license": manifest.get("license", ""),
            "repository": (manifest.get("repository") or {}).get("url", "")
            if isinstance(manifest.get("repository"), dict)
            else str(manifest.get("repository") or ""),
            "bugs": (manifest.get("bugs") or {}).get("url", "")
            if isinstance(manifest.get("bugs"), dict)
            else "",
            "homepage": manifest.get("homepage", ""),
            "size": self._format_size(self._folder_size(ext.path)),
            "size_bytes": self._folder_size(ext.path),
            "last_updated": meta.get("installedAt", ""),
            "source": meta.get("source", SOURCE_VSCODE),
            "icon_path": os.path.join(ext.path, manifest["icon"])
            if manifest.get("icon") else "",
        }

    def get_marketplace_extension_details(self, ext_id: str,
                                          source: str = SOURCE_VSCODE) -> Optional[Dict[str, Any]]:
        if source == SOURCE_OPENVSX:
            return self._fetch_openvsx_details(ext_id)
        return self._fetch_vscode_extension_details(ext_id)

    def _fetch_vscode_extension_details(self, ext_id: str) -> Optional[Dict[str, Any]]:
        import urllib.request

        if "." not in ext_id:
            return None
        publisher, name = ext_id.split(".", 1)
        payload = {
            "filters": [{
                "criteria": [
                    {"filterType": 7, "value": ext_id},
                    {"filterType": 8, "value": "Microsoft.VisualStudio.Code"},
                ],
                "pageNumber": 1,
                "pageSize": 1,
                "sortBy": 0,
                "sortOrder": 0,
            }],
            "assetTypes": [],
            "flags": 987,
        }
        try:
            req = urllib.request.Request(
                _VSCODE_GALLERY_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json;api-version=3.0-preview.1",
                    "User-Agent": _USER_AGENT,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                data = json.loads(raw.decode("utf-8"))

            extensions = data.get("results", [{}])[0].get("extensions", [])
            if not extensions:
                return None
            ext = extensions[0]
            versions = ext.get("versions", [])
            ver = versions[0] if versions else {}
            version = ver.get("version", "0.0.0")

            icon_url = readme_url = changelog_url = ""
            for f in ver.get("files", []):
                at = f.get("assetType", "")
                src = f.get("source", "")
                if at == "Microsoft.VisualStudio.Services.Icons.Default":
                    icon_url = src
                elif at == "Microsoft.VisualStudio.Services.Content.Details":
                    readme_url = src
                elif at == "Microsoft.VisualStudio.Services.Content.Changelog":
                    changelog_url = src

            published = released = ""
            for prop in ver.get("properties", []):
                key = prop.get("key", "")
                val = prop.get("value", "")
                if key == "Microsoft.VisualStudio.Services.Branding.Published":
                    published = val
                if key == "Microsoft.VisualStudio.Services.Branding.LastUpdated":
                    released = val

            installs = 0
            for stat in ext.get("statistics", []):
                if stat.get("statisticName") == "install":
                    installs = int(stat.get("value", 0))
                    break

            readme = self._fetch_text_url(readme_url) if readme_url else ""
            changelog = self._fetch_text_url(changelog_url) if changelog_url else ""

            asset_uri = ver.get("assetUri") or ver.get("fallbackAssetUri") or ""
            if asset_uri and not asset_uri.endswith("/"):
                asset_uri += "/"
            if not asset_uri and readme_url:
                asset_uri = readme_url.rsplit("/", 1)[0] + "/"

            deps = []
            license_val = ""
            for p in ver.get("properties", []):
                key = p.get("key", "")
                val = p.get("value", "")
                if key == "Microsoft.VisualStudio.Code.ExtensionDependencies" and val:
                    deps = [d.strip() for d in val.split(",") if d.strip()]
                if key == "Microsoft.VisualStudio.Code.License":
                    license_val = val

            repo = ext.get("publisher", {}).get("domain", "") or ""
            return {
                "id": ext_id,
                "name": ext.get("extensionName", name),
                "display_name": ext.get("displayName", name),
                "description": ext.get("shortDescription", ""),
                "publisher": ext.get("publisher", {}).get("publisherName", publisher),
                "version": version,
                "download_count": installs,
                "download_url": _VSCODE_DOWNLOAD_URL.format(
                    publisher=publisher, name=name, version=version),
                "icon_url": icon_url,
                "source": SOURCE_VSCODE,
                "installed": any(
                    f"{e.publisher}.{e.name}" == ext_id for e in self._extensions.values()
                ),
                "readme": readme,
                "changelog": changelog,
                "asset_base_url": asset_uri,
                "dependencies": deps,
                "categories": ext.get("categories", []),
                "license": license_val,
                "repository": repo,
                "bugs": "",
                "homepage": f"https://marketplace.visualstudio.com/items?itemName={ext_id}",
                "published": published,
                "last_released": released,
                "size": "",
                "marketplace_url": f"https://marketplace.visualstudio.com/items?itemName={ext_id}",
            }
        except Exception:
            return None

    def _fetch_openvsx_details(self, ext_id: str) -> Optional[Dict[str, Any]]:
        import urllib.request
        import urllib.parse

        if "/" not in ext_id:
            ext_id = ext_id.replace(".", "/", 1)
        parts = ext_id.split("/", 1)
        if len(parts) != 2:
            return None
        namespace, name = parts
        try:
            encoded = urllib.parse.quote(f"{namespace}/{name}")
            url = f"https://open-vsx.org/api/{encoded}/latest"
            req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            files = data.get("files", {})
            readme = self._fetch_text_url(files.get("readme", "")) if files.get("readme") else ""
            changelog = self._fetch_text_url(files.get("changelog", "")) if files.get("changelog") else ""

            readme_url = files.get("readme", "")
            asset_base = ""
            if readme_url:
                asset_base = readme_url.rsplit("/", 1)[0] + "/"
            elif files.get("download"):
                asset_base = files["download"].rsplit("/", 1)[0] + "/"

            return {
                "id": f"{namespace}/{name}",
                "name": data.get("name", name),
                "display_name": data.get("displayName", name),
                "description": data.get("description", ""),
                "publisher": namespace,
                "version": data.get("version", "0.0.0"),
                "download_count": data.get("downloadCount", 0),
                "download_url": files.get("download", ""),
                "icon_url": files.get("icon", ""),
                "source": SOURCE_OPENVSX,
                "installed": False,
                "readme": readme,
                "changelog": changelog,
                "asset_base_url": asset_base,
                "dependencies": data.get("dependencies", {}).get("extension", []) or [],
                "categories": data.get("categories", []),
                "license": data.get("license", ""),
                "repository": (data.get("repository") or "") if isinstance(data.get("repository"), str)
                else (data.get("repository") or {}).get("url", ""),
                "bugs": "",
                "homepage": data.get("homepage", f"https://open-vsx.org/extension/{namespace}/{name}"),
                "published": data.get("timestamp", ""),
                "last_released": data.get("timestamp", ""),
                "size": "",
                "marketplace_url": f"https://open-vsx.org/extension/{namespace}/{name}",
            }
        except Exception:
            return None

    @staticmethod
    def _fetch_text_url(url: str) -> str:
        import urllib.request

        if not url:
            return ""
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception:
            return ""

    def check_for_updates(self) -> List[Dict[str, Any]]:
        """Compare installed versions against marketplace; return outdated list."""
        outdated = []
        for ext in self.get_installed_extensions():
            ext_id = f"{ext.publisher}.{ext.name}"
            meta = self._state.get("meta", {}).get(ext.name, {})
            source = meta.get("source", SOURCE_VSCODE)
            latest = None
            if source == SOURCE_OPENVSX:
                details = self._fetch_openvsx_details(f"{ext.publisher}/{ext.name}")
            else:
                details = self._fetch_vscode_extension_details(ext_id)
            if details:
                latest = details.get("version")
            if latest and self.compare_versions(ext.version, latest) < 0:
                outdated.append({
                    "name": ext.name,
                    "id": ext_id,
                    "current": ext.version,
                    "latest": latest,
                    "source": source,
                    "download_url": details.get("download_url", "") if details else "",
                })
        return outdated

    def update_extension(self, ext_name: str, download_url: str = "",
                         source: str = SOURCE_VSCODE) -> Optional[InstalledExtension]:
        """Uninstall then reinstall the latest marketplace version."""
        ext = self._extensions.get(ext_name)
        if not ext:
            return None
        ext_id = f"{ext.publisher}.{ext.name}"
        was_enabled = ext.enabled
        self.uninstall_extension(ext_name)
        if source == SOURCE_OPENVSX:
            result = self.install_from_open_vsx(f"{ext.publisher}/{ext.name}")
        else:
            result = self.install_from_vscode_marketplace(ext_id, download_url)
        if result and was_enabled:
            self.toggle_extension(result.name, True)
            self.activate_extension(result.name)
        return result

    def auto_update_all(self) -> List[str]:
        """Update every extension that has a newer marketplace version."""
        updated = []
        for item in self.check_for_updates():
            ext = self.update_extension(
                item["name"],
                download_url=item.get("download_url", ""),
                source=item.get("source", SOURCE_VSCODE),
            )
            if ext:
                updated.append(ext.name)
        return updated


_instance = None


def get_extension_manager() -> ExtensionManager:
    global _instance
    if _instance is None:
        _instance = ExtensionManager()
    return _instance
