"""Chrome Launcher - Opens Chrome with agent-specific profile."""

import os
import subprocess
from pathlib import Path

# Chrome paths on Windows
_CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
]

AGENT_DEFAULT_URL = "about:newtab"
AGENT_DEBUG_PORT = 9222


def _get_agent_profile_dir() -> str:
    """Returns agent-specific Chrome profile directory inside the project."""
    base = Path(__file__).resolve().parent.parent.parent
    profile_dir = base / ".dardcor_chrome_profile"
    profile_dir.mkdir(exist_ok=True)
    return str(profile_dir)


def find_chrome() -> str | None:
    """Locate Chrome executable on the system."""
    if os.name == "nt":
        for path in _CHROME_PATHS:
            if os.path.isfile(path):
                return path
    else:
        for name in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
            try:
                result = subprocess.run(["which", name], capture_output=True, text=True)
                if result.returncode == 0:
                    return result.stdout.strip()
            except Exception:
                pass
    return None


def build_agent_chrome_args(chrome_path: str, url: str = None, *, controlled: bool = False, debug_port: int = AGENT_DEBUG_PORT) -> list[str]:
    target_url = url or AGENT_DEFAULT_URL
    profile_dir = _get_agent_profile_dir()
    args = [
        chrome_path,
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
    ]
    if controlled:
        args.extend([
            f"--remote-debugging-port={debug_port}",
            "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=*",
        ])
    args.append(target_url)
    return args


def open_agent_chrome(url: str = None, *, controlled: bool = False, debug_port: int = AGENT_DEBUG_PORT) -> tuple[bool, str]:
    """
    Open Chrome with an agent-specific isolated profile.

    Args:
        url: URL to open. Defaults to AGENT_DEFAULT_URL.

    Returns:
        (success: bool, message: str)
    """
    target_url = url or AGENT_DEFAULT_URL
    chrome_path = find_chrome()

    if not chrome_path:
        # Windows fallback via shell
        if os.name == "nt":
            try:
                subprocess.Popen(
                    f'start chrome "{target_url}"',
                    shell=True,
                    creationflags=0x08000000 # CREATE_NO_WINDOW
                )
                return True, "Chrome launched via shell fallback."
            except Exception as e:
                return False, f"Chrome not found. Fallback failed: {e}"
        else:
            try:
                subprocess.Popen(
                    f'xdg-open "{target_url}"',
                    shell=True,
                    start_new_session=True
                )
                return True, "Launched via xdg-open fallback."
            except Exception as e:
                return False, f"Chrome not found. Fallback failed: {e}"

    args = build_agent_chrome_args(chrome_path, target_url, controlled=controlled, debug_port=debug_port)

    try:
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.DETACHED_PROCESS
        else:
            kwargs["start_new_session"] = True
            
        subprocess.Popen(args, **kwargs)
        if controlled:
            return True, f"AI-controlled Chrome opened on 127.0.0.1:{debug_port}."
        return True, "Chrome opened successfully."
    except Exception as e:
        return False, f"Failed to open Chrome: {e}"
