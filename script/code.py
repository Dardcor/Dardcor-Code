#!/usr/bin/env python3
"""Dardcor Code CLI — VS Code-style command-line interface.

Usage:
    code [path]              Launch desktop app, optionally opening path
    code tunnel              Start/stop remote tunnel service
    code server              Start remote server mode (Flask web API)
    code serve-web           Serve the full app via web
    code status              Show app status
    code update              Check and apply updates
    code version             Show version info
    code install             Desktop integration (file associations, PATH)
    code auth                OS-level auth system integration

All commands return exit code 0 on success, 1 on error.
"""

import sys
import os
import json
import argparse
import signal
import threading
import logging
import subprocess
import webbrowser
from pathlib import Path
from typing import Optional, List

# Always ensure project root is importable
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from pydardcor import __version__


# ── Helpers ────────────────────────────────────────────────────────────

def _get_build_dir() -> str:
    return os.path.join(_PROJECT_ROOT, "build", "Dardcor Code")

def _get_executable_path() -> str:
    exe = os.path.join(_get_build_dir(), "Dardcor Code.exe")
    if os.path.isfile(exe):
        return exe
    alt = os.path.join(_PROJECT_ROOT, "dist", "Dardcor Code", "Dardcor Code.exe")
    if os.path.isfile(alt):
        return alt
    return exe

def _ensure_user_dirs():
    try:
        from pydardcor.core.config import ensure_user_dirs
        ensure_user_dirs()
    except ImportError:
        pass

def _get_config():
    try:
        from pydardcor.core.config import get_config
        return get_config()
    except ImportError:
        return None

def _has_pyside() -> bool:
    try:
        import PySide6
        return True
    except ImportError:
        return False


# ── command: desktop ───────────────────────────────────────────────────

def cmd_desktop(args):
    _ensure_user_dirs()
    exe = _get_executable_path()
    if os.path.isfile(exe):
        cmd = [exe]
        if args.path:
            cmd.append(os.path.abspath(args.path))
        subprocess.Popen(cmd, shell=False)
        return 0
    try:
        from pydardcor.cli import cmd_desktop as _run
        _run(args)
        return 0
    except ImportError:
        print("error: desktop executable not found and PySide6 is not available")
        return 1


# ── command: tunnel ────────────────────────────────────────────────────

def cmd_tunnel(args):
    _ensure_user_dirs()

    if not _has_pyside():
        print("error: tunnel requires PySide6 (pip install PySide6)")
        return 1

    from PySide6.QtCore import QCoreApplication
    from pydardcor.remote.tunnel import RemoteTunnelManager

    app = QCoreApplication(sys.argv)
    mgr = RemoteTunnelManager()

    if args.action == "start":
        port = args.port or 8080
        tunnel_id = mgr.create_tunnel(port, name=args.name, protocol=args.protocol, visibility=args.visibility)
        info = mgr.get_tunnel(tunnel_id)
        if info:
            print(f"tunnel started: {info.tunnel_id}")
            print(f"local port:     {info.local_port}")
            print(f"remote url:     {info.remote_url}")
            print(f"status:         {info.status}")
        else:
            print(f"tunnel created: {tunnel_id}")
            print("use 'code tunnel list' to see status")

    elif args.action == "stop":
        ok = mgr.close_tunnel(args.tunnel_id)
        if ok:
            print(f"tunnel {args.tunnel_id} closed")
        else:
            print(f"tunnel {args.tunnel_id} not found")
            return 1

    elif args.action == "list":
        tunnels = mgr.get_tunnels()
        if not tunnels:
            print("no active tunnels")
        else:
            for t in tunnels:
                status = t.get("status", "unknown")
                url = t.get("remote_url", "")
                print(f"  {t['tunnel_id']:10s}  port {t['local_port']:<5d}  [{status:12s}]  {url}")

    elif args.action == "status":
        tunnels = mgr.get_active_tunnels()
        if not tunnels:
            print("no active tunnels")
        else:
            for t in tunnels:
                print(f"  {t.tunnel_id:10s}  port {t.local_port:<5d}  {t.remote_url}")

    else:
        print(f"unknown tunnel action: {args.action}")
        return 1

    return 0


# ── command: server ────────────────────────────────────────────────────

