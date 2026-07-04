"""Extensibility layer for the Dardcor agent (MCP, rules, skills, hooks, subagents)."""

from .hooks import HOOK_EVENTS, HookDef, HookRegistry, HookResult
from .mcp_registry import MCPRegistry, MCPServerDef
from .rules import load_rules
from .skills import SkillDef, discover_skills
from .subagents import SubagentDef, SubagentRegistry

__all__ = [
    "HOOK_EVENTS",
    "HookDef",
    "HookRegistry",
    "HookResult",
    "MCPRegistry",
    "MCPServerDef",
    "SkillDef",
    "SubagentDef",
    "SubagentRegistry",
    "discover_skills",
    "load_rules",
]
