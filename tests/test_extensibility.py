"""Tests for dardcor_agent.extensibility package."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest

from dardcor_agent.extensibility.hooks import HookDef, HookRegistry
from dardcor_agent.extensibility.mcp_registry import MCPRegistry, MCPServerDef
from dardcor_agent.extensibility.rules import load_rules
from dardcor_agent.extensibility.skills import discover_skills
from dardcor_agent.extensibility.subagents import SubagentDef, SubagentRegistry


class TestMCPRegistry(unittest.TestCase):
    def test_missing_config_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            reg = MCPRegistry(os.path.join(tmp, "missing.json"))
            reg.load()
            self.assertEqual(reg.list_servers(), [])

    def test_round_trip_sample_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "mcp.json")
            reg = MCPRegistry(path)
            reg.set_server(
                MCPServerDef(
                    name="filesystem",
                    command="npx",
                    args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                    enabled=True,
                )
            )
            reg.set_server(
                MCPServerDef(name="remote", url="http://localhost:8080", enabled=False)
            )
            reg.save()

            reloaded = MCPRegistry(path)
            reloaded.load()
            servers = {s.name: s for s in reloaded.list_servers()}
            self.assertEqual(len(servers), 2)
            self.assertEqual(servers["filesystem"].command, "npx")
            self.assertEqual(servers["filesystem"].args[0], "-y")
            self.assertTrue(servers["filesystem"].enabled)
            self.assertEqual(servers["remote"].url, "http://localhost:8080")
            self.assertFalse(servers["remote"].enabled)

            self.assertTrue(reloaded.enable("remote"))
            self.assertTrue(reloaded.get("remote").enabled)
            self.assertTrue(reloaded.disable("filesystem"))
            self.assertFalse(reloaded.get("filesystem").enabled)
            self.assertEqual(len(reloaded.enabled_servers()), 1)


class TestRules(unittest.TestCase):
    def test_missing_workspace_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, "nope")
            self.assertEqual(load_rules(missing), "")

    def test_empty_workspace_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(load_rules(tmp), "")

    def test_round_trip_agents_and_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "AGENTS.md"), "w", encoding="utf-8") as f:
                f.write("Always run tests before committing.\n")

            rules_dir = os.path.join(tmp, ".dardcor", "rules")
            os.makedirs(rules_dir)
            with open(os.path.join(rules_dir, "python.md"), "w", encoding="utf-8") as f:
                f.write("Use type hints.\n")
            with open(os.path.join(rules_dir, "style.md"), "w", encoding="utf-8") as f:
                f.write("Prefer small diffs.\n")

            text = load_rules(tmp)
            self.assertIn("# Project Rules", text)
            self.assertIn("AGENTS.md", text)
            self.assertIn("Always run tests before committing.", text)
            self.assertIn("python.md", text)
            self.assertIn("Use type hints.", text)
            self.assertIn("style.md", text)
            self.assertIn("Prefer small diffs.", text)


class TestSkills(unittest.TestCase):
    def test_missing_skills_dir_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(discover_skills(os.path.join(tmp, "missing")), [])

    def test_round_trip_skill_discovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill_a = os.path.join(tmp, "commit-msg")
            skill_b = os.path.join(tmp, "nested", "review")
            os.makedirs(skill_a)
            os.makedirs(skill_b)

            with open(os.path.join(skill_a, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write(
                    "---\n"
                    "name: commit-msg\n"
                    "description: Generate commit messages\n"
                    "---\n"
                    "# Commit skill\n"
                )
            with open(os.path.join(skill_b, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write(
                    "---\n"
                    "name: code-review\n"
                    'description: "Review pull requests"\n'
                    "---\n"
                )

            skills = discover_skills(tmp)
            by_name = {s.name: s for s in skills}
            self.assertEqual(len(by_name), 2)
            self.assertEqual(by_name["commit-msg"].description, "Generate commit messages")
            self.assertTrue(by_name["commit-msg"].path.endswith("SKILL.md"))
            self.assertEqual(by_name["code-review"].description, "Review pull requests")


class TestHooks(unittest.TestCase):
    def test_missing_config_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            reg = HookRegistry(os.path.join(tmp, "missing.json"))
            reg.load()
            self.assertEqual(reg.list_hooks(), [])

    def test_round_trip_sample_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "hooks.json")
            reg = HookRegistry(path)
            reg.register(HookDef(event="on_start", command="echo started"))
            reg.register(HookDef(event="before_tool", command="echo before"))
            reg.save()

            reloaded = HookRegistry(path)
            reloaded.load()
            self.assertEqual(len(reloaded.list_hooks()), 2)
            events = {h.event for h in reloaded.list_hooks()}
            self.assertEqual(events, {"on_start", "before_tool"})
            self.assertEqual(len(reloaded.list_hooks("on_start")), 1)

    def test_run_hook_executes_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            reg = HookRegistry(os.path.join(tmp, "hooks.json"))
            reg.register(HookDef(event="on_start", command="echo hello-hooks"))
            results = reg.run("on_start")
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].returncode, 0)
            self.assertIn("hello-hooks", results[0].stdout.strip())


class TestSubagents(unittest.TestCase):
    def test_missing_config_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            reg = SubagentRegistry(os.path.join(tmp, "missing.json"))
            reg.load()
            self.assertEqual(reg.list_subagents(), [])

    def test_round_trip_sample_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "subagents.json")
            reg = SubagentRegistry(path)
            reg.set_subagent(
                SubagentDef(
                    name="explore",
                    description="Fast codebase exploration",
                    model="gpt-4.1",
                    readonly=True,
                )
            )
            reg.set_subagent(
                SubagentDef(
                    name="general",
                    description="General-purpose subagent",
                    readonly=False,
                )
            )
            reg.save()

            reloaded = SubagentRegistry(path)
            reloaded.load()
            agents = {a.name: a for a in reloaded.list_subagents()}
            self.assertEqual(len(agents), 2)
            self.assertEqual(agents["explore"].description, "Fast codebase exploration")
            self.assertEqual(agents["explore"].model, "gpt-4.1")
            self.assertTrue(agents["explore"].readonly)
            self.assertIsNone(agents["general"].model)
            self.assertFalse(agents["general"].readonly)

            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
            self.assertIn("subagents", payload)
            self.assertIn("explore", payload["subagents"])


if __name__ == "__main__":
    unittest.main()