def cmd_server(args):
    """Start a Flask-based remote server that provides web API access."""
    _ensure_user_dirs()

    port = args.port or 8765
    host = args.host or "0.0.0.0"

    try:
        from flask import Flask, jsonify, request, send_from_directory
    except ImportError:
        print("error: Flask is required for server mode")
        print("install: pip install flask")
        return 1

    static_dir = args.static_dir or ""
    if not static_dir:
        static_dir = _PROJECT_ROOT
    if not os.path.isdir(static_dir):
        static_dir = _PROJECT_ROOT

    app = Flask("Dardcor-Code-Server")

    @app.route("/api/status")
    def api_status():
        cfg = _get_config()
        return jsonify({
            "name": "Dardcor Code Server",
            "version": __version__,
            "running": True,
            "workspace": cfg.workspace_path if cfg else "",
            "platform": sys.platform,
        })

    @app.route("/api/version")
    def api_version():
        return jsonify({
            "version": __version__,
            "name": "Dardcor Code",
            "quality": "stable",
        })

    @app.route("/api/files")
    def api_files():
        path = request.args.get("path", static_dir)
        if not os.path.isdir(path):
            return jsonify({"error": "directory not found"}), 404
        entries = []
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            entries.append({
                "name": name,
                "path": full,
                "is_dir": os.path.isdir(full),
                "size": os.path.getsize(full) if os.path.isfile(full) else 0,
            })
        return jsonify(entries)

    @app.route("/api/file")
    def api_file():
        filepath = request.args.get("path", "")
        if not filepath or not os.path.isfile(filepath):
            return jsonify({"error": "file not found"}), 404
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return jsonify({"path": filepath, "content": content})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/")
    def index():
        index_path = os.path.join(_PROJECT_ROOT, "script", "index")
        if os.path.isdir(index_path):
            return send_from_directory(index_path, "index.html")
        return jsonify({
            "message": "Dardcor Code Server",
            "version": __version__,
            "docs": "/api/status",
        })

    @app.route("/<path:filename>")
    def static_files(filename):
        search_dirs = [
            args.static_dir or "",
            _PROJECT_ROOT,
            os.path.join(_PROJECT_ROOT, "script"),
        ]
        for d in search_dirs:
            if not d:
                continue
            full = os.path.join(d, filename)
            if os.path.isfile(full):
                return send_from_directory(d, filename)
        return jsonify({"error": "not found"}), 404

    print(f"Dardcor Code Server v{__version__}")
    print(f"listening on http://{host}:{port}")
    print(f"API: /api/status")
    app.run(host=host, port=port, debug=False, use_reloader=False)


# ── command: serve-web ────────────────────────────────────────────────

