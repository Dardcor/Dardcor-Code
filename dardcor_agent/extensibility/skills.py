"""Skills discovery — find SKILL.md files and parse frontmatter metadata."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class SkillDef:
    """Metadata for a discovered agent skill."""

    name: str
    description: str
    path: str


def _parse_frontmatter(text: str) -> dict[str, str]:
    """Parse simple YAML-like frontmatter between --- delimiters."""
    stripped = text.lstrip("\ufeff")
    if not stripped.startswith("---"):
        return {}
    end = stripped.find("---", 3)
    if end == -1:
        return {}
    block = stripped[3:end].strip()
    result: dict[str, str] = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            result[key] = value
    return result


def _skill_from_file(skill_file: Path) -> Optional[SkillDef]:
    try:
        text = skill_file.read_text(encoding="utf-8")
    except OSError:
        return None

    meta = _parse_frontmatter(text)
    name = meta.get("name") or skill_file.parent.name
    description = meta.get("description", "")
    return SkillDef(name=name, description=description, path=str(skill_file.resolve()))


def discover_skills(skills_dir: str | Path) -> list[SkillDef]:
    """Discover SKILL.md files under *skills_dir* (recursive).

    Returns an empty list when the directory is missing or contains no skills.
    """
    root = Path(skills_dir)
    if not root.is_dir():
        return []

    found: list[SkillDef] = []
    seen_paths: set[str] = set()

    for skill_file in sorted(root.rglob("SKILL.md")):
        if not skill_file.is_file():
            continue
        resolved = str(skill_file.resolve())
        if resolved in seen_paths:
            continue
        seen_paths.add(resolved)
        skill = _skill_from_file(skill_file)
        if skill is not None:
            found.append(skill)

    return sorted(found, key=lambda s: s.name.lower())
