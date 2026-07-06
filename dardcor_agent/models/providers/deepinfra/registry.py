PROVIDER_KEY = "DeepInfra"

PROVIDER_REGISTRY_ENTRY = {
    "name": "DeepInfra",
    "icon": "\u2b22",
    "color": "#6366f1",
    "base_url": "https://api.deepinfra.com/v1/openai",
        "models_fetch_url": "https://api.deepinfra.com/models/list",
    "capabilities": [
        "chat",
        "embeddings"
    ],
    "models": [
        {
            "id": "Qwen/Qwen3-Max",
            "name": "Qwen 3 Max"
        },
        {
            "id": "Qwen/Qwen3-Max-Thinking",
            "name": "Qwen 3 Max Thinking"
        },
        {
            "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo",
            "name": "Qwen 3 Coder 480B"
        },
        {
            "id": "deepseek-ai/DeepSeek-V3-0324",
            "name": "DeepSeek V3 0324"
        },
        {
            "id": "deepseek-ai/DeepSeek-V3",
            "name": "DeepSeek V3"
        },
        {
            "id": "Qwen/Qwen3-32B",
            "name": "Qwen 3 32B"
        }
    ]
}
