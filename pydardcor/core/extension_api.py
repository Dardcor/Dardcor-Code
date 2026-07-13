"""
Complete VS Code Extension API implementation.
Mirrors the full vscode.d.ts public API surface.
Sections: Chat, LM, MCP, AI/Embeddings, SCM, Testing, Terminal,
Notebook, Auth, Comments, Debug, Editor, FS, Menu/Contrib.
"""

from __future__ import annotations

import os
import json
import uuid
import base64
import inspect
import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum, IntEnum
from typing import (
    Any, Callable, Dict, Generic, Iterable, List, Optional,
    Protocol, Set, Tuple, TypeVar, Union, IO, Iterator, overload,
)

from PySide6.QtCore import QObject, Signal

from .event_bus import (
    Disposable, EventEmitter, Event, EventBus,
    get_event_bus, emit, subscribe,
)
from .commands import (
    CommandRegistry, get_command_registry, execute_command,
    CommandResult, CommandDefinition,
)
from .uri import URI, get_uri_service

logger = logging.getLogger(__name__)
T = TypeVar("T")

# =========================================================================
# 1.  ENUMS & BASE TYPES
# =========================================================================

class EndOfLine(IntEnum):
    LF = 1
    CRLF = 2

class IndentAction(IntEnum):
    None_ = 0
    Indent = 1
    IndentOutdent = 2
    Outdent = 3

class CompletionItemKind(IntEnum):
    Text = 0; Method = 1; Function = 2; Constructor = 3
    Field = 4; Variable = 5; Class = 6; Struct = 7
    Interface = 8; Module = 9; Property = 10; Event = 11
    Operator = 12; Unit = 13; Value = 14; Constant = 15
    Enum = 16; EnumMember = 17; Keyword = 18; Snippet = 19
    Color = 20; Reference = 21; File = 22; Folder = 23
    TypeParameter = 24; User = 25; Issue = 26

class CompletionTriggerKind(IntEnum):
    Invoke = 0; TriggerCharacter = 1; TriggerForIncompleteCompletions = 2

class FileType(IntEnum):
    Unknown = 0; File = 1; Directory = 2; SymbolicLink = 64

class TextEditKind(IntEnum):
    Simple = 0; Insert = 1; Delete = 2; Replace = 3; Format = 4

class CommentMode(IntEnum):
    Editing = 0; Preview = 1

class CommentThreadCollapsibleState(IntEnum):
    Collapsed = 0; Expanded = 1

class CommentThreadState(IntEnum):
    Unresolved = 0; Resolved = 1

class DebugConsoleMode(IntEnum):
    Enter = 0; Copy = 1

# ---------------------------------------------------------------------------
# CancellationToken
# ---------------------------------------------------------------------------

class CancellationToken:
    def __init__(self, cancelled: bool = False):
        self._cancelled = cancelled
        self._on_cancelled = EventEmitter(name="cancellationToken")

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    @property
    def on_cancelled(self) -> EventEmitter:
        return self._on_cancelled

    def cancel(self):
        self._cancelled = True
        self._on_cancelled.fire(None)

CancellationToken.None_ = CancellationToken()

# ---------------------------------------------------------------------------
# Position / Range / Selection
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Position:
    line: int = 0
    character: int = 0

    def is_before(self, other: Position) -> bool:
        return (self.line, self.character) < (other.line, other.character)

    def is_after(self, other: Position) -> bool:
        return (self.line, self.character) > (other.line, other.character)

    def compare_to(self, other: Position) -> int:
        d = self.line - other.line
        return d if d else self.character - other.character

    def translate(self, line_delta: int = 0, character_delta: int = 0) -> Position:
        return Position(self.line + line_delta, self.character + character_delta)

    def with_(self, line: Optional[int] = None, character: Optional[int] = None) -> Position:
        return Position(line if line is not None else self.line,
                        character if character is not None else self.character)

@dataclass(frozen=True)
class Range:
    start: Position = field(default_factory=lambda: Position())
    end: Position = field(default_factory=lambda: Position())

    @property
    def is_empty(self) -> bool:
        return self.start == self.end

    @property
    def is_single_line(self) -> bool:
        return self.start.line == self.end.line

    def contains(self, position: Position) -> bool:
        return not (position.is_before(self.start) or position.is_after(self.end))

    def intersection(self, other: Range) -> Optional[Range]:
        s = max(self.start, other.start, key=lambda p: (p.line, p.character))
        e = min(self.end, other.end, key=lambda p: (p.line, p.character))
        return Range(s, e) if not (s.is_before(e) or s == e) else None

    def union(self, other: Range) -> Range:
        s = min(self.start, other.start, key=lambda p: (p.line, p.character))
        e = max(self.end, other.end, key=lambda p: (p.line, p.character))
        return Range(s, e)


@dataclass(frozen=True)
class Selection:
    active: Position = field(default_factory=lambda: Position())
    anchor: Position = field(default_factory=lambda: Position())

    @property
    def start(self) -> Position:
        return self.anchor if self.anchor.is_before(self.active) else self.active

    @property
    def end(self) -> Position:
        return self.active if self.anchor.is_before(self.active) else self.anchor

    @property
    def is_empty(self) -> bool:
        return self.active == self.anchor

    @property
    def is_reversed(self) -> bool:
        return self.anchor.is_before(self.active)

# =========================================================================
# 2.  DISPOSABLE & EVENT ALIASES
# =========================================================================

class _ExtensionDisposable(Disposable):
    pass

class Event_:
    @staticmethod
    def filter(emitter: EventEmitter, predicate: Callable) -> EventEmitter:
        f = EventEmitter(name="filtered")
        def handler(e):
            if predicate(e):
                f.fire(e)
        emitter.subscribe(handler)
        return f

    @staticmethod
    def map(emitter: EventEmitter, mapper: Callable) -> EventEmitter:
        m = EventEmitter(name="mapped")
        def handler(e):
            m.fire(mapper(e))
        emitter.subscribe(handler)
        return m

    @staticmethod
    def any(*emitters: EventEmitter) -> EventEmitter:
        a = EventEmitter(name="any")
        def handler(e):
            a.fire(e)
        for em in emitters:
            em.subscribe(handler)
        return a

# =========================================================================
# 3.  CHAT & COPILOT APIS
# =========================================================================

class ChatMessageRole(Enum):
    System = "system"
    User = "user"
    Assistant = "assistant"
    Function = "function"

@dataclass
class ChatMessage:
    role: ChatMessageRole = ChatMessageRole.User
    content: str = ""
    name: Optional[str] = None

@dataclass
class ChatResponseMarkdownPart:
    value: str

@dataclass
class ChatResponseCodeblockPart:
    value: str
    language: str = ""

@dataclass
class ChatResponseAnchorPart:
    value: Any
    title: str = ""

@dataclass
class ChatResponseProgressPart:
    value: str

@dataclass
class ChatResponseReferencePart:
    value: URI

ChatResponsePart = Union[
    ChatResponseMarkdownPart,
    ChatResponseCodeblockPart,
    ChatResponseAnchorPart,
    ChatResponseProgressPart,
    ChatResponseReferencePart,
]

@dataclass
class ChatRequest:
    prompt: str
    message: str
    command: Optional[str] = None
    references: Optional[List[Any]] = None

class ChatResponseStream:
    def __init__(self):
        self._parts: List[ChatResponsePart] = []
        self._finished = False

    def markdown(self, value: str):
        self._parts.append(ChatResponseMarkdownPart(value=value))

    def codeblock(self, value: str, language: str = ""):
        self._parts.append(ChatResponseCodeblockPart(value=value, language=language))

    def anchor(self, value: Any, title: str = ""):
        self._parts.append(ChatResponseAnchorPart(value=value, title=title))

    def progress(self, value: str):
        self._parts.append(ChatResponseProgressPart(value=value))

    def reference(self, value: URI):
        self._parts.append(ChatResponseReferencePart(value=value))

    def finish(self):
        self._finished = True

    def to_list(self) -> List[ChatResponsePart]:
        return self._parts[:]

    def is_finished(self) -> bool:
        return self._finished


class ChatParticipant:
    def __init__(self, id: str, label: str):
        self._id = id
        self._label = label
        self._description: str = ""
        self._full_name: str = ""
        self._icon_path: str = ""
        self._is_sticky: bool = False
        self._slash_commands: List[Dict[str, Any]] = []
        self._followup_provider: Optional[Callable] = None
        self._request_handler: Optional[Callable] = None
        self._disposed = False
        self._on_did_receive_feedback = EventEmitter(name=f"chat:{id}:feedback")

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @property
    def description(self) -> str:
        return self._description
    @description.setter
    def description(self, v: str):
        self._description = v
    @property
    def full_name(self) -> str:
        return self._full_name
    @full_name.setter
    def full_name(self, v: str):
        self._full_name = v
    @property
    def icon_path(self) -> str:
        return self._icon_path
    @icon_path.setter
    def icon_path(self, v: str):
        self._icon_path = v
    @property
    def is_sticky(self) -> bool:
        return self._is_sticky
    @is_sticky.setter
    def is_sticky(self, v: bool):
        self._is_sticky = v
    @property
    def on_did_receive_feedback(self) -> EventEmitter:
        return self._on_did_receive_feedback

    def on_request(self, handler: Callable):
        self._request_handler = handler

    def register_slash_command(self, command: str, description: str, handler: Callable):
        self._slash_commands.append({"command": command, "description": description, "handler": handler})

    def provide_followups(self, provider: Callable):
        self._followup_provider = provider

    def dispose(self):
        self._disposed = True

    def __call__(self, request: ChatRequest, stream: ChatResponseStream, token: CancellationToken):
        if self._request_handler:
            return self._request_handler(request, stream, token)
        stream.markdown(f"Hello from {self._label}")


class ChatParticipantProvider:
    def __init__(self):
        self._participants: Dict[str, ChatParticipant] = {}
        self._on_did_change_participants = EventEmitter(name="chat:participants")
        self._on_did_receive_feedback = EventEmitter(name="chat:feedback")

    def register(self, id: str, label: str) -> ChatParticipant:
        p = ChatParticipant(id, label)
        self._participants[id] = p
        self._on_did_change_participants.fire(None)
        return p

    def get(self, id: str) -> Optional[ChatParticipant]:
        return self._participants.get(id)

    def all(self) -> List[ChatParticipant]:
        return list(self._participants.values())

    def unregister(self, id: str):
        self._participants.pop(id, None)
        self._on_did_change_participants.fire(None)

    @property
    def on_did_change_participants(self) -> EventEmitter:
        return self._on_did_change_participants
    @property
    def on_did_receive_feedback(self) -> EventEmitter:
        return self._on_did_receive_feedback


# =========================================================================
# 4.  LANGUAGE MODEL APIS
# =========================================================================

class LanguageModelChatMessageRole(IntEnum):
    User = 1
    Assistant = 2
    System = 3
    Tool = 4

@dataclass
class LanguageModelChatMessage:
    role: LanguageModelChatMessageRole = LanguageModelChatMessageRole.User
    content: str = ""
    name: Optional[str] = None

@dataclass
class LanguageModelTextPart:
    value: str

@dataclass
class LanguageModelToolCallPart:
    tool_id: str
    name: str
    arguments: Dict[str, Any]

@dataclass
class LanguageModelToolResultPart:
    tool_id: str
    content: str

LanguageModelChatPart = Union[LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart]

@dataclass
class LanguageModelChatResult:
    streaming: bool = False
    text: str = ""
    parts: List[LanguageModelChatPart] = field(default_factory=list)

    @property
    def content(self) -> str:
        return self.text


class LanguageModelError(Exception):
    def __init__(self, message: str, code: int = 500):
        super().__init__(message)
        self.code = code


class LanguageModelChatRequest:
    def __init__(self, model: str, messages: List[LanguageModelChatMessage], options: Dict[str, Any]):
        self.model = model
        self.messages = messages
        self.options = options
        self._cancelled = False
        self._listeners: List[Callable] = []

    def on_progress(self, listener: Callable):
        self._listeners.append(listener)

    def report(self, part: LanguageModelChatPart):
        for cb in self._listeners:
            try:
                cb(part)
            except Exception:
                pass

    def cancel(self):
        self._cancelled = True


class LanguageModelProvider:
    def __init__(self, id: str, name: str, vendor: str = "", family: str = ""):
        self.id = id
        self.name = name
        self.vendor = vendor
        self.family = family
        self._request_handler: Optional[Callable] = None

    def on_request(self, handler: Callable):
        self._request_handler = handler


class LanguageModelManager:
    def __init__(self):
        self._providers: Dict[str, LanguageModelProvider] = {}
        self._on_did_change_providers = EventEmitter(name="lm:providers")

    def register(self, provider: LanguageModelProvider) -> Disposable:
        self._providers[provider.id] = provider
        self._on_did_change_providers.fire(None)
        return _ExtensionDisposable(lambda: self._unregister(provider.id))

    def _unregister(self, id: str):
        self._providers.pop(id, None)
        self._on_did_change_providers.fire(None)

    def all(self) -> List[LanguageModelProvider]:
        return list(self._providers.values())

    def get(self, id: str) -> Optional[LanguageModelProvider]:
        return self._providers.get(id)

    def send_chat_request(
        self,
        model: str,
        messages: List[LanguageModelChatMessage],
        options: Optional[Dict[str, Any]] = None,
        token: Optional[CancellationToken] = None,
    ) -> LanguageModelChatResult:
        provider = self._providers.get(model)
        if not provider or not provider._request_handler:
            raise LanguageModelError(f"Model {model} not available", 404)
        request = LanguageModelChatRequest(model, messages, options or {})
        if token:
            token.on_cancelled.subscribe(lambda _: request.cancel())
        try:
            result = provider._request_handler(request)
            if result is None:
                raise LanguageModelError("Model returned no result", 500)
            return result
        except LanguageModelError:
            raise
        except Exception as e:
            raise LanguageModelError(str(e), 500)

    @property
    def on_did_change_providers(self) -> EventEmitter:
        return self._on_did_change_providers


