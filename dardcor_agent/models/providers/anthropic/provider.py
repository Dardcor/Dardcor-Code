from dardcor_agent.models.providers.openai_compatible.provider import StandardOpenAIProvider

class AnthropicProvider(StandardOpenAIProvider):
    def __init__(self):
        super().__init__()
