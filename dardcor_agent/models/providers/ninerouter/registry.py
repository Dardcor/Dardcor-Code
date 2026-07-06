PROVIDER_KEY = "NineRouter"

PROVIDER_REGISTRY_ENTRY = {
    "name": "9Router (Gateway)",
    "icon": "\u2468",
    "color": "#f59e0b",
    "base_url": "http://localhost:20128/v1",
        "tier": "Gateway",
    "auth_url": "http://localhost:20128/dashboard",
    "supports_web_login": True,
    "models": [
        {
            "id": "kr/claude-sonnet-5",
            "name": "Claude Sonnet 5 (via Kiro Free)"
        },
        {
            "id": "kr/claude-opus-4-8",
            "name": "Claude Opus 4.8 (via Kiro Free)"
        },
        {
            "id": "kr/glm-5.2",
            "name": "GLM 5.2 (Free)"
        },
        {
            "id": "kr/minimax-m3",
            "name": "MiniMax M3 (Free)"
        },
        {
            "id": "oc/mimo-v2.5-free",
            "name": "MiMo V2.5 (OpenCode Free)"
        },
        {
            "id": "oc/nemotron-3-ultra-free",
            "name": "Nemotron 3 Ultra (OpenCode Free)"
        },
        {
            "id": "oc/big-pickle",
            "name": "Big Pickle (OpenCode Free)"
        },
        {
            "id": "oc/qwen3-coder",
            "name": "OpenCode Qwen3 Coder (Free)"
        },
        {
            "id": "if/kimi-k2.6",
            "name": "Kimi K2.6 (Free)"
        },
        {
            "id": "vertex/gemini-3.5-flash",
            "name": "Gemini 3.5 Flash (Vertex)"
        },
        {
            "id": "auto",
            "name": "Auto (3-Tier Fallback)"
        }
    ]
}
