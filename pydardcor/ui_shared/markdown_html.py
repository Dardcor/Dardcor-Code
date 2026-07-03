"""Lightweight markdown → HTML for extension README / changelog views."""

import re
from html import escape

try:
    import mistune
    _HAS_MISTUNE = True
except ImportError:
    _HAS_MISTUNE = False

_DETAIL_CSS = """
<style>
    html, body {
        background-color: #000000;
        color: #cccccc;
        font-family: 'Segoe UI', sans-serif;
        font-size: 13px;
        line-height: 1.6;
        margin: 0;
        padding: 16px;
    }
    h1, h2, h3, h4, h5, h6 {
        color: #ffffff;
        border-bottom: 1px solid #333333;
        padding-bottom: 4px;
        margin-top: 20px;
        margin-bottom: 12px;
        font-weight: 600;
    }
    a { color: #4daafc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
        background-color: #1a1a1a;
        padding: 2px 5px;
        border-radius: 3px;
        font-family: Consolas, 'Cascadia Code', monospace;
        font-size: 0.92em;
    }
    pre {
        background-color: #0a0a0a;
        border: 1px solid #333333;
        border-radius: 4px;
        padding: 12px;
        overflow-x: auto;
    }
    pre code { background: transparent; padding: 0; }
    blockquote {
        border-left: 3px solid #444444;
        margin: 0;
        padding: 0 12px;
        color: #aaaaaa;
    }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #333333; padding: 6px 10px; text-align: left; }
    th { background-color: #0a0a0a; color: #ffffff; }
    img, video { max-width: 100%; height: auto; border-radius: 4px; }
    ul, ol { padding-left: 24px; }
    hr { border: none; border-top: 1px solid #333333; margin: 16px 0; }
</style>
"""


def markdown_to_html(text: str) -> str:
    """Convert markdown (with optional raw HTML passthrough) to an HTML fragment."""
    if not text or not text.strip():
        return "<p><em>No content available.</em></p>"
    if _HAS_MISTUNE:
        try:
            md = mistune.create_markdown(plugins=["strikethrough", "table", "url"])
            return md(text)
        except Exception:
            pass
    return _basic_markdown(text)


def _basic_markdown(text: str) -> str:
    """Minimal markdown converter when mistune is unavailable."""
    lines = text.splitlines()
    out: list[str] = []
    in_code = False
    code_buf: list[str] = []
    list_type: str | None = None

    def flush_list():
        nonlocal list_type
        if list_type:
            out.append(f"</{list_type}>")
            list_type = None

    def flush_code():
        nonlocal in_code, code_buf
        if in_code:
            out.append(f"<pre><code>{escape(chr(10).join(code_buf))}</code></pre>")
            code_buf = []
            in_code = False

    for raw in lines:
        line = raw.rstrip()

        if line.strip().startswith("```"):
            flush_list()
            if in_code:
                flush_code()
            else:
                in_code = True
            continue

        if in_code:
            code_buf.append(raw)
            continue

        if not line.strip():
            flush_list()
            out.append("")
            continue

        # Raw HTML block passthrough
        stripped = line.strip()
        if stripped.startswith("<") and (
            stripped.startswith("<img")
            or stripped.startswith("<video")
            or stripped.startswith("<p")
            or stripped.startswith("<div")
            or stripped.startswith("<table")
            or stripped.startswith("<h")
        ):
            flush_list()
            out.append(line)
            continue

        hm = re.match(r"^(#{1,6})\s+(.*)$", line)
        if hm:
            flush_list()
            level = len(hm.group(1))
            out.append(f"<h{level}>{_inline(hm.group(2))}</h{level}>")
            continue

        if re.match(r"^[-*+]\s+", line):
            if list_type != "ul":
                flush_list()
                out.append("<ul>")
                list_type = "ul"
            content = re.sub(r"^[-*+]\s+", "", line)
            out.append(f"<li>{_inline(content)}</li>")
            continue

        if re.match(r"^\d+\.\s+", line):
            if list_type != "ol":
                flush_list()
                out.append("<ol>")
                list_type = "ol"
            content = re.sub(r"^\d+\.\s+", "", line)
            out.append(f"<li>{_inline(content)}</li>")
            continue

        flush_list()
        out.append(f"<p>{_inline(line)}</p>")

    flush_list()
    flush_code()
    return "\n".join(out)


def _inline(text: str) -> str:
    s = escape(text)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", s)
    s = re.sub(
        r"!\[([^\]]*)\]\(([^)]+)\)",
        r'<img src="\2" alt="\1">',
        s,
    )
    s = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        r'<a href="\2">\1</a>',
        s,
    )
    return s


def wrap_html_document(body_html: str, base_href: str = "") -> str:
    """Wrap an HTML fragment in a full document with optional <base href>."""
    base_tag = f'<base href="{escape(base_href, quote=True)}">' if base_href else ""
    return (
        "<!DOCTYPE html><html><head>"
        '<meta charset="utf-8">'
        f"{base_tag}"
        f"{_DETAIL_CSS}"
        "</head><body>"
        f"{body_html}"
        "</body></html>"
    )