# =========================================================================
# 5.  MCP APIs
# =========================================================================

@dataclass
class McpServerDefinition:
    id: str
    name: str
    command: str = ""
    args: List[str] = field(default_factory=list)
    transport_type: str = "stdio"
    env: Dict[str, str] = field(default_factory=dict)

@dataclass
class McpServerDescriptor:
    id: str
    name: str
    tools: List[Dict[str, Any]] = field(default_factory=list)
    resources: List[Dict[str, Any]] = field(default_factory=list)

class McpCollection:
    def __init__(self):
        self._servers: Dict[str, McpServerDefinition] = {}
        self._on_did_change_servers = EventEmitter(name="mcp:servers")

    def register(self, definition: McpServerDefinition) -> Disposable:
        self._servers[definition.id] = definition
        self._on_did_change_servers.fire(None)
        return _ExtensionDisposable(lambda: self._unregister(definition.id))

    def _unregister(self, id: str):
        self._servers.pop(id, None)
        self._on_did_change_servers.fire(None)

    def all(self) -> List[McpServerDefinition]:
        return list(self._servers.values())

    def get(self, id: str) -> Optional[McpServerDefinition]:
        return self._servers.get(id)

    @property
    def on_did_change_servers(self) -> EventEmitter:
        return self._on_did_change_servers


# =========================================================================
# 6.  AI & EMBEDDINGS APIS
# =========================================================================

@dataclass
class TextEmbedding:
    vector: List[float]
    text: str = ""

@dataclass
class EmbeddingResult:
    embeddings: List[TextEmbedding] = field(default_factory=list)

class EmbeddingsProvider:
    def __init__(self, id: str, name: str, model: str = ""):
        self.id = id
        self.name = name
        self.model = model
        self._embed_handler: Optional[Callable] = None

    def on_embed(self, handler: Callable):
        self._embed_handler = handler


class EmbeddingsManager:
    def __init__(self):
        self._providers: Dict[str, EmbeddingsProvider] = {}
        self._on_did_change_providers = EventEmitter(name="embeddings:providers")

    def register(self, provider: EmbeddingsProvider) -> Disposable:
        self._providers[provider.id] = provider
        self._on_did_change_providers.fire(None)
        return _ExtensionDisposable(lambda: self._unregister(provider.id))

    def _unregister(self, id: str):
        self._providers.pop(id, None)
        self._on_did_change_providers.fire(None)

    def embed(self, texts: List[str], model: str = "") -> EmbeddingResult:
        for p in self._providers.values():
            if p._embed_handler:
                try:
                    return p._embed_handler(texts, model)
                except Exception:
                    continue
        raise RuntimeError("No embeddings provider available")

    @property
    def on_did_change_providers(self) -> EventEmitter:
        return self._on_did_change_providers


# =========================================================================
# 7.  SCM APIS
# =========================================================================

class SourceControlInputBox:
    def __init__(self):
        self._value: str = ""
        self._placeholder: str = ""
        self._visible: bool = True
        self._on_did_change = EventEmitter(name="scm:input:change")

    @property
    def value(self) -> str:
        return self._value
    @value.setter
    def value(self, v: str):
        self._value = v
        self._on_did_change.fire(v)
    @property
    def placeholder(self) -> str:
        return self._placeholder
    @placeholder.setter
    def placeholder(self, v: str):
        self._placeholder = v
    @property
    def visible(self) -> bool:
        return self._visible
    @visible.setter
    def visible(self, v: bool):
        self._visible = v
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change


class SourceControlResourceState(Enum):
    Modified = "M"
    Added = "A"
    Deleted = "D"
    Untracked = "U"
    Ignored = "I"
    Conflict = "C"
    Renamed = "R"
    Copied = "C"

@dataclass
class SourceControlResource:
    resource_uri: URI
    state: SourceControlResourceState = SourceControlResourceState.Modified
    command: Optional[Dict[str, Any]] = None
    context_value: str = ""
    decorations: Optional[Dict[str, Any]] = None

class SourceControlResourceGroup:
    def __init__(self, id: str, label: str):
        self._id = id
        self._label = label
        self._resources: List[SourceControlResource] = []
        self._on_did_change = EventEmitter(name=f"scm:group:{id}")

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @label.setter
    def label(self, v: str):
        self._label = v
    @property
    def resources(self) -> List[SourceControlResource]:
        return self._resources[:]
    @resources.setter
    def resources(self, v: List[SourceControlResource]):
        self._resources = list(v)
        self._on_did_change.fire(None)
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change

    def dispose(self):
        self._resources.clear()


class SourceControl:
    def __init__(self, id: str, label: str):
        self._id = id
        self._label = label
        self._input_box = SourceControlInputBox()
        self._groups: List[SourceControlResourceGroup] = []
        self._count_badge: str = ""
        self._count: int = 0
        self._has_quick_diff_provider: bool = False
        self._commit_template: str = ""
        self._accept_input_command: Optional[Dict[str, Any]] = None
        self._status_bar_commands: List[Dict[str, Any]] = []
        self._on_did_change = EventEmitter(name=f"scm:{id}:change")

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @property
    def input_box(self) -> SourceControlInputBox:
        return self._input_box
    @property
    def count_badge(self) -> str:
        return self._count_badge
    @count_badge.setter
    def count_badge(self, v: str):
        self._count_badge = v
    @property
    def count(self) -> int:
        return self._count
    @count.setter
    def count(self, v: int):
        self._count = v
    @property
    def has_quick_diff_provider(self) -> bool:
        return self._has_quick_diff_provider
    @has_quick_diff_provider.setter
    def has_quick_diff_provider(self, v: bool):
        self._has_quick_diff_provider = v
    @property
    def commit_template(self) -> str:
        return self._commit_template
    @commit_template.setter
    def commit_template(self, v: str):
        self._commit_template = v
    @property
    def accept_input_command(self) -> Optional[Dict[str, Any]]:
        return self._accept_input_command
    @accept_input_command.setter
    def accept_input_command(self, v: Optional[Dict[str, Any]]):
        self._accept_input_command = v
    @property
    def status_bar_commands(self) -> List[Dict[str, Any]]:
        return self._status_bar_commands[:]
    @status_bar_commands.setter
    def status_bar_commands(self, v: List[Dict[str, Any]]):
        self._status_bar_commands = list(v)
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change

    def create_resource_group(self, id: str, label: str) -> SourceControlResourceGroup:
        g = SourceControlResourceGroup(id, label)
        self._groups.append(g)
        return g

    def get_resource_groups(self) -> List[SourceControlResourceGroup]:
        return self._groups[:]

    def dispose(self):
        for g in self._groups:
            g.dispose()
        self._groups.clear()


class ScmManager:
    def __init__(self):
        self._providers: Dict[str, SourceControl] = {}
        self._on_did_change = EventEmitter(name="scm:providers")

    def create_source_control(self, id: str, label: str) -> SourceControl:
        sc = SourceControl(id, label)
        self._providers[id] = sc
        self._on_did_change.fire(None)
        return sc

    def get(self, id: str) -> Optional[SourceControl]:
        return self._providers.get(id)

    def all(self) -> List[SourceControl]:
        return list(self._providers.values())

    def dispose(self, id: str):
        sc = self._providers.pop(id, None)
        if sc:
            sc.dispose()
            self._on_did_change.fire(None)

    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change


# =========================================================================
# 8.  TESTING APIS
# =========================================================================

class TestRunProfileKind(IntEnum):
    Run = 1; Debug = 2; Coverage = 3

class TestResultState(IntEnum):
    Unset = 0; Skipped = 1; Passed = 2; Failed = 3; Errored = 4; Running = 5; Queued = 6

@dataclass
class TestMessage:
    message: str = ""
    expected_value: str = ""
    actual_value: str = ""
    location: Optional[Range] = None

class TestItem:
    def __init__(self, id: str, label: str, uri: Optional[URI] = None):
        self._id = id
        self._label = label
        self._uri = uri
        self._description: str = ""
        self._sort_text: str = ""
        self._tags: List[str] = []
        self._range: Optional[Range] = None
        self._children: List[TestItem] = []
        self._parent: Optional[TestItem] = None
        self._can_resolve_children: bool = False
        self._error: Optional[TestMessage] = None

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @label.setter
    def label(self, v: str):
        self._label = v
    @property
    def uri(self) -> Optional[URI]:
        return self._uri
    @property
    def description(self) -> str:
        return self._description
    @description.setter
    def description(self, v: str):
        self._description = v
    @property
    def sort_text(self) -> str:
        return self._sort_text
    @sort_text.setter
    def sort_text(self, v: str):
        self._sort_text = v
    @property
    def tags(self) -> List[str]:
        return self._tags[:]
    @tags.setter
    def tags(self, v: List[str]):
        self._tags = list(v)
    @property
    def range(self) -> Optional[Range]:
        return self._range
    @range.setter
    def range(self, v: Optional[Range]):
        self._range = v
    @property
    def parent(self) -> Optional[TestItem]:
        return self._parent
    @property
    def can_resolve_children(self) -> bool:
        return self._can_resolve_children
    @can_resolve_children.setter
    def can_resolve_children(self, v: bool):
        self._can_resolve_children = v
    @property
    def error(self) -> Optional[TestMessage]:
        return self._error
    @error.setter
    def error(self, v: Optional[TestMessage]):
        self._error = v

    def children(self) -> List[TestItem]:
        return self._children[:]

    def add_child(self, child: TestItem):
        child._parent = self
        self._children.append(child)

    def remove_child(self, child: TestItem):
        child._parent = None
        self._children = [c for c in self._children if c.id != child.id]

    def dispose(self):
        for c in self._children[:]:
            c.dispose()
        self._children.clear()


class TestRun:
    def __init__(self, name: str, profile_kind: TestRunProfileKind = TestRunProfileKind.Run):
        self._name = name
        self._profile_kind = profile_kind
        self._is_running = True
        self._output: str = ""
        self._on_did_end = EventEmitter(name=f"test:run:{name}:end")

    @property
    def is_running(self) -> bool:
        return self._is_running

    def append_output(self, output: str):
        self._output += output

    def set_result(self, test: TestItem, state: TestResultState, message: Optional[TestMessage] = None):
        emit("test.run.result", {"test": test.id, "state": state, "message": message})

    def end(self):
        self._is_running = False
        self._on_did_end.fire(None)

    @property
    def on_did_end(self) -> EventEmitter:
        return self._on_did_end


class TestRunProfile:
    def __init__(self, label: str, kind: TestRunProfileKind, handler: Callable):
        self._label = label
        self._kind = kind
        self._handler = handler
        self._group: Optional[str] = None

    @property
    def label(self) -> str:
        return self._label
    @label.setter
    def label(self, v: str):
        self._label = v
    @property
    def kind(self) -> TestRunProfileKind:
        return self._kind
    @property
    def group(self) -> Optional[str]:
        return self._group
    @group.setter
    def group(self, v: Optional[str]):
        self._group = v

    def run(self, request: TestRun, token: CancellationToken) -> Any:
        return self._handler(request, token)


class TestController:
    def __init__(self, id: str, label: str):
        self._id = id
        self._label = label
        self._items: Dict[str, TestItem] = {}
        self._run_profiles: Dict[str, TestRunProfile] = {}
        self._resolve_handler: Optional[Callable] = None
        self._refresh_handler: Optional[Callable] = None
        self._on_invalidate_test_results = EventEmitter(name=f"test:{id}:invalidate")

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @property
    def on_invalidate_test_results(self) -> EventEmitter:
        return self._on_invalidate_test_results

    def create_test_item(self, id: str, label: str, uri: Optional[URI] = None) -> TestItem:
        item = TestItem(id, label, uri)
        self._items[id] = item
        return item

    def get_test_item(self, id: str) -> Optional[TestItem]:
        return self._items.get(id)

    def create_run_profile(self, label: str, kind: TestRunProfileKind, handler: Callable) -> TestRunProfile:
        p = TestRunProfile(label, kind, handler)
        self._run_profiles[label] = p
        return p

    def create_test_run(self, name: str, profile_kind: TestRunProfileKind = TestRunProfileKind.Run) -> TestRun:
        return TestRun(name, profile_kind)

    def on_resolve_children(self, handler: Callable):
        self._resolve_handler = handler

    def on_refresh(self, handler: Callable):
        self._refresh_handler = handler

    def resolve_children(self, item: TestItem):
        if self._resolve_handler:
            self._resolve_handler(item)

    def refresh(self):
        if self._refresh_handler:
            self._refresh_handler()

    def dispose(self):
        self._items.clear()
        self._run_profiles.clear()


class TestControllerManager:
    def __init__(self):
        self._controllers: Dict[str, TestController] = {}

    def create_test_controller(self, id: str, label: str) -> TestController:
        c = TestController(id, label)
        self._controllers[id] = c
        return c

    def get(self, id: str) -> Optional[TestController]:
        return self._controllers.get(id)

    def all(self) -> List[TestController]:
        return list(self._controllers.values())

    def dispose(self, id: str):
        c = self._controllers.pop(id, None)
        if c:
            c.dispose()


