from typing import List, Dict, Any, Optional

class ProviderResponse:
    """Standardized response from an API provider."""
    def __init__(
        self,
        content: str = "",
        tool_calls: List[Dict[str, Any]] = None,
        error: str = None,
        usage: Dict[str, Any] = None,
    ):
        self.content = content
        self.tool_calls = tool_calls or []
        self.error = error
        self.usage = usage or {}

class BaseProvider:
    """Abstract base class for all AI model providers."""
    
    def generate_turn(
        self, 
        messages: List[Dict[str, Any]], 
        tools: List[Dict[str, Any]], 
        config: Any, 
        model_override: str, 
        abort_check_fn: callable,
        conversation_callback: callable
    ) -> ProviderResponse:
        """
        Generates a single turn of conversation.
        
        Args:
            messages: List of message dicts (role, content, etc)
            tools: List of tool declarations
            config: Agent configuration object containing api_key, model, etc
            model_override: Specific model name requested by user
            abort_check_fn: Callable that returns True if user aborted
            conversation_callback: Callable to add system messages (e.g. for switching accounts)
            
        Returns:
            ProviderResponse object containing either content/tool_calls or an error message.
        """
        raise NotImplementedError("Providers must implement generate_turn")