def cmd_serve_web(args):
    """Serve the full Dardcor Code web app via HTTP."""
    _ensure_user_dirs()

    port = args.port or 5500
    host = args.host or "127.0.0.1"
    root = args.path or _PROJECT_ROOT

    if not os.path.isdir(root):
        print(f"error: directory not found: {root}")
        return 1

    if _has_pyside():
        from PySide6.QtCore import QCoreApplication
        qt_app = QCoreApplication(sys.argv)
        from pydardcor.remote.live_server import LiveServerManager
        mgr = LiveServerManager()
        actual_port = mgr.start(root, preferred_port=port)
        http_prefix = "http"
        print(f"Dardcor Code Web Server v{__version__}")
        print(f"serving: {root}")
        print(f"url:     {http_prefix}://localhost:{actual_port}")
        print("press Ctrl+C to stop")
        try:
            signal.signal(signal.SIGINT, lambda s, f: (mgr.cleanup(), qt_app.quit()))
            qt_app.exec()
        except KeyboardInterrupt:
            pass
        finally:
            mgr.cleanup()
        return 0

    try:
        import http.server
        import socketserver
    except ImportError:
        print("error: unable to start HTTP server")
        return 1

    handler = http.server.SimpleHTTPRequestHandler
    os.chdir(root)
    httpd = socketserver.ThreadingTCPServer((host, port), handler)
    print(f"Dardcor Code Web Server v{__version__}")
    print(f"serving: {root}")
    print(f"url:     http://{host}:{port}")
    print("press Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        httpd.server_close()
    return 0


# ── command: status ────────────────────────────────────────────────────

def cmd_status(args):
    _ensure_user_dirs()
    config = _get_config()

    print(f"Dardcor Code v{__version__}")
    print()

    exe = _get_executable_path()
    if os.path.isfile(exe):
        print(f"executable: {exe}")
    elif _has_pyside():
        print("executable: source-only (PySide6 available)")
    else:
        print("executable: not found")

    if config:
        print(f"workspace:  {config.workspace_path or '(none)'}")
        print(f"theme:      {config.color_theme or 'default'}")
        print(f"font:       {config.font_family} {config.font_size}pt")

    print(f"config:     {os.path.join(os.environ.get('LOCALAPPDATA', '~'), 'Dardcor Code', 'config.json')}")
    print(f"data dir:   {os.path.expanduser('~/.dardcor-code')}")

    try:
        import pydardcor
        ext_dir = os.path.join(os.path.expanduser("~"), ".dardcor-code", "extensions")
        if os.path.isdir(ext_dir):
            count = len([d for d in os.listdir(ext_dir) if os.path.isdir(os.path.join(ext_dir, d))])
            print(f"extensions: {count} installed")
    except Exception:
        pass

    print(f"python:     {sys.version.split()[0]}")
    print(f"platform:   {sys.platform}")
    print(f"pyside6:    {'yes' if _has_pyside() else 'no'}")

    return 0


# ── command: update ────────────────────────────────────────────────────

def cmd_update(args):
    _ensure_user_dirs()

    if not _has_pyside():
        print("error: update command requires PySide6")
        print("install: pip install PySide6")
        return 1

    from PySide6.QtCore import QCoreApplication
    from pydardcor.core.update import UpdateManager

    qt_app = QCoreApplication(sys.argv)
    mgr = UpdateManager(current_version=__version__)
    result = [1]

    def on_check(has_update, version, notes):
        if has_update:
            print(f"update available: {version}")
            print(f"current version:  {__version__}")
            if notes:
                print(f"release notes: {notes}")
            if getattr(args, 'apply', False):
                print(f"downloading update {version}...")
                mgr.download_update(version)
            else:
                print("use 'code update --apply' to download and install")
                result[0] = 0
        else:
            print(f"no updates available (current: {__version__})")
            result[0] = 0
        qt_app.quit()

    def on_downloaded(path):
        print(f"update downloaded: {path}")
        print("restart the application to apply the update")
        result[0] = 0
        qt_app.quit()

    mgr.check_finished.connect(on_check)
    mgr.download_finished.connect(on_downloaded)
    mgr.check_for_updates()
    qt_app.exec()
    return result[0]


# ── command: version ───────────────────────────────────────────────────

def cmd_version(args):
    print(f"Dardcor Code v{__version__}")
    return 0


# ── command: install (desktop integration) ─────────────────────────────

def cmd_install(args):
    """Register file associations, create PATH entry, and install protocol handler."""
    errors = 0

    if os.name != "nt":
        print("warning: desktop integration is currently Windows-only")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    exe = _get_executable_path()

    if not os.path.isfile(exe):
        print(f"warning: executable not found at {exe}")
        print("file associations will be registered but the launcher must exist at build time")

    # 1. Create a code.cmd launcher in the script directory
    launcher_path = os.path.join(script_dir, "code.cmd")
    try:
        with open(launcher_path, "w") as f:
            f.write(f"""@echo off
python "%~dp0code.py" %*
""")
        print(f"launcher: {launcher_path}")
    except Exception as e:
        print(f"error creating launcher: {e}")
        errors += 1

    # 2. Add to PATH via registry for current user
    if os.name == "nt":
        import winreg
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                "Environment",
                0,
                winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE,
            )
            try:
                current_path, _ = winreg.QueryValueEx(key, "PATH")
            except FileNotFoundError:
                current_path = ""

            path_entries = [p for p in current_path.split(";") if p.strip()]
            if script_dir not in path_entries:
                new_path = script_dir + ";" + current_path if current_path else script_dir
                winreg.SetValueEx(key, "PATH", 0, winreg.REG_EXPAND_SZ, new_path)
                print(f"added to PATH: {script_dir}")
                # Broadcast environment change
                try:
                    HWND_BROADCAST = 0xFFFF
                    WM_SETTINGCHANGE = 0x001A
                    import ctypes
                    ctypes.windll.user32.SendMessageW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment")
                except Exception:
                    pass
            else:
                print(f"already in PATH: {script_dir}")
            winreg.CloseKey(key)
        except Exception as e:
            print(f"error updating PATH: {e}")
            errors += 1

    # 3. Register file associations
    if os.name == "nt" and os.path.isfile(exe):
        import winreg
        try:
            extensions = [
                ".py", ".pyw", ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx",
                ".json", ".xml", ".yaml", ".yml", ".md", ".txt", ".cfg", ".ini",
                ".sh", ".bat", ".cmd", ".ps1", ".cpp", ".c", ".h", ".hpp",
                ".java", ".cs", ".rb", ".go", ".rs", ".swift", ".kt", ".kts",
                ".sql", ".r", ".lua", ".pl", ".php", ".vue", ".svelte",
            ]
            prog_id = "DardcorCode"
            app_name = "Dardcor Code"
            icon_index = "0"

            for ext in extensions:
                try:
                    key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, f"Software\\Classes\\{ext}\\OpenWithProgids")
                    winreg.SetValueEx(key, prog_id, 0, winreg.REG_SZ, "")
                    winreg.CloseKey(key)
                except Exception:
                    pass

            cmd_key = f"Software\\Classes\\{prog_id}\\shell\\open\\command"
            try:
                key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, cmd_key)
                winreg.SetValue(key, "", winreg.REG_SZ, f'"{exe}" "%1"')
                winreg.CloseKey(key)
            except Exception as e:
                print(f"error registering progid command: {e}")
                errors += 1

            default_icon = f"Software\\Classes\\{prog_id}\\DefaultIcon"
            try:
                key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, default_icon)
                winreg.SetValue(key, "", winreg.REG_SZ, f'"{exe}",{icon_index}')
                winreg.CloseKey(key)
            except Exception:
                pass

            print(f"registered associations for {len(extensions)} file types")
        except Exception as e:
            print(f"error registering file associations: {e}")
            errors += 1

    # 4. Register dardcor:// URL protocol
    if os.name == "nt" and os.path.isfile(exe):
        import winreg
        try:
            url_key = "Software\\Classes\\dardcor"
            key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, url_key)
            winreg.SetValue(key, "", winreg.REG_SZ, "URL:Dardcor Code Protocol")
            winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
            winreg.CloseKey(key)

            cmd_key = f"{url_key}\\shell\\open\\command"
            key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, cmd_key)
            winreg.SetValue(key, "", winreg.REG_SZ, f'"{exe}" "%1"')
            winreg.CloseKey(key)
            print("registered dardcor:// URL protocol")
        except Exception as e:
            print(f"error registering URL protocol: {e}")
            errors += 1

    # 5. Create Start Menu shortcut
    if os.name == "nt" and os.path.isfile(exe):
        try:
            import win32com.client
            shell = win32com.client.Dispatch("WScript.Shell")
            start_menu = shell.SpecialFolders("Programs")
            shortcut_path = os.path.join(start_menu, "Dardcor Code.lnk")
            shortcut = shell.CreateShortCut(shortcut_path)
            shortcut.TargetPath = exe
            shortcut.WorkingDirectory = _PROJECT_ROOT
            shortcut.Description = "Dardcor Code - AI Coding Assistant"
            shortcut.Save()
            print(f"start menu: {shortcut_path}")
        except ImportError:
            start_menu_dir = os.path.join(
                os.environ.get("APPDATA", ""),
                "Microsoft", "Windows", "Start Menu", "Programs"
            )
            shortcut_path = os.path.join(start_menu_dir, "Dardcor Code.lnk")
            try:
                with open(shortcut_path, "w") as f:
                    f.write(f"[InternetShortcut]\nURL=file:///{exe}\n")
            except Exception:
                pass
        except Exception as e:
            print(f"error creating start menu shortcut: {e}")

    if errors:
        print(f"\ncompleted with {errors} error(s)")
        return 1

    print("\ndesktop integration complete")
    print("run 'code' from any terminal to launch Dardcor Code")
    return 0