# =========================================================================
# 9.  TERMINAL APIS
# =========================================================================

class TerminalLocation(IntEnum):
    Panel = 1; Editor = 2

@dataclass
class TerminalProfile:
    name: str = ""
    options: Dict[str, Any] = field(default_factory=dict)
    is_default: bool = False
    icon: str = ""
    color: str = ""

@dataclass
class TerminalOptions:
    name: str = ""
    shell_path: str = ""
    shell_args: List[str] = field(default_factory=list)
    cwd: str = ""
    env: Dict[str, str] = field(default_factory=dict)
    strict_env: bool = False
    hide_from_user: bool = False
    is_transient: bool = False
    location: TerminalLocation = TerminalLocation.Panel
    icon_path: str = ""
    color: str = ""
    message: str = ""
    is_creation_options_only: bool = False

@dataclass
class TerminalLink:
    start_index: int = 0
    length: int = 0
    tooltip: str = ""

class TerminalLinkProvider:
    def __init__(self):
        self._provide_handler: Optional[Callable] = None
        self._activate_handler: Optional[Callable] = None

    def provide_links(self, handler: Callable):
        self._provide_handler = handler

    def handle_activate(self, handler: Callable):
        self._activate_handler = handler


class TerminalProfileProvider:
    def __init__(self):
        self._provide_handler: Optional[Callable] = None

    def provide_profiles(self, handler: Callable):
        self._provide_handler = handler


class TerminalExitStatus:
    def __init__(self, code: int = 0, reason: str = ""):
        self.code = code
        self.reason = reason


class Terminal:
    def __init__(self, name: str, options: Optional[TerminalOptions] = None):
        self._name = name
        self._options = options or TerminalOptions(name=name)
        self._process_id: Optional[int] = None
        self._exit_status: Optional[TerminalExitStatus] = None
        self._on_did_close = EventEmitter(name=f"terminal:{name}:close")
        self._on_did_write = EventEmitter(name=f"terminal:{name}:write")
        self._on_did_change_terminal_state = EventEmitter(name=f"terminal:{name}:state")
        self._disposed = False

    @property
    def name(self) -> str:
        return self._name
    @property
    def process_id(self) -> Optional[int]:
        return self._process_id
    @process_id.setter
    def process_id(self, v: Optional[int]):
        self._process_id = v
    @property
    def exit_status(self) -> Optional[TerminalExitStatus]:
        return self._exit_status
    @property
    def on_did_close(self) -> EventEmitter:
        return self._on_did_close
    @property
    def on_did_write(self) -> EventEmitter:
        return self._on_did_write
    @property
    def on_did_change_terminal_state(self) -> EventEmitter:
        return self._on_did_change_terminal_state

    def send_text(self, text: str):
        emit("terminal.send_text", {"name": self._name, "text": text})

    def show(self, preserve_focus: bool = False):
        emit("terminal.show", {"name": self._name, "preserveFocus": preserve_focus})

    def hide(self):
        emit("terminal.hide", {"name": self._name})

    def dispose(self):
        self._disposed = True
        self._on_did_close.fire(self)


class TerminalManager:
    def __init__(self):
        self._terminals: Dict[str, Terminal] = {}
        self._link_providers: List[TerminalLinkProvider] = []
        self._profile_providers: List[TerminalProfileProvider] = []
        self._on_did_open = EventEmitter(name="terminal:open")
        self._on_did_close = EventEmitter(name="terminal:close")
        self._on_did_change_active = EventEmitter(name="terminal:active")
        self._on_did_change_shell = EventEmitter(name="terminal:shell")

    def create_terminal(self, name: str, options: Optional[TerminalOptions] = None) -> Terminal:
        t = Terminal(name, options)
        self._terminals[name] = t
        self._on_did_open.fire(t)
        return t

    def get(self, name: str) -> Optional[Terminal]:
        return self._terminals.get(name)

    def all(self) -> List[Terminal]:
        return list(self._terminals.values())

    def dispose(self, name: str):
        t = self._terminals.pop(name, None)
        if t:
            t.dispose()
            self._on_did_close.fire(t)

    def register_link_provider(self, provider: TerminalLinkProvider) -> Disposable:
        self._link_providers.append(provider)
        return _ExtensionDisposable(lambda: self._link_providers.remove(provider))

    def register_profile_provider(self, provider: TerminalProfileProvider) -> Disposable:
        self._profile_providers.append(provider)
        return _ExtensionDisposable(lambda: self._profile_providers.remove(provider))

    @property
    def on_did_open(self) -> EventEmitter:
        return self._on_did_open
    @property
    def on_did_close(self) -> EventEmitter:
        return self._on_did_close
    @property
    def on_did_change_active(self) -> EventEmitter:
        return self._on_did_change_active
    @property
    def on_did_change_shell(self) -> EventEmitter:
        return self._on_did_change_shell


# =========================================================================
# 10. NOTEBOOK APIS
# =========================================================================

class NotebookCellKind(IntEnum):
    Markup = 1; Code = 2

class NotebookCellStatusBarAlignment(IntEnum):
    Left = 1; Right = 2

class NotebookEditorEdit:
    def __init__(self):
        self._edits: List[Dict[str, Any]] = []

    def insert(self, index: int, cell: Any):
        self._edits.append({"action": "insert", "index": index, "cell": cell})

    def delete(self, index: int):
        self._edits.append({"action": "delete", "index": index})

    def replace(self, index: int, cell: Any):
        self._edits.append({"action": "replace", "index": index, "cell": cell})

    def move(self, from_index: int, to_index: int):
        self._edits.append({"action": "move", "from": from_index, "to": to_index})

    def set_cell_data(self, index: int, data: Dict[str, Any]):
        self._edits.append({"action": "setCellData", "index": index, "data": data})

    def set_cell_metadata(self, index: int, metadata: Dict[str, Any]):
        self._edits.append({"action": "setCellMetadata", "index": index, "metadata": metadata})

    def set_cell_language(self, index: int, language: str):
        self._edits.append({"action": "setCellLanguage", "index": index, "language": language})

    def set_cell_output_items(self, index: int, outputs: List[Any]):
        self._edits.append({"action": "setCellOutputItems", "index": index, "outputs": outputs})

@dataclass
class NotebookCellStatusBarItem:
    text: str = ""
    alignment: NotebookCellStatusBarAlignment = NotebookCellStatusBarAlignment.Left
    command: Optional[str] = None
    tooltip: str = ""
    priority: int = 0

class NotebookCell:
    def __init__(self, kind: NotebookCellKind, index: int, document: Any):
        self._kind = kind
        self._index = index
        self._document = document
        self._metadata: Dict[str, Any] = {}
        self._outputs: List[Any] = []
        self._language: str = ""
    @property
    def kind(self) -> NotebookCellKind:
        return self._kind
    @property
    def index(self) -> int:
        return self._index
    @property
    def document(self) -> Any:
        return self._document
    @property
    def metadata(self) -> Dict[str, Any]:
        return self._metadata
    @metadata.setter
    def metadata(self, v: Dict[str, Any]):
        self._metadata = v
    @property
    def outputs(self) -> List[Any]:
        return self._outputs[:]
    @property
    def language(self) -> str:
        return self._language
    @language.setter
    def language(self, v: str):
        self._language = v


class NotebookSerializer:
    def serialize(self, cells: List[NotebookCell], token: CancellationToken) -> bytes:
        data = []
        for cell in cells:
            data.append({
                "kind": cell.kind.value,
                "source": cell.document.get_text() if hasattr(cell.document, "get_text") else "",
                "language": cell.language,
                "metadata": cell.metadata,
                "outputs": cell.outputs,
            })
        return json.dumps(data, indent=2).encode("utf-8")

    def deserialize(self, content: bytes, token: CancellationToken) -> List[NotebookCell]:
        try:
            data = json.loads(content.decode("utf-8"))
            cells = []
            for i, item in enumerate(data):
                doc = _NotebookCellDocument(item.get("source", ""))
                cell = NotebookCell(
                    NotebookCellKind(item.get("kind", 2)),
                    i, doc
                )
                cell.language = item.get("language", "")
                cell.metadata = item.get("metadata", {})
                cells.append(cell)
            return cells
        except Exception:
            return []


class _NotebookCellDocument:
    def __init__(self, text: str = ""):
        self._text = text

    def get_text(self) -> str:
        return self._text


class NotebookKernel:
    def __init__(self, id: str, label: str):
        self._id = id
        self._label = label
        self._description: str = ""
        self._detail: str = ""
        self._preload_uris: List[URI] = []
        self._execute_handler: Optional[Callable] = None
        self._on_did_change = EventEmitter(name=f"notebook:kernel:{id}")
        self._on_did_change_notebook = EventEmitter(name=f"notebook:kernel:{id}:notebook")

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @property
    def description(self) -> str:
        return self._description
    @description.setter
    def description(self, v: str):
        self._description = v
    @property
    def detail(self) -> str:
        return self._detail
    @detail.setter
    def detail(self, v: str):
        self._detail = v
    @property
    def preload_uris(self) -> List[URI]:
        return self._preload_uris[:]
    @preload_uris.setter
    def preload_uris(self, v: List[URI]):
        self._preload_uris = list(v)
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change
    @property
    def on_did_change_notebook(self) -> EventEmitter:
        return self._on_did_change_notebook

    def on_execute(self, handler: Callable):
        self._execute_handler = handler

    def execute(self, cells: List[NotebookCell], notebook_document: Any, token: CancellationToken):
        if self._execute_handler:
            return self._execute_handler(cells, notebook_document, token)


class NotebookRendererScript:
    def __init__(self, id: str, entrypoint: str, display_name: str = ""):
        self.id = id
        self.entrypoint = entrypoint
        self.display_name = display_name


class NotebookController:
    def __init__(self, id: str, label: str, notebook_type: str):
        self._id = id
        self._label = label
        self._notebook_type = notebook_type
        self._description: str = ""
        self._detail: str = ""
        self._supported_languages: List[str] = []
        self._supports_execution_order: bool = False
        self._execute_handler: Optional[Callable] = None
        self._renderer_scripts: List[NotebookRendererScript] = []

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @label.setter
    def label(self, v: str):
        self._label = v
    @property
    def description(self) -> str:
        return self._description
    @description.setter
    def description(self, v: str):
        self._description = v
    @property
    def detail(self) -> str:
        return self._detail
    @detail.setter
    def detail(self, v: str):
        self._detail = v
    @property
    def supported_languages(self) -> List[str]:
        return self._supported_languages[:]
    @supported_languages.setter
    def supported_languages(self, v: List[str]):
        self._supported_languages = list(v)
    @property
    def supports_execution_order(self) -> bool:
        return self._supports_execution_order
    @supports_execution_order.setter
    def supports_execution_order(self, v: bool):
        self._supports_execution_order = v
    @property
    def renderer_scripts(self) -> List[NotebookRendererScript]:
        return self._renderer_scripts[:]

    def on_execute(self, handler: Callable):
        self._execute_handler = handler

    def dispose(self):
        pass


class NotebookManager:
    def __init__(self):
        self._serializers: Dict[str, NotebookSerializer] = {}
        self._kernels: Dict[str, NotebookKernel] = {}
        self._controllers: Dict[str, NotebookController] = {}
        self._renderers: Dict[str, NotebookRendererScript] = {}
        self._on_did_open = EventEmitter(name="notebook:open")
        self._on_did_close = EventEmitter(name="notebook:close")

    def register_notebook_serializer(self, notebook_type: str, serializer: NotebookSerializer) -> Disposable:
        self._serializers[notebook_type] = serializer
        return _ExtensionDisposable(lambda: self._serializers.pop(notebook_type, None))

    def register_kernel(self, kernel: NotebookKernel) -> Disposable:
        self._kernels[kernel.id] = kernel
        return _ExtensionDisposable(lambda: self._kernels.pop(kernel.id, None))

    def create_notebook_controller(self, id: str, label: str, notebook_type: str) -> NotebookController:
        c = NotebookController(id, label, notebook_type)
        self._controllers[id] = c
        return c

    def register_renderer_script(self, renderer: NotebookRendererScript) -> Disposable:
        self._renderers[renderer.id] = renderer
        return _ExtensionDisposable(lambda: self._renderers.pop(renderer.id, None))

    def get_serializer(self, notebook_type: str) -> Optional[NotebookSerializer]:
        return self._serializers.get(notebook_type)

    @property
    def on_did_open(self) -> EventEmitter:
        return self._on_did_open
    @property
    def on_did_close(self) -> EventEmitter:
        return self._on_did_close


# =========================================================================
# 11. AUTHENTICATION APIS
# =========================================================================

class AuthenticationSession:
    def __init__(self, id: str, label: str, access_token: str,
                 scopes: Optional[List[str]] = None,
                 account_label: str = "",
                 account_id: str = ""):
        self._id = id
        self._label = label
        self._access_token = access_token
        self._scopes = scopes or []
        self._account_label = account_label or label
        self._account_id = account_id or id
        self._id_token: str = ""

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @property
    def access_token(self) -> str:
        return self._access_token
    @property
    def scopes(self) -> List[str]:
        return self._scopes[:]
    @property
    def account_label(self) -> str:
        return self._account_label
    @property
    def account_id(self) -> str:
        return self._account_id
    @property
    def id_token(self) -> str:
        return self._id_token
    @id_token.setter
    def id_token(self, v: str):
        self._id_token = v


