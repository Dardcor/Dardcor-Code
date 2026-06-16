"""Debug Adapter Protocol (DAP) Client for Dardcor Code."""

import json
import threading
import subprocess
from typing import Dict, Any, Callable

class DAPClient:
    """A basic client for communicating with Debug Adapters via JSON-RPC."""
    
    def __init__(self, command: list):
        self.command = command
        self._process = None
        self._seq = 1
        self._callbacks = {}
        self._reader_thread = None
        
    def start(self):
        """Starts the debug adapter process."""
        try:
            kwargs = {}
            import os
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000  # CREATE_NO_WINDOW
                
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                **kwargs
            )
            
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()
            
            # Send initialize request
            self.send_request("initialize", {
                "clientID": "dardcor-code",
                "clientName": "Dardcor Code",
                "adapterID": "python",
                "linesStartAt1": True,
                "columnsStartAt1": True,
                "pathFormat": "path"
            })
            return True
        except Exception as e:
            print(f"DAP Error starting {self.command}: {e}")
            return False
            
    def _read_loop(self):
        """Read loop to parse JSON-RPC headers and bodies."""
        while self._process and self._process.poll() is None:
            try:
                line = self._process.stdout.readline()
                if not line:
                    break
                line = line.decode('utf-8').strip()
                if not line:
                    continue
                    
                if line.startswith("Content-Length:"):
                    length = int(line.split(":")[1].strip())
                    self._process.stdout.readline()
                    
                    body = self._process.stdout.read(length)
                    data = json.loads(body.decode('utf-8'))
                    self._handle_response(data)
            except Exception as e:
                print(f"DAP Read Error: {e}")
                break
                
    def _handle_response(self, data: Dict[str, Any]):
        if data.get("type") == "response":
            req_seq = data.get("request_seq")
            if req_seq in self._callbacks:
                callback = self._callbacks.pop(req_seq)
                if callback:
                    callback(data.get("body"), data.get("success"), data.get("message"))
        elif data.get("type") == "event":
            # Handle DAP events (stopped, output, etc.)
            pass
                
    def send_request(self, command: str, args: dict, callback: Callable = None):
        """Send a DAP request to the adapter."""
        if not self._process:
            return
            
        seq = self._seq
        self._seq += 1
        
        if callback:
            self._callbacks[seq] = callback
            
        message = {
            "seq": seq,
            "type": "request",
            "command": command,
            "arguments": args
        }
        
        body = json.dumps(message)
        header = f"Content-Length: {len(body)}\r\n\r\n"
        
        try:
            self._process.stdin.write(header.encode('utf-8'))
            self._process.stdin.write(body.encode('utf-8'))
            self._process.stdin.flush()
        except Exception as e:
            print(f"DAP Write Error: {e}")
            
    def stop(self):
        """Stops the debug adapter."""
        if self._process:
            self._process.terminate()
            self._process = None
