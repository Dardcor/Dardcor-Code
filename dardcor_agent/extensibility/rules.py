"""Project rules loader — aggregate rule text for system prompt injection."""

from __future__ import annotations

from pathlib import Path


def _read_text_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def load_rules(workspace_root: str | Path) -> str:
    """Load and concatenate project rules from AGENTS.md and .dardcor/rules/*.md.

    Returns an empty string when no rule files exist or the workspace is missing.
    """
    root = Path(workspace_root)
    if not root.is_dir():
        return ""

    sections: list[str] = []

    agents_md = root / "AGENTS.md"
    if agents_md.is_file():
        content = _read_text_file(agents_md)
        if content:
            sections.append(f"## AGENTS.md\n\n{content}")

    rules_dir = root / ".dardcor" / "rules"
    if rules_dir.is_dir():
        for rule_file in sorted(rules_dir.glob("*.md")):
            if not rule_file.is_file():
                continue
            content = _read_text_file(rule_file)
            if content:
                sections.append(f"## {rule_file.name}\n\n{content}")

    if not sections:
        return ""

    return "# Project Rules\n\n" + "\n\n---\n\n".join(sections)