class AuthenticationProvider:
    def __init__(self, id: str, label: str):
        self._id = id
        self._label = label
        self._supports_multiple_accounts: bool = False
        self._on_did_change_sessions = EventEmitter(name=f"auth:{id}:sessions")
        self._login_handler: Optional[Callable] = None
        self._logout_handler: Optional[Callable] = None
        self._sessions: Dict[str, AuthenticationSession] = {}

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @property
    def supports_multiple_accounts(self) -> bool:
        return self._supports_multiple_accounts
    @supports_multiple_accounts.setter
    def supports_multiple_accounts(self, v: bool):
        self._supports_multiple_accounts = v
    @property
    def on_did_change_sessions(self) -> EventEmitter:
        return self._on_did_change_sessions

    def on_login(self, handler: Callable):
        self._login_handler = handler

    def on_logout(self, handler: Callable):
        self._logout_handler = handler

    def login(self, scopes: List[str]) -> AuthenticationSession:
        if self._login_handler:
            session = self._login_handler(scopes)
            if session:
                self._sessions[session.id] = session
                self._on_did_change_sessions.fire({"added": [session], "removed": [], "changed": []})
                return session
        raise RuntimeError(f"Login not supported by provider {self._id}")

    def logout(self, session_id: str):
        session = self._sessions.pop(session_id, None)
        if session:
            self._on_did_change_sessions.fire({"added": [], "removed": [session], "changed": []})

    def get_sessions(self, scopes: Optional[List[str]] = None) -> List[AuthenticationSession]:
        if not scopes:
            return list(self._sessions.values())
        return [s for s in self._sessions.values()
                if any(scope in s.scopes for scope in scopes)]

    def create_session(self, session: AuthenticationSession):
        self._sessions[session.id] = session
        self._on_did_change_sessions.fire({"added": [session], "removed": [], "changed": []})


class AuthenticationManager:
    def __init__(self):
        self._providers: Dict[str, AuthenticationProvider] = {}
        self._on_did_change_providers = EventEmitter(name="auth:providers")

    def register_authentication_provider(self, id: str, label: str) -> AuthenticationProvider:
        p = AuthenticationProvider(id, label)
        self._providers[id] = p
        self._on_did_change_providers.fire(None)
        return p

    def get(self, id: str) -> Optional[AuthenticationProvider]:
        return self._providers.get(id)

    def all(self) -> List[AuthenticationProvider]:
        return list(self._providers.values())

    def get_session(self, provider_id: str, scopes: List[str],
                    create_if_none: bool = False) -> Optional[AuthenticationSession]:
        provider = self._providers.get(provider_id)
        if not provider:
            return None
        sessions = provider.get_sessions(scopes)
        if sessions:
            return sessions[0]
        if create_if_none:
            return provider.login(scopes)
        return None

    @property
    def on_did_change_providers(self) -> EventEmitter:
        return self._on_did_change_providers


# =========================================================================
# 12. COMMENTS APIS
# =========================================================================

@dataclass
class Comment:
    body: str = ""
    author_name: str = ""
    author_icon: str = ""
    label: str = ""
    context_value: str = ""
    timestamp: Optional[str] = None
    mode: CommentMode = CommentMode.Preview

@dataclass
class CommentThread:
    uri: URI = field(default_factory=lambda: URI())
    range: Range = field(default_factory=lambda: Range())
    comments: List[Comment] = field(default_factory=list)
    collapsible_state: CommentThreadCollapsibleState = CommentThreadCollapsibleState.Expanded
    state: CommentThreadState = CommentThreadState.Unresolved
    label: str = ""
    context_value: str = ""
    thread_id: str = ""
    resource: Optional[Any] = None
    error: Optional[str] = None

    def __post_init__(self):
        if not self.thread_id:
            self.thread_id = str(uuid.uuid4())

    def dispose(self):
        self.comments.clear()


class CommentController:
    def __init__(self, id: str, label: str):
        self._id = id
        self._label = label
        self._threads: Dict[str, CommentThread] = []
        self._commenting_range_provider: Optional[Callable] = None
        self._reaction_handler: Optional[Callable] = None
        self._on_did_change_threads = EventEmitter(name=f"comments:{id}:threads")

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @label.setter
    def label(self, v: str):
        self._label = v
    @property
    def on_did_change_threads(self) -> EventEmitter:
        return self._on_did_change_threads

    def create_comment_thread(self, uri: URI, range: Range, comments: List[Comment]) -> CommentThread:
        thread = CommentThread(uri=uri, range=range, comments=comments)
        self._threads.append(thread)
        self._on_did_change_threads.fire(None)
        return thread

    def delete_comment_thread(self, thread: CommentThread):
        self._threads = [t for t in self._threads if t.thread_id != thread.thread_id]
        thread.dispose()
        self._on_did_change_threads.fire(None)

    def get_threads(self) -> List[CommentThread]:
        return self._threads[:]

    def on_commenting_range_provider(self, handler: Callable):
        self._commenting_range_provider = handler

    def on_reaction(self, handler: Callable):
        self._reaction_handler = handler

    def dispose(self):
        for t in self._threads:
            t.dispose()
        self._threads.clear()


class CommentManager:
    def __init__(self):
        self._controllers: Dict[str, CommentController] = {}

    def create_comment_controller(self, id: str, label: str) -> CommentController:
        c = CommentController(id, label)
        self._controllers[id] = c
        return c

    def get(self, id: str) -> Optional[CommentController]:
        return self._controllers.get(id)

    def all(self) -> List[CommentController]:
        return list(self._controllers.values())

    def dispose(self, id: str):
        c = self._controllers.pop(id, None)
        if c:
            c.dispose()


# =========================================================================
# 13. DEBUG APIS
# =========================================================================

@dataclass
class DebugConfiguration:
    name: str = ""
    type: str = ""
    request: str = "launch"
    program: str = ""
    args: List[str] = field(default_factory=list)
    cwd: str = ""
    env: Dict[str, str] = field(default_factory=dict)
    stop_on_entry: bool = False
    console: str = "integratedTerminal"
    pre_launch_task: str = ""
    post_debug_task: str = ""
    presentation: Dict[str, Any] = field(default_factory=dict)
    internal_console_options: str = ""
    debug_options: List[str] = field(default_factory=list)

class DebugAdapterTracker:
    def on_did_send_message(self, message: dict): pass
    def on_will_receive_message(self, message: dict): pass
    def on_error(self, error: Exception): pass
    def on_exit(self, code: Optional[int], signal: Optional[str]): pass

class DebugAdapterTrackerFactory:
    def create_tracker(self, session: Any) -> Optional[DebugAdapterTracker]:
        return None

class DebugConfigurationProvider:
    def provide_debug_configurations(self, folder: Optional[Any], token: CancellationToken) -> List[DebugConfiguration]:
        return []

    def resolve_debug_configuration(self, folder: Optional[Any], config: DebugConfiguration,
                                    token: CancellationToken) -> Optional[DebugConfiguration]:
        return config


class DebugAdapterDescriptorFactory:
    def create_debug_adapter_descriptor(self, session: Any, executable: Any) -> Any:
        raise NotImplementedError


class DebugAdapterExecutable:
    def __init__(self, command: str, args: Optional[List[str]] = None):
        self.command = command
        self.args = args or []


class DebugSession:
    def __init__(self, id: str, name: str, type: str,
                 configuration: DebugConfiguration,
                 workspace_folder: Optional[Any] = None,
                 parent_session: Optional[DebugSession] = None):
        self._id = id
        self._name = name
        self._type = type
        self._configuration = configuration
        self._workspace_folder = workspace_folder
        self._parent_session = parent_session
        self._custom_request_handler: Optional[Callable] = None
        self._on_did_change = EventEmitter(name=f"debug:session:{id}")

    @property
    def id(self) -> str:
        return self._id
    @property
    def name(self) -> str:
        return self._name
    @property
    def type(self) -> str:
        return self._type
    @property
    def configuration(self) -> DebugConfiguration:
        return self._configuration
    @property
    def workspace_folder(self) -> Optional[Any]:
        return self._workspace_folder
    @property
    def parent_session(self) -> Optional[DebugSession]:
        return self._parent_session
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change

    def custom_request(self, command: str, args: Optional[Dict[str, Any]] = None) -> Any:
        if self._custom_request_handler:
            return self._custom_request_handler(command, args)
        return None

    def on_custom_request(self, handler: Callable):
        self._custom_request_handler = handler


class DebugManager:
    def __init__(self):
        self._config_providers: List[DebugConfigurationProvider] = []
        self._tracker_factories: List[DebugAdapterTrackerFactory] = []
        self._descriptor_factories: List[DebugAdapterDescriptorFactory] = []
        self._sessions: Dict[str, DebugSession] = {}
        self._active_debug_session: Optional[DebugSession] = None
        self._breakpoints: List[Any] = []
        self._on_did_start = EventEmitter(name="debug:start")
        self._on_did_terminate = EventEmitter(name="debug:terminate")
        self._on_did_change_active = EventEmitter(name="debug:active")
        self._on_did_receive_terminate = EventEmitter(name="debug:receive_terminate")
        self._on_did_change_breakpoints = EventEmitter(name="debug:breakpoints")

    def register_debug_configuration_provider(self, provider: DebugConfigurationProvider) -> Disposable:
        self._config_providers.append(provider)
        return _ExtensionDisposable(lambda: self._config_providers.remove(provider))

    def register_debug_adapter_tracker_factory(self, factory: DebugAdapterTrackerFactory) -> Disposable:
        self._tracker_factories.append(factory)
        return _ExtensionDisposable(lambda: self._tracker_factories.remove(factory))

    def register_debug_adapter_descriptor_factory(self, factory: DebugAdapterDescriptorFactory) -> Disposable:
        self._descriptor_factories.append(factory)
        return _ExtensionDisposable(lambda: self._descriptor_factories.remove(factory))

    def create_debug_session(self, name: str, type: str,
                              configuration: DebugConfiguration) -> DebugSession:
        session = DebugSession(str(uuid.uuid4()), name, type, configuration)
        self._sessions[session.id] = session
        self._active_debug_session = session
        self._on_did_start.fire(session)
        return session

    def stop_debugging(self, session: Optional[DebugSession] = None):
        if session:
            self._sessions.pop(session.id, None)
            self._on_did_terminate.fire(session)
        elif self._active_debug_session:
            sid = self._active_debug_session.id
            self._sessions.pop(sid, None)
            self._on_did_terminate.fire(self._active_debug_session)
            self._active_debug_session = None

    @property
    def active_debug_session(self) -> Optional[DebugSession]:
        return self._active_debug_session
    @property
    def sessions(self) -> List[DebugSession]:
        return list(self._sessions.values())
    @property
    def on_did_start(self) -> EventEmitter:
        return self._on_did_start
    @property
    def on_did_terminate(self) -> EventEmitter:
        return self._on_did_terminate
    @property
    def on_did_change_active(self) -> EventEmitter:
        return self._on_did_change_active
    @property
    def on_did_receive_terminate(self) -> EventEmitter:
        return self._on_did_receive_terminate
    @property
    def on_did_change_breakpoints(self) -> EventEmitter:
        return self._on_did_change_breakpoints


# =========================================================================
# 14. EDITOR APIS (TextDocument, TextEditor, Workspace)
# =========================================================================

class TextDocument:
    def __init__(self, uri: URI, language_id: str = "plaintext", version: int = 1):
        self._uri = uri
        self._language_id = language_id
        self._version = version
        self._content: str = ""
        self._lines: List[str] = [""]
        self._is_dirty: bool = False
        self._is_closed: bool = False
        self._eol: EndOfLine = EndOfLine.LF
        self._file_size: int = 0
        self._max_line_length: int = 0
        self._on_did_change = EventEmitter(name=f"doc:change:{uri}")
        self._on_did_save = EventEmitter(name=f"doc:save:{uri}")

    @property
    def uri(self) -> URI:
        return self._uri
    @property
    def file_name(self) -> str:
        return self._uri.fs_path
    @property
    def language_id(self) -> str:
        return self._language_id
    @language_id.setter
    def language_id(self, v: str):
        self._language_id = v
    @property
    def is_dirty(self) -> bool:
        return self._is_dirty
    @property
    def is_closed(self) -> bool:
        return self._is_closed
    @property
    def eol(self) -> EndOfLine:
        return self._eol
    @property
    def version(self) -> int:
        return self._version
    @property
    def line_count(self) -> int:
        return len(self._lines)
    @property
    def file_size(self) -> int:
        return self._file_size
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change
    @property
    def on_did_save(self) -> EventEmitter:
        return self._on_did_save

    def get_text(self, range: Optional[Range] = None) -> str:
        if range is None:
            return self._content
        lines = self._lines[range.start.line:range.end.line + 1]
        if not lines:
            return ""
        if len(lines) == 1:
            return lines[0][range.start.character:range.end.character]
        lines[0] = lines[0][range.start.character:]
        lines[-1] = lines[-1][:range.end.character] if range.end.character > 0 else ""
        return "\n".join(lines)

    def get_line(self, line: int) -> str:
        return self._lines[line] if 0 <= line < len(self._lines) else ""

    def line_at(self, line: int) -> Range:
        if 0 <= line < len(self._lines):
            return Range(Position(line, 0), Position(line, len(self._lines[line])))
        return Range()

    def offset_at(self, position: Position) -> int:
        offset = 0
        for i in range(position.line):
            offset += len(self._lines[i]) + 1
        return offset + position.character

    def position_at(self, offset: int) -> Position:
        for i, line in enumerate(self._lines):
            if offset <= len(line):
                return Position(i, offset)
            offset -= len(line) + 1
        return Position(len(self._lines) - 1, len(self._lines[-1]) if self._lines else 0)

    def set_text(self, content: str):
        self._content = content
        self._lines = content.split("\n") if content else [""]
        self._file_size = len(content.encode("utf-8"))
        self._version += 1
        self._is_dirty = True
        self._on_did_change.fire(None)

    def save(self):
        self._is_dirty = False
        self._on_did_save.fire(None)

    def close(self):
        self._is_closed = True


