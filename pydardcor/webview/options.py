from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from ..core.uri import URI


@dataclass
class PortMapping:
    extension_host_port: int
    webview_port: int


@dataclass
class WebviewOptions:
    enable_scripts: bool = True
    enable_forms: bool = True
    enable_command_uris: bool = False
    local_resource_roots: List[URI] = field(default_factory=list)
    port_mapping: List[PortMapping] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Optional[Dict]) -> WebviewOptions:
        opts = cls()
        if not data:
            return opts
        if "enableScripts" in data:
            opts.enable_scripts = bool(data["enableScripts"])
        if "enableForms" in data:
            opts.enable_forms = bool(data["enableForms"])
        if "enableCommandUris" in data:
            opts.enable_command_uris = bool(data["enableCommandUris"])
        if "localResourceRoots" in data:
            roots = data["localResourceRoots"]
            if isinstance(roots, list):
                opts.local_resource_roots = [URI.parse(r) if isinstance(r, str) else r for r in roots]
            elif isinstance(roots, str):
                opts.local_resource_roots = [URI.parse(roots)]
        if "portMapping" in data:
            mappings = data["portMapping"]
            if isinstance(mappings, list):
                for m in mappings:
                    if isinstance(m, dict):
                        opts.port_mapping.append(PortMapping(
                            extension_host_port=m.get("extensionHostPort", m.get("extension_host_port", 0)),
                            webview_port=m.get("webviewPort", m.get("webview_port", 0)),
                        ))
        return opts

    def to_dict(self) -> dict:
        return {
            "enableScripts": self.enable_scripts,
            "enableForms": self.enable_forms,
            "enableCommandUris": self.enable_command_uris,
            "localResourceRoots": [str(u) for u in self.local_resource_roots],
            "portMapping": [{"extensionHostPort": p.extension_host_port, "webviewPort": p.webview_port} for p in self.port_mapping],
        }


@dataclass
class WebviewPanelOptions:
    retain_context_when_hidden: bool = False
    enable_find_widget: bool = True

    @classmethod
    def from_dict(cls, data: Optional[Dict]) -> WebviewPanelOptions:
        opts = cls()
        if not data:
            return opts
        if "retainContextWhenHidden" in data:
            opts.retain_context_when_hidden = bool(data["retainContextWhenHidden"])
        if "enableFindWidget" in data:
            opts.enable_find_widget = bool(data["enableFindWidget"])
        return opts

    def to_dict(self) -> dict:
        return {
            "retainContextWhenHidden": self.retain_context_when_hidden,
            "enableFindWidget": self.enable_find_widget,
        }


@dataclass
class WebviewViewOptions:
    retain_context_when_hidden: bool = False

    @classmethod
    def from_dict(cls, data: Optional[Dict]) -> WebviewViewOptions:
        opts = cls()
        if not data:
            return opts
        if "retainContextWhenHidden" in data:
            opts.retain_context_when_hidden = bool(data["retainContextWhenHidden"])
        return opts

    def to_dict(self) -> dict:
        return {
            "retainContextWhenHidden": self.retain_context_when_hidden,
        }
