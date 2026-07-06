from dardcor_agent.models.providers.openai.provider import StandardOpenAIProvider

class CloudflareAIProvider(StandardOpenAIProvider):
    def __init__(self):
        super().__init__()