class TextEditorCursorStyle(IntEnum):
    Line = 1; Block = 2; Underline = 3; LineThin = 4; BlockOutline = 5; UnderlineThin = 6

class TextEditorLineNumbersStyle(IntEnum):
    Off = 0; On = 1; Relative = 2; Interval = 3

class TextEditorSelectionStyle(IntEnum):
    Line = 0; WrappedLine = 1

@dataclass
class TextEditorOptions:
    tab_size: int = 4
    indent_size: int = 4
    insert_spaces: bool = True
    cursor_style: TextEditorCursorStyle = TextEditorCursorStyle.Line
    line_numbers: TextEditorLineNumbersStyle = TextEditorLineNumbersStyle.On
    cursor_surrounding_lines: int = 0


class TextEditorEdit:
    def __init__(self):
        self._edits: List[Dict[str, Any]] = []

    def replace(self, location: Union[Range, Position, Selection], value: str):
        if isinstance(location, Position):
            location = Range(location, location)
        elif isinstance(location, Selection):
            location = Range(location.start, location.end)
        self._edits.append({"type": "replace", "range": location, "value": value})

    def insert(self, position: Position, value: str):
        self._edits.append({"type": "insert", "position": position, "value": value})

    def delete(self, location: Range):
        self._edits.append({"type": "delete", "range": location})

    def set_end_of_line(self, eol: EndOfLine):
        self._edits.append({"type": "setEndOfLine", "eol": eol})


class TextEditor:
    def __init__(self, document: TextDocument, view_column: int = 1):
        self._document = document
        self._view_column = view_column
        self._selections: List[Selection] = [Selection()]
        self._visible_ranges: List[Range] = [Range()]
        self._options = TextEditorOptions()
        self._on_did_change_selections = EventEmitter(name="editor:selections")
        self._on_did_change_visible_ranges = EventEmitter(name="editor:visible")
        self._on_did_change_options = EventEmitter(name="editor:options")

    @property
    def document(self) -> TextDocument:
        return self._document
    @property
    def selection(self) -> Selection:
        return self._selections[0] if self._selections else Selection()
    @selection.setter
    def selection(self, s: Selection):
        self._selections = [s]
        self._on_did_change_selections.fire(None)
    @property
    def selections(self) -> List[Selection]:
        return self._selections[:]
    @selections.setter
    def selections(self, s: List[Selection]):
        self._selections = list(s)
        self._on_did_change_selections.fire(None)
    @property
    def visible_ranges(self) -> List[Range]:
        return self._visible_ranges[:]
    @property
    def options(self) -> TextEditorOptions:
        return self._options
    @options.setter
    def options(self, opts: TextEditorOptions):
        self._options = opts
        self._on_did_change_options.fire(None)
    @property
    def view_column(self) -> int:
        return self._view_column
    @property
    def on_did_change_selections(self) -> EventEmitter:
        return self._on_did_change_selections
    @property
    def on_did_change_visible_ranges(self) -> EventEmitter:
        return self._on_did_change_visible_ranges
    @property
    def on_did_change_options(self) -> EventEmitter:
        return self._on_did_change_options

    def edit(self, callback: Callable[[TextEditorEdit], None]) -> bool:
        edit = TextEditorEdit()
        try:
            callback(edit)
            emit("editor.edit", {"uri": str(self._document.uri), "edits": edit._edits})
            return True
        except Exception:
            return False

    def insert_snippet(self, snippet: str, location: Optional[Union[Position, Range]] = None):
        emit("editor.insertSnippet", {"snippet": snippet})

    def reveal_range(self, range: Range, reveal_type: int = 0):
        emit("editor.revealRange", {"uri": str(self._document.uri), "range": range})

    def show(self, column: int = 1):
        emit("editor.show", {"uri": str(self._document.uri), "column": column})

    def hide(self):
        emit("editor.hide", {"uri": str(self._document.uri)})

    def set_decorations(self, decoration_type: Any, ranges_or_options: List[Any]):
        emit("editor.setDecorations", {"uri": str(self._document.uri), "ranges": ranges_or_options})


class TabInputText:
    def __init__(self, uri: URI):
        self.uri = uri

class TabInputTextDiff:
    def __init__(self, original: URI, modified: URI):
        self.original = original
        self.modified = modified

class TabInputCustom:
    def __init__(self, uri: URI, view_type: str):
        self.uri = uri
        self.view_type = view_type

class TabInputNotebook:
    def __init__(self, uri: URI, notebook_type: str):
        self.uri = uri
        self.notebook_type = notebook_type

class TabInputTerminal:
    def __init__(self):
        pass

class Tab:
    def __init__(self, label: str, group: Any, input: Any = None, is_dirty: bool = False,
                 is_pinned: bool = False, is_active: bool = False):
        self._label = label
        self._group = group
        self._input = input
        self._is_dirty = is_dirty
        self._is_pinned = is_pinned
        self._is_active = is_active

    @property
    def label(self) -> str:
        return self._label
    @property
    def group(self) -> Any:
        return self._group
    @property
    def input(self) -> Any:
        return self._input
    @property
    def is_dirty(self) -> bool:
        return self._is_dirty
    @property
    def is_pinned(self) -> bool:
        return self._is_pinned
    @property
    def is_active(self) -> bool:
        return self._is_active
    @is_pinned.setter
    def is_pinned(self, v: bool):
        self._is_pinned = v
    @is_active.setter
    def is_active(self, v: bool):
        self._is_active = v


class TabGroup:
    def __init__(self, index: int = 0):
        self._index = index
        self._tabs: List[Tab] = []
        self._active_tab: Optional[Tab] = None
        self._on_did_change = EventEmitter(name=f"tabgroup:{index}:change")

    @property
    def index(self) -> int:
        return self._index
    @property
    def tabs(self) -> List[Tab]:
        return self._tabs[:]
    @property
    def active_tab(self) -> Optional[Tab]:
        return self._active_tab
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change

    def add_tab(self, tab: Tab):
        self._tabs.append(tab)
        self._on_did_change.fire(None)

    def remove_tab(self, tab: Tab):
        self._tabs = [t for t in self._tabs if t is not tab]
        if self._active_tab is tab:
            self._active_tab = self._tabs[0] if self._tabs else None
        self._on_did_change.fire(None)

    def set_active(self, tab: Tab):
        for t in self._tabs:
            t.is_active = (t is tab)
        self._active_tab = tab


class TabGroups:
    def __init__(self):
        self._groups: List[TabGroup] = []
        self._on_did_change = EventEmitter(name="tabgroups:change")
        self._on_did_change_tab_groups = EventEmitter(name="tabgroups:groups")

    @property
    def all(self) -> List[TabGroup]:
        return self._groups[:]
    @property
    def active_tab_group(self) -> Optional[TabGroup]:
        return self._groups[0] if self._groups else None
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change
    @property
    def on_did_change_tab_groups(self) -> EventEmitter:
        return self._on_did_change_tab_groups

    def add_group(self, group: TabGroup):
        self._groups.append(group)
        self._on_did_change.fire(None)

    def close(self, tab_or_group: Union[Tab, TabGroup]):
        if isinstance(tab_or_group, TabGroup):
            self._groups = [g for g in self._groups if g is not tab_or_group]
        else:
            for g in self._groups:
                g.remove_tab(tab_or_group)
        self._on_did_change.fire(None)


class WindowState:
    def __init__(self):
        self._focused: bool = True
        self._active_viewlet: str = ""
        self._on_did_change = EventEmitter(name="window:state:change")

    @property
    def focused(self) -> bool:
        return self._focused
    @focused.setter
    def focused(self, v: bool):
        self._focused = v
        self._on_did_change.fire(None)
    @property
    def active_viewlet(self) -> str:
        return self._active_viewlet
    @active_viewlet.setter
    def active_viewlet(self, v: str):
        self._active_viewlet = v
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change


class WorkspaceConfiguration:
    def __init__(self, section: str = ""):
        self._section = section
        self._values: Dict[str, Any] = {}

    def get(self, key: str, default: Optional[Any] = None) -> Optional[Any]:
        full_key = f"{self._section}.{key}" if self._section else key
        keys = full_key.split(".")
        val = self._values
        for k in keys:
            if isinstance(val, dict):
                val = val.get(k)
            else:
                return default
        return val if val is not None else default

    def has(self, key: str) -> bool:
        return self.get(key) is not None

    def update(self, key: str, value: Any, global_: bool = False):
        full_key = f"{self._section}.{key}" if self._section else key
        if global_:
            emit("config.update.global", {"key": full_key, "value": value})
        else:
            emit("config.update", {"key": full_key, "value": value})

    def inspect(self, key: str) -> Optional[Dict[str, Any]]:
        val = self.get(key)
        return {"key": key, "defaultValue": None, "globalValue": val,
                "workspaceValue": None, "workspaceFolderValue": None} if val is not None else None

    def set_values(self, values: Dict[str, Any]):
        self._values.update(values)


class WorkspaceFolder:
    def __init__(self, uri: URI, name: str, index: int = 0):
        self._uri = uri
        self._name = name
        self._index = index

    @property
    def uri(self) -> URI:
        return self._uri
    @property
    def name(self) -> str:
        return self._name
    @property
    def index(self) -> int:
        return self._index
    @property
    def to_string(self) -> str:
        return str(self._uri)


class WorkspaceFoldersChangeEvent:
    def __init__(self):
        self._added: List[WorkspaceFolder] = []
        self._removed: List[WorkspaceFolder] = []

    @property
    def added(self) -> List[WorkspaceFolder]:
        return self._added
    @property
    def removed(self) -> List[WorkspaceFolder]:
        return self._removed


class Workspace:
    def __init__(self):
        self._folders: List[WorkspaceFolder] = []
        self._text_documents: Dict[str, TextDocument] = {}
        self._notebook_documents: Dict[str, Any] = {}
        self._configurations: Dict[str, WorkspaceConfiguration] = {}
        self._workspace_file: Optional[str] = None
        self._on_did_open_text_document = EventEmitter(name="workspace:open")
        self._on_did_close_text_document = EventEmitter(name="workspace:close")
        self._on_did_save_text_document = EventEmitter(name="workspace:save")
        self._on_did_change_text_document = EventEmitter(name="workspace:change")
        self._on_did_change_workspace_folders = EventEmitter(name="workspace:folders")
        self._on_did_change_configuration = EventEmitter(name="workspace:config")

    @property
    def workspace_folders(self) -> Optional[List[WorkspaceFolder]]:
        return self._folders[:] if self._folders else None
    @property
    def text_documents(self) -> List[TextDocument]:
        return list(self._text_documents.values())
    @property
    def workspace_file(self) -> Optional[str]:
        return self._workspace_file
    @workspace_file.setter
    def workspace_file(self, v: Optional[str]):
        self._workspace_file = v
    @property
    def on_did_open_text_document(self) -> EventEmitter:
        return self._on_did_open_text_document
    @property
    def on_did_close_text_document(self) -> EventEmitter:
        return self._on_did_close_text_document
    @property
    def on_did_save_text_document(self) -> EventEmitter:
        return self._on_did_save_text_document
    @property
    def on_did_change_text_document(self) -> EventEmitter:
        return self._on_did_change_text_document
    @property
    def on_did_change_workspace_folders(self) -> EventEmitter:
        return self._on_did_change_workspace_folders
    @property
    def on_did_change_configuration(self) -> EventEmitter:
        return self._on_did_change_configuration

    def get_configuration(self, section: str = "") -> WorkspaceConfiguration:
        if section not in self._configurations:
            self._configurations[section] = WorkspaceConfiguration(section)
        return self._configurations[section]

    def open_text_document(self, uri: URI) -> Optional[TextDocument]:
        existing = self._text_documents.get(str(uri))
        if existing:
            return existing
        doc = TextDocument(uri)
        self._text_documents[str(uri)] = doc
        self._on_did_open_text_document.fire(doc)
        return doc

    def open_notebook_document(self, uri: URI) -> Optional[Any]:
        return self._notebook_documents.get(str(uri))

    def create_file_system_watcher(self, pattern: str, ignore_create: bool = False,
                                    ignore_change: bool = False,
                                    ignore_delete: bool = False) -> Any:
        return _FileSystemWatcher(pattern, ignore_create, ignore_change, ignore_delete)

    def find_files(self, pattern: str, max_results: int = 2000,
                    folder: Optional[WorkspaceFolder] = None) -> List[URI]:
        results = []
        base = folder.uri.fs_path if folder else None
        emit("workspace.findFiles", {"pattern": pattern, "maxResults": max_results})
        return results

    def save_all(self):
        emit("workspace.saveAll", {})

    def apply_edit(self, edit: Any) -> bool:
        emit("workspace.applyEdit", {"edit": edit})
        return True

    def as_relative_path(self, path_or_uri: Union[str, URI], include_workspace: bool = True) -> str:
        path = path_or_uri.fs_path if isinstance(path_or_uri, URI) else path_or_uri
        for folder in self._folders:
            fp = folder.uri.fs_path
            if path.startswith(fp):
                rel = os.path.relpath(path, fp)
                return rel if not include_workspace else rel
        return path


