PROVIDER_KEY = "xAI"

PROVIDER_REGISTRY_ENTRY = {
    "name": "xAI (Grok)",
    "icon": "\u2715",
    "color": "#1da1f2",
    "base_url": "https://api.x.ai/v1",
        "auth_url": "https://console.x.ai",
    "supports_web_login": True,
    "models_fetch_url": "https://api.x.ai/v1/models",
    "models": [
        {
            "id": "grok-4.3",
            "name": "Grok 4.3"
        },
        {
            "id": "grok-4.20-0309-reasoning",
            "name": "Grok 4.20 Reasoning"
        },
        {
            "id": "grok-4.20-0309-non-reasoning",
            "name": "Grok 4.20 Non-Reasoning"
        },
        {
            "id": "grok-4.20-multi-agent-0309",
            "name": "Grok 4.20 Multi-Agent"
        },
        {
            "id": "grok-build-0.1",
            "name": "Grok Build 0.1"
        }
    ]
}