# ── command: auth ──────────────────────────────────────────────────────

def cmd_auth(args):
    """OS-level auth system integration via keyring."""
    _ensure_user_dirs()

    try:
        import keyring
    except ImportError:
        print("error: keyring is required for auth integration")
        print("install: pip install keyring")
        return 1

    service = "dardcor-code"

    if args.action == "login":
        provider = args.provider or "github"
        print(f"authenticating with {provider}...")

        token = os.environ.get("DARDCOD_AUTH_TOKEN", "")
        if not token:
            token = input(f"enter {provider} token: ").strip()
        if token:
            keyring.set_password(service, provider, token)
            print(f"authentication token for {provider} saved securely")
        else:
            print("error: no token provided")
            return 1

    elif args.action == "logout":
        provider = args.provider or "github"
        try:
            keyring.delete_password(service, provider)
            print(f"logged out from {provider}")
        except keyring.errors.PasswordDeleteError:
            print(f"no stored credentials for {provider}")

    elif args.action == "status":
        providers = ["github", "microsoft"]
        for p in providers:
            try:
                token = keyring.get_password(service, p)
                masked = token[:4] + "****" + token[-4:] if token and len(token) > 8 else "****"
                print(f"{p:15s}: {'authenticated' if token else 'not configured'}  [{masked if token else ''}]")
            except Exception:
                print(f"{p:15s}: error checking")

    elif args.action == "list":
        providers = ["github", "microsoft"]
        print("configured providers:")
        for p in providers:
            try:
                token = keyring.get_password(service, p)
                status = "authenticated" if token else "not configured"
                print(f"  - {p} ({status})")
            except Exception:
                print(f"  - {p} (error)")

    elif args.action == "clear":
        providers = ["github", "microsoft"]
        for p in providers:
            try:
                keyring.delete_password(service, p)
            except Exception:
                pass
        print("all credentials cleared")

    else:
        print(f"unknown auth action: {args.action}")
        return 1

    return 0


