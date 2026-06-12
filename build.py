import os
import subprocess
import sys

def main():
    print("========================================")
    print(" Building Dardcor Code with PyInstaller ")
    print("========================================")

    # 1. Check/Install PyInstaller
    try:
        import PyInstaller
        print("[OK] PyInstaller is installed.")
    except ImportError:
        print("[INFO] Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    # 2. Build the PyInstaller command
    separator = ";" if os.name == "nt" else ":"
    
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "Dardcor Code",
        "--noconfirm",          # Replace output directory without asking
        "--windowed",           # Don't show console window (GUI app)
        "--onedir",             # Create a directory (faster startup, easier debugging than onefile)
        
        # Add the 'image' directory
        "--add-data", f"image{separator}image",
        
        # Add the 'pydardcor/assets' directory (Monaco editor, Web Workers, SVGs, etc.)
        "--add-data", f"pydardcor/assets{separator}pydardcor/assets",
        
        # Hidden imports (sometimes PySide6 QWebEngine needs help)
        "--hidden-import", "PySide6.QtWebEngineWidgets",
        "--hidden-import", "PySide6.QtWebEngineCore",
        "--hidden-import", "pydardcor.cli",
        
        # Main entry script
        "dardcor.py"
    ]

    print("\n[INFO] Running PyInstaller with arguments:")
    print(" ".join(cmd))
    
    # 3. Execute PyInstaller
    result = subprocess.run(cmd)
    
    if result.returncode == 0:
        print("\n[SUCCESS] Build completed!")
        print("You can find the compiled executable in the 'dist/Dardcor Code' folder.")
    else:
        print(f"\n[ERROR] Build failed with exit code {result.returncode}")

if __name__ == "__main__":
    main()
