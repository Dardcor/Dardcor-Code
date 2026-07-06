PROVIDER_KEY = "Dardcor"

PROVIDER_REGISTRY_ENTRY = {
    "name": "Dardcor",
    "icon": "D",
    "color": "#0e639c",
    "base_url": "",
        "is_special": True,
    "built_in": True,
    "tier": "Built-in",
    "capabilities": [
        "chat",
        "web_search",
        "web_fetch",
        "embeddings",
        "image_generation",
        "speech_to_text",
        "text_to_speech",
        "skills"
    ],
    "models": [
        {
            "id": "dardcor-flash-free",
            "name": "Dardcor Flash Free",
            "description": "Virtual orchestrator that routes to configured free/provider models."
        },
        {
            "id": "dardcor-max",
            "name": "Dardcor Max",
            "description": "Max orchestrator using active user providers with Fable-style reasoning prompts and 2.5x usage weight."
        }
    ]
}
