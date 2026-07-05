from __future__ import annotations

import os
from datetime import datetime


def capability_dir(*parts: str) -> str:
    from pydardcor.core.config import get_user_data_dir

    path = os.path.join(get_user_data_dir(), "capabilities", *parts)
    os.makedirs(path, exist_ok=True)
    return path


def timestamped_path(kind: str, suffix: str) -> str:
    safe_suffix = suffix if suffix.startswith(".") else f".{suffix}"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return os.path.join(capability_dir(kind), f"{kind}-{stamp}{safe_suffix}")

