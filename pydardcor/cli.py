import sys
import os
import argparse
import threading

if os.name == "nt":
    existing = os.environ.get("QT_LOGGING_RULES", "")
    if "qt.qpa.fonts" not in existing:
        os.environ["QT_LOGGING_RULES"] = f"{existing};qt.qpa.fonts=false;qt.qpa.fonts.warning=false".strip(";")

from . import __version__
from .core.config import get_config


def cmd_desktop(args):
    try:
        from .core.config import get_config
        cfg = get_config()
        if hasattr(args, 'path') and args.path:
            target_path = os.path.abspath(args.path)
            if os.path.exists(target_path):
                cfg.workspace_path = target_path
                cfg.save()
        
        from .app.app import run_desktop_app
        run_desktop_app()
    except ImportError as e:
        import traceback
        traceback.print_exc()
        print(f"[dardcor] ERROR: PySide6 is required.")
        print(f"[dardcor] Install: pip install PySide6")
        sys.exit(1)


def cmd_status(args):
    print(f"Dardcor Code v{__version__}")
    print("Application installed and ready.")


def cmd_version(args):
    print(f"Dardcor Code v{__version__}")


def main():
    
    if any(arg.startswith("--type=") for arg in sys.argv):
        from PySide6.QtWidgets import QApplication
        app = QApplication(sys.argv)
        sys.exit(app.exec())

    parser = argparse.ArgumentParser(
        prog="dardcor",
        description="Dardcor Code - Full Desktop AI Coding Assistant",
    )
    parser.add_argument("--version", "-v", action="version", version=f"%(prog)s {__version__}")

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    p = subparsers.add_parser("desktop", help="Launch desktop application")
    p.add_argument("path", nargs="?", default=None, help="Path to open")
    p.set_defaults(func=cmd_desktop)

    p = subparsers.add_parser("status", help="Check installation status")
    p.set_defaults(func=cmd_status)

    p = subparsers.add_parser("version", help="Show version")
    p.set_defaults(func=cmd_version)

    args = parser.parse_args()

    if not args.command:
        args.command = "desktop"
        args.func = cmd_desktop

    get_config()

    args.func(args)


if __name__ == "__main__":
    main()
