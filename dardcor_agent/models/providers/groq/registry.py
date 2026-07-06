PROVIDER_KEY = "Groq"

PROVIDER_REGISTRY_ENTRY = {
    "name": "Groq",
    "icon": "\u25b6",
    "color": "#f55036",
    "base_url": "https://api.groq.com/openai/v1",
        "models_fetch_url": "https://api.groq.com/openai/v1/models",
    "auth_url": "https://console.groq.com/keys",
    "supports_web_login": True,
    "models": [
        {
            "id": "llama-3.3-70b-versatile",
            "name": "Llama 3.3 70B (Free)"
        },
        {
            "id": "llama-3.1-8b-instant",
            "name": "Llama 3.1 8B Instant (Free)"
        },
        {
            "id": "openai/gpt-oss-120b",
            "name": "GPT OSS 120B"
        },
        {
            "id": "openai/gpt-oss-20b",
            "name": "GPT OSS 20B"
        },
        {
            "id": "qwen/qwen3-32b",
            "name": "Qwen 3 32B"
        },
        {
            "id": "whisper-large-v3",
            "name": "Whisper Large V3"
        },
        {
            "id": "whisper-large-v3-turbo",
            "name": "Whisper Large V3 Turbo"
        }
    ]
}