# ── command: ipc ───────────────────────────────────────────────────────

def cmd_ipc(args):
    """Inter-process communication via QLocalServer/QLocalSocket.

    Start an IPC server or send a message to a running instance.
    """
    _ensure_user_dirs()

    if not _has_pyside():
        print("error: IPC requires PySide6 (pip install PySide6)")
        return 1

    from PySide6.QtCore import QCoreApplication, QTimer
    from PySide6.QtNetwork import QLocalServer, QLocalSocket

    server_name = args.name or "dardcor-code-ipc"

    if args.action == "listen":
        QLocalServer.removeServer(server_name)
        qt_app = QCoreApplication(sys.argv)
        server = QLocalServer()
        server.newConnection.connect(lambda: _ipc_on_connection(server))
        ok = server.listen(server_name)
        if ok:
            print(f"IPC server listening on: {server_name}")
            print("press Ctrl+C to stop")
            signal.signal(signal.SIGINT, lambda s, f: qt_app.quit())
            qt_app.exec()
            server.close()
        else:
            print(f"error: cannot listen on {server_name}: {server.errorString()}")
            return 1

    elif args.action == "send":
        qt_app = QCoreApplication(sys.argv)
        sock = QLocalSocket()
        result = [1]

        sock.connected.connect(lambda: _ipc_send_message(sock, args, result, qt_app))
        sock.errorOccurred.connect(lambda err: _ipc_on_error(err, sock, result, qt_app))
        sock.connectToServer(server_name)

        if not sock.waitForConnected(2000):
            print(f"error: cannot connect to IPC server {server_name}")
            print("is the application running with 'code ipc listen'?")
            qt_app.quit()
            return 1

        qt_app.exec()
        return result[0]

    elif args.action == "ping":
        qt_app = QCoreApplication(sys.argv)
        sock = QLocalSocket()
        result = [False]

        sock.connected.connect(lambda: _ipc_ping(sock, result, qt_app))
        sock.errorOccurred.connect(lambda: (_ipc_set_result(result, qt_app)))
        sock.connectToServer(server_name)
        res = sock.waitForConnected(1000)
        if not res:
            print("no IPC server running")
        qt_app.exec()
        return 0 if result[0] else 1

    else:
        print(f"unknown IPC action: {args.action}")
        print("usage: code ipc listen|send|ping [--name NAME] [--type TYPE] [--payload DATA]")
        return 1

    return 0


def _ipc_on_connection(server):
    conn = server.nextPendingConnection()
    if not conn:
        return
    conn.readyRead.connect(lambda: _ipc_read(conn))

def _ipc_read(conn):
    while conn.bytesAvailable() > 0:
        try:
            data = conn.readAll()
            msg = json.loads(data.data().decode("utf-8"))
            print(f"IPC message received:")
            print(f"  type:    {msg.get('type', '')}")
            print(f"  payload: {json.dumps(msg.get('payload', {}), indent=2)}")
        except Exception as e:
            print(f"IPC error: {e}")

def _ipc_send_message(sock, args, result, qt_app):
    msg = json.dumps({
        "type": args.msg_type or "command",
        "payload": json.loads(args.payload) if args.payload else {},
    })
    sock.write(msg.encode("utf-8"))
    sock.waitForBytesWritten(1000)
    print(f"IPC message sent: {args.msg_type or 'command'}")
    result[0] = 0
    qt_app.quit()

def _ipc_on_error(err, sock, result, qt_app):
    print(f"IPC error: {err}")
    result[0] = 1
    qt_app.quit()

