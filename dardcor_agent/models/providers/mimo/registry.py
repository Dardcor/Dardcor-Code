PROVIDER_KEY = "MiMo"

PROVIDER_REGISTRY_ENTRY = {
    "name": "MiMo (Xiaomi)",
    "icon": "\u79be",
    "color": "#ff6900",
    "base_url": "https://token-plan-sgp.xiaomimimo.com/v1",
        "tier": "Token Plan",
    "api_key_header": "api-key",
    "auth_url": "https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription",
    "supports_web_login": True,
    "requires_api_key": True,
    "models": [
        {
            "id": "mimo-v2.5-pro",
            "name": "MiMo V2.5 Pro"
        },
        {
            "id": "mimo-v2.5",
            "name": "MiMo V2.5"
        },
        {
            "id": "mimo-v2.5-asr",
            "name": "MiMo V2.5 ASR"
        },
        {
            "id": "mimo-v2.5-tts",
            "name": "MiMo V2.5 TTS"
        },
        {
            "id": "mimo-v2.5-tts-voiceclone",
            "name": "MiMo V2.5 TTS Voice Clone"
        },
        {
            "id": "mimo-v2.5-tts-voicedesign",
            "name": "MiMo V2.5 TTS Voice Design"
        }
    ]
}
