PROVIDER_KEY = "CodexSubscription"

PROVIDER_REGISTRY_ENTRY = {
    "name": "ChatGPT Plus/Pro Codex (OAuth)",
    "icon": "\u2295",
    "color": "#10a37f",
    "base_url": "https://chatgpt.com/backend-api/codex",
        "tier": "Subscription",
    "oauth_provider": "codex",
    "auth_help": "Dardcor starts a local callback server on port 1455, opens OpenAI Codex OAuth, then stores the returned token locally.",
    "supports_web_login": True,
    "models": [
        {
            "id": "codex/gpt-5.5",
            "name": "GPT-5.5"
        },
        {
            "id": "codex/gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "codex/gpt-5.3-codex",
            "name": "GPT-5.3 Codex"
        },
        {
            "id": "codex/gpt-5.2-codex",
            "name": "GPT-5.2 Codex"
        },
        {
            "id": "codex/gpt-5.1-codex-max",
            "name": "GPT-5.1 Codex Max"
        }
    ]
}
