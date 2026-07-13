from __future__ import annotations
import os
import re
import json
import base64
import logging
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field
from ..core.uri import URI

logger = logging.getLogger(__name__)


def sanitize_html(html: str) -> str:
    if not html:
        return html
    html = html.replace("\0", "")
    html = re.sub(r'<script[^>]*>', lambda m: m.group(0).replace('src="javascript:', 'src="') if 'src=' in m.group(0) else m.group(0), html)
    html = re.sub(r'<[^>]*\s(on\w+)\s*=\s*["\']?[^"\' >]+["\']?', '', html, flags=re.IGNORECASE)
    html = re.sub(r'(javascript|data|vbscript):', '', html, flags=re.IGNORECASE)
    return html


class WebviewCSP:
    DEFAULT_CSP = (
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: filesystem:; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: file: filesystem: https: http:; "
        "font-src 'self' data: blob:; "
        "connect-src 'self' data: blob: https: http: ws: wss:; "
        "media-src 'self' blob: data:; "
        "frame-src 'self' blob: data:; "
        "object-src 'none'"
    )

    STRICT_CSP = (
        "default-src 'none'; "
        "script-src 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "frame-src 'none'; "
        "object-src 'none'"
    )

    VSOCODE_RESOURCE_SOURCE = "vscode-resource.vscode-cdn.net"

    def __init__(self, enable_scripts: bool = True, local_resource_roots: Optional[List[URI]] = None):
        self.enable_scripts = enable_scripts
        self.local_resource_roots = local_resource_roots or []
        self._allowed_schemes: Set[str] = {"data", "blob", "filesystem", "https", "http"}

    def add_allowed_scheme(self, scheme: str):
        self._allowed_schemes.add(scheme)

    def generate_csp_string(self) -> str:
        parts = ["default-src 'self'"]
        script_part = "'self' 'unsafe-inline' blob: data: filesystem:"
        if self.enable_scripts:
            script_part += " 'unsafe-eval'"

        script_src = f"script-src {script_part}"
        style_src = "style-src 'self' 'unsafe-inline'"
        img_src = "img-src 'self' data: blob: file: filesystem: https: http:"
        font_src = "font-src 'self' data: blob:"
        connect_src = "connect-src 'self' data: blob: https: http: ws: wss:"
        frame_src = "frame-src 'self' blob: data:"
        media_src = "media-src 'self' blob: data:"
        object_src = "object-src 'none'"

        local_root_directives = []
        for root in self.local_resource_roots:
            local_root_directives.append(str(root))

        if local_root_directives:
            img_src += " " + " ".join(local_root_directives)
            script_src += " " + " ".join(local_root_directives)
            style_src += " " + " ".join(local_root_directives)

        return "; ".join([
            "default-src 'self'",
            script_src,
            style_src,
            img_src,
            font_src,
            connect_src,
            frame_src,
            media_src,
            object_src,
        ])

    def generate_csp_meta(self) -> str:
        csp = self.generate_csp_string()
        return f'<meta http-equiv="Content-Security-Policy" content="{csp}">'

    @property
    def csp_source(self) -> str:
        return self.VSOCODE_RESOURCE_SOURCE


class WebviewResourceLoader:
    VSCODE_RESOURCE_SCHEME = "vscode-resource"
    VSCODE_RESOURCE_SOURCE = "vscode-resource.vscode-cdn.net"
    FILE_SCHEME = "file"

    def __init__(self, local_resource_roots: Optional[List[URI]] = None):
        self.local_resource_roots = local_resource_roots or []
        self._resource_cache: Dict[str, str] = {}

    def as_webview_uri(self, local_uri: URI) -> str:
        resource_uri = (
            f"{self.VSCODE_RESOURCE_SCHEME}://{self.VSCODE_RESOURCE_SOURCE}"
            f"{local_uri.path}"
        )
        if local_uri.query:
            resource_uri += f"?{local_uri.query}"
        if local_uri.fragment:
            resource_uri += f"#{local_uri.fragment}"
        return resource_uri

    def resolve_local_path(self, resource_uri: str) -> Optional[str]:
        if resource_uri.startswith(f"{self.VSCODE_RESOURCE_SCHEME}://"):
            parsed = URI.parse(resource_uri)
            return parsed.path
        if resource_uri.startswith("file://"):
            return URI.parse(resource_uri).fs_path
        return None

    def is_allowed(self, resource_uri: str) -> bool:
        if not self.local_resource_roots:
            return True
        local_path = self.resolve_local_path(resource_uri)
        if not local_path:
            return False
        normalized = os.path.normpath(os.path.abspath(local_path))
        for root in self.local_resource_roots:
            root_path = os.path.normpath(os.path.abspath(root.fs_path if hasattr(root, 'fs_path') else str(root)))
            if normalized.startswith(root_path):
                return True
        return False


