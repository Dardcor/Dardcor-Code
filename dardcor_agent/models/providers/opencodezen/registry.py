PROVIDER_KEY = "OpenCodeZen"

PROVIDER_REGISTRY_ENTRY = {
    "name": "OpenCode Zen (Free)",
    "icon": "\u25d0",
    "color": "#22c55e",
    "base_url": "https://opencode.ai/zen/v1",
        "models_fetch_url": "https://opencode.ai/zen/v1/models",
    "tier": "Free",
    "requires_api_key": True,
    "auth_url": "https://opencode.ai/auth",
    "supports_web_login": True,
    "models": [
        {
            "id": "north-mini-code-free",
            "name": "North Mini Code Free",
            "free": True
        },
        {
            "id": "nemotron-3-ultra-free",
            "name": "Nemotron 3 Ultra Free",
            "free": True
        },
        {
            "id": "deepseek-v4-flash-free",
            "name": "DeepSeek V4 Flash Free",
            "free": True
        },
        {
            "id": "mimo-v2.5-free",
            "name": "MiMo V2.5 Free",
            "free": True
        },
        {
            "id": "big-pickle",
            "name": "Big Pickle",
            "free": True
        }
    ]
}
