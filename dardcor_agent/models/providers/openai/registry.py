PROVIDER_KEY = "OpenAI"

PROVIDER_REGISTRY_ENTRY = {
    "name": "OpenAI",
    "icon": "\u2295",
    "color": "#10a37f",
    "base_url": "https://api.openai.com/v1",
        "auth_url": "https://platform.openai.com/api-keys",
    "models_fetch_url": "https://api.openai.com/v1/models",
    "capabilities": [
        "chat",
        "embeddings",
        "image_generation",
        "speech_to_text",
        "text_to_speech"
    ],
    "models": [
        {
            "id": "gpt-5.6-sol",
            "name": "GPT-5.6 Sol (Preview, gated)"
        },
        {
            "id": "gpt-5.6-terra",
            "name": "GPT-5.6 Terra (Preview, gated)"
        },
        {
            "id": "gpt-5.6-luna",
            "name": "GPT-5.6 Luna (Preview, gated)"
        },
        {
            "id": "gpt-5.5",
            "name": "GPT-5.5"
        },
        {
            "id": "gpt-5.5-2026-04-23",
            "name": "GPT-5.5 Snapshot"
        },
        {
            "id": "gpt-5.4",
            "name": "GPT-5.4"
        },
        {
            "id": "gpt-5.4-mini",
            "name": "GPT-5.4 Mini"
        },
        {
            "id": "gpt-5",
            "name": "GPT-5"
        },
        {
            "id": "gpt-5-mini",
            "name": "GPT-5 Mini"
        },
        {
            "id": "gpt-5-nano",
            "name": "GPT-5 Nano"
        },
        {
            "id": "gpt-4.1",
            "name": "GPT-4.1"
        },
        {
            "id": "gpt-4o",
            "name": "GPT-4o"
        }
    ]
}
