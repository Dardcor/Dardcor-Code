from __future__ import annotations

from typing import Dict, List


BUILTIN_SKILLS: Dict[str, str] = {
    "prompt-efficiency": "Caveman + RTK + Ponytail prompt pack for terse, low-token, smallest-safe-diff behavior.",
    "code-review": "Review changes for bugs, regressions, missing tests, and risky behavior first.",
    "security-review": "Inspect auth, secrets, injections, path traversal, network calls, and destructive operations.",
    "provider-setup": "Guide provider API key/OAuth setup with local JSON storage and no hardcoded secrets.",
    "docs-polish": "Rewrite project docs with professional open-source tone while preserving branding assets.",
}


def list_skills() -> List[Dict[str, str]]:
    return [{"name": name, "description": desc} for name, desc in sorted(BUILTIN_SKILLS.items())]


def get_skill(name: str) -> Dict[str, str]:
    desc = BUILTIN_SKILLS.get(name)
    if not desc:
        return {"error": f"Unknown skill: {name}"}
    return {"name": name, "description": desc}

