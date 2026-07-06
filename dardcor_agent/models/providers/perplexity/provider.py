from dardcor_agent.models.providers.openai.provider import StandardOpenAIProvider

class PerplexityProvider(StandardOpenAIProvider):
    def __init__(self):
        super().__init__()
