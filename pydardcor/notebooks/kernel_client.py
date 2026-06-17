import json
import uuid
import logging
import threading
from typing import Dict, Any, Callable, Optional

# In a real implementation we would use jupyter_client
# Here we mock the architecture

logger = logging.getLogger(__name__)

class KernelClient:
    """Manages connection to a Jupyter kernel via ZeroMQ for notebook execution."""
    
    def __init__(self, kernel_name: str = "python3"):
        self.kernel_name = kernel_name
        self.session_id = str(uuid.uuid4())
        self._execution_callbacks: Dict[str, Callable] = {}
        self._is_alive = False
        
    def start(self):
        """Starts the kernel process."""
        # Mocking kernel start
        self._is_alive = True
        logger.info(f"Started Jupyter kernel: {self.kernel_name}")
        
    def stop(self):
        """Stops the kernel process."""
        self._is_alive = False
        logger.info(f"Stopped Jupyter kernel: {self.kernel_name}")

    def execute_code(self, code: str, callback: Callable[[Dict[str, Any]], None]) -> str:
        """
        Executes a cell of code.
        callback will receive execution results (stream output, display data, error, etc.)
        Returns the execution request ID.
        """
        if not self._is_alive:
            callback({"msg_type": "error", "content": {"ename": "RuntimeError", "evalue": "Kernel not running"}})
            return ""
            
        msg_id = str(uuid.uuid4())
        self._execution_callbacks[msg_id] = callback
        
        # Mock execution asynchronously
        def _mock_execute():
            import time
            time.sleep(0.5)
            # Mock success output
            callback({
                "msg_type": "stream",
                "content": {"name": "stdout", "text": f"Executed: {code[:20]}...\n"}
            })
            callback({
                "msg_type": "execute_reply",
                "content": {"status": "ok", "execution_count": 1}
            })
            if msg_id in self._execution_callbacks:
                del self._execution_callbacks[msg_id]
                
        threading.Thread(target=_mock_execute, daemon=True).start()
        return msg_id

    def interrupt(self):
        """Interrupts current execution."""
        logger.info("Interrupting kernel...")
