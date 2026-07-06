PROVIDER_KEY = "CloudflareAI"

PROVIDER_REGISTRY_ENTRY = {
    "name": "Cloudflare Workers AI",
    "icon": "\u2601",
    "color": "#f6821f",
    "base_url": "",
        "requires_base_url": True,
    "models": [
        {
            "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            "name": "Llama 3.3 70B (Free)"
        },
        {
            "id": "@cf/meta/llama-3.1-70b-instruct",
            "name": "Llama 3.1 70B (Free)"
        },
        {
            "id": "@cf/meta/llama-3.1-8b-instruct",
            "name": "Llama 3.1 8B (Free)"
        },
        {
            "id": "@cf/deepseek-ai/deepseek-r1",
            "name": "DeepSeek R1 (Free)"
        },
        {
            "id": "@cf/qwen/qwen2.5-coder-32b-instruct",
            "name": "Qwen 2.5 Coder (Free)"
        },
        {
            "id": "@cf/mistral/mistral-7b-instruct-v0.2",
            "name": "Mistral 7B (Free)"
        }
    ]
}
