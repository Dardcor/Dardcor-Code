PROVIDER_KEY = "Gemini"

PROVIDER_REGISTRY_ENTRY = {
    "name": "Google Gemini",
    "icon": "\u25c9",
    "color": "#4285f4",
    "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "is_gemini": True,
    "auth_url": "https://aistudio.google.com/apikey",
    "supports_web_login": True,
    "models_fetch_url": "https://generativelanguage.googleapis.com/v1beta/models",
    "capabilities": [
        "chat",
        "embeddings",
        "image_generation"
    ]
}