def _ipc_ping(sock, result, qt_app):
    msg = json.dumps({"type": "ping", "payload": {}})
    sock.write(msg.encode("utf-8"))
    sock.waitForBytesWritten(500)
    print("IPC server is running")
    result[0] = True
    qt_app.quit()

def _ipc_set_result(result, qt_app):
    result[0] = False
    qt_app.quit()


# ── Argument parser ────────────────────────────────────────────────────

def build_parser():
    parser = argparse.ArgumentParser(
        prog="code",
        description="Dardcor Code - AI-Powered Code Editor CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  code                     Launch the desktop editor\n"
            "  code .                   Open current folder\n"
            "  code tunnel start        Start remote tunnel on port 8080\n"
            "  code server              Start remote server on port 8765\n"
            "  code serve-web           Serve current folder via HTTP\n"
            "  code status              Show editor status\n"
            "  code update              Check for updates\n"
            "  code install             Register file associations\n"
            "  code auth login github   Authenticate with GitHub\n"
        ),
    )
    parser.add_argument("--version", "-v", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("path", nargs="?", default=None,
                        help="File or folder to open (default: launch desktop)")

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # tunnel
    p = subparsers.add_parser("tunnel", help="Remote tunnel management")
    p.add_argument("action", nargs="?", default="start", choices=["start", "stop", "list", "status"],
                   help="Tunnel action (default: start)")
    p.add_argument("--port", "-p", type=int, default=8080, help="Local port to tunnel")
    p.add_argument("--name", "-n", default="", help="Tunnel name")
    p.add_argument("--protocol", default="http", choices=["http", "https"],
                   help="Tunnel protocol")
    p.add_argument("--visibility", default="private", choices=["private", "public"],
                   help="Tunnel visibility")
    p.add_argument("tunnel_id", nargs="?", default="", help="Tunnel ID (for stop)")

    # server
    p = subparsers.add_parser("server", help="Start remote server mode")
    p.add_argument("--port", "-p", type=int, default=8765, help="Server port")
    p.add_argument("--host", default="0.0.0.0", help="Bind address")
    p.add_argument("--static-dir", "-s", default="", help="Static files directory")

    # serve-web
    p = subparsers.add_parser("serve-web", help="Serve the app via web")
    p.add_argument("--port", "-p", type=int, default=5500, help="HTTP port")
    p.add_argument("--host", default="127.0.0.1", help="Bind address")
    p.add_argument("path", nargs="?", default="", help="Directory to serve")

    # status
    p = subparsers.add_parser("status", help="Show application status")

    # update
    p = subparsers.add_parser("update", help="Check for updates")
    p.add_argument("--apply", "-a", action="store_true", help="Download and apply update")

    # version
    p = subparsers.add_parser("version", help="Show version info")

    # install
    p = subparsers.add_parser("install", help="Desktop integration (file associations, PATH)")

    # auth
    p = subparsers.add_parser("auth", help="Authentication management")
    p.add_argument("action", nargs="?", default="status",
                   choices=["login", "logout", "status", "list", "clear"],
                   help="Auth action")
    p.add_argument("--provider", default="github", choices=["github", "microsoft"],
                   help="Auth provider")

    # ipc
    p = subparsers.add_parser("ipc", help="Inter-process communication")
    p.add_argument("action", nargs="?", default="ping",
                   choices=["listen", "send", "ping"],
                   help="IPC action")
    p.add_argument("--name", default="dardcor-code-ipc", help="IPC server name")
    p.add_argument("--type", dest="msg_type", default="command", help="Message type (for send)")
    p.add_argument("--payload", default="{}", help="JSON payload (for send)")

    return parser


# ── Main ───────────────────────────────────────────────────────────────

COMMAND_MAP = {
    "desktop": cmd_desktop,
    "tunnel": cmd_tunnel,
    "server": cmd_server,
    "serve-web": cmd_serve_web,
    "status": cmd_status,
    "update": cmd_update,
    "version": cmd_version,
    "install": cmd_install,
    "auth": cmd_auth,
    "ipc": cmd_ipc,
}


def main():
    parser = build_parser()
    args = parser.parse_args()

    _ensure_user_dirs()

    if args.command:
        handler = COMMAND_MAP.get(args.command)
        if handler:
            try:
                return handler(args)
            except KeyboardInterrupt:
                print()
                return 130
            except Exception as e:
                logging.exception("unhandled error")
                print(f"error: {e}", file=sys.stderr)
                return 1
        print(f"unknown command: {args.command}", file=sys.stderr)
        return 1

    return cmd_desktop(args)


if __name__ == "__main__":
    sys.exit(main())