class _FileSystemWatcher:
    def __init__(self, pattern: str, ignore_create: bool, ignore_change: bool, ignore_delete: bool):
        self._pattern = pattern
        self._ignore_create = ignore_create
        self._ignore_change = ignore_change
        self._ignore_delete = ignore_delete
        self._on_did_create = EventEmitter(name=f"watcher:{pattern}:create")
        self._on_did_change = EventEmitter(name=f"watcher:{pattern}:change")
        self._on_did_delete = EventEmitter(name=f"watcher:{pattern}:delete")
        self._disposed = False

    @property
    def on_did_create(self) -> EventEmitter:
        return self._on_did_create
    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change
    @property
    def on_did_delete(self) -> EventEmitter:
        return self._on_did_delete

    def dispose(self):
        self._disposed = True


# =========================================================================
# 15. FILE SYSTEM APIS
# =========================================================================

class FileChangeType(IntEnum):
    Changed = 1; Created = 2; Deleted = 3

@dataclass
class FileChangeEvent:
    type: FileChangeType = FileChangeType.Changed
    uri: URI = field(default_factory=lambda: URI())

@dataclass
class FileStat:
    type: FileType = FileType.File
    size: int = 0
    mtime: int = 0
    ctime: int = 0
    permissions: int = 0o644

class FileSystemProvider:
    async def stat(self, uri: URI) -> FileStat:
        raise NotImplementedError

    async def read_directory(self, uri: URI) -> List[Tuple[str, FileType]]:
        raise NotImplementedError

    async def create_directory(self, uri: URI):
        raise NotImplementedError

    async def read_file(self, uri: URI) -> bytes:
        raise NotImplementedError

    async def write_file(self, uri: URI, content: bytes, options: Optional[Dict[str, Any]] = None):
        raise NotImplementedError

    async def delete(self, uri: URI, options: Optional[Dict[str, Any]] = None):
        raise NotImplementedError

    async def rename(self, source: URI, target: URI, options: Optional[Dict[str, Any]] = None):
        raise NotImplementedError

    def watch(self, uri: URI, options: Optional[Dict[str, Any]] = None) -> Disposable:
        return _ExtensionDisposable(lambda: None)

    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change if hasattr(self, "_on_did_change") else EventEmitter(name="fs:change")


class _DefaultFileSystemProvider(FileSystemProvider):
    def __init__(self):
        self._on_did_change = EventEmitter(name="fs:default:change")

    async def stat(self, uri: URI) -> FileStat:
        path = uri.fs_path
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")
        st = os.stat(path)
        ftype = FileType.Directory if os.path.isdir(path) else FileType.File
        return FileStat(type=ftype, size=st.st_size, mtime=int(st.st_mtime),
                        ctime=int(st.st_ctime), permissions=st.st_mode)

    async def read_directory(self, uri: URI) -> List[Tuple[str, FileType]]:
        path = uri.fs_path
        results = []
        for entry in os.listdir(path):
            epath = os.path.join(path, entry)
            ftype = FileType.Directory if os.path.isdir(epath) else FileType.File
            results.append((entry, ftype))
        return results

    async def create_directory(self, uri: URI):
        os.makedirs(uri.fs_path, exist_ok=True)

    async def read_file(self, uri: URI) -> bytes:
        with open(uri.fs_path, "rb") as f:
            return f.read()

    async def write_file(self, uri: URI, content: bytes, options: Optional[Dict[str, Any]] = None):
        with open(uri.fs_path, "wb") as f:
            f.write(content)

    async def delete(self, uri: URI, options: Optional[Dict[str, Any]] = None):
        path = uri.fs_path
        if options and options.get("recursive"):
            import shutil
            shutil.rmtree(path, ignore_errors=True)
        else:
            os.remove(path)
        self._on_did_change.fire(FileChangeEvent(FileChangeType.Deleted, uri))

    async def rename(self, source: URI, target: URI, options: Optional[Dict[str, Any]] = None):
        os.rename(source.fs_path, target.fs_path)
        self._on_did_change.fire(FileChangeEvent(FileChangeType.Changed, target))

    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change


class FileSystemManager:
    def __init__(self):
        self._providers: Dict[str, FileSystemProvider] = {}
        self._default_provider = _DefaultFileSystemProvider()
        self._providers["file"] = self._default_provider
        self._on_did_change = EventEmitter(name="fs:change")

    def register(self, scheme: str, provider: FileSystemProvider) -> Disposable:
        self._providers[scheme] = provider
        return _ExtensionDisposable(lambda: self._providers.pop(scheme, None))

    def get_provider(self, scheme: str) -> Optional[FileSystemProvider]:
        return self._providers.get(scheme)

    def stat(self, uri: URI) -> FileStat:
        provider = self._get_provider(uri)
        import asyncio
        return asyncio.run(provider.stat(uri))

    def read_directory(self, uri: URI) -> List[Tuple[str, FileType]]:
        provider = self._get_provider(uri)
        import asyncio
        return asyncio.run(provider.read_directory(uri))

    def create_directory(self, uri: URI):
        provider = self._get_provider(uri)
        import asyncio
        asyncio.run(provider.create_directory(uri))

    def read_file(self, uri: URI) -> bytes:
        provider = self._get_provider(uri)
        import asyncio
        return asyncio.run(provider.read_file(uri))

    def write_file(self, uri: URI, content: bytes, options: Optional[Dict[str, Any]] = None):
        provider = self._get_provider(uri)
        import asyncio
        asyncio.run(provider.write_file(uri, content, options))

    def delete(self, uri: URI, options: Optional[Dict[str, Any]] = None):
        provider = self._get_provider(uri)
        import asyncio
        asyncio.run(provider.delete(uri, options))

    def rename(self, source: URI, target: URI, options: Optional[Dict[str, Any]] = None):
        provider = self._get_provider(source)
        import asyncio
        asyncio.run(provider.rename(source, target, options))

    def watch(self, uri: URI, options: Optional[Dict[str, Any]] = None) -> Disposable:
        provider = self._get_provider(uri)
        return provider.watch(uri, options)

    def _get_provider(self, uri: URI) -> FileSystemProvider:
        provider = self._providers.get(uri.scheme)
        if not provider:
            raise ValueError(f"No file system provider for scheme: {uri.scheme}")
        return provider

    def is_writable(self, uri: URI) -> bool:
        path = uri.fs_path
        return os.access(path, os.W_OK) if os.path.exists(path) else False

    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change


# =========================================================================
# 16. MENU / CONTRIBUTION POINT APIS
# =========================================================================

class MenuItemKind(IntEnum):
    Command = 1; Submenu = 2; Separator = 3

@dataclass
class MenuItem:
    kind: MenuItemKind = MenuItemKind.Command
    command: str = ""
    title: str = ""
    tooltip: str = ""
    icon: str = ""
    group: str = ""
    order: float = 0.0
    when: str = ""
    submenu: Optional["Menu"] = None

class Menu:
    def __init__(self, id: str, label: str = ""):
        self._id = id
        self._label = label
        self._items: List[MenuItem] = []

    @property
    def id(self) -> str:
        return self._id
    @property
    def label(self) -> str:
        return self._label
    @property
    def items(self) -> List[MenuItem]:
        return self._items[:]

    def append_item(self, item: MenuItem):
        self._items.append(item)

    def remove_item(self, item: MenuItem):
        self._items = [i for i in self._items if i is not item]

    def clear(self):
        self._items.clear()


class MenusCollection:
    WELL_KNOWN_MENUS = [
        "commandPalette", "editor/title", "editor/title/context",
        "editor/context", "explorer/context", "editor/title/run",
        "editor/lineNumber/context", "panel/title", "scm/title",
        "scm/resourceGroup/context", "scm/resourceState/context",
        "scm/resourceFolder/context", "debug/callstack/context",
        "debug/variables/context", "view/title", "view/item/context",
        "touchBar", "statusBar/windowIndicator",
        "comments/commentThread/title", "comments/commentThread/context",
        "comments/comment/title", "comments/comment/context",
        "notebook/cell/title", "notebook/cell/execute",
    ]

    def __init__(self):
        self._menus: Dict[str, Menu] = {}
        self._on_did_change = EventEmitter(name="menus:change")
        for mid in self.WELL_KNOWN_MENUS:
            self._menus[mid] = Menu(mid)

    def get(self, id: str) -> Optional[Menu]:
        return self._menus.get(id)

    def create(self, id: str, label: str = "") -> Menu:
        if id not in self._menus:
            self._menus[id] = Menu(id, label)
        return self._menus[id]

    def all(self) -> List[Menu]:
        return list(self._menus.values())

    def register_item(self, menu_id: str, item: MenuItem) -> Disposable:
        menu = self._menus.setdefault(menu_id, Menu(menu_id))
        menu.append_item(item)
        self._on_did_change.fire(menu_id)
        return _ExtensionDisposable(lambda: self._unregister_item(menu, item))

    def _unregister_item(self, menu: Menu, item: MenuItem):
        menu.remove_item(item)
        self._on_did_change.fire(menu.id)

    @property
    def on_did_change(self) -> EventEmitter:
        return self._on_did_change


# =========================================================================
# 17. ENV & EXTENSION CONTEXT
# =========================================================================

class ShellQuoting(IntEnum):
    Escape = 1; Strong = 2; Weak = 3

@dataclass
class ShellQuotedString:
    value: str = ""
    quoting: ShellQuoting = ShellQuoting.Weak

@dataclass
class Env:
    app_name: str = "Dardcor Code"
    app_root: str = ""
    language: str = "en"
    machine_id: str = ""
    session_id: str = ""
    shell: str = ""
    is_new_app_install: bool = True
    is_telemetry_enabled: bool = False
    on_did_change_language: EventEmitter = field(default_factory=lambda: EventEmitter(name="env:language"))

    @property
    def app_name_with_quality(self) -> str:
        return self.app_name

    @property
    def uri_scheme(self) -> str:
        return "dardcor"

    @property
    def app_host(self) -> str:
        return "desktop"

    def as_remote_uri(self, authority: str, path: str) -> URI:
        return URI(scheme="vscode-remote", authority=authority, path=path)


# =========================================================================
# 18. MAIN ExtensionAPI CLASS
# =========================================================================

