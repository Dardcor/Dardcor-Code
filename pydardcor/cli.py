import sys
import argparse
import threading

from . import __version__
from .engine.config import get_config


def cmd_desktop(args):
    try:
        from .app import run_desktop_app
        run_desktop_app()
    except ImportError as e:
        print(f"[dardcor] ERROR: PySide6 is required.")
        print(f"[dardcor] Install: pip install PySide6")
        sys.exit(1)


def cmd_status(args):
    print(f"Dardcor Code v{__version__}")
    print("Application installed and ready.")


def cmd_version(args):
    print(f"Dardcor Code v{__version__}")


def main():
    parser = argparse.ArgumentParser(
        prog="dardcor",
        description="Dardcor Code - Full Desktop AI Coding Assistant",
    )
    parser.add_argument("--version", "-v", action="version", version=f"%(prog)s {__version__}")

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    p = subparsers.add_parser("desktop", help="Launch desktop application")
    p.set_defaults(func=cmd_desktop)

    p = subparsers.add_parser("status", help="Check installation status")
    p.set_defaults(func=cmd_status)

    p = subparsers.add_parser("version", help="Show version")
    p.set_defaults(func=cmd_version)

    args = parser.parse_args()

    if not args.command:
        args.command = "desktop"
        args.func = cmd_desktop

    # Initialize config on startup
    get_config()

    args.func(args)


if __name__ == "__main__":
    main()
