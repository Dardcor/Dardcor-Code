"""Chat Participant System — multiple AI participants with different roles."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class ChatParticipant:
    """A named AI participant that can handle chat messages."""

    name: str
    description: str
    icon: str = "🤖"
    model_preference: str = ""
    system_prompt_extra: str = ""
    is_builtin: bool = False
    tools_enabled: list[str] = field(default_factory=list)


BUILTIN_PARTICIPANTS: dict[str, ChatParticipant] = {
    "agent": ChatParticipant(
        name="Agent",
        description="Full autonomous coding agent with file access, shell, and web search",
        icon="⬡",
        model_preference="",
        is_builtin=True,
        tools_enabled=["*"],
    ),
    "fix": ChatParticipant(
        name="Fix",
        description="Analyze and fix bugs, errors, and issues in your code",
        icon="🔧",
        system_prompt_extra="You are a code fixing expert. Analyze the code for bugs, errors, and issues. Provide fixes.",
        is_builtin=True,
        tools_enabled=["read_file", "replace_file_content", "write_file", "run_command", "search_files"],
    ),
    "explain": ChatParticipant(
        name="Explain",
        description="Explain code in detail with examples and diagrams",
        icon="📖",
        system_prompt_extra="You are a code explanation expert. Explain code clearly with examples, diagrams, and analogies.",
        is_builtin=True,
        tools_enabled=["read_file", "search_files", "search_web"],
    ),
    "test": ChatParticipant(
        name="Test",
        description="Generate and run tests for your code",
        icon="🧪",
        system_prompt_extra="You are a testing expert. Generate comprehensive tests. Run them and fix failures.",
        is_builtin=True,
        tools_enabled=["read_file", "write_file", "run_command", "search_files"],
    ),
    "review": ChatParticipant(
        name="Review",
        description="Review code for quality, security, and best practices",
        icon="👁",
        system_prompt_extra="You are a code review expert. Review code for quality, security, performance, and best practices. Provide actionable feedback.",
        is_builtin=True,
        tools_enabled=["read_file", "search_files", "run_command"],
    ),
    "commit": ChatParticipant(
        name="Commit",
        description="Generate commit messages and manage git operations",
        icon="📝",
        system_prompt_extra="You are a git expert. Generate conventional commit messages. Help with git operations.",
        is_builtin=True,
        tools_enabled=["git_status", "git_diff", "git_log", "run_command"],
    ),
    "ask": ChatParticipant(
        name="Ask",
        description="Quick questions without file access (conversation only)",
        icon="💬",
        system_prompt_extra="Answer questions conversationally. Do NOT use tools unless explicitly asked.",
        is_builtin=True,
        tools_enabled=[],
    ),
    "plan": ChatParticipant(
        name="Plan",
        description="Architecture planning and design without modifying files",
        icon="📐",
        system_prompt_extra="You are a software architect. Design solutions, plan architecture, and provide guidance. Do NOT modify files unless explicitly asked.",
        is_builtin=True,
        tools_enabled=["read_file", "search_files", "search_web", "list_files"],
    ),
    "debug": ChatParticipant(
        name="Debug",
        description="Debug runtime issues with read-only access",
        icon="🐛",
        system_prompt_extra="You are a debugging expert. Diagnose issues by reading code and running diagnostic commands. Do NOT modify files.",
        is_builtin=True,
        tools_enabled=["read_file", "search_files", "run_command", "grep", "glob_files"],
    ),
}