class ExtensionAPI(QObject):
    """
    Full VS Code Extension API implementation.
    Mirrors the complete vscode.d.ts public API surface.
    Each property is a namespace object containing the API methods/classes.
    """

    def __init__(self, parent=None):
        super().__init__(parent)

        # ── Core Namespaces ──
        self._commands = get_command_registry()
        self._window_state = WindowState()
        self._workspace = Workspace()
        self._env = Env()
        self._disposables: List[Disposable] = []

        # ── Internal emitters (must be before window namespace) ──
        self._on_did_change_window_state = EventEmitter(name="api:windowState")

        # ── Feature Namespaces ──
        self.chat = self._ChatNamespace(self)
        self.language_model = self._LanguageModelNamespace(self)
        self.mcp = self._McpNamespace(self)
        self.embeddings = self._EmbeddingsNamespace(self)
        self.scm = self._ScmNamespace(self)
        self.testing = self._TestingNamespace(self)
        self.terminal = self._TerminalNamespace(self)
        self.notebook = self._NotebookNamespace(self)
        self.authentication = self._AuthenticationNamespace(self)
        self.comments = self._CommentsNamespace(self)
        self.debug = self._DebugNamespace(self)
        self.editor = self._EditorNamespace(self)
        self.file_system = self._FileSystemNamespace(self)
        self.menus = self._MenusNamespace(self)
        self.window = self._WindowNamespace(self)
        self.workspace = self._WorkspaceNamespace(self)
        self.env = self._env

        # ── Event bus bridging ──
        self._event_bus = get_event_bus()

        # ── Connect internal events ──
        self._disposables.append(_ExtensionDisposable(lambda: None))

    # ─────────────────────────────────────────────────────────────────
    # Helper: register command
    # ─────────────────────────────────────────────────────────────────

    def register_command(self, command_id: str, handler: Callable,
                          this_args: Optional[Any] = None) -> Disposable:
        self._commands.register(command_id, handler)
        return _ExtensionDisposable(lambda: self._commands.unregister(command_id))

    # ─────────────────────────────────────────────────────────────────
    # Chat & Copilot
    # ─────────────────────────────────────────────────────────────────

    class _ChatNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._provider = ChatParticipantProvider()

        def register_participant(self, id: str, label: str) -> ChatParticipant:
            return self._provider.register(id, label)

        def unregister_participant(self, id: str):
            self._provider.unregister(id)

        def get_participant(self, id: str) -> Optional[ChatParticipant]:
            return self._provider.get(id)

        def all_participants(self) -> List[ChatParticipant]:
            return self._provider.all()

        @property
        def on_did_change_participants(self) -> EventEmitter:
            return self._provider.on_did_change_participants

        @property
        def on_did_receive_feedback(self) -> EventEmitter:
            return self._provider.on_did_receive_feedback

    # ─────────────────────────────────────────────────────────────────
    # Language Model
    # ─────────────────────────────────────────────────────────────────

    class _LanguageModelNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = LanguageModelManager()

        def register(self, provider: LanguageModelProvider) -> Disposable:
            return self._manager.register(provider)

        def send_chat_request(
            self, model: str, messages: List[LanguageModelChatMessage],
            options: Optional[Dict[str, Any]] = None,
            token: Optional[CancellationToken] = None,
        ) -> LanguageModelChatResult:
            return self._manager.send_chat_request(model, messages, options, token)

        def all_models(self) -> List[LanguageModelProvider]:
            return self._manager.all()

        def get_model(self, id: str) -> Optional[LanguageModelProvider]:
            return self._manager.get(id)

        @property
        def on_did_change_models(self) -> EventEmitter:
            return self._manager.on_did_change_providers

    # ─────────────────────────────────────────────────────────────────
    # MCP
    # ─────────────────────────────────────────────────────────────────

    class _McpNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._collection = McpCollection()

        def register_server(self, definition: McpServerDefinition) -> Disposable:
            return self._collection.register(definition)

        def unregister_server(self, id: str):
            self._collection._unregister(id)

        def get_server(self, id: str) -> Optional[McpServerDefinition]:
            return self._collection.get(id)

        def all_servers(self) -> List[McpServerDefinition]:
            return self._collection.all()

        @property
        def on_did_change_servers(self) -> EventEmitter:
            return self._collection.on_did_change_servers

    # ─────────────────────────────────────────────────────────────────
    # AI / Embeddings
    # ─────────────────────────────────────────────────────────────────

    class _EmbeddingsNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = EmbeddingsManager()

        def register(self, provider: EmbeddingsProvider) -> Disposable:
            return self._manager.register(provider)

        def embed(self, texts: List[str], model: str = "") -> EmbeddingResult:
            return self._manager.embed(texts, model)

        @property
        def on_did_change_providers(self) -> EventEmitter:
            return self._manager.on_did_change_providers

    # ─────────────────────────────────────────────────────────────────
    # SCM
    # ─────────────────────────────────────────────────────────────────

    class _ScmNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = ScmManager()

        def create_source_control(self, id: str, label: str) -> SourceControl:
            return self._manager.create_source_control(id, label)

        def get_source_control(self, id: str) -> Optional[SourceControl]:
            return self._manager.get(id)

        def all_source_controls(self) -> List[SourceControl]:
            return self._manager.all()

        def dispose_source_control(self, id: str):
            self._manager.dispose(id)

        @property
        def on_did_change(self) -> EventEmitter:
            return self._manager.on_did_change

    # ─────────────────────────────────────────────────────────────────
    # Testing
    # ─────────────────────────────────────────────────────────────────

    class _TestingNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = TestControllerManager()

        def create_test_controller(self, id: str, label: str) -> TestController:
            return self._manager.create_test_controller(id, label)

        def get_controller(self, id: str) -> Optional[TestController]:
            return self._manager.get(id)

        def all_controllers(self) -> List[TestController]:
            return self._manager.all()

        def dispose_controller(self, id: str):
            self._manager.dispose(id)

    # ─────────────────────────────────────────────────────────────────
    # Terminal
    # ─────────────────────────────────────────────────────────────────

    class _TerminalNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = TerminalManager()

        def create_terminal(self, name: str, options: Optional[TerminalOptions] = None) -> Terminal:
            return self._manager.create_terminal(name, options)

        def get_terminal(self, name: str) -> Optional[Terminal]:
            return self._manager.get(name)

        def all_terminals(self) -> List[Terminal]:
            return self._manager.all()

        def dispose_terminal(self, name: str):
            self._manager.dispose(name)

        def register_link_provider(self, provider: TerminalLinkProvider) -> Disposable:
            return self._manager.register_link_provider(provider)

        def register_profile_provider(self, provider: TerminalProfileProvider) -> Disposable:
            return self._manager.register_profile_provider(provider)

        @property
        def on_did_open(self) -> EventEmitter:
            return self._manager.on_did_open

        @property
        def on_did_close(self) -> EventEmitter:
            return self._manager.on_did_close

        @property
        def on_did_change_active(self) -> EventEmitter:
            return self._manager.on_did_change_active

        @property
        def on_did_change_shell(self) -> EventEmitter:
            return self._manager.on_did_change_shell

    # ─────────────────────────────────────────────────────────────────
    # Notebook
    # ─────────────────────────────────────────────────────────────────

    class _NotebookNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = NotebookManager()

        def register_notebook_serializer(self, notebook_type: str, serializer: NotebookSerializer) -> Disposable:
            return self._manager.register_notebook_serializer(notebook_type, serializer)

        def register_kernel(self, kernel: NotebookKernel) -> Disposable:
            return self._manager.register_kernel(kernel)

        def create_notebook_controller(self, id: str, label: str, notebook_type: str) -> NotebookController:
            return self._manager.create_notebook_controller(id, label, notebook_type)

        def register_renderer_script(self, renderer: NotebookRendererScript) -> Disposable:
            return self._manager.register_renderer_script(renderer)

        def get_serializer(self, notebook_type: str) -> Optional[NotebookSerializer]:
            return self._manager.get_serializer(notebook_type)

        @property
        def on_did_open(self) -> EventEmitter:
            return self._manager.on_did_open

        @property
        def on_did_close(self) -> EventEmitter:
            return self._manager.on_did_close

    # ─────────────────────────────────────────────────────────────────
    # Authentication
    # ─────────────────────────────────────────────────────────────────

    class _AuthenticationNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = AuthenticationManager()

        def register_authentication_provider(self, id: str, label: str) -> AuthenticationProvider:
            return self._manager.register_authentication_provider(id, label)

        def get_provider(self, id: str) -> Optional[AuthenticationProvider]:
            return self._manager.get(id)

        def get_session(self, provider_id: str, scopes: List[str],
                        create_if_none: bool = False) -> Optional[AuthenticationSession]:
            return self._manager.get_session(provider_id, scopes, create_if_none)

        def all_providers(self) -> List[AuthenticationProvider]:
            return self._manager.all()

        @property
        def on_did_change_providers(self) -> EventEmitter:
            return self._manager.on_did_change_providers

    # ─────────────────────────────────────────────────────────────────
    # Comments
    # ─────────────────────────────────────────────────────────────────

    class _CommentsNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = CommentManager()

        def create_comment_controller(self, id: str, label: str) -> CommentController:
            return self._manager.create_comment_controller(id, label)

        def get_controller(self, id: str) -> Optional[CommentController]:
            return self._manager.get(id)

        def all_controllers(self) -> List[CommentController]:
            return self._manager.all()

        def dispose_controller(self, id: str):
            self._manager.dispose(id)

    # ─────────────────────────────────────────────────────────────────
    # Debug
    # ─────────────────────────────────────────────────────────────────

    class _DebugNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = DebugManager()

        def register_debug_configuration_provider(self, provider: DebugConfigurationProvider) -> Disposable:
            return self._manager.register_debug_configuration_provider(provider)

        def register_debug_adapter_tracker_factory(self, factory: DebugAdapterTrackerFactory) -> Disposable:
            return self._manager.register_debug_adapter_tracker_factory(factory)

        def register_debug_adapter_descriptor_factory(self, factory: DebugAdapterDescriptorFactory) -> Disposable:
            return self._manager.register_debug_adapter_descriptor_factory(factory)

        def start_debugging(self, name: str, type: str,
                             configuration: Optional[DebugConfiguration] = None) -> DebugSession:
            cfg = configuration or DebugConfiguration(name=name, type=type)
            return self._manager.create_debug_session(name, type, cfg)

        def stop_debugging(self, session: Optional[DebugSession] = None):
            self._manager.stop_debugging(session)

        @property
        def active_debug_session(self) -> Optional[DebugSession]:
            return self._manager.active_debug_session

        @property
        def sessions(self) -> List[DebugSession]:
            return self._manager.sessions

        @property
        def on_did_start(self) -> EventEmitter:
            return self._manager.on_did_start

        @property
        def on_did_terminate(self) -> EventEmitter:
            return self._manager.on_did_terminate

        @property
        def on_did_change_active(self) -> EventEmitter:
            return self._manager.on_did_change_active

        @property
        def on_did_change_breakpoints(self) -> EventEmitter:
            return self._manager.on_did_change_breakpoints

    # ─────────────────────────────────────────────────────────────────
    # Editor & Window
    # ─────────────────────────────────────────────────────────────────

    class _WindowNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._tab_groups = TabGroups()
            self._state = api._window_state
            self._editors: Dict[str, TextEditor] = {}
            self._on_did_change_active_text_editor = EventEmitter(name="window:activeEditor")
            self._on_did_change_text_editor_selections = EventEmitter(name="window:selections")
            self._on_did_change_text_editor_options = EventEmitter(name="window:options")
            self._on_did_change_text_editor_visible_ranges = EventEmitter(name="window:visibleRanges")
            self._on_did_change_window_state = api._on_did_change_window_state
            self._status_bar_items: Dict[str, Any] = {}

        @property
        def state(self) -> WindowState:
            return self._state

        @property
        def tab_groups(self) -> TabGroups:
            return self._tab_groups

        @property
        def active_text_editor(self) -> Optional[TextEditor]:
            editors = list(self._editors.values())
            return editors[0] if editors else None

        @property
        def visible_text_editors(self) -> List[TextEditor]:
            return list(self._editors.values())

        def show_information_message(self, message: str, *items: str) -> Optional[str]:
            emit("window.showInformationMessage", {"message": message, "items": items})
            return None

        def show_warning_message(self, message: str, *items: str) -> Optional[str]:
            emit("window.showWarningMessage", {"message": message, "items": items})
            return None

        def show_error_message(self, message: str, *items: str) -> Optional[str]:
            emit("window.showErrorMessage", {"message": message, "items": items})
            return None

        def show_input_box(self, options: Optional[Dict[str, Any]] = None) -> Optional[str]:
            emit("window.showInputBox", options or {})
            return None

        def show_quick_pick(self, items: List[str], options: Optional[Dict[str, Any]] = None) -> Optional[str]:
            emit("window.showQuickPick", {"items": items, "options": options or {}})
            return None

        def show_open_dialog(self, options: Optional[Dict[str, Any]] = None) -> Optional[List[URI]]:
            emit("window.showOpenDialog", options or {})
            return None

        def show_save_dialog(self, options: Optional[Dict[str, Any]] = None) -> Optional[URI]:
            emit("window.showSaveDialog", options or {})
            return None

        def create_status_bar_item(self, id: str, text: str = "",
                                    tooltip: str = "", command: str = "",
                                    alignment: int = 1, priority: int = 100) -> Any:
            item = {
                "id": id, "text": text, "tooltip": tooltip,
                "command": command, "alignment": alignment, "priority": priority,
            }
            self._status_bar_items[id] = item
            emit("window.createStatusBarItem", item)
            return item

        def set_status_bar_message(self, text: str, hide_after: int = 0):
            emit("window.setStatusBarMessage", {"text": text, "hideAfter": hide_after})

        def with_progress(self, task: Callable, options: Optional[Dict[str, Any]] = None):
            emit("window.withProgress", options or {})

        def create_output_channel(self, name: str) -> Any:
            return _OutputChannel(name)

        def create_text_editor_decoration_type(self, options: Dict[str, Any]) -> Any:
            return _TextEditorDecorationType(options)

        def register_tree_data_provider(self, view_id: str, provider: Any) -> Disposable:
            emit("window.registerTreeDataProvider", {"viewId": view_id})
            return _ExtensionDisposable(lambda: None)

        def create_webview_panel(self, view_type: str, title: str, options: Dict[str, Any]) -> Any:
            return _WebviewPanel(view_type, title, options)

        def create_webview_view(self, view_type: str, title: str,
                                view_options: Optional[Dict[str, Any]] = None,
                                webview_options: Optional[Dict[str, Any]] = None) -> Any:
            emit("webview.createView", {
                "viewType": view_type, "title": title,
                "viewOptions": view_options or {},
                "webviewOptions": webview_options or {},
            })
            return _WebviewView(view_type, title, view_options, webview_options)

        def register_webview_view_provider(self, view_id: str, provider: Any) -> Disposable:
            emit("webview.registerViewProvider", {"viewId": view_id})
            return _ExtensionDisposable(lambda: None)

        def register_webview_panel_serializer(self, view_type: str, serializer: Any) -> Disposable:
            from ..webview.serializer import WebviewStateManager
            WebviewStateManager.register_serializer(view_type, serializer)
            emit("webview.registerSerializer", {"viewType": view_type})
            return _ExtensionDisposable(lambda: None)

        def register_custom_editor_provider(self, view_type: str, provider: Any,
                                            options: Optional[Dict[str, Any]] = None) -> Disposable:
            emit("webview.registerCustomEditor", {
                "viewType": view_type,
                "options": options or {},
            })
            return _ExtensionDisposable(lambda: None)

        @property
        def on_did_change_active_text_editor(self) -> EventEmitter:
            return self._on_did_change_active_text_editor

        @property
        def on_did_change_text_editor_selections(self) -> EventEmitter:
            return self._on_did_change_text_editor_selections

        @property
        def on_did_change_text_editor_options(self) -> EventEmitter:
            return self._on_did_change_text_editor_options

        @property
        def on_did_change_text_editor_visible_ranges(self) -> EventEmitter:
            return self._on_did_change_text_editor_visible_ranges

        @property
        def on_did_change_window_state(self) -> EventEmitter:
            return self._on_did_change_window_state

    class _WorkspaceNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._workspace = api._workspace

        @property
        def workspace_folders(self) -> Optional[List[WorkspaceFolder]]:
            return self._workspace.workspace_folders

        @property
        def text_documents(self) -> List[TextDocument]:
            return self._workspace.text_documents

        @property
        def workspace_file(self) -> Optional[str]:
            return self._workspace.workspace_file

        def get_configuration(self, section: str = "") -> WorkspaceConfiguration:
            return self._workspace.get_configuration(section)

        def open_text_document(self, uri: URI) -> Optional[TextDocument]:
            return self._workspace.open_text_document(uri)

        def register_text_document_content_provider(self, scheme: str, provider: Any) -> Disposable:
            emit("workspace.registerTextDocumentContentProvider", {"scheme": scheme})
            return _ExtensionDisposable(lambda: None)

        def create_file_system_watcher(self, pattern: str, ignore_create: bool = False,
                                        ignore_change: bool = False,
                                        ignore_delete: bool = False) -> Any:
            return self._workspace.create_file_system_watcher(pattern, ignore_create, ignore_change, ignore_delete)

        def find_files(self, pattern: str, max_results: int = 2000,
                        folder: Optional[WorkspaceFolder] = None) -> List[URI]:
            return self._workspace.find_files(pattern, max_results, folder)

        def save_all(self):
            self._workspace.save_all()

        def apply_edit(self, edit: Any) -> bool:
            return self._workspace.apply_edit(edit)

        def as_relative_path(self, path_or_uri: Union[str, URI], include_workspace: bool = True) -> str:
            return self._workspace.as_relative_path(path_or_uri, include_workspace)

        @property
        def on_did_open_text_document(self) -> EventEmitter:
            return self._workspace.on_did_open_text_document

        @property
        def on_did_close_text_document(self) -> EventEmitter:
            return self._workspace.on_did_close_text_document

        @property
        def on_did_save_text_document(self) -> EventEmitter:
            return self._workspace.on_did_save_text_document

        @property
        def on_did_change_text_document(self) -> EventEmitter:
            return self._workspace.on_did_change_text_document

        @property
        def on_did_change_workspace_folders(self) -> EventEmitter:
            return self._workspace.on_did_change_workspace_folders

        @property
        def on_did_change_configuration(self) -> EventEmitter:
            return self._workspace.on_did_change_configuration

    # ─────────────────────────────────────────────────────────────────
    # File System
    # ─────────────────────────────────────────────────────────────────

    class _FileSystemNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._manager = FileSystemManager()

        def register(self, scheme: str, provider: FileSystemProvider) -> Disposable:
            return self._manager.register(scheme, provider)

        def stat(self, uri: URI) -> FileStat:
            return self._manager.stat(uri)

        def read_directory(self, uri: URI) -> List[Tuple[str, FileType]]:
            return self._manager.read_directory(uri)

        def create_directory(self, uri: URI):
            self._manager.create_directory(uri)

        def read_file(self, uri: URI) -> bytes:
            return self._manager.read_file(uri)

        def write_file(self, uri: URI, content: bytes, options: Optional[Dict[str, Any]] = None):
            self._manager.write_file(uri, content, options)

        def delete(self, uri: URI, options: Optional[Dict[str, Any]] = None):
            self._manager.delete(uri, options)

        def rename(self, source: URI, target: URI, options: Optional[Dict[str, Any]] = None):
            self._manager.rename(source, target, options)

        def watch(self, uri: URI, options: Optional[Dict[str, Any]] = None) -> Disposable:
            return self._manager.watch(uri, options)

        def is_writable(self, uri: URI) -> bool:
            return self._manager.is_writable(uri)

        @property
        def on_did_change(self) -> EventEmitter:
            return self._manager.on_did_change

    # ─────────────────────────────────────────────────────────────────
    # Menus / Contribution Points
    # ─────────────────────────────────────────────────────────────────

    class _MenusNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api
            self._collection = MenusCollection()

        def get(self, id: str) -> Optional[Menu]:
            return self._collection.get(id)

        def create(self, id: str, label: str = "") -> Menu:
            return self._collection.create(id, label)

        def register_item(self, menu_id: str, item: MenuItem) -> Disposable:
            return self._collection.register_item(menu_id, item)

        @property
        def on_did_change(self) -> EventEmitter:
            return self._collection.on_did_change

    # ─────────────────────────────────────────────────────────────────
    # Editor (convenience alias for "window.active_text_editor" etc.)
    # ─────────────────────────────────────────────────────────────────

    class _EditorNamespace:
        def __init__(self, api: "ExtensionAPI"):
            self._api = api

        @property
        def active(self) -> Optional[TextEditor]:
            return self._api.window.active_text_editor

        @property
        def visible(self) -> List[TextEditor]:
            return self._api.window.visible_text_editors

        @property
        def document(self) -> Optional[TextDocument]:
            ed = self.active
            return ed.document if ed else None

        def edit(self, callback: Callable[[TextEditorEdit], None]) -> bool:
            ed = self.active
            return ed.edit(callback) if ed else False

        def insert_snippet(self, snippet: str, location: Optional[Union[Position, Range]] = None):
            ed = self.active
            if ed:
                ed.insert_snippet(snippet, location)

        @property
        def on_did_change_active(self) -> EventEmitter:
            return self._api.window.on_did_change_active_text_editor

        @property
        def on_did_change_selections(self) -> EventEmitter:
            return self._api.window.on_did_change_text_editor_selections

        @property
        def on_did_change_options(self) -> EventEmitter:
            return self._api.window.on_did_change_text_editor_options

    # ─────────────────────────────────────────────────────────────────
    # Commands convenience
    # ─────────────────────────────────────────────────────────────────

    @property
    def commands(self):
        return self._commands

    def execute_command(self, command_id: str, *args: Any) -> Optional[Any]:
        result = self._commands.execute(command_id, *args)
        return result.value if result.success else None

    # ─────────────────────────────────────────────────────────────────
    # Language features registration (convenience)
    # ─────────────────────────────────────────────────────────────────

    def register_code_actions_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerCodeActionsProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_completion_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerCompletionItemProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_hover_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerHoverProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_definition_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerDefinitionProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_reference_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerReferenceProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_signature_help_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerSignatureHelpProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_document_symbol_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerDocumentSymbolProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_workspace_symbol_provider(self, provider: Any) -> Disposable:
        emit("languages.registerWorkspaceSymbolProvider", {})
        return _ExtensionDisposable(lambda: None)

    def register_code_lens_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerCodeLensProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_document_formatting_edit_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerDocumentFormattingEditProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_document_range_formatting_edit_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerDocumentRangeFormattingEditProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_on_type_formatting_edit_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerOnTypeFormattingEditProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_document_highlight_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerDocumentHighlightProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_document_link_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerDocumentLinkProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_document_color_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerColorProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_folding_range_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerFoldingRangeProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_selection_range_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerSelectionRangeProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_inline_completions_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerInlineCompletionsProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_inline_values_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerInlineValuesProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_inlay_hints_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerInlayHintsProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_type_hierarchy_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerTypeHierarchyProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_call_hierarchy_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerCallHierarchyProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_linked_editing_range_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerLinkedEditingRangeProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_semantic_tokens_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerSemanticTokensProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def register_evaluation_expression_provider(self, selector: Any, provider: Any) -> Disposable:
        emit("languages.registerEvaluationExpressionProvider", {"selector": selector})
        return _ExtensionDisposable(lambda: None)

    def set_language_configuration(self, language_id: str, configuration: Dict[str, Any]) -> Disposable:
        emit("languages.setLanguageConfiguration", {"language": language_id, "config": configuration})
        return _ExtensionDisposable(lambda: None)

    def match_selector(self, selector: Any, document: TextDocument) -> bool:
        return True

    def dispose(self):
        for d in self._disposables:
            try:
                d.dispose()
            except Exception:
                pass
        self._disposables.clear()


