"""OpenCode Zen model catalog — synced from https://opencode.ai/docs/zen/"""

from __future__ import annotations

from typing import Any, Dict, List


def _m(model_id: str, name: str, *, free: bool = False) -> Dict[str, Any]:
    entry: Dict[str, Any] = {"id": model_id, "name": name}
    if free:
        entry["free"] = True
    return entry


# Free models on Zen (no card required). This is the default list shown for the
# "OpenCode Zen (Free)" provider — matches the docs "free models" table.
OPENCODE_ZEN_FREE_MODELS: List[Dict[str, Any]] = [
    _m("north-mini-code-free", "North Mini Code Free", free=True),
    _m("nemotron-3-ultra-free", "Nemotron 3 Ultra Free", free=True),
    _m("deepseek-v4-flash-free", "DeepSeek V4 Flash Free", free=True),
    _m("mimo-v2.5-free", "MiMo V2.5 Free", free=True),
    _m("big-pickle", "Big Pickle", free=True),
]


# Full Zen roster (free + paid) — used only for the "Get Models" live fetch
# fallback, NOT shown by default for the free provider.
OPENCODE_ZEN_MODELS: List[Dict[str, Any]] = [
    # ── Free (limited-time on Zen) ───────────────────────────────────────────
    _m("big-pickle", "Big Pickle", free=True),
    _m("deepseek-v4-flash-free", "DeepSeek V4 Flash Free", free=True),
    _m("mimo-v2.5-free", "MiMo V2.5 Free", free=True),
    _m("north-mini-code-free", "North Mini Code Free", free=True),
    _m("nemotron-3-ultra-free", "Nemotron 3 Ultra Free", free=True),
    # ── OpenAI (via Zen) ─────────────────────────────────────────────────────
    _m("gpt-5.5", "GPT 5.5"),
    _m("gpt-5.5-pro", "GPT 5.5 Pro"),
    _m("gpt-5.4", "GPT 5.4"),
    _m("gpt-5.4-pro", "GPT 5.4 Pro"),
    _m("gpt-5.4-mini", "GPT 5.4 Mini"),
    _m("gpt-5.4-nano", "GPT 5.4 Nano"),
    _m("gpt-5.3-codex", "GPT 5.3 Codex"),
    _m("gpt-5.3-codex-spark", "GPT 5.3 Codex Spark"),
    _m("gpt-5.2", "GPT 5.2"),
    _m("gpt-5.2-codex", "GPT 5.2 Codex"),
    _m("gpt-5.1", "GPT 5.1"),
    _m("gpt-5.1-codex", "GPT 5.1 Codex"),
    _m("gpt-5.1-codex-max", "GPT 5.1 Codex Max"),
    _m("gpt-5.1-codex-mini", "GPT 5.1 Codex Mini"),
    _m("gpt-5", "GPT 5"),
    _m("gpt-5-codex", "GPT 5 Codex"),
    _m("gpt-5-nano", "GPT 5 Nano"),
    # ── Anthropic (via Zen) ──────────────────────────────────────────────────
    _m("claude-fable-5", "Claude Fable 5"),
    _m("claude-opus-4-8", "Claude Opus 4.8"),
    _m("claude-opus-4-7", "Claude Opus 4.7"),
    _m("claude-opus-4-6", "Claude Opus 4.6"),
    _m("claude-opus-4-5", "Claude Opus 4.5"),
    _m("claude-opus-4-1", "Claude Opus 4.1"),
    _m("claude-sonnet-5", "Claude Sonnet 5"),
    _m("claude-sonnet-4-6", "Claude Sonnet 4.6"),
    _m("claude-sonnet-4-5", "Claude Sonnet 4.5"),
    _m("claude-sonnet-4", "Claude Sonnet 4"),
    _m("claude-haiku-4-5", "Claude Haiku 4.5"),
    _m("claude-3-5-haiku", "Claude Haiku 3.5"),
    # ── Google Gemini (via Zen) ────────────────────────────────────────────
    _m("gemini-3.5-flash", "Gemini 3.5 Flash"),
    _m("gemini-3.1-pro", "Gemini 3.1 Pro"),
    _m("gemini-3-flash", "Gemini 3 Flash"),
    # ── Qwen (via Zen) ───────────────────────────────────────────────────────
    _m("qwen3.7-max", "Qwen 3.7 Max"),
    _m("qwen3.7-plus", "Qwen 3.7 Plus"),
    _m("qwen3.6-plus", "Qwen 3.6 Plus"),
    _m("qwen3.5-plus", "Qwen 3.5 Plus"),
    # ── DeepSeek (via Zen) ───────────────────────────────────────────────────
    _m("deepseek-v4-pro", "DeepSeek V4 Pro"),
    _m("deepseek-v4-flash", "DeepSeek V4 Flash"),
    # ── MiniMax / GLM / Kimi / Grok ──────────────────────────────────────────
    _m("minimax-m2.7", "MiniMax M2.7"),
    _m("minimax-m2.5", "MiniMax M2.5"),
    _m("minimax-m3", "MiniMax M3"),
    _m("glm-5.2", "GLM 5.2"),
    _m("glm-5.1", "GLM 5.1"),
    _m("glm-5", "GLM 5"),
    _m("kimi-k2.5", "Kimi K2.5"),
    _m("kimi-k2.6", "Kimi K2.6"),
    _m("grok-build-0.1", "Grok Build 0.1"),
]
