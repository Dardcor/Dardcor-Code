import os
import json
import subprocess
from PySide6.QtCore import QObject, Slot, Signal, QTimer

class GitBridge(QObject):
    filesUpdated = Signal(str, str) # stagedJSON, unstagedJSON
    graphUpdated = Signal(str)      # graphJSON
    counts_changed = Signal(int)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._workspace = ""
        self._app = None
        self._last_status = None
        self._last_staged_json = "[]"
        self._last_unstaged_json = "[]"
        self._last_count = 0
        self._last_graph = None
        self._last_graph_json = "[]"
        
        # Real-time update timer
        self._poll_timer = QTimer(self)
        self._poll_timer.setInterval(3000)
        self._poll_timer.timeout.connect(self._auto_refresh)
        
    @Slot()
    def _auto_refresh(self):
        if self._workspace:
            self.refreshData()
            # Only refresh graph if panel is visible? For now just refresh both
            self.refreshGraph()
        
    def set_app(self, app):
        """Reference to main window to trigger editor actions"""
        self._app = app

    def set_workspace(self, path):
        self._workspace = path or ""
        if self._workspace:
            self._poll_timer.start()
        else:
            self._poll_timer.stop()
        self.refreshData()
        self.refreshGraph()

    def _run_git(self, args):
        if not self._workspace or not os.path.exists(os.path.join(self._workspace, ".git")):
            return ""
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            result = subprocess.run(
                ["git"] + args,
                cwd=self._workspace,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
                **kwargs
            )
            return result.stdout
        except Exception as e:
            print(f"Git execution error: {e}")
            return ""

    @Slot()
    def refreshData(self):
        stdout = self._run_git(["status", "-uall", "--porcelain"])
        if stdout == self._last_status:
            self.filesUpdated.emit(self._last_staged_json, self._last_unstaged_json)
            self.counts_changed.emit(self._last_count)
            return
            
        self._last_status = stdout
        
        staged = []
        unstaged = []
        
        if stdout:
            for line in stdout.splitlines():
                if len(line) < 4:
                    continue
                x = line[0]
                y = line[1]
                path = line[3:].strip()
                
                # Format for JS
                item = {
                    "name": os.path.basename(path),
                    "dir": os.path.dirname(path).replace("/", "\\") if os.name == 'nt' else os.path.dirname(path),
                    "path": path,
                    "status": "M"
                }

                # Staged
                if x != ' ' and x != '?':
                    s_item = dict(item)
                    s_item["status"] = x
                    staged.append(s_item)
                
                # Unstaged
                if y != ' ':
                    u_item = dict(item)
                    u_item["status"] = 'U' if y == '?' else y
                    unstaged.append(u_item)
                    
        self._last_staged_json = json.dumps(staged)
        self._last_unstaged_json = json.dumps(unstaged)
        self._last_count = len(staged) + len(unstaged)
        
        self.filesUpdated.emit(self._last_staged_json, self._last_unstaged_json)
        self.counts_changed.emit(self._last_count)

    @Slot()
    def refreshGraph(self):
        stdout = self._run_git([
            "log", "--graph", "--oneline", "--decorate", "--all", "-n", "100",
            "--pretty=format:%h%x1f%s%x1f%cd%x1f%an%x1f%d", "--date=short"
        ])
        if stdout == self._last_graph:
            self.graphUpdated.emit(self._last_graph_json)
            return
            
        self._last_graph = stdout
        
        lines_data = []
        if stdout:
            for line in stdout.splitlines():
                parts = line.split('\x1f')
                if len(parts) >= 5:
                    graph_and_hash = parts[0]
                    words = graph_and_hash.split()
                    commit_hash = words[-1] if words else ""
                    if len(commit_hash) >= 4 and commit_hash.isalnum():
                        graph_part = graph_and_hash[:graph_and_hash.rfind(commit_hash)].rstrip()
                        if commit_hash and not graph_part.endswith("*"):
                            graph_part += " *"
                    else:
                        commit_hash = ""
                        graph_part = graph_and_hash

                    subject = parts[1]
                    date = parts[2]
                    author = parts[3]
                    refs = parts[4].strip("() ")
                    
                    lines_data.append({
                        "graph": graph_part,
                        "subject": subject,
                        "date": date,
                        "author": author,
                        "hash": commit_hash,
                        "refs": refs
                    })
                else:
                    lines_data.append({
                        "graph": line,
                        "subject": "",
                        "date": "",
                        "author": "",
                        "hash": "",
                        "refs": ""
                    })
                    
        self._last_graph_json = json.dumps(lines_data)
        self.graphUpdated.emit(self._last_graph_json)

    @Slot(str)
    def commit(self, message):
        if not message.strip():
            return
        self._run_git(["commit", "-m", message])
        self.refreshData()
        self.refreshGraph()
        
    @Slot(str)
    def openDiff(self, path):
        if self._app:
            # Need to call diff open requested on the main app
            self._app._open_diff_in_editor(path, "Working Tree", "Current")
            
    @Slot(str)
    def openCommit(self, commit_hash):
        if self._app:
            self._app._chat_panel.append_system_message(f"Selected commit: {commit_hash}")
