PROVIDER_KEY = "ClaudeCodeSubscription"

PROVIDER_REGISTRY_ENTRY = {
    "name": "Claude Pro/Max (OAuth)",
    "icon": "C",
    "color": "#d97706",
    "base_url": "https://api.anthropic.com/v1",
        "tier": "Subscription",
    "oauth_provider": "claude",
    "auth_help": "Dardcor starts a local callback server, opens Claude OAuth, then stores the returned token locally.",
    "supports_web_login": True,
    "models": [
        {
            "id": "claude-code/claude-opus-4-8",
            "name": "Claude Opus 4.8"
        },
        {
            "id": "claude-code/claude-opus-4-7",
            "name": "Claude Opus 4.7"
        },
        {
            "id": "claude-code/claude-sonnet-5",
            "name": "Claude Sonnet 5"
        },
        {
            "id": "claude-code/claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6"
        },
        {
            "id": "claude-code/claude-haiku-4-5",
            "name": "Claude Haiku 4.5"
        }
    ]
}