class WebviewPostMessageProtocol:
    def generate_api_shim(self, state_json: str = "null") -> str:
        return f"""
        <script type="text/javascript" src="qrc:///qtwebchannel/qwebchannel.js"></script>
        <script>
            "use strict";
            (function() {{
                var __vscode_state = {state_json};
                var __vscode_bridge = null;
                var __message_listeners = [];

                function acquireVsCodeApi() {{
                    var api = {{
                        postMessage: function(message) {{
                            if (__vscode_bridge && typeof __vscode_bridge.postMessage === 'function') {{
                                try {{
                                    __vscode_bridge.postMessage(JSON.stringify({{
                                        __vscode_message: true,
                                        data: message
                                    }}));
                                }} catch(e) {{
                                    console.error('[vscode] postMessage error:', e);
                                }}
                            }} else {{
                                console.warn('[vscode] Bridge not ready, queueing message');
                                setTimeout(function() {{
                                    if (__vscode_bridge && typeof __vscode_bridge.postMessage === 'function') {{
                                        __vscode_bridge.postMessage(JSON.stringify({{
                                            __vscode_message: true,
                                            data: message
                                        }}));
                                    }}
                                }}, 100);
                            }}
                        }},
                        setState: function(state) {{
                            __vscode_state = state;
                            try {{
                                if (window.__vscode_state_persistence) {{
                                    window.__vscode_state_persistence.setState(state);
                                }}
                            }} catch(e) {{}}
                        }},
                        getState: function() {{
                            return __vscode_state;
                        }}
                    }};
                    return api;
                }}

                window.acquireVsCodeApi = acquireVsCodeApi;

                function __dispatchMessage(data) {{
                    var event = new MessageEvent('message', {{
                        data: data
                    }});
                    for (var i = 0; i < __message_listeners.length; i++) {{
                        try {{
                            __message_listeners[i](event);
                        }} catch(e) {{}}
                    }}
                    window.dispatchEvent(event);
                }}

                new QWebChannel(qt.webChannelTransport, function(channel) {{
                    __vscode_bridge = channel.objects.vscode;
                    if (__vscode_bridge) {{
                        __vscode_bridge._ready = true;
                    }}
                }});

                // Handle state persistence
                window.__vscode_state_persistence = {{
                    setState: function(state) {{ __vscode_state = state; }},
                    getState: function() {{ return __vscode_state; }}
                }};

                // Expose for debugging
                window.__VSCODE_WEBVIEW__ = {{
                    api: acquireVsCodeApi(),
                    state: function() {{ return __vscode_state; }}
                }};
            }})();
        </script>
        """

    def generate_command_uri_handler(self) -> str:
        return """
        <script>
            (function() {
                document.addEventListener('click', function(e) {
                    var target = e.target;
                    while (target && target.tagName !== 'A') target = target.parentElement;
                    if (target && target.tagName === 'A') {
                        var href = target.getAttribute('href');
                        if (href && href.startsWith('command:')) {
                            e.preventDefault();
                            var cmd = href.substring(8);
                            try {
                                if (window.acquireVsCodeApi) {
                                    window.acquireVsCodeApi().postMessage({
                                        command: cmd,
                                        args: []
                                    });
                                }
                            } catch(ex) {}
                        }
                    }
                });
            })();
        </script>
        """


class WebviewProtocol:
    def __init__(self):
        self.csp = WebviewCSP()
        self.resource_loader = WebviewResourceLoader()
        self.message_protocol = WebviewPostMessageProtocol()

    def inject_into_html(self, html: str, state: Optional[Dict] = None,
                        enable_command_uris: bool = False,
                        local_resource_roots: Optional[List[URI]] = None) -> str:
        html = sanitize_html(html)
        if local_resource_roots:
            self.csp.local_resource_roots = local_resource_roots
            self.resource_loader.local_resource_roots = local_resource_roots

        csp_meta = self.csp.generate_csp_meta()
        state_json = json.dumps(state) if state is not None else "null"
        api_shim = self.message_protocol.generate_api_shim(state_json)

        head_end = "</head>"
        body_end = "</body>"

        head_injection = f"{csp_meta}\n{api_shim}"

        if enable_command_uris:
            head_injection += "\n" + self.message_protocol.generate_command_uri_handler()

        if head_end in html:
            html = html.replace(head_end, f"{head_injection}\n{head_end}")
        elif body_end in html:
            html = html.replace(body_end, f"{head_injection}\n{body_end}")
        else:
            html = f"<html><head>{head_injection}</head><body>{html}</body></html>"

        return html
