import logging
from typing import Dict, Any, Callable
from .rpc_bridge import RpcBridge

logger = logging.getLogger(__name__)

class VscodeApiImpl:
    """Implementations for the vscode API called from the Extension Host."""

    def __init__(self, bridge: RpcBridge):
        self.bridge = bridge
        self.commands: Dict[str, Callable] = {}
        
        # Register handlers for requests coming from extension host
        self.bridge.register_request_handler("vscode.commands.executeCommand", self._execute_command)
        self.bridge.register_request_handler("vscode.window.showInformationMessage", self._show_info_message)
        self.bridge.register_request_handler("vscode.window.showWarningMessage", self._show_warning_message)
        self.bridge.register_request_handler("vscode.window.showErrorMessage", self._show_error_message)
        self.bridge.register_request_handler("vscode.workspace.getConfiguration", self._get_configuration)
        
        # Register notification handlers
        self.bridge.register_notification_handler("vscode.window.setStatusBarMessage", self._set_status_bar_message)

    def _execute_command(self, params: dict) -> Any:
        command_id = params.get("command")
        args = params.get("args", [])
        
        if command_id in self.commands:
            handler = self.commands[command_id]
            return handler(*args)
        else:
            logger.warning(f"Command not found: {command_id}")
            return None

    def _show_info_message(self, params: dict) -> Any:
        message = params.get("message", "")
        # Here we would normally emit a signal to the UI thread
        logger.info(f"Extension Info: {message}")
        return None

    def _show_warning_message(self, params: dict) -> Any:
        message = params.get("message", "")
        logger.warning(f"Extension Warning: {message}")
        return None

    def _show_error_message(self, params: dict) -> Any:
        message = params.get("message", "")
        logger.error(f"Extension Error: {message}")
        return None

    def _set_status_bar_message(self, params: dict):
        text = params.get("text", "")
        # Emit signal to update status bar
        logger.debug(f"Status Bar Update: {text}")

    def _get_configuration(self, params: dict) -> dict:
        section = params.get("section", "")
        # Mock configuration for now
        return {}

    def register_command_handler(self, command_id: str, handler: Callable):
        """Register a Python-side handler for a command that extensions might call."""
        self.commands[command_id] = handler

    # --- Methods to trigger things IN the extension host ---

    def trigger_extension_command(self, command_id: str, *args):
        """Tell the extension host to run a command registered by an extension."""
        return self.bridge.send_request_sync("invokeCommand", {
            "command": command_id,
            "args": list(args)
        })

    def open_text_document(self, uri: str, content: str, language_id: str):
        """Notify extensions that a document was opened."""
        self.bridge.send_notification("vscode.workspace.onDidOpenTextDocument", {
            "uri": uri,
            "content": content,
            "languageId": language_id
        })

    def change_text_document(self, uri: str, content_changes: list):
        """Notify extensions that a document was changed."""
        self.bridge.send_notification("vscode.workspace.onDidChangeTextDocument", {
            "uri": uri,
            "changes": content_changes
        })
