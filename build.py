import os
import sys
import subprocess

def main():
    print("========================================")
    print(" Building Dardcor Code with PyInstaller ")
    print("========================================")

    try:
        import PyInstaller
        print(f"[OK] PyInstaller {PyInstaller.__version__} found.")
    except ImportError:
        print("[INFO] Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    is_windows = os.name == "nt"
    is_mac = sys.platform == "darwin"
    is_linux = sys.platform.startswith("linux")
    sep = ";" if is_windows else ":"

    # ── Core PyInstaller command ──────────────────────────────────────────────
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "Dardcor Code",
        "--noconfirm",
        "--windowed",
        "--onedir",
        # Data files (always present)
        "--add-data", f"image{sep}image",
        "--add-data", f"pydardcor/assets{sep}pydardcor/assets",
        "--add-data", f"pydardcor/extension_host{sep}pydardcor/extension_host",
        "--add-data", f"pydardcor/settings{sep}pydardcor/settings",
        "--add-data", f"dardcor_agent/chat/web{sep}dardcor_agent/chat/web",
        # Hidden imports
        "--hidden-import", "PySide6.QtWebEngineWidgets",
        "--hidden-import", "PySide6.QtWebEngineCore",
        "--hidden-import", "pydardcor.cli",
        "dardcor.py"
    ]

    # ── Platform-specific options ─────────────────────────────────────────────
    if is_windows:
        # Icon: .ico for Windows
        if os.path.exists("image/dardcor.ico"):
            cmd.extend(["--icon", "image/dardcor.ico"])
        # Version info: Windows only
        if os.path.exists("version_info.txt"):
            cmd.extend(["--version-file", "version_info.txt"])
        # winpty: Windows only
        try:
            import winpty
            winpty_dir = os.path.dirname(winpty.__file__)
            print(f"[OK] winpty found: {winpty_dir}")
            cmd.extend(["--add-data", f"{winpty_dir}{sep}winpty"])
        except ImportError:
            print("[WARN] winpty not found, skipping.")

    elif is_mac:
        # Icon: .icns for macOS, fallback to .png
        for icon in ["image/dardcor.icns", "image/dardcor.png"]:
            if os.path.exists(icon):
                cmd.extend(["--icon", icon])
                break

    elif is_linux:
        # Linux: no icon embedding needed
        pass

    print("\n[CMD]", " ".join(f'"{c}"' if " " in str(c) else str(c) for c in cmd))
    print()

    result = subprocess.run(cmd, cwd=os.path.dirname(os.path.abspath(__file__)))

    if result.returncode == 0:
        print("\n✅ Build SUCCESS — dist/Dardcor Code/")
    else:
        print(f"\n❌ Build FAILED (exit code {result.returncode})")
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()