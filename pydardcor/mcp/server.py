"""MCP Server - Exposes Dardcor Code capabilities (Workspace files, editor state) to external AI agents."""

import sys
import json
import os
from typing import Dict, Any, List

class MCPServer:
    """JSON-RPC standard MCP server."""

    def __init__(self, workspace_path: str = ""):
        self.workspace_path = workspace_path
        self._tools = {
            "list_workspace_dir": {
                "name": "list_workspace_dir",
                "description": "List directory contents in current workspace.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Subdirectory path relative to workspace root."}
                    }
                }
            },
            "read_workspace_file": {
                "name": "read_workspace_file",
                "description": "Read file contents in workspace.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "File path relative to workspace root."}
                    },
                    "required": ["path"]
                }
            }
        }

    def start_stdio_loop(self):
        """Standard stdio communication loop for parent agents."""
        for line in sys.stdin:
            try:
                req = json.loads(line)
                self._handle_request(req)
            except Exception:
                pass

    def _handle_request(self, req: dict):
        if "id" not in req:
            return
        
        req_id = req["id"]
        method = req.get("method")
        params = req.get("params", {})

        if method == "initialize":
            res = {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {}
                },
                "serverInfo": {"name": "Dardcor-Code-MCP-Server", "version": "1.0.0"}
            }
            self._send_response(req_id, res)
        elif method == "tools/list":
            self._send_response(req_id, {"tools": list(self._tools.values())})
        elif method == "tools/call":
            tool_name = params.get("name")
            args = params.get("arguments", {})
            self._call_tool(req_id, tool_name, args)
        else:
            self._send_error(req_id, -32601, f"Method {method} not found")

    def _call_tool(self, req_id: int, name: str, args: dict):
        if name == "list_workspace_dir":
            sub = args.get("path", "")
            target = os.path.join(self.workspace_path, sub)
            if not os.path.abspath(target).startswith(os.path.abspath(self.workspace_path)):
                self._send_error(req_id, -32000, "Access denied: Out of workspace bounds")
                return
            try:
                items = os.listdir(target)
                self._send_response(req_id, {"content": [{"type": "text", "text": "\n".join(items)}]})
            except Exception as e:
                self._send_error(req_id, -32000, str(e))

        elif name == "read_workspace_file":
            sub = args.get("path", "")
            target = os.path.join(self.workspace_path, sub)
            if not os.path.abspath(target).startswith(os.path.abspath(self.workspace_path)):
                self._send_error(req_id, -32000, "Access denied: Out of workspace bounds")
                return
            try:
                with open(target, "r", encoding="utf-8") as f:
                    content = f.read()
                self._send_response(req_id, {"content": [{"type": "text", "text": content}]})
            except Exception as e:
                self._send_error(req_id, -32000, str(e))
        else:
            self._send_error(req_id, -32601, f"Tool {name} not found")

    def _send_response(self, req_id: int, result: dict):
        sys.stdout.write(json.dumps({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result
        }) + "\n")
        sys.stdout.flush()

    def _send_error(self, req_id: int, code: int, message: str):
        sys.stdout.write(json.dumps({
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": code, "message": message}
        }) + "\n")
        sys.stdout.flush()
