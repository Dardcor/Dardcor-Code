from PySide6.QtWidgets import QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem
from PySide6.QtCore import Qt

class TimelinePanel(QWidget):
    """Panel showing the history/timeline of the currently active file."""

    def __init__(self, parent=None):
        super().__init__(parent)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setIndentation(10)
        
        layout.addWidget(self.tree)
        
        self.current_file = None

    def set_file(self, file_path: str):
        self.current_file = file_path
        self.refresh()

    def refresh(self):
        self.tree.clear()
        if not self.current_file:
            item = QTreeWidgetItem(["No active file"])
            self.tree.addTopLevelItem(item)
            return
            
        import subprocess
        try:
            # Get git log for this file
            cmd = ["git", "log", "--pretty=format:%h|%an|%ar|%s", "--", self.current_file]
            import os
            cwd = os.path.dirname(self.current_file)
            
            result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
            if result.returncode == 0 and result.stdout:
                for line in result.stdout.split('\n'):
                    parts = line.split('|')
                    if len(parts) >= 4:
                        commit_hash, author, date, msg = parts[0], parts[1], parts[2], parts[3]
                        
                        item = QTreeWidgetItem([f"{msg} ({date})"])
                        item.setToolTip(0, f"Commit: {commit_hash}\nAuthor: {author}")
                        self.tree.addTopLevelItem(item)
            else:
                self.tree.addTopLevelItem(QTreeWidgetItem(["No git history found"]))
        except Exception:
            self.tree.addTopLevelItem(QTreeWidgetItem(["Error loading timeline"]))
