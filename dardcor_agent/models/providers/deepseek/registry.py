PROVIDER_KEY = "DeepSeek"

PROVIDER_REGISTRY_ENTRY = {
    "name": "DeepSeek",
    "icon": "\u25c6",
    "color": "#4da3ff",
    "base_url": "https://api.deepseek.com/v1",
        "auth_url": "https://platform.deepseek.com/api_keys",
    "supports_web_login": True,
    "models": [
        {
            "id": "deepseek-v4-pro",
            "name": "DeepSeek V4 Pro"
        },
        {
            "id": "deepseek-v4-flash",
            "name": "DeepSeek V4 Flash"
        }
    ]
}
