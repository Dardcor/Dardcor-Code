import os
import json
import uuid
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any

from pydardcor.core.config import get_user_data_dir


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

    def get_api_messages(self, max_messages: int = 100) -> List[dict]:
        """Returns API messages using a Sliding Window approach to save tokens.
        Always keeps the system prompt(s) and the most recent `max_messages`."""
        api_msgs = [m.to_api_dict() for m in self.messages]
        
        # Merge adjacent messages with the same role (e.g. user -> user)
        merged_msgs = []
        for msg in api_msgs:
            if not merged_msgs:
                merged_msgs.append(msg)
            elif (
                merged_msgs[-1]["role"] == msg["role"]
                and msg["role"] in ("user", "assistant")
                and not merged_msgs[-1].get("tool_calls")
                and not msg.get("tool_calls")
            ):
                # Append content with a double newline
                merged_msgs[-1] = dict(merged_msgs[-1])  # avoid mutating original
                c1 = merged_msgs[-1].get("content", "") or ""
                c2 = msg.get("content", "") or ""
                merged_msgs[-1]["content"] = c1 + "\n\n" + c2
            else:
                merged_msgs.append(msg)
                
        api_msgs = self._sanitize_tool_messages(merged_msgs)

        if len(api_msgs) <= max_messages:
            return api_msgs
            
        system_msgs = [m for m in api_msgs if m.get("role") == "system"]
        recent_msgs = api_msgs[-max_messages:]
        
        # Ensure we don't duplicate system messages if they are already in recent
        final_msgs = []
        recent_ids = {id(m) for m in recent_msgs}
        for sys in system_msgs:
            if id(sys) not in recent_ids:
                final_msgs.append(sys)
                
        final_msgs.extend(recent_msgs)
        return self._sanitize_tool_messages(final_msgs)

    def _sanitize_tool_messages(self, messages: List[dict]) -> List[dict]:
        sanitized = []
        pending_tool_ids = set()
        for msg in messages:
            role = msg.get("role")
            if role == "assistant":
                tool_calls = msg.get("tool_calls") or []
                pending_tool_ids = {tc.get("id") for tc in tool_calls if tc.get("id")}
                sanitized.append(msg)
            elif role == "tool":
                tool_call_id = msg.get("tool_call_id")
                if tool_call_id in pending_tool_ids:
                    sanitized.append(msg)
                    pending_tool_ids.discard(tool_call_id)
            else:
                pending_tool_ids = set()
                sanitized.append(msg)
        return sanitized

    def clear(self):
        self.messages.clear()
        self.updated_at = datetime.now().isoformat()


class CoreMemory:
    """Persistent Core Memory that the agent can read and write to."""
    def __init__(self, store_dir: str = None):
        if store_dir is None:
            store_dir = os.path.join(get_user_data_dir(), "database", "memory")
        self._store_dir = store_dir
        os.makedirs(self._store_dir, exist_ok=True)
        self.path = os.path.join(self._store_dir, "core_memory.json")
        self.data = self.load()
        
    def load(self) -> dict:
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"user_preferences": [], "project_context": []}
        
    def save(self):
        temp_path = self.path + ".tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            os.replace(temp_path, self.path)
        except Exception:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            
    def add_fact(self, category: str, fact: str):
        if category not in self.data:
            self.data[category] = []
        if fact not in self.data[category]:
            self.data[category].append(fact)
            self.save()

    def get_summary(self) -> str:
        if not any(self.data.values()):
            return "CORE MEMORY: (Empty)"
        res = "CORE MEMORY (Permanent facts):\n"
        for k, v in self.data.items():
            if v:
                res += f"[{k.upper()}]\n"
                for item in v:
                    res += f"- {item}\n"
        return res


class ArchivalMemory:
    """Lightweight local Lexical Search (TF-IDF/Word Overlap) for Archival Memory."""
    def __init__(self, store: 'ConversationStore'):
        self.store = store
        
    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        import re
        from collections import Counter
        
        def get_words(text):
            return re.findall(r'\w+', text.lower())
            
        query_words = set(get_words(query))
        if not query_words:
            return []
            
        results = []
        # Loop through all conversations and messages
        for dirname in os.listdir(self.store._store_dir):
            path = os.path.join(self.store._store_dir, dirname, f"{dirname}.json")
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    
                    conv_title = data.get("title", "")
                    for msg in data.get("messages", []):
                        if msg.get("role") not in ("user", "assistant"):
                            continue
                        
                        content = msg.get("content", "")
                        if not content or len(content) < 10:
                            continue
                            
                        content_words = get_words(content)
                        word_counts = Counter(content_words)
                        
                        # Basic overlap scoring
                        score = sum(word_counts[w] for w in query_words)
                        if score > 0:
                            results.append({
                                "score": score,
                                "conversation": conv_title,
                                "timestamp": msg.get("timestamp", ""),
                                "role": msg.get("role", ""),
                                "content": content[:500] + ("..." if len(content) > 500 else "")
                            })
                except Exception:
                    continue
                    
        # Sort by score descending, then return top_k
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]



class ConversationStore:
    def __init__(self, store_dir: str = None):
        if store_dir is None:
            store_dir = os.path.join(get_user_data_dir(), "database", "conversation")
        self._store_dir = store_dir
        os.makedirs(self._store_dir, exist_ok=True)
        
        # Migrate old flat files to nested folders
        import shutil
        for fname in os.listdir(self._store_dir):
            if fname.endswith(".json"):
                conv_id = fname[:-5]
                old_path = os.path.join(self._store_dir, fname)
                new_dir = os.path.join(self._store_dir, conv_id)
                os.makedirs(new_dir, exist_ok=True)
                new_path = os.path.join(new_dir, fname)
                shutil.move(old_path, new_path)

    def save(self, conversation: Conversation):
        # Do not save if there are no user messages
        if not any(m.role == "user" for m in conversation.messages):
            return
            
        conv_dir = os.path.join(self._store_dir, conversation.id)
        os.makedirs(conv_dir, exist_ok=True)
        path = os.path.join(conv_dir, f"{conversation.id}.json")
        data = {
            "id": conversation.id,
            "title": conversation.title,
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "messages": [asdict(m) for m in conversation.messages],
        }
        temp_path = path + ".tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(temp_path, path)
        except Exception:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def load(self, conv_id: str) -> Optional[Conversation]:
        path = os.path.join(self._store_dir, conv_id, f"{conv_id}.json")
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
        results = []
        if not os.path.exists(self._store_dir):
            return results
        for conv_id in os.listdir(self._store_dir):
            path = os.path.join(self._store_dir, conv_id, f"{conv_id}.json")
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    
                    # Ensure conversation actually has a user message
                    has_user = any(m.get("role") == "user" for m in data.get("messages", []))
                    if not has_user:
                        import shutil
                        try:
                            shutil.rmtree(os.path.join(self._store_dir, conv_id))
                        except Exception:
                            pass
                        continue
                        
                    results.append({
                        "id": data["id"],
                        "title": data.get("title", ""),
                        "updated_at": data.get("updated_at", ""),
                    })
                except Exception:
                    pass
        results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return results

    def delete(self, conv_id: str):
        import shutil
        conv_dir = os.path.join(self._store_dir, conv_id)
        if os.path.exists(conv_dir):
            shutil.rmtree(conv_dir, ignore_errors=True)
