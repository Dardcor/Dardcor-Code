import os
import sys
import subprocess

def main():
    print("========================================")
    print(" Building Dardcor Code with PyInstaller ")
    print("========================================")

    try:
        import PyInstaller
        print("[OK] PyInstaller is installed.")
    except ImportError:
        print("[INFO] Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    is_windows = os.name == "nt"
    is_mac = sys.platform == "darwin"
    separator = ";" if is_windows else ":"

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "Dardcor Code",
        "--noconfirm",
        "--windowed",
        "--onedir",
        "--add-data", f"image{separator}image",
        "--add-data", f"pydardcor/assets{separator}pydardcor/assets",
        "--add-data", f"pydardcor/extension_host{separator}pydardcor/extension_host",
        "--add-data", f"pydardcor/settings{separator}pydardcor/settings",
        "--add-data", f"dardcor_agent/chat/web{separator}dardcor_agent/chat/web",
        "--hidden-import", "PySide6.QtWebEngineWidgets",
        "--hidden-import", "PySide6.QtWebEngineCore",
        "--hidden-import", "pydardcor.cli",
        "dardcor.py"
    ]

    # Icon: .ico for Windows, .icns for Mac (fallback to .png)
    if is_windows:
        icon_path = "image/dardcor.ico"
        if os.path.exists(icon_path):
            cmd.extend(["--icon", icon_path])
        # Version info is Windows-only
        if os.path.exists("version_info.txt"):
            cmd.extend(["--version-file", "version_info.txt"])
    elif is_mac:
        icon_path = "image/dardcor.icns"
        if not os.path.exists(icon_path):
            icon_path = "image/dardcor.png"
        if os.path.exists(icon_path):
            cmd.extend(["--icon", icon_path])
    else:
        # Linux - icon embedded in binary is not standard, skip
        pass

    # winpty only on Windows
    if is_windows:
        try:
            import winpty
            winpty_dir = os.path.dirname(winpty.__file__)
            print(f"[OK] winpty found at: {winpty_dir}")
            cmd.extend(["--add-data", f"{winpty_dir}{separator}winpty"])
        except ImportError:
            print("[WARNING] winpty package not found. Skipping.")

    print("\n[INFO] Running PyInstaller with arguments:")
    print(" ".join(str(c) for c in cmd))

    result = subprocess.run(cmd)

    if result.returncode == 0:
        print("\n[SUCCESS] Build completed!")
        print("You can find the compiled executable in the 'dist/Dardcor Code' folder.")
    else:
        print(f"\n[ERROR] Build failed with exit code {result.returncode}")
        sys.exit(result.returncode)

if __name__ == "__main__":
    main()