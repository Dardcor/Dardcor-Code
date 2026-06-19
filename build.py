import os
import subprocess
import sys

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

    separator = ";" if os.name == "nt" else ":"
    
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "Dardcor Code",
        "--noconfirm",
        "--windowed",
        "--onedir",
        "--icon", "image/dardcor.ico",
        "--version-file", "version_info.txt",
        "--add-data", f"image{separator}image",
        "--add-data", f"pydardcor/assets{separator}pydardcor/assets",
        "--add-data", f"pydardcor/extension_host{separator}pydardcor/extension_host",
        "--add-data", f"pydardcor/settings{separator}pydardcor/settings",
        "--add-data", f"pydardcor/database{separator}pydardcor/database",
        "--hidden-import", "PySide6.QtWebEngineWidgets",
        "--hidden-import", "PySide6.QtWebEngineCore",
        "--hidden-import", "pydardcor.cli",
        "dardcor.py"
    ]

    try:
        import winpty
        winpty_dir = os.path.dirname(winpty.__file__)
        print(f"[OK] winpty found at: {winpty_dir}")
        cmd.extend(["--add-data", f"{winpty_dir}{separator}winpty"])
    except ImportError:
        print("[WARNING] winpty package not found.")

    print("\n[INFO] Running PyInstaller with arguments:")
    print(" ".join(cmd))
    
    result = subprocess.run(cmd)
    
    if result.returncode == 0:
        print("\n[SUCCESS] Build completed!")
        print("You can find the compiled executable in the 'dist/Dardcor Code' folder.")
    else:
        print(f"\n[ERROR] Build failed with exit code {result.returncode}")

if __name__ == "__main__":
    main()