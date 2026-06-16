"""Extension Host for Dardcor Code.
Provides an isolated environment for loading and running VS Code-like extensions.
"""

import threading
import queue

class ExtensionHost:
    """Manages the lifecycle of extensions in a sandboxed or separate process."""
    
    def __init__(self):
        self._extensions = {}
        self._message_queue = queue.Queue()
        self._thread = None
        
    def start(self):
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        
    def load_extension(self, path: str):
        # Stub: parse package.json, load main entry point
        ext_id = path.split("/")[-1]
        self._extensions[ext_id] = {"status": "loaded"}
        print(f"Loaded extension: {ext_id}")
        
    def _run_loop(self):
        while True:
            msg = self._message_queue.get()
            if msg is None:
                break
            # Handle messages from extensions
            pass
            
    def stop(self):
        self._message_queue.put(None)
        if self._thread:
            self._thread.join(timeout=1.0)
