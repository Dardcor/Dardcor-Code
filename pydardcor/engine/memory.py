"""Conversation memory management for Dardcor Code."""

import os
import json
import uuid
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any


@dataclass
class Message:
    role: str  # "user", "assistant", "system", "tool"
    content: str
    timestamp: str = ""
    tool_calls: list = field(default_factory=list)
    tool_call_id: str = ""
    name: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now().isoformat()

    def to_api_dict(self) -> dict:
        d = {"role": self.role, "content": self.content}
        if self.tool_calls:
            d["tool_calls"] = self.tool_calls
        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id
        if self.name:
            d["name"] = self.name
        return d


@dataclass
class Conversation:
    id: str = ""
    title: str = "New Conversation"
    messages: List[Message] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = str(uuid.uuid4())
        if not self.created_at:
            self.created_at = datetime.now().isoformat()
        if not self.updated_at:
            self.updated_at = datetime.now().isoformat()

    def add_message(self, role: str, content: str, **kwargs) -> Message:
        msg = Message(role=role, content=content, **kwargs)
        self.messages.append(msg)
        self.updated_at = datetime.now().isoformat()
        if role == "user" and self.title == "New Conversation" and len(self.messages) <= 2:
            self.title = content[:60].strip()
        return msg

    def get_api_messages(self) -> List[dict]:
        return [m.to_api_dict() for m in self.messages]

    def clear(self):
        self.messages.clear()
        self.updated_at = datetime.now().isoformat()


class ConversationStore:
    def __init__(self, store_dir: str = None):
        if store_dir is None:
            store_dir = os.path.join(os.path.expanduser("~"), ".dardcor-code", "conversations")
        self._store_dir = store_dir
        os.makedirs(self._store_dir, exist_ok=True)

    def save(self, conversation: Conversation):
        path = os.path.join(self._store_dir, f"{conversation.id}.json")
        data = {
            "id": conversation.id,
            "title": conversation.title,
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "messages": [asdict(m) for m in conversation.messages],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def load(self, conv_id: str) -> Optional[Conversation]:
        path = os.path.join(self._store_dir, f"{conv_id}.json")
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            conv = Conversation(
                id=data["id"],
                title=data.get("title", ""),
                created_at=data.get("created_at", ""),
                updated_at=data.get("updated_at", ""),
            )
            for m in data.get("messages", []):
                conv.messages.append(Message(**{k: v for k, v in m.items() if k in Message.__dataclass_fields__}))
            return conv
        except Exception:
            return None

    def list_conversations(self) -> List[Dict[str, str]]:
        convs = []
        for fname in os.listdir(self._store_dir):
            if fname.endswith(".json"):
                try:
                    with open(os.path.join(self._store_dir, fname), "r", encoding="utf-8") as f:
                        data = json.load(f)
                    convs.append({
                        "id": data["id"],
                        "title": data.get("title", ""),
                        "updated_at": data.get("updated_at", ""),
                    })
                except Exception:
                    pass
        convs.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return convs

    def delete(self, conv_id: str):
        path = os.path.join(self._store_dir, f"{conv_id}.json")
        if os.path.exists(path):
            os.remove(path)
