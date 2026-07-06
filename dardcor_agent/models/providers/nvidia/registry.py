PROVIDER_KEY = "NVIDIA"

PROVIDER_REGISTRY_ENTRY = {
    "name": "NVIDIA NIM",
    "icon": "\u25b0",
    "color": "#76b900",
    "base_url": "https://integrate.api.nvidia.com/v1",
        "models_fetch_url": "https://integrate.api.nvidia.com/v1/models",
    "auth_url": "https://build.nvidia.com/settings/api-keys",
    "supports_web_login": True,
    "models": [
        {
            "id": "nvidia/nemotron-3-ultra",
            "name": "Nemotron 3 Ultra"
        },
        {
            "id": "nvidia/nemotron-3-super",
            "name": "Nemotron 3 Super"
        },
        {
            "id": "nvidia/nemotron-3-nano-30b-a3b",
            "name": "Nemotron 3 Nano 30B (Free)"
        },
        {
            "id": "nvidia/nemotron-4-340b-instruct",
            "name": "Nemotron 4 340B"
        },
        {
            "id": "nvidia/llama-3.1-nemotron-70b-instruct",
            "name": "Nemotron 70B"
        },
        {
            "id": "nvidia/neutron-8b-instruct",
            "name": "Neutron 8B (Free)"
        },
        {
            "id": "meta/llama-4-maverick-17b-128e-instruct",
            "name": "Llama 4 Maverick"
        },
        {
            "id": "meta/llama-4-scout-17b-16e-instruct",
            "name": "Llama 4 Scout"
        },
        {
            "id": "meta/llama-3.1-405b-instruct",
            "name": "Llama 3.1 405B"
        },
        {
            "id": "deepseek-ai/deepseek-r1",
            "name": "DeepSeek R1"
        },
        {
            "id": "deepseek-ai/deepseek-v3.1",
            "name": "DeepSeek V3.1"
        },
        {
            "id": "deepseek-ai/deepseek-v4-flash",
            "name": "DeepSeek V4 Flash"
        },
        {
            "id": "qwen/qwen3-235b-a22b",
            "name": "Qwen 3 235B"
        },
        {
            "id": "qwen/qwen2.5-72b-instruct",
            "name": "Qwen 2.5 72B"
        },
        {
            "id": "mistralai/mistral-large",
            "name": "Mistral Large"
        }
    ]
}
