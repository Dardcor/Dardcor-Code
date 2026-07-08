"""Comment Service - Manages code comments, threads, resolution status, and persistence."""

import os
import json
from datetime import datetime
from PySide6.QtCore import QObject, Signal

class Comment:
    def __init__(self, comment_id: str, author: str, body: str, timestamp: str = None, reactions: dict = None):
        self.id = comment_id
        self.author = author
        self.body = body
        self.timestamp = timestamp or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.reactions = reactions or {}  # emoji -> count

class CommentThread:
    def __init__(self, thread_id: str, file_path: str, line: int, resolved: bool = False, replies: list = None):
        self.id = thread_id
        self.file_path = file_path
        self.line = line
        self.resolved = resolved
        self.replies = replies or []  # list of Comment objects

class CommentService(QObject):
    """Core service managing inline code review comments and PR threads."""
    comments_updated = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._threads = {}  # thread_id -> CommentThread
        self._persistence_file = os.path.expanduser("~/.dardcor-code/comments.json")
        self.load_comments()

    def load_comments(self):
        self._threads.clear()
        if not os.path.exists(self._persistence_file):
            return
        try:
            with open(self._persistence_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                for tid, tdata in data.items():
                    replies = []
                    for r in tdata.get("replies", []):
                        replies.append(Comment(r["id"], r["author"], r["body"], r["timestamp"], r.get("reactions")))
                    self._threads[tid] = CommentThread(
                        tid,
                        tdata["file_path"],
                        tdata["line"],
                        tdata.get("resolved", False),
                        replies
                    )
        except Exception:
            pass

    def save_comments(self):
        try:
            os.makedirs(os.path.dirname(self._persistence_file), exist_ok=True)
            data = {}
            for tid, thread in self._threads.items():
                replies_data = []
                for r in thread.replies:
                    replies_data.append({
                        "id": r.id,
                        "author": r.author,
                        "body": r.body,
                        "timestamp": r.timestamp,
                        "reactions": r.reactions
                    })
                data[tid] = {
                    "file_path": thread.file_path,
                    "line": thread.line,
                    "resolved": thread.resolved,
                    "replies": replies_data
                }
            with open(self._persistence_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
        except Exception:
            pass

    def get_threads_for_file(self, file_path: str) -> list[CommentThread]:
        norm = os.path.normpath(file_path).lower()
        return [t for t in self._threads.values() if os.path.normpath(t.file_path).lower() == norm]

    def add_comment(self, file_path: str, line: int, author: str, body: str) -> str:
        # Check if thread exists for this line
        norm_path = os.path.normpath(file_path)
        existing = [t for t in self._threads.values() if os.path.normpath(t.file_path).lower() == norm_path.lower() and t.line == line]
        
        if existing:
            thread = existing[0]
            cid = f"{thread.id}_{len(thread.replies)}"
            comment = Comment(cid, author, body)
            thread.replies.append(comment)
            tid = thread.id
        else:
            tid = f"thread_{len(self._threads)}"
            cid = f"{tid}_0"
            comment = Comment(cid, author, body)
            thread = CommentThread(tid, norm_path, line)
            thread.replies.append(comment)
            self._threads[tid] = thread
            
        self.save_comments()
        self.comments_updated.emit()
        return tid

    def add_reply(self, thread_id: str, author: str, body: str):
        if thread_id in self._threads:
            thread = self._threads[thread_id]
            cid = f"{thread_id}_{len(thread.replies)}"
            comment = Comment(cid, author, body)
            thread.replies.append(comment)
            self.save_comments()
            self.comments_updated.emit()

    def toggle_resolve(self, thread_id: str):
        if thread_id in self._threads:
            self._threads[thread_id].resolved = not self._threads[thread_id].resolved
            self.save_comments()
            self.comments_updated.emit()

    def add_reaction(self, thread_id: str, comment_index: int, emoji: str):
        if thread_id in self._threads:
            thread = self._threads[thread_id]
            if 0 <= comment_index < len(thread.replies):
                comment = thread.replies[comment_index]
                comment.reactions[emoji] = comment.reactions.get(emoji, 0) + 1
                self.save_comments()
                self.comments_updated.emit()

    def delete_thread(self, thread_id: str):
        if thread_id in self._threads:
            self._threads.pop(thread_id)
            self.save_comments()
            self.comments_updated.emit()
