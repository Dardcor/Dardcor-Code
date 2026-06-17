from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWidgets import QWidget, QVBoxLayout
import json
from .message_router import WebviewMessageRouter

class WebviewPanel(QWidget):
    """A VS Code compatible Webview panel for extensions to render custom HTML."""

    def __init__(self, view_id: str, title: str, parent=None):
        super().__init__(parent)
        self.view_id = view_id
        self.title = title
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        self.webview = QWebEngineView()
        layout.addWidget(self.webview)
        
        # Setup message routing
        self.router = WebviewMessageRouter(self.view_id)
        self.channel = QWebChannel()
        self.channel.registerObject("vscode", self.router)
        self.webview.page().setWebChannel(self.channel)
        
        self._html = ""

    def set_html(self, html: str):
        """Sets the HTML content of the webview, injecting the VS Code API shim."""
        shim = """
        <script type="text/javascript" src="qrc:///qtwebchannel/qwebchannel.js"></script>
        <script>
            window.acquireVsCodeApi = function() {
                if (!window.vscode_api_impl) {
                    window.vscode_api_impl = {
                        postMessage: function(msg) {
                            if (window._vscode_bridge) {
                                window._vscode_bridge.postMessage(JSON.stringify(msg));
                            } else {
                                console.warn("VS Code bridge not ready yet.");
                            }
                        },
                        setState: function(state) { window._vscode_state = state; },
                        getState: function() { return window._vscode_state; }
                    };
                }
                return window.vscode_api_impl;
            };
            
            new QWebChannel(qt.webChannelTransport, function(channel) {
                window._vscode_bridge = channel.objects.vscode;
            });
        </script>
        """
        # Inject shim before closing </head> or at the beginning
        if "</head>" in html:
            html = html.replace("</head>", f"{shim}</head>")
        else:
            html = shim + html
            
        self._html = html
        self.webview.setHtml(html)

    def post_message(self, message: dict):
        """Send a message from Python to the Webview JS."""
        msg_json = json.dumps(message)
        script = f"""
        window.dispatchEvent(new MessageEvent('message', {{
            data: {msg_json}
        }}));
        """
        self.webview.page().runJavaScript(script)
