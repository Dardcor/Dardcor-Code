from pathlib import Path
import re
import sys


def main() -> int:
    print("Paste keys block, then press Ctrl+Z then Enter on Windows.")
    text = sys.stdin.read()

    nvidia = _first(r"nvapi-[A-Za-z0-9_\-]+", text)
    openrouter = _first(r"sk-or-v1-[A-Za-z0-9_\-]+", text)
    groq = _first(r"gsk_[A-Za-z0-9_\-]+", text)
    gemini = re.findall(r"AIza[A-Za-z0-9_\-]+", text)

    lines = [
        f"OPENROUTER_API_KEY={openrouter}",
        f"GROQ_API_KEY={groq}",
        f"NVIDIA_API_KEY={nvidia}",
        "",
        "# Multiple Gemini keys are supported for local development.",
    ]
    for i in range(14):
        key = gemini[i] if i < len(gemini) else ""
        suffix = "" if i == 0 else f"_{i + 1}"
        lines.append(f"GOOGLE_API_KEY{suffix}={key}")

    Path(".env").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote .env with {len(gemini[:14])} Gemini key(s).")
    return 0


def _first(pattern: str, text: str) -> str:
    match = re.search(pattern, text)
    return match.group(0) if match else ""


if __name__ == "__main__":
    raise SystemExit(main())