# =========================================================================
# 19. HELPER CLASSES
# =========================================================================

class _OutputChannel:
    def __init__(self, name: str):
        self._name = name

    def append(self, text: str):
        emit("output.append", {"name": self._name, "text": text})

    def append_line(self, text: str):
        self.append(text + "\n")

    def clear(self):
        emit("output.clear", {"name": self._name})

    def show(self, preserve_focus: bool = False):
        emit("output.show", {"name": self._name, "preserveFocus": preserve_focus})

    def hide(self):
        emit("output.hide", {"name": self._name})

    def dispose(self):
        emit("output.dispose", {"name": self._name})

    @property
    def name(self) -> str:
        return self._name


class _TextEditorDecorationType:
    def __init__(self, options: Dict[str, Any]):
        self._options = options
        self._key = str(uuid.uuid4())

    @property
    def key(self) -> str:
        return self._key

    def dispose(self):
        pass


class _WebviewPanel:
    def __init__(self, view_type: str, title: str, options: Optional[Dict[str, Any]] = None):
        self._view_type = view_type
        self._title = title
        self._options = options or {}
        self._disposed = False
        self._on_did_dispose = EventEmitter(name=f"webview:dispose:{view_type}")
        self._on_did_change_view_state = EventEmitter(name=f"webview:viewState:{view_type}")

    @property
    def view_type(self) -> str:
        return self._view_type

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str):
        self._title = value
        emit("webview.setTitle", {"viewType": self._view_type, "title": value})

    def get_webview(self) -> "_WebviewHandle":
        return _WebviewHandle(self._view_type, self._options)

    webview = property(get_webview)

    @property
    def options(self) -> Dict[str, Any]:
        return self._options

    @property
    def view_column(self) -> Optional[int]:
        return self._options.get("viewColumn")

    @property
    def active(self) -> bool:
        return True

    @property
    def visible(self) -> bool:
        return True

    @property
    def on_did_dispose(self) -> EventEmitter:
        return self._on_did_dispose

    @property
    def on_did_change_view_state(self) -> EventEmitter:
        return self._on_did_change_view_state

    def reveal(self, view_column: Optional[int] = None, preserve_focus: bool = False):
        emit("webview.reveal", {
            "viewType": self._view_type,
            "viewColumn": view_column,
            "preserveFocus": preserve_focus,
        })

    def dispose(self):
        if self._disposed:
            return
        self._disposed = True
        emit("webview.dispose", {"viewType": self._view_type})
        self._on_did_dispose.fire(self._view_type)


class _WebviewView:
    def __init__(self, view_type: str, title: str,
                 view_options: Optional[Dict[str, Any]] = None,
                 webview_options: Optional[Dict[str, Any]] = None):
        self._view_type = view_type
        self._title = title
        self._view_options = view_options or {}
        self._webview_options = webview_options or {}
        self._description = ""
        self._badge: Optional[str] = None
        self._disposed = False
        self._visible = False
        self._on_did_dispose = EventEmitter(name=f"webviewView:dispose:{view_type}")
        self._on_did_change_visibility = EventEmitter(name=f"webviewView:visibility:{view_type}")

    @property
    def view_type(self) -> str:
        return self._view_type

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str):
        self._title = value
        emit("webview.setViewTitle", {"viewType": self._view_type, "title": value})

    @property
    def description(self) -> str:
        return self._description

    @description.setter
    def description(self, value: str):
        self._description = value
        emit("webview.setViewDescription", {"viewType": self._view_type, "description": value})

    @property
    def badge(self) -> Optional[str]:
        return self._badge

    @badge.setter
    def badge(self, value: Optional[str]):
        self._badge = value
        emit("webview.setViewBadge", {"viewType": self._view_type, "badge": value})

    def get_webview(self) -> "_WebviewHandle":
        return _WebviewHandle(self._view_type, self._webview_options)

    webview = property(get_webview)

    @property
    def visible(self) -> bool:
        return self._visible

    @property
    def on_did_dispose(self) -> EventEmitter:
        return self._on_did_dispose

    @property
    def on_did_change_visibility(self) -> EventEmitter:
        return self._on_did_change_visibility

    def show(self, preserve_focus: bool = False):
        self._visible = True
        emit("webview.showView", {"viewType": self._view_type, "preserveFocus": preserve_focus})

    def hide(self):
        self._visible = False
        emit("webview.hideView", {"viewType": self._view_type})

    def dispose(self):
        if self._disposed:
            return
        self._disposed = True
        emit("webview.disposeView", {"viewType": self._view_type})
        self._on_did_dispose.fire(self._view_type)


class _WebviewHandle:
    def __init__(self, view_type: str, options: Dict[str, Any]):
        self._view_type = view_type
        self._options = options
        self._html = ""
        self._on_did_receive_message = EventEmitter(name=f"webview:message:{view_type}")

    @property
    def html(self) -> str:
        return self._html

    @html.setter
    def html(self, value: str):
        self._html = value
        emit("webview.setHtml", {"viewType": self._view_type, "html": value})

    def post_message(self, message: dict):
        emit("webview.postMessage", {"viewType": self._view_type, "message": message})

    @property
    def on_did_receive_message(self) -> EventEmitter:
        return self._on_did_receive_message

    @property
    def csp_source(self) -> str:
        return "vscode-resource.vscode-cdn.net"

    def as_webview_uri(self, local_uri: Any) -> str:
        from ..webview.protocol import WebviewResourceLoader
        loader = WebviewResourceLoader()
        from ..core.uri import URI
        if isinstance(local_uri, str):
            local_uri = URI.parse(local_uri)
        return loader.as_webview_uri(local_uri)
