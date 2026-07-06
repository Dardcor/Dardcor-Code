from dardcor_agent.models.providers.openai.provider import StandardOpenAIProvider

class OpenCodeZenProvider(StandardOpenAIProvider):
    def __init__(self):
        super().__init__()
