import sys
import os

# Ensure the root directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pydardcor.cli import main

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    sys.exit(main())
